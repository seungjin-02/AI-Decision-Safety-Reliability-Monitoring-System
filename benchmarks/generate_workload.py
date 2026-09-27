import hashlib
import json
import random
from pathlib import Path

SEED = 20260921
REQUESTS_PER_SCENARIO = 100

DATASET_VERSION = "v1"
WORKLOAD_PATH = (Path(__file__).parent / "data" / "workload_v1.jsonl")
MANIFEST_PATH = (Path(__file__).parent / "data" / "workload_v1.manifest.json")

BASE_PAYLOAD = {
    "decision_type": "approve",
    "confidence": 0.9,
    "latency_ms": 300,
    "model_version": "benchmark-v1",
    "error_code": None,
    "metadata": {},
}

SCENARIOS = [
    {
        "name": "normal_approve",
        "overrides": {},
        "expected": {
            "level": "INFO",
            "human_required": False,
            "signal_count": 0,
            "action_count": 1,
        },
    },
    {
        "name": "normal_reject",
        "overrides": {
            "decision_type": "reject",
        },
        "expected": {
            "level": "INFO",
            "human_required": False,
            "signal_count": 0,
            "action_count": 1,
        },
    },
    {
        "name": "reject_low_confidence",
        "overrides": {
            "decision_type": "reject",
            "confidence": 0.5,
        },
        "expected": {
            "level": "INFO",
            "human_required": False,
            "signal_count": 0,
            "action_count": 1,
        },
    },
    {
        "name": "approve_low_confidence",
        "overrides": {
            "confidence": 0.5,
        },
        "expected": {
            "level": "WARN",
            "human_required": False,
            "signal_count": 1,
            "action_count": 1,
        },
    },
    {
        "name": "high_latency",
        "overrides": {
            "latency_ms": 2500,
        },
        "expected": {
            "level": "WARN",
            "human_required": False,
            "signal_count": 1,
            "action_count": 1,
        },
    },
    {
        "name": "missing_confidence",
        "overrides": {
            "confidence": None,
        },
        "expected": {
            "level": "INFO",
            "human_required": False,
            "signal_count": 1,
            "action_count": 2,
        },
    },
    {
        "name": "missing_model_version",
        "overrides": {
            "model_version": None,
        },
        "expected": {
            "level": "INFO",
            "human_required": False,
            "signal_count": 1,
            "action_count": 2,
        },
    },
    {
        "name": "high_risk",
        "overrides": {
            "confidence": 0.5,
            "latency_ms": 2500,
        },
        "expected": {
            "level": "CRITICAL",
            "human_required": True,
            "signal_count": 2,
            "action_count": 2,
        },
    },
    {
        "name": "high_risk_with_uncertainty",
        "overrides": {
            "confidence": 0.5,
            "latency_ms": 2500,
            "model_version": None,
        },
        "expected": {
            "level": "WARN",
            "human_required": True,
            "signal_count": 3,
            "action_count": 3,
        },
    },
    {
        "name": "integrity_override",
        "overrides": {
            "error_code": "gateway_failure",
        },
        "expected": {
            "level": "CRITICAL",
            "human_required": True,
            "signal_count": 1,
            "action_count": 3,
        },
    },
]

def build_workload(seed=SEED):
    workload = []

    for scenario in SCENARIOS:
        for sequence in range(1, REQUESTS_PER_SCENARIO + 1):
            payload = {
                **BASE_PAYLOAD,
                "event_id": (
                    f"benchmark_{scenario['name']}_{sequence:04d}"
                ),
                "metadata": {},
            }

            payload.update(scenario["overrides"])

            workload.append(
                {
                    "scenario": scenario["name"],
                    "payload": payload,
                }
            )

    random_generator = random.Random(seed)
    random_generator.shuffle(workload)

    return workload

# Python 리스트를 JSONL 형식의 bytes로 변환
def write_workload_jsonl(workload: list[dict], output_path: Path = WORKLOAD_PATH) -> None:
    output_path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    with output_path.open(
        "w",
        encoding="utf-8",
        newline="\n",
    ) as file:
        for record in workload:
            json_line = json.dumps(
                record,
                ensure_ascii=False,
                sort_keys=True,
            )
            file.write(json_line + "\n")

def calculate_file_sha256(file_path: Path) -> str:
    file_content = file_path.read_bytes()

    return hashlib.sha256(file_content).hexdigest()

def write_workload_manifest(workload: list[dict], workload_path: Path = WORKLOAD_PATH, manifest_path: Path = MANIFEST_PATH) -> None:
    scenario_counts = {}

    for record in workload:
        scenario_name = record["scenario"]

        if scenario_name not in scenario_counts:
            scenario_counts[scenario_name] = 0

        scenario_counts[scenario_name] += 1

    expected_level_distribution = {}

    for scenario in SCENARIOS:
        level = scenario["expected"]["level"]

        if level not in expected_level_distribution:
            expected_level_distribution[level] = 0

        expected_level_distribution[level] += REQUESTS_PER_SCENARIO

    manifest = {
        "dataset_version": DATASET_VERSION,
        "expected_level_distribution": expected_level_distribution,
        "scenario_counts": scenario_counts,
        "seed": SEED,
        "total_requests": len(workload),
        "workload_file": workload_path.name,
        "workload_sha256": calculate_file_sha256(workload_path),
    }

    manifest_path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    with manifest_path.open(
        "w",
        encoding="utf-8",
        newline="\n",
    ) as file:
        json.dump(
            manifest,
            file,
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
        file.write("\n")


if __name__ == "__main__":
    workload = build_workload()
    write_workload_jsonl(workload)
    write_workload_manifest(workload)
