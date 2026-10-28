# 검색 기록(thread) 서버 저장 decisions

Glossary: none · ADRs: none

Jira: S15P31A302-116 "검색 기록(thread) 서버 저장". 2026-10-29 grill(`--auto`, Codex 답변자)을 닫으며 쓴 결정 로그다. 출발점은 place-search D-91과 spec 53이다. 지금 thread는 기기의 `localStorage`에 저장한다.

상태 읽는 법:
- `settled`: 사용자가 정했거나, 두 모델(Claude, Codex)이 같은 답을 낸 자동 제안을 사용자가 결정 로그 확인 때 받아들였다.
- `provisional`: 지금은 `Default`대로 구현하되, 맨 아래 "다시 검토할 것"의 조건이 생기면 다시 연다.

## D-1 서버에 저장하는 단위와 내용
- Status: settled
- Decision: FE가 첫 페이지마다 turn 하나를 서버에 추가하고, turn 필드는 지금과 같다. 검색 API는 바꾸지 않는다.
  - FE는 첫 페이지 응답을 받을 때마다 그 요청(turn) 하나를 thread id와 turn id로 서버에 추가한다. 검색 API(`POST /api/v1/places/search`)는 바꾸지 않는다.
  - 같은 계정, 같은 thread, 같은 turn을 다시 보내도 중복이 생기지 않는다. 이미 저장된 turn은 나중에 온 요청이 덮어쓰거나 지우지 않는다.
  - turn에는 지금과 같은 필드를 저장한다: id, 종류(new|followUp|region), 기준 turn(`baseId`), 시각(`at`), 첫 페이지 요청 본문, 첫 페이지 응답(`nextCursor` 없이).
  - `conditions`와 `previousConditions`는 해석하지 않고 그대로 둔다. 다시 연 thread는 검색을 다시 부르지도, 카드를 다시 만들지도 않는다(place-search D-90).
- Rejected:
  - thread 전체를 id로 덮어쓰기(지금의 `saveThread`) → 두 기기가 같은 thread에 쓰면 서로의 turn을 지운다. 또 요청마다 스냅샷 전체를 다시 보낸다.
  - 검색 API가 직접 기록 → 익명 API에 인증이 붙고, AI 파트의 경계인 승인된 검색 계약이 바뀐다.
  - 요청만 저장하고 다시 검색 / 장소 id만 저장하고 카드 재구성 → 과거 결과를 그때 그대로 보여 주는 D-90, spec 57과 어긋난다.

## D-2 절대 일어나면 안 되는 것
- Status: settled
- Decision: 아래 열한 가지는 어떤 입력에서도 일어나지 않는다.
  1. thread의 주인은 인증 결과로만 정한다. 다른 사용자의 thread와 turn은 id를 알아도 읽거나 바꿀 수 없다.
  2. 토큰이 아직 유효해도 탈퇴한 사용자는 모든 기록 API에서 401이다.
  3. 로그아웃하거나 계정을 바꾼 뒤에는 이전 계정의 것이 새 계정에 보이거나 저장되지 않는다. 목록, 열린 thread, 과거 결과, 캐시, 재전송 대기분, 늦게 온 응답 모두 해당한다.
  4. 같은 turn을 다시 보내도 중복되지 않는다. 여러 기기에서 동시에 저장해도 이미 저장된 turn이 지워지거나 바뀌지 않는다.
  5. 성공한 첫 페이지만 turn이 된다. 다음 페이지, 첫 화면 "근처 맛집" 카드, 실패하거나 버린 검색은 turn이 아니다.
  6. `baseId`는 같은 thread의 turn만 가리킨다.
  7. 기록 저장 실패가 성공한 검색을 실패로 바꾸지 않는다.
  8. 다시 연 스냅샷은 다시 받아 오지 않는다. 후속 요청에는 그 스냅샷의 `conditions`를 그대로 보낸다.
  9. 개수 제한이나 자동 삭제가 없다.
  10. 목록 순서는 같은 시각까지 포함해 안정적이다.
  11. 저장 경로에서 검색 본문과 취향을 로그에 남기지 않는다.
