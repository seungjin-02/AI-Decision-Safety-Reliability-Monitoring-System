# 테스트 전략

이 문서는 `AI-Decision-Safety-Reliability-Monitoring-System`의 테스트 구조와 테스트가 보호하는 설계 원칙을 설명한다.

현재 버전은 AI 의사결정 이벤트를 구조화하여 위험 신호, 불확실성, critical override, 인간 검토 필요 여부를 검증하는 **FastAPI 기반 rule-based MVP**이다.

테스트는 단순히 함수가 실행되는지 확인하는 수준이 아니다.  
이 프로젝트의 테스트는 core pipeline, API contract, error boundary, traceability, design invariant를 코드 수준에서 보호한다.

---

## 1. 테스트 목표

이 프로젝트의 테스트 목적은 다음과 같다.

- 각 pipeline step이 자신의 책임만 수행하는지 확인한다.
- 전체 pipeline이 DecisionEvent에서 AlertOutput까지 올바르게 연결되는지 확인한다.
- API layer가 외부 request / response contract를 안정적으로 유지하는지 확인한다.
- risk와 uncertainty가 섞이지 않도록 보호한다.
- system failure가 risk_score로 위장되지 않도록 보호한다.
- critical override가 별도 failure path로 유지되는지 확인한다.
- 평가·오류 응답의 본문과 헤더 ID 일치, 조회 응답의 생성 ID와 조회 ID 구분을 확인한다.
- core 내부 객체가 API response에 그대로 노출되지 않도록 보호한다.

특히 이 프로젝트에서는 작은 코드 변경이 설계 철학을 쉽게 깨뜨릴 수 있다.

예를 들어 다음과 같은 변경은 기능상으로는 동작할 수 있지만 설계상으로는 잘못된 변경이다.

- uncertainty_score를 risk_score에 더하는 변경
- failure signal을 risk signal로 처리하는 변경
- critical override를 일반 score 누적으로 처리하는 변경
- human_required를 final_level에 종속시키는 변경
- priority 필드를 다시 생성하는 변경
- API response에 core 내부 객체를 그대로 노출하는 변경
- 평가·오류 요청의 본문·헤더·로그·DB 연결을 깨뜨리거나 조회 요청 ID와 생성 요청 ID를 혼동하는 변경

따라서 테스트는 기능 검증뿐 아니라 설계 불변조건을 보호하는 역할을 한다.

---

## 2. 테스트 디렉터리

테스트는 여섯 영역으로 분리되어 있다.

```text
tests/
  Unit_Test/
  Integration_Test/
  Design_Invariant_Test/
  API_Test/
  DB_Test/
  Benchmark_Test/
```

각 계층은 서로 다른 목적을 가진다.

```text
Unit_Test
→ 각 core step의 독립 책임 검증

Integration_Test
→ core pipeline 전체 연결 검증

Design_Invariant_Test
→ 반드시 유지되어야 하는 설계 원칙 검증

API_Test
→ FastAPI endpoint, response contract, error mapping, trace_id 검증

DB_Test
→ SQLite 저장·조회와 rollback 검증

Benchmark_Test
→ 고정 workload 생성 및 manifest 검증
```

---

## 3. 단위 테스트

Unit test는 개별 평가 단계의 독립적인 책임을 검증한다. 최종 `AlertOutput` 조립은 별도의 단위 테스트 파일이 아니라 `tests/Design_Invariant_Test/test_design_invariants.py`의 `test_alert_output`에서 연결된 값을 확인한다.

```text
tests/Unit_Test/
```

대상 예시:

```text
test_validation.py
test_normalization.py
test_evaluation_context.py
test_rule_evaluation.py
test_signal_generation.py
test_score_aggregation.py
test_gate_interpretation.py
test_action_generation.py
```

Unit test는 다음을 보장한다.

- 각 step은 자기 책임만 수행한다.
- 각 step은 다음 step에 필요한 구조화된 결과만 전달한다.
- 판단 책임은 여러 파일에 흩어지지 않는다.

---

## 4. 평가 단계별 단위 테스트

### 4.1 입력 검증

검증 대상:

```text
core/event_validation.py
```

주요 확인 사항:

