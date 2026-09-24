import json

from benchmarks.generate_workload import REQUESTS_PER_SCENARIO, SCENARIOS, SEED, build_workload, write_workload_jsonl, calculate_file_sha256, write_workload_manifest

from app.schemas import EvaluateRequest

from core.main import evaluate_event
from core.step01_DecisionEvent import DecisionEvent

def test_workload_has_expected_request_count_and_scenario_distribution():
    workload = build_workload()

    assert len(workload) == 1000

    scenario_counts = {}

    for record in workload:
        scenario_name = record["scenario"]

        scenario_counts[scenario_name] = scenario_counts.get(scenario_name, 0) + 1

    assert len(scenario_counts) == 10

    for scenario in SCENARIOS:
        scenario_name = scenario["name"]

        assert scenario_counts[scenario_name] == REQUESTS_PER_SCENARIO

def test_workload_event_ids_are_unique():
    workload = build_workload()
    event_ids = []

    for record in workload:
        event_id = record["payload"]["event_id"]
        event_ids.append(event_id)

    assert len(event_ids) == 1000
    assert len(set(event_ids)) == 1000


def test_same_seed_produces_same_workload():
    first_workload = build_workload(seed=SEED)
    second_workload = build_workload(seed=SEED)

    assert first_workload == second_workload

def test_all_workload_payloads_match_api_schema():
    workload = build_workload()

    for record in workload:
        assert set(record.keys()) == {"scenario", "payload"}

        payload = record["payload"]

        validated_payload = EvaluateRequest.model_validate(payload)

        assert validated_payload.model_dump() == payload

def test_workload_input_distribution_matches_contract():
    workload = build_workload()

    decision_type_counts = {}
    confidence_counts = {}
    latency_counts = {}
    model_version_counts = {}
    error_code_counts = {}

    for record in workload:
        payload = record["payload"]

        decision_type = payload["decision_type"]
        confidence = payload["confidence"]
        latency_ms = payload["latency_ms"]
        model_version = payload["model_version"]
        error_code = payload["error_code"]

        decision_type_counts[decision_type] = (
            decision_type_counts.get(decision_type, 0) + 1
        )
        confidence_counts[confidence] = (
            confidence_counts.get(confidence, 0) + 1
        )
        latency_counts[latency_ms] = (
            latency_counts.get(latency_ms, 0) + 1
        )
        model_version_counts[model_version] = (
            model_version_counts.get(model_version, 0) + 1
        )
        error_code_counts[error_code] = (
            error_code_counts.get(error_code, 0) + 1
        )

        assert payload["metadata"] == {}

    assert decision_type_counts == {
        "approve": 800,
        "reject": 200,
    }
    assert confidence_counts == {
        0.9: 500,
        0.5: 400,
        None: 100,
    }
    assert latency_counts == {
        300: 700,
        2500: 300,
    }
    assert model_version_counts == {
        "benchmark-v1": 800,
        None: 200,
    }
    assert error_code_counts == {
        None: 900,
        "gateway_failure": 100,
    }

def test_workload_core_results_match_contract():
    workload = build_workload()

    expected_by_scenario = {}

    for scenario in SCENARIOS:
        expected_by_scenario[scenario["name"]] = scenario["expected"]

    level_counts = {}
    human_required_counts = {}
    total_signal_count = 0
    total_action_count = 0

    for record in workload:
        scenario_name = record["scenario"]
        payload = record["payload"]

        event = DecisionEvent(**payload)
        alert = evaluate_event(event)

        expected_result = expected_by_scenario[scenario_name]

        actual_result = {
            "level": alert.level,
            "human_required": alert.human_required,
            "signal_count": len(alert.signals),
            "action_count": len(alert.recommended_actions),
        }

        assert actual_result == expected_result, (
            f"scenario={scenario_name}, "
            f"event_id={payload['event_id']}"
        )

        level_counts[alert.level] = level_counts.get(alert.level, 0) + 1
        human_required_counts[alert.human_required] = human_required_counts.get(alert.human_required, 0) + 1

        total_signal_count += len(alert.signals)
        total_action_count += len(alert.recommended_actions)

    assert level_counts == {
        "INFO": 500,
        "WARN": 300,
        "CRITICAL": 200,
    }
    assert human_required_counts == {
        False: 700,
        True: 300,
    }
    assert total_signal_count == 1000
    assert total_action_count == 1700

def test_written_jsonl_matches_generated_workload(tmp_path):
    workload = build_workload()
    output_path = tmp_path / "workload.jsonl"

    write_workload_jsonl(workload, output_path)

    loaded_workload = []

    with output_path.open("r", encoding="utf-8") as file:
        for line in file:
            record = json.loads(line)
            loaded_workload.append(record)

    assert len(loaded_workload) == 1000
    assert loaded_workload == workload

def test_workload_sha256_detects_content_change(tmp_path):
    original_workload = build_workload()
    same_workload = build_workload()
    changed_workload = build_workload()

    changed_workload[0]["payload"]["latency_ms"] += 1

    original_path = tmp_path / "original.jsonl"
    same_path = tmp_path / "same.jsonl"
    changed_path = tmp_path / "changed.jsonl"

    write_workload_jsonl(
        original_workload,
        original_path,
    )
    write_workload_jsonl(
        same_workload,
        same_path,
    )
    write_workload_jsonl(
        changed_workload,
        changed_path,
    )

    original_hash = calculate_file_sha256(original_path)
    same_hash = calculate_file_sha256(same_path)
    changed_hash = calculate_file_sha256(changed_path)

    assert len(original_hash) == 64
    assert original_hash == same_hash
    assert original_hash != changed_hash

def test_manifest_matches_generated_workload(tmp_path):
    workload = build_workload()

    workload_path = tmp_path / "workload.jsonl"
    manifest_path = tmp_path / "manifest.json"

    write_workload_jsonl(
        workload,
        workload_path,
    )
    write_workload_manifest(
        workload,
        workload_path,
        manifest_path,
    )

    manifest = json.loads(
        manifest_path.read_text(encoding="utf-8")
    )

    assert manifest["dataset_version"] == "v1"
    assert manifest["seed"] == 20260921
    assert manifest["total_requests"] == 1000
    assert manifest["workload_file"] == "workload.jsonl"

    assert len(manifest["scenario_counts"]) == 10

    for scenario in SCENARIOS:
        scenario_name = scenario["name"]

        assert manifest["scenario_counts"][scenario_name] == 100

    assert manifest["expected_level_distribution"] == {
        "INFO": 500,
        "WARN": 300,
        "CRITICAL": 200,
    }

    assert len(manifest["workload_sha256"]) == 64
    assert manifest["workload_sha256"] == calculate_file_sha256(workload_path)