- Reuse: `be/src/main/java/kr/co/fitdining/api/auth/repository/AuthUserRepository.java#existsByIdAndDeletedAtIsNull` (reuse) — 탈퇴한 사용자를 401로 막는 확인

## D-3 API 경로와 인증
- Status: settled
- Decision: `/api/v1/me/search-threads` 아래에 목록, thread 하나, turn 추가 API를 둔다.
  - **목록:** `GET /api/v1/me/search-threads?cursor=` → `{items:[{id,title,lastAt}], nextCursor?}`, 최대 20개.
  - **thread 하나:** `GET /api/v1/me/search-threads/{threadId}` → `{id, turns}`. turn은 D-7 순서다. 없거나 남의 것이면 404.
  - **turn 추가:** `PUT /api/v1/me/search-threads/{threadId}/turns/{turnId}`. 본문은 turn 전체이고, 경로와 본문의 id가 같아야 한다.
    - 성공하면 204이고, thread의 첫 turn이면 thread를 만든다.
    - 같은 id에 같은 내용이면 204다.
    - 같은 id에 다른 내용이면 409이고 아무것도 바꾸지 않는다.
  - **인증:** 사용자는 토큰에서만 얻고, 탈퇴하지 않은 회원만 쓸 수 있다. 리뷰처럼 컨트롤러가 `AuthUseCases.authenticate`를 직접 부른다.
  - **cursor:** 내용을 알 수 없는 값이고, 형식이 틀리면 400이다.
  - **페이징 일관성:** 페이지 사이의 고정 스냅샷은 보장하지 않는다. FE가 id로 중복을 걸러 내고, 시트를 다시 열면 첫 페이지부터 다시 받는다.
  - 경로 계열은 북마크(bookmark D-4)의 `/api/v1/me/...`와 같다.
- Rejected: `/api/v1/users/{userId}/search-threads` → 경로의 userId와 토큰을 비교하는 일만 늘어난다. offset paging → 기록이 추가되면 페이지가 밀린다.
- Reuse: `be/src/main/java/kr/co/fitdining/api/auth/ports/AuthUseCases.java#authenticate` (reuse) — Bearer 토큰에서 사용자 확인

## D-4 서버가 검사하는 것
- Status: settled
- Decision: 서버는 turn의 겉모양과 thread 규칙만 검사하고 스냅샷 내용은 해석하지 않는다.
  - **형식:**
    - id는 1~128자이고 경로와 같아야 한다.
    - 종류, 유한한 밀리초 `at`, 비어 있지 않은 1~200자 질문을 확인한다.
    - 응답과 `conditions`는 객체, `items`는 배열, `totalCount`는 0 이상의 정수여야 한다.
    - 요청에 `cursor`, 응답에 `nextCursor`가 있으면 안 된다.
  - **thread 규칙:**
    - thread의 첫 turn은 `baseId` 없는 `new`다.
    - followUp과 region은 같은 계정, 같은 thread에 이미 저장된 `baseId`가 있어야 한다.
    - "이 조건으로 다시 검색"으로 나중에 오는 `new`는 `baseId` 없이 허용한다.
  - **해석하지 않는 것:** 스냅샷 안의 내용은 해석하지 않고, 장소가 있는지도 확인하지 않는다.
  - **응답 코드:**

    | 코드 | 경우 |
    |---|---|
    | 400 | 형식, 종류, 기준 turn 규칙 위반 |
    | 409 | 기준 turn이 아직 없음, 같은 id에 다른 내용 |
    | 404 | 남의 thread, 없는 thread |
    | 401 | 인증 없음, 탈퇴한 사용자 |
    | 413 | 기존 API 본문 상한 2MB 초과(`docs/infra/design.md:319`) |

  - **로그와 원자성:** 본문은 로그에 남기지 않는다. thread 생성, 기준 turn 확인, turn 추가는 한 트랜잭션에서 원자적으로 일어난다.