- event_id는 필수이다.
- event_id는 문자열이어야 한다.
- event_id는 공백 문자열이면 안 된다.
- confidence=None은 허용된다.
- confidence가 존재하면 number여야 한다.
- confidence는 0.0 이상 1.0 이하여야 한다.
- latency_ms=None은 허용된다.
- latency_ms가 존재하면 int여야 한다.
- latency_ms는 0 이상이어야 한다.
- decision_type=None은 허용된다.
- decision_type이 존재하면 approve 또는 reject여야 한다.
- metadata는 dict여야 한다.
- validation issue는 사람이 읽을 수 있는 메시지로 변환된다.

Validation test는 잘못된 입력이 rule evaluation으로 넘어가지 않도록 보호한다.

---

### 4.2 입력값 정리

검증 대상:

```text
core/step02_NormalizedEvent.py
```

주요 확인 사항:

- event_id는 앞뒤 공백이 제거된다.
- decision_type은 소문자/공백 제거 형태로 정규화된다.
- error_code는 소문자/공백 제거 형태로 정규화된다.
- confidence는 float으로 변환된다.
- latency_ms는 int로 변환된다.
- model_version의 blank string은 None으로 정규화된다.
- error_code의 blank string은 None으로 정규화된다.
- metadata는 dict로 복사된다.

Normalization test는 입력 정리와 판단 로직이 섞이지 않도록 보호한다.

---

### 4.3 평가 제한 조건

검증 대상:

```text
core/step03_EvaluationContext.py
```

주요 확인 사항:

- 누락 필드가 missing_fields에 기록된다.
- field_presence가 각 필드의 존재 여부를 기록한다.
- confidence=None은 approve_confidence_rule_blocked로 연결된다.
- decision_type=None은 decision_type_dependent_rules_blocked로 연결된다.
- model_version=None은 missing_fields에 기록된다.
- latency_ms=None은 missing_fields에 기록된다.
- error_code=None은 field_presence에는 False로 기록되지만 missing_fields에는 포함되지 않는다.

Evaluation Context test는 rule evaluation 전에 판단 제한 조건이 올바르게 정리되는지 확인한다.

---

### 4.4 규칙 평가

검증 대상:

```text
core/step04_RuleEvaluation.py
```

주요 확인 사항:

- approve + low confidence는 risk rule을 trigger한다.
- high latency는 risk rule을 trigger한다.
- missing confidence는 uncertainty rule을 trigger한다.
- missing model_version은 uncertainty rule을 trigger한다.
- timeout_01 또는 gateway_failure는 evaluation_integrity_override를 trigger한다.
- evaluation_integrity_override는 category="failure"이다.
- evaluation_integrity_override는 score=0이다.
- evaluation_integrity_override는 is_critical_override=True이다.

Rule Evaluation test는 개별 rule의 발동 조건을 검증한다.

---

### 4.5 신호 생성

검증 대상:

```text
core/step05_SignalGeneration.py
```

주요 확인 사항:

- triggered=True인 rule만 Signal로 변환된다.
- triggered=False인 rule은 Signal로 생성되지 않는다.
- Signal은 rule_id, category, score, reason, evidence를 유지한다.
- Signal은 is_critical_override를 유지한다.
- Signal은 metadata를 유지한다.

Signal Generation test는 rule 평가 결과가 이후 pipeline에서 사용할 수 있는 구조화된 signal로 변환되는지 확인한다.

---

### 4.6 점수 집계

검증 대상:

```text
core/step06_ScoreAggregation.py
```

주요 확인 사항:

- risk signal은 risk_score에 합산된다.
- uncertainty signal은 uncertainty_score에 합산된다.
- uncertainty signal은 risk_score에 더해지지 않는다.
- failure signal은 risk_score에 더해지지 않는다.
- critical override는 score가 아니라 has_critical_override_signal flag로 유지된다.
- stability signal은 has_stability_signal flag로 유지된다.

Score Aggregation test는 risk, uncertainty, failure path가 섞이지 않도록 보호한다.

---

### 4.7 최종 해석

검증 대상:

```text
core/step07_GateInterpretation.py
```

주요 확인 사항:

- low risk + low uncertainty는 INFO이다.
- medium risk는 WARN이다.
- high risk + low uncertainty는 CRITICAL이다.
- high risk + uncertainty는 WARN + human_required=True이다.
- critical override는 CRITICAL + human_required=True이다.
- final_level과 human_required는 분리된다.

