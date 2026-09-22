# 벤치마크 워크로드 계약 v0

## 1. 목적

이 벤치마크는 `POST /evaluate` 정상 처리 경로의 초기 성능 기준선을 만들고, 이후 코드 변경으로 발생하는 성능 회귀를 같은 조건에서 비교하기 위해 사용한다.

```text
workload_type = synthetic_coverage
production_representative = false
```

실제 운영 트래픽 비율, 최대 처리량 또는 실제 사용자 응답 시간을 나타내지 않는다.

---

## 2. 측정 범위

FastAPI `TestClient`로 다음 API를 호출한다.

```text
POST /evaluate
```

측정 범위에는 다음 과정이 포함된다.

* API 요청 검증
* core 평가
* SQLite INSERT 및 commit
* 응답 모델 검증과 응답 생성
* middleware 처리
* 구조화 로그 생성과 메모리 handler 전달
* `TestClient` 처리 비용

다음 항목은 포함하지 않는다.

* 실제 TCP 네트워크
* Uvicorn 프로세스
* Docker 또는 VM
* 동시 사용자 요청
* 외부 로그 저장소
* 운영 서버의 자원 경합

---

## 3. 워크로드

다음 값을 고정한다.

```text
seed = 20260921
total_requests = 1000
scenario_count = 10
requests_per_scenario = 100
```

기본 입력값은 다음과 같다.

```text
decision_type = approve
confidence = 0.9
latency_ms = 300
model_version = benchmark-v1
error_code = null
metadata = {}
```

각 요청은 고유한 `event_id`를 가진다.

| 번호 | 시나리오             | 변경 입력                          | 예상 level   | human_required | Signal 수 | Action 수 |
| -: | ---------------- | ------------------------------ | ---------- | -------------: | -------: | -------: |
|  1 | 정상 approve       | 기본 입력                          | `INFO`     |        `false` |        0 |        1 |
|  2 | 정상 reject        | `decision_type="reject"`       | `INFO`     |        `false` |        0 |        1 |
|  3 | reject + 낮은 신뢰도  | `reject`, `confidence=0.5`     | `INFO`     |        `false` |        0 |        1 |
|  4 | approve + 낮은 신뢰도 | `confidence=0.5`               | `WARN`     |        `false` |        1 |        1 |
|  5 | 높은 입력 지연         | `latency_ms=2500`              | `WARN`     |        `false` |        1 |        1 |
|  6 | confidence 누락    | `confidence=null`              | `INFO`     |        `false` |        1 |        2 |
|  7 | model_version 누락 | `model_version=null`           | `INFO`     |        `false` |        1 |        2 |
|  8 | 높은 위험            | 낮은 신뢰도 + 높은 입력 지연              | `CRITICAL` |         `true` |        2 |        2 |
|  9 | 높은 위험 + 불확실성     | 시나리오 8 + `model_version=null`  | `WARN`     |         `true` |        3 |        3 |
| 10 | 무결성 override     | `error_code="gateway_failure"` | `CRITICAL` |         `true` |        1 |        3 |

`latency_ms`는 평가 대상 입력값이며, 실제 API 처리 시간과는 다른 값이다.

seed는 정해진 1,000건의 순서만 섞는다. 시나리오 비율과 입력값은 변경하지 않는다.

생성한 데이터는 JSONL로 보존하고 다음 정보를 포함한 manifest를 함께 관리한다.

* seed
* 전체 요청 수
* 시나리오별 요청 수
* 예상 결과 분포
* 데이터 파일 SHA-256

---

## 4. 예상 결과

```text
level:
- INFO: 500
- WARN: 300
- CRITICAL: 200

human_required:
- false: 700
- true: 300

latency_ms 입력:
- 300: 700
- 2500: 300

DB:
- alerts: 1000
- alert_signals: 1000
- alert_actions: 1700
```

---

## 5. 실행 환경과 반복 조건

공식 기준 환경은 다음과 같다.

```text
environment_id = windows-native-v0
execution_environment = Windows native Python
concurrency = 1
```

실행 조건은 다음과 같다.

* 동일한 Windows PC에서 실행한다.
* WSL, Docker, VM을 사용하지 않는다.
* 동일한 Python 가상환경을 사용한다.
* 전원 연결 상태에서 실행한다.
* 의도적인 고부하 작업을 함께 실행하지 않는다.
* 커밋된 코드와 깨끗한 Git working tree에서 실행한다.
* 요청은 한 건씩 순차 처리한다.