## D-5 저장 실패와 재전송
- Status: settled
- Decision: 저장 실패는 조용히 넘기고, 같은 계정·페이지 세션 안에서만 같은 id로 다시 보낸다.
  - **표시:** 저장에 실패해도 사용자에게 알리지 않고 검색 결과는 그대로 보인다.
  - **재전송:** 같은 계정, 같은 페이지 세션 안에서 네트워크 오류와 5xx에만 다시 보낸다. 저장되지 않은 turn을 같은 id로 정해진 횟수까지 보내고, 기준 turn을 먼저 보낸다.
  - **고아 turn 금지:** 기준 turn이 끝내 저장되지 않으면 그 뒤 turn도 저장하지 않는다. 서버에 고아 `baseId`가 생기지 않는다.
  - **토큰 만료:** 기존의 1회 갱신을 같은 계정일 때만 쓴다.
  - **멈춤:** 최종 401, 탈퇴, 계정 전환, 페이지 종료 때 재전송을 멈춘다. 새로고침 뒤에도 남는 큐는 두지 않는다.
  - **구현자 재량:** 언제, 몇 번 다시 보낼지.
- Rejected:
  - 재전송 없음(지금처럼 조용히 실패) → 뒤 turn의 `baseId`가 비어 있는 turn을 가리킨다.
  - 실패 토스트 → 검색이 주 기능인데 부가 기록 실패로 화면을 방해한다.
  - 기기에 남는 큐 → 계정별로 나누고 전환 때 비우는 일이 늘어 D-2의 3을 어길 곳이 생긴다.

## D-6 로그인 세션이 바뀔 때 비우기
- Status: settled
- Decision: 로그인한 사람이나 세션이 바뀌면 FE가 이전 계정의 화면 상태와 캐시를 모두 비운다.
  - **언제:** 로그인한 사용자나 로그인 세션이 바뀔 때, 로그아웃할 때, 인증을 최종적으로 잃었을 때. 같은 사용자, 같은 세션의 액세스 토큰 갱신은 해당하지 않는다.
  - **무엇을:** FE가 열린 thread, 과거 결과, 선택, 최신 카드, 검색 쿼리 캐시, 불러온 목록과 thread, 재전송 대기분을 비운다.
  - **늦은 응답:** 바뀌기 전에 시작한 검색, 다음 페이지, thread 읽기, 저장은 끝나도 새 상태를 바꾸지 못한다. 요청을 취소하는 것만으로 끝내지 않고, 응답이 끝날 때 다시 확인한다.
  - **비회원 화면의 검색:** 로그인한 회원의 기록으로 저장하지 않는다.
- Rejected: 로그아웃 때 세션만 지우기(지금, `fe/src/domains/auth/api/auth-client.ts`) → 같은 기기의 다음 사람이 이전 사람의 결과를 본다.

## D-7 순서와 표시
- Status: settled
- Decision: turn은 서버에 처음 저장된 순서, 목록은 마지막 turn의 기기 시각 최신순이다.
  - **turn 순서:** 서버에 처음 저장된 순서다. 다시 보내도 순서가 바뀌지 않는다.
  - **목록 순서:** 마지막 turn의 기기 시각(`at`) 최신순이고, 같으면 thread id 역순이다.
  - **표시:** 화면의 시각은 기기 시각이다. 제목은 첫 turn의 질문으로 고정한다.
- Rejected: turn을 기기 시각으로 정렬 → 기기마다 시계가 달라 기준 요청과 마지막 결과가 뒤바뀔 수 있다. 목록을 서버 수신 시각으로 정렬 → 재전송이 늦게 도착한 thread가 맨 앞으로 튄다.

## D-8 비회원과 기존 기기 기록
- Status: settled
- Decision: 비회원은 기기에, 회원은 서버에 저장하고, 지금 기기에 쌓인 기록은 버린다.
  - **저장 위치:** 비회원은 지금처럼 기기에만 저장하고, 회원은 서버에 저장한다. 회원의 thread는 기기에 쓰지 않는다.
  - **로그인할 때:** 비회원 기록을 회원 계정으로 자동 업로드하지 않는다(고도화 때 추가).
  - **기존 키:** 지금 기기에 쌓인 주인 표시 없는 기록(`fit-dining:search-threads`)은 버린다. 그 키는 읽지도, 복원하지도, 올리지도 않는다. 비회원 기록은 다른 키나 형식을 쓰고 옛 키로 돌아가지 않는다.
  - **실패 격리:** 비회원 기기 저장은 spec 53처럼 실패를 격리한다. 저장소를 못 쓰거나, JSON이 깨지거나, thread 형식이 틀려도 화면과 검색은 멈추지 않고 틀린 thread만 버린다.
  - **구현자 재량:** 새 키 이름과 형식 버전.
