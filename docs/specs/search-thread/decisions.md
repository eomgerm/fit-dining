# 검색 기록(thread) 서버 저장 decisions

Glossary: none · ADRs: none

Jira: S15P31A302-116 "검색 기록(thread) 서버 저장". 2026-10-29 grill 두 번(첫 번째는 `--auto`, Codex 답변자)을 닫으며 쓴 결정 로그다. 출발점은 place-search D-91과 spec 53이다. 지금 thread는 기기의 `localStorage`에 저장한다.

상태 읽는 법:
- `settled`: 사용자가 정했거나, 두 모델(Claude, Codex)이 같은 답을 낸 자동 제안을 사용자가 결정 로그 확인 때 받아들였다.
- `provisional`: 지금은 `Default`대로 구현하되, 맨 아래 "다시 검토할 것"의 조건이 생기면 다시 연다.

## D-1 서버에 저장하는 단위와 내용
- Status: settled
- Decision: FE가 첫 페이지마다 turn 하나를 서버에 추가하고, turn 필드는 지금과 같다. 검색 API는 바꾸지 않는다.
  - turn 하나는 요청 하나와 그 첫 페이지 응답의 쌍이다. FE는 첫 페이지 응답을 받을 때마다 그 turn을 thread id와 turn id로 서버에 추가한다. 검색 API(`POST /api/v1/places/search`)는 바꾸지 않는다.
  - 같은 계정, 같은 thread, 같은 turn을 다시 보내도 중복이 생기지 않는다. 이미 저장된 turn은 나중에 온 요청이 덮어쓰거나 지우지 않는다.
  - turn에는 지금과 같은 필드를 저장한다: id, 종류(new|followUp|region), 기준 turn(`baseId`), 시각(`at`), 첫 페이지 요청 본문, 첫 페이지 응답(`nextCursor` 없이).
  - `conditions`와 `previousConditions`는 해석하지 않고 그대로 둔다. 다시 연 thread는 그때의 스냅샷이다. 검색을 다시 부르지도, 카드를 다시 만들지도 않는다(place-search D-90).
- Rejected:
  - thread 전체를 id로 덮어쓰기(지금의 `saveThread`) → 두 기기가 같은 thread에 쓰면 서로의 turn을 지운다. 또 요청마다 스냅샷 전체를 다시 보낸다.
  - 검색 API가 직접 기록 → 익명 API에 인증이 붙고, AI 파트의 경계인 승인된 검색 계약이 바뀐다. 검색 API의 회원 판단(개인화 작업)과도 엮이지 않게 둔다.
  - 요청만 저장하고 다시 검색 / 장소 id만 저장하고 카드 재구성 → 과거 결과를 그때 그대로 보여 주는 D-90, spec 57과 어긋난다.

## D-2 절대 일어나면 안 되는 것
- Status: settled
- Decision: 아래 열한 가지는 어떤 입력에서도 일어나지 않는다.
  1. thread의 주인은 인증 결과로만 정한다. 다른 계정의 thread와 turn은 같은 id라도 읽거나 바꿀 수 없다.
  2. 토큰이 아직 유효해도 탈퇴한 사용자는 모든 기록 API에서 401이다.
  3. 로그아웃하거나 계정을 바꾼 뒤에는 이전 계정의 것(목록, 열린 thread, 과거 결과, 캐시, 재전송 대기분, 늦게 온 응답)이 새 계정에 보이거나 저장되지 않는다.
  4. 같은 turn을 다시 보내도 중복되지 않는다. 여러 기기에서 동시에 저장해도 이미 저장된 turn이 지워지거나 바뀌지 않는다.
  5. 성공한 첫 페이지만 turn이 된다. 다음 페이지, 첫 화면 "근처 맛집" 카드, 실패하거나 버린 검색은 turn이 아니다.
  6. `baseId`는 같은 thread의 turn만 가리킨다.
  7. 기록 저장 실패가 성공한 검색을 실패로 바꾸지 않는다.
  8. 다시 연 스냅샷은 다시 받아 오지 않는다. 후속 요청에는 그 스냅샷의 `conditions`를 그대로 보낸다.
  9. 개수 제한이나 자동 삭제가 없다.
  10. 회원 목록 순서는 같은 시각까지 포함해 안정적이다. 비회원 목록은 지금 동작 그대로다.
  11. 저장 경로에서 검색 본문과 취향을 로그에 남기지 않는다.
- Reuse: `be/src/main/java/kr/co/fitdining/api/auth/repository/AuthUserRepository.java#existsByIdAndDeletedAtIsNull` (reuse) — 탈퇴한 사용자를 401로 막는 확인

