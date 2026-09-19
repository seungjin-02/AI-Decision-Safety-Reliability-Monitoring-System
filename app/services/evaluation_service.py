from typing import Any
from dataclasses import dataclass

from app.db.alert_repository import AlertRepository, SavedAlert
from app.schemas import EvaluateRequest
from core.step01_DecisionEvent import DecisionEvent
from core.step05_SignalGeneration import Signal
from core.step09_AlertOutput import AlertOutput
from core.main import evaluate_event

class CoreValidationException(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message

@dataclass(frozen=True)
class EvaluationResult:
    alert: AlertOutput
    saved_alert: SavedAlert

def build_decision_event(payload: EvaluateRequest) -> DecisionEvent:
    return DecisionEvent(
        event_id=payload.event_id,
        decision_type=payload.decision_type,
        confidence=payload.confidence,
        latency_ms=payload.latency_ms,
        model_version=payload.model_version,
        error_code=payload.error_code,
        metadata=payload.metadata,
    )

def signal_to_response(signal: Signal) -> dict[str, Any]:
    return {
        "rule_id": signal.rule_id,
        "category": signal.category,
        "score": signal.score,
        "reason": signal.reason,
        "evidence": signal.evidence,
        "is_critical_override": signal.is_critical_override,
        "metadata": signal.metadata
    }

def alert_to_response(alert: AlertOutput, trace_id: str, saved_alert: SavedAlert) -> dict[str, Any]:
    return {
        "alert_id": saved_alert.alert_id,
        "created_at": saved_alert.created_at,
        "trace_id": trace_id,
        "event_id": alert.event_id,
        "level": alert.level,
        "risk_score": alert.risk_score,
        "uncertainty_score": alert.uncertainty_score,
        "human_required": alert.human_required,
        "recommended_actions": alert.recommended_actions,
        "reason_summary": alert.reason_summary,
        "signals": [signal_to_response(signal) for signal in alert.signals],
        "metadata": alert.metadata,
    }

def evaluate_request(payload: EvaluateRequest, trace_id: str, repository: AlertRepository) -> EvaluationResult:
    try:
        event = build_decision_event(payload)
        alert = evaluate_event(event)
    except ValueError as exc:
        raise CoreValidationException(str(exc)) from exc

    saved_alert = repository.save(alert=alert, trace_id=trace_id)

    return EvaluationResult(alert=alert, saved_alert=saved_alert)