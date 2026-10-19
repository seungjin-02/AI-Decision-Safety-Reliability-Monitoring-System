# 구조와 평가 정책

## 계층과 데이터 흐름

```text
POST /evaluate → 요청 검증 → evaluation_service → core.evaluate_event
              → AlertRepository 트랜잭션 → 응답 검증 → 201
GET /alerts[/id] → AlertRepository → 조회 응답 모델 → JSON
대시보드 → API adapter → controller 검증 → render
```

| 위치 | 책임 |
| --- | --- |
| `app/main.py`, `app/schemas.py` | HTTP 경로, 요청·응답 검증, 오류 변환, 요청 trace |
| `app/services/evaluation_service.py` | API 입력과 core 연결, 저장 후 응답 매핑 |
| `app/db/` | schema 초기화, 외래키, 저장·조회, rollback |
| `core/` | HTTP·DB에 의존하지 않는 이벤트 평가 |
| `frontend/src/` | 조회와 표시; 서버 판단을 재계산하지 않음 |

core는 검증 → 정규화 → 누락/평가 제한 context → 규칙 → 신호 → 점수 집계 → gate → 권장 조치 → 결과 조립 순서다. 최종 수준·검토 여부는 `step07_GateInterpretation.py`에서 결정한다. 출력 조립은 판단을 다시 하지 않는다.

## 입력 검증과 누락

API는 Pydantic 요청 모델로 형식·타입을 검증하며 변환 가능한 값은 모델의 형 변환을 따를 수 있다. 변환 후 core는 아래 의미 제약을 검사한다. API 검증 실패는 422, core 검증 실패는 400이다.

| 필드 | core 제약 / 누락 의미 |
| --- | --- |
| `event_id` | 비어 있지 않은 문자열 필수; 공백 제거 |
| `confidence` | null 또는 bool이 아닌 0~1 숫자; null이면 불확실성 신호 |
| `latency_ms` | null 또는 bool이 아닌 0 이상 정수; null이면 지연 규칙을 평가하지 못함 |
| `decision_type` | null 또는 approve/reject(공백·대소문자 정규화); 빈 문자열은 오류, null이면 관련 규칙 제한 |
| `model_version` | null 또는 문자열; 빈 문자열은 null로 정규화, 누락 신호 발생 |
| `error_code` | null 또는 문자열; 공백·대소문자 정규화, null은 실패 신호 아님 |
| `metadata` | dict; API에서는 생략 시 빈 객체 |

잘못된 값은 누락/불확실성으로 바꾸지 않고 차단한다. 누락된 `decision_type`과 `latency_ms`는 context에 기록되지만 자체 uncertainty 점수는 만들지 않는다.

## 신호 규칙

정의: `core/step04_RuleEvaluation.py`. 입력 지연·실패 코드는 외부 이벤트의 값이며 서비스 자체의 장애 관측값이 아니다.

| 규칙 | 발동 조건 | 범주 / 점수 |
| --- | --- | --- |
| `approve_confidence_low` | approve이며 confidence ≤ 0.6 | risk / 3 |
| `latency_high` | latency_ms ≥ 2000 | risk / 2 |
| `missing_confidence` | confidence 누락 | uncertainty / 1 |
| `missing_model_version` | model_version 누락 | uncertainty / 1 |
| `evaluation_integrity_override` | timeout_01 또는 gateway_failure | failure / 0, override=true |
| `stability_signal` | 현재 기본 규칙은 항상 false | stability / 0 |

risk와 uncertainty 점수는 각 범주만 합산한다. failure는 위험 점수에 더하지 않는다.

## Gate 판단

override가 최우선이다. 그 외 기본 판단은 다음과 같다.

| 조건 | level | human_required |
| --- | --- | --- |
| override 존재 | CRITICAL | true |
| risk ≥ 4, uncertainty = 0 | CRITICAL | true |
| risk ≥ 4, uncertainty ≥ 1 | WARN | true |
| 2 ≤ risk < 4, uncertainty = 0 | WARN | false |
| 2 ≤ risk < 4, uncertainty ≥ 1 | WARN | true |
| risk < 2 | INFO | false |

별도 stability 신호가 전달되면 WARN·risk ≤ 2·uncertainty = 0에서 INFO로 완화하는 경로도 있다. 현재 기본 신호 규칙은 이를 발동시키지 않는다.

`human_required`는 `auto_finalize_allowed`의 반대값으로 구성되지만, 자동화 허용이라는 내부 표현이 최종 업무 승인이나 안전 보장을 의미하지 않는다. API와 화면은 level에서 검토 여부를 유추하지 않는다.

## 권장 조치와 저장

`step08_ActionGeneration.py`는 아래 순서로 조치를 추가한다. gate를 재분류하지 않는다.

1. 검토 필요 시 `human_review_required`
2. override 시 `immediate_investigation`
3. uncertainty 신호 시 `review_missing_or_incomplete_information`
4. 최종 수준별 CRITICAL: `escalate_incident`, WARN: `monitor_closely`, INFO: `no_immediate_action_required`

`reason_summary`는 gate 사유를 사용하고 각 signal.reason은 규칙 원문을 유지한다.

Repository는 `alerts`와 연결된 `alert_signals`, `alert_actions`를 한 트랜잭션으로 저장한다. 생성 요청 trace와 UTC 저장 시각, action 순서를 보존한다. 자식 저장 실패 시 rollback 결과를 구분한다. 기존 DB의 schema는 기동 시 검증하며 임의 마이그레이션하지 않는다. GET은 저장하지 않는다.

HTTP·로그·노출 필드의 상세 계약은 [API 계약](api-contract.md), 화면 상태는 [프론트 안내](../frontend/README.md)를 따른다.