결과와 함께 다음 정보를 기록한다.

* Windows, CPU, 메모리 정보
* Python 및 SQLite 버전
* 주요 패키지 버전
* Git commit SHA
* 데이터셋 SHA-256
* 실행 시각

### Warm-up

별도 SQLite DB에서 100건을 실행한다.

```text
10개 시나리오 × 10건
```

warm-up의 시간, 로그 및 DB 데이터는 공식 결과에서 제외한다.

### 측정 실행

동일한 1,000건을 총 3회 실행한다.

```text
run 1: 새로운 SQLite DB
run 2: 새로운 SQLite DB
run 3: 새로운 SQLite DB
```

warm-up과 세 회차는 하나의 프로세스에서 실행한다. DB 스키마 생성과 결과 검증 시간은 요청 처리 시간에 포함하지 않는다.

---

## 6. 로그와 시간 측정

터미널 출력으로 인한 변동을 줄이기 위해 콘솔 handler를 메모리 수집 handler로 교체한다.

JSON 직렬화와 logger 호출은 실행하지만 터미널·파일·외부 저장소 I/O는 포함하지 않는다.

두 가지 시간을 기록한다.

```text
client_duration_ms
middleware_duration_ms
```

* `client_duration_ms`: runner가 `client.post()` 전체를 측정한 주 지표
* `middleware_duration_ms`: `request_completed` 로그에 기록된 보조 지표

각 요청의 원본 측정값은 반올림하지 않고 보존한다.

---

## 7. 결과 통계

각 회차를 독립적으로 집계한다.

* 요청 수
* 성공 수
* 오류 수
* 평균
* p50
* p95
* 최댓값

p50과 p95는 nearest-rank 방식으로 계산한다.

```text
rank = ceil(percentile × request_count)
```

1,000건에서는 정렬된 값의 500번째와 950번째를 사용한다.

전체 워크로드와 시나리오별 통계를 모두 보존한다. 세 회차의 3,000건을 합친 결과는 보조 정보로만 사용한다.

---

## 8. 정상 실행 조건

각 측정 회차는 다음 조건을 모두 만족해야 한다.

| 검증 항목                 | 정상 조건                      |
| --------------------- | -------------------------- |
| 전체 요청 수               | 1,000                      |
| HTTP 상태 코드            | 모두 `201`                   |
| 예외 수                  | 0                          |
| `result`              | 모두 `success`               |
| `failure_stage`       | 모두 `null`                  |
| `persistence_outcome` | 모두 `committed`             |
| 요청 로그                 | 요청당 `request_completed` 1건 |
| trace 연결              | header = body = log = DB   |
| trace ID              | 1,000개 모두 고유               |
| level·human 분포        | 예상 분포와 일치                  |
| DB 행 수                | 예상 행 수와 일치                 |
| 측정값                   | 요청별 값 누락 없음                |

하나라도 만족하지 못하면 해당 벤치마크 실행을 `INVALID`로 처리한다. 수집된 오류와 raw 결과는 보존하지만 p50·p95를 공식 기준선으로 사용하지 않는다.

느린 요청이나 높은 p95는 임의로 제거하지 않는다. 명확한 운영체제 업데이트, 절전 진입 또는 수동 고부하 작업이 확인된 경우에만 이유를 기록하고 전체 실행을 다시 시작한다.

---

## 9. 결과 보존

각 실행에서 다음 정보를 보존한다.

* 실행 환경과 Git commit
* benchmark 설정
* 데이터셋 SHA-256
* 요청별 시나리오와 trace ID
* 요청별 두 가지 처리 시간
* 회차별·시나리오별 통계
* 정상 조건 검증 결과
* 오류 수와 무효 사유

---

## 10. 비목표와 변경 정책

이 벤치마크는 다음을 증명하지 않는다.

* 실제 운영 성능
* 최대 RPS
* 동시 요청 처리 능력
* SQLite lock 경합 성능
* 네트워크 지연
* Docker·VM·클라우드 성능
* 10,000건 장시간 처리 안정성

워크로드, seed, 반복 횟수, 실행 환경 또는 통계 방식이 변경되면 기존 문서를 소급 수정하지 않고 새로운 계약 버전을 만든다.

서로 다른 계약 버전이나 실행 환경의 결과는 같은 기준선으로 직접 비교하지 않는다.