- Rejected: 비회원은 저장하지 않고 로그인 안내 → 지금 되는 기능을 없앤다. 로그인 때 자동 업로드 → 공용 기기에서 남의 검색이 내 계정으로 들어갈 수 있고, 병합 흐름이 필요하다. 기존 키를 비회원 기록으로 유지 → 이전 로그인 사용자의 기록이 비회원 화면에 남는다.

## D-9 FE 변경 범위와 모듈 경계
- Status: settled
- Decision: `thread-storage.ts`와 최소한의 호출부까지 바꾸고, 저장소 선택은 이 모듈이 맡는다.
  - **변경 범위:** `ui/thread-storage.ts`와 최소한의 호출부까지 바꾼다. 이 spec이 place-search spec 53의 "이 모듈만 바꾼다"를 대체한다고 명시한다. place-search 문서는 고치지 않는다.
    - 최근 검색 시트: 로딩, 빈 목록, 실패, 더 보기.
    - thread 열기: 로딩. 실패하면 지금 결과를 유지하고 다시 시도할 수 있다.
  - **저장소 모듈:** 화면은 `ui/thread-storage.ts`로만 thread를 읽고 쓴다. 이 모듈이 비회원 기기 저장과 회원 서버 저장 중 하나를 고르고, 세션별 캐시와 재전송(D-5)을 맡는다.
  - **순수 함수:** thread 모양, `appendTurn`, 형식 검사, 정렬, 시각 문구는 `model/search-threads.ts`의 순수 함수로 남는다. 목록용 `{id,title,lastAt}` 요약 타입과 순수 helper는 추가할 수 있다. `model`에는 인증, 네트워크, 재전송 같은 부수 효과를 두지 않는다.
  - **하지 않는 것:** 목록을 그리려고 가짜 turn을 만들거나 모든 thread를 미리 받지 않는다. 서버 thread를 기기 시각으로 다시 정렬하지 않는다.
  - **실패 표시:** 서버 읽기가 실패하면 빈 목록이 아니라 실패 상태를 보인다.
  - **인증 연결:** place 도메인은 auth 도메인을 import하지 않고, 인증은 app 계층에서 이어 준다(`fe/src/app/place/place-detail-with-reviews.tsx`가 선례).
- Rejected: `thread-storage.ts`만 바꾸기(Jira 원문, spec 53) → 지금 `useThreads`와 `getThread`가 동기라 서버 읽기의 로딩, 실패, 페이징을 호출부가 표현할 수 없다.
- Reuse: `fe/src/domains/place/ui/thread-storage.ts#saveThread` (modify) — 저장소 선택, turn 추가, 재전송을 이 모듈 안으로 · `fe/src/domains/place/model/search-threads.ts#appendTurn` (reuse) — turn 추가 규칙 · `fe/src/domains/place/model/search-threads.ts#parseThreads` (reuse) — 비회원 기기 기록과 서버 thread의 형식 검사 · `fe/src/domains/place/ui/recent-search-sheet.tsx#RecentSearchSheet` (modify) — 로딩, 빈 목록, 실패, 더 보기 · `fe/src/domains/place/ui/search-screen.tsx#SearchScreen` (modify) — thread 저장 호출과 열기의 비동기, 실패 처리 · `fe/src/domains/auth/api/with-access-token.ts#withAccessToken` (reuse) — 회원 기록 요청

