import json

from fastapi.testclient import TestClient

from app.db.alert_repository import AlertRepository
from app.main import app

client = TestClient(app)

def test_missing_required_field_does_not_save(test_db_path, monkeypatch, request_log_records):
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

    body = response.json()

    assert body["error_type"] == "api_validation_error"
    assert body["trace_id"] == response.headers["x-trace-id"]

    request_completed_logs = []

    for record in request_log_records:
        log_entry = json.loads(record.getMessage())

        if log_entry.get("event") == "request_completed":
            request_completed_logs.append(log_entry)

    assert len(request_completed_logs) == 1

    request_log = request_completed_logs[0]

    assert request_log["status_code"] == 422
    assert request_log["result"] == "failure"
    assert request_log["failure_stage"] == "api_validation"
    assert request_log["persistence_outcome"] == "not_attempted"

    assert request_log["trace_id"] == body["trace_id"] == response.headers["x-trace-id"]

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