## D-3 API 경로, id, 인증
- Status: settled
- Decision: `/api/v1/me/search-threads` 아래에 목록, thread 하나, turn 추가 API를 둔다. id는 FE가 만들고, thread id는 계정마다, turn id는 thread마다 유일하다.
  - **목록:** `GET /api/v1/me/search-threads?cursor=` → `{items:[{id,title,lastAt}], nextCursor?}`, 최대 20개. cursor는 내용을 알 수 없는 값이다.
  - **thread 하나:** `GET /api/v1/me/search-threads/{threadId}` → `{id, turns}`. 내 계정에 없는 thread면 404다.
  - **turn 추가:** `PUT /api/v1/me/search-threads/{threadId}/turns/{turnId}`. 본문은 turn 전체다. thread의 첫 turn이면 thread를 만든다. 같은 id를 같은 내용으로 다시 보내면 성공, 다른 내용이면 409이고 아무것도 바꾸지 않는다.
  - **id:** thread id는 `thread-` 뒤에 소문자 UUID, turn id는 `entry-` 뒤에 소문자 UUID다(지금 FE 형식). FE가 만든다. thread id는 계정마다 유일하므로 두 계정이 같은 id를 써도 서로 영향이 없다. turn id는 thread마다 유일하므로 다른 thread의 같은 turn id는 별개다.
  - **인증:** 사용자는 토큰에서만 얻는다. 리뷰처럼 컨트롤러가 `AuthUseCases.authenticate`를 직접 부른다. 이 검증은 DB를 보지 않으므로, 모든 기록 API는 다른 판단(404, 400, 409)보다 먼저 탈퇴하지 않은 회원인지 확인하고 아니면 401이다(리뷰 `requireActiveUser`와 같다).
  - **캐시 금지:** 기록 API 핸들러가 만드는 모든 응답(오류 포함)에는 `Cache-Control: no-store`를 붙인다. edge의 413과 Spring이 핸들러를 고르기 전에 끝내는 응답은 범위 밖이다. 지금 `no-store`는 `/api/auth/**`, `/api/v1/users/**`, `/api/v1/onboarding/**`에만 붙는다.
  - **다음 페이지:** `nextCursor`는 다음 페이지가 실제로 있을 때만 준다.
  - **페이징 일관성:** 페이지 사이의 고정 스냅샷은 보장하지 않는다. FE가 id로 중복을 걸러 내고, 시트를 다시 열면 첫 페이지부터 다시 받는다.
    - 감수: "더 보기" 도중 다른 기기의 늦은 시계로 마지막 요청 시각이 줄어든 thread는 그 시트에서 안 보일 수 있다. 다시 열면 보인다.
    - 감수: thread 하나 응답의 크기 상한과 turn 페이징은 두지 않는다(데모 규모, D-12).
  - 상태 코드와 본문 형식의 세부는 spec에 둔다.
- Rejected:
  - `/api/v1/users/{userId}/search-threads` → 경로의 userId와 토큰을 비교하는 일만 늘어난다.
  - offset paging → 기록이 추가되면 페이지가 밀린다.
  - id 전체에서 유일 → 남이 같은 id를 먼저 쓰면 내 저장이 막히고, "남의 thread"를 따로 가려야 한다.
  - 길이만 검사(1~128자) → `/`나 공백이 든 id가 경로를 깨뜨린다.
  - turn id를 계정 안에서 유일 → FE가 다른 thread에 같은 turn id를 보낼 일이 없고, `baseId`는 같은 thread 안만 가리킨다.
- Reuse: `be/src/main/java/kr/co/fitdining/api/auth/ports/AuthUseCases.java#authenticate` (reuse) — Bearer 토큰에서 사용자 확인 · `be/src/main/java/kr/co/fitdining/api/auth/presentation/AuthWebConfiguration.java#AuthWebConfiguration` (modify) — 기록 API에도 `no-store`를 붙인다(다른 방법으로 붙여도 된다)

## D-4 서버가 검사하는 것
- Status: settled
- Decision: 서버는 turn의 형식과 thread 규칙만 검사하고, `conditions`나 결과 내용은 해석하지 않는다. 기록 API는 토큰만 있으면 누구나 직접 부를 수 있어서, 깨진 turn이 저장되면 다른 기기에서 그 thread 전체가 버려진다.
  - **형식:** 서버가 받은 turn은 반드시 FE `parseThreads`가 받아들이는 모양이다(빈 질문 판단은 JS `trim`과 같은 공백 기준). 최상위 필드는 정해진 여섯 개뿐이다. `at`은 값이 정수이고 0 이상, JS `Date` 상한(8.64e15) 이하다. `totalCount`도 값이 정수인지로 본다. 키와 값의 어느 문자열에도 `\u0000`과 짝이 없는 서로게이트는 받지 않는다(`jsonb`가 거부한다). `request.cursor`와 `response.nextCursor`는 값이 `null`이어도 키가 있으면 안 된다. 어기면 400이다.
  - **thread 규칙:** 첫 turn은 `baseId` 없는 `new`다. followUp과 region은 `baseId`가 꼭 있고, 같은 계정, 같은 thread에 이미 저장된 자기 아닌 turn이다. `new`에는 `baseId`가 없다. "이 조건으로 다시 검색"으로 나중에 오는 `new`는 허용한다.
  - **판단 순서:** 인증과 탈퇴 확인(401)이 본문 파싱보다 먼저다. 그다음 형식(400), 같은 id가 이미 있으면 비교(204, 409), thread 규칙(400), 기준 turn 없음(409) 순이다.
  - **스냅샷 그대로:** 요청과 응답은 원문 JSON 트리로 받고 저장하고 돌려준다. 전역 Jackson 설정(`non_null`, `fail-on-unknown-properties`)이 스냅샷 안에 적용되지 않아, 안쪽 null도 그대로이고 검색 응답에 필드가 늘어도 저장된다. "그대로"는 JSON 값으로 같다는 뜻이다(키 순서는 바뀔 수 있고 숫자는 10진 값 그대로, double로 바꾸지 않는다). 바이트까지 같다는 뜻은 아니다. 본문을 DTO로 바인딩하지 않으므로 리뷰처럼 `@RequestBody` DTO를 쓰지 않고, 기록 API 전용 예외 처리기를 둔다.
  - **같은 내용:** 같은 id를 다시 보낼 때 PostgreSQL `jsonb` 값 비교로 판단한다. 키 순서와 공백은 무시한다.
  - **동시성:** thread 생성, 기준 turn 확인, turn 추가는 한 트랜잭션에서 thread를 잠그고 일어난다. 첫 turn의 동시 생성과 같은 turn의 동시 재전송도 500 없이 한 번만 저장된다.
  - **오류:** 409의 두 경우(기준 turn 아직 없음, 같은 id 다른 내용)는 오류 본문의 종류로 구분한다. 본문은 앱 로그에 남기지 않는다(DB 예외 메시지 포함). PostgreSQL 서버 로그는 infra 영역이라 이 작업 밖이다.
  - **"먼저 저장된":** DB 제약은 기준 turn이 같은 thread에 있고 자기 자신이 아닌지를 막고, 먼저 저장됐는지는 API가 thread 잠금 안에서 보장한다.
  - **돌려줄 때:** `baseId`가 없는 turn은 응답에서 `baseId` 키를 빼고 돌려준다(`null`을 내지 않는다). FE `parseThreads`가 `null`을 거부해 thread 전체를 버리기 때문이다. 숫자는 JSON 트리를 읽을 때부터 10진 값(BigDecimal)으로 다룬다.
  - **본문 크기:** 2MB 초과는 edge(Caddy)가 413으로 막고, BE는 검사하지 않는다. 첫 페이지 turn은 크게 잡아도 약 0.5MB다.
  - 필드별 형식 규칙과 응답 코드 표는 spec에 둔다.
