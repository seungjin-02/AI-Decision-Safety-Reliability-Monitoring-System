import sqlite3
import json

from typing import Any, Literal
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from app.db.connection import create_connection
from core.step05_SignalGeneration import Signal
from core.step09_AlertOutput import AlertOutput

PersistenceOutcome = Literal[
    "not_attempted",
    "committed",
    "rolled_back",
    "unknown",
]

class PersistenceError(Exception):
    def __init__(self, message: str, persistence_outcome: PersistenceOutcome) -> None:
        super().__init__(message)
        self.persistence_outcome = persistence_outcome

@dataclass(frozen=True)
class SavedAlert:
    alert_id: int
    created_at: str

@dataclass(frozen=True)
class AlertDetail:
    alert_id: int
    trace_id: str
    created_at: str
    event_id: str
    level: str
    risk_score: int
    uncertainty_score: int
    human_required: bool
    recommended_actions: list[str]
    reason_summary: str
    signals: list[Signal]
    metadata: dict[str, Any]

class AlertRepository:
    def __init__(self, db_path: str | Path) -> None:
        self.db_path = db_path

    def _open_connection(self) -> sqlite3.Connection:
        try:
            return create_connection(self.db_path)

        except sqlite3.Error as exc:
            raise PersistenceError(
                "Failed to open database connection",
                persistence_outcome="not_attempted",
            ) from exc

    def save(self, alert: AlertOutput, trace_id: str) -> SavedAlert:
        if not trace_id.strip():
            raise ValueError("trace_id must not be blank")

        created_at = datetime.now(timezone.utc).isoformat()
        connection = self._open_connection()

        try:
            cursor = connection.execute(
                """
                INSERT INTO alerts (
                    trace_id,
                    event_id,
                    level,
                    risk_score,
                    uncertainty_score,
                    human_required,
                    reason_summary,
                    metadata,
                    created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    trace_id,
                    alert.event_id,
                    alert.level,
                    alert.risk_score,
                    alert.uncertainty_score,
                    int(alert.human_required),
                    alert.reason_summary,
                    json.dumps(
                        alert.metadata,
                        ensure_ascii=False,
                        sort_keys=True,
                    ),
                    created_at,
                ),
            )

            alert_id = cursor.lastrowid

            if alert_id is None:
                raise RuntimeError("Failed to create alert_id")

            for signal in alert.signals:
                connection.execute(
                    """
                    INSERT INTO alert_signals (
                        alert_id,
                        rule_id,
                        category,
                        score,
                        reason,
                        evidence,
                        is_critical_override,
                        metadata
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        alert_id,
                        signal.rule_id,
                        signal.category,
                        signal.score,
                        signal.reason,
                        json.dumps(
                            signal.evidence,
                            ensure_ascii=False,
                            sort_keys=True,
                        ),
                        int(signal.is_critical_override),
                        json.dumps(
                            signal.metadata,
                            ensure_ascii=False,
                            sort_keys=True,
                        ),
                    ),
                )

            for action_order, action_code in enumerate(alert.recommended_actions):
                connection.execute(
                    """
                    INSERT INTO alert_actions (
                        alert_id,
                        action_code,
                        action_order
                    )
                    VALUES (?, ?, ?)
                    """,
                    (
                        alert_id,
                        action_code,
                        action_order,
                    ),
                )

            saved_alert = SavedAlert(
                alert_id=alert_id,
                created_at=created_at,
            )

            connection.commit()

            return saved_alert

        except Exception as exc:
            try:
                connection.rollback()
            except Exception as rollback_exc:
                raise PersistenceError(
                    "Failed to save alert and rollback outcome is unknown",
                    persistence_outcome="unknown",
                ) from rollback_exc

            raise PersistenceError(
                "Failed to save alert",
                persistence_outcome="rolled_back",
            ) from exc

        finally:
            connection.close()

    def find_by_id(self, alert_id: int) -> AlertDetail | None:
        connection = self._open_connection()

        try:
            alert_row = connection.execute(
                """
                SELECT
                    alert_id,
                    trace_id,
                    event_id,
                    level,
                    risk_score,
                    uncertainty_score,
                    human_required,
                    reason_summary,
                    metadata,
                    created_at
                FROM alerts
                WHERE alert_id = ?
                """,
                (alert_id,),
            ).fetchone()

            if alert_row is None:
                return None

            signal_rows = connection.execute(
                """
                SELECT
                    rule_id,
                    category,
                    score,
                    reason,
                    evidence,
                    is_critical_override,
                    metadata
                FROM alert_signals
                WHERE alert_id = ?
                ORDER BY signal_id
                """,
                (alert_id,),
            ).fetchall()

            signals = [
                Signal(
                    rule_id=signal_row["rule_id"],
                    category=signal_row["category"],
                    score=signal_row["score"],
                    reason=signal_row["reason"],
                    evidence=json.loads(signal_row["evidence"]),
                    is_critical_override=bool(
                        signal_row["is_critical_override"]
                    ),
                    metadata=json.loads(signal_row["metadata"]),
                )
                for signal_row in signal_rows
            ]

            action_rows = connection.execute(
            """
            SELECT action_code
            FROM alert_actions
            WHERE alert_id = ?
            ORDER BY action_order
            """,
            (alert_id,),
            ).fetchall()

            recommended_actions = [
                action_row["action_code"] for action_row in action_rows
            ]

            return AlertDetail(
                alert_id=alert_row["alert_id"],
                trace_id=alert_row["trace_id"],
                created_at=alert_row["created_at"],
                event_id=alert_row["event_id"],
                level=alert_row["level"],
                risk_score=alert_row["risk_score"],
                uncertainty_score=alert_row["uncertainty_score"],
                human_required=bool(
                    alert_row["human_required"]
                ),
                recommended_actions=recommended_actions,
                reason_summary=alert_row["reason_summary"],
                signals=signals,
                metadata=json.loads(alert_row["metadata"]),
            )

        except (sqlite3.Error, json.JSONDecodeError) as exc:
            raise PersistenceError("Failed to find alert by id") from exc

        finally:
            connection.close()

    def search(
            self,
            limit: int,
            level: str | None = None,
            human_required: bool | None = None,
            created_from: datetime | None = None,
            created_to: datetime | None = None,
            cursor_created_at: datetime | None = None,
            cursor_alert_id: int | None = None
    ) -> list[AlertDetail]:

        if not 1 <= limit <= 101:
            raise ValueError("limit must be between 1 and 101")

        if level is not None and level not in {"INFO", "WARN", "CRITICAL"}:
            raise ValueError("level must be INFO, WARN, CRITICAL")

        if (cursor_created_at is None) != (cursor_alert_id is None):
            raise ValueError(
                "cursor_created_at and cursor_alert_id must be provided together"
            )

        if cursor_created_at is not None and (cursor_created_at.tzinfo is None or cursor_created_at.utcoffset() is None):
            raise ValueError(
                "cursor_created_at must include timezone"
            )

        if cursor_alert_id is not None and cursor_alert_id <= 0:
            raise ValueError(
                "cursor_alert_id must be greater than 0"
            )

        for value in (created_from, created_to):
            if value is not None and (value.tzinfo is None or value.utcoffset() is None): # 시간대 정보 x or 시간대 계산 x인 경우
                raise ValueError("created_from and created_to must include timezone")

        if created_from is not None and created_to is not None and created_from >= created_to:
            raise ValueError("created_from must be earlier than created_to")

        # TEXT로 받은 시간대 -> UTC기준으로 변환 -> 문자열 변환(isoformat())
        created_from_utc = (
            created_from.astimezone(timezone.utc).isoformat()
            if created_from is not None else None
        )

        created_to_utc = (
            created_to.astimezone(timezone.utc).isoformat()
            if created_to is not None else None
        )

        cursor_created_at_utc = (
            cursor_created_at.astimezone(timezone.utc).isoformat()
            if cursor_created_at is not None else None
        )

        conditions: list[str] = []
        values: list[Any] = []

        if level is not None:
            conditions.append("level = ?")
            values.append(level)

        if human_required is not None:
            conditions.append("human_required = ?")
            values.append(int(human_required))

        if created_from_utc is not None:
            conditions.append("created_at >= ?")
            values.append(created_from_utc)

        if created_to_utc is not None:
            conditions.append("created_at < ?")
            values.append(created_to_utc)

        if cursor_created_at_utc is not None and cursor_alert_id is not None:
            conditions.append(
                """
                (
                    created_at < ? OR (created_at = ? AND alert_id < ?)
                )
                """
            )

            values.extend(
                [
                    cursor_created_at_utc,
                    cursor_created_at_utc,
                    cursor_alert_id,
                ]
            )

        where_clause = ""

        if conditions:
            where_clause = ("WHERE " + " AND ".join(conditions))

        values.append(limit)

        connection = self._open_connection()

        try:
            alert_rows = connection.execute(
                f"""
                SELECT
                    alert_id,
                    trace_id,
                    event_id,
                    level,
                    risk_score,
                    uncertainty_score,
                    human_required,
                    reason_summary,
                    metadata,
                    created_at
                FROM alerts
                {where_clause}
                ORDER BY created_at DESC, alert_id DESC
                LIMIT ?
                """,
                values,
            ).fetchall()

            if not alert_rows:
                return []

            alert_ids = [alert_row["alert_id"] for alert_row in alert_rows]

            placeholders = ", ".join("?" for _ in alert_ids)

            signal_rows = connection.execute(
                f"""
                SELECT
                    alert_id,
                    rule_id,
                    category,
                    score,
                    reason,
                    evidence,
                    is_critical_override,
                    metadata
                FROM alert_signals
                WHERE alert_id IN ({placeholders})
                ORDER BY alert_id, signal_id
                """,
                alert_ids,
            ).fetchall()

            signals_by_alert_id: dict[int, list[Signal]] = {
                alert_id: [] for alert_id in alert_ids
            }

            for signal_row in signal_rows:
                signal = Signal(
                    rule_id=signal_row["rule_id"],
                    category=signal_row["category"],
                    score=signal_row["score"],
                    reason=signal_row["reason"],
                    evidence=json.loads(signal_row["evidence"]),
                    is_critical_override=bool(signal_row["is_critical_override"]),
                    metadata=json.loads(signal_row["metadata"])
                )

                signals_by_alert_id[signal_row["alert_id"]].append(signal)

            action_rows = connection.execute(
                f"""
                SELECT
                    alert_id,
                    action_code
                FROM alert_actions
                WHERE alert_id IN ({placeholders})
                ORDER BY alert_id, action_order
                """,
                alert_ids,
            ).fetchall()

            actions_by_alert_id: dict[int, list[str]] = {
                alert_id: [] for alert_id in alert_ids
            }

            for action_row in action_rows:
                actions_by_alert_id[action_row["alert_id"]].append(action_row["action_code"])

            alert_details: list[AlertDetail] = []

            for alert_row in alert_rows:
                alert_id = alert_row["alert_id"]

                detail = AlertDetail(
                    alert_id=alert_id,
                    trace_id=alert_row["trace_id"],
                    created_at=alert_row["created_at"],
                    event_id=alert_row["event_id"],
                    level=alert_row["level"],
                    risk_score=alert_row["risk_score"],
                    uncertainty_score=alert_row["uncertainty_score"],
                    human_required=bool(alert_row["human_required"]),
                    recommended_actions=actions_by_alert_id[alert_id],
                    reason_summary=alert_row["reason_summary"],
                    signals=signals_by_alert_id[alert_id],
                    metadata=json.loads(alert_row["metadata"])
                )

                alert_details.append(detail)

            return alert_details

        except (sqlite3.Error, json.JSONDecodeError) as exc:
            raise PersistenceError("Failed to search alerts") from exc

        finally:
            connection.close()

