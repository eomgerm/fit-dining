# 검색 기록(thread) 서버 저장

Status: approved
Decisions: [decisions.md](decisions.md) · Glossary and ADRs: none

인증 공통: 로그인 세션 쿠키(`fitdining_session`)로 사용자를 확인한다. 변경 요청은 `XSRF-TOKEN` 쿠키 값의 `X-XSRF-TOKEN` 헤더가 필요하며 비회원도 예외가 아니다. CSRF 누락·불일치는 인증·본문 검증 전에 403이고, CSRF를 통과한 보호 요청의 세션 없음·만료는 401이다.

## Problem

LLM 검색의 대화 기록(thread)은 지금 기기의 `localStorage`에만 있다. 회원이 다른 기기에서 로그인하면 최근 검색과 그때의 결과가 보이지 않고, 이어서 후속 조건을 보낼 수도 없다. 또 같은 기기를 쓰는 다음 사람에게 이전 사람의 기록이 남는다.

이번 작업은 회원의 thread를 서버에 저장해 어느 기기에서든 최근 검색, 그때의 결과, 이어 검색이 그대로 되게 한다. 비회원은 지금처럼 기기에 저장한다. Jira S15P31A302-116의 완료 기준은 "다른 기기에서 로그인해도 최근 검색과 이전 결과가 그대로 보이고, 이어서 후속 조건을 보낼 수 있음"이다.

이번 반복(Jira S15P31A302-141, 2026-11-03 사용자 피드백)은 사용자가 최근 검색에서 기록을 지우게 한다. 기록에는 입력 문장, 취향 태그, 관심 지역이 들어 있는데 지울 방법이 없었다(D-18). 같은 이유로 탈퇴하면 기록을 지우고(D-13), 회원과 비회원 모두 최근 20개만 남긴다(D-19).

## Assumptions

1. FE 세션은 `fe/src/domains/auth/api/auth-client.ts`의 메모리에만 있다. `getSession()`은 `userId`, `nickname`, `sessionExpiresAt`가 든 세션이나 `null`을 돌려주고, `subscribe`가 세션이 바뀔 때 알린다. 다른 탭의 로그아웃이나 인증 상실은 BroadcastChannel로 이 탭 세션을 `null`로 만든다. `restore()`가 쿠키로 세션을 되살린다.
2. `fe/src/domains/auth/api/authenticated.ts#authenticated`은 세션을 복원한 뒤 요청하며 인증 만료에 따른 변경 요청 재시도는 하지 않는다. 같은 계정인지는 app 계층에서 확인한다.
3. FE가 만드는 id는 `crypto.randomUUID()`의 소문자 UUID를 쓴다(`fe/src/domains/place/model/search-store.ts`). turn id는 검색 전에, thread id는 thread의 첫 응답을 받을 때 만든다. `at`은 첫 페이지를 받아 요청 기록에 더할 때의 `Date.now()`라 정수 밀리초다.
8. 장소 상세 화면(`fe/src/domains/place/ui/use-stored-card.ts`)은 검색 화면이 떠 있지 않아도 메모리의 최신 카드와 쿼리 캐시를 직접 읽는다.
4. 배포 환경의 모든 `/api` 요청은 edge(Caddy)를 거치고, edge가 본문 2MB 초과를 413으로 막는다(`infra/edge/conf/Caddyfile`).
5. 검색 첫 페이지는 장소 20개 이하이고, turn 하나는 2MB보다 훨씬 작다(크게 잡아 약 0.5MB).
6. 회원 탈퇴는 `auth_users.deleted_at`을 채우는 soft delete이고, 지금 회원 행을 실제로 지우는 코드는 없다.
7. 검색 API(`POST /api/v1/places/search`)는 이 작업에서 바뀌지 않고, 로그인 세션으로 회원을 선택 식별하고 비회원도 허용한다. POST에는 CSRF 헤더가 필요하다.

## Usage

**회원이 검색한다.** FE가 첫 페이지 응답을 받으면 그 turn을 서버에 추가한다.

```
POST /api/v1/places/search            ← 로그인 세션 선택, CSRF 헤더 필수
PUT  /api/v1/me/search-threads/thread-3f2a…/turns/entry-91c0…   Cookie: fitdining_session=…; X-XSRF-TOKEN: …
     {"id":"entry-91c0…","kind":"new","at":1761700000000,
      "request":{"query":"조용한 카페", …},"response":{"items":[…],"totalCount":32,"conditions":{…}}}
→ 204
```

**회원이 다른 기기에서 최근 검색을 연다.** 시트가 목록을 받고, 줄을 누르면 그 줄에 로딩이 보이다가 thread 하나를 받아 검색 호출 없이 그때 결과로 바뀐다. 이어서 후속 조건을 보내면 기준 turn의 `conditions`가 `previousConditions`로 가고, 새 turn이 같은 thread에 추가된다.

```
GET /api/v1/me/search-threads                 → {"items":[{"id":"thread-3f2a…","title":"조용한 카페","lastAt":1761700000000}], "nextCursor":"…"}
GET /api/v1/me/search-threads/thread-3f2a…   → {"id":"thread-3f2a…","turns":[…]}
```

**비회원이 검색하고 로그인한다.** 비회원의 검색은 기록 API를 부르지 않고 기기에만 저장된다. 로그인하면 화면은 첫 화면에서 시작하고 최근 검색에는 회원의 서버 기록만 보인다. 로그아웃하면 화면이 비워지고 기기의 비회원 기록이 다시 보인다.

## Acceptance criteria

절대 일어나면 안 되는 것(D-2):