- Rejected:
  - BE에도 2MB 상한 → edge가 이미 막고 `infra/edge/test/test-edge.sh`가 검사하므로 같은 경계가 둘이 된다.
  - 바이트가 같아야 같은 내용 → FE 직렬화가 조금만 바뀌어도 정상 재전송이 409가 된다.

## D-5 저장 실패와 재전송
- Status: settled
- Decision: 저장 실패는 조용히 넘기고, 같은 계정·페이지 세션 안에서만 같은 id로 다시 보낸다.
  - **표시:** 저장에 실패해도 사용자에게 알리지 않고 검색 결과는 그대로 보인다.
  - **보내는 순서:** 한 thread의 turn은 만든 순서대로 하나씩 보낸다. 앞 turn이 저장되기 전에는 뒤 turn을 보내지 않는다. 그래서 서버의 첫 turn과 turn 순서가 FE와 같다.
  - **재전송:** 같은 계정, 같은 페이지 세션 안에서 네트워크 오류와 5xx에만 다시 보낸다. 저장되지 않은 turn을 같은 id로 정해진 횟수까지 보낸다.
  - **4xx:** 409 `conflict`(같은 id가 이미 있음)는 저장된 것으로 보고 다음 turn을 보낸다. 401(D-6의 인증 상실)을 뺀 나머지 4xx는 모두 끝내 실패한 것으로 본다.
  - **고아 turn 금지:** 앞 turn이 끝내 저장되지 않으면 그 thread의 뒤 turn도 그 페이지 세션이 끝날 때까지 저장하지 않는다. 검색과 이어 검색은 그대로 된다. 서버에 고아 `baseId`가 생기지 않는다. 새로고침 뒤 그 thread를 열면 저장된 데까지 보이고, 거기서 이어 검색하면 다시 저장된다.
  - **토큰:** 처음 받는 토큰과 만료 때의 1회 갱신 모두 검색을 시작할 때와 같은 세션 키일 때만 쓴다. `withAccessToken`은 계정을 확인하지 않으므로 app 계층이 확인을 더한다.
  - **멈춤:** 최종 401(탈퇴 포함), 로그아웃, 계정 전환, 같은 사용자의 새 세션, 페이지 종료 때 재전송을 멈추고 대기분을 버린다. 새로고침 뒤에도 남는 큐는 두지 않는다.
  - **구현자 재량:** 언제, 몇 번 다시 보낼지.
- Rejected:
  - 재전송 없음(지금처럼 조용히 실패) → 뒤 turn의 `baseId`가 비어 있는 turn을 가리킨다.
  - 실패 토스트 → 검색이 주 기능인데 부가 기록 실패로 화면을 방해한다.
  - 기기에 남는 큐 → 계정별로 나누고 전환 때 비우는 일이 늘어 D-2의 3을 어길 곳이 생긴다.

