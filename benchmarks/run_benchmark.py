import json
import sqlite3

from collections import Counter
from time import perf_counter
from pathlib import Path
from tempfile import TemporaryDirectory
from fastapi.testclient import TestClient

from app.main import app, get_alert_repository
from app.db.alert_repository import AlertRepository
from app.db.connection import init_db
from app.utils.structured_logging import request_logger

from benchmarks.generate_workload import MANIFEST_PATH, WORKLOAD_PATH, calculate_file_sha256

from logging.handlers import BufferingHandler

def load_verified_workload(workload_path: Path = WORKLOAD_PATH, manifest_path: Path = MANIFEST_PATH) -> tuple[list[dict], dict]:
    manifest = json.loads(
        manifest_path.read_text(encoding="utf-8")
    )

    expected_sha256 = manifest["workload_sha256"]
    actual_sha256 = calculate_file_sha256(workload_path)

    if actual_sha256 != expected_sha256:
        raise ValueError(
            "Workload SHA-256 does not match manifest"
        )

    workload = []

    with workload_path.open(
        "r",
        encoding="utf-8",
    ) as file:
        for line in file:
            record = json.loads(line)
            workload.append(record)

    expected_total = manifest["total_requests"]
    actual_total = len(workload)

    if actual_total != expected_total:
        raise ValueError(
            "Workload request count does not match manifest"
        )

    return workload, manifest

def select_warmup_records(workload: list[dict]) -> list[dict]:
    selected = []
    counts = {}

    for record in workload:
        scenario = record["scenario"]
        current_count = counts.get(scenario, 0)

        if current_count >= 10:
            continue

        selected.append(record)
        counts[scenario] = current_count + 1

        if len(selected) == 100:
            break

    if len(selected) != 100 or len(counts) != 10:
        raise ValueError("Warm-up requires 10 records from each scenario")

    return selected

def run_warmup(workload: list[dict]) -> None:
    warmup_records = select_warmup_records(workload)

    with TemporaryDirectory() as temporary_directory:
        warmup_db_path = Path(temporary_directory) / "warmup.db"
        init_db(warmup_db_path)

        # 기존 콘솔 출력 handler를 기억하고 메모리 handler로 교체
        original_handlers = list(request_logger.handlers)
        memory_handler = BufferingHandler(capacity=5000)

        for handler in original_handlers:
            request_logger.removeHandler(handler)

        request_logger.addHandler(memory_handler)

        # /evaluate가 warm-up DB를 사용하도록 임시 변경
        app.dependency_overrides[get_alert_repository] = (
            lambda: AlertRepository(warmup_db_path)
        )

        client = None

        try:
            client = TestClient(app)

            for record in warmup_records:
                response = client.post("/evaluate", json=record["payload"])

                if response.status_code != 201:
                    raise RuntimeError(
                        f"Warm-up failed: "
                        f"scenario={record['scenario']}, "
                        f"status={response.status_code}"
                    )

            if len(memory_handler.buffer) != 100:
                raise RuntimeError("Warm-up must produce exactly 100 request logs")

        finally:
            if client is not None:
                client.close()

            app.dependency_overrides.pop(get_alert_repository, None)

            request_logger.removeHandler(memory_handler)

            for handler in original_handlers:
                request_logger.addHandler(handler)

            memory_handler.close()

    print("warm-up passed: 100 requests, 100 request logs")

def run_measurement_once(workload: list[dict], db_path: Path) -> list[dict]:
    if db_path.exists():
        raise FileExistsError(f"Measurement DB already exists: {db_path}")

    db_path.parent.mkdir(parents=True, exist_ok=True)
    init_db(db_path)

    original_handlers = list(request_logger.handlers)
    memory_handler = BufferingHandler(capacity=len(workload) + 1)

    for handler in original_handlers:
        request_logger.removeHandler(handler)

    request_logger.addHandler(memory_handler)

    app.dependency_overrides[get_alert_repository] = (
        lambda: AlertRepository(db_path)
    )

    client = None
    results = []

    try:
        client = TestClient(app)

        for sequence, record in enumerate(workload, start=1):
            previous_log_count = len(memory_handler.buffer)

            started_at = perf_counter()
            response = client.post("/evaluate", json=record["payload"])
            client_duration_ms = (perf_counter() - started_at) * 1000

            if len(memory_handler.buffer) != previous_log_count + 1:
                raise RuntimeError(f"Request {sequence} did not produce exactly one log")

            request_log = json.loads(
                memory_handler.buffer[-1].getMessage()
            )

            if response.status_code != 201:
                raise RuntimeError(
                    f"Request {sequence} failed: "
                    f"scenario={record['scenario']}, "
                    f"status={response.status_code}"
                )

            body = response.json()
            trace_id = response.headers.get("x-trace-id")

            if not (
                    trace_id
                    and trace_id == body["trace_id"]
                    and trace_id == request_log["trace_id"]
                    and body["event_id"] == record["payload"]["event_id"]
                    and request_log["event"] == "request_completed"
                    and request_log["status_code"] == 201
                    and request_log["result"] == "success"
                    and request_log["failure_stage"] is None
                    and request_log["persistence_outcome"] == "committed"
            ):
                raise RuntimeError(
                    f"Response/log mismatch at request {sequence}"
                )

            results.append(
                {
                    "sequence": sequence,
                    "scenario": record["scenario"],
                    "event_id": record["payload"]["event_id"],
                    "status_code": response.status_code,
                    "trace_id": trace_id,
                    "level": body["level"],
                    "human_required": body["human_required"],
                    "signal_count": len(body["signals"]),
                    "action_count": len(body["recommended_actions"]),
                    "client_duration_ms": client_duration_ms,
                    "middleware_duration_ms": request_log["duration_ms"],
                }
            )

        return results

    finally:
        if client is not None:
            client.close()

        app.dependency_overrides.pop(get_alert_repository, None)

        request_logger.removeHandler(memory_handler)

        for handler in original_handlers:
            request_logger.addHandler(handler)

        memory_handler.close()

