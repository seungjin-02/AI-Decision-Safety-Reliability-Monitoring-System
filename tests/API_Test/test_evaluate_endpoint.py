import json
from datetime import datetime

from fastapi.testclient import TestClient
from app.db.connection import create_connection
from app.main import app

client = TestClient(app)

def test_evaluate_endpoint(test_db_path, request_log_records):
    payload = {
        "event_id": "evt_api_test_001",
        "decision_type": "approve",
        "confidence": 0.95,
        "latency_ms": 300,
        "model_version": "v1",
        "error_code": None,
        "metadata": {},
    }

    response = client.post("/evaluate", json=payload)
    body = response.json()

    log_entries = [
        json.loads(record.getMessage()) for record in request_log_records if record.name == "app.request"
    ]

    request_completed_logs = [
        entry for entry in log_entries if entry["event"] == "request_completed"
    ]

    assert len(request_completed_logs) == 1

    request_log = request_completed_logs[0]

    assert set(request_log.keys()) == {
        "timestamp",
        "level",
        "event",
        "trace_id",
        "method",
        "path",
        "status_code",
        "result",
        "duration_ms",
        "failure_stage",
        "persistence_outcome",
    }

    assert request_log["level"] == "INFO"
    assert request_log["event"] == "request_completed"
    assert request_log["method"] == "POST"
    assert request_log["path"] == "/evaluate"
    assert request_log["status_code"] == 201
    assert request_log["result"] == "success"
    assert request_log["failure_stage"] is None
    assert request_log["persistence_outcome"] == "committed"
    assert request_log["duration_ms"] >= 0

    assert response.status_code == 201
    assert body["event_id"] == payload["event_id"]

    required_fields = {
        "alert_id",
        "trace_id",
        "created_at",
        "event_id",
        "level",
        "risk_score",
        "uncertainty_score",
        "human_required",
        "recommended_actions",
        "reason_summary",
        "signals",
        "metadata",
    }

    assert set(body.keys()) == required_fields

    connection = create_connection(test_db_path)

    try:
        alert_row = connection.execute(
            """
            SELECT
                alert_id,
                trace_id,
                event_id,
                risk_score,
                uncertainty_score,
                created_at
            FROM alerts
            WHERE alert_id = ?
            """,
            (body["alert_id"],)
        ).fetchone()

        assert alert_row is not None
        assert alert_row["alert_id"] == body["alert_id"]
        assert alert_row["trace_id"] == body["trace_id"]

        assert body["trace_id"] == response.headers["x-trace-id"]
        assert response.headers["x-trace-id"] == body["trace_id"]
        assert request_log["trace_id"] == body["trace_id"]
        assert alert_row["trace_id"] == body["trace_id"]

        response_created_at = datetime.fromisoformat(body["created_at"].replace("Z", "+00:00"))
        database_created_at = datetime.fromisoformat(alert_row["created_at"])

        assert response_created_at == database_created_at
        assert alert_row["event_id"] == body["event_id"]
        assert alert_row["risk_score"] == body["risk_score"]
        assert alert_row["uncertainty_score"] == body["uncertainty_score"]

        signal_count = connection.execute(
            "SELECT COUNT(*) FROM alert_signals WHERE alert_id = ?",
            (alert_row["alert_id"],),
        ).fetchone()[0]

        action_count = connection.execute(
            "SELECT COUNT(*) FROM alert_actions WHERE alert_id = ?",
            (alert_row["alert_id"],),
        ).fetchone()[0]

        assert signal_count == len(body["signals"])
        assert action_count == len(body["recommended_actions"])

    finally:
        connection.close()