## D-6 로그인 세션이 바뀔 때 비우기
- Status: settled
- Decision: 로그인한 사람이나 세션이 바뀌면 FE가 이전 계정의 화면 상태와 캐시를 모두 비운다.
  - **세션 키:** 회원은 `(userId, sessionId)`, 비회원은 "세션 없음", 아직 확인되지 않았으면 "모름"이다. 세션이 없으면 복원을 한 번 시도한다. 서버가 401로 세션 없음을 확인해 줬을 때만 "세션 없음"이 되고, 그 뒤로는 `getSession()`이 세션을 돌려줄 때까지 다시 복원하지 않는다(`subscribe` 알림마다 복원하지 않는다). 복원이 시간 초과나 네트워크 오류로 끝나면 "모름"이고, 다음 저장 때 다시 시도한다.
  - **저장 위치:** 검색을 시작할 때의 세션 키로 정한다. 회원이면 서버, 세션 없음이면 기기, 모름이면 저장하지 않는다(검색은 그대로 된다).
  - **언제:** 세션 키가 확인된 값(회원 또는 세션 없음)에서 다른 확인된 값으로 바뀔 때. 로그아웃, 다른 계정 로그인, 같은 사용자의 새 세션, 비회원의 로그인, 인증의 최종 상실이 모두 해당한다. "모름"이 확인된 값이 되는 것과, 같은 사용자, 같은 세션의 액세스 토큰 갱신은 해당하지 않는다. 그래서 확인 중에 시작한 검색은 화면에 남고 저장만 되지 않는다. 판단은 `subscribe` 알림을 받을 때 `getSession()` 값을 비교해서 한다.
  - **최종 상실:** 기록 API가 만료가 아닌 401을 주거나(탈퇴 포함) 갱신하고도 401이면 인증을 잃은 것으로 보고 이 탭의 세션을 지운다(`clearSession`). 서버 로그아웃이나 다른 탭 알림은 하지 않는다. place는 auth를 import하지 않으므로 app 계층이 이어 준다.
  - **무엇을:** 쿼리 캐시 전체(다른 도메인 캐시와 검색 후보 포함)와 검색 화면 상태(열린 thread, 과거 결과, 선택, 최신 카드, 불러온 목록과 thread), 재전송 대기분을 비운다. 현재 위치는 기기의 정보라 남긴다. 비회원 기기 기록은 지우지 않는다. 그래서 로그인하면 첫 화면에서 시작하고, 로그아웃하면 비회원 기록이 다시 보인다.
  - **언제 비우나:** 세션 키가 바뀌는 그 자리에서 app 계층이 바로 비운다. 장소 상세 화면도 최신 카드를 직접 읽으므로 검색 화면이 떠 있지 않아도 비워야 한다. 그래서 비우기는 모든 페이지를 감싸는 app 계층(쿼리 클라이언트를 가진 `fe/src/app/providers.tsx`)에 두고, 검색 화면 상태(`searchStore`)에는 비우는 기능을 더한다. 검색 화면이 뜰 때 세션 키를 다시 비교하는 것은 보조다.
  - **늦은 응답:** 바뀌기 전에 시작한 검색, 다음 페이지, thread 읽기, 저장은 끝나도 새 상태를 바꾸지 못하고 저장되지도 않는다. 비회원일 때 시작한 검색의 응답이 로그인 뒤에 오면 화면에도 기록에도 남기지 않는다. 요청을 취소하는 것만으로 끝내지 않고, 응답이 끝날 때 다시 확인한다.
- Rejected: 로그아웃 때 세션만 지우기(지금, `fe/src/domains/auth/api/auth-client.ts`) → 같은 기기의 다음 사람이 이전 사람의 결과를 본다.
- Reuse: `fe/src/domains/auth/api/auth-client.ts#subscribe` (reuse) — 세션 변경 감지, app 계층에서 place에 이어 준다 · `fe/src/app/home-entry.tsx#HomeEntry` (modify) — 검색 화면에 인증을 이어 준다 · `fe/src/app/providers.tsx#Providers` (modify) — 세션이 바뀌면 어느 페이지에서든 쿼리 캐시와 검색 화면 상태를 비운다 · `fe/src/domains/place/model/search-store.ts#createSearchStore` (modify) — 검색 화면 상태를 처음으로 되돌리는 기능

## D-7 순서와 표시
- Status: settled
- Decision: turn은 서버에 처음 저장된 순서, 목록은 마지막 turn의 기기 시각 최신순이다.
  - **turn 순서:** 서버에 처음 저장된 순서다. 다시 보내도 순서가 바뀌지 않는다.
  - **목록 순서:** 마지막으로 저장된 turn의 기기 시각(`at`) 최신순이고, 같으면 thread id 역순이다.
  - **표시:** 화면의 시각은 기기 시각이다. 제목은 첫 turn의 질문으로 고정한다.
- Rejected: turn을 기기 시각으로 정렬 → 기기마다 시계가 달라 기준 요청과 마지막 결과가 뒤바뀔 수 있다. 목록을 서버 수신 시각으로 정렬 → 재전송이 늦게 도착한 thread가 맨 앞으로 튄다.