- [x] AC-1: 어떤 요청이든 thread의 주인은 로그인 세션의 사용자다. 다른 계정의 thread와 turn은 같은 id를 알아도 읽거나 바꿀 수 없다. 남의 thread id로 읽으면 404이고, 같은 id로 추가하면 내 계정의 별개 thread가 된다 (D-2, D-3)
- [x] AC-2: 세션 쿠키가 남아 있어도 탈퇴한 사용자는 모든 기록 API에서 401이다. 이 확인은 본문 파싱을 포함한 다른 판단보다 먼저라서, 탈퇴한 사용자는 없는 thread나 깨진 본문에도 401을 받는다. 저장은 같은 트랜잭션에서 회원 행을 잠그고 다시 확인하므로 탈퇴와 같은 순간 들어온 저장도 남지 않는다(AC-25) (D-2, D-3, D-4, D-13)
- [x] AC-3: 세션 키가 바뀌면([세션 규칙](#세션-규칙)) 이전 세션의 목록, 열린 thread, 과거 결과, 선택, 최신 카드, 쿼리 캐시 전체, 재전송 대기분이 어느 화면에도 남거나 새 세션으로 저장되지 않는다. 검색 화면이 떠 있지 않을 때 바뀌어도 장소 상세 화면에 이전 카드가 보이지 않는다. 바뀌기 전에 시작한 검색, 다음 페이지, thread 읽기, 저장의 응답이 늦게 와도 새 상태를 바꾸지 않고 저장되지 않는다 (D-2, D-5, D-6)
- [x] AC-4: 같은 turn을 몇 번 보내든, 여러 기기에서 동시에 보내든 turn은 한 번만 저장되고, 이미 저장된 turn의 내용, 순서, thread의 마지막 요청 시각은 바뀌지 않는다. 동시 요청도 500이 되지 않는다 (D-1, D-2, D-4, D-17)
- [x] AC-5: 성공한 첫 페이지 응답만 turn이 된다. 다음 페이지, 첫 화면 "근처 맛집" 카드, 실패하거나 버린 검색은 저장되지 않는다 (D-1, D-2)
- [x] AC-6: 저장된 turn의 `baseId`는 항상 같은 계정, 같은 thread에 먼저 저장된 자기 아닌 turn을 가리킨다. 같은 thread에 그 turn이 있는지와 자기 자신이 아닌지는 API를 거치지 않은 쓰기도 DB 제약이 막고, 먼저 저장됐는지는 API가 보장한다 (D-2, D-4, D-17)
- [x] AC-7: 기록 저장이 실패해도 성공한 검색은 그대로 보이고, 저장 실패를 화면에 알리지 않는다(토스트나 오류 문구 없음) (D-2, D-5)
- [x] AC-8: 다시 연 thread를 보는 데 검색 API를 새로 부르지 않는다. 회원 thread는 고를 때마다 기록 API로 받은 서버 것을 그리고, 아직 저장되지 않았거나 끝내 실패한 turn은 보이지 않는다. 이번 페이지 세션에 받지 않은 turn은 저장된 첫 페이지만 보이고 다음 페이지를 부르지 않는다. 그 turn에서 후속 요청을 보내면 저장된 `conditions`가 안쪽의 `null`과 빈 객체까지 그대로 `previousConditions`로 간다 (D-1, D-2, D-9, D-10, D-11)
- [x] AC-9: thread 안의 turn 개수에는 제한이 없다. thread는 회원과 비회원 모두 최근 20개까지이고(AC-31), 사용자의 지우기(AC-27~29), 상한, 탈퇴(AC-25) 말고는 저장된 기록이 저절로 지워지지 않는다 (D-2, D-12, D-19)
- [x] AC-10: 같은 데이터로 회원 목록을 몇 번 받든 순서가 같다. 마지막 요청 시각이 같은 thread는 thread id 역순이다. 비회원 목록 순서는 지금 동작 그대로다 (D-2, D-7)
- [x] AC-11: 기록 저장 경로의 앱 로그(DB 예외 메시지 포함)에 검색 본문과 취향이 남지 않는다 (D-2, D-4)

API 동작:

- [x] AC-12: turn 추가는 [turn 추가 규칙](#turn-추가-규칙)의 판단 순서를 따른다. thread의 첫 turn이면 thread를 만들고, 같은 id를 같은 내용으로 다시 보내면 204, 다른 내용이면 409 `conflict`이고 아무것도 바꾸지 않는다. thread 규칙 위반은 400 `invalid`, 기준 turn이 아직 없으면 409 `base-missing`이다 (D-3, D-4)
- [x] AC-13: 서버가 저장하는 turn은 모두 FE `parseThreads`가 받아들이는 모양이다. [형식 규칙](#형식-규칙)을 어긴 본문은 400 `invalid`이고 저장되지 않는다 (D-4)
- [x] AC-14: 저장한 요청과 응답은 JSON 값으로 같게 돌아온다. 안쪽 `null`, 빈 객체, 서버가 모르는 필드, 숫자의 10진 값(예: `0.1`, `1e21`, 큰 정수)이 그대로다 (D-1, D-4, D-17)
- [x] AC-15: 목록은 20개씩, 마지막으로 저장된 turn의 `at` 최신순(같으면 thread id 역순)이다. `title`은 첫 turn의 질문으로 고정이고, 나중에 저장된 turn의 `at`이 더 이르면 `lastAt`도 그 값이 된다. `nextCursor`는 다음 페이지가 실제로 있을 때만 있다. 형식이 틀린 cursor는 400이다 (D-3, D-7, D-17)
- [x] AC-16: thread 하나의 turn은 서버에 처음 저장된 순서다. `baseId`가 없는 turn에는 `baseId` 키가 없고(`null`이 아니다), 응답 전체를 FE `parseThreads`에 넣으면 thread가 그대로 받아들여진다. 내 계정에 없는 thread는 404, 형식이 틀린 thread id는 400이다 (D-3, D-4, D-7)
- [x] AC-17: 기록 API 핸들러가 만드는 모든 응답(오류 포함)에 `Cache-Control: no-store`가 붙는다. edge의 413과 Spring이 핸들러를 고르기 전에 끝내는 응답은 범위 밖이다 (D-3)

FE 동작:

- [x] AC-18: 회원의 turn 저장은 검색을 시작할 때와 같은 세션 키 안에서만 일어난다. 요청 직전 확인한 세션 키가 검색을 시작할 때와 다르면 보내지 않는다. 한 thread의 turn은 만든 순서대로 하나씩 보내고, 앞 turn이 저장되기 전에는 뒤 turn을 보내지 않는다. 네트워크 오류와 5xx에만 같은 id로 정해진 횟수까지 다시 보낸다. 409 `conflict`는 저장된 것으로 보고 다음 turn을 보낸다. 401을 뺀 나머지 4xx(400, 413, 409 `base-missing` 등)나 횟수 소진은 끝내 실패한 것으로 보고, 그 페이지 세션이 끝날 때까지 그 thread의 뒤 turn을 보내지 않는다(검색과 이어 검색은 그대로 된다). 세션 키가 바뀌거나 페이지가 끝나면 멈추고 대기분을 버리며, 대기분을 기기 저장소에 쓰지 않아 새로고침 뒤에 남는 것이 없다 (D-5, D-6)
- [x] AC-19: 회원의 최근 검색 시트는 기존 화면에 서버 읽기 상태를 더한다. 첫 로딩, 빈 목록("아직 검색한 요청이 없어요. 원하는 분위기나 목적을 말해 보세요."), 실패(빈 목록과 구분, 다시 시도), 더 보기(실패하면 받은 목록을 유지하고 다시 시도)를 보인다. 목록에는 서버에 저장된 thread만 보이고, 더 보기에서 같은 id는 먼저 받은 것만 보인다. 시트를 다시 열면 첫 페이지부터 다시 받고, 열린 동안 저장이 끝나도 다시 받지 않는다. 지금 thread에는 "보는 중"이 붙는다 (D-9, D-10)
- [x] AC-20: 회원이 시트에서 thread를 고르면 시트를 연 채 그 줄에 로딩을 보이고, 그동안 지금 결과를 유지한다. 성공하면 시트를 닫고 그 thread로 바꾼다. 실패하면 지금 결과를 유지하고 그 줄에서 다시 시도할 수 있다. 받는 동안 다른 줄을 고르면 마지막에 고른 것만 반영하고, 시트를 닫으면 받던 것을 버린다. "보는 중"인 thread를 고르면 시트만 닫는다 (D-9, D-10)
- [x] AC-21: 같은 사용자, 같은 세션의 복원은 화면 상태와 캐시를 비우지 않는다 (D-6)
- [x] AC-22: 비회원의 검색은 기록 API를 부르지 않고 기기에만 새 키로 저장된다. 기존 키 `fit-dining:search-threads`는 읽지도, 복원하지도, 올리지도 않고, 페이지에서 저장소 모듈을 처음 쓸 때 회원과 비회원 모두 지운다. 저장소를 못 쓰거나 값이 깨졌거나 thread 형식이 틀려도 화면과 검색은 동작하고 틀린 thread만 버려진다. 저장소가 가득 차면 새 기록은 저장되지 않고 옛 기록은 남는다 (D-8, D-12)
- [x] AC-23: 회원의 thread는 기기에 쓰지 않는다. 세션 키가 "모름"일 때 시작한 검색은 기기에도 서버에도 저장하지 않는다. 로그인할 때 비회원 기록을 회원 계정으로 올리지 않고, 기기의 비회원 기록도 지우지 않는다. 비회원일 때 시작한 검색의 응답이 로그인 뒤에 오면 화면에도 기록에도 남지 않는다 (D-6, D-8)
- [x] AC-24: 비회원과 회원 모두 승인된 place-search 화면 계약(place-search spec 본문 27, 43, 46, 53, 57번 항목)은 이 spec의 AC가 바꾼 점 말고는 그대로다. 화면 상태는 메모리에만 있고, 새로고침하면 첫 화면에서 시작한다 (D-9, D-10)

탈퇴와 통합:

- [x] AC-25: 탈퇴하면 탈퇴 트랜잭션(`UserService.withdraw`) 안에서 그 회원의 thread와 turn이 모두 지워지고, 다른 회원의 기록은 남는다. 탈퇴와 저장이 동시에 와도 저장은 204나 401로 끝나고 탈퇴한 회원의 기록은 남지 않는다. 회원 행이 실제로 지워져도 그 회원의 기록이 함께 지워진다 (D-13, D-17)
- [x] AC-26: 두 기기, 두 계정으로 확인한다. 기기 A에서 회원이 검색과 후속 조건을 보낸 뒤 기기 B에서 같은 계정으로 로그인하면, 최근 검색에 그 thread가 보이고 검색 호출 없이 그때 결과가 복원된다. 아무 이전 turn에서나 후속 조건을 보내면 같은 thread에 이어서 쌓인다. 기기 A에서 새로고침하거나 다른 thread를 거쳐 그 thread를 다시 열면 기기 B에서 쌓은 turn까지 보이고, 최근 검색 목록의 마지막 요청 시각도 바뀌어 있다. 다른 계정에는 보이지 않는다 (D-1, D-3, D-9, D-16)

지우기(S15P31A302-141):

- [x] AC-27: `DELETE /api/v1/me/search-threads/{threadId}`는 내 계정의 그 thread와 모든 turn을 실제로 지우고 204다. 내 계정에 없는 thread여도 204이고, 다른 계정의 같은 id thread는 그대로다. 형식이 틀린 id는 400이고, 인증 없음과 탈퇴는 401이며 이 확인이 먼저다. `DELETE /api/v1/me/search-threads`는 내 기록만 모두 지우고 204다. 두 API 모두 `Cache-Control: no-store`이고, FE 출처가 아닌 `Origin`이면 403이다 (D-18)
- [x] AC-28: 최근 검색 시트의 줄마다 오른쪽에 X(접근 이름 "<검색어> 검색 기록 지우기")가 있고, 누르면 확인 없이 그 줄을 지운다. 회원은 서버가 응답한 뒤 줄을 빼고, 실패하면 줄을 남기고 "지우지 못했어요. 다시 시도해 주세요." 토스트를 띄운다. 비회원은 기기 기록에서 바로 뺀다. 지운 뒤 목록을 다시 받지 않는다 (D-18)
- [x] AC-29: 목록 위 "전체 삭제"는 확인 창(제목 "최근 검색을 모두 지울까요?", 설명 "검색 기록은 복구할 수 없어요.", [취소]·[삭제])을 띄운다. [취소]는 아무 요청 없이 닫고, [삭제]는 내 기록을 모두 지운 뒤 빈 안내를 보인다. 실패하면 목록을 남기고 AC-28과 같은 토스트를 띄운다 (D-18)
- [x] AC-30: "보는 중"인 검색을 지워도 뒤 화면(결과, 요청 기록)은 그대로다. 그 페이지 세션 동안 지운 thread의 저장 대기분, 재전송, 그 화면에서 이어 보낸 검색은 저장하지 않고, 보내는 중인 저장이 있으면 끝난 뒤 지운다. 지우지 못하면 그 thread는 계속 저장한다. 전체 삭제는 그 페이지 세션에서 저장하거나 연 모든 thread에 같은 규칙이고, 새 검색은 새 thread로 저장된다 (D-18)
- [x] AC-31: 회원의 thread는 최근 20개까지다. turn 추가로 thread를 새로 만들어 20개를 넘으면, 방금 만든 thread를 빼고 마지막 요청 시각이 가장 오래된(같으면 thread id가 작은) thread부터 turn까지 지운다. 방금 만든 thread는 `at`이 가장 일러도 남는다. 이미 있는 thread에 이어 쓰면 지우지 않는다. 새 thread를 동시에 여럿 만들어도 500 없이 20개가 남고, 다른 회원의 기록은 그대로다. 비회원 기기 기록도 저장할 때마다 지금 thread와 최근 19개만 남는다 (D-19)

## Interfaces

### 기록 API

모든 경로는 로그인 세션 쿠키가 필요하다. 핸들러가 만드는 모든 응답(오류 포함)에 `Cache-Control: no-store`가 붙는다. 401은 리뷰 API와 같은 모양의 ProblemDetail이고, 세션 없음·만료는 401이다. 변경 요청에는 CSRF 헤더가 필요하며 CSRF 누락·불일치는 403이다.

| 메서드와 경로 | 성공 | 오류 |
|---|---|---|
| `GET /api/v1/me/search-threads?cursor=<opaque>` | 200 `ThreadPage` | 400 `invalid`(cursor), 401 |
| `GET /api/v1/me/search-threads/{threadId}` | 200 `Thread` | 400 `invalid`(id 형식), 401, 404 `not-found` |
| `PUT /api/v1/me/search-threads/{threadId}/turns/{turnId}` | 204, 본문 없음 | 400 `invalid`, 401, 409 `base-missing`, 409 `conflict`, 413(edge) |
| `DELETE /api/v1/me/search-threads/{threadId}` | 204, 본문 없음(내 계정에 없어도) | 400 `invalid`(id 형식), 401, 403(`Origin`) |
| `DELETE /api/v1/me/search-threads` | 204, 본문 없음 | 401, 403(`Origin`) |

```ts
type ThreadPage = {
  items: { id: string; title: string; lastAt: number }[]; // 최대 20개, D-7 순서
  nextCursor?: string; // 다음 페이지가 실제로 있을 때만. 내용은 해석하지 않는 값
};

type Thread = {
  id: string;
  turns: Turn[]; // 서버에 처음 저장된 순서
};

// PUT 본문이자 Thread.turns의 원소. 지금 FE의 ThreadTurn과 같은 모양이고 최상위 필드는 이 여섯 개뿐이다
type Turn = {
  id: string; // 경로의 turnId와 같다
  kind: "new" | "followUp" | "region";
  baseId?: string; // followUp, region에는 꼭 있고 new에는 없다. 없을 때 응답에서도 키를 뺀다(null 아님)
  at: number; // 첫 페이지를 받아 기록한 기기 시각, 정수 밀리초
  request: object; // 첫 페이지 검색 요청 본문, 원문 그대로
  response: object; // 첫 페이지 검색 응답, 원문 그대로
};
```

오류 본문은 ProblemDetail이고 `type`으로 구분한다.

| type | 상태 | 경우 |
|---|---|---|
| `urn:fitdining:search-thread:invalid` | 400 | 본문 파싱 실패, 형식 규칙, thread 규칙, cursor·id 형식 위반 |
| `urn:fitdining:search-thread:base-missing` | 409 | followUp, region의 `baseId`가 같은 thread에 아직 저장되지 않음 |
| `urn:fitdining:search-thread:conflict` | 409 | 같은 turn id가 다른 내용으로 이미 저장됨 |
| `urn:fitdining:search-thread:not-found` | 404 | 내 계정에 그 thread가 없음 |

### 형식 규칙

서버가 받는 turn은 아래를 모두 지키고, 하나라도 어기면 400 `invalid`다(D-4). 이 규칙은 FE `parseThreads`(`isTurn`)가 받아들이는 모양을 포함한다.

- `threadId`는 `thread-` 뒤에, `turnId`와 본문 `id`는 `entry-` 뒤에 소문자 UUID(버전 무관, 8-4-4-4-12 소문자 16진수)가 온다. 본문 `id`는 경로의 `turnId`와 같다(D-3).
- 최상위 필드는 `id`, `kind`, `baseId`, `at`, `request`, `response`뿐이다.
- `kind`는 `new`, `followUp`, `region` 중 하나다. `baseId`는 없거나 turn id 형식의 문자열이다. `null`은 없는 것으로 보지 않는다.
- `at`은 값이 정수이고 0 이상 8.64e15(JS `Date` 상한) 이하다.
- `request`는 객체이고 `request.query`는 문자열이며, JS `String.prototype.trim`과 같은 공백 목록 기준으로 비어 있지 않고, trim 전 길이가 200자 이하다. `request`에 `cursor` 키가 없다(값이 `null`이어도 안 된다).
- `response`는 객체이고 `response.items`는 배열, `response.totalCount`는 값이 0 이상의 정수, `response.conditions`는 객체다. `response`에 `nextCursor` 키가 없다(값이 `null`이어도 안 된다).
- 본문 어느 문자열(객체 키 포함)에도 `\u0000`과 짝이 없는 서로게이트가 없다.
- 이 밖의 `request`, `response` 안 필드와 `items` 원소, `conditions` 내용은 해석하지 않고 그대로 저장한다. 모르는 필드가 있어도 받는다.

### turn 추가 규칙

판단 순서(D-4):

1. 인증과 탈퇴 확인. 아니면 401. 본문 파싱보다 먼저다.
2. 형식 규칙. 아니면 400 `invalid`.
3. 같은 계정, 같은 thread에 같은 turn id가 이미 있으면 본문 전체를 PostgreSQL `jsonb` 값으로 비교한다. 같으면 204이고 아무것도 바꾸지 않는다. 다르면 409 `conflict`이고 아무것도 바꾸지 않는다.
4. thread 규칙. 아니면 400 `invalid`.
   - thread가 없으면 이 turn은 `baseId` 없는 `new`여야 한다.
   - followUp과 region은 `baseId`가 있고, `baseId`는 자기 id가 아니다.
   - `new`에는 `baseId`가 없다. thread가 있으면 `new`도 허용한다("이 조건으로 다시 검색").
5. followUp, region의 `baseId`가 같은 계정, 같은 thread에 아직 없으면 409 `base-missing`.
6. 저장하고 204. thread를 새로 만들었으면 상한(D-19)을 넘는 오래된 thread를 지운다.

- **원자성:** 2 다음, 3~6은 한 트랜잭션에서 회원 행을 잠가 탈퇴 여부를 다시 확인한 뒤(탈퇴했으면 401, D-13) thread를 잠그고 일어난다. thread 생성, turn 추가, 순서 값, 제목과 마지막 요청 시각 갱신이 일부만 쓰이지 않는다. 첫 turn의 동시 생성과 같은 turn의 동시 재전송도 500 없이 이 규칙대로 끝난다(D-4).
- **제목과 마지막 요청 시각:** 제목은 thread를 만든 turn의 `request.query`로 고정한다. 마지막 요청 시각은 서버 순서가 가장 늦은 turn의 `at`이다(가장 큰 `at`이 아니다)(D-7, D-17).

### 저장 규칙

테이블과 열 이름은 구현자가 정한다. 제안 ERD는 `data/naver-places/erd/erd-search-thread-20261029-113928/fitdining-db.html`(gitignore 대상이라 worktree에는 없다)에 있다. 지켜야 할 것(D-17):

- thread는 (회원, thread id), turn은 (회원, thread id, turn id)로 유일하다.
- 회원 FK는 `auth_users(id)`를 가리키고 `ON DELETE CASCADE`다.
- turn 순서는 서버가 처음 저장할 때 thread를 잠근 채 매기는 값이고, 다시 보내도 바뀌지 않는다.
- `baseId`는 같은 회원, 같은 thread의 turn을 가리키는 복합 FK이고 자기 자신이 아니라는 CHECK가 있다. 종류는 CHECK로 세 값만 허용한다.
- 요청과 응답은 원문 JSON 그대로 `jsonb`에 둔다. 숫자는 JSON 트리를 읽을 때부터 10진 값(BigDecimal)으로 다루고 double로 바꾸는 경로를 거치지 않는다.
- 요청 시각과 서버가 저장한 시각을 둘 다 `timestamptz`로 둔다. API의 `at`(정수 밀리초)과 요청 시각은 값을 잃지 않고 오간다.
- thread에 제목과 마지막 요청 시각을 두어, 목록은 turn을 읽지 않고 (회원, 마지막 요청 시각 내림차순, thread id 내림차순)으로 정렬하고 페이징한다.
- 탈퇴 표시는 `auth_users.deleted_at`이 맡고, 기록에는 따로 삭제 표시가 없다. 탈퇴하면 기록을 지운다(D-13).

### 세션 규칙

FE의 저장 위치와 화면 비우기는 세션 키로 정한다(D-6).

- 세션 키는 회원이면 `(userId, sessionId)`, 비회원이면 "세션 없음", 아직 확인되지 않았으면 "모름"이다.
- 세션이 없으면 복원을 한 번 시도한다. 서버가 401로 세션 없음을 확인해 줬을 때만 "세션 없음"이 되고, 그 뒤로는 `getSession()`이 세션을 돌려줄 때까지 다시 복원하지 않는다(`subscribe` 알림마다 복원하지 않는다). 복원이 시간 초과나 네트워크 오류로 끝나면 "모름"이고 다음 저장 때 다시 시도한다(`fe/src/app/places/[id]/with-optional-session.ts`는 공개 리뷰 목록 요청을 그대로 실행하는 함수다. 검색 기록의 세션 확인·시간 초과 판정은 `fe/src/app/search-thread-auth.ts`가 맡는다).
- 저장 위치는 검색을 시작할 때의 세션 키로 정한다. 회원이면 서버, 세션 없음이면 기기, 모름이면 저장하지 않는다.
- 세션 키가 바뀌는 것은 확인된 값(회원 또는 세션 없음)에서 다른 확인된 값으로 바뀔 때다: 로그아웃, 다른 계정 로그인, 같은 사용자의 새 세션, 비회원의 로그인, 인증의 최종 상실. "모름"이 확인된 값이 되는 것과 같은 세션의 복원은 해당하지 않는다. 그래서 확인 중에 시작한 검색은 화면에 남고 저장만 되지 않는다. `subscribe` 알림을 받을 때 `getSession()` 값을 비교해 판단한다.
- 인증의 최종 상실: 기록 API가 401을 주면(탈퇴·세션 만료 포함) 이 탭의 세션을 지운다(`clearSession`). 서버 로그아웃이나 다른 탭 알림은 하지 않는다.
- 바뀌면 그 자리에서 app 계층이 쿼리 캐시 전체(다른 도메인 캐시와 검색 후보 포함), 검색 화면 상태(최신 카드 포함), 재전송 대기분을 비운다. 모든 페이지를 감싸는 app 계층(`fe/src/app/providers.tsx`)에서 하므로 검색 화면이 떠 있지 않아도 비운다. 검색 화면이 뜰 때 세션 키를 다시 비교하는 것은 보조다. 현재 위치와 기기의 비회원 기록은 남긴다. 그래서 로그인하면 첫 화면에서 시작하고, 로그아웃하면 비회원 기록이 다시 보인다.

## Constraints

- 검색 API(`POST /api/v1/places/search`)와 그 요청·응답 계약은 바꾸지 않는다. 기록은 FE가 첫 페이지 응답을 받은 뒤 기록 API로 따로 저장한다 (D-1, D-11)
- 스냅샷(`request`, `response`)은 원문 JSON 트리로 받고, 저장하고, 돌려준다. 전역 Jackson 설정(`default-property-inclusion: non_null`, `fail-on-unknown-properties: true`)이 스냅샷 안에는 적용되지 않는다 (D-4)
- 기록 API의 인증은 공통 Security 필터가 처리하고 컨트롤러가 `@AuthenticationPrincipal AuthUseCases.Identity`를 받으며, 사용자는 로그인 세션에서만 얻는다. 경로에 사용자 id를 두지 않는다. 판단 순서 때문에 본문은 인증 뒤에 파싱하므로, 리뷰와 달리 `@RequestBody` DTO 바인딩을 쓰지 않는다. 리뷰의 예외 처리기는 리뷰 컨트롤러에만 걸리므로 기록 API 전용 예외 처리기를 둔다 (D-3, D-4)
- FE에서 화면은 `fe/src/domains/place/ui/thread-storage.ts`로만 thread를 읽고 쓴다. 이 모듈이 비회원 기기 저장과 회원 서버 저장 중 하나를 고르고, 세션별 캐시와 재전송을 맡는다. 이 spec이 place-search spec 53의 "이 모듈만 바꾼다"를 대체하며, place-search 문서는 고치지 않는다 (D-9)
- thread 모양, `appendTurn`, 형식 검사, 정렬, 시각 문구는 `fe/src/domains/place/model/search-threads.ts`의 순수 함수로 남는다. 목록용 요약 타입과 순수 helper는 더할 수 있다. `model`에는 인증, 네트워크, 재전송을 두지 않는다 (D-9)
- place 도메인은 auth 도메인을 import하지 않는다. 인증(로그인 세션, 같은 계정 확인, 세션 변경, 인증 상실)은 app 계층에서 이어 준다(`fe/src/app/places/[id]/place-detail-with-reviews.tsx`가 선례) (D-6, D-9)
- FE는 목록을 그리려고 가짜 turn을 만들거나 모든 thread를 미리 받지 않고, 서버 thread를 기기 시각으로 다시 정렬하지 않는다 (D-9)
- 새 화면은 만들지 않는다. 로딩과 실패 상태는 기존 최근 검색 시트 안에 두고, 모양은 와이어프레임의 예외 상태와 기존 컴포넌트를 따른다 (D-9)
- Flyway 마이그레이션 번호는 미리 잡지 않고 MR merge 직전에 develop의 최신 번호 +1로 정한다(지금 develop 최신은 V7) (D-15)
- `infra/`, `docs/infra/` 파일은 고치지 않는다. 바꿀 내용은 정리해 담당에게 넘긴다 (D-13)

## Existing code

| Locator | Action | Obligation | Decision |
|---|---|---|---|
| `be/src/main/java/kr/co/fitdining/api/auth/infrastructure/SecurityConfiguration.java#securityFilterChain` | reuse | 기록 API가 로그인 세션에서 사용자를 얻는다 | D-3 |
| `be/src/main/java/kr/co/fitdining/api/auth/repository/AuthUserRepository.java#existsByIdAndDeletedAtIsNull` | reuse | 모든 기록 API가 다른 판단보다 먼저 탈퇴하지 않은 회원인지 확인한다 | D-2, D-3 |
| `be/src/main/java/kr/co/fitdining/api/auth/infrastructure/SecurityConfiguration.java#securityFilterChain` | modify | 기록 API의 모든 응답에도 `Cache-Control: no-store`가 붙게 한다(다른 방법으로 붙여도 된다) | D-3 |
| `fe/src/domains/auth/api/auth-client.ts#subscribe` | reuse | `getSession()`의 세션 키 변화로 세션 전환을 알아챈다 | D-6 |
| `fe/src/domains/auth/api/authenticated.ts#authenticated` | reuse | 회원 기록 요청 전 로그인 세션을 복원한다. 같은 계정 확인은 하지 않으므로 app 계층이 시작할 때의 세션 키와 비교한다 | D-5, D-9 |
| `fe/src/app/home/home-screen.tsx#HomeScreen` | modify | 검색 화면에 인증(로그인 세션, 같은 계정 확인, 인증 상실)을 이어 준다 | D-6 |
| `fe/src/app/providers.tsx#Providers` | modify | 세션 키가 바뀌면 어느 페이지에서든 쿼리 캐시 전체와 검색 화면 상태, 재전송 대기분을 바로 비운다 | D-6 |
| `fe/src/domains/place/model/search-store.ts#createSearchStore` | modify | 검색 화면 상태를 처음으로 되돌리는 기능을 더한다(현재 위치는 남긴다) | D-6 |
| `fe/src/domains/place/ui/thread-storage.ts#saveThread` | modify | 저장소 선택(비회원 기기, 회원 서버), turn 추가, 세션별 캐시, 재전송을 이 모듈 안으로 옮긴다. 비회원 기기 저장은 새 키를 쓰고 옛 키를 지운다 | D-5, D-8, D-9 |
| `fe/src/domains/place/model/search-threads.ts#appendTurn` | reuse | turn 추가 규칙(`nextCursor` 제거) | D-9 |
| `fe/src/domains/place/model/search-threads.ts#parseThreads` | reuse | 비회원 기기 기록과 서버 thread의 형식 검사 | D-4, D-9 |
| `fe/src/domains/place/ui/recent-search-sheet.tsx#RecentSearchSheet` | modify | 로딩, 빈 목록, 실패, 더 보기, 줄별 열기 로딩과 다시 시도. 줄별 지우기와 전체 삭제 | D-9, D-18 |
| `fe/src/domains/place/ui/thread-storage.ts#removeThread` | new | 지운 thread의 대기분과 재전송을 멈추고 지운 뒤에는 저장하지 않는다. 회원은 서버, 비회원은 기기에서 지운다 | D-18 |
| `be/src/main/java/kr/co/fitdining/api/searchthread/SearchThreadController.java#SearchThreadController.deleteThread` | new | thread 하나와 내 기록 전체를 지우는 API | D-18 |
| `be/src/main/java/kr/co/fitdining/api/user/UserService.java#UserService.withdraw` | modify | 회원 행을 잠근 탈퇴 트랜잭션 안에서 그 회원의 검색 기록을 지운다. 그 밖의 탈퇴 처리는 그대로 | D-13 |
| `be/src/main/java/kr/co/fitdining/api/searchthread/SearchThreadService.java#SearchThreadService.addTurn` | modify | 회원 행을 잠가 탈퇴 여부를 다시 확인하고, thread를 새로 만들면 상한을 넘는 오래된 thread를 지운다 | D-13, D-19 |
| `fe/src/domains/place/ui/search-screen.tsx#SearchScreen` | modify | thread 저장 호출과 thread 열기의 비동기, 실패 처리, 세션 전환 때 비우기와 늦은 응답 버리기 | D-6, D-9, D-10 |

## Seams & test plan

- **BE 기록 저장과 HTTP** (example), AC-1, AC-2, AC-4, AC-6, AC-9, AC-10, AC-11, AC-12, AC-13, AC-14, AC-15, AC-16, AC-17, AC-25, AC-31: 실제 PostgreSQL(Testcontainers)과 마이그레이션, `RANDOM_PORT` HTTP로 확인한다.
  - 저장: 재전송(키 순서만 다른 본문 포함), 다른 내용 충돌 때 저장본 유지, 안쪽 `null`·빈 객체·모르는 필드·숫자 10진 값(`0.1`, `1e21`, 큰 정수) 보존, turn이 많은 thread도 제한 없이 저장.
  - 규칙: 판단 순서의 각 단계와 그 우선순위(같은 id 다른 내용이면서 thread 규칙 위반이면 409 `conflict`, 없는 thread의 followUp, `baseId` 없는 followUp, `baseId` 있는 `new`, 자기 자신을 가리키는 `baseId`), 일부만 쓰이지 않음, DB 제약이 고아 `baseId`와 틀린 종류를 막음.
  - 동시성: 첫 turn 동시 생성과 같은·다른 turn 동시 추가에서 500·중복·유실 없음, 순서와 마지막 요청 시각 유지.
  - 목록: `at`이 거꾸로 가는 경우의 제목과 목록, 20개 초과, 딱 20개일 때 `nextCursor` 없음, 같은 시각이 cursor 페이지를 넘는 경우, 두 계정이 같은 id로 각각 저장, 형식이 틀린 cursor 400.
  - 인증: 401(세션 없음, 무효 세션, 실제 계정 상태를 읽는 탈퇴 사용자, 탈퇴 사용자의 없는 thread·깨진 본문·틀린 cursor·틀린 GET id), 404, GET id 형식 400.
  - 숫자 보존은 텍스트가 아니라 10진 값으로 비교한다(`jsonb`는 `1e21`을 다른 표기로 돌려준다). GET 응답의 `new` turn에 `baseId` 키가 없음을 확인한다.
  - DB 제약: API를 거치지 않은 쓰기로 다른 thread를 가리키는 `baseId`, 자기 자신을 가리키는 `baseId`, 틀린 종류가 거부됨.
  - 형식: 400(id 형식, 경로와 본문 id 불일치, 최상위 모르는 필드, `kind`, `null` `baseId`, 소수·음수·범위 밖 `at`, 빈 질문과 NBSP·전각 공백만 있는 질문, 201자 질문, 음수·소수 `totalCount`, `cursor`·`nextCursor` 키, 값과 키의 `\u0000`, 짝이 없는 서로게이트), 그리고 400·409와 동시 첫 생성의 키 충돌 때 앱 로그에 본문 없음.
  - 응답: 성공 응답 모양, 핸들러가 만드는 오류 응답까지 `no-store`, 탈퇴하면 그 회원의 기록만 지워짐과 탈퇴·저장 동시 요청 뒤 기록 없음, 회원 행 삭제 때 함께 삭제. 회원 행 삭제 테스트는 CASCADE가 없는 다른 FK(`reviews`)에 걸리지 않게 리뷰가 없는 사용자로 하거나 그 행을 먼저 지운다.
  - 잡지 못하는 것: edge의 413(`infra/edge/test/test-edge.sh`가 맡는다). Prior art: `be/src/test/java/kr/co/fitdining/api/review/ReviewPersistenceTest.java`(`PostgresTestSupport`, `Withdrawal`).
- **FE 저장소 모듈** (example), AC-3, AC-9, AC-18, AC-21, AC-22, AC-23: jsdom Vitest에서 `thread-storage`와 app 계층의 인증 연결을 실제로 돌리고, 기록 API 응답과 `auth-client`(세션, 복원, `subscribe`)는 가짜로 둔다(`authenticated.test.ts`처럼 `auth-client`를 모듈째 mock한다). 같은 id 재전송, thread 안 순서대로 하나씩, 정해진 횟수, 409 `conflict` 뒤 계속, 다른 4xx 뒤 그 thread 멈춤(다른 thread는 계속), 고아 turn 없음, 요청 시 세션이 시작 시점과 다른 계정이면 보내지 않음, 세션 키가 바뀌면 대기분 버림, 대기분을 기기 저장소에 쓰지 않음, 회원 thread를 기기에 쓰지 않음, 세션 키 "모름"(복원 시간 초과, 네트워크 오류)이면 어디에도 저장하지 않고 확인된 뒤에도 화면은 비우지 않음, 세션 없음이 확인된 뒤 `subscribe` 알림이 와도 다시 복원하지 않음, 401이면 이 탭의 세션만 지움, 페이지 종료 신호 뒤 대기분을 보내지 않음, 비회원은 기록 API 미호출과 자동 삭제 없음, 옛 키 삭제, 저장소 예외·깨진 값·가득 찬 경우. 잡지 못하는 것: 실제 서버의 동시성. Prior art: `fe/src/domains/auth/api/authenticated.test.ts`, `fe/src/domains/place/ui/search-screen.test.tsx`.
- **FE 검색 화면** (example), AC-3, AC-5, AC-7, AC-8, AC-19, AC-20, AC-21, AC-23, AC-24 (46번 상세 카드는 기존 `place-detail-screen.test.tsx`로): jsdom에서 실제 store와 쿼리 캐시로 `SearchScreen`을 돌린다. 세션 전환 사례는 `providers.tsx`의 비우기 연결까지 함께 그린다.
  - 세션: 로그아웃, 다른 계정, 같은 사용자 새 세션, 비회원 로그인, 최종 401 때 비우기. 검색 화면이 없을 때 바뀌어도 장소 상세 화면(`use-stored-card`)에 이전 카드가 보이지 않음. 늦은 검색·다음 페이지·thread 읽기·저장 응답 버리기. 비회원 때 시작한 검색이 로그인 뒤 끝나면 화면에도 기록에도 남지 않음. 같은 세션 복원 때 화면 유지.
  - 저장 대상: 다음 페이지, "근처 맛집", 실패하거나 버린 검색은 저장 호출 없음. 저장 실패 때 검색 유지와 실패 알림 없음.
  - 시트와 열기: 시트의 첫 로딩, 빈 목록, 실패와 다시 시도, 더 보기와 그 실패, 중복 제거, 다시 열 때 첫 페이지부터, "보는 중". 줄별 열기 로딩 동안 지금 결과 유지, 실패 때 유지와 다시 시도, 받는 동안 다른 줄을 고르면 마지막 것만, 시트를 닫으면 받던 것 버림, "보는 중" 줄은 닫기만, 다시 열면 서버 것만(저장 안 된 turn 없음).
  - 다시 연 thread: 검색 호출 없음(기록 읽기와 검색 호출을 구분해 센다), 다음 페이지 미호출, 후속 요청의 `previousConditions`가 안쪽 `null`과 빈 객체까지 그대로.
  - 회귀: 기존 비회원 시나리오는 그대로 통과한다. 옛 키를 채워 넣던 기존 테스트(`search-screen.test.tsx`의 "저장된 값이 깨져 있어도" 등)는 새 키 기준으로 고친다. 주요 시나리오(새 검색, 후속 조건, 요청 기록, 과거 결과) 몇 개를 회원 모드로도 돌린다.
  - Prior art: `fe/src/domains/place/ui/search-screen.test.tsx`.
- **FE 순수 로직** (example), AC-10, AC-13, AC-22: Node 환경 Vitest로 `parseThreads`, 비회원 목록 정렬, 목록 요약 helper를 확인한다. place-search 테스트 계획의 FE 순수 로직 seam(Node 파서와 jsdom 경계)을 유지한다. BE가 받아들이는 turn의 대표 사례(최소 필드, `baseId` 있는 followUp, 안쪽 `null`이 든 `conditions`)를 `parseThreads`가 그대로 받는지 확인한다. 방향은 "BE가 받으면 FE도 받는다"이고, `parseThreads`는 고치지 않는다. Prior art: `fe/src/domains/place/model/search-threads.test.ts`.
- **지우기** (example), AC-27, AC-28, AC-29, AC-30: BE는 위 BE seam에서 하나 지우기(turn까지), 없는 thread 204, 다른 계정 유지, 전체 지우기, 지운 thread의 후속 400, 틀린 id 400, 다른 출처 403, 인증·탈퇴 401, `no-store`를 확인한다. FE는 `recent-search-sheet.test.tsx`(줄 지우기와 응답 뒤 빼기, 실패 토스트, 비회원 기기, 전체 삭제 확인 창)와 `search-thread-storage.test.ts`(대기분 버리기와 보내는 중인 저장 뒤 지우기, 재전송 멈춤, 실패하면 계속 저장, 전체 삭제 뒤 새 thread만 저장, 비회원)로 확인한다.
- **지우기 로컬 확인** (manual, 2026-11-03), AC-27, AC-28, AC-29, AC-30: local DB 모드, 회원, 375px에서 검색 기록 3개 중 하나를 열어 "보는 중"으로 만든 뒤 X로 지우면 `DELETE`가 FE 프록시를 거쳐 204이고(브라우저 Origin 통과) 그 줄만 빠지며 뒤 화면은 그대로였다. "전체 삭제" 확인 창의 문구를 보고 [삭제]를 누르면 `DELETE`가 204이고 빈 안내가 보였다. 실패 토스트, 비회원, [취소], 지운 thread의 이어 검색 미저장은 브라우저로 보지 않고 FE 테스트로만 확인했다(local은 AI 엔진이 없어 이어 검색을 보낼 수 없다).
- **탈퇴와 상한 로컬 확인** (manual, 2026-11-03), AC-25, AC-31: local DB 모드에서 시험 계정으로 새 기록 21개를 만들면 목록이 20개(`nextCursor` 없음)이고 가장 오래된 기록은 404였으며, 375px 최근 검색 시트에도 20줄만 보이고 "더 보기"가 없었다. 새로 가입한 계정으로 기록 3개를 만든 뒤 탈퇴(`DELETE /api/v1/users/{id}`, 204)하면 기록 API가 401이고 DB에 그 회원의 thread와 turn이 0건이었다. 탈퇴·저장 동시 요청과 비회원 기기 상한은 BE·FE 테스트로만 확인했다.
- **두 기기, 두 계정** (manual), AC-26: 브라우저 두 개(또는 일반 창과 시크릿 창)와 계정 두 개로 Usage의 흐름을 따라 한다. 잡는 것: 실제 FE와 BE가 이어진 복원과 이어 검색, 계정 격리. (D-16)
- **상한** (example), AC-31: BE는 21번째 새 thread에서 가장 오래된 1개만 turn까지 지워짐, 이어 쓰기는 지우지 않음, 과거 `at`의 새 thread도 남음, 동시 새 thread 뒤 20개, 다른 회원 유지를 확인한다. 상한보다 많은 목록 페이징은 DB에 행을 직접 넣어 확인한다. FE는 `search-thread-storage.test.ts`에서 비회원 기기 기록의 상한을 확인한다.

## Out of scope

- 로그인할 때 비회원 기록을 회원 계정으로 올리기(고도화 때) (D-8)
- 보관 기한 (D-12), thread 안 turn 개수 상한 (D-19)
- 저장한 기록을 검색 엔진 입력으로 쓰기, 검색 API의 회원 판단과 개인화 (D-1, D-11)
- 이미 탈퇴한 회원의 남은 기록 정리(없다고 본다), 재가입 때 이전 기록 처리(재가입은 새 사용자 id다) (D-13)
- BE의 본문 크기 상한(edge가 맡는다), PostgreSQL 서버 로그 설정 (D-4)
- local/dev에 Mock 장소 id로 쌓인 기록과 북마크 초기화(S15P31A302-115에서) (D-14)
- place-search 문서 수정, `infra/`와 `docs/infra/` 수정 (D-9, D-13)
- 새 화면(로딩과 실패 상태는 기존 시트 안에) (D-9)

## Open questions

- 팀과 RB-10 담당에게 "검색 기록에 입력 문장, 취향 태그, 관심 지역이 들어가고, 회원마다 최근 20개만 남으며 사용자가 지울 수 있고 탈퇴하면 지워진다"를 알린다.
