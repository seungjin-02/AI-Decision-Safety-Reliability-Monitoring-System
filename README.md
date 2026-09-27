# AI-Decision-Safety-Reliability-Monitoring-System

AI 의사결정 과정에서 발생할 수 있는 **위험 신호(Risk Signal)**, **불확실성(Uncertainty)**, **인간 검토 필요 여부(Human Review Requirement)** 를 분리해 구조화하는 FastAPI 기반 MVP 프로젝트입니다.

이 프로젝트는 AI의 결정을 자동 승인하거나 거절하는 시스템이 아닙니다.
대신 AI 또는 자동화 시스템의 판단 결과를 그대로 신뢰하기 전에 어떤 위험 신호가 관측되었고 어떤 정보가 부족하며 어디서 인간 검토가 필요한지를 명확하게 드러내는 것을 목표로 합니다.

---

## 프로젝트 요약

기존의 단순 threshold 또는 score 기반 시스템은 위험과 불확실성을 하나의 결과로 압축하기 쉽습니다.

그러나 실제 운영 상황에서는 다음 요소가 분리되어야 합니다.

- 실제로 관측된 위험 신호
- 입력 누락 또는 해석 제한으로 인한 불확실성
- 시스템이 자동으로 판단을 확정할 수 있는지 여부
- 인간 검토가 필요한 조건
- 시스템 오류 또는 평가 무결성 실패가 risk score로 위장되지 않는 구조

이 시스템은 다음 요소를 명확히 분리합니다.

```text
Risk Signal
→ 관측 가능한 위험 신호

Uncertainty
→ 판단에 필요한 정보가 부족하거나 결과를 재현·확인하기 어려운 상태

Critical Override
→ 시스템 오류 또는 평가 무결성 실패로 인해 점수와 별개로 즉시 인간 검토가 필요한 상태

Human Required
→ 시스템이 자동 확정을 멈추고 인간 검토를 요구해야 하는 상태
```

핵심 목표는 최대 자동화가 아니라 **어디까지 시스템이 해석할 수 있고 어디서 인간 판단이 필요한지 명확히 드러내는 것**입니다.

---

## 해결하려는 문제

AI 기반 의사결정 시스템이나 모니터링 시스템은 종종 내부 판단 결과를 단일 score, level, alert 형태로 압축합니다.

이 방식은 단순하고 빠르지만 다음과 같은 문제가 있습니다.

- 위험 신호와 불확실성이 구분되지 않음
- 입력 정보가 부족한 상황에서도 시스템이 판단을 확정한 것처럼 보일 수 있음
- 시스템 오류가 일반 risk score로 섞여 해석될 수 있음
- 운영자가 결과의 근거를 확인하기 어려움
- 자동화된 판단과 인간 책임 사이의 경계가 모호해짐
- 단순 threshold 기반 판단이 실제 판단 가능성을 과대평가할 수 있음

예를 들어, 같은 높은 risk score가 나오더라도 다음 세 상황은 다르게 처리되어야 합니다.

```text
1. 충분한 정보가 있는 상태에서 관측된 높은 위험
2. 입력 정보가 부족한 상태에서 관측된 높은 위험
3. risk score와 무관하게 시스템 오류가 발생한 상태
```

이 시스템은 세 번째 경우를 risk score에 합산하지 않습니다.  
대신 `failure` category와 `is_critical_override=True` signal로 분리하여 처리합니다.

---

## 핵심 설계 원칙

### 1. AI는 판단 주체가 아니다

이 시스템은 최종 결정을 내리지 않습니다.

시스템은 다음을 수행하지 않습니다.

- 자동 승인
- 자동 거절
- 최종 판단 확정
- 사건 간 우선순위 결정
- 인간 판단 대체

대신 시스템은 판단에 필요한 구조를 제공합니다.

---

### 2. 위험과 불확실성을 분리한다

위험과 불확실성은 서로 다른 의미를 가집니다.

