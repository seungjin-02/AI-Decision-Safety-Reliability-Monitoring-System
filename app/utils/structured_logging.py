import json
import logging

from datetime import datetime, timezone

request_logger = logging.getLogger("app.request")
request_logger.setLevel(logging.INFO)
request_logger.propagate = False

if not request_logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    request_logger.addHandler(handler)

def log_request_completed(
    *,
    trace_id: str,
    method: str,
    path: str,
    status_code: int,
    duration_ms: float,
    failure_stage: str | None,
    persistence_outcome: str,
) -> None:
    log_level = logging.ERROR if status_code >= 500 else logging.INFO

    result = "success" if status_code < 400 else "failure"

    log_data = {
        "timestamp": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "level": logging.getLevelName(log_level),
        "event": "request_completed",
        "trace_id": trace_id,
        "method": method,
        "path": path,
        "status_code": status_code,
        "result": result,
        "duration_ms": round(duration_ms, 3),
        "failure_stage": failure_stage,
        "persistence_outcome": persistence_outcome,
    }

    request_logger.log(
        log_level,
        json.dumps(
            log_data,
            ensure_ascii=False,
            separators=(",", ":"),
        ),
    )