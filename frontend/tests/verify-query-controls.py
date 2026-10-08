"""Create 240 non-sensitive alerts through POST in an EMPTY isolated demo DB.

Compare real TCP GET filters/limits/order/cursors and server decisions to core.
No default/user DB is opened. The demo data and JSON evidence are retained.
"""
import argparse
from dataclasses import asdict
import json
from pathlib import Path
import sqlite3
import sys
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from app.schemas import ALERT_EVIDENCE_FIELDS
from core.main import evaluate_event
from core.step01_DecisionEvent import DecisionEvent


def run(base, database):
    def request(path, payload=None):
        data = None if payload is None else json.dumps(payload).encode('utf-8')
        with urlopen(Request(base + path, data=data, headers={'Content-Type': 'application/json'}), timeout=10) as response:
            return json.load(response)

    with sqlite3.connect(f'file:{database.as_posix()}?mode=ro', uri=True) as db:
        assert db.execute('SELECT COUNT(*) FROM alerts').fetchone()[0] == 0, 'Requires empty demo DB'
    assert request('/alerts?limit=5') == {'count': 0, 'limit': 5, 'alerts': [], 'next_cursor': None}
    profiles = [
        ('timeout', {'error_code': 'timeout_01'}),
        ('warn_no_review', {'confidence': 0.3}),
        ('warn_review', {'confidence': 0.3, 'model_version': None}),
        ('info_no_signals', {}),
        ('latency', {'confidence': 0.3, 'latency_ms': 2800}),
        ('info_missing', {'model_version': None}),
    ]
    details = []
    for index in range(240):
        label, override = profiles[index % len(profiles)]
        payload = dict(event_id=f'day9_demo_{index:03d}_{label}', decision_type='approve', confidence=0.9,
                       latency_ms=100, model_version='v1', error_code=None, metadata={'source': 'non-sensitive-demo'})
        payload.update(override)
        created = request('/evaluate', payload)
        detail = request(f'/alerts/{created["alert_id"]}')
        expected = asdict(evaluate_event(DecisionEvent(**payload)))
        for field in ['event_id', 'level', 'human_required', 'risk_score', 'uncertainty_score', 'recommended_actions', 'reason_summary']:
            assert detail[field] == created[field] == expected[field], (index, field)
        assert detail['trace_id'] == created['trace_id'] and detail['created_at'] == created['created_at']
        expected_signals = []
        for signal in expected['signals']:
            signal = {key: value for key, value in signal.items() if key != 'metadata'}
            allowed = ALERT_EVIDENCE_FIELDS.get(signal['rule_id'], ())
            signal['evidence'] = {key: value for key, value in signal['evidence'].items() if key in allowed}
            expected_signals.append(signal)
        assert detail['signals'] == expected_signals and 'metadata' not in detail
        details.append(detail)
    # Tie timestamps across page boundaries in this EMPTY, explicitly supplied
    # demo database only. Core decisions and storage schema remain unchanged.
    with sqlite3.connect(database) as db:
        db.executemany('UPDATE alerts SET created_at=? WHERE alert_id=?',
                       [(f'2026-10-08T00:{i // 60:02d}:00+00:00', a['alert_id']) for i,a in enumerate(details)])
    details = [request(f'/alerts/{a["alert_id"]}') for a in details]
    ordered = sorted(details, key=lambda a: (a['created_at'], a['alert_id']), reverse=True)
    checks = []
    for limit in [1, 5, 37, 100]:
        for level in ['', 'INFO', 'WARN', 'CRITICAL']:
            for human in ['', 'true', 'false']:
                params = {'limit': limit}
                if level:
                    params['level'] = level
                if human:
                    params['human_required'] = human
                path = '/alerts?' + urlencode(params)
                page = request(path)
                matching = [a for a in ordered if (not level or a['level'] == level) and
                            (not human or str(a['human_required']).lower() == human)]
                expected = matching[:limit]
                assert page['alerts'] == expected, path
                assert page['count'] == len(expected) and page['limit'] == limit
                cursor = {'created_at': expected[-1]['created_at'], 'alert_id': expected[-1]['alert_id']} if len(matching) > limit else None
                assert page['next_cursor'] == cursor, path
                checks.append({'path': path, 'count': page['count'], 'ids': [a['alert_id'] for a in page['alerts']], 'next_cursor': cursor})
    pagination = []
    for direction in ['desc','asc']:
        expected_all = sorted(details, key=lambda a:(a['created_at'],a['alert_id']), reverse=direction=='desc')
        for limit in [1,5,37,100]:
            collected, cursor = [], None
            while True:
                params={'limit':limit,'sort_order':direction}
                if cursor:
                    params.update(cursor_created_at=cursor['created_at'],cursor_alert_id=cursor['alert_id'])
                path='/alerts?'+urlencode(params)
                result=request(path)
                assert result['count']==len(result['alerts']) and result['limit']==limit
                collected.extend(result['alerts'])
                cursor=result['next_cursor']
                if cursor:
                    assert cursor == {key:result['alerts'][-1][key] for key in ['created_at','alert_id']}
                pagination.append({'path':path,'ids':[a['alert_id'] for a in result['alerts']],'next_cursor':cursor})
                if cursor is None: break
            assert collected==expected_all and len({a['alert_id'] for a in collected})==240
    for params, indices in [
        ({'created_from':'2026-10-08T09:01:00+09:00','created_to':'2026-10-08T09:02:00+09:00'},range(60,120)),
        ({'created_to':'2026-10-08T09:01:00+09:00'},range(60)),
        ({'created_from':'2026-10-08T09:03:00+09:00'},range(180,240)),
    ]:
        result=request('/alerts?'+urlencode({'limit':100,'sort_order':'asc',**params}))
        assert result['alerts']==[details[i] for i in indices]
    for params in [{'sort_order':'invalid'},{'cursor_alert_id':1},{'cursor_created_at':'2026-10-08T09:00:00+09:00'},{'created_from':'2026-10-08T09:00:00'},{'created_from':'2026-10-08T09:00:00+09:00','created_to':'2026-10-08T09:00:00+09:00'}]:
        try:
            request('/alerts?'+urlencode(params));raise AssertionError('Expected 422')
        except HTTPError as error: assert error.code==422
    assert len(request('/alerts?limit=100')['alerts']) == 100
    latest_ids = {a['alert_id'] for a in ordered[:5]}
    target = next(a for a in ordered if a['level'] == 'CRITICAL' and a['alert_id'] not in latest_ids)
    filtered = request('/alerts?limit=37&level=CRITICAL&human_required=true')
    assert target in filtered['alerts']
    assert request(f'/alerts/{target["alert_id"]}') == target
    missing_id = max(a['alert_id'] for a in details) + 1000
    try:
        request(f'/alerts/{missing_id}')
        raise AssertionError('Expected detail 404')
    except HTTPError as error:
        assert error.code == 404
    with sqlite3.connect(f'file:{database.as_posix()}?mode=ro', uri=True) as db:
        rows = db.execute('SELECT event_id FROM alerts ORDER BY alert_id').fetchall()
        assert [r[0] for r in rows] == [a['event_id'] for a in details]
    return {'base': base, 'database': str(database), 'row_count': len(details), 'checks': checks,
            'pagination':pagination, 'outside_page_target': target, 'missing_id': missing_id, 'details': details}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', required=True, type=Path)
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    database = args.db.resolve()
    if database == (ROOT / 'data/alerts.db').resolve() or not database.is_file():
        parser.error('Use the new empty demo DB started by c2_dashboard_local.py --db <new-isolated-db>')
    result = run(f'http://127.0.0.1:{args.port}', database)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print('PASS: 240 POST/GET/core comparisons; 48 filter/limit combinations; 8 full bidirectional tie-boundary walks; half-open KST dates and invalid requests; limit=100 returns 100; outside-page target; detail 404; DB rows retained')
    print(f'Evidence: {args.output.resolve()}')
