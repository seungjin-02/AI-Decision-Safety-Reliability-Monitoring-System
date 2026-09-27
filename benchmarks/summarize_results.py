import json
from math import ceil
from pathlib import Path
from statistics import fmean

RESULTS_DIR = Path(__file__).resolve().parent / "results"

# p50, p95, p99 계산 (계산 전 값이 정렬 되었는지 확인 필수)
def percentile(sorted_values, fraction):
    rank = ceil(fraction * len(sorted_values))
    return sorted_values[rank - 1] # 인덱스 기준이라 -1

for run_number in range(1, 4):
    path = RESULTS_DIR / f"run_{run_number:02d}.jsonl"

    with path.open(encoding="utf-8") as file:
        results = [json.loads(line) for line in file]

    if len(results) != 1000:
        raise RuntimeError(f"{path.name}: expected 1000 requests")

    durations = sorted(result["client_duration_ms"] for result in results)

    slowest = sorted(results, key=lambda result: result["client_duration_ms"], reverse=True)[:3]
    
    print("slowest_top3_results")
    for result in slowest:
        print(
            f"  sequence={result['sequence']}, "
            f"scenario={result['scenario']}, "
            f"client={result['client_duration_ms']:.2f}ms, "
            f"middleware={result['middleware_duration_ms']:.2f}ms"
        )
    print()

    print(
        f"{path.name}: "
        f"mean={fmean(durations):.2f}ms, "
        f"p50={percentile(durations, 0.50):.2f}ms, " # p50
        f"p95={percentile(durations, 0.95):.2f}ms, " # p95
        f"p99={percentile(durations, 0.99):.2f}ms, " # p99
        f"max={durations[-1]:.2f}ms"
    )
    print()

    print("결과 이후 분석을 위한 추가 확인")
    for sequence in (443, 444, 445):
        result = results[sequence - 1]

        print(
            f"{path.name} "
            f"sequence={result['sequence']} "
            f"scenario={result['scenario']} "
            f"event_id={result['event_id']} "
            f"client={result['client_duration_ms']:.2f}ms "
            f"middleware={result['middleware_duration_ms']:.2f}ms"
        )
    print()

    scenario_names = sorted({
        result["scenario"] for result in results
    })

    for scenario_name in scenario_names:
        scenario_durations = sorted(
            result["client_duration_ms"] for result in results if result["scenario"] == scenario_name
        )

        if len(scenario_durations) != 100:
            raise RuntimeError(
                f"{path.name}: {scenario_name} has "
                f"{len(scenario_durations)} requests"
            )

        print(
            f"  {scenario_name}: "
            f"mean={fmean(scenario_durations):.2f}ms, "
            f"p50={percentile(scenario_durations, 0.50):.2f}ms, "
            f"p95={percentile(scenario_durations, 0.95):.2f}ms, "
            f"max={scenario_durations[-1]:.2f}ms"
        )
    print()