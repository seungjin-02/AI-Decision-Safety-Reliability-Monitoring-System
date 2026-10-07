# Day8 C2 조회 조건·ID 직접 조회 구현 및 검증

확인일: 2026-10-07 KST. 결과: 요청 범위의 구현·로컬 검증 완료. 이 보고서는 코드 확인, Node 자동 검증, TestClient 회귀, 실제 TCP HTTP, 실제 Chrome 검증을 구분한다. 실행하지 않은 운영 환경 검증을 통과로 기록하지 않는다.

## 저장소와 기준

- 메인 FastAPI Git 루트: `C:\Users\Seung Jin\Documents\New project\repo-reference`
- 원격: `https://github.com/seungjin-02/AI-Decision-Safety-Reliability-Monitoring-System.git`
- 작업 브랜치: `feature/dashboard-query-controls`
- fetch로 확인한 기준: `origin/feature/dashboard-api-integration = fa7d2ef00b94d9bbb6d327da7d81a528b6258b80`
- 확인한 main: `origin/main = c2544d5a90ad1fa9337cb9d3ee77e80e452fc70c`
- `git merge-base --is-ancestor origin/feature/dashboard-api-integration origin/main` 종료 코드 1: Day7은 당시 main에 포함되지 않았다. 따라서 최신 Day7에서 새 브랜치를 생성했다. 이 브랜치는 선행 Day7에 의존한다. PR 비교 시 main 기준 차이에는 Day7도 포함된다.
- `516090d`의 API 연결과 `6e3d4bb`의 가독성 변경이 기준의 조상임을 확인했다. `fa7d2ef`에서 사용자가 제거한 Day6/Day7 보고서·코드 주석도 되돌리지 않았다.
- 시작 작업트리는 깨끗했다. 같은 Day8 브랜치가 없음을 확인했다. 기존 integration/main 로컬 브랜치·사용자 변경을 reset하거나 덮어쓰지 않았다.
- Sites 소스는 별도 Git 루트 `C:\Users\Seung Jin\Documents\New project\dashboard-design\share`다. 기존 미추적 `tests/render-contract.test.mjs`를 건드리지 않았다. Sites 배포는 하지 않았다.
- 관련 파일만 이 보고서를 포함하는 Day8 커밋으로 기록하고 지정 원격 브랜치에 push한다. 실제 push SHA와 완료 결과는 최종 응답 및 `git log -1` / 원격 브랜치에서 확인한다. PR 승인·병합·main push·force push는 작업에 포함되지 않는다.

## 수정 파일과 책임

| 파일 | 변경 및 역할 |
|---|---|
| `src/api-adapter.js` | 고정 5 대신 controller의 적용 limit 전달. 루트 상대 GET·HTTP 상태 우선·JSON 오류 분류 유지. full envelope 반환. |
| `src/display-contract.mjs` | 문자열 draft/입력 오류와 적용 limit 분리. ID 안전 정수 검증. list/direct 경로 관리. 응답 count=배열 길이, count≤limit, 요청 limit 일치, next_cursor 존재·구조 검증. 목록·상세 요청 번호와 상세 intent로 늦은 복원 방어. |
| `src/app.js` | 개수·ID의 별도 native form submit 및 input 이벤트. 적용 상태·현재 페이지 건수·직접 조회 출처 표시. 로딩/오류에도 닫기 제공. 전체 렌더링에서 draft·오류·포커스·텍스트 선택 범위 복원. |
| `src/styles.css` | 기존 차콜 native 필터와 동일한 입력·버튼·안내 스타일만 추가. 40:60 배치 유지. |
| `src/mock-adapter.js` | 전체 fixture 공유 검증 후 AND 필터→정렬→limit. count/limit/next_cursor 구성. 여섯 예시·preview 유지. 필터 밖의 잘못된 fixture도 숨기지 않음. |
| `tests/query-controls.test.mjs` | 실제 adapter/controller/render/event를 사용하는 새 입력·상태·교차 응답 테스트 16개. |
| `tests/api-integration.test.mjs` | 적용 query.limit을 명시하고 초기화 상태 기대값에 limit 추가. 기존 10개 검증 유지. |
| `tests/display-contract.test.mjs` | 테스트 응답이 요청 limit을 넘지 않도록 최소 조정. 기존 15개 판단·표시·오류 검증 유지. |
| `tests/render-contract.test.mjs` | 목록 응답 limit을 실제 초기 요청 5와 일치시킴. 기존 5개 실제 출력 검증 유지. |
| `tests/output-cases.mjs`, `tests/output-safety.test.py` | 기존 동적 판단 데이터에 더해 새 두 입력 draft의 본문·속성 이스케이프를 HTMLParser로 검사. |
| `tests/verify-query-controls.py` | 새 격리 DB에 실제 POST로 120건 생성. GET/core·48개 조건·limit=100·cursor·404·DB 보존 검증. |
| `tests/browser-query-controls.mjs` | CLI Playwright/Chrome의 실제 입력·버튼·Enter·필터·직접 조회·닫기 및 CDP Network 기록. 앱 의존성 추가 없음. |
| `README.md`, `DESIGN.md`, `DAY8-REVIEW.md` | 실행 방법·확정 계약·검증 증거와 범위. 삭제된 과거 보고서를 복원하지 않음. |

