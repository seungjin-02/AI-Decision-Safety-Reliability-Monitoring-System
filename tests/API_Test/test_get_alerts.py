from datetime import datetime
from fastapi.testclient import TestClient
from app.db.alert_repository import AlertRepository
from app.db.connection import create_connection
from app.main import app
from core.main import evaluate_event
from core.step01_DecisionEvent import DecisionEvent

client = TestClient(app)

def test_get_alert_by_id_returns_stored_alert(test_db_path):
    repository = AlertRepository(test_db_path)

    event = DecisionEvent(
        event_id="event_get_alert_001",
        decision_type="approve",
        confidence=0.3,
        latency_ms=2800,
        model_version="v1",
        error_code=None,
        metadata={
            "source": "get_alert_api_test",
        },
    )

    alert = evaluate_event(event)

    saved = repository.save(
        alert=alert,
        trace_id="trace_get_alert_001",
    )

    response = client.get(f"/alerts/{saved.alert_id}")

    assert response.status_code == 200
    assert "x-trace-id" in response.headers
    assert response.headers["x-trace-id"]

    body = response.json()

    assert set(body.keys()) == {
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

    assert body["alert_id"] == saved.alert_id
    assert body["trace_id"] == "trace_get_alert_001" # alert를 생성했던 과거 POST 평가 흐름의 trace_id
    assert body["event_id"] == alert.event_id
    assert body["level"] == alert.level
    assert body["risk_score"] == alert.risk_score
    assert body["uncertainty_score"] == alert.uncertainty_score
    assert body["human_required"] is alert.human_required
    assert body["recommended_actions"] == alert.recommended_actions
    assert body["reason_summary"] == alert.reason_summary
    assert body["metadata"] == alert.metadata

    expected_signals = [
        {
            "rule_id": signal.rule_id,
            "category": signal.category,
            "score": signal.score,
            "reason": signal.reason,
            "evidence": signal.evidence,
            "is_critical_override": signal.is_critical_override,
            "metadata": signal.metadata,
        }
        for signal in alert.signals
    ]

    assert body["signals"] == expected_signals

    assert body["trace_id"] != response.headers["x-trace-id"]

    # Pydantic이 datetime으로 검증한 뒤 ISO 문자열로 직렬화한다.
    response_created_at = datetime.fromisoformat(body["created_at"].replace("Z", "+00:00"))
    saved_created_at = datetime.fromisoformat(saved.created_at)

    assert response_created_at == saved_created_at

def test_get_alert_by_id_returns_404_when_alert_does_not_exist(test_db_path):
    missing_alert_id = 999

    response = client.get(f"/alerts/{missing_alert_id}")

    assert response.status_code == 404
    assert "x-trace-id" in response.headers

    body = response.json()

    assert set(body.keys()) == {
        "trace_id",
        "error_type",
        "message",
        "details",
    }

    assert body["error_type"] == "alert_not_found"
    assert body["message"] == "Alert not found"
    assert body["details"] == [
        {
            "alert_id": missing_alert_id,
        }
    ]

    assert body["trace_id"] == response.headers["x-trace-id"]

def test_get_search_alerts_returns_empty_list(test_db_path):
    response = client.get("/alerts")

    assert response.status_code == 200
    assert response.headers["x-trace-id"]

    assert response.json() == {
        "count": 0,
        "limit": 5,
        "alerts": [],
        "next_cursor": None,
    }

def test_get_search_alerts_returns_alerts_in_search_order(test_db_path):
    repository = AlertRepository(test_db_path)

    first_event = DecisionEvent(
        event_id="event_get_alert_002",
        decision_type="approve",
        confidence=0.8,
        latency_ms=800,
        model_version="v1",
        error_code=None,
        metadata={
            "source": "get_alert_api_test",
        },
    )

    first_alert = evaluate_event(first_event)

    first_saved = repository.save(
        alert=first_alert,
        trace_id="trace_get_alert_002",
    )

    second_event = DecisionEvent(
        event_id="event_get_alert_003",
        decision_type="approve",
        confidence=0.3,
        latency_ms=2800,
        model_version="v1",
        error_code=None,
        metadata={
            "source": "get_alert_api_test",
        },
    )

    second_alert = evaluate_event(second_event)

    second_saved = repository.save(
        alert=second_alert,
        trace_id="trace_get_alert_003",
    )

    response = client.get("/alerts") # default_limit = 5

    body = response.json()

    assert response.status_code == 200
    assert body["count"] == 2
    assert body["limit"] == 5
    assert len(body["alerts"]) == 2

    first_result, second_result = body["alerts"]

    assert first_result["alert_id"] == second_saved.alert_id
    assert second_result["alert_id"] == first_saved.alert_id
    assert first_result["trace_id"] == "trace_get_alert_003"
    assert second_result["trace_id"] == "trace_get_alert_002"
    assert first_result["recommended_actions"] == second_alert.recommended_actions
    assert second_result["recommended_actions"] == first_alert.recommended_actions
    assert first_result["metadata"] == second_alert.metadata
    assert second_result["metadata"] == first_alert.metadata
    assert len(first_result["signals"]) == len(second_alert.signals)
    assert len(second_result["signals"]) == len(first_alert.signals)
    assert [signal["rule_id"] for signal in first_result["signals"]] == [signal.rule_id for signal in second_alert.signals]
    assert [signal["rule_id"] for signal in second_result["signals"]] == [signal.rule_id for signal in first_alert.signals]

    limited_response = client.get("/alerts?limit=1")

    limited_body = limited_response.json()

    assert limited_response.status_code == 200
    assert limited_body["count"] == 1
    assert limited_body["limit"] == 1
    assert len(limited_body["alerts"]) == 1
    assert limited_body["alerts"][0]["alert_id"] == second_saved.alert_id

def test_get_alerts_applies_level_and_human_required_filters(test_db_path):
    repository = AlertRepository(test_db_path)

    warn_without_human_event = DecisionEvent(
        event_id="event_api_search_warn_without_human",
        decision_type="approve",
        confidence=0.3,
        latency_ms=800,
        model_version="v1",
        error_code=None,
        metadata={
            "source": "api_search_filter_test",
        },
    )

    warn_without_human_alert = evaluate_event(warn_without_human_event)

    assert warn_without_human_alert.level == "WARN"
    assert warn_without_human_alert.human_required is False

    warn_without_human_saved = repository.save(
        alert=warn_without_human_alert,
        trace_id="trace_api_search_warn_without_human",
    )

    warn_with_human_event = DecisionEvent(
        event_id="event_api_search_warn_with_human",
        decision_type="approve",
        confidence=0.3,
        latency_ms=800,
        model_version=" ",
        error_code=None,
        metadata={
            "source": "api_search_filter_test",
        },
    )

    warn_with_human_alert = evaluate_event(warn_with_human_event)

    assert warn_with_human_alert.level == "WARN"
    assert warn_with_human_alert.human_required is True

    repository.save(
        alert=warn_with_human_alert,
        trace_id="trace_api_search_warn_with_human",
    )

    response = client.get("/alerts?level=WARN&human_required=false")

    body = response.json()

    assert response.status_code == 200
    assert body["count"] == 1
    assert body["limit"] == 5
    assert len(body["alerts"]) == 1

    result = body["alerts"][0]

    assert result["alert_id"] == warn_without_human_saved.alert_id
    assert result["level"] == "WARN"
    assert result["human_required"] is False

def test_get_alerts_applies_created_at_range(test_db_path):
    repository = AlertRepository(test_db_path)

    event = DecisionEvent(
        event_id="event_api_search_created_at",
        decision_type="approve",
        confidence=0.95,
        latency_ms=300,
        model_version="v1",
        error_code=None,
        metadata={
            "source": "api_search_created_at_test",
        },
    )

    alert = evaluate_event(event)

    outside_saved = repository.save(
        alert=alert,
        trace_id="trace_api_search_created_at_outside",
    )

    inside_saved = repository.save(
        alert=alert,
        trace_id="trace_api_search_created_at_inside",
    )

    connection = create_connection(test_db_path)

    try:
        timestamps = [
            (
                "2026-08-20T04:00:00+00:00",
                outside_saved.alert_id,
            ),
            (
                "2026-08-20T05:00:00+00:00",
                inside_saved.alert_id,
            ),
        ]

        for created_at, alert_id in timestamps:
            connection.execute(
                """
                UPDATE alerts
                SET created_at = ?
                WHERE alert_id = ?
                """,
                (
                    created_at,
                    alert_id,
                ),
            )

        connection.commit()

    finally:
        connection.close()

    response = client.get("/alerts", params={"created_from": "2026-08-20T14:00:00+09:00", "created_to": "2026-08-20T15:00:00+09:00"})

    body = response.json()

    assert response.status_code == 200
    assert body["count"] == 1
    assert body["limit"] == 5
    assert len(body["alerts"]) == 1

    result = body["alerts"][0]

    assert result["alert_id"] == inside_saved.alert_id
    assert result["trace_id"] == "trace_api_search_created_at_inside"

def test_get_search_alerts_rejects_invalid_limit():
    for invalid_limit in (0, 101, "abc"):
        response = client.get(f"/alerts?limit={invalid_limit}")

        body = response.json()

        assert response.status_code == 422
        assert body["error_type"] == "api_validation_error"
        assert body["trace_id"] == response.headers["x-trace-id"]
        assert body["details"]

def test_get_alerts_rejects_invalid_level(test_db_path):
    response = client.get("/alerts?level=UNKNOWN")

    body = response.json()

    assert response.status_code == 422
    assert response.headers["x-trace-id"]
    assert body["error_type"] == "api_validation_error"

def test_get_alerts_rejects_invalid_human_required(test_db_path):
    response = client.get("/alerts?human_required=UNKNOWN")
    body = response.json()

    assert response.status_code == 422
    assert response.headers["x-trace-id"]
    assert body["error_type"] == "api_validation_error"

def test_get_alerts_rejects_datetime_without_timezone(test_db_path):
    for field_name in ("created_from", "created_to"):
        response = client.get("/alerts",  params={field_name: "2026-08-20T05:00:00"})

        body = response.json()

        assert response.status_code == 422
        assert body["error_type"] == "api_validation_error"
        assert body["trace_id"] == response.headers["x-trace-id"]
        assert body["details"]

def test_get_alerts_rejects_invalid_created_at_range(test_db_path):
    invalid_ranges = [
        (
            "2026-08-20T05:00:00Z",
            "2026-08-20T05:00:00Z",
        ),
        (
            "2026-08-20T06:00:00Z",
            "2026-08-20T05:00:00Z",
        ),
    ]

    for created_from, created_to in invalid_ranges:
        response = client.get("/alerts", params={"created_from": created_from, "created_to": created_to})

        body = response.json()

        assert response.status_code == 422
        assert body["error_type"] == "api_validation_error"
        assert body["trace_id"] == response.headers["x-trace-id"]
        assert any("created_from must be earlier than created_to" in detail["msg"] for detail in body["details"])

def test_get_alerts_rejects_partial_cursor(test_db_path):
    invalid_params = [
        {
            "cursor_created_at": "2026-08-20T05:00:00Z",
        },
        {
            "cursor_alert_id": 4,
        },
    ]

    for params in invalid_params:
        response = client.get("/alerts", params=params)

        body = response.json()

        assert response.status_code == 422
        assert body["error_type"] == "api_validation_error"
        assert body["trace_id"] == response.headers["x-trace-id"]
        assert any(
            "cursor_created_at and cursor_alert_id must be provided together" in detail["msg"] for detail in body["details"]
        )

def test_get_alerts_rejects_cursor_datetime_without_timezone(
    test_db_path,
):
    response = client.get(
        "/alerts",
        params={
            "cursor_created_at": "2026-08-20T05:00:00",
            "cursor_alert_id": 1,
        },
    )

    body = response.json()

    assert response.status_code == 422
    assert body["error_type"] == "api_validation_error"
    assert body["trace_id"] == response.headers["x-trace-id"]
    assert any(
        "timezone" in detail["msg"].lower()
        for detail in body["details"]
    )

def test_get_alerts_rejects_non_positive_cursor_alert_id(test_db_path):
    for invalid_cursor_alert_id in (0, -1):
        response = client.get(
            "/alerts",
            params={
                "cursor_created_at": "2026-08-20T05:00:00Z",
                "cursor_alert_id": invalid_cursor_alert_id
            }
        )

        body = response.json()

        assert response.status_code == 422
        assert body["error_type"] == "api_validation_error"
        assert body["trace_id"] == response.headers["x-trace-id"]
        assert any(
            "greater than 0" in detail["msg"] for detail in body["details"]
        )

def test_get_alerts_accepts_complete_cursor(test_db_path):
    response = client.get(
        "/alerts",
        params={
            "cursor_created_at": "2026-08-20T05:00:00Z",
            "cursor_alert_id": 1,
        },
    )

    body = response.json()

    assert response.status_code == 200
    assert body["count"] == 0
    assert body["alerts"] == []

def test_get_alerts_paginates(test_db_path):
    repository = AlertRepository(test_db_path)

    event = DecisionEvent(
        event_id="event_api_cursor_pagination",
        decision_type="approve",
        confidence=0.95,
        latency_ms=300,
        model_version="v1",
        error_code=None,
        metadata={
            "source": "api_cursor_pagination_test",
        },
    )

    alert = evaluate_event(event)

    saved_alerts = [
        repository.save(
            alert=alert,
            trace_id=f"trace_api_cursor_{number}",
        )
        for number in range(5)
    ]

    connection = create_connection(test_db_path)

    try:
        timestamps = [
            (
                "2026-08-20T06:00:00+00:00",
                saved_alerts[0].alert_id,
            ),
            (
                "2026-08-20T05:00:00+00:00",
                saved_alerts[1].alert_id,
            ),
            (
                "2026-08-20T05:00:00+00:00",
                saved_alerts[2].alert_id,
            ),
            (
                "2026-08-20T04:00:00+00:00",
                saved_alerts[3].alert_id,
            ),
            (
                "2026-08-20T03:00:00+00:00",
                saved_alerts[4].alert_id,
            ),
        ]

        for created_at, alert_id in timestamps:
            connection.execute(
                """
                UPDATE alerts
                SET created_at = ?
                WHERE alert_id = ?
                """,
                (created_at, alert_id)
            )
        connection.commit()

    finally:
        connection.close()

    first_response = client.get("/alerts", params={"limit": 2})

    first_body = first_response.json()
    first_ids = [result["alert_id"] for result in first_body["alerts"]]

    assert first_response.status_code == 200
    assert first_body["count"] == 2
    assert first_body["limit"] == 2
    assert first_ids == [saved_alerts[0].alert_id, saved_alerts[2].alert_id]

    first_cursor = first_body["next_cursor"]

    assert first_cursor is not None
    assert first_cursor["alert_id"] == saved_alerts[2].alert_id
    assert datetime.fromisoformat(first_cursor["created_at"]) == datetime.fromisoformat("2026-08-20T05:00:00+00:00")

    second_response = client.get(
        "/alerts",
        params={
            "limit": 2,
            "cursor_created_at": first_cursor["created_at"],
            "cursor_alert_id": first_cursor["alert_id"],
        },
    )

    second_body = second_response.json()
    second_ids = [result["alert_id"] for result in second_body["alerts"]]

    assert second_response.status_code == 200
    assert second_body["count"] == 2
    assert second_body["limit"] == 2
    assert second_ids == [saved_alerts[1].alert_id, saved_alerts[3].alert_id]

    second_cursor = second_body["next_cursor"]

    assert second_cursor is not None
    assert second_cursor["alert_id"] == saved_alerts[3].alert_id
    assert datetime.fromisoformat(second_cursor["created_at"]) == datetime.fromisoformat("2026-08-20T04:00:00+00:00")

    third_response = client.get(
        "/alerts",
        params={
            "limit": 2,
            "cursor_created_at": second_cursor["created_at"],
            "cursor_alert_id": second_cursor["alert_id"],
        },
    )

    third_body = third_response.json()
    third_ids = [result["alert_id"] for result in third_body["alerts"]]

    assert third_response.status_code == 200
    assert third_body["count"] == 1
    assert third_body["limit"] == 2
    assert third_ids == [saved_alerts[4].alert_id]
    assert third_body["next_cursor"] is None

def test_get_alerts_requests_lookahead_row_at_maximum_limit(test_db_path, monkeypatch):
    received_limits = []

    def fake_search(self, limit, **kwargs):
        received_limits.append(limit)
        return []

    monkeypatch.setattr(AlertRepository, "search", fake_search)

    response = client.get("/alerts", params={"limit": 100})

    body = response.json()

    assert response.status_code == 200
    assert received_limits == [101]
    assert body["count"] == 0
    assert body["limit"] == 100
    assert body["alerts"] == []
    assert body["next_cursor"] is None

def test_get_alerts_returns_no_cursor_when_page_is_exactly_full(test_db_path):
    repository = AlertRepository(test_db_path)

    event = DecisionEvent(
        event_id="event_api_exact_page",
        decision_type="approve",
        confidence=0.95,
        latency_ms=300,
        model_version="v1",
        error_code=None,
        metadata={
            "source": "api_exact_page_test",
        },
    )

    alert = evaluate_event(event)

    saved_alerts = [
        repository.save(
            alert=alert,
            trace_id=f"trace_api_exact_page_{number}",
        )
        for number in range(2)
    ]

    response = client.get("/alerts", params={"limit": 2})

    body = response.json()

    assert response.status_code == 200
    assert body["count"] == 2
    assert body["limit"] == 2
    assert len(body["alerts"]) == 2
    assert body["next_cursor"] is None

    result_ids = {result["alert_id"] for result in body["alerts"]}

    assert result_ids == {saved_alerts[0].alert_id, saved_alerts[1].alert_id}