## D-8 비회원과 기존 기기 기록
- Status: settled
- Decision: 비회원은 기기에, 회원은 서버에 저장하고, 지금 기기에 쌓인 기록은 버린다.
  - **저장 위치:** 비회원은 지금처럼 기기에만 저장하고 기록 API를 부르지 않는다. 회원은 서버에 저장하고, 회원의 thread는 기기에 쓰지 않는다.
  - **로그인할 때:** 비회원 기록을 회원 계정으로 자동 업로드하지 않는다(고도화 때 추가).
  - **기존 키:** 지금 기기에 쌓인 주인 표시 없는 기록(`fit-dining:search-threads`)은 버린다. 그 키는 읽지도, 복원하지도, 올리지도 않고, 페이지에서 저장소 모듈을 처음 쓸 때 회원과 비회원 모두 `removeItem`으로 지운다(실패해도 화면과 검색은 동작한다). 비회원 기록은 다른 키나 형식을 쓰고 옛 키로 돌아가지 않는다.
  - **실패 격리:** 비회원 기기 저장은 spec 53처럼 실패를 격리한다. 저장소를 못 쓰거나, JSON이 깨지거나, thread 형식이 틀려도 화면과 검색은 멈추지 않고 틀린 thread만 버린다.
  - **구현자 재량:** 새 키 이름과 형식 버전.
- Rejected: 비회원은 저장하지 않고 로그인 안내 → 지금 되는 기능을 없앤다. 로그인 때 자동 업로드 → 공용 기기에서 남의 검색이 내 계정으로 들어갈 수 있고, 병합 흐름이 필요하다. 기존 키를 비회원 기록으로 유지 → 이전 로그인 사용자의 기록이 비회원 화면에 남는다.

## D-9 FE 변경 범위와 모듈 경계
- Status: settled
- Decision: `thread-storage.ts`와 최소한의 호출부까지 바꾸고, 저장소 선택은 이 모듈이 맡는다.
  - **변경 범위:** `ui/thread-storage.ts`와 최소한의 호출부까지 바꾼다. 이 spec이 place-search spec 53의 "이 모듈만 바꾼다"를 대체한다고 명시한다. place-search 문서는 고치지 않는다.
    - 새 화면은 없다. 기존 최근 검색 시트에 서버 읽기의 로딩과 실패 상태만 더한다. 모양은 와이어프레임의 예외 상태와 기존 컴포넌트를 따른다.
    - 최근 검색 시트: 로딩, 빈 목록, 실패(다시 시도), 더 보기(실패하면 받은 목록 유지와 다시 시도). 목록에는 서버에 저장된 thread만 보이고, 시트가 열린 동안 저장이 끝나도 다시 받지 않는다. 중복 id는 먼저 받은 쪽을 남긴다.
    - thread 열기: 시트를 연 채 고른 줄에 로딩을 보이고, 성공하면 시트를 닫고 바꾼다. 실패하면 지금 결과를 유지하고 그 줄에서 다시 시도할 수 있다. 받는 동안 다른 줄을 고르면 마지막에 고른 것만 반영하고, 시트를 닫으면 받던 것을 버린다. "보는 중"인 thread를 고르면 지금처럼 시트만 닫는다.
    - 다시 열기: 회원 thread는 고를 때마다 기록 API로 받은 서버 것을 그린다. 이번 페이지 세션에 만들었지만 아직 저장되지 않았거나 끝내 실패한 turn은 다시 열면 보이지 않는다. 이미 받은 turn의 결과는 쿼리 캐시를 그대로 쓴다(place-search 57). 검색 API를 새로 부르지 않는다는 것만 보장한다.
    - 다른 기기에서 이어 쌓인 turn은 그 thread를 다시 열 때(새로고침하거나 다른 thread를 거쳐) 보인다. "보는 중"인 thread를 다시 받지는 않는다.
  - **저장소 모듈:** 화면은 `ui/thread-storage.ts`로만 thread를 읽고 쓴다. 이 모듈이 비회원 기기 저장과 회원 서버 저장 중 하나를 고르고, 세션별 캐시와 재전송(D-5)을 맡는다.
  - **순수 함수:** thread 모양, `appendTurn`, 형식 검사, 정렬, 시각 문구는 `model/search-threads.ts`의 순수 함수로 남는다. 목록용 `{id,title,lastAt}` 요약 타입과 순수 helper는 추가할 수 있다. `model`에는 인증, 네트워크, 재전송 같은 부수 효과를 두지 않는다.
  - **하지 않는 것:** 목록을 그리려고 가짜 turn을 만들거나 모든 thread를 미리 받지 않는다. 서버 thread를 기기 시각으로 다시 정렬하지 않는다.
  - **실패 표시:** 서버 읽기가 실패하면 빈 목록이 아니라 실패 상태를 보인다.
  - **인증 연결:** place 도메인은 auth 도메인을 import하지 않고, 인증은 app 계층에서 이어 준다(`fe/src/app/place/place-detail-with-reviews.tsx`가 선례).
- Rejected: `thread-storage.ts`만 바꾸기(Jira 원문, spec 53) → 지금 `useThreads`와 `getThread`가 동기라 서버 읽기의 로딩, 실패, 페이징을 호출부가 표현할 수 없다.
- Reuse: `fe/src/domains/place/ui/thread-storage.ts#saveThread` (modify) — 저장소 선택, turn 추가, 재전송을 이 모듈 안으로 · `fe/src/domains/place/model/search-threads.ts#appendTurn` (reuse) — turn 추가 규칙 · `fe/src/domains/place/model/search-threads.ts#parseThreads` (reuse) — 비회원 기기 기록과 서버 thread의 형식 검사 · `fe/src/domains/place/ui/recent-search-sheet.tsx#RecentSearchSheet` (modify) — 로딩, 빈 목록, 실패, 더 보기 · `fe/src/domains/place/ui/search-screen.tsx#SearchScreen` (modify) — thread 저장 호출과 열기의 비동기, 실패 처리 · `fe/src/domains/auth/api/with-access-token.ts#withAccessToken` (reuse) — 회원 기록 요청, 같은 계정 확인은 app 계층이 더한다