`app/`, `core/`, DB 스키마·repository·인증·권한·요구사항 패키지에는 변경이 없다. `frontend/dist/`는 Git 제외 생성물이고 원본에서 7개 파일로 재빌드했다.

## 실제 데이터 흐름과 상태

입력 이벤트 → controller의 draft 갱신 → render. 이 단계에서는 HTTP를 호출하지 않는다.

개수 form submit(조회 버튼 또는 해당 입력의 Enter) → 전체 문자열을 숫자 정수로 검증 → `query.limit` 적용 → 현재 level/human을 포함해 adapter 호출 → `/alerts?limit=N[&level=...][&human_required=...]` → 전체 응답 검증 → 서버 순서 그대로 render. 빈 필터만 생략하며 문자열 `false`를 보존한다. API 목록을 프론트에서 재필터하지 않는다.

적용 20 / draft 37 상태에서 필터 변경·초기화·재시도는 20을 사용한다. 조회 적용 시만 37을 사용한다. 유효한 37 요청이 실패해도 적용값은 37이며 재시도도 37이다. 잘못된 개수는 정상 요청이나 응답 오류로 바꾸지 않고 입력 오류를 표시하며 기존 결과를 유지한다.

ID form submit → 전체 문자열의 양의 안전한 정수 여부 검증 → `/alerts/{id}` 단일 GET → 응답 ID 일치·구조 검증 → 공통 상세 패널. 필터·limit을 상세 요청에 붙이지 않는다. `idInput.draft`와 마지막 요청 `selected`/`detailSource`는 별개다. 재시도는 마지막 실패 ID/경로를 사용한다.

| 상세 경로 | 목록 재조회 | 새 상세·닫기 |
|---|---|---|
| 목록 선택 (`list`) | 기존 목록·상세 비움. ID 후보 기억. 검증된 새 페이지에 같은 ID가 있을 때만 상세 재조회. 빈 목록·실패·오류·ID 제외에서는 선택 대기. | 새 ID/경로로 전환하고 이전 응답 무효화. 닫기는 후보 복원도 무효화. |
| 직접 조회 (`direct`) | 성공·로딩·실패·404·응답 오류 모두 그대로 유지. 목록 밖 항목을 목록에 삽입하지 않음. | 같은 ID라도 마지막 경로를 갱신. 새 조회는 기존 내용을 비움. 닫기는 늦은 상세를 차단. |

`listRequest`/`detailRequest`는 각 요청의 늦은 성공·실패를 방어한다. `detailIntent`는 목록 재조회 이후의 직접 조회·새 목록 선택·닫기를 기록해, 늦은 목록이 기억한 후보를 다시 살리지 못하게 한다. 직접 상세의 요청 번호는 목록 재조회로 무조건 증가시키지 않는다.

`level`, `human_required`, 점수, 권장 조치는 응답 그대로 사용한다. INFO 정책 규칙·검토 여부 재계산을 추가하지 않았다. reason_summary/signal.reason·정의된 한글 매핑·미정의 원문·null/0/false/빈 문자열·빈 세 컬렉션·metadata 제외·입력 timeout과 latency 구분·KST를 유지했다. 권장 조치는 읽기 전용 제안이다.

## 검증 결과와 확인 방법