def verify_db_counts(db_path: Path) -> dict[str, int]:
    if not db_path.is_file():
        raise FileNotFoundError(db_path)

    connection = sqlite3.connect(db_path)

    try:
        actual_counts = {
            "alerts": connection.execute(
                "SELECT COUNT(*) FROM alerts"
            ).fetchone()[0],
            "alert_signals": connection.execute(
                "SELECT COUNT(*) FROM alert_signals"
            ).fetchone()[0],
            "alert_actions": connection.execute(
                "SELECT COUNT(*) FROM alert_actions"
            ).fetchone()[0],
        }
    finally:
        connection.close()

    expected_counts = {
        "alerts": 1000,
        "alert_signals": 1000,
        "alert_actions": 1700,
    }

    if actual_counts != expected_counts:
        raise RuntimeError(
            f"DB row counts differ: "
            f"expected={expected_counts}, "
            f"actual={actual_counts}"
        )

    return actual_counts

def verify_measurement(results: list[dict], manifest: dict, db_path: Path) -> None:
    expected_total = manifest["total_requests"]

    if len(results) != expected_total:
        raise RuntimeError("Measured request count differs from manifest")

    trace_ids = [result["trace_id"] for result in results]

    if len(set(trace_ids)) != expected_total:
        raise RuntimeError("Trace IDs are not unique")

    for result in results:
        if result["client_duration_ms"] <= 0 or result["middleware_duration_ms"] < 0:
            raise RuntimeError(f"Invalid duration at request {result['sequence']}")

    scenario_counts = dict(Counter(result["scenario"] for result in results))
    level_counts = dict(Counter(result["level"] for result in results))

    if scenario_counts != manifest["scenario_counts"]:
        raise RuntimeError("Scenario distribution differs from manifest")

    if level_counts != manifest["expected_level_distribution"]:
        raise RuntimeError("Level distribution differs from manifest")

    if sum(result["human_required"] for result in results) != 300:
        raise RuntimeError("human_required count differs from contract")

    if sum(result["signal_count"] for result in results) != 1000:
        raise RuntimeError("Signal count differs from contract")

    if sum(result["action_count"] for result in results) != 1700:
        raise RuntimeError("Action count differs from contract")

    connection = sqlite3.connect(db_path)

    try:
        db_rows = connection.execute(
            "SELECT event_id, trace_id FROM alerts"
        ).fetchall()
    finally:
        connection.close()

    db_trace_by_event = {
        event_id: trace_id for event_id, trace_id in db_rows
    }

    if len(db_trace_by_event) != expected_total:
        raise RuntimeError("Duplicate event_id in DB")

    for result in results:
        event_id = result["event_id"]

        if db_trace_by_event.get(event_id) != result["trace_id"]:
            raise RuntimeError(
                f"DB trace mismatch at request {result['sequence']}"
            )


RESULTS_DIR = Path(__file__).resolve().parent / "results"

def save_results_jsonl(results: list[dict], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with output_path.open(
        "x",
        encoding="utf-8",
        newline="\n",
    ) as file:
        for result in results:
            file.write(
                json.dumps(
                    result,
                    ensure_ascii=False,
                    sort_keys=True,
                ) + "\n"
            )

def run_one_validated_measurement(workload: list[dict], manifest: dict, db_path: Path, results_path: Path) -> int:
    if db_path.exists() or results_path.exists():
        raise FileExistsError(f"Measurement output already exists: {db_path}, {results_path}")

    # 측정 -> 검증 -> 저장
    results = run_measurement_once(workload, db_path)

    verify_db_counts(db_path)
    verify_measurement(results, manifest, db_path)

    save_results_jsonl(results, results_path)


if __name__ == "__main__":
    workload, manifest = load_verified_workload()

    run_paths = []

    # 기존 파일 있는지 확인
    for run_number in range(1, 4):
        db_path = RESULTS_DIR / f"run_{run_number:02d}.db"
        results_path = RESULTS_DIR / f"run_{run_number:02d}.jsonl"

        if db_path.exists() or results_path.exists():
            raise FileExistsError(f"Run {run_number} output already exists")

        run_paths.append((run_number, db_path, results_path))

    run_warmup(workload)

    for run_number, db_path, results_path in run_paths:
        run_one_validated_measurement(
            workload=workload,
            manifest=manifest,
            db_path=db_path,
            results_path=results_path,
        )

        print(f"run_{run_number:02d} verified and saved")

    print("all 3 measurement runs completed")