```text
risk_score
→ 실제로 관측된 위험 신호의 누적

uncertainty_score
→ 판단을 제한하는 정보 부족 또는 추적성 부족
```

불확실성은 위험을 직접 낮추거나 높이지 않습니다.

대신 시스템이 해당 판단을 자동으로 확정할 수 있는지에 영향을 줍니다.

---

### 3. Critical override는 risk score로 위장하지 않는다

시스템 오류, timeout, gateway failure와 같은 평가 무결성 실패는 일반 risk score에 합산하지 않습니다.

```text
failure signal
→ category = "failure"
→ score = 0
→ is_critical_override = True
```

즉 risk score가 0이어도 critical override가 발생하면 최종 level은 `CRITICAL`이 될 수 있습니다.

---

### 4. HUMAN_REQUIRED는 실패가 아니라 설계된 결과이다

`human_required=True`는 시스템 실패가 아닙니다.

이는 다음을 의미합니다.

```text
현재 상황에서는 시스템이 자동으로 판단을 확정하지 않고 인간 검토가 필요하다.
```

즉 `human_required`는 fallback이 아니라 의도적으로 설계된 결과입니다.

---

### 5. Priority를 생성하지 않는다

이 시스템은 사건 간 처리 우선순위를 생성하지 않습니다.

`priority`는 시스템이 어떤 사건을 먼저 처리해야 하는지 판단하는 값으로 해석될 수 있습니다.  
이 프로젝트에서는 최종 처리 순서와 우선순위 판단을 인간 운영자의 책임으로 남깁니다.

대신 시스템은 단일 이벤트에 대해 필요한 운영 행동 후보만 제공합니다.

---

## 시스템 구조

현재 시스템은 FastAPI API layer, core evaluation pipeline, SQLite persistence layer로 분리되어 있습니다.

```text
Client
  → Trace ID Middleware
  → FastAPI Request Schema Validation
  → Evaluation Service
  → Core Evaluation Pipeline
  → AlertRepository (SQLite commit)
  → API Response Mapping / Response Validation
  → JSON Response + X-Trace-ID
  → 요청 완료 JSON 로그 1건
```

`/evaluate`는 평가 결과를 SQLite에 저장한 뒤 `201`을 반환합니다. 저장 실패 시 결과가 담긴 `PersistenceError`를 HTTP 오류로 변환합니다.

### API 계층

API layer는 HTTP 요청과 응답 계약을 담당합니다.

```text
app/
  main.py
  schemas.py
  services/
    evaluation_service.py
  utils/
    trace.py
    structured_logging.py
```

주요 책임은 다음과 같습니다.

- HTTP endpoint 제공
- request schema validation
- 요청마다 trace_id 생성 및 응답 헤더 전파
- API validation error와 core validation error 분리
- core 결과를 API response contract로 변환
- core layer가 HTTP/FastAPI에 의존하지 않도록 보호

---

### 저장·조회 계층

Persistence layer는 core evaluation 결과를 SQLite에 저장하는 역할을 담당합니다.

```text
app/db/
  connection.py
  alert_repository.py
  schema.sql
```

현재 구현 범위는 다음과 같습니다.

- SQLite connection 생성 및 foreign key 활성화
- alerts, alert_signals, alert_actions table 초기화
- AlertOutput, signal, recommended action 저장
- trace_id와 UTC created_at 저장
- 자식 row 저장 실패 시 rollback 시도 및 성공 여부 구분
- alert 단건 조회 및 필터·커서 기반 목록 조회

---

### 평가 단계

Core pipeline은 단일 `DecisionEvent`를 평가하여 `AlertOutput`을 생성합니다.

```text
DecisionEvent
 → validate_event
 → normalize_event
 → build_evaluation_context
 → evaluate_rule
 → build_signals
 → summarize_signals
 → interpret_gate
 → generate_action
 → build_alert_output
```

각 단계는 독립된 책임을 가집니다.

