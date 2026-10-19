# API 계약

모델 정의는 `app/schemas.py`, 경로·예외 처리는 `app/main.py`다. 실행 중 `/docs`와 `/openapi.json`에서 스키마를 확인할 수 있다.

## 평가·저장

`POST /evaluate`는 아래 이벤트를 평가·저장하고 201을 반환한다.

```json
{
  "event_id": "review_001",
  "decision_type": "approve",
  "confidence": 0.3,
  "latency_ms": 100,
  "model_version": null,
  "error_code": null,
  "metadata": {}
}
```

`event_id`는 필수다. 나머지 문자열·숫자 필드는 선택/null 허용, metadata는 object이며 기본값 `{}`다. 입력 의미 제약은 [평가 정책](architecture.md#입력-검증과-누락)을 따른다. 이 예시는 WARN, risk_score=3, uncertainty_score=1, human_required=true, 낮은 승인 신뢰도·모델 버전 누락 신호를 만든다. event_id는 중복 제거 키가 아니므로 같은 입력의 재전송도 새 Alert를 생성한다.

| 응답 필드 | 타입 / 의미 |
| --- | --- |
| `alert_id` | int, 저장된 기본키 |
| `event_id` | str, 입력 이벤트 식별자 |
| `trace_id` | str, 생성 요청 trace |
| `created_at` | UTC datetime, Alert 저장 시각 |
| `level` | INFO / WARN / CRITICAL |
| `human_required` | bool, 사람 검토 요구 |
| `risk_score`, `uncertainty_score` | int, 범주별 신호 점수 합계 |
| `reason_summary` | str, 최종 평가 사유 원문 |
| `signals` | signal 배열 |
| `recommended_actions` | 순서가 있는 조치 코드 배열 |
| `metadata` | object, POST 응답에만 포함 |

signal은 `rule_id`, `category`, `score`, `reason`, `evidence`, `is_critical_override`를 포함한다. POST에는 signal.metadata도 포함된다. category는 risk/uncertainty/failure/stability이며 evidence는 object다.

## 상세·목록 조회

`GET /alerts/{alert_id}`는 200과 상세를 반환하며, ID가 없으면 404다. 상세와 목록의 각 항목은 위 평가 응답에서 alert·signal metadata를 제외한 구조다. DB 원본을 수정하지 않으며 null 근거를 보존한다.

GET evidence는 다음 키만 제공한다. 미정의 규칙은 빈 객체다.

| rule_id | 허용 키 |
| --- | --- |
| approve_confidence_low | decision_type, confidence |
| latency_high | latency_ms |
| missing_confidence | confidence |
| missing_model_version | model_version |
| evaluation_integrity_override | error_code |
| stability_signal | 없음 |

`GET /alerts` 조건은 AND로 적용한다.

| query | 값 |
| --- | --- |
| `limit` | 1~100, 기본 5 |
| `level` | INFO / WARN / CRITICAL, 생략하면 전체 |
| `human_required` | true / false, 생략하면 전체 |
| `sort_order` | desc(기본) / asc |
| `created_from`, `created_to` | 시간대가 포함된 datetime; 한쪽만 사용 가능 |
| `cursor_created_at`, `cursor_alert_id` | 시간대 포함 datetime와 양의 정수 ID를 함께 전달 |

날짜는 저장 시각의 시작 포함·종료 제외다. 양쪽이 있으면 시작 < 종료여야 한다. 필터 후 `(created_at, alert_id)`를 지정 방향으로 정렬하고 LIMIT를 적용한다. 커서는 desc에서 작은 시각·ID, asc에서 큰 시각·ID로 진행한다. 고정 DB 스냅샷은 아니다.

```json
{"count": 0, "limit": 5, "alerts": [], "next_cursor": null}
```

count는 **이번 페이지** 건수다. 다음 페이지가 있으면 next_cursor는 마지막 항목의 `created_at`, `alert_id`다. 같은 조회 조건·정렬에 이 값을 두 cursor query로 전달한다. 마지막 페이지는 null이며 전체 건수·총 페이지 수는 제공하지 않는다.

## 오류

정의된 API 오류는 `trace_id`, `error_type`, `message`, `details`를 포함한다. details는 object 배열이며 검증 오류는 필드 정보, 상세 404는 alert_id, 서버 오류는 빈 배열을 사용한다.

| HTTP | error_type | 의미 |
| --- | --- | --- |
| 400 | core_validation_error | core 의미 제약 위반 |
| 404 | alert_not_found | 상세 ID 없음 |
| 422 | api_validation_error | 요청 body/query 검증 실패 |
| 500 | persistence_error | 저장·조회 실패 |
| 500 | system_error | 예상하지 못한 예외·응답 검증 실패 |

예: confidence=1.5는 400, 변환 불가능한 confidence 문자열은 422다. 저장 실패 응답에는 정상 평가 결과를 반환하지 않는다. 이 표는 정의된 API 경로의 오류 계약이며 모든 비존재 경로의 404 형식까지 보장하지 않는다.

## Trace와 로그

| 위치 | trace 의미 |
| --- | --- |
| POST body와 header, 저장된 Alert | 생성 평가 요청 ID |
| GET body의 Alert.trace_id | 과거 생성 평가 요청 ID |
| GET X-Trace-ID | 현재 조회 요청 ID |
| 정의된 오류 body·header | 현재 실패 요청 ID |

목록 최상위에는 trace_id가 없고 각 Alert가 생성 trace를 갖는다. GET을 반복해도 body/DB 생성 trace는 바뀌지 않는다. 응답을 받지 못한 클라이언트는 서버 trace를 확인할 수 없으며 이전 값으로 대체하지 않는다.

미들웨어는 요청마다 `request_completed` JSON 로그를 한 건 기록한다. timestamp, level, trace_id, method, path, status_code, result, duration_ms, failure_stage, persistence_outcome을 포함하며 body 전체는 기록하지 않는다.

- 정상 POST: 201 / success / failure_stage=null / persistence_outcome=committed
- 정상 GET: 200 / success / failure_stage=null / persistence_outcome=not_attempted
- 오류 단계: api_validation, core_evaluation, resource_lookup, persistence, response_validation, unknown
- 저장 결과: not_attempted, committed, rolled_back, unknown. 실패 단계와 독립적으로 해석한다.
