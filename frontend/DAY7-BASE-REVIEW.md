# Day 7 실제 API 연결 구현·검증 보고서

갱신일: 2026-10-06. **현재 Day7 구현과 로컬 검증은 완료했다.** 아래쪽의 미완료/미병합 표시는 선행 PR 병합 전 당시 기록이며 현재 상태와 구분한다. 게시 대상은 `feature/dashboard-api-integration`이다. 이 보고서가 포함된 최종 commit/push SHA는 Git 이력 및 최종 응답에서 확인한다.

## 작업 기준과 보존

- 저장소: `C:/Users/Seung Jin/Documents/New project/repo-reference`
- origin: `https://github.com/seungjin-02/AI-Decision-Safety-Reliability-Monitoring-System.git`
- 다시 fetch한 기준 main: `c2544d5a90ad1fa9337cb9d3ee77e80e452fc70c`
- PR #5 merge: `53aef8a`, API 계약 commit `6e38956`; PR #6 merge: `c2544d5`, foundation commit `57fd035`.
- 두 선행 commit의 `merge-base --is-ancestor ... origin/main`은 모두 종료 코드 0이었다. GET 전용 signal 모델·metadata 제외·evidence 허용 필드와 frontend 원본·빌드·테스트를 코드로 재확인했다.
- 작업 시작 시 `feature/dashboard-api-integration`의 HEAD는 `6e3d4bb`, 작업트리는 깨끗했다. 사용자가 허용한 `git merge --no-edit origin/main`을 실행했고 충돌 없이 `135266b124819ac12bafc3209eddc848c1899e4f`가 생성됐다. 기존 가독성 commit을 제거하지 않았다.
- Sites 소스 및 배포·공개 범위는 변경하지 않았다. main 직접 push, force push, PR 승인·최종 병합은 하지 않는다.

## 구현 파일과 책임

| 파일 | 역할 및 변경 |
|---|---|
| `app/main.py` | `/dashboard/`에 dist만 제공. dist/index.html 부재는 503과 빌드 안내. import/기동에서 dist를 요구하지 않으며 기존 API와 `/docs`를 유지한다. |
| `frontend/src/api-adapter.js` | 루트 상대 GET, limit=5, level/human_required 전달. false 보존. status 먼저 확인하고 상세 404 / 일반 실패 / 성공 JSON 오류를 구분한다. 전체 목록 envelope를 반환한다. |
| `frontend/src/entry.js` | API 기본 / 명시적 mock 선택. API에서는 fixture를 읽지 않고 preview를 무시한다. ID 18 초기 선택은 mock에만 있다. |
| `frontend/src/display-contract.mjs` | 전체 응답 검증·선택 ID 일치·상태 관리·요청 번호 비교 유지. 공통 오류 이름은 `AlertNotFound`. 서버 목록 재정렬 제거. |
| `frontend/src/mock-adapter.js` | mock 필터·정렬. 전체 중복 검증 대신 lookup/filter/sort가 접근하는 필드만 방어하고, 잘못된 입력은 ResponseDataError로 전달한다. |
| `frontend/src/app.js` | 모드 표기. 빈 근거와 권장 조치를 변수/분기로 구분하고 수준 아이콘의 중첩 조건을 정리했다. 원문·esc·전체 렌더링을 유지한다. HTTP나 core 판단은 없다. |
| `frontend/build_web.py` | API adapter와 명시적 import 변환을 추가해 실행 파일 7개 생성. dist는 생성물이며 Git 제외. |
| `frontend/tests/api-integration.test.mjs` | 요청 경로·필터·오류·모드·목록 순서·실제 renderer handlers·malformed mock 검증 10개. |
| `frontend/tests/display-contract.test.mjs`, `render-contract.test.mjs` | 공통 AlertNotFound 이름 갱신. 기존 계약 검증을 유지했다. |
| `tests/API_Test/test_dashboard.py` | dist 부재 기동, 정적 제공 범위, 기존 경로와 생성 파일의 실제 HTTP 바이트 확인 3개. |
| `frontend/demo_server.py` | 새로운 명시적 시연 DB로만 실행. 기존 파일/default DB 거부, 127.0.0.1 바인딩. 제품의 DB 설정/저장 정책은 변경하지 않는다. |
| `frontend/tests/verify-local-api.py` | 실제 HTTP POST로 비민감 입력 6개 생성 후 GET·core·근거 노출·순서·cursor·필터·404와 격리 DB를 비교한다. 브라우저 검사와 구분한다. |
| `frontend/README.md`, `DESIGN.md`, 이 보고서 | 실행 방법, 모드 표기, 확인 범위와 당시 기록 갱신. |