Gate Interpretation test는 최종 해석이 명시된 boundary logic을 따르는지 확인한다.

---

### 4.8 운영 행동 생성

검증 대상:

```text
core/step08_ActionGeneration.py
```

주요 확인 사항:

- human_required=True이면 human_review_required action이 생성된다.
- critical override signal이 있으면 immediate_investigation action이 생성된다.
- uncertainty signal이 있으면 review_missing_or_incomplete_information action이 생성된다.
- CRITICAL은 escalate_incident action으로 연결된다.
- WARN은 monitor_closely action으로 연결된다.
- INFO는 no_immediate_action_required action으로 연결된다.

Action Generation test는 action이 판단 추천이 아니라 운영 행동 번역으로 유지되는지 확인한다.

---

### 4.9 결과 조립 검증 (설계 불변 조건 테스트)

검증 대상:

```text
core/step09_AlertOutput.py
```

현재 `test_alert_output`은 정규화된 `event_id`, 집계된 두 점수, 결정된 `level`·`human_required`, 생성된 `recommended_actions`가 최종 alert에 그대로 연결되는지를 비교한다. `reason_summary`와 `metadata`도 출력 객체의 필드지만 이 테스트에서 별도로 단언하지는 않는다.

---

## 5. 통합 테스트

Integration test는 여러 core step이 연결된 전체 pipeline 흐름을 검증한다.

```text
tests/Integration_Test/
```

주요 테스트:

```text
test_pipeline_validation.py
test_full_pipeline.py
```

---

### 5.1 입력 검증 중단

`test_pipeline_validation.py`는 validation이 pipeline 입구에서 정상적으로 작동하는지 확인한다.

핵심 원칙:

```text
invalid input은 rule evaluation으로 넘어가지 않는다.
```

예시:

```text
confidence = 1.5
→ ValueError
→ normalize_event 이후 흐름으로 진행하지 않음
→ evaluate_rule 실행 안 됨
→ AlertOutput 생성 안 됨
```

이 테스트는 invalid input이 risk나 uncertainty로 잘못 해석되는 것을 방지한다.

---

### 5.2 평가 흐름 전체

`test_full_pipeline.py`는 `DecisionEvent`가 전체 pipeline을 거쳐 최종 `AlertOutput`으로 변환되는 흐름을 검증한다.

검증 예시:

```text
normal input
→ INFO

low confidence approve
→ WARN

high latency
→ WARN

low confidence + high latency
→ CRITICAL

high risk + uncertainty
→ WARN + human_required=True

gateway_failure 또는 timeout_01
→ CRITICAL + human_required=True
→ risk_score에는 합산되지 않음

missing confidence
→ uncertainty

missing model_version
→ uncertainty

invalid input
→ ValueError
```

Full Pipeline Test는 각 step이 개별적으로 맞는 것뿐 아니라 조립된 전체 시스템도 설계대로 동작하는지 확인한다.

---

## 6. 설계 불변 조건 테스트

Invariant test는 시스템의 핵심 설계 원칙이 깨지지 않도록 보호한다.

```text
tests/Design_Invariant_Test/
```

주요 테스트:

```text
test_design_invariants.py
```

Invariant test는 기능 테스트보다 더 강한 의미를 가진다.

기능상으로는 동작하더라도 아래 원칙이 깨지면 이 프로젝트의 설계 의도는 훼손된다.

---

## 7. 보호하는 설계 불변 조건

### 7.1 불확실성을 위험 점수에 더하지 않음

```text
uncertainty signal
→ uncertainty_score 증가
→ risk_score에는 직접 반영하지 않음
```

이 원칙은 risk와 uncertainty를 분리하기 위한 핵심 조건이다.

---

### 7.2 시스템 실패를 위험 점수에 더하지 않음

```text
failure signal
→ risk_score에 합산하지 않음
```

system failure 또는 evaluation integrity failure는 일반 위험 점수가 아니다.  
따라서 failure signal은 risk_score를 올리지 않는다.

---

### 7.3 평가 무결성 신호는 별도 조건으로 유지

