# Architecture

이 문서는 `AI Decision Risk Signal Monitoring System`의 전체 구조와 파이프라인 흐름을 설명한다.

현재 버전은 AI 의사결정 이벤트를 입력받아 위험 신호, 불확실성, critical override, 인간 검토 필요 여부를 구조화하는 **FastAPI 기반 rule-based MVP**이다.

이 시스템은 AI의 결정을 자동 승인하거나 거절하지 않는다.  
대신 AI 또는 자동화 시스템의 판단 결과를 그대로 신뢰하기 전에 어떤 위험 신호가 관측되었고 어떤 정보가 부족하며 어디서 인간 검토가 필요한지를 구조화한다.

---

## 1. Architecture Overview

현재 시스템은 API, 평가, 저장 계층으로 나뉜다.

```text
FastAPI API Layer
→ HTTP request / response contract 담당

Core Evaluation Pipeline
→ decision event 평가와 alert 생성 담당

SQLite Persistence Layer
→ alert, signal, action을 한 transaction으로 저장하고 조회 담당
```

전체 흐름은 다음과 같다.

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

이 구조의 핵심은 다음과 같다.

- API layer는 HTTP, schema, status code, trace_id를 담당한다.
- Core layer는 risk / uncertainty / override / gate 해석을 담당한다.
- Core layer는 FastAPI, HTTP status code, request header, DB를 모른다.
- Service layer는 API schema와 core dataclass 사이의 adapter 역할을 한다.
- Repository는 FastAPI와 분리되어 SQLite 저장 결과를 반환하거나 결과가 담긴 예외를 발생시킨다.
- 최종 해석은 Gate Interpretation에서만 수행한다.
- Action Generation은 판단을 다시 하지 않고 운영 행동으로 번역한다.
- Alert Output은 결과를 재계산하지 않고 조립만 한다.

---

## 2. Layered Responsibility

### API Layer

API layer는 외부 요청과 응답 계약을 담당한다.

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

주요 책임은 다음과 같다.

- HTTP endpoint 제공
- request body schema validation
- trace_id 생성 및 response header 전파
- API validation error와 core validation error 분리
- core result를 API response contract로 변환
- 예상하지 못한 exception을 system_error로 변환
- 요청당 최종 요약 로그 1건 기록

API layer가 직접 수행하지 않는 것:

- risk rule 판단
- uncertainty 계산
- critical override 판단
- final_level 결정
- human_required 결정
- action 생성 로직

---

### Service Layer

Service layer는 API, core, repository를 연결한다.

```text
app/services/evaluation_service.py
```

주요 책임은 다음과 같다.

```text
EvaluateRequest
→ DecisionEvent

AlertOutput
→ AlertRepository.save(alert, trace_id)
→ EvaluationResult(alert, saved_alert)

AlertOutput + SavedAlert
→ EvaluateResponse-compatible dict

ValueError from core
→ CoreValidationException
```

이 계층은 core가 HTTP/FastAPI에 의존하지 않도록 보호한다.

### Persistence Layer

`app/db/alert_repository.py`는 alert, signal, action을 SQLite transaction으로 저장하고 ID 조회와 필터·커서 기반 목록 조회를 제공한다. 저장 성공은 commit 후 `SavedAlert`를 반환한다. 실패하면 rollback 성공 여부에 따라 `PersistenceError`의 `persistence_outcome`을 `rolled_back` 또는 `unknown`으로 전달한다. 연결 단계에서 실패하면 `not_attempted`를 전달한다.

---

### Core Layer

Core layer는 단일 `DecisionEvent`를 평가하여 `AlertOutput`을 생성한다.

```text
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
```

---

## 3. API Flow

### Alert Retrieval

`GET /alerts/{alert_id}`는 ID로 alert를 조회하고, 없으면 `404 alert_not_found`를 반환한다. `GET /alerts`는 `limit`, `level`, `human_required`, 시각 범위, 두 필드로 구성된 커서를 받아 목록과 `next_cursor`를 반환한다. 두 endpoint 모두 core 평가를 다시 실행하지 않는다.

---

### Evaluate Event

```http
POST /evaluate
```

처리 흐름:

```text
Request JSON
→ trace_id 생성
→ EvaluateRequest schema validation
→ evaluate_request(payload, trace_id, repository)
→ DecisionEvent 생성
→ evaluate_event(event)
→ AlertOutput 생성
→ repository.save() 및 commit
→ persistence_outcome = committed
→ API response dict로 변환
→ EvaluateResponse 검증 및 201 응답
→ X-Trace-ID header 추가
→ 요청 완료 JSON 로그 1건
```