| 단계 | 역할 |
|---|---|
| Validation | 잘못된 입력을 rule 평가 전에 차단 |
| Normalization | 입력값을 내부 처리 가능한 형태로 정규화 |
| Evaluation Context | 누락 필드와 평가 제한 조건 기록 |
| Rule Evaluation | 사전에 정의된 규칙 평가 |
| Signal Generation | 발동된 규칙을 구조화된 signal로 변환 |
| Score Aggregation | risk score와 uncertainty score를 분리 집계 |
| Gate Interpretation | 최종 level과 human_required 여부 결정 |
| Action Generation | gate 결과와 signal 원인을 운영 행동으로 번역 |
| Alert Output | 최종 출력 조립 |

판단은 여러 단계에 흩어져 수행되지 않고 **Gate Interpretation 단계에서만 최종 해석됩니다.**

---

## API 요청·응답

### 이벤트 평가·저장

```http
POST /evaluate
```

Request:

```json
{
  "event_id": "evt_demo_high_risk_uncertainty",
  "decision_type": "approve",
  "confidence": 0.3,
  "latency_ms": 2800,
  "model_version": null,
  "error_code": null,
  "metadata": {
    "source": "demo"
  }
}
```

Response:

```json
{
  "alert_id": 1,
  "created_at": "2026-09-26T00:00:00+00:00",
  "trace_id": "generated-trace-id",
  "event_id": "evt_demo_high_risk_uncertainty",
  "level": "WARN",
  "risk_score": 5,
  "uncertainty_score": 1,
  "human_required": true,
  "recommended_actions": [
    "human_review_required",
    "review_missing_or_incomplete_information",
    "monitor_closely"
  ],
  "reason_summary": "high risk score detected, but uncertainty prevents automatic critical finalization",
  "signals": [
    {
      "rule_id": "approve_confidence_low",
      "category": "risk",
      "score": 3,
      "reason": "approve decision with low confidence",
      "evidence": {
        "decision_type": "approve",
        "confidence": 0.3
      },
      "is_critical_override": false,
      "metadata": {}
    },
    {
      "rule_id": "latency_high",
      "category": "risk",
      "score": 2,
      "reason": "response latency exceeded threshold",
      "evidence": {
        "latency_ms": 2800
      },
      "is_critical_override": false,
      "metadata": {}
    },
    {
      "rule_id": "missing_model_version",
      "category": "uncertainty",
      "score": 1,
      "reason": "model_version field is missing",
      "evidence": {
        "model_version": null
      },
      "is_critical_override": false,
      "metadata": {}
    }
  ],
  "metadata": {
    "source": "demo"
  }
}
```

저장된 alert는 `GET /alerts/{alert_id}`로 단건 조회하거나 `GET /alerts`로 목록 조회할 수 있습니다. 목록은 `limit`(기본 5, 최대 100), `level`, `human_required`, 생성 시각 범위 및 `next_cursor` 기반 페이지 이동을 지원합니다. 자세한 요청·응답 형식은 [API Contract](docs/api-contract.md)를 참고하세요.

---

## 오류 응답과 기록

API layer와 core layer의 validation 책임은 분리되어 있습니다.

| Status Code | Error Type | 의미 |
|---|---|---|
| 200 | - | alert 조회 완료 |
| 201 | - | 평가 및 저장 완료 |
| 400 | `core_validation_error` | JSON 형식은 맞지만 domain rule을 위반 |
| 404 | `alert_not_found` | 요청한 alert ID가 없음 |
| 422 | `api_validation_error` | 요청 body 또는 조회 조건의 타입·형식 오류 |
| 500 | `persistence_error` | DB 저장 또는 조회 실패 |
| 500 | `system_error` | 예상하지 못한 서버 내부 오류 |

예시:

