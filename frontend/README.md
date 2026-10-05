# C2 의사결정 모니터

현재는 **예시 데이터 기반** 정적 화면이다. FastAPI·DB·인증 연결은 없다. 기존 목록/상세 배치와 Day5 표시 계약을 유지한다.

환경: Python 3.12+, Node.js 24+ (확인: Python 3.12.10 / Node 24.16.0). npm 설치는 필요 없다. package.json은 .js의 ES module 타입만 지정한다. 글꼴은 기존 외부 CDN을 사용한다.

저장소 루트에서:

```powershell
python frontend/build_web.py
python -m http.server 8766 --bind 127.0.0.1 --directory frontend/dist
```

`http://127.0.0.1:8766/`에서 확인하고 서버는 Ctrl+C로 종료한다. 브라우저 ES module을 위해 HTTP로 실행한다.

검증 순서:

```powershell
python frontend/build_web.py
node --test --test-isolation=none frontend/tests/display-contract.test.mjs frontend/tests/render-contract.test.mjs
python -B frontend/tests/output-safety.test.py
node --check frontend/dist/app.js
node --check frontend/dist/entry.js
node --check frontend/dist/mock-adapter.js
node --check frontend/dist/display-contract.js
python -B frontend/tests/verify-core-examples.py
```

- src/index.html: HTML 틀과 예시 JSON 삽입 위치.
- src/app.js: 렌더링·필터·선택·재시도 연결. createDashboard는 모의 DOM과 실제 브라우저에서 동일하게 사용한다.
- src/entry.js: 예시 응답 파싱과 앱 시작. 작은 진입점을 분리해 테스트가 bootstrap 문자열 위치에 의존하지 않게 했다.
- src/display-contract.mjs: 응답 검증·상태 관리·명시적 한글 매핑.
- src/mock-adapter.js: list(query)/detail(id)의 모의 조회. **실제 API 연결 때 교체할 위치**다. 내부 human 필터는 연결 시 서버 human_required로 변환해야 한다.
- src/styles.css: 현재 C2 디자인.
- fixtures/alerts.json: 여섯 정상 예시 응답. 판단값과 원문을 보존한다.
- build_web.py: 명시적 파일 복사, 안전한 인라인 JSON, .mjs→.js 경로 변환. 필수 입력/표식 오류와 예상하지 않은 출력 파일은 실패 처리한다.
- tests/: 표시 계약·HTML 출력·출력 해석·같은 저장소 core 재현 비교.

**dist는 생성물이며 Git에서 제외된다. 직접 수정하지 않는다.** frontend 원본만으로 빌드할 수 있으며 과거 디자인 폴더·Sites 설정은 필요 없다. 빌드에는 실행용 6개 파일만 포함한다.

예시 모의 상태: URL의 `?preview=`에 list-loading/list-empty/list-error/list-invalid, detail-loading/detail-404/detail-error/detail-invalid, empty-evidence/empty-signals/empty-actions/values, unknown-failure/unknown-rule. 메뉴는 추가하지 않는다. 오류 예시는 첫 요청만 실패해 재시도를 확인한다.

계약 및 검증 한계는 DESIGN.md와 DAY6-REVIEW.md를 참고한다. 실제 GET 연결·HTTP 오류·서버 필터/커서·조회 trace는 후속 작업이다.
