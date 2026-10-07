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
```

로컬 실행은 프로젝트 루트의 `c2_dashboard_local.py` 하나로 통합했다. PyCharm에서 이 파일을 실행하거나 저장소 루트에서 다음 명령을 사용한다. 화면 빌드는 자동으로 수행한다. PyCharm 실행 설정은 `.run/c2_dashboard_local.run.xml`에 저장하며 프로젝트 인터프리터, 루트 작업 폴더, 빈 매개변수를 사용한다.

```powershell
.\.venv\Scripts\python.exe c2_dashboard_local.py
```

기본값은 격리 시연 DB `data/c2-demo.db`, 포트 8000이다. 현재 로컬 시연 DB에는 검증된 120건이 들어 있다. DB는 Git에 포함하지 않는다. 기본 시연 DB가 없으면 오류로 종료하며 자동으로 빈 DB로 대체하지 않는다. [API 화면](http://127.0.0.1:8000/dashboard/)에서 목록과 상세를 조회한다. `?mode=mock`은 명시적 예시 모드다. PyCharm의 정지 버튼 또는 Ctrl+C로 종료한다.

검증을 위해 새 빈 격리 DB가 필요할 때만 경로를 명시한다. 새 경로는 FastAPI 기동 시 초기화하며 기존 격리 DB를 지정하면 재사용한다. 데이터 입력은 아래 검증 스크립트가 별도로 수행한다.

```powershell
.\.venv\Scripts\python.exe c2_dashboard_local.py --db ../day8-demo-new/alerts.db --port 8001
```

런처는 기존 사용자 DB `data/alerts.db`를 거부한다. 기존 사용자 DB를 사용하는 원래 백엔드 실행 명령은 `python -m uvicorn app.main:app --host 127.0.0.1 --port 8000`이며, 격리 시연 실행과 구분한다. 포트가 점유돼 있으면 기존 서버를 종료하거나 `--port 8002`를 지정한다. 기존 DB를 삭제해 포트 충돌을 해결하지 않는다. 별도 프론트 서버나 CORS 설정은 없다.

다른 터미널에서 새 시연 DB가 비어 있을 때만, 실제 POST/GET·core 비교를 실행한다. Day8 스크립트는 비민감 예시 120건을 생성해 48개 필터·limit 조합과 실제 100건 반환을 대조한다. 대시보드에는 POST 기능이 없다. 기존 `verify-local-api.py`의 6건 검증은 다른 빈 시연 DB에서 별도로 실행할 수 있다.

```powershell
.\.venv\Scripts\python.exe frontend/tests/verify-query-controls.py --db ../day8-demo-new/alerts.db --port 8001 --output ../day8-demo-new/http-evidence.json
```

검증:

```powershell
python frontend/build_web.py
node --test --test-isolation=none frontend/tests/display-contract.test.mjs frontend/tests/render-contract.test.mjs frontend/tests/api-integration.test.mjs frontend/tests/query-controls.test.mjs
python -B frontend/tests/output-safety.test.py
python -B frontend/tests/verify-core-examples.py
Get-ChildItem frontend/dist/*.js | ForEach-Object { node --check $_.FullName }
.\.venv\Scripts\python.exe -m pytest -q frontend/tests/test_local_launcher.py tests/API_Test/test_dashboard.py
.\.venv\Scripts\python.exe -m pytest -q
```

Chrome와 Playwright 검증 도구가 준비된 환경에서는 아래 CLI로 실제 브라우저 입력·Enter·필터·상세·CDP Network를 검증한다. Playwright는 앱 의존성이 아니다. 설치된 패키지의 `index.mjs` 경로를 `--playwright`로 지정할 수 있고, 생략하면 환경의 `playwright` 모듈을 사용한다. `--output`은 기존 폴더를 덮어쓰지 않는 새 증거 폴더여야 한다. HAR·스크린샷·JSON은 로컬에만 저장한다.

```powershell
node frontend/tests/browser-query-controls.mjs --evidence ../day8-demo-new/http-evidence.json --output ../day8-demo-new/browser-run
# 필요한 경우 위 명령에 --playwright '설치된 패키지/index.mjs' 추가
```

실제 연결 흐름은 `entry.js`의 모드 선택 → `app.js`의 입력/submit 이벤트 → `display-contract.mjs`의 입력 검증·적용값/조회 경로 관리 → `api-adapter.js`의 루트 상대 GET → controller의 응답 검증 → render다. HTTP 상태/JSON 오류는 adapter가, 필수 필드·응답 ID·늦은 응답은 controller가 처리한다. render는 HTTP 호출이나 core 판단을 하지 않는다.

조회 개수 draft는 문자열, 적용 `query.limit`은 1~100의 정수다(초기 5). 타이핑은 요청하지 않고 조회 버튼/해당 입력의 Enter에서만 적용한다. 잘못된 입력은 기존 결과·적용값을 유지한다. 필터 변경/초기화/재시도는 적용값만 사용하며 미적용 입력을 보존한다. level/human은 서버 AND 조건이고 빈 값만 생략하며 `false`를 명시한다. 필터 초기화는 두 필터만 비운다. 전체 envelope의 count/limit/alerts/next_cursor를 보존·검증하며 count는 현재 응답 건수다. 서버 순서를 그대로 표시한다.

목록 선택 상세는 목록 재조회 중 비우고 새 목록에 같은 ID가 있을 때만 다시 조회한다. Alert ID 직접 조회는 양의 안전한 정수를 검증한 뒤 `/alerts/{id}`로 조회하고, 목록 조건·성공 여부와 독립적으로 유지한다. 같은 ID도 마지막 경로(list/direct)를 기록한다. 상세 재시도는 입력 draft가 아니라 마지막 요청 ID/경로를 사용한다. 닫기·새 상세 요청 뒤에는 이전 응답/선택 복원이 재등장하지 않는다.

mock은 공유 validator로 전체 fixture를 확인한 뒤 필터·정렬·limit을 적용한다. 제외되는 불완전한 fixture도 정상 빈 목록으로 숨기지 않는다. 반환 응답은 API와 같은 controller에서 다시 검증한다. 기존 여섯 예시/preview를 유지하며 API 모드는 fixture JSON 파싱에 의존하지 않는다.

**dist는 Git 제외 생성물이다. 직접 수정하지 않는다.** build_web.py는 원본과 fixture만으로 실행 파일 7개를 만든다. FastAPI는 `frontend/dist/`만 `/dashboard/`에 제공한다. dist/index.html이 없으면 대시보드는 503과 빌드 안내를 표시하지만 기존 API의 import와 기동은 유지한다. `/docs`와 루트 GET 경로를 가리지 않는다.

Day9 더보기·커서 탐색·누적 목록은 별도 작업이며 이번 화면에는 추가하지 않았다.