정상 응답은 `EvaluateResponse` contract를 따른다.

---

## 4. Error Flow

API layer와 core layer의 validation 책임은 분리된다.

| Error Source | Status Code | Error Type | Meaning |
|---|---:|---|---|
| API schema validation | 422 | `api_validation_error` | 요청 body 형식 또는 타입 오류 |
| Core domain validation | 400 | `core_validation_error` | 형식은 맞지만 domain rule 위반 |
| Alert ID 조회 실패 | 404 | `alert_not_found` | 요청한 alert가 없음 |
| Repository 오류 | 500 | `persistence_error` | 저장 또는 조회 실패 |
| Response validation | 500 | `system_error` | 저장 완료 후에도 응답 검증 실패 가능 |
| Unexpected exception | 500 | `system_error` | 예상하지 못한 서버 내부 오류 |

예시:

```text
confidence = "not-a-number"
→ 422 api_validation_error

confidence = 1.5
→ 400 core_validation_error

latency_ms = "slow"
→ 422 api_validation_error

latency_ms = -1
→ 400 core_validation_error

decision_type = "pending"
→ 400 core_validation_error

event_id = "   "
→ 400 core_validation_error
```

정의된 endpoint의 정상 응답과 전용 예외 처리 응답은 `trace_id`를 포함한다.

또한 response body의 `trace_id`와 response header의 `X-Trace-Id`는 동일해야 한다.

---

## 5. Core Pipeline Entry Point

전체 core pipeline의 진입점은 `core/main.py`의 `evaluate_event()` 함수이다.

```text
core/main.py
```

`evaluate_event()`는 다음 순서로 이벤트를 처리한다.

```text
1. validate_event(event)
2. normalize_event(event)
3. build_evaluation_context(normalized)
4. evaluate_rule(normalized, context)
5. build_signals(evaluations, normalized)
6. summarize_signals(signals)
7. interpret_gate(signal_summary)
8. generate_action(decision, signals)
9. build_alert_output(...)
```

이 함수는 각 step을 연결하는 조립 역할만 수행한다.

`evaluate_event()`가 직접 수행하지 않는 것:

- rule 조건 판단
- score 계산
- final_level 결정
- human_required 결정
- action 생성 로직

이러한 책임은 각각의 step 파일로 분리되어 있다.

---

## 6. Core Pipeline Steps

### Step 01 — DecisionEvent

```text
core/step01_DecisionEvent.py
```

`DecisionEvent`는 외부에서 들어오는 의사결정 이벤트를 표현한다.

주요 필드:

```text
event_id
decision_type
confidence
latency_ms
model_version
error_code
metadata
```

이 단계는 판단을 수행하지 않는다. 입력 이벤트의 기본 구조만 정의한다.

---

### Validation

```text
core/event_validation.py
```

Validation 단계는 잘못된 입력이 pipeline 내부로 들어오는 것을 막는다.

예를 들어 다음 값들은 invalid input으로 처리된다.

```text
confidence = 1.5
confidence = -0.1
confidence = "abc"
latency_ms = -100
decision_type = "approvee"
event_id = ""
metadata = "not-a-dict"
```

Validation 실패 시 core pipeline은 중단되고 `ValueError`가 발생한다.

```text
invalid input
→ ValueError
→ rule evaluation으로 진행하지 않음
```

API layer에서는 이 `ValueError`를 `CoreValidationException`으로 변환한 뒤 400 `core_validation_error`로 매핑한다.

이 단계의 목적은 invalid input이 risk나 uncertainty로 잘못 해석되는 것을 방지하는 것이다.

---

### Step 02 — Normalization

```text
core/step02_NormalizedEvent.py
```

Normalization 단계는 입력값을 내부 처리에 적합한 형태로 변환한다.

예시:

```text
event_id = " evt_001 "
→ "evt_001"

decision_type = " APPROVE "
→ "approve"

error_code = " GATEWAY_FAILURE "
→ "gateway_failure"

model_version = "   "
→ None

error_code = "   "
→ None
```

Normalization은 값을 정리할 뿐 위험 판단을 수행하지 않는다.

---

### Step 03 — Evaluation Context

```text
core/step03_EvaluationContext.py
```

Evaluation Context는 rule 평가 전에 필요한 문맥 정보를 만든다.

주요 책임:

- 어떤 필드가 존재하는지 기록
- 어떤 필드가 누락되었는지 기록
- 어떤 rule 평가가 제한되는지 기록

예시:

```text
confidence = None
→ missing_fields에 confidence 기록
→ approve_confidence_rule_blocked 기록

decision_type = None
→ missing_fields에 decision_type 기록
→ decision_type_dependent_rules_blocked 기록

model_version = None
→ missing_fields에 model_version 기록

error_code = None
→ field_presence에는 False로 기록
→ missing_fields에는 포함하지 않음
```