실제 데이터 흐름:

1. build_web.py가 src와 fixture에서 dist를 만든다. FastAPI가 같은 출처의 `/dashboard/`에서 dist만 제공한다.
2. entry가 URL로 adapter를 선택하고 공통 controller/render를 시작한다. API 초기 상태는 목록 조회와 상세 선택 대기다.
3. API adapter의 `GET /alerts?limit=5` → 기존 endpoint/repository의 DB 조회 → GET 응답 모델의 노출 계약 → controller 검증 → 목록 렌더링. 응답 순서를 보존한다.
4. 목록의 선택 ID로 `GET /alerts/{id}`를 호출한다. controller가 ID 일치와 필수 필드를 검증하고 해당 상세만 표시한다. 전환 중/실패에는 이전 상세를 비운다.
5. 필터는 서버 AND 요청에 반영한다. 변경 시 목록·상세를 비우고, 응답에 남은 선택만 재조회한다. count를 전체 건수로 표시하거나 cursor 페이지 UI를 추가하지 않는다.

level/human_required/risk_score/uncertainty_score/recommended_actions를 다시 계산하지 않는다. reason_summary와 signal.reason은 원문 보기에 보존한다. null·0·false·빈 문자열 및 빈 evidence/signals/actions 안내, timeout/latency 한글 매핑과 미정의 규칙의 원문 fallback을 유지한다.

## 실행 명령과 결과

Python 3.12.10 / Node v24.16.0. 기본 Python에 FastAPI가 없어 저장소 전용 `.venv`에 기존 requirements.txt를 설치했다. FastAPI 0.139.0, uvicorn 0.50.2, pytest 9.1.1, Starlette 1.7.0에서 검증했다. 전역 환경이나 requirements는 변경하지 않았다.

```powershell
git fetch origin '+refs/heads/*:refs/remotes/origin/*'
git merge --no-edit origin/main
python frontend/build_web.py
node --test --test-isolation=none frontend/tests/display-contract.test.mjs frontend/tests/render-contract.test.mjs frontend/tests/api-integration.test.mjs
python -B frontend/tests/output-safety.test.py
python -B frontend/tests/verify-core-examples.py
Get-ChildItem frontend/dist/*.js | ForEach-Object { node --check $_.FullName }
.\.venv\Scripts\python.exe -m pytest -q --basetemp='../day7-pytest-20261006-integration-a2'
.\.venv\Scripts\python.exe -m pytest tests/API_Test/test_dashboard.py -q --basetemp='../day7-pytest-20261006-integration-a3'
.\.venv\Scripts\python.exe frontend/demo_server.py --db ../day7-demo-20261006-live/alerts.db --port 8000
.\.venv\Scripts\python.exe frontend/tests/verify-local-api.py --db ../day7-demo-20261006-live/alerts.db --port 8000 --output ../day7-demo-20261006-live/http-evidence.json
# 번들 CLI 경로는 Codex workspace dependencies가 제공한 경로를 사용했다.
node 'C:/Users/Seung Jin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/cli.js' screenshot --channel chrome --viewport-size '1440,1000' --wait-for-selector '.inbox-row' --timeout 30000 --full-page --save-har '../day7-demo-20261006-live/browser-http.har' --save-har-glob '**/alerts**' 'http://127.0.0.1:8000/dashboard/' '../day7-demo-20261006-live/dashboard-api.png'
git diff --check
```

