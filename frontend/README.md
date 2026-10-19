# C2 의사결정 모니터

FastAPI의 Alert를 조회하는 한국어 대시보드다. 목록 조회·더보기·ID 직접 조회와 탐색·조사·집중 읽기 보기를 제공한다. 평가 생성이나 승인·처리 완료 기능은 제공하지 않는다. 화면 동작과 표시 원칙은 [DESIGN.md](DESIGN.md), 요청·응답 형식은 [API 계약](../docs/api-contract.md)을 따른다.

## 로컬 실행

저장소 루트에서 실행한다. Python 3.11 이상을 사용하며, 프론트 회귀 테스트에는 Node.js 24 이상이 필요하다. npm 설치나 별도 프론트 서버는 필요 없다.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe c2_dashboard_local.py
```

- 실행기가 화면을 자동 빌드하고 `http://127.0.0.1:8000/dashboard/`를 제공한다.
- 기본 DB는 기존 `data/c2-demo.db`다. 파일이 없으면 오류로 종료하며, 예시 데이터를 자동 생성하지 않는다.
- 새 빈 DB로 시작하려면 `--db data/demo-new.db --port 8001`처럼 경로를 명시한다. 기존 DB를 지정하면 재사용한다.
- 실행기는 사용자 DB `data/alerts.db`를 거부한다. 이 DB로 API를 실행하려면 화면을 별도로 빌드한 뒤 `python -m uvicorn app.main:app --host 127.0.0.1 --port 8000`을 사용한다.
- 포트 충돌은 기존 서버를 종료하거나 `--port`를 바꿔 해결한다. DB를 삭제할 필요는 없다. 종료는 Ctrl+C 또는 IDE의 정지 버튼을 사용한다.

PyCharm에서는 프로젝트 인터프리터를 설정한 뒤 공유 실행 설정 `c2_dashboard_local` 또는 루트의 `c2_dashboard_local.py`를 실행한다.

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
.\.venv\Scripts\python.exe -m pytest -q frontend/tests/test_local_launcher.py tests/API_Test/test_dashboard.py
```

실제 HTTP와 브라우저까지 확인할 때는 **새 빈 격리 DB**를 사용한다. 첫 명령은 별도 터미널에서 계속 실행하고, 나머지는 다른 터미널에서 순서대로 실행한다. HTTP 검증 스크립트가 합성 Alert 240건을 생성하므로 기존 사용자·시연 DB에는 실행하지 않는다.

```powershell
.\.venv\Scripts\python.exe c2_dashboard_local.py --db ../frontend-qa-new/alerts.db --port 8001
.\.venv\Scripts\python.exe frontend/tests/verify-query-controls.py --db ../frontend-qa-new/alerts.db --port 8001 --output ../frontend-qa-new/http-evidence.json
node frontend/tests/browser-query-controls.mjs --evidence ../frontend-qa-new/http-evidence.json --output ../frontend-qa-new/browser-run
```

브라우저 검증에는 Chrome과 Playwright가 별도로 필요하다. Playwright 모듈 경로는 필요하면 `--playwright '설치된 패키지/index.mjs'`로 지정한다. `--output`에는 존재하지 않는 새 브라우저 증거 폴더를 사용한다. DB·HAR·스크린샷 등 실행별 증거는 Git 밖에 보관한다. 이 검증은 접근성 표준 전체 준수나 운영 배포 검증을 뜻하지 않는다.
