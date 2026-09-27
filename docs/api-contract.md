# API 요청·응답 계약

이 문서는 `AI-Decision-Safety-Reliability-Monitoring-System`의 FastAPI API 계약을 정의한다.

API 계층은 요청을 검증하고, 평가 결과의 저장·조회와 HTTP 응답을 연결한다. 위험 수준과 인간 검토 여부는 core 평가 함수가 결정한다.

현재 제공하는 경로는 다음과 같다.

```text
POST /evaluate
GET  /alerts/{alert_id}
GET  /alerts
```

---

## 1. API의 역할

API가 수행하는 일:

- JSON 요청의 형식과 타입을 검증하고, core 입력 검증 오류와 구분한다.
- 평가 결과를 저장한 뒤 응답 모델에 맞는 JSON을 반환한다.
- 저장된 alert를 조회하고, 현재 요청을 헤더와 서버 로그의 `trace_id`로 추적한다.
- core 내부 객체를 그대로 응답에 노출하지 않고 평가 결과를 구조화한다.

위험 신호의 해석과 최종 수준 결정은 core 평가 단계에서 수행한다.

---

## 2. API 계층의 책임

API 계층의 책임은 다음과 같다.

- HTTP 경로와 요청·응답 모델 제공
- 요청 형식 검증 및 응답 모델 검증
- 요청별 `trace_id` 생성 및 `X-Trace-ID` 헤더 설정
- 예외를 안전한 HTTP 오류 응답으로 변환
- core 평가 결과와 저장 정보를 API 응답으로 변환

core 평가 함수가 담당하는 일:

- risk rule 판단
- uncertainty 계산
- critical override 판단
- final_level 결정
- human_required 결정
- action recommendation 생성

---

## 3. 요청 ID(`trace_id`) 계약

미들웨어는 요청마다 새 ID를 만들고 `X-Trace-ID` 응답 헤더와 해당 요청의 `request_completed` 로그에 기록한다. 저장된 alert에는 **생성 당시 평가 요청**의 ID를 보존한다.

| 응답 | 본문 `trace_id` | 헤더 `X-Trace-ID` | 두 값의 관계 |
|---|---|---|---|
| `POST /evaluate` 201 | 현재 평가 요청 ID | 현재 평가 요청 ID | 같음 (DB alert에도 저장) |
| 정의된 오류 응답 | 현재 실패 요청 ID | 현재 실패 요청 ID | 같음 |
| `GET /alerts/{alert_id}` 200 | alert 생성 당시 요청 ID | 현재 조회 요청 ID | 일반적으로 다름 |
| `GET /alerts` 200 | 최상위 필드 없음; 각 `alerts[]`에 생성 요청 ID | 현재 조회 요청 ID | 비교 대상이 다름 |

예를 들어 생성 요청의 ID가 `trace-create`이고 나중에 조회한 요청의 ID가 `trace-read`라면, 조회 본문은 `trace-create`, 헤더와 조회 로그는 `trace-read`를 담는다.

---

## 4. 저장된 alert 조회

### `GET /alerts/{alert_id}`: 한 건 조회

저장된 alert의 정수 `alert_id`로 조회한다. 찾으면 `200`과 `AlertDetailResponse`를 반환한다. 없으면 `404 alert_not_found`를 반환한다. 조회 응답의 본문 `trace_id`는 생성 요청 ID이므로 조회 요청의 헤더와 같을 필요가 없다.

### `GET /alerts`: 목록 조회

| 조회 조건 | 의미 |
|---|---|
| `limit` | 한 페이지 건수, 기본 5, 허용 범위 1~100 |
| `level`, `human_required` | 위험 수준과 인간 검토 필요 여부로 필터 |
| `created_from`, `created_to` | 시간대가 포함된 생성 시각 범위 (`created_from < created_to`) |
| `cursor_created_at`, `cursor_alert_id` | 다음 페이지 요청 시 두 값을 함께 제공 |