| 확인 | 결과 | 실제 확인 방법 |
|---|---|---|
| 선행 기준·기존 commit 보존 | 통과 | fetch, merge 이력 및 ancestor 검사, 코드 확인. |
| 재빌드·구문 | 통과 | 7개 실행 파일 생성. 5개 JS의 node --check 종료 코드 0. 원본만 재빌드·필수 입력 오류도 Python 테스트로 확인. |
| 프론트 회귀와 연결 경계 | 통과 | **30 tests / 30 pass / 0 fail / 0 skipped**. 실제 adapter/controller/render 함수와 DOM sink. 실제 브라우저 검증과 구분한다. |
| 출력 안전성 | 통과 | Python **3 tests / OK**. HTML 해석, 원문 값 보존, 인라인 JSON, source-only 빌드. |
| core 정상 예시 | 통과 | **6건 PASS**. fixture와 같은 저장소 core 출력의 직접 비교. |
| 전체 백엔드 회귀 | 통과 | **203 passed**, 경고 1개. 최종 프론트 재빌드 후 정적 HTTP 테스트도 별도로 **3 passed**. |
| HTTP·DB 통합 | 통과 | 새 DB의 정상 빈 목록, 6개 실제 POST→GET→core 대조, metadata 제외/evidence 허용 필드, 순서/cursor, false/AND/초기화, 실제 상세 404. |
| 실제 브라우저 목록·상세 | 통과 | computer-use 브라우저에서 서버 첫 페이지 `[6,5,4,3,2]` 및 판단값 확인. 클릭한 6/2/4/1의 실제 상세 ID·점수·조치 확인. |
| 실제 INFO·원문 | 통과 | ID 6: INFO/검토 요구 없음/0·1/null/두 조치 및 두 원문 확인. ID 4: 무신호 안내와 서버 조치 확인. |
| 실제 timeout/강제 CRITICAL | 통과 | ID 1: 구체적 입력 사유, CRITICAL·검토 필요, 0·0 점수 및 서버 강제 규칙 설명 확인. |
| 실제 기본 필터·빈 결과·초기화 | 통과 | WARN+false → ID 2, INFO+true → 정상 빈 목록/상세 선택 대기, 초기화 → 원래 첫 페이지. 서버 로그의 루트 URL·파라미터와 대조. |
| 실제 API 실패·재시도 | 통과 | 소유한 시연 서버를 중단해 실제 연결 실패 발생. 상세 전환 실패 시 이전 ID 1 내용 제거. 필터 조회 실패 시 0행·로컬 API 연결·다시 시도 표시. 동일 시연 DB로 서버를 재시작한 뒤 수동 재시도는 INFO+true 조건을 유지해 정상 빈 결과로 복구. mock 전환 없음. |
| 실제 모드·preview | 통과 | `?mode=mock&preview=detail-404`는 예시 데이터·상세 404. API의 `?preview=list-empty`는 실제 5개 목록·선택 대기. |
| 최종 빌드 정상 콘솔 | 통과 | 재빌드 후 브라우저 재로딩, INFO 상세/스크린샷 확인. 정상 페이지의 error console 목록 `[]`. 연결 중단은 의도한 실패 검사로 구분한다. |

초기 백엔드 실행은 202 passed / 1 failed였다. 새 생성 파일 테스트에서 read_text가 CRLF를 LF로 바꿔 HTTP 본문과 비교 실패했다. `response.content == read_bytes()`로 바이트 비교를 수정한 뒤 전체 203개가 통과했다. 테스트를 느슨하게 하거나 정적 파일 내용을 바꾸지 않았다.

