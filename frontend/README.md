# 대시보드 개발 안내

실행과 환경 준비는 [루트 README](../README.md#시작하기), 검증 명령은 [테스트 안내](../docs/test-strategy.md)를 따른다. 화면 의미·스타일은 [DESIGN](DESIGN.md)에 모았다.

## 빌드와 모드

`python frontend/build_web.py`는 src와 fixtures/alerts.json만으로 dist에 런타임 파일 7개를 만든다. dist는 Git 제외 생성물이며 직접 수정하지 않는다. FastAPI는 이 디렉터리만 `/dashboard/`로 제공한다. 빌드가 없으면 대시보드는 503이지만 기존 API는 기동한다.

- `/dashboard/`: 실제 API, 로컬 API 연결 표시
- `/dashboard/?mode=mock`: 합성 fixture, 예시 데이터 표시
- mock에서만 `preview=detail-error` 등의 실패 시나리오를 적용한다. API 실패 시 mock으로 자동 전환하지 않는다.

## 코드 책임

| 파일 | 책임 |
| --- | --- |
| src/entry.js | 명시적 모드 선택과 시작 |
| src/api-adapter.js | 같은 출처의 GET; HTTP/JSON/연결 오류 구분 |
| src/mock-adapter.js | 합성 fixture의 필터·정렬·페이지 응답 |
| src/display-contract.mjs | 응답 검증, 표시 매핑, controller 상태·요청 순서 |
| src/app.js | DOM 렌더링·입력 이벤트·포커스·스크롤 |
| src/styles.css | 배치·서체·색상 |

render는 HTTP 호출이나 core 판단을 하지 않는다. 서버 판단값과 원문은 보존하고 동적 본문·속성과 인라인 fixture JSON을 이스케이프한다.

## 조회 상태 계약

- `draft`는 편집 중 문자열, `query`는 마지막 적용 조건이다. 조회/Enter만 새 요청을 보낸다. 필터 초기화도 입력만 바꾸고 개수·정렬은 유지한다. 잘못된 입력은 기존 결과를 유지한다.
- 새 목록 조회는 누적 결과·커서를 초기화한다. 더보기는 적용 조건과 서버 cursor를 사용한다. 실패 시 기존 목록·상세·커서를 유지하고 같은 조건으로 재시도한다.
- 서버 순서를 유지한다. 중복 ID·순서·cursor 불일치가 있으면 부분 추가나 재정렬하지 않고 응답 오류로 처리한다.
- 유효한 새 상세 요청은 이전 상세를 즉시 비운다. 이전 요청의 성공·실패와 닫은 상세의 늦은 응답을 무시한다. 같은 ID의 요청도 순서를 구분한다.
- 목록 선택 상세는 목록 재조회 중 비우고 새 첫 페이지에 포함될 때만 복원한다. 직접 ID 상세는 목록 조건·빈 결과·실패와 독립적이다. 잘못된 ID는 요청 없이 기존 상세를 유지한다.
- 목록 count는 페이지 건수, 화면의 현재 불러온 N건은 누적 건수다. 전체 DB 건수로 추정하지 않는다. 커서 탐색은 고정 스냅샷이 아니다.

날짜·정렬·trace·조회 노출 필드의 서버 계약은 [API 문서](../docs/api-contract.md)를 따른다. KST 입력은 PC 시간대와 무관하게 +09:00으로 전달한다.
