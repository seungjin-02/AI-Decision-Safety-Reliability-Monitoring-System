# 테스트와 검증

저장소 루트에서 실행한다. Python 의존성은 requirements.txt, 프론트 테스트는 Node.js 24+의 내장 runner를 사용한다.

## 기본 회귀

```powershell
python frontend/build_web.py
python -m pytest -q tests frontend/tests/test_local_launcher.py
node --test --test-isolation=none frontend/tests/*.test.mjs
python -B frontend/tests/output-safety.test.py
python -B frontend/tests/verify-core-examples.py
```

| 위치 | 보호하는 경계 |
| --- | --- |
| tests/Unit_Test | 검증·정규화·신호·집계·gate·조치의 개별 규칙 |
| tests/Integration_Test, Design_Invariant_Test | 평가 파이프라인과 위험/불확실성/검토 분리 |
| tests/API_Test | HTTP 오류, trace, 조회 필터·커서, metadata/evidence 노출, 정적 대시보드 |
| tests/DB_Test | schema·외래키·트랜잭션·rollback·action 순서 |
| tests/Benchmark_Test | 고정 workload 생성과 manifest |
| frontend/tests/test_local_launcher.py | 실행기 DB 보호·인수·포트·빌드 |
| frontend/tests/*.test.mjs | 표시·원문·서버값 보존, 응답 오류·순서 역전, query·페이지네이션·DOM 이벤트 |
| output-safety.test.py | 동적 본문/속성 이스케이프와 인라인 JSON 안전성 |
| verify-core-examples.py | 여섯 합성 fixture와 현재 core 출력 대조 |

Node의 DOM sink는 출력·이벤트 회귀이며 실제 브라우저 렌더링 검증은 아니다. TestClient 결과도 실제 TCP HTTP나 브라우저 통과를 뜻하지 않는다. Python CI는 `pytest -q`로 tests/를 실행한다. 프론트 Node·출력 안전성·런처 테스트는 위 명령으로 별도 실행한다.

## 실제 API와 브라우저 검증 (선택)

아래 절차는 **새 빈 격리 DB** 전용이다. HTTP 스크립트는 240건의 비민감 입력을 POST하고 해당 DB의 저장 시각을 의도적으로 맞춰 페이지 경계를 만든다. 기존 사용자 DB에 사용하지 않는다. 서버와 별도 터미널에서 차례로 실행한다.

```powershell
python c2_dashboard_local.py --db ../dashboard-check/alerts.db --port 8001
# 다른 터미널
python frontend/tests/verify-query-controls.py --db ../dashboard-check/alerts.db --port 8001 --output ../dashboard-check/http.json
node frontend/tests/browser-query-controls.mjs --evidence ../dashboard-check/http.json --output ../dashboard-check/browser
```

HTTP 검증은 core·DB·GET 대조, 48개 필터/limit 조합, 양방향 전체 커서 탐색, KST 경계·잘못된 query·상세 404를 확인한다. 브라우저 검증은 실제 API 화면의 입력·필터·직접 조회·더보기·보기 전환·키보드·네트워크를 확인한다. Chrome와 Playwright 설치가 필요하며 앱 런타임 의존성은 아니다. 필요하면 `--playwright /absolute/path/to/playwright/index.mjs`를 지정한다. browser 출력은 새 폴더여야 한다.

추가 수동 점검: 긴 원문 끝부분·null 근거, 390/768/1024/1440px와 200% 확대, Tab/Enter/Space·닫기 복귀, 맨 위로 이동 시 입력·누적 유지, 실패/404/잘못된 응답·늦은 응답 후 이전 상세 미노출. 화면 확인·HTTP·로그·자동 테스트 결과는 구분해 기록한다.

증거·HAR·스크린샷·DB는 Git 밖에 보관한다. 측정 방법과 공식 결과 보존은 [벤치마크 계약](benchmark-contract.md)을 따른다.