```text
confidence = "not-a-number" → 422 api_validation_error
confidence = 1.5 → 400 core_validation_error

latency_ms = "slow" → 422 api_validation_error
latency_ms = -1 → 400 core_validation_error

decision_type = "pending" → 400 core_validation_error
event_id = "   " → 400 core_validation_error
metadata = "not-an-object" → 422 api_validation_error
```

`POST /evaluate` 정상 응답과 전용 오류 응답에서는 본문의 `trace_id`와 헤더의 `X-Trace-ID`가 같습니다. 조회 API는 다릅니다. `GET /alerts/{alert_id}`의 본문 `trace_id`는 alert를 **생성할 때의 요청 ID**이고, 헤더의 `X-Trace-ID`는 **현재 조회 요청 ID**입니다. `GET /alerts`는 각 항목에 생성 요청 ID를 담으며 응답 최상위에는 `trace_id`가 없습니다. 현재 조회 요청 ID는 헤더와 서버 로그로 확인합니다.

Middleware는 요청마다 `status_code`, `result`, `duration_ms`, `failure_stage`, `persistence_outcome` 등을 담은 JSON 요약 로그 1건을 기록합니다. 요청 body 전체는 기록하지 않습니다.

---

## 평가 흐름 예시

### 입력

```json
{
  "event_id": "evt_demo_high_risk_uncertainty",
  "decision_type": "approve",
  "confidence": 0.3,
  "latency_ms": 2800,
  "model_version": null,
  "error_code": null
}
```

### 해석

```text
approve + low confidence
→ risk signal

high latency
→ risk signal

missing model_version
→ uncertainty signal
```

### 결과 요약

```text
level: WARN
risk_score: 5
uncertainty_score: 1
human_required: true

recommended_actions:
  - human_review_required
  - review_missing_or_incomplete_information
  - monitor_closely
```

이 예시는 이 프로젝트의 핵심 설계를 보여줍니다.

```text
위험 신호는 높지만 불확실성으로 인해 시스템이 CRITICAL을 자동 확정하지 않고 인간 검토를 요구한다.
```

---

## 평가 무결성 신호 예시

### 입력

```json
{
  "event_id": "evt_demo_failure_override",
  "decision_type": "approve",
  "confidence": 0.9,
  "latency_ms": 300,
  "model_version": "v1",
  "error_code": "gateway_failure"
}
```

### 결과 요약

```text
level: CRITICAL
risk_score: 0
uncertainty_score: 0
human_required: true

signal:
  rule_id: evaluation_integrity_override
  category: failure
  score: 0
  is_critical_override: true

recommended_actions:
  - human_review_required
  - immediate_investigation
  - escalate_incident
```

이 케이스는 system failure를 risk score로 위장하지 않고, 별도의 critical override path로 처리한다는 점을 보여줍니다.

---

## 테스트 전략

테스트는 여섯 영역으로 구성되어 있습니다.

```text
tests/
  Unit_Test/
  Integration_Test/
  Design_Invariant_Test/
  API_Test/
  DB_Test/
  Benchmark_Test/
```

### 단위 테스트

각 core pipeline step의 독립적인 책임을 검증합니다.

검증 대상 예시:

- normalization
- event validation
- evaluation context
- rule evaluation
- signal generation
- score aggregation
- gate interpretation
- action generation

---

### 통합 테스트

`DecisionEvent`가 전체 core pipeline을 거쳐 `AlertOutput`으로 변환되는 흐름을 검증합니다.

검증 대상 예시:

- 정상 이벤트
- low confidence risk signal
- high latency risk signal
- high risk with uncertainty
- critical override
- invalid input validation stop

---

### 설계 불변 조건 테스트

시스템의 핵심 설계 원칙이 깨지지 않도록 보호합니다.

예시:

- uncertainty는 risk_score에 직접 더해지지 않는다.
- failure signal은 risk_score에 합산되지 않는다.
- critical override는 score가 아니라 override flag로 처리된다.
- human_required는 final_level과 분리된다.
- AlertOutput은 결과를 재계산하지 않고 조립만 한다.