이 단계는 rule을 직접 평가하지 않는다. rule 평가에 필요한 context만 제공한다.

---

### Step 04 — Rule Evaluation

```text
core/step04_RuleEvaluation.py
```

Rule Evaluation 단계는 사전에 정의된 rule을 평가한다.

현재 주요 rule:

```text
approve_confidence_low
latency_high
missing_confidence
missing_model_version
evaluation_integrity_override
stability_signal
```

이 단계의 출력은 `RuleEvaluation` 목록이다.

각 rule evaluation은 다음 정보를 가진다.

```text
rule
triggered
```

각 `Rule`은 다음 정보를 가진다.

```text
rule_id
category
condition
score
reason
evidence_fields
is_critical_override
thresholds
metadata
```

Rule Evaluation은 아직 최종 score나 level을 결정하지 않는다. 각 rule이 발동되었는지만 판단한다.

---

### Step 05 — Signal Generation

```text
core/step05_SignalGeneration.py
```

Signal Generation 단계는 발동된 rule만 `Signal`로 변환한다.

```text
RuleEvaluation(triggered=True)
→ Signal
```

발동되지 않은 rule은 signal로 생성되지 않는다.

Signal은 이후 score aggregation과 action generation에서 사용된다.

Signal의 주요 정보:

```text
rule_id
category
score
reason
evidence
is_critical_override
metadata
```

이 단계는 rule을 다시 평가하지 않는다. 이미 평가된 rule 결과를 구조화된 signal로 변환한다.

---

### Step 06 — Score Aggregation

```text
core/step06_ScoreAggregation.py
```

Score Aggregation 단계는 signal을 기반으로 score를 집계한다.

이 시스템은 risk와 uncertainty를 하나의 점수로 합치지 않는다.

```text
risk_score
→ category == "risk" signal의 score 합산

uncertainty_score
→ category == "uncertainty" signal의 score 합산
```

또한 critical override와 stability signal은 별도 flag로 유지한다.

```text
has_critical_override_signal
→ signal.is_critical_override 중 하나라도 True이면 True

has_stability_signal
→ category == "stability" signal이 하나라도 있으면 True
```

이 단계의 핵심은 다음과 같다.

- uncertainty는 risk_score에 직접 더해지지 않는다.
- failure signal은 risk_score에 합산되지 않는다.
- critical override는 score가 아니라 별도 flag로 유지된다.

---

### Step 07 — Gate Interpretation

```text
core/step07_GateInterpretation.py
```

Gate Interpretation은 최종 해석을 수행하는 핵심 단계이다.

입력:

```text
SignalSummary
  - risk_score
  - uncertainty_score
  - has_critical_override_signal
  - has_stability_signal
```

출력:

```text
GateDecision
```

`GateDecision`은 다음 정보를 포함한다.

```text
final_level
boundary
human_review
gate_reason
```

이 시스템에서 최종 level과 human_required는 서로 다른 개념이다.

```text
final_level
→ 시스템 해석 수준

human_required
→ 시스템이 자동 확정을 멈추고 인간 검토를 요구해야 하는지 여부
```

예시:

```text
risk_score = 5
uncertainty_score = 1

→ level = WARN
→ human_required = True
```

이는 위험이 낮다는 의미가 아니다. 높은 위험 신호는 감지되었지만 불확실성으로 인해 시스템이 CRITICAL을 자동 확정하지 않는다는 의미이다.

Critical override가 있는 경우에는 risk score와 별개로 `CRITICAL`로 해석된다.

```text
has_critical_override_signal = True

→ level = CRITICAL
→ human_required = True
```

---

### Step 08 — Action Generation

```text
core/step08_ActionGeneration.py
```

Action Generation 단계는 `GateDecision`과 `Signal`을 기반으로 운영 행동 후보를 생성한다.

예시 action:

```text
human_review_required
immediate_investigation
review_missing_or_incomplete_information
monitor_closely
escalate_incident
no_immediate_action_required
```

Action 생성 기준:

```text
human_review.required == True
→ human_review_required

critical override signal 존재
→ immediate_investigation

uncertainty signal 존재
→ review_missing_or_incomplete_information

final_level == CRITICAL
→ escalate_incident

final_level == WARN
→ monitor_closely

final_level == INFO
→ no_immediate_action_required
```

이 단계는 판단을 다시 하지 않는다.

하지 않는 것:

- risk_score 재계산
- final_level 변경
- human_required 재판단
- priority 생성

