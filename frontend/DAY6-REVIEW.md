# Day6 기반 정리 및 검증

2026-10-05 KST. 작업 branch: `feature/dashboard-foundation` (local/remote 동일). base: 최신 원격 main `a829ac48e3ddac471977d4556ee785af473eb19e`. commit은 이 기록을 포함하는 feature branch HEAD를 확인한다.

## 저장소 구분과 보존

- 바깥 `Documents/New project`는 Git 저장소가 아니다.
- 메인 checkout: `Documents/New project/repo-reference`, 시작 시 main·clean. origin은 `https://github.com/seungjin-02/AI-Decision-Safety-Reliability-Monitoring-System.git`이다. origin/main을 fetch한 후 그 기준에서 branch를 생성했다.
- 기존 프론트: `dashboard-design/share`, 별도 Git 루트·main·HEAD `38d8d49bbb48a10f8fccd5c2256da47f93abb0a6`. Sites manifest project_id=`appgprj_6ac0d422ac3081919a0aed3bc26028f8`. 시작 시 remote 설정은 비어 있었으며 `tests/render-contract.test.mjs`는 미추적 상태였다. 이 파일도 이번 이관에 포함한다.
- 메인 checkout은 clean이라 사용자 변경과 섞이지 않았고 별도 worktree는 필요하지 않았다. 기존 backend 경로와 Sites 소스·설정·게시·공개 범위는 변경하지 않았다.
- 최초 요청의 feat/와 feature/ 차이는 후속 사용자 지시에 따라 local도 feature/로 통일했다.

## 구성과 작은 조정

원본은 frontend/src와 fixtures 안에 모았다. src/app.js=렌더링/이벤트, display-contract.mjs=검증/상태/매핑, mock-adapter.js=모의 list/detail, styles.css=기존 C2 스타일, index.html=명시적 HTML 틀. fixtures/alerts.json은 현재 여섯 정상 응답이다. DESIGN.md는 확정 규칙이다.

작은 추가 파일:

- src/entry.js: 응답 파싱과 앱 시작만 분리했다. 테스트가 코드의 특정 bootstrap 문자열을 자르거나 VM import를 바꾸지 않고 createDashboard를 직접 import한다.
- package.json: private/type=module만 지정해 Node의 .js 모듈 해석을 명확히 했다. 의존성·npm 설치·새 프레임워크는 없다.
- tests/output-cases.mjs, output-safety.test.py: 실제 렌더러 출력의 HTML 해석과 인라인 JSON 종료 문자·소스만으로 빌드를 검증한다.

기존 display-contract/render/core 비교 테스트를 이관했다. core 비교는 같은 저장소 core를 import하며 오래된 외부 repo-reference 경로를 인자로 받지 않는다. legacy 보고서·이미지·Sites Git metadata·hosting.json은 복사하지 않았다. frontend/dist는 .gitignore에 추가한 생성물이다.

## 빌드 변경

이전: share 밖의 v2/app.js를 읽어 regex/replace로 최신 동작을 생성. 원본·생성물·과거 자료가 섞이고 독립 재빌드가 불가능했다.

현재: 명시적 src 읽기→실행 파일 복사→JSON 안전 직렬화/삽입→display-contract.mjs를 웹용 .js로 복사하고 import 경로만 변환. 빌드에 필수 파일/JSON/표식/모듈 경로 조건이 잘못되면 실패한다. 출력 폴더에 예상하지 않은 파일이 있으면 삭제하지 않고 실패한다. 실행용 index/app/entry/mock-adapter/display-contract/styles의 6개 파일만 생성한다.

원본 수정 → `python frontend/build_web.py` → `python -m http.server 8766 --bind 127.0.0.1 --directory frontend/dist` → `http://127.0.0.1:8766/`에서 실행.

목록/상세 선택 → adapter.list(query)/detail(id) → controller의 validate/state/request token → renderDashboard → 상태별 화면 출력. 이후 HTTP 연결은 어댑터 교체 단계이며 이번에는 구현하지 않았다.

## 출력 안전성

event_id·trace_id가 본문과 aria-label에 직접 들어가던 위치를 esc로 처리했다. signal reason/rule/category/evidence/권장 조치 코드의 이스케이프도 유지한다. category 표시 매핑은 자체 키만 조회해 미정의 문자열에 원문 fallback을 적용한다. 응답 값 자체는 수정하지 않는다.

인라인 JSON은 `<`, `>`, `&`, U+2028/U+2029를 유니코드 이스케이프해 `</script>`로 HTML 문맥이 끝나지 않게 했다. JSON.parse 이후 원래 값은 동일하다.

검증 payload: 따옴표·꺾쇠·img/onerror·script 형태 문자열·한글. HTMLParser로 실제 렌더링 결과의 태그/속성과 디코딩 텍스트를 검사하고, 브라우저 DOM에서도 event_id·aria-label·원문·action code가 원래 문자열이며 injected img/속성이 0, script는 원래 JSON+entry 2개임을 확인했다. 이는 해당 출력 문맥의 회귀 검증이며 포괄적 침투 테스트·운영 보안 보증이 아니다.

## 실행 명령과 결과