기본 sandbox에서는 venv의 ensurepip와 로컬 서버 실행이 완료되지 않아 승인된 실행으로 다시 진행했다. 최초 sandbox 서버는 DB 초기화 전에 종료했고 실제 시연에는 위 live DB만 사용했다. `npx --no-install playwright --version`은 환경에서 완료되지 않아 중단했으며 이 최초 npx 시도는 통과로 기록하지 않는다. 이후 Codex 번들 Playwright CLI를 확인해 실제 API 첫 화면의 screenshot/HAR 저장이 종료 코드 0으로 완료됐다. 상호작용은 computer-use의 실제 화면/DOM 및 UI 동작으로 확인했다.

백엔드 경고는 설치된 Starlette TestClient의 httpx 사용 deprecation이다. 이번 범위에서 고정 의존성을 변경하지 않았다.

## 시연 데이터·완료 증거·남은 범위

- 시연 DB: `C:/Users/Seung Jin/Documents/New project/day7-demo-20261006-live/alerts.db`.
- 브라우저 증거: 같은 폴더 `dashboard-api.png`, `browser-http.har`. 번들 Playwright CLI screenshot으로 생성했고 이미지를 검사했다. HAR의 실제 GET `/alerts?limit=5`가 200, ID `[6,5,4,3,2]`, metadata 제외임을 파싱해 확인했다.
- HTTP 대조 자료: 같은 폴더 `http-evidence.json`. 비민감 생성 입력의 실제 생성 trace/GET 응답·필터 결과를 담는다. DB와 자료는 Git 밖에 있으며 정적 제공 범위 밖이다.
- 동일 시연 DB 재시작 전후 SHA256: `2BCEA3FF03AB58DD982E28A60A371D181C3AB2E876A7EFF97F42B8B25723D5AD`. 조회·재시작으로 데이터가 바뀌지 않았다.
- 이 체크아웃의 기본 `data/alerts.db`는 시작 시와 마지막 확인 시 모두 없었다. 해당 경로로 서버를 실행하거나 DB를 초기화·삭제·덮어쓰지 않았다. 다른 작업공간의 사용자 DB도 접근하지 않았다.
- 코드·자동 테스트·실제 HTTP·실제 브라우저 증거를 위 표에서 구분했다. HTTP 500/잘못된 JSON/필수 필드·타입 오류, 늦은 응답 경쟁, 0/false/빈 문자열·빈 근거/조치는 자동 테스트로 확인했다. 실제 API 브라우저에서 모든 오류를 각각 발생시킨 것은 아니다.
- 실제 API의 상세 404는 HTTP 스크립트로 확인했고, 브라우저 404 상태는 mock preview로 확인했다. 이를 실제 DB 조회에서 브라우저 404를 재현했다고 표현하지 않는다.
- 확인된 기능 결함은 없다. Day8의 상세 필터 조합·해제 검증은 남겨 두며, 실제 사용자 DB·배포 환경·인증·권한·접근성 전수 검증은 이번에 실행하지 않았다.
- 로컬 시연 서버는 같은 격리 DB로 127.0.0.1:8000에 실행 중이다. 최종 화면은 `/dashboard/`이며 실제 INFO 상세를 확인할 수 있다.

---

## 당시 기록: 선행 PR 병합 전 기준 확인과 독립 작업

확인일: 2026-10-06. **Day 7 API 통합은 미완료다.** 두 선행 변경이 최신 main에 포함되지 않아, 요청에서 허용한 독립적인 가독성 정리와 기존 프론트 회귀 검증만 진행했다.

## 저장소와 선행 조건