## D-10 기존 검색 화면 계약 유지
- Status: settled
- Decision: 승인된 place-search 화면 계약은 비회원과 회원 모두 그대로이고, 다른 점만 spec에 적는다.
  - **유지하는 것:** 승인된 place-search 화면 계약(본문 27, 43, 46(상세 카드 우선순위), 53, 57번 항목)은 비회원과 회원 모두 그대로다.
    - 화면 상태는 메모리에만 두고, 새로고침하면 첫 화면에서 시작한다.
  - **바뀌는 것:** D-5 재전송, D-6 세션 비우기, D-7 순서, D-9 비동기 읽기만 다르고, spec에 명시한다.
  - **"네트워크 요청 없이"의 뜻:** 검색 API를 다시 부르지 않는다는 뜻으로 좁힌다.
    - 회원 thread는 기록 API로 받는다.
    - 받는 동안 지금 결과를 유지하고, 성공한 뒤에만 화면을 바꾼다.
    - 회귀 테스트는 기록 읽기와 검색 호출을 구분한다.

## D-11 검색 엔진 입력
- Status: settled
- Decision: 이번 작업은 기록을 저장하고 본인에게 다시 보여 주기만 하고, 엔진이 받는 것은 바꾸지 않는다. 후속 요청은 지금처럼 기준 turn 응답의 `conditions`를 `previousConditions`로 그대로 보낸다.
- Rejected: 후속 요청마다 BE가 저장된 이전 turn을 엔진에 넘김 → AI 파트의 엔진 계약이 없고, 사용자가 이번 범위를 저장으로 정했다.

## D-12 보관 기간과 삭제
- Status: settled
- Decision: 회원과 비회원 모두 개수 제한과 보관 기한을 넣지 않는다(지금 기기 저장과 같다). 데모 규모라 무한히 쌓이는 것을 감수한다. 비회원 기기 저장소가 가득 차면 지금처럼 새 기록은 저장되지 않고 옛 기록은 남으며, 검색은 그대로 동작한다. 탈퇴 때 처리는 D-13이다. 사용자가 최근 검색에서 지우는 기능은 D-18이다(처음에는 넣지 않기로 했다가 D-18에서 바꿈).
- Rejected: 사용자별 개수 상한 → 요청에 없던 제한이다. 비회원 저장소가 차면 오래된 thread부터 지우기 → D-2의 9를 바꿔야 하고, 이번 범위는 서버 저장이다.

## D-13 탈퇴할 때 기록
- Status: provisional
- Decision: 지금은 soft delete다. 탈퇴해도 검색 기록은 지우지 않고, 회원의 `deleted_at`(soft delete)이 기록의 삭제 표시를 겸한다. 탈퇴한 사용자는 모든 기록 API에서 401이라(D-2의 2) 기록을 읽거나 쓸 수 없다. 기록 저장 구조에 따로 삭제 표시를 두지 않고, 탈퇴 처리(`UserService.withdraw`)도 고치지 않는다. 기록의 회원 FK는 `ON DELETE CASCADE`라서(`user_preferences`와 같다) 회원 행이 실제로 지워지면 기록도 함께 지워진다.
  - 감수: 탈퇴와 같은 순간 들어온 저장은 탈퇴 확인을 지나쳐 기록을 하나 더 쓸 수 있다. 읽히지 않으므로 잠금은 두지 않는다(리뷰 D-38과 같다).
  - 감수: 탈퇴 때 취향(`user_preferences`)은 즉시 지우지만, 검색 기록의 요청 본문에 든 취향 태그 사본은 남는다. 팀과 RB-10에 알린다(다시 검토할 것).
- Default: 위 동작대로 구현한다. PRD OQ-17(soft delete 탈퇴의 법·심사 위험)이 정해지거나 개인정보처리방침에 보관 기간이 생기면 다시 연다. 회원 행을 hard delete하기로 하면 CASCADE가 기록을 지우므로 이 작업은 고칠 것이 없다.
- Rejected:
  - 탈퇴 트랜잭션에서 기록 hard delete → 사용자가 탈퇴 직후 삭제하지 않는 쪽을 골랐다. 고르면 저장과 탈퇴를 회원 행 잠금으로 직렬화해야 한다.
  - 기록에 삭제 표시(`deleted_at`)를 따로 둠 → 읽는 곳이 없고, 표시 뒤 저장을 막는 동시성 처리만 늘어난다.
  - 회원 FK를 NO ACTION(리뷰와 같음) → 회원 행 hard delete가 정해지면 기록 테이블이 막는다.

## D-14 Mock 장소 id로 쌓인 기록
- Status: settled
- Decision: 이번 작업은 아무것도 지우지 않는다. local/dev에서 Mock 장소 id(1..36)로 쌓인 기록(검색 기록과 북마크)은 DB 장소 id와 맞지 않으므로, 장소 읽기를 DB로 바꾸는 S15P31A302-115에서 초기화한다. 그 전에는 실제 사용자가 없다. prod에는 Mock 엔진이 없어 Mock id가 쌓이지 않는다.
- Rejected: 기록 유지 → 다시 연 과거 카드가 다른 장소를 연다.