환경: Windows, Python 3.12.10, Node v24.16.0, FastAPI 0.139.0, Playwright 1.62.1, Chrome 154.0.8037.98. 브라우저는 새 격리 컨텍스트의 headless Chrome 1440×1000이며 스크린샷도 직접 열어 확인했다. ECC contract-first/git-workflow/e2e-testing, 로컬 Git·Node·Python, Playwright CLI 실행과 CDP, Chrome DevTools MCP를 사용했다. 테스트 실행 방법은 [Playwright 공식 API 문서](https://playwright.dev/docs/api/class-page#page-wait-for-response)와 대조했다.

| 계약 | 결과 | 실행한 확인 |
|---|---|---|
| 기본 5, 유효한 1·37·100 | 통과 | Node query-controls + 실제 GET + Chrome. Chrome에서 100개 행까지 확인. |
| 빈 값·0·음수·101·소수·문자·부분 문자열 거부 | 통과 | Node 실제 입력/submit 핸들러에서 요청 수·기존 결과·적용값 비교. Chrome number 입력이 허용하는 빈 값/0/음수/101/소수도 요청 없이 유지. 문자 문자열은 Node에서 확인. |
| 타이핑 무요청, 버튼/Enter 각 1회 | 통과 | Node 이벤트 + Chrome의 각 요청 수 및 CDP 기록. 두 입력의 Enter가 다른 조회를 호출하지 않음. |
| 미적용 draft·ID·입력 오류·적용 limit 보존 | 통과 | Node 필터/초기화/성공·실패/재시도 경계. Chrome 렌더 후 실제 inputValue와 안내 대조. 연속 타이핑 포커스 유지 확인. |
| 전체/true/false, AND, 하나 해제, 필터 초기화 | 통과 | Node 요청 URL + 실제 HTTP 48조합 + Chrome select 변경. |
| 최신 5 밖 대상의 서버 필터 조회 | 통과 | HTTP 전체 DB 조건 적용과 기대 ID 대조. Alert #115가 최신 5 밖에서도 CRITICAL/true 조건으로 조회됨. |
| 서버 순서·count/limit·cursor 보존 | 통과 | Node 응답 객체 동일성·불일치 거부. 실제 HTTP 48조건의 전체 alert 객체/ID/순서/count/limit/cursor 비교. |
| 목록 선택 같은 ID 재조회·제외 해제 | 통과 | Node 순서 변경·축소·실패/오류/빈 목록. Chrome 선택 유지와 12번째 선택→limit 5 해제. |
| 직접 ID 경로·동일 ID·잘못된 ID 거부 | 통과 | Node MAX_SAFE_INTEGER 경계·요청 URL·응답 ID 불일치. Chrome 목록 밖 CRITICAL 직접 조회 및 잘못된 입력 유지. |
| 직접 상세 정상/404/요청 실패/응답 오류 | 통과 | 실제 adapter/controller/render Node 검증. 실제 HTTP·Chrome은 정상과 진짜 404 확인. 실제 서버 500·망 실패·잘못된 JSON을 브라우저에서 발생시키지는 않음. |
| 경로 전환·같은 ID 경로·닫기·마지막 ID 재시도 | 통과 | Node 경로와 draft 분리·재시도. Chrome 두 방향 전환/동일 ID/양쪽 닫기. |
| 직접 상세가 목록 변경·실패와 독립 | 통과 | Node 성공/error/404/invalid/pending × 목록 성공/error/invalid + filters/limit/reset/retry. Chrome filters/limit/reset 및 빈 목록·직접 404 유지. |
| 늦은 성공·실패·선택 복원 방어 | 통과 | Node deferred Promise로 37→100 역순, list↔direct 양방향, 최신 목록 성공 뒤 과거 실패, 목록 대기 중 직접 조회/새 선택/닫기, 닫기 후 과거 상세 확인. 실제 TCP를 지연시켜 동일 순서를 재현하지는 않음. |
| 기존 판단·원문·필수 타입·빈 상태·API/mock | 통과 | 기존 Node 30개 + 새 16개. 모드 fallback 없음, 여섯 mock/preview·limit 반영과 제외된 불완전한 fixture 거부. |
| 동적 문자열·새 입력 속성 출력 안전성 | 통과 | HTMLParser 실제 출력 검사 3개. 두 draft에 HTML/script 공격 문자열을 넣어도 attribute 값/본문으로 보존됨. |
| 여섯 정상 예시의 core 일치 | 통과 | 기존 verify-core-examples.py 6개 + 실제 POST/GET/core 120개. |
| 생성물·빌드·JS 문법·백엔드 회귀 | 통과 | 원본 빌드 7파일, JS 5파일 node --check, 기존 pytest 203개. |
| 콘솔·네트워크·화면 | 통과 | Chrome 12개 검증 묶음, GET 30건의 경로·조건·ID/CDP/HAR. JS 예외 0. 예상 없는-ID `/alerts/1120`의 404 리소스 콘솔 오류 1건만 있음. 40:60(576px/864px), 가로 넘침 없음. DevTools MCP 별도 초기 화면 GET limit=5/200과 오류 콘솔 없음 확인. |

테스트 소스의 문자열 존재만 검사한 결과가 아니다. Node는 실제 함수·응답·렌더 결과·이벤트를 실행하고, 브라우저는 실제 DOM 조작과 GET 네트워크를 사용했다. TestClient 203개는 브라우저 검증이나 TCP 검증으로 합산하지 않는다.

## 실행 명령과 실제 결과

Git 확인: `git fetch origin '+refs/heads/*:refs/remotes/origin/*'`, status/branch/remotes/log, ancestor 확인 후 `git switch -c feature/dashboard-query-controls origin/feature/dashboard-api-integration`. 정상 실행. Day7→main ancestor만 기대대로 종료 1이다.

저장소 루트에서 실행:

```powershell
python frontend/build_web.py
node --test --test-isolation=none frontend/tests/display-contract.test.mjs frontend/tests/render-contract.test.mjs frontend/tests/api-integration.test.mjs frontend/tests/query-controls.test.mjs
python -B frontend/tests/output-safety.test.py
.\.venv\Scripts\python.exe -B frontend/tests/verify-core-examples.py
Get-ChildItem frontend/dist/*.js | ForEach-Object { node --check $_.FullName }
.\.venv\Scripts\python.exe -m pytest -q --basetemp ../day8-pytest-20261007-a1
git diff --check
```

결과: 빌드 7파일 / Node **46 passed, 0 failed, 0 skipped** / 출력 안전성 **3 OK** / core **6 PASS** / JS 5파일 모두 종료 0 / pytest **203 passed, 1 warning** / diff check 종료 0. pytest 경고는 기존 Starlette TestClient의 httpx 사용 폐기 예정 안내다. 요구사항 패키지를 바꾸지 않았다. 사용자 Git의 LF→CRLF 안내는 diff 결함으로 분류하지 않았다.

실제 서버·HTTP:

```powershell
.\.venv\Scripts\python.exe frontend/demo_server.py --db ../day8-demo-20261007-live/alerts.db --port 8001
.\.venv\Scripts\python.exe frontend/tests/verify-query-controls.py --db ../day8-demo-20261007-live/alerts.db --port 8001 --output ../day8-demo-20261007-live/http-evidence.json
```

서버 기동 완료. 검증 종료 0: 120 POST/GET/core 대조, 48개 필터/limit/count/order/cursor 조건, 실제 100개 반환, 목록 밖 대상, 404, DB 이벤트 ID 보존 통과.

최종 재빌드 이후 실제 Chrome CLI 검증:

```powershell
node frontend/tests/browser-query-controls.mjs --playwright 'C:\Users\Seung Jin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright\index.mjs' --evidence ../day8-demo-20261007-live/http-evidence.json --output ../day8-demo-20261007-live/browser-a2
```

종료 0, 12개 검증 묶음 모두 PASS. 최초 browser-a1도 통과했고, controller 가독성·draft 출력 안전성 보강 후 a2를 다시 실행했다. Playwright CLI 스크립트는 공식 library API를 사용하며 `npx` 설치나 앱 패키지 추가 없이 기존 번들로 실행했다.

## 격리 DB와 로컬 증거

- DB: `C:\Users\Seung Jin\Documents\New project\day8-demo-20261007-live\alerts.db`
- 시연 데이터 **120건**. 기존 POST /evaluate만 사용했다. 직접 SQL 생성·기존 DB 초기화는 하지 않았다.
- 검증 후 읽기 전용 SQL로 alert_id/event_id 120쌍이 POST/GET 증거와 모두 같음을 다시 확인했다. DB는 자동 삭제되지 않으며 그대로 보존했다.
- 기본 `repo-reference/data/alerts.db`는 작업 전후 존재하지 않았다. 기존 Day7 DB·사용자 DB에 작업하지 않았다. 이번 시연 DB는 Git 루트 밖이다.
- 로컬 증거: 위 폴더의 `http-evidence.json`, `preservation.json`, `browser-a2/browser-evidence.json`, `browser-a2/network.har`, `browser-a2/dashboard.png`. 공개 배포하거나 Git에 넣지 않는다.
- DB SHA-256(브라우저 검증 후): `af2cb06ddbc8da993ff073a15c93f1d64bed130399b95aa1467a7d6d7f8d48d4`
- 서버 미리보기: `http://127.0.0.1:8001/dashboard/`. 이 로컬 주소는 실행 중인 해당 컴퓨터에서 접근한다. 외부 공유 Sites 주소를 갱신한 것은 아니다.

## 남은 범위와 Day9 경계

이번에 실행한 검증에서 Day8 표시·입력·상태 계약의 남은 결함은 발견하지 못했다. 자동 테스트에서는 네트워크 실패·불완전 응답·지연 역순을 통제한 응답으로 검증했다. 실제 운영망의 장애/지연, 여러 브라우저, 인증·권한, 접근성 전수·출시 검증은 **미검증**이다. 실제 Chrome의 실패 재현은 없는 ID의 404까지다.

Day9 더보기에서는 서버 next_cursor를 사용하는 별도 사용자 동작, 같은 조건의 누적/중복/순서 및 조건 변경 시 페이지 상태 초기화가 새 계약이다. 현재 코드는 cursor를 보존하지만 보내지 않으며 다음 페이지 버튼·자동 요청·전체 건수·총 페이지 수를 제공하지 않는다. 이번 구현에 페이지 탐색을 섞지 않았다.