모두 저장소 루트에서 실행. 기존 dist를 검사하는 데서 끝내지 않고 이번 frontend 원본을 먼저 빌드했다.

```powershell
python frontend/build_web.py
node --test --test-isolation=none frontend/tests/display-contract.test.mjs frontend/tests/render-contract.test.mjs
python -B frontend/tests/output-safety.test.py
node --check frontend/dist/app.js
node --check frontend/dist/entry.js
node --check frontend/dist/mock-adapter.js
node --check frontend/dist/display-contract.js
python -B frontend/tests/verify-core-examples.py
python -m http.server 8766 --bind 127.0.0.1 --directory frontend/dist
```

| 검증 | 실제 결과 |
|---|---|
| 원본 빌드 | 통과, 실행 6파일 |
| 기존 표시 계약 15 + 렌더링 5 | 20 passed / 0 failed / 0 skipped |
| 출력 해석·JSON·독립 빌드 | 3건 OK |
| .js 4개 구문 | 종료 코드 0 |
| 같은 저장소 core 재현 | 6개 모두 PASS; 판단값/사유/신호/근거 일치 |
| dist 없는 소스만으로 재빌드 | 안전성 테스트가 별도 빈 루트에 src/fixtures만 복사해 통과 |
| 잘못된 빌드 표식/필수 파일 | 기대한 실패 발생, 테스트 통과 |
| HTTP 브라우저 | 요청된 화면 동작 통과, console error 조회 0 |
| 실제 API/DB/인증/권한/CORS | 미구현·미검증, 변경 없음 |

중간 실패: Python mkdtemp의 제한적 임시 디렉터리 권한이 Windows sandbox에서 하위 쓰기를 막아 빌드 재현 테스트 1건이 실행 오류였다. workspace 생성물 하위에 권한을 상속하는 UUID 폴더를 만들고, 정리 전 경로·symlink를 확인하는 방식으로 수정해 최종 3건 통과했다. 첫 이관 스크립트의 cp949 읽기도 UTF-8 명시로 수정했다. 이관 스크립트는 제품/commit 대상이 아니다.

Playwright CLI는 설치되지 않아 `npx --no-install playwright --version`이 실행되지 않았다. 추가 설치 없이 CUA의 브라우저 Playwright 인터페이스로 로컬 HTTP 검증을 완료했다.

## 코드·테스트·브라우저 확인 구분

- 코드: 판단 필드는 응답 그대로, 사람 검토/권장 조치 재계산 없음. 동적 식별자 출력, JSON 삽입, clear/token 동작, 생성 입력의 독립성 확인.
- Node 실행: 다섯 판단 필드·원문 fallback·null/값 보존·빈 데이터·필수 타입/누락·빈 목록/실패/404/invalid·재시도·이전 상세/늦은 응답·필터 선택 제거. 모의 DOM의 HTML 출력 검증은 실제 브라우저 QA로 기록하지 않는다.
- Python 실행: HTMLParser가 payload를 새로운 태그/이벤트 속성으로 해석하지 않고 원래 텍스트/aria-label을 보존, JSON roundtrip, 소스-only 빌드, core 비교.
- HTTP 브라우저: 기본 여섯 목록/상세·KST, INFO 누락/검토 요구 없음/점수 0·1/두 조치/두 원문 펼치기, WARN+검토 요구 없음 AND 필터, 선택 제외 시 이전 상세 비움, 정상 빈 목록, 상세 실패 후 retry 성공. 마지막 source 재빌드 후 INFO를 다시 확인했다.
- 별도 로컬 output-check 화면: 안전성 payload의 실제 DOM 요소/속성 및 원문 값 보존 확인. 정상 fixture에는 이 payload를 추가하지 않았다.
- 접근성 전수·반응형/성능 측정·실제 서버 오류·네트워크 취소는 범위를 확장하지 않았고 통과로 기록하지 않는다.

## backend 계약 차이와 후속

연결 기준 main=a829ac48e3ddac471977d4556ee785af473eb19e의 app/schemas.py는 GET AlertDetailResponse/SignalResponse에 metadata를 포함한다.

원격 feature/dashboard-api-contract=6e38956c9c5af01c480658a7f569d454c9f5c872는 GET용 AlertSignalResponse/AlertDetailResponse에서 metadata를 제외하며 rule별 evidence allowlist도 적용한다. main에 해당 계약이 합쳐져 있지 않음을 원격 refs와 모델 코드로 확인했다. 이 frontend branch는 main 기준이고 backend 변경을 가져오거나 수정하지 않았다.

연결 전에 해당 계약 branch의 반영 여부와 정확한 배포 backend commit을 확정해야 한다. 프론트는 metadata를 표시하지 않고 기존 GET /alerts·/alerts/{alert_id} 필드를 사용한다. count는 현재 페이지 수이며 전체 건수·총 페이지로 표시하지 않는다.

후속: 실제 GET 어댑터, 서버 human_required 필터/커서 query, 실제 HTTP 404·실패·비정상 JSON·422 분류, 요청 취소/순서 역전, 조회 trace와 생성 trace의 구분을 검증한다. 이번에는 API 연결·backend/core/DB·인증·권한·CORS를 수정하지 않았다.
