"""Seed a NEW isolated demo via real HTTP, then compare GET output and core.

Run only against frontend/demo_server.py with an empty demo DB.
This validates HTTP contracts, not browser rendering.
"""
import argparse
from dataclasses import asdict
import json
from pathlib import Path
import sqlite3
import sys
from urllib.request import Request, urlopen
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from app.schemas import ALERT_EVIDENCE_FIELDS
from core.main import evaluate_event
from core.step01_DecisionEvent import DecisionEvent


def run(base, database):
    def request(path, payload=None):
        data = None if payload is None else json.dumps(payload).encode('utf-8')
        with urlopen(Request(base + path, data=data, headers={'Content-Type': 'application/json'})) as response:
            return json.load(response)

    with sqlite3.connect(f'file:{database.as_posix()}?mode=ro', uri=True) as connection:
        assert connection.execute('SELECT COUNT(*) FROM alerts').fetchone()[0] == 0, 'Demo DB must be empty'
    empty = request('/alerts?limit=5')
    assert empty == {'count': 0, 'limit': 5, 'alerts': [], 'next_cursor': None}
    overrides = [
        ('timeout', {'error_code': 'timeout_01'}),
        ('warn_no_review', {'confidence': 0.3}),
        ('warn_review', {'confidence': 0.3, 'model_version': None}),
        ('info_no_signals', {}),
        ('latency', {'confidence': 0.3, 'latency_ms': 2800}),
        ('info_missing', {'model_version': None}),
    ]
    details = {}
    for label, override in overrides:
        payload = dict(event_id='day7_demo_' + label, decision_type='approve', confidence=0.9,
                       latency_ms=100, model_version='v1', error_code=None, metadata={'source': 'non-sensitive-demo'})
        payload.update(override)
        created = request('/evaluate', payload)
        detail = request(f'/alerts/{created["alert_id"]}')
        expected = asdict(evaluate_event(DecisionEvent(**payload)))
        for field in ['event_id', 'level', 'human_required', 'risk_score', 'uncertainty_score',
                      'recommended_actions', 'reason_summary']:
            assert detail[field] == expected[field] == created[field], field
        assert detail['trace_id'] == created['trace_id']
        assert detail['created_at'] == created['created_at']
        assert 'metadata' not in detail
        signals = []
        for signal in expected['signals']:
            signal = {key: value for key, value in signal.items() if key != 'metadata'}
            allowed = ALERT_EVIDENCE_FIELDS.get(signal['rule_id'], ())
            signal['evidence'] = {key: value for key, value in signal['evidence'].items() if key in allowed}
            signals.append(signal)
        assert detail['signals'] == signals
        for signal in detail['signals']:
            assert 'metadata' not in signal
            assert set(signal['evidence']) <= set(ALERT_EVIDENCE_FIELDS.get(signal['rule_id'], ()))
        details[label] = detail
    page = request('/alerts?limit=5')
    ordered = sorted(details.values(), key=lambda item: (item['created_at'], item['alert_id']), reverse=True)
    assert page['alerts'] == ordered[:5]
    assert page['count'] == 5 and page['limit'] == 5
    assert page['next_cursor']['alert_id'] == page['alerts'][-1]['alert_id']
    warn_false = request('/alerts?limit=5&level=WARN&human_required=false')
    assert warn_false['alerts'] == [details['warn_no_review']]
    critical = request('/alerts?limit=5&level=CRITICAL&human_required=true')
    assert critical['alerts'] == [details['latency'], details['timeout']]
    empty_filter = request('/alerts?limit=5&level=INFO&human_required=true')
    assert empty_filter['alerts'] == [] and empty_filter['count'] == 0
    assert request('/alerts?limit=5') == page  # cleared filters
    try:
        request('/alerts/999999')
        raise AssertionError('Expected 404')
    except HTTPError as error:
        assert error.code == 404
    with sqlite3.connect(f'file:{database.as_posix()}?mode=ro', uri=True) as connection:
        rows = connection.execute('SELECT event_id FROM alerts ORDER BY alert_id').fetchall()
        assert [row[0] for row in rows] == ['day7_demo_' + label for label, _ in overrides]
    return {'database': str(database), 'base': base, 'initial_empty': empty, 'page': page,
            'details': details, 'warn_false': warn_false, 'critical': critical, 'empty_filter': empty_filter}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', type=Path, required=True)
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    database = args.db.resolve()
    if database == (ROOT / 'data' / 'alerts.db').resolve() or not database.is_file():
        parser.error('Use the new demo DB started by frontend/demo_server.py')
    result = run(f'http://127.0.0.1:{args.port}', database)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print('PASS: empty/seeded DB, six POST -> GET -> core comparisons, GET exposure contract, order/cursor, filters/reset, 404')
    print(f'HTTP evidence: {args.output.resolve()}')
