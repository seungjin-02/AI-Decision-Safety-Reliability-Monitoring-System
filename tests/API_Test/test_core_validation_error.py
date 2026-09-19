import json

from fastapi.testclient import TestClient

from app.db.alert_repository import AlertRepository
from app.db.connection import create_connection
from app.main import app

client = TestClient(app)

def test_confidence_pass_threshold(test_db_path):
    payload = {
        "event_id": "event_core_validation_001",
        "decision_type": "approve",
        "confidence": 0.8,
        "latency_ms": 300,
        "model_version": "v1",
        "error_code": None,
        "metadata": {},
    }

    response = client.post("/evaluate", json=payload)
    body = response.json()

    assert response.status_code == 201

def test_confidence_above_threshold(test_db_path):
    payload = {
        "event_id": "event_core_validation_002",
        "decision_type": "approve",
        "confidence": 1.5,
        "latency_ms": 300,
        "model_version": "v1",
        "error_code": None,
        "metadata": {},
    }

    response = client.post("/evaluate", json=payload)
    body = response.json()

    assert response.status_code == 400
    assert body["error_type"] == "core_validation_error"
    assert "confidence" in body["message"]

def test_confidence_below_threshold(test_db_path):
    payload = {
        "event_id": "event_core_validation_003",
        "decision_type": "approve",
        "confidence": -0.1,
        "latency_ms": 300,
        "model_version": "v1",
        "error_code": None,
        "metadata": {},
    }

    response = client.post("/evaluate", json=payload)
    body = response.json()

    assert response.status_code == 400
    assert body["error_type"] == "core_validation_error"
    assert "confidence" in body["message"]

def test_blank_event_id(test_db_path):
    payload = {
        "event_id": "   ",
        "decision_type": "approve",
        "confidence": 0.8,
        "latency_ms": 300,
        "model_version": "v1",
        "error_code": None,
        "metadata": {},
    }

    response = client.post("/evaluate", json=payload)
    body = response.json()

    assert response.status_code == 400
    assert body["error_type"] == "core_validation_error"
    assert "event_id" in body["message"]

def test_blank_decision_type(test_db_path):
    payload = {
        "event_id": "event_core_validation_005",
        "decision_type": "   ",
        "confidence": 0.8,
        "latency_ms": 300,
        "model_version": "v1",
        "error_code": None,
        "metadata": {},
    }

    response = client.post("/evaluate", json=payload)
    body = response.json()

    assert response.status_code == 400
    assert body["error_type"] == "core_validation_error"
    assert "decision_type" in body["message"]

def test_unsupported_decision_type(test_db_path):
    payload = {
        "event_id": "event_core_validation_006",
        "decision_type": "unknown",
        "confidence": 0.8,
        "latency_ms": 300,
        "model_version": "v1",
        "error_code": None,
        "metadata": {},
    }

    response = client.post("/evaluate", json=payload)
    body = response.json()

    assert response.status_code == 400
    assert body["error_type"] == "core_validation_error"
    assert "decision_type" in body["message"]

def test_negative_latency_ms(test_db_path):
    payload = {
        "event_id": "event_core_validation_007",
        "decision_type": "approve",
        "confidence": 0.8,
        "latency_ms": -1,
        "model_version": "v1",
        "error_code": None,
        "metadata": {},
    }

    response = client.post("/evaluate", json=payload)
    body = response.json()

    assert response.status_code == 400
    assert body["error_type"] == "core_validation_error"
    assert "latency_ms" in body["message"]

def test_core_validation_error_does_not_save_any_rows(test_db_path, monkeypatch, request_log_records):
    original_save = AlertRepository.save
    save_calls = []

    def tracked_save(self, alert, trace_id):
        save_calls.append(
            {
                "alert": alert,
                "trace_id": trace_id,
            }
        )

        return original_save(
            self,
            alert,
            trace_id,
        )

    # 저장을 시도했는지를 검증하기 위함
    monkeypatch.setattr(
        AlertRepository,
        "save",
        tracked_save,
    )

    payload = {
        "event_id": "event_core_validation_008",
        "decision_type": "approve",
        "confidence": 1.5,
        "latency_ms": 300,
        "model_version": "v1",
        "error_code": None,
        "metadata": {},
    }

    response = client.post("/evaluate", json=payload)

    assert response.status_code == 400
    assert save_calls == []

    body = response.json()

    assert body["error_type"] == "core_validation_error"
    assert body["trace_id"] == response.headers["x-trace-id"]

    request_completed_logs = []

    for record in request_log_records:
        log_entry = json.loads(record.getMessage())

        if log_entry.get("event") == "request_completed":
            request_completed_logs.append(log_entry)

    assert len(request_completed_logs) == 1

    request_log = request_completed_logs[0]

    assert request_log["status_code"] == 400
    assert request_log["result"] == "failure"
    assert request_log["failure_stage"] == "core_evaluation"
    assert request_log["persistence_outcome"] == "not_attempted"
    assert request_log["trace_id"] == body["trace_id"] == response.headers["x-trace-id"]

    # 재검증
    connection = create_connection(test_db_path)

    try:
        alert_count = connection.execute(
            "SELECT COUNT(*) FROM alerts"
        ).fetchone()[0]

        signal_count = connection.execute(
            "SELECT COUNT(*) FROM alert_signals"
        ).fetchone()[0]

        action_count = connection.execute(
            "SELECT COUNT(*) FROM alert_actions"
        ).fetchone()[0]

        assert alert_count == 0
        assert signal_count == 0
        assert action_count == 0

    finally:
        connection.close()

