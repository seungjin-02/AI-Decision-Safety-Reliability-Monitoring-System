from fastapi.testclient import TestClient

from app.db.alert_repository import AlertRepository
from app.main import app

client = TestClient(app)

def test_missing_required_field_does_not_save(test_db_path, monkeypatch):
    save_calls = []

    def fake_save(self, alert, trace_id):
        save_calls.append(
            {
                "alert": alert,
                "trace_id": trace_id,
            }
        )

    monkeypatch.setattr(
        AlertRepository,
        "save",
        fake_save,
    )

    payload = {
        # event_id 누락
        "decision_type": "approve",
        "confidence": 0.95,
        "latency_ms": 300,
        "model_version": "v1",
        "error_code": None,
        "metadata": {},
    }

    response = client.post("/evaluate", json=payload)

    assert response.status_code == 422
    assert save_calls == []

def test_invalid_confidence_field():
    payload = {
        "event_id": "evt_api_test_002",
        "decision_type": "approve",
        "confidence": "high",  # 숫자여야 하지만 문자열 전달
        "latency_ms": 300,
        "model_version": "v1",
        "error_code": None,
        "metadata": {},
    }

    response = client.post("/evaluate", json=payload)

    assert response.status_code == 422

def test_malformed_json():
    response = client.post(
        "/evaluate",
        content='{"event_id": "evt_api_test_003"',
        headers={"Content-Type": "application/json"},
    )

    assert response.status_code == 422