## D-10 기존 검색 화면 계약 유지
- Status: settled
- Decision: 승인된 place-search 화면 계약은 비회원과 회원 모두 그대로이고, 다른 점만 spec에 적는다.
  - **유지하는 것:** 승인된 place-search 화면 계약(spec 27, 43, 46/73의 상세 카드 우선순위, 53, 57)은 비회원과 회원 모두 그대로다.
    - 화면 상태는 메모리에만 두고, 새로고침하면 첫 화면에서 시작한다.
  - **바뀌는 것:** D-5 재전송, D-6 세션 비우기, D-7 순서, D-9 비동기 읽기만 다르고, spec에 명시한다.
  - **"네트워크 요청 없이"의 뜻:** 검색 API를 다시 부르지 않는다는 뜻으로 좁힌다.
    - 회원 thread는 기록 API로 받는다.
    - 받는 동안 지금 결과를 유지하고, 성공한 뒤에만 화면을 바꾼다.
    - 회귀 테스트는 기록 읽기와 검색 호출을 구분한다.

## D-11 검색 엔진 입력과 저장 기록의 성격
- Status: provisional
- Decision: 엔진 입력은 바꾸지 않고, 저장한 기록은 본인에게 다시 보여 주는 데만 쓴다.
  - **엔진 입력:** 이번 작업은 엔진이 받는 것을 바꾸지 않는다. 히스토리 관리만 한다.
    - 후속 요청은 지금처럼 기준 turn 응답의 `conditions`를 `previousConditions`로 그대로 돌려보낸다.
  - **저장 기록의 성격:** 서버에 저장한 thread는 본인에게 다시 보여 주는 복원 데이터일 뿐, 엔진이 실제로 낸 결과라고 검증된 값이 아니다.
    - 응답 서명이나 서버 측 기록은 추가하지 않는다.
    - 지난 thread 전체를 AI 입력, 공개 통계, 추천 평가에 쓰는 기능도 만들지 않는다.
- Default: 위 동작대로 AI 파트 확인 전에 진행한다(사용자: "일단 a"). AI 파트가 대화 기록을 검색 문맥으로 쓰겠다고 하면 다시 연다. 그때는 엔진이 실제로 낸 결과임을 보장하는 별도 계약이 필요하다.
- Rejected: 후속 요청마다 BE가 저장된 이전 turn을 엔진에 넘김 → AI 파트의 엔진 계약이 아직 없고, 사용자가 이번 범위를 히스토리 관리로 정했다.

## D-12 보관 기간과 삭제
- Status: settled
- Decision: 개수 제한, 보관 기한, 사용자 삭제 기능은 이번 작업에 넣지 않는다(지금 기기 저장과 같다). 데모 규모라 무한히 쌓이는 것을 감수한다. 탈퇴 때 삭제는 D-13이다.
- Rejected: 사용자별 개수 상한 → 요청에 없던 제한이다. 최근 검색 시트에서 지우기 → 요청에 없고 화면 설계가 더 필요하다.

## D-13 탈퇴할 때 기록
- Status: provisional
- Decision: 탈퇴 트랜잭션 안에서 그 회원의 thread와 turn을 hard delete한다. 탈퇴와 기록 저장이 동시에 일어나도 지운 기록이 되살아나지 않는다(D-2의 2, D-4의 원자성).
- Default: hard delete로 구현한다. 사용자가 북마크의 탈퇴 처리(bookmark Q6)와 함께 팀에 확인한다. 팀이 남기기로 하면 다시 연다.
- Rejected: 남겨 두기 → 아무도 읽지 못하는 개인 데이터만 쌓인다. 취향(`preferences`)과 소셜 계정도 탈퇴 때 지운다.
- Reuse: `be/src/main/java/kr/co/fitdining/api/user/UserService.java#withdraw` (modify) — 같은 트랜잭션에서 그 회원의 검색 기록 삭제를 더한다

## D-14 Mock 장소 id로 쌓인 기록
- Status: settled
- Decision: 이번 작업은 아무것도 지우지 않는다. local/dev에서 Mock 장소 id(1..36)로 쌓인 기록(검색 기록과 북마크)은 DB 장소 id와 맞지 않으므로, 장소 읽기를 DB로 바꾸는 S15P31A302-115에서 초기화한다. 그 전에는 실제 사용자가 없다. prod에는 Mock 엔진이 없어 Mock id가 쌓이지 않는다.
- Rejected: 기록 유지 → 다시 연 과거 카드가 다른 장소를 연다.

