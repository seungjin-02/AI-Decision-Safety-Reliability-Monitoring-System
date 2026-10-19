# AI Decision Safety & Reliability Monitoring

AI 의사결정 이벤트의 위험 신호와 불확실성을 분리해 평가하고, 사람이 검토할 근거를 제공하는 FastAPI·SQLite 서비스다. 저장된 Alert는 한국어 대시보드에서 조회한다. 최종 승인·거절이나 사건 간 우선순위는 결정하지 않는다.

## 시작하기

Python 3.11+가 필요하다. Node.js 24+는 프론트 테스트에만 사용하며 npm 설치는 필요 없다.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe c2_dashboard_local.py --db data/demo.db --port 8001
```

- 대시보드: <http://127.0.0.1:8001/dashboard/>
- 평가 입력: <http://127.0.0.1:8001/docs>의 `POST /evaluate`
- PyCharm: 프로젝트 인터프리터를 지정하고 `c2_dashboard_local.py`를 실행한다. 공유 Run 설정은 `.run/c2_dashboard_local.run.xml`이다.

실행기가 프론트를 빌드하고 지정 DB로 서버를 시작한다. 새 DB는 비어 있으며 예시를 자동 추가하지 않는다. 기존 DB는 재사용한다. 인수 없이 실행하면 **이미 존재하는** `data/c2-demo.db`와 포트 8000을 사용한다. DB 파일과 생성된 `frontend/dist/`는 Git에서 제외한다.

기본 사용자 DB `data/alerts.db`는 위 실행기에서 거부한다. 이 DB로 API를 실행하려면 별도로 `python -m uvicorn app.main:app --host 127.0.0.1 --port 8000`을 사용한다. 대시보드는 먼저 `python frontend/build_web.py`로 빌드한다. 포트가 점유됐으면 다른 `--port`를 사용한다.

## 제공 기능

| 경로 | 동작 |
| --- | --- |
| `POST /evaluate` | 이벤트 평가·저장 후 201 |
| `GET /alerts` | 필터·정렬·커서 기반 목록 조회 |
| `GET /alerts/{alert_id}` | 저장된 Alert 상세 조회 |
| `/dashboard/` | 실제 API 조회 화면 |
| `/dashboard/?mode=mock` | 명시적 합성 예시 화면 |

대시보드는 탐색·조사·집중 읽기, 조회 조건 적용, 더보기, ID 직접 조회를 제공한다. API 실패를 예시 데이터로 대체하지 않는다. 평가 생성은 Swagger/API에서 수행한다.

## 결과 해석

- `risk_score`와 `uncertainty_score`는 범주별 신호 점수 합계이며 확률이 아니다.
- `level`과 `human_required`는 별도 판단값이다. INFO 또는 검토 요구 없음은 안전 보장이 아니다.
- 실패 코드는 입력 이벤트의 보고값이다. 모니터링 서비스가 직접 관측한 장애로 해석하지 않는다.
- 권장 조치는 제안이며 실행·검토 완료를 뜻하지 않는다.
- GET body의 `trace_id`는 생성 요청 ID, 응답 `X-Trace-ID`는 현재 조회 요청 ID다.

## 검증

```powershell
python frontend/build_web.py
python -m pytest -q tests frontend/tests/test_local_launcher.py
node --test --test-isolation=none frontend/tests/*.test.mjs
python -B frontend/tests/output-safety.test.py
python -B frontend/tests/verify-core-examples.py
```

테스트 범위와 실제 HTTP·브라우저 검증 방법은 [테스트 안내](docs/test-strategy.md)에 정리했다. CI는 Python 회귀 테스트를 실행한다.

## 문서와 구조

| 위치 | 책임 |
| --- | --- |
| [API 계약](docs/api-contract.md) | 요청·응답, 조회 조건, 오류와 trace |
| [구조·평가 정책](docs/architecture.md) | 계층 책임, 입력 검증, 판단 규칙 |
| [프론트 안내](frontend/README.md) | 빌드·모드·조회 상태 흐름 |
| [화면 계약](frontend/DESIGN.md) | 표시 의미, 배치, 키보드 동작 |
| `core/`, `app/`, `frontend/src/` | 평가, HTTP·저장, 화면 원본 |
| `tests/`, `frontend/tests/` | 실행 가능한 회귀 검증 |

벤치마크 재현 방법은 [측정 계약](docs/benchmark-contract.md), 기존 측정 결과는 [기준선](docs/benchmark-baseline.md)을 따른다. `benchmarks/`의 고정 workload와 공식 결과 계약을 유지한다.

현재 인증·권한 관리, 검토 완료 저장, 운영 배포 자동화는 제공하지 않는다. 글꼴은 외부 CDN을 사용한다.