결과 조립의 실제 값 연결은 `test_design_invariants.py`의 `test_alert_output`에서도 검증합니다.

---

### API 테스트

FastAPI 계층의 외부 계약을 검증합니다.

검증 대상 예시:

- `POST /evaluate`
- `GET /alerts/{alert_id}`, `GET /alerts`
- success response의 주요 필드
- 400 core validation error
- 422 API validation error
- 500 system error response contract
- 500 response의 빈 details list
- 평가·오류 응답의 trace_id 본문·헤더 일치와 조회 응답의 trace_id 역할 구분

---

### DB 테스트

SQLite schema 초기화와 AlertRepository의 transaction 동작을 검증합니다.

검증 대상 예시:

- schema table 생성
- foreign key 활성화 및 제약조건
- alert, signal, recommended action 저장
- 저장된 action 순서 보존
- 자식 row 저장 실패 시 rollback 성공 경로 검증

---

## 파일 구조

```text
app/
  main.py
  schemas.py
  db/
    connection.py
    alert_repository.py
    schema.sql
  services/
    evaluation_service.py
  utils/
    trace.py
    structured_logging.py

core/
  main.py
  event_validation.py
  step01_DecisionEvent.py
  step02_NormalizedEvent.py
  step03_EvaluationContext.py
  step04_RuleEvaluation.py
  step05_SignalGeneration.py
  step06_ScoreAggregation.py
  step07_GateInterpretation.py
  step08_ActionGeneration.py
  step09_AlertOutput.py

tests/
  Unit_Test/
    test_normalization.py
    test_validation.py
    test_evaluation_context.py
    test_rule_evaluation.py
    test_signal_generation.py
    test_score_aggregation.py
    test_gate_interpretation.py
    test_action_generation.py

  Integration_Test/
    test_pipeline_validation.py
    test_full_pipeline.py

  Design_Invariant_Test/
    test_design_invariants.py

  API_Test/
    test_evaluate_endpoint.py
    test_api_validation.py
    test_core_validation_error.py
    test_system_error.py
    test_get_alerts.py

  DB_Test/
    test_connection.py
    test_alert_repository.py

  Benchmark_Test/
    test_workload_generator.py

benchmarks/
  generate_workload.py
  run_benchmark.py
  summarize_results.py
  data/
    workload_v1.jsonl
    workload_v1.manifest.json

docs/
  api-contract.md
  architecture.md
  benchmark-contract.md
  benchmark-baseline.md
  decision-boundary.md
  validation-policy.md
  test-strategy.md
```

---

## 실행 방법

### 평가 함수 실행

```bash
python -m core.main
```

### API 서버 실행

```bash
uvicorn app.main:app --reload
```

Evaluate event:

```bash
curl -X POST http://127.0.0.1:8000/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "event_id": "evt_demo_001",
    "decision_type": "approve",
    "confidence": 0.3,
    "latency_ms": 2800,
    "model_version": null,
    "error_code": null,
    "metadata": {
      "source": "curl_demo"
    }
  }'
```

---

## 테스트 실행

전체 테스트 실행:

```bash
python -m pytest -v
```

Unit tests:

```bash
python -m pytest tests/Unit_Test -v
```

Integration tests:

```bash
python -m pytest tests/Integration_Test -v
```

Design invariant tests:

```bash
python -m pytest tests/Design_Invariant_Test -v
```

API tests:

```bash
python -m pytest tests/API_Test -v
```

DB tests:

```bash
python -m pytest tests/DB_Test -v
```

Benchmark workload tests:

```bash
python -m pytest tests/Benchmark_Test -v
```

## 벤치마크 기준선

고정 seed로 생성한 10개 시나리오, 1,000건 workload를 사용합니다. 별도 DB로 100건 warm-up 후, 각각 독립된 DB에서 1,000건씩 3회 순차 측정합니다. 각 실행은 응답·요청 로그·DB의 trace 연결 및 저장 건수를 확인한 다음 결과를 남깁니다. 측정 방식은 FastAPI `TestClient` 기반이며 실제 네트워크나 동시 접속 부하는 포함하지 않습니다.