`200` 목록 응답의 최상위 필드는 `count`, `limit`, `alerts`, `next_cursor`다. `alerts`의 각 항목은 `alert_id`, 생성 요청의 `trace_id`, `created_at`, 평가 결과를 포함한다. 다음 페이지가 있으면 `next_cursor`의 `created_at`, `alert_id`를 다음 요청의 두 `cursor_` 조건에 넣는다. 마지막 페이지의 `next_cursor`는 `null`이다. 잘못된 조건에는 `422 api_validation_error`를 반환한다.

빈 목록의 응답 예시 (`X-Trace-ID` 헤더는 별도로 전송):

```json
{"count": 0, "limit": 5, "alerts": [], "next_cursor": null}
```

---

## 5. `POST /evaluate`: 평가 후 저장

### 역할

`POST /evaluate`는 하나의 의사결정 이벤트를 평가하고 SQLite에 저장한 뒤, `201`과 생성된 alert를 반환한다. 저장 실패 시 `500 persistence_error`를 반환한다.

---

### 요청

```http
POST /evaluate
Content-Type: application/json
```

요청 본문은 `EvaluateRequest` schema를 따른다.

```json
{
  "event_id": "evt_demo_001",
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

---

## 6. 평가 요청 필드 (`EvaluateRequest`)

| 필드 | 타입 | 필수 | 의미 |
|---|---|---:|---|
| `event_id` | `str` | 필수 | 이벤트 식별자 |
| `decision_type` | `str \| null` | 선택 | AI 또는 시스템의 판단 유형 |
| `confidence` | `float \| null` | 선택 | 판단 신뢰도 |
| `latency_ms` | `int \| null` | 선택 | 입력 이벤트가 보고한 지연 시간; API 처리 시간과 다름 |
| `model_version` | `str \| null` | 선택 | 모델 버전 |
| `error_code` | `str \| null` | 선택 | 입력 이벤트가 보고한 오류 코드 |
| `metadata` | `object` | 선택 | 추가 메타데이터 |

현재 `metadata`의 기본값은 빈 object이다.

```json
{
  "metadata": {}
}
```

---

## 7. 평가 응답 필드 (`EvaluateResponse`)

정상 평가 응답은 `EvaluateResponse` schema를 따른다.

| 필드 | 타입 | 의미 |
|---|---|---|
| `alert_id` | `int` | 저장된 alert ID |
| `created_at` | `datetime` | 저장 시각 (UTC) |
| `trace_id` | `str` | alert를 생성한 평가 요청 ID |
| `event_id` | `str` | 평가된 이벤트 ID |
| `level` | `str` | 최종 해석 level |
| `risk_score` | `int` | risk category signal의 score 합 |
| `uncertainty_score` | `int` | uncertainty category signal의 score 합 |
| `human_required` | `bool` | 인간 검토 필요 여부 |
| `recommended_actions` | `list[str]` | 운영 행동 후보 |
| `reason_summary` | `str` | gate/action 판단 요약 |
| `signals` | `list[SignalResponse]` | 발동된 signal 목록 |
| `metadata` | `object` | 입력 metadata |

---

## 8. 위험 신호 필드 (`SignalResponse`)

각 signal은 발동된 rule을 외부 응답 형식으로 구조화한 것이다.

| 필드 | 타입 | 의미 |
|---|---|---|
| `rule_id` | `str` | 발동된 rule ID |
| `category` | `str` | signal category |
| `score` | `int` | signal score |
| `reason` | `str` | signal 발생 이유 |
| `evidence` | `object` | 판단 근거 필드 |
| `is_critical_override` | `bool` | critical override 여부 |
| `metadata` | `object` | rule-level metadata |

예시:

```json
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
}
```

---

## 9. 정상 평가 예시

### 요청

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

---

### 응답

상태 코드:

```text
201 Created
```

응답 본문:

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

---

## 10. 평가 무결성 신호 예시

### 요청

```json
{
  "event_id": "evt_demo_failure_override",
  "decision_type": "approve",
  "confidence": 0.9,
  "latency_ms": 300,
  "model_version": "v1",
  "error_code": "gateway_failure",
  "metadata": {}
}
```

---

### 응답 요약

```text
level: CRITICAL
risk_score: 0
uncertainty_score: 0
human_required: true
```

예상 신호:

```json
{
  "rule_id": "evaluation_integrity_override",
  "category": "failure",
  "score": 0,
  "reason": "evaluation integrity failure requires critical review",
  "evidence": {
    "error_code": "gateway_failure"
  },
  "is_critical_override": true,
  "metadata": {
    "failure_type": "system_error",
    "score_contribution": "none",
    "override_type": "critical"
  }
}
```

예상 행동:

```text
human_review_required
immediate_investigation
escalate_incident
```

이 예시의 `gateway_failure`는 **입력 이벤트가 보고한 평가 무결성 신호**다. API나 SQLite 자체의 장애를 뜻하지 않는다. 저장에 성공하면 이 요청도 `201`을 반환한다.

---

## 11. 오류 응답 필드 (`ErrorResponse`)

에러 응답은 `ErrorResponse` schema를 따른다.

| 필드 | 타입 | 의미 |
|---|---|---|
| `trace_id` | `str` | 요청 추적 ID |
| `error_type` | `str` | 에러 분류 |
| `message` | `str` | 에러 메시지 |
| `details` | `list[object]` | 상세 에러 정보; 422는 필드별 검증 오류, 서버 오류는 빈 배열 |

필수 `event_id`가 빠졌을 때의 축약 예시 (실제 검증 오류에는 입력값 등 다른 필드가 추가될 수 있다):

```json
{
  "trace_id": "generated-trace-id",
  "error_type": "api_validation_error",
  "message": "Request format or type is invalid.",
  "details": [
    {"loc": ["body", "event_id"], "msg": "Field required", "type": "missing"}
  ]
}
```

---

## 12. HTTP 상태 코드

| 상태 코드 | 오류 유형 | 의미 |
|---:|---|---|
| 201 | - | 평가 결과 저장 후 정상 응답 (`POST /evaluate`) |
| 200 | - | alert 단건·목록 조회 |
| 400 | `core_validation_error` | JSON 형식은 맞지만 core domain validation 위반 |
| 404 | `alert_not_found` | alert ID 없음 |
| 422 | `api_validation_error` | 요청 body 또는 조회 query의 형식·타입 오류 |
| 500 | `persistence_error` | DB 저장 또는 조회 실패 |
| 500 | `system_error` | 예상하지 못한 서버 내부 오류 |

---

### 404 응답 예시

alert ID를 찾지 못한 경우의 응답 본문:

```json
{
  "trace_id": "current-read-trace-id",
  "error_type": "alert_not_found",
  "message": "Alert not found",
  "details": [{"alert_id": 999}]
}
```

이 오류의 본문 `trace_id`는 현재 조회 요청의 헤더와 같다.

---

## 13. 400: 평가 규칙에 맞지 않는 입력

### 의미

400은 request body가 API schema는 통과했지만 core domain validation에서 거부된 경우이다.

즉 JSON 구조와 타입은 맞지만 시스템의 domain rule에 맞지 않는 입력이다.

---

### 예시

```text
confidence = 1.5
latency_ms = -1
decision_type = "pending"
event_id = "   "
```

---

### 응답

상태 코드:

```text
400 Bad Request
```

응답 본문:

```json
{
  "trace_id": "generated-trace-id",
  "error_type": "core_validation_error",
  "message": "core validation error message",
  "details": []
}
```

---

## 14. 422: 요청 형식 오류

### 의미

422는 요청 본문 또는 조회 조건이 API 스키마 검증을 통과하지 못한 경우이다.

`POST /evaluate`의 입력 형식 오류는 core 평가 전에 차단된다. 조회 조건 오류는 DB 조회 전에 차단된다.

---

### 예시

```text
event_id = 1234
confidence = "not-a-number"
latency_ms = "slow"
metadata = "not-an-object"
limit = 0 (GET /alerts)
cursor_created_at만 전달 (GET /alerts)
```

---

### 응답

상태 코드:

```text
422 Unprocessable Entity
```

응답 본문:

```json
{
  "trace_id": "generated-trace-id",
  "error_type": "api_validation_error",
  "message": "Request format or type is invalid.",
  "details": [
    {
      "loc": ["body", "field_name"],
      "msg": "error message",
      "type": "error_type"
    }
  ]
}
```

---

## 15. 500: 저장 또는 서버 내부 오류

### 의미

500은 저장 실패(`persistence_error`) 또는 서버 내부 오류(`system_error`)가 발생한 경우이다. 응답 모델 검증이 저장 완료 후 실패하면 HTTP 결과는 500이어도 DB에는 저장된 상태일 수 있다.

| 500 원인 | 클라이언트 `error_type` | 서버 로그 `failure_stage` | 쓰기 결과 예시 |
|---|---|---|---|
| 저장 실패·rollback 성공 | `persistence_error` | `persistence` | `rolled_back` |
| rollback 결과 확인 실패 | `persistence_error` | `persistence` | `unknown` |
| commit 후 응답 검증 실패 | `system_error` | `response_validation` | `committed` |

저장 오류의 클라이언트 메시지는 `Database operation failed`이며, 오류 본문에는 DB 예외의 세부 내용이나 쓰기 결과를 넣지 않는다.

서버 요청 로그의 `failure_stage`는 실패 위치를 나타낸다 (`api_validation`, `core_evaluation`, `resource_lookup`, `persistence`, `response_validation` 또는 `unknown`). `persistence_outcome`은 **현재 요청의 쓰기 결과**를 나타내며 `not_attempted`, `committed`, `rolled_back`, `unknown` 중 하나다. 조회 요청의 응답이 성공해도 쓰기를 시도하지 않았으므로 `not_attempted`로 기록한다. 이 필드들은 클라이언트 오류 응답에 포함되지 않는다. 미들웨어는 최종 `status_code`로부터 `result`를 계산하고 요청당 `request_completed` JSON 로그를 한 번 남긴다.

이 에러는 정상적인 validation 실패가 아니다.

---

### 응답

상태 코드:

```text
500 Internal Server Error
```

응답 본문:

```json
{
  "trace_id": "generated-trace-id",
  "error_type": "system_error",
  "message": "Unexpected internal server error",
  "details": []
}
```

---

## 16. 422와 400의 구분

이 시스템은 validation을 두 계층으로 나눈다.

```text
API validation
→ 요청 형식과 타입 검증

