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
.\.venv\Scripts\python.exe c2_dashboard_local.py --db ../day9-demo-new/alerts.db --port 8001
```

런처는 기존 사용자 DB `data/alerts.db`를 거부한다. 기존 사용자 DB를 사용하는 원래 백엔드 실행 명령은 `python -m uvicorn app.main:app --host 127.0.0.1 --port 8000`이며, 격리 시연 실행과 구분한다. 포트가 점유돼 있으면 기존 서버를 종료하거나 `--port 8002`를 지정한다. 기존 DB를 삭제해 포트 충돌을 해결하지 않는다. 별도 프론트 서버나 CORS 설정은 없다.

다른 터미널에서 새 시연 DB가 비어 있을 때만, 실제 POST/GET·core 비교를 실행한다. 검증 스크립트는 새 빈 격리 DB에 비민감 예시 240건을 생성한다. 같은 저장 시각을 페이지 경계에 배치해 양방향 탐색, KST 날짜 경계, 48개 필터·limit 조합과 core 결과를 대조한다. 대시보드에는 POST 기능이 없다. 기존 `verify-local-api.py`의 6건 검증은 다른 빈 시연 DB에서 별도로 실행할 수 있다.

```powershell
.\.venv\Scripts\python.exe frontend/tests/verify-query-controls.py --db ../day9-demo-new/alerts.db --port 8001 --output ../day9-demo-new/http-evidence.json
```

검증:

```powershell
python frontend/build_web.py
node --test --test-isolation=none frontend/tests/display-contract.test.mjs frontend/tests/render-contract.test.mjs frontend/tests/api-integration.test.mjs frontend/tests/query-controls.test.mjs frontend/tests/pagination.test.mjs
python -B frontend/tests/output-safety.test.py
python -B frontend/tests/verify-core-examples.py
Get-ChildItem frontend/dist/*.js | ForEach-Object { node --check $_.FullName }
.\.venv\Scripts\python.exe -m pytest -q frontend/tests/test_local_launcher.py tests/API_Test/test_dashboard.py
.\.venv\Scripts\python.exe -m pytest -q
```

Chrome와 Playwright 검증 도구가 준비된 환경에서는 아래 CLI로 실제 브라우저 입력·Enter·필터·상세·CDP Network를 검증한다. Playwright는 앱 의존성이 아니다. 설치된 패키지의 `index.mjs` 경로를 `--playwright`로 지정할 수 있고, 생략하면 환경의 `playwright` 모듈을 사용한다. `--output`은 기존 폴더를 덮어쓰지 않는 새 증거 폴더여야 한다. HAR·스크린샷·JSON은 로컬에만 저장한다.

```powershell
node frontend/tests/browser-query-controls.mjs --evidence ../day9-demo-new/http-evidence.json --output ../day9-demo-new/browser-run
# 필요한 경우 위 명령에 --playwright '설치된 패키지/index.mjs' 추가
```

실제 연결 흐름은 `entry.js`의 모드 선택 → `app.js`의 입력/submit 이벤트 → `display-contract.mjs`의 입력 검증·적용값/조회 경로 관리 → `api-adapter.js`의 루트 상대 GET → controller의 응답 검증 → render다. HTTP 상태/JSON 오류는 adapter가, 필수 필드·응답 ID·늦은 응답은 controller가 처리한다. render는 HTTP 호출이나 core 판단을 하지 않는다.

목록 조회 폼의 `draft`는 문자열 입력, `query`는 마지막으로 적용한 조건이다. 개수(초기 5, 요청당 1~100), 평가 수준, 사람 검토, 생성 시작·종료, 정렬을 AND로 적용한다. Day8의 필터 변경 즉시 조회는 제거했다. 입력·선택·초기화는 요청하지 않고 native submit(조회 버튼/Enter)만 새 첫 페이지를 조회한다. 같은 조건을 다시 제출해도 누적 결과·커서를 초기화한다. 잘못된 입력은 자동 보정하지 않고 기존 결과·상세·applied·커서를 유지한다. 미적용 안내와 적용 조건을 따로 표시한다.

필터 초기화는 draft의 수준·검토·시작·종료만 비운다. 개수·정렬·ID 입력과 현재 결과는 유지하며 조회로 적용해야 한다. 실패한 새 조회의 applied는 되돌리지 않고 목록 재시도가 같은 조건을 사용한다. `human_required=false`를 명시하고 전체 필터만 생략한다.

날짜는 입력 이벤트가 아닌 **Alert 저장 시각**이다. KST 입력을 명시적 `+09:00`으로 변환한다(PC 시간대 무관). 시작 포함·종료 제외(`created_from ≤ created_at < created_to`), 한쪽 경계만 입력 가능, 기본 기간 없음. 양쪽 입력 시 시작이 종료보다 빨라야 한다. 정렬은 서버 DB에서 LIMIT 전 `(created_at, alert_id)` 내림차순(`desc`, 기본) 또는 오름차순(`asc`)으로 수행한다.

더보기는 draft가 아니라 applied 조건과 서버 `next_cursor` 쌍을 그대로 보낸다. API `count`는 이번 페이지 건수, 화면의 **현재 불러온 N건**은 누적 건수이며 DB 전체 건수가 아니다. 요청당 최대 100건은 누적 제한이 아니다. null 커서이면 추가 요청하지 않는다. 진행·실패 중 기존 목록/상세/커서를 보존하고 하단에서만 상태와 수동 재시도를 제공한다. 성공 HTTP의 잘못된 JSON/구조는 추가 응답 데이터 오류로 구분한다. 중복 ID, 시각·ID 순서, 요청 경계, 마지막 항목과 next_cursor 일치·진행을 검증한 뒤 추가와 커서 갱신을 함께 반영한다. 문제가 있으면 정렬·중복 제거·부분 반영하지 않는다.

이 커서 조회는 **고정 DB 스냅샷이 아니다**. 탐색 중 새 항목이 생기면 방향과 위치에 따라 이번 탐색에서 빠지거나 이후 페이지에 나타날 수 있다. 최신 첫 페이지는 새 조회로 확인한다. 더보기에는 자동 재시도·자동 선택·자동 스크롤 이동이 없다. 입력 폼 DOM은 유지하고 목록은 행을 추가하며 상세 영역만 별도로 갱신하여 입력 커서·초점·조회 위치를 보존한다.

목록 선택 상세는 목록 재조회 중 비우고 새 첫 페이지에 같은 ID가 있을 때만 다시 조회한다. Alert ID 직접 조회는 양의 안전한 정수를 검증한 뒤 `/alerts/{id}`로 조회하고, 목록 조건·성공 여부와 독립적으로 유지한다. 같은 ID도 마지막 경로(list/direct)를 기록한다. 상세 재시도는 입력 draft가 아니라 마지막 요청 ID/경로를 사용한다. 닫기·새 상세 요청 뒤에는 이전 응답/선택 복원이 재등장하지 않는다.

mock은 공유 validator로 전체 fixture를 확인한 뒤 필터·정렬·limit을 적용한다. 제외되는 불완전한 fixture도 정상 빈 목록으로 숨기지 않는다. 반환 응답은 API와 같은 controller에서 다시 검증한다. 기존 여섯 예시/preview를 유지하며 API 모드는 fixture JSON 파싱에 의존하지 않는다.

**dist는 Git 제외 생성물이다. 직접 수정하지 않는다.** build_web.py는 원본과 fixture만으로 실행 파일 7개를 만든다. FastAPI는 `frontend/dist/`만 `/dashboard/`에 제공한다. dist/index.html이 없으면 대시보드는 503과 빌드 안내를 표시하지만 기존 API의 import와 기동은 유지한다. `/docs`와 루트 GET 경로를 가리지 않는다.

검증 증거(JSON·HAR·스크린샷·격리 DB)는 Git 밖의 실행별 폴더에 보관한다. Node HTML sink는 표시·이벤트 회귀, TestClient는 API 경계 회귀, TCP 스크립트는 실제 HTTP/core 대조, Playwright CLI는 실제 Chrome 입력·네트워크·스크롤 검증을 담당한다. 인증·접근성 전수 검증과 운영 배포 검증은 이번 범위 밖이다.
