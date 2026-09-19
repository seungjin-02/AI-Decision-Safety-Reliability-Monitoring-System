import json
import sqlite3

import app.main as main_module
import app.services.evaluation_service as service_module

from app.db.connection import create_connection
from fastapi.testclient import TestClient
from app.db.alert_repository import AlertRepository, PersistenceError

client = TestClient(
    main_module.app,
    raise_server_exceptions=False,
)

def test_unexpected_internal_error(monkeypatch):
    def raise_unexpected_error(payload, trace_id, repository):
        raise RuntimeError("injected unexpected error")

    monkeypatch.setattr(main_module,"evaluate_request", raise_unexpected_error)  # 강제 error 발생

    payload = {
        "event_id": "event_system_error_001",
        "decision_type": "approve",
        "confidence": 0.8,
        "latency_ms": 300,
        "model_version": "v1",
        "error_code": None,
        "metadata": {},
    }

    response = client.post("/evaluate", json=payload)

    assert response.status_code == 500

    body = response.json()

    assert set(body.keys()) == {
        "trace_id",
        "error_type",
        "message",
        "details",
    }
    assert body["error_type"] == "system_error"
    assert body["message"] == "Unexpected internal server error"
    assert "x-trace-id" in response.headers
    assert body["trace_id"] == response.headers["x-trace-id"]
    assert body["details"] == []

def test_repository_save_failure_returns_persistence_error():
    class FailingRepository:
        def __init__(self):
            self.save_called = False

        def save(self, alert, trace_id):
            self.save_called = True
            raise PersistenceError(
                "injected database failure",
                persistence_outcome="rolled_back",
            )

    failing_repository = FailingRepository()

    def override_alert_repository():
        return failing_repository

    main_module.app.dependency_overrides[main_module.get_alert_repository] = override_alert_repository

    payload = {
        "event_id": "event_repository_failure_001",
        "decision_type": "approve",
        "confidence": 0.8,
        "latency_ms": 300,
        "model_version": "v1",
        "error_code": None,
        "metadata": {},
    }

    try:
        response = client.post("/evaluate", json=payload)

    finally:
        main_module.app.dependency_overrides.pop(main_module.get_alert_repository, None)

    assert failing_repository.save_called is True # save까지는 호출 but 저장 안됨
    assert response.status_code == 500

    body = response.json()

    assert set(body.keys()) == {
        "trace_id",
        "error_type",
        "message",
        "details",
    }
    assert body["error_type"] == "persistence_error"
    assert body["message"] == "Database operation failed"
    assert "x-trace-id" in response.headers
    assert body["trace_id"] == response.headers["x-trace-id"]
    assert body["details"] == []

def test_db_rolled_back(test_db_path, monkeypatch, request_log_records):
    original_evaluate_event = service_module.evaluate_event

    def evaluate_with_duplicate_signal(event):
        alert = original_evaluate_event(event)

        # 같은 rule_id를 가진 signal을 의도적으로 중복시킨다.
        alert.signals.append(alert.signals[0])

        return alert

    monkeypatch.setattr(
        service_module,
        "evaluate_event",
        evaluate_with_duplicate_signal,
    )

    payload = {
        "event_id": "event_rollback_001",
        "decision_type": "approve",
        "confidence": 0.3,
        "latency_ms": 800,
        "model_version": "v1",
        "error_code": None,
        "metadata": {
            "source": "rollback_api_test",
        },
    }

    response = client.post("/evaluate", json=payload)

    assert response.status_code == 500

    body = response.json()

    assert body["error_type"] == "persistence_error"
    assert body["message"] == "Database operation failed"
    assert body["trace_id"] == response.headers["x-trace-id"]

    request_completed_logs = []

    for record in request_log_records:
        log_entry = json.loads(record.getMessage())

        if log_entry.get("event") == "request_completed":
            request_completed_logs.append(log_entry)

    assert len(request_completed_logs) == 1

    request_log = request_completed_logs[0]

    assert request_log["status_code"] == 500
    assert request_log["result"] == "failure"
    assert request_log["failure_stage"] == "persistence"
    assert request_log["persistence_outcome"] == "rolled_back"
    assert request_log["trace_id"] == body["trace_id"] == response.headers["x-trace-id"]

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