저장된 결과를 요약하려면 `python -m benchmarks.summarize_results`를 실행합니다. 측정을 새로 실행할 때는 `python -m benchmarks.run_benchmark`를 사용하며, 기존 `benchmarks/results/run_01`~`run_03` 파일이 있으면 덮어쓰지 않고 중단합니다.

실행 기준과 측정 환경은 [Benchmark Contract](docs/benchmark-contract.md), 결과와 원인 미확정인 지연 사례는 [Benchmark Baseline](docs/benchmark-baseline.md)에 기록되어 있습니다.

---

## 문서 목록

자세한 설계 설명은 아래 문서에서 확인할 수 있습니다.

- [Architecture](docs/architecture.md)
- [Decision Boundary](docs/decision-boundary.md)
- [Validation Policy](docs/validation-policy.md)
- [Test Strategy](docs/test-strategy.md)
- [API Contract](docs/api-contract.md)
- [Benchmark Contract](docs/benchmark-contract.md)
- [Benchmark Baseline](docs/benchmark-baseline.md)

---

## 의도적으로 수행하지 않는 일

이 시스템은 다음을 하지 않습니다.

- 자동 승인 / 자동 거절
- 최종 의사결정 대체
- 사건 간 priority 생성
- 불확실성을 risk score에 숨기기
- system failure를 risk score에 합산하기
- 동적 threshold 최적화
- 사용자 인증 / 권한 관리
- 운영자 dashboard 제공
- 배포 환경 제공

대신 다음을 수행합니다.

- 위험 신호 구조화
- 불확실성 분리
- 평가 제한 조건 기록
- critical override 분리
- 인간 검토 필요 여부 명시
- 자동 판단 경계 정의
- API response contract 제공
- trace_id 기반 요청 추적성 제공
- SQLite 기반 alert, signal, recommended action 저장
- transaction 실패 시 rollback 결과 구분
- `/evaluate` 결과의 자동 저장과 alert 단건·목록 조회
- 요청 단위 구조화 JSON 로그 기록

---

## 현재 구현 범위

현재 구현된 범위는 다음과 같습니다.

- core 평가 흐름: 입력 검증, 위험·불확실성 분리, 최종 수준과 운영 행동 결정
- `POST /evaluate`: 평가·SQLite 저장·응답 모델 검증 후 `201` 반환
- `GET /alerts/{alert_id}`, `GET /alerts`: 저장된 결과 조회와 필터·커서 기반 목록 조회
- SQLite transaction rollback과 저장 결과(`not_attempted`, `committed`, `rolled_back`, `unknown`) 구분
- 요청별 `trace_id`, 구조화 JSON 요약 로그 및 HTTP 오류 응답
- 단위·통합·설계 불변 조건·API·DB·벤치마크 workload 테스트
- 고정된 1,000건 workload와 3회 벤치마크 기준선, GitHub Actions CI

현재 제공하지 않는 항목은 다음과 같습니다 (구현 일정은 정하지 않았습니다).

- 사용자 인증과 권한 관리
- 운영자 대시보드
- 배포 자동화
- 별도의 의존성 잠금 파일 (`requirements.txt`에는 버전이 명시되어 있음)
- 외부 로그 수집·모니터링 시스템

---

## 마무리

이 프로젝트는 AI를 활용해 결정을 자동화하는 시스템이 아닙니다.

핵심은 다음 질문에 답하는 것입니다.

```text
AI 또는 시스템이 어디까지 해석할 수 있고 어디서 멈춰야 하는가?
```

따라서 이 프로젝트는 결론을 대신 내리는 것이 아니라 위험 신호와 불확실성을 분리하고 인간 판단이 필요한 지점을 명확히 구조화하는 시스템입니다.
