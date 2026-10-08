import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.db.alert_repository import AlertRepository
from app.db.connection import create_connection
from core.main import evaluate_event
from core.step01_DecisionEvent import DecisionEvent


@pytest.fixture
def ordered_alerts(test_db_path):
    repository = AlertRepository(test_db_path)
    alert = evaluate_event(DecisionEvent(event_id='pagination', decision_type='approve',
        confidence=0.9, latency_ms=20, model_version='v1'))
    ids = [repository.save(alert, f'pagination-{index}').alert_id for index in range(207)]
    with create_connection(test_db_path) as connection:
        for index, alert_id in enumerate(ids):
            # Ties cross both 5- and 100-item page boundaries.
            stamp = f'2026-10-08T00:{index // 70:02d}:00+00:00'
            connection.execute('UPDATE alerts SET created_at=? WHERE alert_id=?', (stamp, alert_id))
    return ids, repository


@pytest.mark.parametrize('direction', ['desc', 'asc'])
@pytest.mark.parametrize('limit', [1, 5, 37, 100])
def test_bidirectional_pages_have_no_gaps_or_duplicates(ordered_alerts, direction, limit):
    ids, repository = ordered_alerts
    client = TestClient(app)
    params = {'limit': limit, 'sort_order': direction}
    collected = []
    while True:
        response = client.get('/alerts', params=params)
        assert response.status_code == 200
        page = response.json()
        assert page['count'] == len(page['alerts']) <= limit
        collected.extend(item['alert_id'] for item in page['alerts'])
        cursor = page['next_cursor']
        if cursor is None:
            break
        assert cursor == {key: page['alerts'][-1][key] for key in ('created_at', 'alert_id')}
        params.update(cursor_created_at=cursor['created_at'], cursor_alert_id=cursor['alert_id'])
    assert collected == (ids if direction == 'asc' else ids[::-1])
    assert len(set(collected)) == 207
    assert [item.alert_id for item in repository.search(101, sort_order=direction)] == collected[:101]


def test_default_sort_and_half_open_kst_boundaries(ordered_alerts):
    ids, _ = ordered_alerts
    client = TestClient(app)
    assert client.get('/alerts').json() == client.get('/alerts?sort_order=desc').json()
    params = {'sort_order': 'asc', 'limit': 100, 'level': 'INFO', 'human_required': 'false',
        'created_from': '2026-10-08T09:01:00+09:00', 'created_to': '2026-10-08T09:02:00+09:00'}
    page = client.get('/alerts', params=params).json()
    assert [item['alert_id'] for item in page['alerts']] == ids[70:140]
    assert page['next_cursor'] is None
    for key, expected in [('created_from', ids[70:170]), ('created_to', ids[:140])]:
        one = {key: params[key], 'sort_order': 'asc', 'limit': 100}
        page = client.get('/alerts', params=one).json()
        assert [item['alert_id'] for item in page['alerts']] == expected[:100]


@pytest.mark.parametrize('query', ['sort_order=invalid', 'sort_order=ASC',
    'sort_order=', 'cursor_alert_id=1', 'cursor_created_at=2026-10-08T00:00:00Z',
    'created_from=2026-10-08T00:00:00',
    'created_from=2026-10-08T00:00:00Z&created_to=2026-10-08T00:00:00Z'])
def test_invalid_sort_dates_and_cursor_pairs_are_rejected(test_db_path, query):
    assert TestClient(app).get('/alerts?' + query).status_code == 422


def test_repository_rejects_unknown_sort(ordered_alerts):
    _, repository = ordered_alerts
    with pytest.raises(ValueError, match='sort_order'):
        repository.search(5, sort_order='invalid')