Action Generation은 이미 만들어진 gate 결과와 signal 원인을 운영 행동으로 번역한다.

---

### Step 09 — Alert Output

```text
core/step09_AlertOutput.py
```

Alert Output 단계는 최종 결과를 조립한다.

출력 객체:

```text
AlertOutput
```

주요 필드:

```text
event_id
level
risk_score
uncertainty_score
human_required
recommended_actions
reason_summary
signals
metadata
```

이 단계는 결과를 재계산하지 않는다.

```text
risk_score
→ SignalSummary에서 가져옴

uncertainty_score
→ SignalSummary에서 가져옴

level
→ GateDecision에서 가져옴

human_required
→ GateDecision.human_review.required에서 가져옴

recommended_actions
→ ActionRecommendation에서 가져옴

reason_summary
→ ActionRecommendation.message에서 가져옴
```

Alert Output은 최종 판단자가 아니라 이미 만들어진 결과를 외부에 전달하기 위한 출력 레이어이다.

---

## 7. Data Flow Summary

```text
API Request JSON
  ↓
EvaluateRequest
  ↓
DecisionEvent
  ↓
ValidationResult
  ↓
NormalizedEvent
  ↓
EvaluationContext
  ↓
RuleEvaluation[]
  ↓
Signal[]
  ↓
SignalSummary
  ↓
GateDecision
  ↓
ActionRecommendation
  ↓
AlertOutput
  ↓
AlertRepository.save() / SQLite commit
  ↓
SavedAlert (alert_id, created_at)
  ↓
EvaluateResponse-compatible dict
  ↓
201 JSON Response + X-Trace-ID
```

각 데이터 객체는 다음 단계로 필요한 정보만 전달한다.

---

## 8. Responsibility Separation

이 프로젝트는 각 layer와 step의 책임을 명확히 분리한다.

| Layer / Step | Responsibility |
|---|---|
| FastAPI App | route, middleware, exception handler |
| API Schema | request / response contract |
| Evaluation Service | API schema와 core model 사이 변환 |
| AlertRepository | SQLite 저장, rollback, 단건 및 목록 조회 |
| Request Logging | 요청별 JSON 요약과 처리 시간 기록 |
| Validation | invalid input 차단 |
| Normalization | 입력값 정규화 |
| Evaluation Context | missing field와 evaluation limit 기록 |
| Rule Evaluation | rule 발동 여부 평가 |
| Signal Generation | triggered rule을 signal로 변환 |
| Score Aggregation | risk와 uncertainty 분리 집계 |
| Gate Interpretation | final_level과 human_required 결정 |
| Action Generation | 운영 행동 후보 생성 |
| Alert Output | 최종 출력 조립 |

이 구조를 통해 특정 단계의 변경이 다른 단계의 책임을 침범하지 않도록 한다.

---

## 9. Design Constraints

이 architecture는 다음 제약을 따른다.

- invalid input은 rule evaluation으로 넘어가지 않는다.
- uncertainty는 risk_score에 직접 더해지지 않는다.
- failure signal은 risk_score에 합산되지 않는다.
- critical override는 score가 아니라 override flag로 유지된다.
- final_level과 human_required는 분리된다.
- action generation은 risk를 재해석하지 않는다.
- priority는 생성하지 않는다.
- alert output은 결과를 재계산하지 않는다.
- core는 API, HTTP, DB를 모른다.
- API response는 내부 core 객체를 그대로 노출하지 않는다.

이 제약은 unit, integration, design invariant, API, DB test로 보호된다.

---

## 10. Current Scope

현재 architecture는 MVP 수준이다.

현재 포함된 것:

```text
- rule-based core pipeline
- validation layer
- normalization layer
- risk / uncertainty 분리
- failure / critical override 분리
- gate interpretation
- action generation
- alert output
- FastAPI API layer
- /evaluate endpoint
- GET /alerts 및 GET /alerts/{alert_id}
- SQLite 저장과 transaction rollback
- trace_id middleware
- 요청 완료 구조화 JSON 로그
- API response schema
- API error handling
- pytest 기반 unit tests
- pytest 기반 integration tests
- pytest 기반 design invariant tests
- pytest 기반 API tests
- pytest 기반 DB 및 benchmark workload tests
```

현재 포함되지 않은 것:

```text
- authentication / authorization
- real-time dashboard
- deployment environment
- 외부 로그 수집·모니터링 시스템
- dynamic threshold optimization
```

따라서 이 문서는 완성형 운영 시스템의 architecture가 아니라 AI 의사결정 결과를 구조화하기 위한 FastAPI 기반 rule-based MVP architecture를 설명한다.