- GitHub 작업 루트: `C:/Users/Seung Jin/Documents/New project/repo-reference`
- origin: `https://github.com/seungjin-02/AI-Decision-Safety-Reliability-Monitoring-System.git`
- 원격 전체 브랜치를 fetch한 뒤 확인한 최신 `origin/main`: `a829ac48e3ddac471977d4556ee785af473eb19e`
- 작업 시작 시 로컬 브랜치: `feature/dashboard-foundation`
- 시작 HEAD / 원격 foundation: `57fd0353f1b39070f9acd4c733b29862b81166ac`
- 원격 API 계약: `6e38956c9c5af01c480658a7f569d454c9f5c872`
- 시작 시 GitHub 체크아웃의 작업트리는 깨끗했다. 가독성 수정은 먼저 미커밋 변경으로 보존했다.
- 첫 기준 확인에서 `feature/dashboard-api-integration`은 로컬·원격 브랜치 목록에 없었다. 이후 사용자가 병합 없이 commit/push를 요청해, foundation의 `57fd035`에서 로컬 `feature/dashboard-api-integration`을 만들었다. 두 선행 변경이 모두 포함된 main을 기준으로 하는 API 통합 브랜치라는 의미는 아니다.
- 별도 Sites 소스: `C:/Users/Seung Jin/Documents/New project/dashboard-design/share`, HEAD `38d8d49bbb48a10f8fccd5c2256da47f93abb0a6`. 시작 시 기존 미추적 `tests/render-contract.test.mjs`가 있었으며 수정하지 않았다.

실행한 기준 확인:

```powershell
git fetch origin '+refs/heads/*:refs/remotes/origin/*'
git rev-parse --show-toplevel
git status --short
git branch -a
git log -3 --oneline origin/main
git merge-base --is-ancestor origin/feature/dashboard-api-contract origin/main
git merge-base --is-ancestor origin/feature/dashboard-foundation origin/main
git diff --stat origin/main origin/feature/dashboard-api-contract
git diff --stat origin/main origin/feature/dashboard-foundation
```

두 ancestor 검사 모두 종료 코드 **1**이었다. fetch는 종료 코드 0이었다.

| 선행 변경 | main 포함 | 확인한 차이 |
|---|---|---|
| API 계약 | 미포함 | `app/schemas.py`의 GET 전용 `AlertSignalResponse`, metadata 제외, 규칙별 evidence 허용 필드가 계약 브랜치에만 존재한다. API 문서와 GET 테스트 변경도 존재한다. |
| 프론트 기반 | 미포함 | `.gitignore`와 `frontend/` 원본·빌드·테스트·문서가 foundation 브랜치에만 존재한다. |

현재 main의 `AlertDetailResponse`는 alert metadata와 `SignalResponse.metadata`를 포함하고, evidence 허용 필드 필터도 없다. 계약 브랜치의 검증기는 정의된 규칙에 허용된 evidence 필드만 남긴다. 미정의 규칙은 빈 evidence가 된다. 이 차이를 프론트가 임의로 대체하지 않았다.

필요한 작업 기준은 **두 변경이 모두 반영된 최신 main**이다. 선행 브랜치 승인·병합은 수행하지 않았다. 다른 브랜치에서 통합을 완료한 것처럼 보고하지 않는다.

## 수정 파일과 역할

| 파일 | 이번 변경 |
|---|---|
| `frontend/src/app.js` | 긴 HTML template을 줄바꿈하고, 목록·상세 성공/선택 대기/오류의 중첩 조건을 명시적인 분기로 정리했다. 빈 signals 분기도 명시적으로 구분했다. |
| `frontend/src/display-contract.mjs` | 초기 상태, 선택·조회 상태 변경, close/retry 반환 구조를 줄바꿈했다. 상세 오류의 invalid/notfound/error 분류를 if/else로 정리했다. |
| `frontend/src/index.html` | 기존 HTML shell을 줄바꿈했다. 예시 JSON 삽입 표식과 module 진입점을 보존했다. |
| `frontend/DAY7-BASE-REVIEW.md` | 기준 확인, 독립 변경, 실행 증거와 미완료 범위를 기록한다. |