```text
critical override signal
→ score 누적이 아니라 is_critical_override=True로 유지
```

이 원칙은 시스템 오류성 또는 평가 무결성 실패가 일반 점수 합산에 묻히지 않도록 보호한다.

---

### 7.4 최종 수준과 인간 검토 여부를 분리

```text
level = WARN
human_required = True
```

이 상태는 유효하다.

`human_required`는 위험 수준 자체가 아니라 시스템이 자동 확정을 멈춰야 하는지를 나타낸다.

---

### 7.5 운영 행동 생성 단계에서 위험을 재해석하지 않음

Action Generation은 다음을 수행하지 않는다.

```text
risk_score 재계산
uncertainty_score 재계산
final_level 변경
human_required 재판단
```

Action Generation은 이미 만들어진 `GateDecision`과 `Signal` 원인을 운영 행동으로 번역한다.

---

### 7.6 사건 간 우선순위를 생성하지 않음

이 시스템은 사건 간 우선순위를 생성하지 않는다.

```text
priority
→ 사건 간 처리 순서 판단
```

이 판단은 시스템이 아니라 인간 검토자 또는 운영자의 책임으로 남긴다.

현재 테스트에는 `priority` 필드 부재만 따로 검사하는 단언은 없다. 신규 응답 필드나 출력 모델을 변경할 때 이 경계를 별도로 확인해야 한다.

---

### 7.7 최종 결과에서 판단을 재계산하지 않음

Alert Output은 다음을 수행하지 않는다.

```text
risk_score 재계산
uncertainty_score 재계산
final_level 재판단
action 재생성
```

최종 출력은 기존 결과를 조립하는 역할만 한다.

---

### 7.8 Core는 HTTP·DB에 의존하지 않음

Core layer는 다음을 몰라야 한다.

```text
FastAPI
HTTP status code
request header
trace_id
database
```

Core는 순수하게 decision event를 평가하고 `AlertOutput`을 생성한다.

---

## 8. API·DB·벤치마크 테스트

`tests/API_Test/`는 외부 응답, 실패 분류 및 요청 로그 계약을 검증한다. 실제 파일은 다음과 같다.

```text
test_evaluate_endpoint.py
test_api_validation.py
test_core_validation_error.py
test_system_error.py
test_get_alerts.py
```

- `POST /evaluate`: 정상 요청은 SQLite에 저장되고 `201`을 반환한다. 응답 `alert_id`, `created_at` 및 `trace_id`를 검증한다.
- API 형식 오류 `422`와 core 의미 검증 실패 `400`: 전용 오류 응답과 저장 미시도를 확인한다.
- 저장 실패 `500`: rollback 성공 시 `rolled_back`, rollback 실패 시 `unknown`을 로그로 확인한다.
- commit 후 응답 검증 실패 `500`: HTTP 오류와 DB commit을 구분한다.
- `GET /alerts/{alert_id}`, `GET /alerts`: 단건 조회, `404`, 필터, 커서 페이지 이동과 입력 검증을 확인한다.
- 요청 로그: 요청마다 `request_completed` 한 건과 `status_code`, `result`, `failure_stage`, `persistence_outcome`을 검증한다. 평가 성공 경로에서 헤더·본문·로그·DB의 `trace_id` 연결을 확인한다. 조회 성공 시 본문의 alert 생성 ID와 현재 조회 헤더 ID가 서로 다른 것도 검증한다.

`tests/DB_Test/`는 SQLite schema, foreign key, transaction rollback 및 repository 저장·조회를 검증한다. `tests/Benchmark_Test/`는 재현 가능한 workload와 manifest 계약을 검증한다. 측정 실행 및 결과 검증 절차는 [benchmark-contract.md](benchmark-contract.md)에 기록한다.

---

## 9. 오류 처리 테스트

API error handling은 다음 mapping을 검증한다.

| Case | Status Code | Error Type |
|---|---:|---|
| Request schema/type error | 422 | `api_validation_error` |
| Core domain validation error | 400 | `core_validation_error` |
| Alert ID not found | 404 | `alert_not_found` |
| Persistence failure | 500 | `persistence_error` |
| Unexpected server error | 500 | `system_error` |

이 구분은 중요하다.