Core validation
→ domain rule 검증
```

구분 기준:

| 입력 | 검증 단계 | 상태 코드 |
|---|---|---:|
| `confidence = "not-a-number"` | API validation | 422 |
| `confidence = 1.5` | Core validation | 400 |
| `latency_ms = "slow"` | API validation | 422 |
| `latency_ms = -1` | Core validation | 400 |
| `decision_type = "pending"` | Core validation | 400 |
| `event_id = "   "` | Core validation | 400 |
| `metadata = "not-an-object"` | API validation | 422 |

이 분리는 운영 관점에서 중요하다.

```text
422
→ 클라이언트가 request format/type을 잘못 보냄

400
→ request format은 맞지만 domain rule에 맞지 않음
```

---

## 17. 응답에서 유지할 규칙

정의된 응답에서 유지할 규칙은 다음과 같다.

- 현재 요청의 `trace_id`는 응답 헤더와 요청 완료 로그에 포함된다.
- 평가 성공·전용 오류 응답의 본문 `trace_id`는 헤더와 같다.
- 조회 성공 응답은 저장된 alert의 생성 요청 ID를 보존하며, 목록 응답의 최상위에 `trace_id`를 추가하지 않는다.
- 정상 평가 응답은 EvaluateResponse schema를 따르고, 조회 응답은 AlertDetailResponse 또는 AlertListResponse를 따른다.
- 에러 응답은 ErrorResponse schema를 따른다.
- SignalResponse는 is_critical_override 필드를 사용한다.
- API response는 내부 core object를 그대로 노출하지 않는다.
- failure signal은 risk_score에 합산되지 않는다.
- uncertainty signal은 risk_score에 합산되지 않는다.

---

## 18. 현재 제공하지 않는 기능

현재 API는 MVP 범위이다.

아직 포함되지 않은 것:

```text
- authentication
- authorization
- 외부 로그 수집·모니터링 연동
- rate limiting
- deployment configuration
```