## D-15 Flyway 마이그레이션 번호
- Status: settled
- Decision: 번호를 미리 잡아 두지 않는다. MR을 merge하기 직전에 develop의 최신 번호 +1로 정한다. 지금 develop의 최신은 V7이다.

## D-16 검사할 경계
- Status: settled
- Decision: BE는 실제 PostgreSQL과 HTTP로, FE는 jsdom으로, 그리고 두 기기·두 계정으로 직접 확인한다.
  - **BE, 실제 PostgreSQL과 마이그레이션:**
    - 같은 turn 재전송(키 순서만 다른 본문 포함)은 성공, 다른 내용 충돌 때 저장된 스냅샷 유지.
    - 안쪽 null이 든 `previousConditions`·`conditions`와 모르는 응답 필드가 그대로 저장되고 돌아온다.
    - 첫 turn과 같은 thread 기준 turn 규칙, 일부만 쓰이지 않음. DB 제약이 고아 `baseId`와 틀린 종류를 막음.
    - 첫 turn 동시 생성, 같은 turn·다른 turn 동시 추가에서 500, 중복, 유실 없음. 재전송해도 처음 순서와 마지막 요청 시각 유지.
    - `at`이 거꾸로 가도 제목 고정과 마지막 turn `at` 기준 목록.
    - 20개 초과와 같은 시각이 cursor 페이지를 넘는 경우, 주인 격리, 두 계정이 같은 id로 각각 저장.
    - 탈퇴 뒤 기록이 남아 있고 모든 기록 API가 401(D-13).
  - **HTTP:**
    - 토큰 없음, 잘못된 토큰, 탈퇴한 사용자의 401(모든 API, 실제 계정 상태를 읽는 경로로). 탈퇴한 사용자는 없는 thread에도 404가 아니라 401.
    - 내 계정에 없는 thread 읽기의 404.
    - 400(소수·범위 밖 `at`, `\u0000`, 전각 공백만 있는 질문 포함, 로그에 본문 없음), 두 종류의 409.
    - 성공 응답 모양과 `Cache-Control: no-store`.
  - **FE jsdom:**
    - 목록: 첫 로딩, 빈 목록, 실패, 더 보기, 중복 제거, 다시 열 때 첫 페이지부터.
    - thread 열기 실패 때 지금 결과 유지와 다시 시도. 저장 실패 때 검색 유지.
    - 재전송: 같은 id, 한 thread의 turn은 만든 순서대로 하나씩, 정해진 횟수. 최종 401과 계정 전환 때 멈춤. 고아 turn 없음.
    - 세션 전환: 실제 store와 쿼리 캐시로 비우기 확인. 늦은 검색, 다음 페이지, thread 응답 버리기.
    - 토큰 갱신 때 화면 유지. 비회원 검색이 회원 기록으로 저장되지 않음.
    - 비회원: 기기 저장의 실패 격리, 저장소 예외, 옛 키만 있는 경우(D-8). place-search 테스트 계획의 FE 순수 로직 seam(Node 파서와 jsdom 경계)도 유지.
  - **통합 시나리오와 수동 확인(두 기기, 두 계정):**
    - 다른 기기에서 검색 호출 없이 스냅샷이 복원된다.
    - 아무 이전 turn에서나 후속 요청을 보내면 `previousConditions`가 그대로 간다(안쪽의 null과 빈 객체 포함).
    - 같은 thread에 이어서 쌓인다.
  - **구현자 재량:** 테스트 파일 이름, helper, 재전송 간격. 413은 edge 테스트가 맡는다(D-4).

## D-17 저장 구조
- Status: settled
- Decision: 저장 구조는 아래 규칙만 지키고, 테이블과 열 이름은 구현자가 정한다.
  - **키:** thread는 (회원, thread id), turn은 (회원, thread id, turn id)로 유일하다(D-3). 회원 FK는 `ON DELETE CASCADE`다(D-13).
  - **순서:** turn 순서는 서버가 처음 저장할 때 thread를 잠근 채 매기는 값으로 정하고, 다시 보내도 바뀌지 않는다(D-4, D-7).
  - **스냅샷:** 요청과 응답은 해석하지 않고 원문 JSON 그대로 `jsonb`에 저장한다(D-1, D-4).
  - **DB 제약:** `baseId`는 같은 회원, 같은 thread의 turn을 가리키는 복합 FK와 자기 자신이 아니라는 CHECK로, 종류는 CHECK로 DB가 막는다(D-2의 6). 저장소의 다른 테이블처럼 불변식을 DB에도 둔다.
  - **시각:** 요청 시각(`at`)과 서버가 저장한 시각을 둘 다 둔다. 시각 열은 다른 테이블처럼 `timestamptz`이고, API는 지금처럼 `at`을 정수 밀리초로 주고받는다.
  - **목록:** 목록은 turn 전체를 읽지 않고 thread의 제목과 마지막 요청 시각으로 정렬하고 페이징한다. 마지막 요청 시각은 서버 순서가 가장 늦은 turn의 `at`이고(가장 큰 `at`이 아니다), 같은 내용 재전송은 이 값과 저장된 turn을 바꾸지 않는다.
  - 제안 ERD(`search_threads`, `search_thread_turns`)는 `data/naver-places/erd/erd-search-thread-20261029-113928/fitdining-db.html`에 있다. 이 폴더는 gitignore 대상이라 저장소에는 없다.