## D-15 Flyway 마이그레이션 번호
- Status: settled
- Decision: 번호를 미리 잡아 두지 않는다. MR을 merge하기 직전에 develop의 최신 번호 +1로 정한다. 지금 develop의 최신은 V6이다.

## D-16 검사할 경계
- Status: settled
- Decision: BE는 실제 PostgreSQL과 HTTP로, FE는 jsdom으로, 그리고 두 기기·두 계정으로 직접 확인한다.
  - **BE, 실제 PostgreSQL과 마이그레이션:**
    - 같은 turn 재전송, 다른 내용 충돌 때 저장된 스냅샷 유지.
    - 첫 turn과 같은 thread 기준 turn 규칙, 일부만 쓰이지 않음.
    - 같은 turn·다른 turn 동시 추가에서 중복과 유실 없음, 재전송해도 처음 순서 유지.
    - `at`이 거꾸로 가도 제목 고정과 마지막 turn `at` 기준 목록.
    - 20개 초과와 같은 시각이 cursor 페이지를 넘는 경우, 주인 격리.
    - D-13 탈퇴 삭제.
  - **HTTP:**
    - 토큰 없음, 잘못된 토큰, 탈퇴한 사용자의 401(모든 API, 실제 계정 상태를 읽는 경로로).
    - 남의 thread 읽기와 추가의 404.
    - 400, 409, 실제로 큰 본문의 413.
    - 성공 응답 모양.
  - **FE jsdom:**
    - 목록: 첫 로딩, 빈 목록, 실패, 더 보기, 중복 제거, 다시 열 때 첫 페이지부터.
    - thread 열기 실패 때 지금 결과 유지와 다시 시도. 저장 실패 때 검색 유지.
    - 재전송: 같은 id, 기준 turn 먼저, 정해진 횟수. 최종 401과 계정 전환 때 멈춤. 고아 turn 없음.
    - 세션 전환: 실제 store와 쿼리 캐시로 비우기 확인. 늦은 검색, 다음 페이지, thread 응답 버리기.
    - 토큰 갱신 때 화면 유지. 비회원 검색이 회원 기록으로 저장되지 않음.
    - 비회원: 기기 저장의 실패 격리, 저장소 예외, 옛 키만 있는 경우(D-8). spec 325의 Node 파서와 jsdom 경계도 유지.
  - **통합 시나리오와 수동 확인(두 기기, 두 계정):**
    - 다른 기기에서 검색 호출 없이 스냅샷이 복원된다.
    - 아무 이전 turn에서나 후속 요청을 보내면 `previousConditions`가 그대로 간다(안쪽의 null과 빈 객체 포함).
    - 같은 thread에 이어서 쌓인다.
  - **구현자 재량:** 테스트 파일 이름, helper, 재전송 간격.

## 다시 검토할 것

결정은 있지만 사용자가 다시 확인하기로 한 항목이다. 바뀌면 grill을 다시 열어 해당 D-n을 고친다.

- **D-13 탈퇴 때 hard delete:** 사용자가 북마크 Q6와 함께 팀에 확인한다. 남기기로 하면 D-13과 D-16의 탈퇴 검사를 고친다.
- **D-11 엔진 입력:** AI 파트에 대화 기록을 검색 문맥으로 쓸지 확인한다(Jira 원문의 "시작 전에 AI 파트와 확인"). 쓰겠다고 하면 D-11, D-1의 저장 내용, D-4의 검증을 다시 본다.
- **D-14 초기화:** S15P31A302-115를 grill할 때 local/dev 검색 기록과 북마크 초기화를 그 작업 범위에 넣는다.
- **Jira 설명:** "FE는 `ui/thread-storage.ts`만 바꾼다"가 D-9와 다르다. Jira S15P31A302-116 설명을 D-9에 맞게 고친다.