```text
422
→ 클라이언트가 request format/type을 잘못 보냄

400
→ request format은 맞지만 domain rule에 맞지 않음

500
→ 정상적인 validation 실패가 아니라 서버 내부 오류
```

---

## 10. 평가 무결성 신호 테스트

Critical override는 이 프로젝트에서 반드시 별도 테스트로 보호해야 하는 경로이다.

검증해야 하는 조건:

```text
rule_id == "evaluation_integrity_override"
category == "failure"
score == 0
is_critical_override == True
risk_score == 0
uncertainty_score == 0
level == "CRITICAL"
human_required == True
recommended_actions includes:
  - human_review_required
  - immediate_investigation
  - escalate_incident
```

이 테스트의 목적:

- system failure를 risk_score로 위장하지 않는다.
- failure signal은 일반 risk signal과 분리한다.
- critical override는 score가 아니라 override flag로 처리한다.

---

## 11. 테스트 실행

전체 테스트 실행:

```bash
python -m pytest -v
```

Unit test만 실행:

```bash
python -m pytest tests/Unit_Test -v
```

Integration test만 실행:

```bash
python -m pytest tests/Integration_Test -v
```

Design invariant test만 실행:

```bash
python -m pytest tests/Design_Invariant_Test -v
```

API test만 실행:

```bash
python -m pytest tests/API_Test -v
```

DB 및 benchmark workload test 실행:

```bash
python -m pytest tests/DB_Test tests/Benchmark_Test -v
```

특정 파일만 실행:

```bash
python -m pytest tests/API_Test/test_evaluate_endpoint.py -v
```

---

## 12. 변경 시 테스트 보강 기준

새 기능을 추가할 때는 다음 기준으로 테스트를 추가한다.

### 12.1 평가 규칙을 추가할 때

추가해야 할 테스트:

```text
Unit_Test/test_rule_evaluation.py
Unit_Test/test_signal_generation.py
Unit_Test/test_score_aggregation.py
Integration_Test/test_full_pipeline.py
Design_Invariant_Test/test_design_invariants.py
```

필요 시 API 응답까지 바뀐다면:

```text
API_Test/test_evaluate_endpoint.py
```

---

### 12.2 API 경로를 추가할 때

추가해야 할 테스트:

```text
API_Test/
```

검증해야 할 것:

```text
status code
response schema
error response schema
trace_id contract
invalid input handling
internal object exposure 여부
```

---

### 12.3 저장·조회 계층을 변경할 때

변경에 따라 보강할 테스트:

```text
tests/DB_Test/test_alert_repository.py
tests/API_Test/test_system_error.py
tests/API_Test/test_get_alerts.py
tests/API_Test/test_evaluate_endpoint.py
```

검증해야 할 것:

```text
POST /evaluate 결과 저장
GET /alerts 목록 조회
GET /alerts/{alert_id} 단건 조회
alert와 signal의 1:N 관계 보존
alert와 action의 1:N 관계 보존
DB failure handling
core가 DB에 의존하지 않는지 여부
```

---

## 13. 테스트 구조의 목적

이 프로젝트는 단순한 rule-based alert 예제가 아니다.

핵심은 다음 구조를 유지하는 것이다.

- risk와 uncertainty 분리
- failure와 risk 분리
- critical override와 score 분리
- human_required와 final_level 분리
- validation과 rule evaluation 분리
- API validation과 core validation 분리
- action generation과 decision interpretation 분리
- alert output과 decision recalculation 분리
- core layer와 API layer 분리

따라서 테스트도 단순 결과값 확인에 그치지 않고 각 계층의 책임이 섞이지 않도록 설계되어야 한다.

---

## 14. 요약

이 프로젝트의 테스트 전략은 core, API, 저장소 및 고정 workload를 함께 검증한다.

- 각 step의 기능이 올바르게 동작하는지 확인한다.
- 전체 core pipeline이 대표 케이스에서 설계대로 연결되는지 확인한다.
- API contract가 외부 사용자 관점에서 안정적으로 유지되는지 확인한다.
- 핵심 설계 원칙이 코드 변경으로 깨지지 않도록 보호한다.

테스트는 이 프로젝트에서 단순한 보조 수단이 아니라 decision boundary를 코드 수준에서 유지하기 위한 안전장치이다.
