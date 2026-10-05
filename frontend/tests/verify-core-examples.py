"""Read-only core replay for synthetic examples, not HTTP/API verification.

Usage from repository root: python -B frontend/tests/verify-core-examples.py
Inputs below are explicit synthetic replay inputs, not recovered production events.
"""
import json
import sys
from dataclasses import asdict
from pathlib import Path

reference = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(reference))
from core.main import evaluate_event
from core.step01_DecisionEvent import DecisionEvent

frontend = Path(__file__).resolve().parents[1]
examples = json.loads((frontend / 'fixtures/alerts.json').read_text(encoding='utf-8'))['alerts']
overrides = {
    18: {'error_code': 'timeout_01'},
    17: {'confidence': 0.3},
    16: {'confidence': 0.3, 'model_version': None},
    15: {},
    14: {'confidence': 0.3, 'latency_ms': 2800},
    19: {'model_version': None},
}
fields = ['event_id', 'level', 'risk_score', 'uncertainty_score', 'human_required',
          'recommended_actions', 'reason_summary', 'signals']
for example in examples:
    values = dict(event_id=example['event_id'], decision_type='approve', confidence=0.9,
                  latency_ms=100, model_version='v1', error_code=None)
    values.update(overrides[example['alert_id']])
    actual = asdict(evaluate_event(DecisionEvent(**values)))
    expected = {key: example[key] for key in fields}
    actual = {key: actual[key] for key in fields}
    for data in [actual, expected]:
        data['signals'] = [{key: value for key, value in s.items() if key != 'metadata'}
                           for s in data['signals']]
    assert actual == expected, f"{example['event_id']}: core output mismatch"
    print(f"PASS {example['event_id']}: scores/level/human/actions/reason/signals/evidence")
