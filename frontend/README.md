# C2 의사결정 모니터

FastAPI와 화면이 같은 출처에서 동작한다. 기존 C2 배치와 Day5 표시 계약을 유지하며, 서버 판단값과 사유 원문을 그대로 표시한다. API 실패 시 예시 데이터로 자동 전환하지 않는다.

- `/dashboard/`: 기본 API 모드, **로컬 API 연결**.
- `/dashboard/?mode=mock`: 명시적 예시 모드, **예시 데이터**.
- `/dashboard/?mode=mock&preview=detail-error`: mock에만 preview 적용. API 모드의 preview는 무시한다.

환경: Python 3.12+, Node.js 24+. npm 설치는 필요 없다. package.json은 JS의 ES module 타입만 지정한다. 글꼴은 기존 CDN을 사용한다.

저장소 루트에서 준비:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
python frontend/build_web.py
```

시연은 **새 격리 DB**로 실행한다. 아래 서버는 기존 파일과 기본 `data/alerts.db` 경로를 거부한다. 경로가 이미 있으면 다른 새 경로를 지정한다.

```powershell
.\.venv\Scripts\python.exe frontend/demo_server.py --db ../day7-demo-new/alerts.db --port 8000
```

[API 화면](http://127.0.0.1:8000/dashboard/)과 [예시 화면](http://127.0.0.1:8000/dashboard/?mode=mock)을 연다. 서버는 Ctrl+C로 종료한다. 별도 프론트 서버나 CORS 설정은 없다. 기존 백엔드 실행 환경에서는 `python -m uvicorn app.main:app --host 127.0.0.1 --port 8000`도 사용할 수 있다. 이 명령은 기존 기본 DB 경로를 사용하므로 위 시연 실행과 구분한다.

다른 터미널에서 새 시연 DB가 비어 있을 때만, 실제 POST/GET·core 비교를 실행한다. 이 스크립트는 비민감 예시 6건을 생성한다. 대시보드에는 POST 기능이 없다.

```powershell
.\.venv\Scripts\python.exe frontend/tests/verify-local-api.py --db ../day7-demo-new/alerts.db --port 8000 --output ../day7-demo-new/http-evidence.json
```

검증:

```powershell
python frontend/build_web.py
node --test --test-isolation=none frontend/tests/display-contract.test.mjs frontend/tests/render-contract.test.mjs frontend/tests/api-integration.test.mjs
python -B frontend/tests/output-safety.test.py
python -B frontend/tests/verify-core-examples.py
Get-ChildItem frontend/dist/*.js | ForEach-Object { node --check $_.FullName }
.\.venv\Scripts\python.exe -m pytest -q
```

실제 연결 흐름은 `entry.js`의 모드 선택 → `api-adapter.js`의 루트 상대 GET `/alerts?limit=5` 또는 `/alerts/{id}` → `display-contract.mjs`의 응답 검증·상태 관리 → `app.js`의 전체 렌더링이다. HTTP 상태/JSON 오류는 adapter가, 필수 필드·선택 ID·늦은 응답은 controller가 처리한다. render는 HTTP 호출이나 core 판단을 하지 않는다. level/human 필터는 서버에 AND 조건으로 전달하며 `false`를 생략하지 않는다. 서버 목록 순서를 보존하고 전체 건수·페이지 탐색 UI는 만들지 않는다.

mock은 fixture 조회·필터·정렬만 담당한다. 전체 응답 검증은 controller에 있고, mock에는 lookup/filter/sort에 필요한 필드의 접근 검사만 남겼다. API 모드는 fixture JSON 파싱에 의존하지 않는다.

**dist는 Git 제외 생성물이다. 직접 수정하지 않는다.** build_web.py는 원본과 fixture만으로 실행 파일 7개를 만든다. FastAPI는 `frontend/dist/`만 `/dashboard/`에 제공한다. dist/index.html이 없으면 대시보드는 503과 빌드 안내를 표시하지만 기존 API의 import와 기동은 유지한다. `/docs`와 루트 GET 경로를 가리지 않는다.

구현·자동 테스트·실제 HTTP/브라우저 검증의 구분과 당시 보류 이력은 `DAY7-BASE-REVIEW.md`에 있다. Day8 상세 필터 조합·해제 검증, 출시·인증·접근성 작업은 이번 범위에 포함하지 않았다.