CSS, 정상 예시 응답, 한글 매핑, 서버 판단값, API/DB/core 및 Sites 소스는 변경하지 않았다. 이 단계에서는 API adapter 추가, 모드 변경, mock 중복 검증 제거, controller 정렬 이동도 아직 진행하지 않았다. 기존 DESIGN.md의 표시 계약은 바뀌지 않아 수정하지 않았다.

## 현재 실제 데이터 흐름과 실행

현재는 여전히 예시 화면이다. `entry.js`가 인라인 JSON을 읽고 mock adapter를 생성한다. `list(query)`와 `detail(id)`의 모의 응답을 controller가 검증해 상태를 갱신하고, renderer가 그 상태를 표시한다. renderer의 필터·선택·닫기·수동 재시도 동작은 controller를 호출한다. 실제 HTTP GET adapter와 FastAPI `/dashboard/` 정적 제공은 아직 없다.

실행 환경: Python 3.12.10, Node.js v24.16.0. 아래 명령은 GitHub 저장소 루트 기준이다.

```powershell
python frontend/build_web.py
python -m http.server 8766 --bind 127.0.0.1 --directory frontend/dist
```

이 실행 방법은 **현재 mock 확인용**이다. Day 7에서 요청한 `/dashboard/` API 기본 모드와 `?mode=mock` 실행 계약이 구현됐다는 의미가 아니다. dist는 Git 제외 생성물이며 직접 수정하지 않았다.

## 실행한 검증과 실제 결과

수정 전 기존 검증을 실행하고, 수정 후 재빌드한 뒤 동일 검증을 다시 실행했다.

```powershell
python frontend/build_web.py
node --test --test-isolation=none frontend/tests/display-contract.test.mjs frontend/tests/render-contract.test.mjs
python -B frontend/tests/output-safety.test.py
python -B frontend/tests/verify-core-examples.py
node --check frontend/dist/app.js
node --check frontend/dist/entry.js
node --check frontend/dist/mock-adapter.js
node --check frontend/dist/display-contract.js
git diff --check
```

| 검증 | 결과 | 확인 방법과 제한 |
|---|---|---|
| source 재빌드 | 통과 | 실행 파일 6개 생성. 출력 안전성 테스트에서 별도 원본 복사로 재빌드도 확인했다. |
| 표시 계약·renderer | 통과 | Node 20 tests / 20 pass / 0 fail / 0 skipped. source controller와 실제 renderer 함수, 작은 DOM sink로 확인했다. 실제 브라우저 테스트는 아니다. |
| 직접 판단값·권장 조치 보존 | 통과 | 여섯 정상 예시와 판단값이 의도적으로 충돌하는 테스트 응답에서 응답값·순서·불변성을 검사한다. INFO에서 human_required를 강제로 false로 바꾸는 규칙을 추가하지 않았다. |
| 빈 목록/요청 실패/상세 404/데이터 오류 | 통과 | adapter 반환/예외를 주입해 상태와 실제 renderer 출력, 재시도 handler를 검사한다. 실제 HTTP 상태 분류는 미구현이다. |
| 필수 필드 누락·타입 오류 | 통과 | 응답과 signal의 잘못된 필드를 주입해 invalid를 확인한다. 기본값으로 대체하지 않는다. |
| null/0/false/빈 문자열, 세 빈 컬렉션 | 통과 | 값과 HTML 출력에서 별도 안내·원값 보존을 검사한다. |
| 이전 상세 제거·늦은 응답 방어·선택 제외 | 통과 | deferred Promise를 제어해 로딩/실패 시 이전 상세 제거와 최신 요청 보존을 검사한다. |
| 출력 안전성·빌드 | 통과 | Python 3 tests / OK. 악의적인 동적 문자열의 renderer HTML 해석, 안전한 인라인 JSON, 원본 빌드와 잘못된 입력 실패를 검사한다. |
| core 예시 비교 | 통과 | 6건 PASS. 같은 체크아웃 core의 scores/level/human/actions/reason/signals/evidence와 정상 fixture를 비교했다. 실제 저장 DB 응답과의 비교는 아니다. |
| JavaScript 구문 | 통과 | 생성된 4개 JS 파일의 `node --check` 종료 코드 0. |
| diff 공백 검사 | 통과 | `git diff --check` 종료 코드 0. Git의 LF→CRLF 안내가 있었으며 검사 오류는 없었다. |
| 수정 전후 구조 보존 | 통과 | `output-cases.mjs`의 공격 문자열 사례를 수정 전후 실행해 HTMLParser로 비교했다. 공백만 있는 텍스트를 제외한 386개 구조·속성·텍스트 이벤트 및 원 응답 객체가 같았다. 비교 자료는 저장소 바깥 `day7-render-before.json`, `day7-render-after.json`에 있다. 시각적 screenshot 비교는 아니다. |

