# C2 의사결정 모니터

FastAPI의 Alert를 조회하는 한국어 대시보드다. 목록 조회·더보기·ID 직접 조회와 탐색·조사·집중 읽기 보기를 제공한다. 평가 생성이나 승인·처리 완료 기능은 제공하지 않는다. 화면 동작과 표시 원칙은 [DESIGN.md](DESIGN.md), 요청·응답 형식은 [API 계약](../docs/api-contract.md)을 따른다.

## 로컬 실행

저장소 루트에서 실행한다. Python 3.11 이상을 사용하며, 프론트 회귀 테스트에는 Node.js 24 이상이 필요하다. npm 설치나 별도 프론트 서버는 필요 없다.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe c2_dashboard_local.py --db data/demo-new.db --port 8001
```

- 위 명령은 화면을 자동 빌드하고 `http://127.0.0.1:8001/dashboard/`와 `/docs`를 제공한다. 새 경로이면 부모 폴더를 만들고 빈 DB로 시작하며, 기존 DB이면 재사용한다.
- 예시 데이터를 자동 생성하지 않으므로 새 DB의 실제 API 목록은 비어 있다. Swagger의 `POST /evaluate`로 비민감 이벤트를 저장하거나, 화면 확인만 필요하면 `/dashboard/?mode=mock`을 사용한다.
- DB 파일은 Git에 포함되지 않고 종료 후에도 남는다. 인자 없이 실행할 때의 기본값은 기존 `data/c2-demo.db`와 포트 8000이다. 해당 DB가 없으면 오류로 종료한다.
- 실행기는 사용자 DB `data/alerts.db`를 거부한다. 이 DB로 직접 실행하려면 부모 폴더 `data`를 먼저 준비하고 화면을 빌드한다. 명령은 [메인 실행 안내](../README.md#api-서버-실행)를 따른다.
- 포트 충돌은 기존 서버를 종료하거나 `--port`를 바꿔 해결한다. DB를 삭제할 필요는 없다. 종료는 Ctrl+C 또는 IDE의 정지 버튼을 사용한다.

PyCharm에서는 프로젝트 인터프리터를 설정하고 루트의 `c2_dashboard_local.py`를 실행 대상으로, 저장소 루트를 작업 디렉터리로, `--db data/demo-new.db --port 8001`을 매개변수로 지정한다. `.idea`는 Git 제외 대상이므로 개인 실행 설정은 clone한 저장소에 포함되지 않는다.

## 실행 모드와 빌드

| 경로 | 데이터 |
|---|---|
| `/dashboard/` | 같은 출처의 `/alerts`, `/alerts/{alert_id}` GET 응답 |
| `/dashboard/?mode=mock` | `fixtures/alerts.json`의 합성 예시 |

API 실패 시 mock으로 전환하지 않는다. `preview` 매개변수는 mock 모드에서만 적용한다. 모드 표시는 운영 환경이나 데이터 민감도를 보증하지 않는다.

```powershell
python frontend/build_web.py
```

원본은 `src/`와 `fixtures/`이며, FastAPI는 생성된 `dist/`만 제공한다. **`dist/`는 Git 제외 생성물이므로 직접 수정하지 않는다.** 빌드가 없으면 대시보드는 503과 빌드 안내를 표시하며 기존 API는 동작한다. 글꼴은 외부 CDN을 사용하고, 로드 실패 시 시스템 글꼴로 대체한다.

## 코드 구조

| 파일 | 역할 |
|---|---|
| `src/entry.js` | API/mock 모드 선택과 초기 조회 |
| `src/api-adapter.js`, `src/mock-adapter.js` | HTTP 조회 또는 합성 예시 조회 |
| `src/display-contract.mjs` | 입력·응답 검증, 조회 상태, 사유 표시 매핑 |
| `src/app.js` | 렌더링, 이벤트, 보기 전환과 포커스 |
| `src/styles.css`, `src/index.html` | 화면 스타일과 시작 문서 |
| `build_web.py` | 배포용 정적 파일 생성 |

## 검증

저장소 루트에서 실행한다. 아래 명령은 빌드, 프론트 동작·출력 안전성, 합성 예시의 core 결과, 실행기·대시보드 API 경계를 확인한다.

```powershell
python frontend/build_web.py
node --test --test-isolation=none frontend/tests/*.test.mjs
python -B frontend/tests/output-safety.test.py
python -B frontend/tests/verify-core-examples.py
.\.venv\Scripts\python.exe -m pytest -q tests frontend/tests/test_local_launcher.py
```

CI도 이 검증과 생성 JavaScript 구문 검사를 실행한다. 기본 `python -m pytest`만으로는 Node·출력 안전성·core 예시·실행기 검증 전체가 실행되지 않는다. Node 테스트에는 제한된 DOM 대역을 사용하므로 실제 Chrome의 레이아웃·포커스·네트워크 동작은 아래 브라우저 검증으로 별도 확인한다.

실제 HTTP와 브라우저까지 확인할 때는 **새 빈 격리 DB**를 사용한다. 첫 명령은 별도 터미널에서 계속 실행하고, 나머지는 다른 터미널에서 순서대로 실행한다. HTTP 검증 스크립트가 합성 Alert 240건을 생성하므로 기존 사용자·시연 DB에는 실행하지 않는다.

```powershell
.\.venv\Scripts\python.exe c2_dashboard_local.py --db ../frontend-qa-new/alerts.db --port 8001
.\.venv\Scripts\python.exe frontend/tests/verify-query-controls.py --db ../frontend-qa-new/alerts.db --port 8001 --output ../frontend-qa-new/http-evidence.json
node frontend/tests/browser-query-controls.mjs --evidence ../frontend-qa-new/http-evidence.json --output ../frontend-qa-new/browser-run
```

브라우저 검증에는 Chrome과 Playwright가 별도로 필요하다. Playwright 모듈 경로는 필요하면 `--playwright '설치된 패키지/index.mjs'`로 지정한다. `--output`에는 존재하지 않는 새 브라우저 증거 폴더를 사용한다. DB·HAR·스크린샷 등 실행별 증거는 Git 밖에 보관한다. 이 검증은 접근성 표준 전체 준수나 운영 배포 검증을 뜻하지 않는다.