def test_rollback_failure_records_unknown_persistence_outcome(test_db_path, monkeypatch, request_log_records):
    class FakeCursor:
        lastrowid = 1

    class FailingConnection:
        def __init__(self):
            self.execute_count = 0
            self.commit_called = False
            self.rollback_called = False
            self.close_called = False

        def execute(self, sql, params):
            self.execute_count += 1

            # 첫 번째 alerts INSERT는 성공한 것으로 처리
            if self.execute_count == 1:
                return FakeCursor()

            # 두 번째 signal INSERT에서 저장 실패
            raise sqlite3.OperationalError("injected insert failure")

        def commit(self):
            self.commit_called = True

        def rollback(self):
            self.rollback_called = True
            raise sqlite3.OperationalError("injected rollback failure")

        def close(self):
            self.close_called = True

    failing_connection = FailingConnection()


    monkeypatch.setattr(
        AlertRepository,
        "_open_connection",
        lambda self: failing_connection,
    )

    payload = {
        "event_id": "event_rollback_unknown_001",
        "decision_type": "approve",
        "confidence": 0.3,
        "latency_ms": 800,
        "model_version": "v1",
        "error_code": None,
        "metadata": {},
    }

    response = client.post("/evaluate", json=payload)

    assert failing_connection.execute_count == 2
    assert failing_connection.commit_called is False
    assert failing_connection.rollback_called is True
    assert failing_connection.close_called is True

    assert response.status_code == 500

    body = response.json()

    assert body["error_type"] == "persistence_error"
    assert body["message"] == "Database operation failed"
    assert body["trace_id"] == response.headers["x-trace-id"]

    request_completed_logs = []

    for record in request_log_records:
        log_entry = json.loads(record.getMessage())

        if log_entry.get("event") == "request_completed":
            request_completed_logs.append(log_entry)

    assert len(request_completed_logs) == 1

    request_log = request_completed_logs[0]

    assert request_log["status_code"] == 500
    assert request_log["result"] == "failure"
    assert request_log["failure_stage"] == "persistence"
    assert request_log["persistence_outcome"] == "unknown"
    assert request_log["trace_id"] == body["trace_id"] == response.headers["x-trace-id"]

def test_response_validation_failure_after_commit_records_committed(test_db_path, monkeypatch, request_log_records):

    def return_invalid_response(alert, trace_id, saved_alert):
        return {
            "trace_id": trace_id,
        }

    monkeypatch.setattr(
        main_module,
        "alert_to_response",
        return_invalid_response,
    )

    payload = {
        "event_id": "event_response_validation_001",
        "decision_type": "approve",
        "confidence": 0.8,
        "latency_ms": 300,
        "model_version": "v1",
        "error_code": None,
        "metadata": {},
    }

    response = client.post("/evaluate", json=payload)

    assert response.status_code == 500

    body = response.json()

    assert body["error_type"] == "system_error"
    assert body["message"] == "Unexpected internal server error"
    assert body["trace_id"] == response.headers["x-trace-id"]

    request_completed_logs = []

    for record in request_log_records:
        log_entry = json.loads(record.getMessage())

        if log_entry.get("event") == "request_completed":
            request_completed_logs.append(log_entry)

    assert len(request_completed_logs) == 1

    request_log = request_completed_logs[0]

    assert request_log["status_code"] == 500
    assert request_log["result"] == "failure"
    assert request_log["failure_stage"] == "response_validation"
    assert request_log["persistence_outcome"] == "committed"
    assert request_log["trace_id"] == body["trace_id"] == response.headers["x-trace-id"]

    # commit 됐는지 실제 검증
    connection = create_connection(test_db_path)

    try:
        alert_row = connection.execute(
            """
            SELECT
                trace_id,
                event_id
            FROM alerts
            WHERE event_id = ?
            """,
            (payload["event_id"],),
        ).fetchone()

        assert alert_row is not None
        assert alert_row["event_id"] == payload["event_id"]
        assert alert_row["trace_id"] == request_log["trace_id"]

    finally:
        connection.close()