코드 확인: main/계약 브랜치의 `app/schemas.py`, 프론트 `app.js`, `display-contract.mjs`, `mock-adapter.js`, 테스트와 빌드를 읽고 확인했다. 자동 테스트: 위 표와 명령의 실제 실행 결과다. **이번 작업에서 실제 브라우저 및 FastAPI HTTP 연결 검증은 수행하지 않았다.**

실행한 검사에서는 기능 결함이 발견되지 않았다. 기존 표시 계약을 바꾸는 수정도 하지 않았다. 다만 Day 7 연결 기능 자체는 미완료이며, 다음 표를 통과로 기록할 수 없다.

## 기준 준비 후 진행할 항목

| 항목 | 현재 결과 |
|---|---|
| `/dashboard/` dist 정적 제공, dist 부재 시 기존 API 기동 보존 | 미구현·미검증 |
| API adapter 경로, 선택한 실제 ID, limit=5, 필터 AND/false 보존, 전체 envelope 반환 | 미구현·미검증 |
| HTTP status 우선 처리, 상세 404/목록 404/500/network/잘못된 JSON 구분 | 미구현·미검증 |
| 기본 API / 명시적 mock, 모드 표기, preview 제한, mock 자동 전환 방지 | 미구현·미검증 |
| 서버 목록 순서 보존, mock 정렬, mock 중복 검증 정리 | 미구현·미검증 |
| 공통 Alert 없음 오류 이름, API 기본 초기 상세 미선택 | 미구현·미검증 |
| backend 전체 회귀 테스트 | 미실행. 이번에는 backend를 수정하지 않았다. 정적 제공 변경 후 실행할 항목이다. |
| 시연 DB 생성과 실제 GET·브라우저 ID/순서/판단값 대조 | 미실행 |
| GET metadata 제외/evidence 허용 필드 실제 HTTP 확인 | 미검증. main에는 선행 구현이 아직 없다. |
| 기본 필터 적용·해제, 정상 빈 목록, 실패 시 mock으로 전환되지 않는 실제 브라우저 확인 | 미검증 |
| Day 8 상세 필터 조합·해제 검증 | 후속 범위 |
| 현재 독립 변경의 commit/push | 후속 사용자 지시에 따라 `feature/dashboard-api-integration`에 게시한다. 실제 API 통합은 포함하지 않으며 결과 커밋은 Git 이력과 최종 보고로 확인한다. |

시연 DB는 아직 만들지 않았고 기존 사용자 DB를 열거나 초기화·삭제·덮어쓰지 않았다. 후속 사용자 지시는 선행 병합 없이 현재 독립 변경을 commit/push하는 것이다. API 계약 브랜치를 merge/cherry-pick하지 않았고, 실제 API 통합은 미완료 상태로 남긴다. 추후 통합 기준을 확인한 뒤 별도 시연 DB로 실제 HTTP·브라우저 검증을 진행해야 한다.

main push, force push, PR 승인·병합 및 Sites 배포는 수행하지 않았다. 이번 실행에서 확정할 수 있는 완료 범위는 **가독성 정리와 현재 예시 화면의 회귀 검증**이다.