- Rejected: 테이블과 열 이름까지 계약으로 묶기 → 규칙은 D-16의 BE 검사가 확인하고, 이름은 구현하며 바뀔 수 있다. 시각을 밀리초 `bigint`로 저장 → 다른 테이블의 시각 열과 달라지고 SQL에서 날짜로 읽히지 않는다. 서버 저장 시각 빼기 → 사용자가 넣기로 했다.

## D-18 최근 검색 지우기
- Status: settled
- Decision: 사용자가 최근 검색 시트에서 검색 기록을 지운다(2026-11-03 사용자 피드백, S15P31A302-141). 기록에 입력 문장, 취향 태그, 관심 지역이 들어 있는데 사용자가 지울 방법이 없었다.
  - **화면:** 줄마다 오른쪽 X를 누르면 확인 없이 그 줄을 지운다. 목록 위 "전체 삭제"는 확인 창("최근 검색을 모두 지울까요?" / "검색 기록은 복구할 수 없어요." / [취소]·[삭제])을 거친다. 회원은 서버가 지웠다고 응답한 뒤 줄을 빼고, 실패하면 줄을 남기고 "지우지 못했어요. 다시 시도해 주세요." 토스트를 띄운다. 지운 뒤 목록은 다시 받지 않는다. 비회원은 기기 기록에서 그 thread를 바로 뺀다(전체 삭제는 기기 키를 지운다).
  - **보는 중:** "보는 중"인 검색을 지워도 뒤 화면(결과, 요청 기록)은 그대로다. 대신 그 페이지 세션 동안 지운 thread에는 더 저장하지 않아, 그 화면에서 이어 보낸 후속 조건과 지역 검색은 최근 검색에 다시 생기지 않는다. 새 검색은 새 thread로 저장된다. 전체 삭제는 그 페이지 세션에서 저장하거나 연 thread 모두에 같은 규칙을 쓴다.
  - **재전송:** 지울 thread의 저장 대기분은 버리고, 보내는 중인 저장이 있으면 그 요청이 끝난 뒤 지운다. 다시 보내려고 기다리던 turn도 보내지 않는다. 늦게 도착한 저장이 지운 기록을 되살리지 않게 하려는 것이다. 지우지 못하면 그 thread는 계속 저장한다.
  - **API:** `DELETE /api/v1/me/search-threads/{threadId}`(thread 하나. 내 계정에 없어도 204)와 `DELETE /api/v1/me/search-threads`(내 기록 전체, 204)를 더한다. 판단 순서는 다른 기록 API와 같게 인증과 탈퇴 확인(401), 그다음 id 형식(400)이다. 행을 실제로 지우고, turn은 thread FK의 `ON DELETE CASCADE`로 함께 지워져 마이그레이션이 없다. 그 thread에 turn을 더하는 중이면 그 트랜잭션이 끝난 뒤 지운다(같은 행 잠금). 인증 모듈의 웹 설정이 DELETE의 `Origin`을 확인하므로 FE 출처가 아니면 403이다(브라우저가 붙인다).
- Rejected:
  - "보는 중"인 검색을 지우면 뒤 화면을 첫 화면으로 되돌리기 → 사용자가 뒤 화면을 유지하기로 했다.
  - 지운 뒤에도 그 화면의 이어 검색을 같은 thread로 저장 → 지운 기록의 일부가 되살아나고, 기준 turn이 지워져 후속 저장이 400·409로 멈춘다.
  - 줄 지우기에도 확인 창 → 줄 하나는 지울 대상이 눈앞에 있어 확인 없이 지운다. 전체 삭제는 한 번에 모두 사라져 확인한다.
  - 지운 thread에 삭제 표시(soft delete) → 사용자가 지운 개인정보가 서버에 남는다.
- Anchors: `be/src/main/java/kr/co/fitdining/api/searchthread/SearchThreadController.java#SearchThreadController.deleteThread` (new) · `fe/src/domains/place/ui/thread-storage.ts#removeThread` (new) · `fe/src/domains/place/ui/recent-search-sheet.tsx#RecentSearchSheet` (modify)

## 다시 검토할 것

결정은 있지만 사용자가 다시 확인하기로 한 항목이다. 바뀌면 grill을 다시 열어 해당 D-n을 고친다.

- **D-13 탈퇴 때 기록:** PRD OQ-17이 정해지거나 개인정보처리방침에 보관 기간이 생기면 다시 연다.
- **D-13 알릴 것:** 팀과 RB-10(`docs/infra/runbooks/RB-10.md`의 Postgres 개인정보 목록) 담당에게 넘긴다. 검색 기록에는 입력 문장, 취향 태그, 관심 지역(`mapBounds`)이 들어가고 탈퇴 뒤에도 남는다. 취향은 탈퇴 때 즉시 지우지만 검색 기록 안의 사본은 남는다. infra 문서는 직접 고치지 않는다.
- **D-14 초기화:** S15P31A302-115를 grill할 때 local/dev 검색 기록과 북마크 초기화를 그 작업 범위에 넣는다.
