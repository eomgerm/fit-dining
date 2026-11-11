# 모임 추천 (meetup)

Status: draft
Decisions: [decisions.md](decisions.md) · Glossary and ADRs: none

## Problem

친구 모임의 장소는 보통 한 사람이 정한다. 그 사람은 혼자 후보를 찾아 단톡방에 올리고, 친구들의 조건은 기억에 의존한다. 모임 추천은 모임장이 만든 링크로 친구들의 조건을 모아 모두에게 잘 맞는 순서로 후보를 보여 주고, 같은 링크 안에서 투표해 정하게 한다(모임 추천 PRD §1).

이 spec은 모임 추천 PRD(FR-16~FR-29, AC-36~AC-89)의 BE·FE와, AI에 더하는 모임 전용 주소 두 개의 계약을 다룬다. AI 쪽 구현은 AI 담당이 그 계약과 수용 기준(AC-50 ~ AC-55, AC-57)으로 한다. Jira S15P31A302-207은 이 문서를 쓰는 일이고, 구현 이슈는 아래 여섯 단계 안에서 끝에서 끝까지 이어지는 조각으로 나눈다. BE·FE 이슈 하나가 BE와 FE를 함께 갖고, AI의 두 주소는 AI 담당 이슈로 따로 둔다(D-1).

| 단계 | 내용 | 선행 |
|---|---|---|
| ① 뼈대 | 모임 만들기, 프로필과 취향, 대신 쓰는 추천기로 추천과 결과 | |
| ② 투표와 정하기 | 투표 열기·투표·마감·동점, 정하기·바꾸기·취소 | ① |
| ③ 추천 연동 | AI의 모임 전용 주소 두 개, BE의 AI 추천기 | AI 계약 합의 |
| ④ 모임 지점 | 지도에서 지점과 반경 고르기 | ①. 실제 추천 결과는 ③ 뒤 |
| ⑤ 수명 주기 | 만료, 닫힘, 탈퇴, 모임 뒤 | ② |
| ⑥ 마무리 | 링크 미리보기, 회원 프로필로 바꾸기, 공개하는 홈 시작 버튼 | 시작 버튼은 ③과 실기기 확인 뒤 |

①과 ②는 장소 Mock 모드의 대신 쓰는 추천기로 끝까지 만든다. DB 모드는 처음부터 AI 추천기를 쓰므로 실제 추천은 ③ 뒤에 되고, 그 전에 DB 모드로 배포되면 계산은 실패로 보인다. 홈 시작 버튼을 붙이기 전이라 사용자에게는 보이지 않는다(D-11, D-12).

화면은 모임 추천 화면 예시(PRD §12)를 따르고, 화면 문구도 그 예시가 기준이다(PRD D-25). 이 문서의 AC·D 번호는 PRD와 따로 매긴다. PRD의 번호는 앞에 "PRD"를 붙여 적는다(PRD AC-36).

## Assumptions

1. 인증은 세션만 쓴다(S15P31A302-191, S15P31A302-193). Bearer와 JWT는 없고 `Authorization` 헤더는 판정에 쓰지 않는다. 컨트롤러는 `@AuthenticationPrincipal AuthUseCases.Identity`로 회원을 받고, 공개 경로에서 비회원이면 null이다. 새 경로는 기본으로 막히고 공개할 경로는 Security 설정에 등록한다. CSRF 검사는 로그인·가입과 비회원 요청까지 모든 쓰기 요청에 걸린다(D-8).
2. FE는 세션 쿠키로 인증한다(S15P31A302-192). API 함수는 토큰을 받지 않고, 공용 클라이언트(`@/shared/api/client`)가 브라우저의 모든 쓰기 요청에 CSRF 헤더를 붙인다. 로그인하지 않은 요청도 같다(D-20).
3. 오류 응답, 입력 검증, 모르는 속성 거부, null 필드 생략, 로그 규칙은 팀 BE 컨벤션(`be/docs/convention.md`)을 따른다. 전역 예외 처리는 없고 기능마다 예외 처리기를 둔다. 웹 빈은 마이그레이션 전용 프로필에서 만들지 않는다(`@ConditionalOnWebApplication`).
4. 탈퇴는 회원 행을 지우지 않고 `deleted_at`을 채운다. `UserService.withdraw`가 다른 기능의 정리를 직접 부른다(D-23).
5. 장소 정보는 장소 카탈로그가 준다. 장소 요약(`PlaceSummary`)에 업종과 좌표가 있다. 영업 상태 계산기(`OpenStatusCalculator`)는 시각을 받아 상태를 내고, 전날의 자정 넘김 영업을 본다. 음식 종류(`places.food_type`)는 식당에만 있고 채워진 비율은 확인 전이다(PRD OQ-27)(D-9, D-15).
6. AI 검색은 `POST /v1/search` 하나다. 요청문이 필수이고 한 사람의 취향만 받는다. 특정 날짜·시간으로 거르기, 브레이크타임 반영, 못 먹는 음식으로 거르기, 원형 반경이 없고, 선호 음식이 여러 개면 평균한다. 취향 모양이 틀리면 오류 없이 취향을 빼고 검색한다. 모르는 요청 속성은 400이다. 그래서 모임 계산은 새 주소로 만든다(D-12, D-15).
7. S15P31A302-196, S15P31A302-200, S15P31A302-201은 develop에 들어왔다. S15P31A302-196은 반경으로 거르는 기능(`RadiusArea`)을 넣고 지역 순서를 바꿨다. S15P31A302-200은 취향 세기를 바꾸고 업종별 취향을 더했다(마이그레이션 V24). S15P31A302-201은 BE의 AI 클라이언트 호출에 검색 목적을 넣고 장소 카탈로그에 지도 영역 안 장소 읽기(`cardsWithin`)를 더했다. develop의 마지막 마이그레이션은 V25(S15P31A302-193)다(D-5, D-15).
8. BE의 AI 클라이언트(`AiSearchClient`)는 예산 12초, 동시 호출 8개, 차단기, `BUSY` 재요청을 갖고 있다(D-13).
9. 예약 작업은 ShedLock으로 Blue/Green에서 한 번만 돈다. Redis는 세션 저장소로 웹 앱에 필수다. BE와 FE에 실시간 전송(SSE, WebSocket)이 없다(D-8, D-10, D-23).
10. FE는 Next.js App Router이고 의존 방향은 `app → domains → shared`다. 도메인끼리는 import하지 못하고 `app`이 조합한다. TanStack Query는 화면으로 돌아올 때 다시 받는 기본값이 켜져 있다. 지도는 네이버 지도 v3를 스크립트로 불러 쓰고 원 그리기와 화면 맞추기가 없다. 공유, 날짜 표기의 공용 코드가 없다(D-20, D-21).
11. dev 서버는 엣지의 쿠키 게이트 뒤에 있어 메신저 미리보기 봇과 처음 온 참여자가 열 수 없다(D-24).

## Usage

1. **모임 만들기**: 로그인한 회원이 홈의 시작 버튼으로 `/m/new`를 연다. 지역(선릉역), 업종(식당이 기본), 날짜·시간, 인원, 모임 설명을 넣고 "다음: 내 취향 남기기"를 누르면 `POST /api/v1/meetups`가 나가고, 받은 코드로 `/m/{code}/join`이 열려 자기 이름과 취향을 남긴다. 비회원이 시작 버튼을 누르면 로그인 안내가 뜨고 로그인 뒤 `/m/new`로 돌아온다.
2. **링크 보내기와 참여**: 모임장이 대기 화면에서 "모임 링크 보내기"로 기기 공유 창을 열거나 링크를 복사한다. 친구는 로그인 없이 `/m/{code}`를 연다. FE가 `GET /api/v1/meetups/{code}`로 스냅숏을 받아 프로필이 없으면 "처음 왔어요"와 프로필 목록을 보이고, 질문지에서 이름과 취향을 남기면 `POST /api/v1/meetups/{code}/profiles`가 나가며 모임 쿠키를 받는다. 같은 브라우저로 다시 오면 바로 자기 화면이 열린다.
3. **추천받기**: 모임장이 대기 화면에서 "추천받기"를 누르면 `POST /api/v1/meetups/{code}/calculations`가 202로 끝나고, 화면이 1초마다 스냅숏을 다시 받아 계산이 끝나면 `GET /api/v1/meetups/{code}/result`로 결과를 그린다. 다른 참여자는 링크를 다시 열면 같은 결과를 본다.
4. **투표와 정하기**: 모임장이 결과에서 2~3곳을 골라 투표를 열면 참여자 화면이 투표 화면으로 바뀐다. 참여자가 한 곳을 고르면 `PUT /api/v1/meetups/{code}/poll/votes/me`가 나가고, 투표 화면은 5초마다 표 수를 다시 받는다. 모임장이 마감하면 표가 가장 많은 곳이 정한 곳이 되고, 동점이면 모임장이 고르거나 투표를 계속한다.
5. **다른 브라우저**: 메신저 안 브라우저로 취향을 남긴 참여자가 기본 브라우저로 링크를 열면 프로필 목록에서 자기 이름을 고르고 한 번 확인한다. `POST /api/v1/meetups/{code}/profiles/{profileId}/session`이 나가고 그 브라우저에도 모임 쿠키가 생긴다.
6. **모임 뒤와 닫힘**: 모임 날짜 당일부터 회원 참여자에게는 정한 곳의 방문 평가가, 비회원에게는 로그인 안내가 보인다. 모임 날짜에서 7일이 지나면 모임이 지워지고, 링크는 처음부터 없던 링크와 같은 안내만 보인다. 대기 화면에는 미리 "11월 21일까지 열 수 있어요"가 보인다.

## Acceptance criteria

뼈대 (BE)

- [x] AC-1: `POST /api/v1/meetups`는 로그인하지 않으면 401이다. 지역이 없거나, 업종이 식당·카페·술집·상관없음이 아니거나, 인원이 2~8 밖이거나, 모임 설명이 100자를 넘거나, 시간만 있고 날짜가 없거나, 날짜가 오늘(KST)보다 앞이거나 오늘부터 30일(시작값) 뒤보다 늦거나, 오늘인데 시각이 이미 지났으면 400이다. 업종을 빼면 식당으로 저장한다. 성공하면 201과 22자 코드, 보일 질문을 준다. 같은 회원이 여러 번 만들면 코드가 모두 다르다. (D-2, D-17, D-23, D-25, D-27; PRD AC-36, AC-37, AC-88)
- [ ] AC-2: 삭제 시각은 모임 날짜 + 8일의 0시(KST), 곧 모임 날짜 + 7일이 끝날 때이고, 날짜가 없으면 만든 날 + 8일의 0시다. 스냅숏의 `info.expiresOn`은 열 수 있는 마지막 날(KST)이다. 서버에 주입한 시계로 계산하고 KST 자정 전후의 경계에서 하루 어긋나지 않는다. 날짜를 고치면 삭제 시각과 `expiresOn`이 다시 계산되고, 날짜를 비우면 비운 날 + 8일의 0시로 다시 계산된다. (D-23; PRD AC-39, AC-77)
- [x] AC-3: `GET /api/v1/meetups/{code}`는 로그인도 프로필도 없는 요청에 200과 스냅숏을 준다. 값이 없는 속성은 빠진다. 이 요청은 로그인 세션을 만들지 않는다. 없는 코드는 404다. (D-9)
- [x] AC-4: 스냅숏의 `allowed`는 PRD §5.1 표가 그 상태와 역할에 정한 동작만 담는다. 보기만 하는 사람과 참여자에게는 추천받기, 투표 열기, 마감, 정하기, 모임 정보 수정, 프로필 지우기가 없다. 투표 중에는 투표 열기·바로 정하기·추천받기가 없고, 정한 곳이 있으면 추천받기가 없다. (D-3; PRD AC-61, AC-75)
- [x] AC-5: `POST /api/v1/meetups/{code}/profiles`는 로그인 없이 프로필과 모임 취향을 만든다. 이름은 필수이고 앞뒤 공백을 지운 값이 1~10자다. 취향은 모두 생략할 수 있다. 이름은 앞뒤 공백을 지우고 유니코드 NFC로 정규화해 저장한다. 같은 모임에 같은 이름(대소문자 구분)의 프로필이 있으면 409 `name-taken`, 프로필이 이미 8개면 409 `full`이다. 두 요청이 동시에 와도 같은 이름은 하나만, 프로필은 8개까지만 생긴다. 색은 0~7 중 그 모임에서 쓰지 않는 값이다. 닫히기 전에는 어느 상태에서든 만들 수 있고, 투표가 열린 뒤나 정한 뒤에 남긴 취향은 추천을 바꾸지 않는다. 로그인한 회원이 만들면 회원 프로필이고, 한 회원은 한 모임에 프로필 하나이고, 두 번째는 409 `already-joined`다. (D-4, D-5; PRD AC-40, AC-64, AC-69)
- [x] AC-6: 보이지 않는 질문(`questions`가 false)의 답을 보내면 저장하지 않고 무시한다. 분위기는 조용함·활기·상관없음, 음식 종류는 한식·일식·중식·양식·아시안, 메뉴 가격 상한은 5,000~100,000원(시작값), 먹고 싶은 메뉴는 앞뒤 공백을 지운 값이 20자(시작값)까지이고 그 밖의 값은 400이다. 먹고 싶은 메뉴가 공백뿐이면 없는 것으로 본다. (D-17, D-26; PRD AC-59, AC-89)
- [x] AC-7: 프로필을 만들거나 고른 응답은 모임 쿠키를 준다. 이름 `fitdining_meetup`, HttpOnly, SameSite=Lax, `Path=/api/v1/meetups/{code}`, 만료는 모임 삭제 시각이다. DB에는 쿠키 값의 SHA-256 해시만 있다. 그 쿠키로 스냅숏을 받으면 `me.profileId`가 그 프로필이다. (D-7; PRD AC-63)
- [x] AC-8: `POST /api/v1/meetups/{code}/profiles/{profileId}/session`은 닫히기 전 어느 상태에서든 비회원 프로필이면 누구에게나 쿠키를 준다. 회원 프로필이면 그 회원으로 로그인한 요청만 되고 아니면 403이다. 없는 프로필은 404다. (D-7; PRD AC-63)
- [x] AC-9: 요청한 사람은 회원의 프로필, 모임 쿠키의 프로필, 보기만 하는 사람 순서로 정한다. 로그인한 회원에게 프로필이 없고 모임 쿠키가 비회원 프로필을 가리키면 그 프로필이고 스냅숏이 회원 프로필로 바꿀 수 있다고 알린다. 지워진 프로필을 가리키는 쿠키는 보기만 하는 사람이다. 모임 쿠키가 회원 프로필을 가리키면 그 회원으로 로그인한 요청에서만 그 프로필로 보고, 아니면 쿠키를 무시한다. (D-7, D-25; PRD AC-76)
- [x] AC-10: `PUT /api/v1/meetups/{code}/profiles/me/taste`는 자기 프로필의 취향만 바꾼다. 프로필이 없으면 403이다. 모든 상태에서 받고 `taste_updated_at`을 지금으로 바꾼다. 요청 값으로 다른 프로필을 가리킬 수 없다. 지금 보이는 질문의 칸만 바꾸고 숨겨진 질문의 칸은 그대로 둔다. (D-7, D-17; PRD AC-42, AC-67)
- [ ] AC-11: 공개 경로(스냅숏, 결과, 미리보기, 프로필 만들기·고르기, 취향 수정, 투표)는 로그인 없이 된다. 그 밖의 모임 경로는 로그인하지 않으면 401, 모임장이 아니면 403이다. (D-8)
- [ ] AC-12: `/api/v1/meetups/`의 쓰기 요청은 CSRF 토큰이 없거나 틀리면 로그인 여부와 상관없이 403이다. (D-8; PRD FR-28)
- [x] AC-13: 로그인 없는 쓰기(프로필 만들기·고르기, 취향 수정, 투표)가 같은 모임과 IP에서 15분 안에 한도를 넘으면 429다. 로그인한 요청은 세지 않는다. (D-8; PRD AC-79)
- [ ] AC-14: `/api/v1/meetups/**` 응답에는 `Cache-Control: no-store`가 있다. 어떤 요청이든(성공, 400, 409, 실패한 계산) 처리한 뒤 BE 로그에 참여자 이름, 모임 취향, 모임 설명, 요청 본문이 나타나지 않는다. (D-8; PRD AC-57)
- [x] AC-15: `POST /api/v1/meetups/{code}/calculations`는 모임장만 된다. 상태가 WAITING이나 RESULT이고, RUNNING인 계산이 없고, 투표가 한 번도 열리지 않았을 때 202다. 아니면 409다. 취향을 남긴 사람이 모임장뿐이어도 된다. 두 요청이 동시에 와도 계산은 하나만 시작된다. 계산 행에 시작 시각, 취향을 남긴 수, 포함한 프로필이 남는다. (D-4, D-10, D-19; PRD AC-44, AC-54, AC-71)
- [x] AC-16: 계산이 성공하면, 그 계산 행이 아직 RUNNING일 때만 결과가 저장되고 상태가 RESULT가 되며 이전 계산 행이 지워진다. 그 행이 이미 FAILED가 됐거나 지워졌으면 결과를 버린다. 실패하면 계산이 FAILED가 되고 상태와 남긴 취향은 그대로다. 새 계산을 시작하면 이전에 실패한 계산 행은 지워진다. 계산 한 번에 추천기 포트는 한 번만 불린다(AC-48의 다시 해석과 다시 부르기는 그 안에서 한 번까지). (D-10, D-29; PRD AC-67, AC-71)
- [x] AC-17: RUNNING인 계산이 시작한 지 45초(저장한 해석을 다시 만드는 경우의 AI 호출 세 번까지 포함한 시작값)를 넘으면 스냅숏을 읽거나 추천받기를 시작할 때 FAILED로 바뀌고 새 계산을 시작할 수 있다. 작업 스레드의 대기열이 차 있으면 계산 행은 바로 FAILED가 되고 응답은 202다. (D-10; PRD AC-85)
- [x] AC-18: 마지막으로 성공한 계산이 시작된 뒤에 취향을 남기거나 고친 프로필이 있거나, 모임 정보가 바뀌었거나, 그 계산에 들어간 프로필이 지워졌으면 스냅숏의 `calculation.outdated`가 true다. 그 프로필은 `profiles[].reflected`가 false이고, 본인의 스냅숏은 `me.tasteReflected`가 false다. (D-9; PRD AC-55, AC-72, AC-81)
- [x] AC-19: `GET /api/v1/meetups/{code}/result`는 장소 20곳까지를 순서대로 준다. 덜 맞는 사람(참여자 취향 점수 50 미만)이 있는 장소는 없는 장소보다 뒤에 있고 두 묶음이 구분된다. 묶음 안은 모임 점수 내림차순이고, 같으면 가장 낮은 참여자 취향 점수가 높은 곳이 앞이다. 모임 점수가 없으면 묶음 안에서 추천기가 준 순서를 지킨다. 점수가 없는 참여자는 잘 맞는 사람이다. 순위, 묶음, 잘 맞는 사람 표시는 결과를 줄 때 저장한 점수로 정하고, 계산 뒤 지운 프로필은 빼고 판정한다. (D-18; PRD AC-49, AC-51)
- [x] AC-20: 결과의 모임 점수는 0~100 정수이고, 점수를 매길 조건(모임 설명의 조건, 합친 취향)이 하나도 없으면 없다. 결과에는 프로필 번호만 있고 이름이 없다. 계산 뒤에 지워진 프로필은 응답에서 빠진다. 잘 맞는 사람 표시는 모두, 반영된 수, 대체로, 덜 맞는 사람 넷 중 하나다. 단체 이용·예약 가능·가까운 역과 도보 시간은 장소 정보가 있을 때만 있다. 영업 상태는 모임 날짜·시간이 있으면 그 시각, 없으면 지금 기준이다. (D-5, D-18; PRD AC-50, AC-51, AC-52, AC-81)
- [x] AC-21: 장소 Mock 모드에서는 대신 쓰는 추천기가 AI를 부르지 않고 지역 안의 장소로 결과를 만든다. 같은 입력이면 같은 결과다. 이 모드에서는 해석 주소를 부르지 않고(요약이 없으므로 고른 업종에서 물을 수 있는 질문이 모두 보인다) 다시 해석도 하지 않으며, 메뉴 가격 질문은 보이지 않는다. (D-11)
- [ ] AC-22: `PATCH /api/v1/meetups/{code}`는 모임장만 된다. WAITING·RESULT에서는 모든 항목을, VOTING·DECIDED에서는 날짜·시간만 고친다. 그 밖의 항목을 고치려 하면 409 `phase`다. 날짜·시간의 검증은 AC-1과 같다. 업종이나 설명을 고쳐 보일 질문이 바뀌면 이미 남긴 답은 지우지 않는다. 숨겨진 질문의 답은 계산에 싣지 않고, 새로 보이는 질문은 건너뛴 것으로 본다. 다시 보이게 되면 남겨 둔 답이 다시 쓰인다. 투표 중·정함에서 날짜·시간을 고치면 후보를 다시 거르지 않고, 결과 카드의 영업 상태만 새 시각으로 보인다. 빠진 속성은 그대로 두고 null인 속성은 비운다. 지역과 업종은 비울 수 없고, 날짜는 WAITING·RESULT에서만 비울 수 있다(VOTING·DECIDED에서는 409 `phase`). (D-17, D-19, D-23; PRD AC-77, FR-16)
- [x] AC-23: `DELETE /api/v1/meetups/{code}/profiles/{profileId}`는 모임장만 된다. 그 프로필의 취향, 쿠키 세션, 표가 함께 지워진다. 모임장 자신의 프로필은 지울 수 없다(409 `host-profile`). (D-5, D-25; PRD AC-69)
- [ ] AC-24: 모임 날짜를 바꿔 삭제 시각이 바뀌면, 모임 쿠키가 실린 다음 요청의 응답이 같은 값의 쿠키를 새 삭제 시각으로 다시 준다. (D-7; PRD AC-63)

뼈대 (FE)

- [x] AC-25: `/m/new`는 로그인하지 않았으면 로그인 안내를 띄우고, 로그인을 마치면 `/m/new`로 돌아온다. 지역이 비어 있으면 "다음: 내 취향 남기기"가 눌리지 않는다. 업종은 칩 네 개 중 하나이고 처음에 식당이 골라져 있다. 만들기 요청이 처리 중이면 버튼이 눌리지 않고 진행을 보인다. (D-20, D-22; PRD AC-36, AC-37, AC-88)
- [x] AC-26: `/m/{code}`는 스냅숏으로 화면을 정한다. 프로필이 없으면 모임 정보, 프로필 목록, "처음 왔어요"를 보인다. 모임장에게 프로필이 없으면 질문지를 연다. 프로필이 있으면 상태에 맞는 화면(대기, 결과, 투표, 정한 곳)을 연다. 프로필 목록에서 회원 프로필(모임장 포함)을 고르면, 로그인하지 않았으면 로그인 안내를 띄우고 로그인을 마치면 그 모임으로 돌아와 자기 화면을 연다. 다른 회원으로 로그인돼 있으면 그 프로필을 고를 수 없다고 알린다. 프로필 목록의 회원 프로필은 이니셜 아바타의 배지로 보인다(모임장은 진한 주황 원에 흰 왕관, 다른 회원은 흰 원에 회색 테두리와 사람 아이콘이다). 목록 아래에 두 줄 설명이 있다. 첫 줄은 배지와 함께 "모임장 · 회원", 둘째 줄은 "회원 프로필은 로그인해야 들어갈 수 있어요"다. 그 아래 "결과만 보기"는 프로필 없이 결과(없으면 대기 화면)를 연다. 인원을 정한 모임에서 남긴 수가 인원 이상이면 "처음 왔어요"를 누를 때 한 번 묻는다. (D-7, D-20, D-25; PRD AC-63, AC-70, AC-76)
- [x] AC-27: 질문지는 이름만 필수이고 스냅숏의 `questions`가 true인 질문만 보인다. 취향을 남기기 전에 남긴 취향이 링크를 가진 사람에게 보인다는 안내가 있다. 화면 문구에 질문 개수가 없다. 메뉴 가격 질문은 1만·2만·3만 원, 직접 입력, 상관없음 칩이고, 직접 입력을 고르면 금액 칸이 열린다. 대표 메뉴 한 개 가격 기준이라는 안내가 있다. 음식 종류 칩 아래에 건너뛸 수 있는 먹고 싶은 메뉴 칸(예: 곱창, 마라탕)이 있고 20자까지 받는다. 파는 곳을 먼저 보이고 꼭 맞추지는 않는다는 안내가 있다. 이미 있는 이름이면(409) 이름 칸 아래에 안내하고 입력이 남는다. 프로필이 다 찼으면(409) 다 찬 모임 화면을 보인다. (D-17, D-26; PRD AC-40, AC-41, AC-59, AC-74, AC-89)
- [x] AC-28: 질문지에서 로그인하러 갔다 돌아오면 쓰던 답이 남아 있다. 답은 그 탭의 sessionStorage에만 두고 서버로 보내지 않는다. (D-21; PRD AC-76)
- [ ] AC-29: 대기 화면은 프로필마다 이름과 취향 요약을 보인다. 인원을 정한 모임이면 아직 남기지 않은 수가 보이고, 인원을 정하지 않았거나 남긴 수가 인원보다 많으면 남긴 수만 보인다. 자기 줄에서 취향을 수정할 수 있고, 모임장의 자기 줄에도 참여자와 같은 "수정"이 있다. 모임장에게는 다른 사람 줄마다 ⋯ 메뉴(프로필 지우기)가 있다. 모임 정보에 "11월 21일까지 열 수 있어요"처럼 열 수 있는 마지막 날(`info.expiresOn`)이 보인다. 모임장의 대기 화면에서는 링크 보내기 구역 바로 위다. 모임장에게는 모임 정보 오른쪽 위에 "수정"이 보인다(AC-30). 이름 옆에 "회원", "모임장" 글자를 두지 않고 이니셜 아바타의 같은 배지로 보인다. (D-6, D-20, D-23; PRD AC-41, AC-67, AC-70, AC-78)
- [ ] AC-30: 화면의 버튼은 스냅숏의 `allowed`에 있는 동작만 보인다. FE가 상태와 역할로 따로 판단하지 않는다. 모임 정보 수정은 대기 화면의 모임 정보 오른쪽 위와 결과 화면의 첫 줄 오른쪽에 있는 "수정"으로 연다. 이 버튼은 `allowed`에 `EDIT_INFO`나 `EDIT_DATE`가 있을 때만 보인다. `EDIT_INFO`가 있으면 모든 항목(지역, 업종, 날짜·시간, 인원, 모임 설명)을 고치는 화면을, `EDIT_DATE`만 있으면 날짜·시간만 고치는 같은 화면(`/m/[code]/edit`)을 연다. 투표 중·정함에서도 결과 화면 첫 줄의 같은 "수정"으로 열고, 투표 화면과 정한 곳 화면에는 두지 않는다. 수정 화면은 고른 날짜로 열 수 있는 마지막 날(날짜 + 7일)을 미리 보인다. 프로필 지우기(`REMOVE_PROFILE`)는 대기 화면에서는 친구 목록의, 결과 뒤에는 친구들 취향 보기의 다른 사람 줄마다 있는 ⋯ 메뉴로 하고, 지우기 전에 한 번 묻는다. (D-3, D-20, D-23; PRD AC-61, AC-75, AC-77)
- [x] AC-31: 스냅숏은 화면에 들어올 때와 탭이나 앱으로 돌아올 때 다시 받는다. 계산 중에는 1초마다 다시 받고, 계산이 끝나면 결과를 받는다. 계산이 실패하면 "다시 시도"가 보이고 남긴 취향은 그대로다. (D-21, D-29; PRD AC-67, AC-68)
- [ ] AC-32: 결과 카드는 본문과 아래 동작 영역이 따로 눌린다. 본문은 장소 상세를 열고, 동작 영역에는 모임장에게만 투표에 올리기와 여기로 정하기가 있다. 모임 점수가 없으면 핏 점수와 그 설명 줄을 보이지 않는다. 모임 화면에 다른 서비스로 가는 링크가 없다. 덜 맞는 사람이 원한 메뉴를 그 장소가 팔지 않으면(`fit.missedMenus`) 덜 맞는 사람 줄이 "도윤님이 원한 곱창은 아니에요"처럼 그 메뉴를 말한다. 결과 위 조건 칩에는 모은 메뉴가 "곱창 원해요"처럼 보인다. (D-20, D-26; PRD AC-38, AC-89)
- [x] AC-33: 모임에서 연 장소 상세(`/places/{id}?meetup={code}`)는 모임 점수와 추천 이유를 보이고 개인 검색 점수를 보이지 않는다. 주소를 직접 열어도 같다. (D-22, D-29; PRD AC-86)
- [x] AC-34: "모임 링크 보내기"는 기기 공유 창을 연다. 공유 창이 없거나 실패하면 링크를 복사하고 알린다. 공유하는 것은 모임 링크뿐이다. (D-20; PRD AC-38)
- [x] AC-35: 쓰기 요청이 409를 받으면 `type`에 맞는 짧은 안내를 띄우고 스냅숏을 다시 받는다. 입력하던 값은 남는다. (D-4, D-21)

투표와 정하기

- [ ] AC-36: `POST /api/v1/meetups/{code}/poll`은 모임장이 RESULT 상태에서만 연다. 후보는 지금 결과 안의 서로 다른 장소 2~3곳이고 아니면 400이다. 익명 여부를 빼면 익명이다. 연 뒤에는 익명 여부와 후보를 바꾸는 API가 없다. 계산이 RUNNING이면 409 `calculating`이다. (D-10, D-19; PRD AC-54)
- [ ] AC-37: `PUT /api/v1/meetups/{code}/poll/votes/me`는 프로필이 있는 사람만 된다(없으면 403). 후보가 아닌 장소는 400이다. 다시 보내면 표가 바뀌고 한 프로필의 표는 하나다. 투표가 닫힌 뒤에는 409 `poll-closed`다. (D-19; PRD AC-73)
- [ ] AC-38: 익명 투표의 스냅숏에는 후보별 표 수와 투표한 수만 있고, 누가 어디를 골랐는지와 투표하지 않은 사람의 이름이 없다. 이름이 보이는 투표에는 후보별로 고른 프로필과 투표하지 않은 프로필이 있다. (D-9; PRD AC-62, AC-82)
- [ ] AC-39: 익명 투표에서 `myVote`는 그 표를 던진 브라우저 세션이나 그 회원에게만 온다. 다른 브라우저로 고른 비회원 프로필에는 투표했는지(`hasVoted`)만 온다. (D-7; PRD AC-73)
- [ ] AC-40: `POST /api/v1/meetups/{code}/poll/close`는 표가 하나도 없으면 409 `no-votes`다. 가장 많은 곳이 하나면 그곳이 정한 곳이 되고 상태가 DECIDED다. 동점이면 투표가 닫히고 상태는 VOTING에 머문다. `POST .../poll/reopen`은 동점으로 닫힌 투표만 다시 연다. 마감할 때의 동점 여부와 동점 표 수는 고정되어, 마감 뒤 프로필이 지워져도 투표 계속하기와 동점 안내가 바뀌지 않는다. (D-5, D-19; PRD AC-60, AC-73)
- [ ] AC-41: `PUT /api/v1/meetups/{code}/decision`은 RESULT에서는 결과 안의 장소로, 닫힌 투표에서는 후보 중 하나로, DECIDED에서는 결과 안의 다른 장소로 정한다. `DELETE`는 정한 곳을 지우고, 투표가 있으면 닫힌 투표로, 없으면 RESULT로 돌아간다. 동점에서 고른 경우 스냅숏이 그 사실과 동점 표 수를 알린다. 정한 곳을 다른 곳으로 바꾸면 `method`는 DIRECT가 되고 `tieVotes`는 비운다. 계산이 RUNNING이면 409 `calculating`이다. (D-10, D-19; PRD AC-60, AC-68, AC-83)
- [ ] AC-42: 투표 중에 프로필을 지우면 그 프로필의 표도 지워지고 표 수가 줄어든다. (D-5; PRD §5.1)
- [ ] AC-43: 투표 화면은 열려 있는 동안 5초마다 스냅숏을 다시 받는다. 투표한 수와 후보별 표 수가 보이고 이니셜 아바타는 없다. 익명인지 아닌지를 위쪽에 알린다. 프로필이 없으면 표 수는 보이고 투표하려면 이름을 고르라고 안내한다. (D-21; PRD AC-64, AC-68, AC-82)
- [ ] AC-44: 아직 투표하지 않은 사람이 있을 때 마감을 누르면 한 번 묻는다. 한 곳만 골랐으면 투표 열기 대신 바로 정하기를 안내하고 네 번째는 고를 수 없다. 계산 뒤에 남긴 취향이 있으면 투표 열기 시트에 알리고 "다시 추천받기"를 보이되 막지 않는다. (PRD AC-54, AC-81, AC-82)
- [ ] AC-45: 정한 곳은 모든 참여자의 결과 화면 맨 위에 보인다. 모임 날짜 전에는 만날 날짜·시간과 장소가 보이고 방문 평가는 보이지 않는다. 정한 곳 화면 아래의 "친구들 취향 보기"는 결과 화면과 같은 친구들 취향 화면을 연다. 정한 곳이 있을 때 그 화면에서 내 취향의 "수정"을 누르면 추천이 바뀌지 않는다는 것을 먼저 알린 뒤 고친다. (D-20; PRD AC-60, AC-83)

추천 연동

- [ ] AC-46: DB 모드의 계산은 AI `POST /v1/meetup/search`를 한 번 부른다(AC-48로 다시 해석한 경우에만 한 번 더). 요청 본문은 저장한 `conditions`(있을 때), `area`, `category`(상관없음이면 없음), `when`(날짜가 있을 때), `members`만 담는다. `members`에는 프로필 번호, 회원이면 `userId`, 그 프로필의 답 중 지금 보이는 질문의 답이 있고 이름이 없다. 먹고 싶은 메뉴는 적은 글 그대로 싣는다. 모임 지점(`POINT`)은 `area`의 `CIRCLE`로 보낸다. 모임 계산과 일반 검색은 호출 예산, 동시 호출 한도, 차단기를 함께 쓴다. (D-13, D-15, D-26; PRD AC-57, AC-71)
- [ ] AC-47: 모임을 만들거나 설명을 고칠 때 설명이 있으면 AI `POST /v1/meetup/interpret`를 한 번 부르고 받은 `conditions`와 `summary`를 저장한다. 설명이 바뀌지 않은 수정은 다시 부르지 않는다. 설명이 비면 부르지 않고 저장한 조건을 지운다. 계산은 모임 설명을 다시 해석하지 않는다. 설명이 바뀌면 해석 결과와 상관없이 먼저 저장한 조건과 요약을 지운다. 해석 주소는 트랜잭션 밖에서 부르고, 저장할 때 잠금을 잡아 그사이 설명이 바뀌지 않았는지 확인한다. (D-4, D-14; PRD AC-84)
- [ ] AC-48: 해석 호출이 실패해도(AI에 닿지 않음, 시간 초과, 읽을 수 없는 응답) 모임은 만들어지거나 고쳐지고, 고른 업종에서 물을 수 있는 질문이 모두 보인다. 설명이 있는데 저장한 조건이 없으면 다음 계산을 시작할 때 한 번 다시 해석하고, 그때도 실패하면 계산은 FAILED다. AI가 저장한 조건을 읽지 못한다고 답하면(400, `code` `CONDITIONS_INVALID`) 저장한 조건을 지우고 같은 계산 안에서 한 번 다시 해석해 다시 부른다. 그래도 실패하면 FAILED다. (D-14, D-16)
- [ ] AC-49: 보일 질문은 고른 업종으로 정한다. 카페면 음식 질문이 없고, 술집이면 매운 음식만 있다. 식당과 상관없음이면 해석 요약에 음식 언급이 없을 때 음식 종류와 먹고 싶은 메뉴도 있다. 메뉴 가격 질문은 AI가 읽는 뷰(`ai_place_search`)에 가게 가격이 있는 장소가 하나라도 있을 때만 있다. 없으면 메뉴 가격 질문, 가격 요약, 가격 조건 칩이 어디에도 없다. 이 판단은 설정이 아니라 데이터로 하고, 뷰가 바뀌면 10분(시작값) 안에 따라 바뀐다. 설명 속 업종은 질문에 영향을 주지 않는다. 분위기 질문은 업종과 설명에 상관없이 늘 있다. (D-17; PRD AC-59, AC-74)
- [ ] AC-50: AI의 모임 계산은 `area`와 `category`가 `conditions` 속 지역·업종보다 앞선다. 결과에는 그 역·동의 장소나 지점에서 반경 안의 장소만, 고른 업종의 장소만 있다. `category`가 없으면 업종으로 거르지 않는다. `conditions`가 없어도 계산한다. (D-15; PRD AC-65, AC-84, AC-88)
- [ ] AC-51: AI의 모임 계산은 `when`에 날짜와 시각이 있으면 그 시각에 영업하지 않는다고 확인된 곳, 브레이크타임인 곳, 그 시각부터 1시간 안에 닫거나 브레이크타임이 시작하는 곳을 뺀다. 날짜만 있으면 그 요일이 휴무인 곳을 뺀다. 영업시간을 모르는 곳은 남긴다. 전날 영업이 자정을 넘어 이어지는 시각은 영업 중으로 본다. (D-15; PRD AC-48)
- [ ] AC-52: AI의 모임 계산은 한 명이라도 못 먹는다고 한 음식 종류로 확인된 식당을 빼고, 음식 종류를 모르는 곳은 남긴다. 선호 음식은 장소를 빼지 않고, 모은 종류 중 가장 잘 맞는 하나로 센다. 한 명이라도 매운 음식을 못 먹으면 매운 근거가 있는 곳의 모임 점수가 그렇지 않을 때보다 낮고, 그 장소는 빠지지 않는다. 메뉴 가격 상한이 있으면 참여자들의 상한 중 가장 낮은 값을 쓰고, 가게 가격이 그 110%를 넘는 곳을 뺀다. 가게 가격을 모르는 곳은 남긴다. 먹고 싶은 메뉴도 장소를 빼지 않는다. 모은 메뉴 중 메뉴판에 있는 것이 있으면 모임 점수가 오르고, 선호 음식처럼 가장 잘 맞는 하나로 센다. 메뉴판을 모르는 곳은 그 항목을 비교에서 뺀다. (D-15, D-26; PRD AC-45, AC-46, AC-47, AC-89)
- [ ] AC-53: AI의 모임 계산은 취향을 PRD FR-22 규칙으로 합친다. 분위기는 조용함과 활기 중 많은 쪽이고 같으면 넣지 않으며, 설명에 분위기가 있으면 설명을 따른다. 회원(`userId`)의 평소 취향은 중요 기준과 직접 입력 취향만 더하고 방문 목적은 쓰지 않는다. 분위기와 음식은 모임 질문의 답이 앞선다. 아무 질문에도 답하지 않은 비회원 참여자는 결과를 바꾸지 않는다. 아무 질문에도 답하지 않은 회원 참여자는 평소 취향만 합치고, 그 사람의 참여자 취향 점수도 평소 취향으로 낸다. 모임 점수는 0~100 정수다. 먹고 싶은 메뉴는 계산 한 번에 참여자들의 글을 모두 모아 LLM을 한 번만 불러 해석한다. 적은 사람이 없으면 부르지 않는다. LLM이 실패하거나 기다리는 시간(시작값)을 넘기면 규칙 해석(낱말표)으로 대신하고 `fallbacks`에 남긴다. 글에서는 메뉴만 쓰고 지역·시간·가격·분위기 같은 다른 조건은 버린다. LLM에는 글만 보내고 프로필 번호와 이름은 보내지 않는다. (D-15, D-26; PRD AC-43, AC-50, AC-89)
- [ ] AC-54: AI의 모임 계산 응답은 장소 20곳까지와, 장소마다 모임 점수(점수를 매길 조건도 합친 취향도 없으면 없음), 참여자별 취향 점수(`memberScores`)를 준다. 참여자 취향 점수는 그 사람의 취향만 비교하고 근거가 없는 항목은 뺀다. 판정할 항목이 없으면 점수가 없다. 적용한 합친 취향(`applied`, 해석한 메뉴 포함)을 함께 준다. 참여자 취향 점수에는 그 사람이 원한 메뉴가 항목으로 들어가고, 메뉴판에 그 메뉴가 없으면 그 참여자의 `missedMenu`를 준다. 여러 메뉴를 적었으면 그중 하나도 메뉴판에 없을 때 놓친 것으로 보고 적은 순서의 첫 메뉴를 준다. 결과의 `fit.missedMenus`에는 덜 맞는 사람만 담는다. (D-15, D-26; PRD AC-51, AC-89)
- [ ] AC-55: AI의 모임 계산은 후보가 없으면 조건을 하나씩 빼 보고 결과가 생기는 조건을 원인으로 준다. 원인이 참여자의 조건이면 그 프로필 번호(`memberKeys`)를 붙인다. 조건을 자동으로 완화하지 않는다. 요청 모양이 틀리면 400이고 취향을 조용히 빼지 않는다. `conditions`는 이전 버전도 읽고, 읽지 못하면 400과 `code` `CONDITIONS_INVALID`를 준다. 해석 주소는 1~100자 밖이면 400이고, 응답에 `conditions`, 요약(`summary.mentionsFood`), `interpretedBy`, `fallbacks`를 준다. LLM이 실패하면 규칙 해석으로 대신하고 `interpretedBy`가 `RULE`이다. (D-14, D-15; PRD AC-53)
- [ ] AC-56: AI를 부를 수 없거나, 예산을 넘기거나, 응답을 읽을 수 없거나, AI가 400을 주면(`CONDITIONS_INVALID`는 AC-48대로 다시 해석한 뒤에도) 계산은 FAILED다. 대체 순위를 만들지 않는다. (D-16; PRD AC-85)
- [ ] AC-57: 모임 설명이 비어 `conditions`가 없으면, AI는 모임 설명 해석(LLM)을 부르지 않고 업종 이름(식당·카페·술집. 상관없음이면 시작값 "맛집")을 후보를 뽑는 문장으로 써서 지금 검색과 같은 방식으로 후보를 뽑는다. 요청 조건이 없으므로 모임 점수는 합친 취향만으로 낸다. (D-15; PRD AC-84)

모임 지점

- [ ] AC-58: `GET /api/v1/meetups/area-check`는 지점과 반경(500, 1000, 2000, 5000) 안의 장소 수와 붙일 이름을 준다. 이름은 반경 안 장소에 가장 많은 동 이름에 "근처"를 붙인 것이고, 장소가 없으면 이름이 없다. 그 밖의 반경은 400이다. (PRD AC-80)
- [ ] AC-59: 모임 지점으로 만든 모임의 결과에는 반경 안 장소만 있고, 카드의 거리는 지점에서 직선거리(m, km)다. 걸리는 시간은 없다. (D-15; PRD AC-65)
- [ ] AC-60: 지도에서 고르기는 핀이 화면 가운데 고정되고 지도를 움직여 맞춘다. 반경을 바꾸면 원 전체가 화면에 들어온다. "내 위치"는 지도만 옮기고, 서버로 가는 지점 요청에 기기 위치에서 왔다는 표시가 없다. 지도를 불러오지 못하면 지도로 고르기를 숨긴다. 참여자 화면의 모임 정보에는 같은 지도 SDK로 그린 작은 지도와 반경 원이 있고(모임 지점 모임만), 지도를 불러오지 못하면 지점 이름과 반경만 보인다. (D-20; PRD AC-66, AC-80)

수명 주기

- [ ] AC-61: 삭제 시각이 지난 모임은 예약 작업이 지운다. 삭제 시각이 지난 모임의 링크를 열면 그 요청에서 지운다. 지운 모임의 코드로 온 모든 모임 API는 처음부터 없던 코드와 같은 404를 준다. 지운 뒤 그 모임의 프로필(취향·표 포함), 쿠키 세션, 계산 행이 없다. (D-6, D-23; PRD AC-39, AC-78)
- [ ] AC-62: 모임이 닫히면(삭제 시각이 지나거나 모임장이 탈퇴하면) 모임 행을 지우고 자식 행(프로필, 쿠키 세션, 계산)이 따라 지워진다. 닫힌 날과 이유를 포함해 그 모임에 대해 남는 것이 없고, 측정용 집계도 남기지 않는다. (D-6; PRD AC-78)
- [ ] AC-63: 회원이 탈퇴하면 그 회원이 만든 모임이 모두 지워지고, 다른 모임에 있는 그 회원의 프로필과 취향, 표가 지워진다. 탈퇴가 되돌아가면 모임도 그대로다. (D-23; PRD AC-56)
- [ ] AC-64: 정한 곳이 있고 모임 날짜 당일(날짜가 없으면 정한 당일, KST)부터 스냅숏의 `afterMeetup`이 true다. 회원 참여자에게는 정한 곳의 방문 평가가, 비회원에게는 로그인 안내가 보인다. 방문 평가를 열면 방문일 기본값이 모임 날짜이고, 방문일 범위 밖이면 기본값을 쓰지 않는다. (D-3, D-22, D-23; PRD AC-61, AC-87)
- [x] AC-65: 없는 코드의 링크(404)는 없는 링크 화면을 보인다. 문구는 하나이고 처음부터 없던 링크와 끝난 모임을 함께 덮는다("없거나 끝난 모임이에요", "모임은 모임 날짜에서 7일 뒤, 또는 모임장이 탈퇴하면 사라져요"). 모임 정보를 보이지 않는다. (D-6; PRD AC-78)

마무리

- [ ] AC-66: `/m/{code}`의 응답 HTML에는 모임장 닉네임, 지역, 날짜·시간, 가입 없이 답할 수 있다는 안내가 든 미리보기 메타 태그와 서비스 기본 이미지가 있다. 질문 개수, 모임 취향, 참여자 이름은 없다. 없는 코드(지운 모임 포함)는 일반 안내다. 모임 화면에는 `noindex`와 no-referrer 메타가 있다. (D-9; PRD AC-58)
- [ ] AC-67: 홈 지도 왼쪽 위에 시작 버튼이 있고 "이 지역에서 검색" 버튼과 겹치지 않는다. 위치와 모양은 화면 예시(모임장 1)를 따른다. (D-22, D-24; PRD AC-36)
- [ ] AC-68: `POST /api/v1/meetups/{code}/profiles/me/account`는 로그인한 회원의 비회원 프로필을 회원 프로필로 바꾼다. 모임 취향은 회원의 취향으로 옮겨지지 않는다. 그 회원에게 이미 이 모임의 프로필이 있으면 409 `already-joined`다. (D-25; PRD AC-76)
- [ ] AC-69: 모임 기능을 켜고 끄는 설정이 없다. 모임 API와 화면은 배포되면 동작하고, 환경 변수 계약(`docs/infra/contracts/env.md`)과 FE의 `/config.json`이 바뀌지 않는다. (D-24)

절대 일어나면 안 되는 일

- [ ] AC-70: 어떤 요청에서든 모임장 전용 동작(추천받기, 투표 열기·마감·다시 열기, 정하기, 모임 정보 수정, 프로필 지우기)은 그 모임을 만든 회원의 로그인으로만 된다. 모임 쿠키나 요청 값으로는 되지 않는다. (D-8)
- [ ] AC-71: 어떤 상태와 요청 순서에서든 익명 투표에서 누가 어디를 골랐는지가 응답에 나타나지 않는다. 동점 응답과 마감 뒤 응답도 같다. (D-7; PRD AC-62)
- [ ] AC-72: 어떤 요청에서든 AI 요청 본문과 BE 로그에 참여자 이름이 나타나지 않는다. (D-13; PRD AC-57)
- [ ] AC-73: 지운 모임의 코드로는 어떤 모임 데이터도 읽거나 쓸 수 없고 모든 요청이 404다. (D-6; PRD AC-39)
- [ ] AC-74: 한 모임의 프로필은 8개를 넘지 않고, 같은 이름의 프로필이 둘이 되지 않으며, RUNNING인 계산이 둘이 되지 않으며, 모임당 계산 행이 둘을 넘지 않는다. (D-4, D-5)

## Interfaces

### API

경로 앞에 `/api/v1`이 붙는다. 성공 응답은 DTO, 오류는 ProblemDetail이다.

| 메서드와 경로 | 누가 | 하는 일 | 단계 |
|---|---|---|---|
| `POST /meetups` | 회원 | 모임 만들기 | ① |
| `GET /meetups/areas?q=` | 회원 | 장소 데이터가 있는 역·동 찾기 | ① |
| `GET /meetups/area-check?lat=&lng=&radiusM=` | 회원 | 반경 안 장소 수와 붙일 이름 | ④ |
| `GET /meetups/{code}` | 누구나 | 스냅숏 | ① |
| `GET /meetups/{code}/result` | 누구나 | 결과 | ① |
| `GET /meetups/{code}/preview` | 누구나 | 링크 미리보기용 정보. FE 서버가 부른다 | ⑥ |
| `PATCH /meetups/{code}` | 모임장 | 모임 정보 수정 | ① |
| `POST /meetups/{code}/profiles` | 누구나 | 프로필 만들기와 취향 남기기 | ① |
| `POST /meetups/{code}/profiles/{profileId}/session` | 누구나 | 다른 브라우저에서 자기 프로필 고르기 | ① |
| `PUT /meetups/{code}/profiles/me/taste` | 참여자 | 내 취향 수정 | ① |
| `POST /meetups/{code}/profiles/me/account` | 회원 | 비회원 프로필을 회원 프로필로 | ⑥ |
| `DELETE /meetups/{code}/profiles/{profileId}` | 모임장 | 프로필 지우기 | ① |
| `POST /meetups/{code}/calculations` | 모임장 | 추천받기(202) | ① |
| `POST /meetups/{code}/poll` | 모임장 | 투표 열기 | ② |
| `PUT /meetups/{code}/poll/votes/me` | 참여자 | 투표, 표 바꾸기 | ② |
| `POST /meetups/{code}/poll/close` | 모임장 | 마감 | ② |
| `POST /meetups/{code}/poll/reopen` | 모임장 | 투표 계속하기 | ② |
| `PUT /meetups/{code}/decision` | 모임장 | 정하기, 바꾸기 | ② |
| `DELETE /meetups/{code}/decision` | 모임장 | 정하기 취소 | ② |

### 요청

```
MeetupCreateRequest {
  area: { kind: "STATION" | "DONG", name: string }
      | { kind: "POINT", name?: string, lat: number, lng: number, radiusM: 500 | 1000 | 2000 | 5000 }   // POINT는 ④
  category?: "RESTAURANT" | "CAFE" | "BAR" | "ANY"   // 빼면 RESTAURANT
  date?: string            // "2026-11-14"
  time?: string            // "19:00". date가 있어야 한다
  headcount?: integer      // 2~8
  description?: string     // 100자까지. 공백뿐이면 없는 것으로 본다
}

ProfileCreateRequest {
  name: string             // 앞뒤 공백을 지운 값이 1~10자
  taste?: Taste
}

Taste {
  mood?: "QUIET" | "LIVELY" | "ANY"
  likeFoods?: ("KOREAN" | "JAPANESE" | "CHINESE" | "WESTERN" | "ASIAN")[]
  avoidFoods?: 같은 값의 목록
  noSpicy?: boolean
  priceCap?: integer    // 메뉴 하나 가격의 상한(원). 5,000~100,000. 메뉴 가격 질문이 보일 때만 받는다
  wantMenu?: string     // 먹고 싶은 메뉴(예: "곱창, 마라탕"). 앞뒤 공백을 지운 값이 20자까지. 음식 종류 질문이 보일 때만 받는다
}
```

`PATCH /meetups/{code}`는 `MeetupCreateRequest`와 같은 속성을 모두 선택으로 받는다. 빠진 속성은 그대로 두고 null인 속성은 비운다(AC-22). 투표 열기는 `{ placeIds: integer[], anonymous?: boolean }`, 투표와 정하기는 `{ placeId: integer }`다.

`POST /meetups`는 201과 `{ code, questions }`를 준다. `questions`는 스냅숏의 것과 같다. 지역 찾기(`GET /meetups/areas?q=`)는 `{ items: [{ kind: "STATION" | "DONG", name }] }`이고, 찾는 말은 앞뒤 공백을 지운 값이 1~20자, 결과는 10곳까지다. 모임 만들기의 역·동은 이 목록에 있어야 하고 없으면 400이다(D-27). 프로필 만들기는 201과 `{ profileId }`, 다른 브라우저에서 고르기·취향 수정·프로필 지우기는 204다. 만들기와 고르기의 응답은 모임 쿠키를 `Set-Cookie`로 준다(D-7). 409가 여럿이면 `already-joined`, `full`, `name-taken` 순서로 하나만 준다(D-28).

### 스냅숏

값이 없는 속성은 빠진다. 모양은 추천기 구현과 상관없이 같다(D-9).

```
MeetupSnapshot {
  phase: "WAITING" | "RESULT" | "VOTING" | "DECIDED"
  afterMeetup: boolean
  info: { area, category, date?, time?, headcount?, description?, hostNickname, expiresOn }   // expiresOn은 열 수 있는 마지막 날(KST)
  questions: { mood: boolean, food: boolean, spicy: boolean, price: boolean }
  me: { role: "HOST" | "PARTICIPANT" | "VIEWER", profileId?, signedIn: boolean, tasteReflected?: boolean, convertible?: boolean }
  allowed: string[]        // 지금 이 사람이 할 수 있는 동작
  profiles: [{ id, name, color, member: boolean, host: boolean, taste?: Taste, reflected: boolean }]   // taste는 지금 보이는 질문의 답만. reflected는 성공한 계산이 없으면 false
  pendingCount?: integer   // 인원을 정했고 남긴 수가 인원보다 적을 때만
  calculation?: { id, state: "RUNNING" | "SUCCEEDED" | "FAILED", startedAt, tasteCount, outdated: boolean }   // 가장 최근 계산
  resultCalculationId?: integer   // 마지막으로 성공한 계산. 결과는 이 id로 받는다
  poll?: {
    state: "OPEN" | "CLOSED", anonymous: boolean, tie: boolean, reopenable: boolean
    candidates: [{ placeId, votes: integer, voters?: integer[] }]   // voters는 이름이 보이는 투표에만
    votedCount: integer, notVotedCount: integer, notVoted?: integer[]   // notVoted는 이름이 보이는 투표에만
    hasVoted?: boolean, myVote?: integer
  }
  decision?: { placeId, method: "VOTE" | "PICK" | "DIRECT", tieVotes?: integer }
}
```

`allowed`의 값: `EDIT_INFO`, `EDIT_DATE`, `REMOVE_PROFILE`, `CALCULATE`, `OPEN_POLL`, `DECIDE`, `CLOSE_POLL`, `REOPEN_POLL`, `CHANGE_DECISION`, `CANCEL_DECISION`, `JOIN`, `EDIT_TASTE`, `VOTE`, `LINK_ACCOUNT`.

### 결과

```
MeetupResult {
  calculationId, calculatedAt, tasteCount
  applied: { mood?, likeFoods?, avoidFoods?, noSpicy?: boolean, priceCap?: integer, wantMenus?: string[] }    // 추천에 쓴 합친 취향. wantMenus는 해석한 메뉴 이름
  items: [{
    rank: integer
    place: PlaceSummary                 // 장소 API와 같은 타입
    openStatus?                         // 모임 시각 기준, 시각이 없으면 지금 기준
    score?: integer                     // 모임 점수 0~100. 점수를 매길 조건이 없으면 없다
    group: "ALL_FIT" | "SOME_MISFIT"
    fit: { kind: "ALL" | "COUNT" | "MOSTLY" | "MISFIT", fitProfileIds: integer[], misfitProfileIds?: integer[], missedMenus?: [{ profileId, menu }] }
    reasons: Reason[]                   // 최대 2개. 장소 카드와 같은 타입
    caution?: string
    menu?: { name: string, price?: integer }
    facilities?: { group?: boolean, reservation?: boolean }
    distance?: { station: string, walkMinutes: integer } | { meters: integer }
  }]
  emptyReason?: { cause: string, suggestion?: string, profileIds?: integer[] }
}
```

### 오류

| 상태 | `type` 또는 확장 필드 | 언제 |
|---|---|---|
| 400 | 없음 | 입력 형식과 범위 |
| 401 | 인증 모듈의 것 | 로그인이 필요한 경로에 로그인 없음 |
| 403 | 없음 | 모임장이 아님, 프로필이 없음, 남의 회원 프로필, CSRF |
| 404 | 없음 | 없는 코드(처음부터 없거나 닫혀서 지운 모임. 둘을 구분하지 않는다), 없는 프로필, 아직 성공한 계산이 없는 결과 |
| 409 | `urn:fitdining:meetup:name-taken` | 이미 있는 이름 |
| 409 | `urn:fitdining:meetup:full` | 프로필 8개 |
| 409 | `urn:fitdining:meetup:already-joined` | 이미 이 모임에 프로필이 있는 회원 |
| 409 | `urn:fitdining:meetup:host-profile` | 모임장 자신의 프로필 지우기 |
| 409 | `urn:fitdining:meetup:calculating` | 계산 중에 다시 추천받기 |
| 409 | `urn:fitdining:meetup:poll-closed` | 닫힌 투표에 투표 |
| 409 | `urn:fitdining:meetup:no-votes` | 표 없이 마감 |
| 409 | `urn:fitdining:meetup:phase` | 지금 상태에서 할 수 없는 동작. 확장 필드 `phase`에 지금 상태 |
| 429 | 없음 | 로그인 없는 쓰기 한도 |

### 추천기 포트

```
MeetupRecommender.recommend(input) → output      // BE 안의 인터페이스. 이름과 타입 모양은 재량이다

input:  지역(역·동 또는 지점과 반경), 업종, 날짜·시간, 저장한 해석 조건,
        참여자별 답(프로필 번호, 회원 id, Taste)
output: 장소별 { placeId, 모임 점수, 추천 이유, 덜 맞는 점, 참여자 취향 점수와 놓친 메뉴(프로필 번호별, 없을 수 있음),
                 근거 없는 항목이 있는지 }
        적용한 조건, 후보 없음 원인(프로필 번호)
```

장소 Mock 모드에서는 대신 쓰는 추천기가, DB 모드에서는 AI 추천기가 돈다. 고르는 스위치를 새로 두지 않는다(D-11).

### AI 계약

AI에 주소 두 개를 더한다. 기존 `POST /v1/search`는 바꾸지 않는다(D-12). JSON 이름은 camelCase이고, 모르는 요청 속성과 틀린 모양은 400이다. 값이 없는 속성은 넣지 않는다. 계약 문서(`ai/docs/comparison/api.md`)에 적는다.

**`POST {fitdining.ai.base-url}/v1/meetup/interpret`**: 모임 설명을 해석만 한다(D-14).

```
요청  { text: string }                       // 모임 설명. 1~100자
응답  { conditions: object                   // BE는 해석하지 않고 저장했다가 돌려보낸다
        summary: { mentionsFood: boolean }      // 설명에 음식 종류나 메뉴가 있는지
        interpretedBy: "LLM" | "RULE", fallbacks: string[] }
```

**`POST {fitdining.ai.base-url}/v1/meetup/search`**: 모임 계산 한 번(D-15).

```
요청  { conditions?: object                  // 저장한 해석. 없으면 설명이 빈 모임이다
        area: { kind: "STATION" | "DONG", name: string }             // 이름. 지금 검색의 지역 거르기를 그대로 쓴다
            | { kind: "CIRCLE", lat: number, lng: number, radiusM: 500 | 1000 | 2000 | 5000 }
        category?: "RESTAURANT" | "CAFE" | "BAR"       // 없으면 상관없음
        when?: { date: string, time?: string }          // "2026-11-14", "19:00"
        members: [{ key: string, userId?: string,
                    mood?: "QUIET" | "LIVELY", likeFoods?: string[], avoidFoods?: string[],
                    noSpicy?: boolean, menuPriceCapWon?: integer, wantMenu?: string }] }   // wantMenu는 적은 글 그대로

응답  { applied: { mood?, likeFoods?, avoidFoods?, noSpicy?, menuPriceCapWon?, wantMenus? }
        items: [{ placeId, score?, labels, reasons, caution?,
                  memberScores: [{ key, score?, unverified?: boolean, missedMenu?: string }] }]   // 20곳까지, 모임 점수 내림차순(점수가 없으면 AI가 정한 순서)
        emptyReason?: { cause, suggestion?, memberKeys?: string[] }
        fallbacks: string[] }
```

| 항목 | 지금의 `/v1/search` | 모임 계산의 의무 | AC |
|---|---|---|---|
| 요청문 | 필수, 매번 해석 | 저장한 `conditions`를 받아 모임 설명으로 LLM을 부르지 않는다. 없으면 업종 이름으로 후보를 뽑는다 | AC-47, AC-50, AC-57 |
| 지역 | 요청문이나 지도 범위 | `area`가 `conditions` 속 지역보다 앞선다. 역·동과 원형 반경을 받는다 | AC-50 |
| 업종 | 요청문에서 해석 | `category`가 `conditions` 속 업종보다 앞선다 | AC-50 |
| 시간 | 요일과 "몇 시까지"만, 브레이크 무시 | 그 시각에 영업하지 않는 곳, 브레이크타임, 1시간 안에 닫거나 쉬는 곳을 뺀다 | AC-51 |
| 못 먹는 음식 | 해석만 하고 거르지 않음 | 확인된 식당을 뺀다 | AC-52 |
| 메뉴 가격 | 요청문의 가격 표현으로 거름 | 참여자들의 상한 중 가장 낮은 값의 110%를 넘는 곳을 뺀다. 가게 가격을 모르면 남긴다 | AC-52 |
| 선호 음식 | 항목마다 따로 평균 | 모은 종류 중 가장 잘 맞는 하나로 센다 | AC-52 |
| 먹고 싶은 메뉴 | 요청문의 메뉴로 거른다 | 참여자들의 글을 계산 한 번에 모아 LLM으로 한 번 해석하고(실패하면 규칙), 메뉴판에 있는 곳을 올린다. 장소를 빼지 않는다 | AC-52 ~ AC-54 |
| 취향 | 한 사람 | 참여자들의 답과 회원의 평소 취향을 PRD FR-22 규칙으로 합친다 | AC-53 |
| 참여자 점수 | 없음 | 장소마다 참여자별 취향 점수 | AC-54 |
| 후보 없음 | 원인 문구 | 원인과, 참여자 조건이면 프로필 번호 | AC-55 |
| 틀린 취향 | 취향을 빼고 검색 | 400 | AC-55 |

`conditions`를 읽지 못하면 400과 `code` `CONDITIONS_INVALID`이고, 이전 버전의 `conditions`는 읽는다(D-14). AI 쪽은 지금 검색의 해석, 후보 뽑기, 거르기, 점수를 최대한 그대로 다시 쓰고 모임에 필요한 것만 더한다(D-13). 역·동은 이름으로 보내므로 다른 도시에 같은 이름의 동·구가 있으면 섞일 수 있다(D-15). `members[].key`는 프로필 번호다. 이름은 어디에도 싣지 않는다. 모임 계산 주소 안에서 LLM을 부르는 것은 먹고 싶은 메뉴 해석뿐이고, LLM에는 글만 보낸다(D-26). 메뉴 가격은 뷰의 가게 가격(`price`)으로 거른다. 지금은 모두 비어 있어 걸러지는 곳이 없다(D-17).

### 테이블

테이블은 네 개이고 마이그레이션 하나로 만든다(D-5). 번호는 병합 직전 develop의 가장 높은 번호 다음이다.

| 테이블 | 주요 컬럼 |
|---|---|
| `meetups` | `meetup_id`, `code`(유일), `host_user_id`, `phase`, `area_kind`, `area_name`, `point_lat`, `point_lng`, `radius_m`, `category`, `meet_date`, `meet_time`, `headcount`, `description`, `parsed_conditions`(jsonb), `poll_state`(없음, OPEN, CLOSED), `poll_anonymous`, `poll_place_ids`(bigint[]), `poll_tie_votes`(동점으로 마감했을 때의 표 수), `decided_place_id`, `decided_how`(VOTE, PICK, DIRECT), `decided_at`, `expires_at`, `info_updated_at` |
| `meetup_profiles` | `profile_id`, `meetup_id`, `name`, `color`, `user_id`, `mood`, `like_foods`, `avoid_foods`, `no_spicy`, `price_cap`, `want_menu`, `taste_updated_at`, `vote_place_id`, `vote_session_id`(비어 있을 수 있음, `ON DELETE SET NULL`). `(meetup_id, name)`, `(meetup_id, color)`, `(meetup_id, user_id)` 유일 |
| `meetup_profile_sessions` | `session_id`, `profile_id`, `token_hash`(유일) |
| `meetup_calculations` | `calc_id`, `meetup_id`, `state`, `started_at`, `finished_at`, `taste_count`, `profile_ids`, `result`(jsonb), `applied`(jsonb), `empty_reason`(jsonb). 모임당 RUNNING은 하나(부분 유일 인덱스) |

`parsed_conditions`에는 AI가 해석한 조건(그대로)과 요약을 둔다(D-14). 투표는 모임당 하나라 `meetups`에, 표는 프로필당 하나라 `meetup_profiles`에 둔다(D-5). `poll_state`는 한 번 열면 비우지 않는다. 마감할 때 동점이면 그 표 수를 `poll_tie_votes`에 고정한다. 표가 후보 안의 장소인지는 서비스가 확인한다(`poll_place_ids`가 배열이라 FK가 없다). `vote_session_id`는 회원이 로그인으로 던진 표면 비어 있고, 세션이 지워지면 비운다. 계산 행은 마지막 성공 하나와 그 뒤의 실행 중이거나 실패한 하나까지만 남는다. 측정만을 위한 칸(연 수, 걸린 시간, H3 값)은 없고, 닫을 때 남기는 것도 없다(D-6).

## Constraints

- 새 의존성을 더하지 않는다. (D-8, D-10)
- BE의 새 코드는 `kr.co.fitdining.api.meetup` 패키지에 두고, 웹 빈은 웹 서버로 뜰 때만 만든다. FE의 새 코드는 `fe/src/domains/meetup`과 `fe/src/app/m`에 둔다. (D-2, D-20)
- FE의 도메인끼리 import하지 않는다. place, auth, review와 만나는 곳은 `app`에서 조합한다. (D-20)
- 실시간 전송(SSE, WebSocket)을 쓰지 않는다. (D-10; PRD D-31)
- 새 외부 서비스를 부르지 않는다. 공유는 기기 공유 창과 링크 복사만 쓴다. (PRD D-10)
- AI에는 참여자 이름을 보내지 않고 프로필 번호만 보낸다. 이름은 결과에도 저장하지 않는다. 외부 LLM(GMS)으로 나가는 참여자의 답은 먹고 싶은 메뉴 글뿐이고 누가 적었는지는 싣지 않는다. (D-5, D-13, D-26)
- 기존 `/v1/search`의 요청과 응답은 바꾸지 않는다. 일반 검색의 동작은 그대로다. (D-12)
- 이미 적용된 마이그레이션 파일을 고치지 않는다. (D-5)
- 환경 변수 계약과 FE의 `/config.json`을 바꾸지 않는다. 기능을 켜고 끄는 스위치, 추천기를 고르는 스위치, 비밀값을 더하지 않는다. (D-7, D-11, D-24)
- 기준값은 코드 상수 한곳에 모으고 환경 변수로 빼지 않는다. (D-24; PRD OQ-29)
- 한글 줄바꿈(`break-keep`, `text-balance`, `text-pretty`)은 모임 화면의 최상위에만 건다. 기존 화면은 바뀌지 않는다. (PRD §7.4)
- BE는 취향을 합치거나 후보를 거르지 않는다. AI가 준 20곳의 순서만 순위 규칙으로 바꾼다. (D-13, D-18)

## Existing code

| Locator | Action | Obligation | Decision |
|---|---|---|---|
| `be/src/main/java/kr/co/fitdining/api/auth/infrastructure/SecurityConfiguration.java#securityFilterChain` | modify | 모임 공개 경로를 더하고, `no-store`를 더한다. CSRF는 S15P31A302-193이 모든 쓰기 요청에 걸어 따로 더하지 않는다. 다른 경로의 동작은 그대로다. 변경을 작게 둔다 | D-8 |
| `be/src/main/java/kr/co/fitdining/api/place/engine/AiSearchClient.java#AiSearchClient` | modify | 호출 뼈대(예산, 동시 호출 한도, 차단기, 로그 규칙)를 모임 전용 주소 두 개에도 쓸 수 있게 연다. 일반 검색의 동작은 그대로다. S15P31A302-201이 넣은 검색 목적은 그대로 둔다 | D-13 |
| `be/src/main/java/kr/co/fitdining/api/place/catalog/PlaceCatalog.java#PlaceCatalog` | modify | 모임 카드용 읽기(정한 시각의 영업 상태, 대표 메뉴와 가격, 단체·예약, 가까운 역과 도보 시간)와, 가게 가격이 채워졌는지 읽기(뷰 `ai_place_search`에 `price`가 있는 장소가 있는지)를 더한다. 장소가 있는 역·동 읽기(`areaNames`)도 더한다. 기존 기능은 그대로다. 장소 카탈로그는 DB 모드에만 있어 모임의 장소 포트(`MeetupPlaces`) 중 DB 모드 구현만 쓴다. S15P31A302-201의 `cardsWithin`은 DB 모드의 지점 확인에 다시 쓴다 | D-9, D-11, D-27 |
| `be/src/main/java/kr/co/fitdining/api/place/engine/PlaceSearchEngine.java#PlaceSearchEngine` | reuse | 장소 Mock 모드에서 모임의 장소 포트가 Mock 장소를 `placeIds`, `findPlace`로 읽는다. 대신 쓰는 추천기의 후보도 여기서 얻는다 | D-11, D-27 |
| `be/src/main/java/kr/co/fitdining/api/place/catalog/OpenStatusCalculator.java#openStatus` | reuse | 결과 카드의 영업 상태(모임 시각 기준) | D-9 |
| `be/src/main/java/kr/co/fitdining/api/place/dto/PlaceSummary.java#PlaceSummary` | reuse | 결과 카드의 장소 요약과 지점에서 직선거리 | D-9 |
| `be/src/main/java/kr/co/fitdining/api/user/UserService.java#withdraw` | modify | 탈퇴 트랜잭션에서 모임 정리를 부른다. 다른 정리의 순서와 동작은 그대로다 | D-23 |
| `be/src/main/java/kr/co/fitdining/api/onboarding/TasteAnalysisService.java#TasteAnalysisService` | reuse | 직접 만든 `ThreadPoolExecutor`로 작업을 돌리는 방식 | D-10 |
| `be/src/main/java/kr/co/fitdining/api/config/SchedulerLockConfiguration.java#SchedulerLockConfiguration` | reuse | 만료 예약 작업의 잠금 | D-23 |
| `ai/server/schemas.py`, `ai/server/search.py` | modify | 모임 전용 주소 두 개의 요청·응답과 라우트를 더한다. 기존 `/v1/search`는 그대로다 | D-12, D-15 |
| `ai/src/fit_ai/match/search.py`, `ai/src/fit_ai/match/scoring.py`, `ai/src/fit_ai/match/pg_store.py` | modify | 구조화된 지역·업종·시간·못 먹는 음식 거르기, 취향 합치기, 선호 음식 하나로 세기, 참여자 취향 점수, 설명이 빈 모임의 후보 뽑기. 지금 검색의 코드를 최대한 그대로 다시 쓴다. S15P31A302-196과 S15P31A302-200이 바꾼 지금 코드 위에 얹는다 | D-15 |
| `ai/src/fit_ai/match/interpretation/llm.py`, `ai/src/fit_ai/match/interpretation/rules.py` | modify | 참여자들의 먹고 싶은 메뉴 글을 한 번에 해석해 메뉴만 꺼내는 요청. 실패하거나 늦으면 규칙 해석으로 대신한다 | D-26 |
| `ai/docs/comparison/api.md` | modify | 모임 전용 주소 두 개의 계약을 적는다 | D-12 |
| `fe/src/shared/api/client.ts#request` | reuse | 모임 API 호출. 세션 쿠키, 모임 쿠키, CSRF 헤더가 여기서 실린다 | D-20 |
| `fe/src/app/login-return.ts#rememberLoginReturn` | reuse | 모임 화면에서 로그인한 뒤 돌아오기 | D-22 |
| `fe/src/domains/place/ui/search-screen.tsx#SearchScreen` | modify | 왼쪽 위에 시작 버튼 자리(슬롯)를 연다. 버튼은 `app`이 넣는다. 다른 동작은 그대로다 | D-22 |
| `fe/src/domains/place/ui/place-detail-screen.tsx#PlaceDetailScreen` | modify | 점수와 추천 이유를 밖에서 받을 수 있게 한다. 받지 않으면 지금처럼 검색 결과의 것을 쓴다 | D-22 |
| `fe/src/domains/place/ui/place-map.tsx#PlaceMap` | modify | 네이버 지도 스크립트 로더와 타입을 `fe/src/shared/lib`로 옮기고 거기서 가져다 쓴다. 지도의 동작은 그대로다 | D-20 |
| `fe/src/domains/place/ui/fit-score.tsx#FitScore`, `fe/src/domains/place/ui/place-parts.tsx` | reuse | 결과 카드의 핏 점수, 순위 배지, 영업 상태. `app`에서 조합한다 | D-20 |
| `fe/src/domains/review/model/review.ts#reviewWriteHref` | modify | 방문일 기본값을 주소로 넘길 수 있게 한다. 넘기지 않으면 지금과 같다 | D-22 |
| `fe/src/shared/ui/button/chip.tsx#Chip` | reuse | 업종과 질문지의 선택 칩 | D-20 |

새로 만드는 공용 코드는 `fe/src/shared/ui`의 스위치, 이니셜 아바타(8색, 모임장 왕관·회원 배지. 왕관 아이콘은 아이콘 모음 `fe/src/shared/ui/icon/icons`에 없어 새로 그린다), 인원 스테퍼(정하지 않음 포함), 앞으로의 날짜·시간 선택, 투표 막대와 `fe/src/shared/lib`의 공유(기기 공유 창, 안 되면 링크 복사), 네이버 지도 로더다(PRD §7.4).

## Seams & test plan

- BE 순수 규칙 (example), AC-1, AC-2, AC-4, AC-19, AC-20, AC-22, AC-40, AC-41, AC-49, AC-59, AC-64: 상태·역할별 허용 동작은 PRD §5.1 표를 그대로 표 테스트로 옮긴다. 삭제 시각과 열 수 있는 마지막 날은 고정 시계로 KST 자정 전후를, 순위 규칙은 묶음·동점·점수 없는 참여자를, 득표는 동점과 표 없음을, 보일 질문은 업종 넷, 해석 요약의 유무, 가게 가격의 유무와 숨겨진 질문의 답을 빼는 것을, 날짜 검증은 KST의 오늘과 지난 시각을, 모임 뒤 판정은 정한 곳과 모임 날짜 당일 0시(KST) 경계를, 거리는 지점에서 직선거리를 본다. 잡는 것: 표와 어긋난 권한, 하루 어긋난 삭제일, 덜 맞는 사람이 앞에 오는 순서.
- BE AI 추천기 (example, 가짜 HTTP 서버), AC-46 ~ AC-48, AC-56, AC-72: 두 주소의 요청 본문(프로필 번호만 있고 이름이 없는지, 저장한 조건, 상관없음이면 업종이 없는지, 지점 모임의 원형 반경, 날짜만 있을 때), 해석 저장과 다시 쓰기, 해석 실패 뒤 다음 계산 전 다시 해석, `CONDITIONS_INVALID` 뒤 같은 계산 안에서 다시 해석, 숨겨진 질문의 답이 요청에 없는지, 먹고 싶은 메뉴가 적은 글 그대로 실리는지, 예산 초과, 읽을 수 없는 응답, AI의 400이 실패가 되는지, 일반 검색과 한도를 함께 쓰는지를 본다. AI의 규칙 자체는 놓친다(아래 AI). Prior art: `be/src/test/java/kr/co/fitdining/api/place/engine/AiSearchClientTest.java`.
- BE 영속성 (example, Testcontainers PostgreSQL과 Redis), AC-5, AC-7, AC-9, AC-13, AC-15 ~ AC-18, AC-21, AC-23, AC-36 ~ AC-42, AC-58, AC-61 ~ AC-63, AC-68, AC-73, AC-74: 서비스를 직접 부른다. 같은 이름·8번째 프로필·계산 시작·투표 마감의 동시 요청, 따라 지우기, 대신 쓰는 추천기로 계산부터 결과까지, 멈춘 계산이 실패로 바뀌는지, 지점 확인의 장소 수와 이름, 닫은 뒤 그 모임의 행이 어디에도 없고 그 코드가 404인지, 탈퇴와 그 되돌림, 쓰기 한도(15분 120회), 마감 때 고정한 동점 표 수가 프로필을 지워도 바뀌지 않는지, 표의 세션이 지워지면 비는지, 실패한 계산 행이 하나만 남는지를 본다. Prior art: `be/src/test/java/kr/co/fitdining/api/review/ReviewPersistenceTest.java`, `be/src/test/java/kr/co/fitdining/api/support/RedisTestSupport.java`.
- BE 컨트롤러 (example, `@WebMvcTest`), AC-1, AC-3, AC-6, AC-8, AC-10, AC-14, AC-22, AC-23, AC-68, AC-37, AC-38, AC-71: 상태 코드와 `type`, 입력 검증(먹고 싶은 메뉴 20자 포함), 익명 투표 응답의 속성(열림, 동점, 마감 뒤), 값 없는 속성 생략, 로그에 이름·취향·설명 표식이 없는지를 본다(기존 표식 문자열 방식). Prior art: `be/src/test/java/kr/co/fitdining/api/review/ReviewControllerTest.java`.
- BE 보안 (example, 세션과 Redis를 띄운 HTTP), AC-9, AC-11, AC-12, AC-14, AC-24, AC-70: 공개 경로 목록, 모임 응답의 `no-store`, 회원 프로필을 가리키는 쿠키를 다른 로그인에서 무시하는 것, 날짜를 바꾼 뒤 쿠키를 새 만료로 다시 주는 것, 비회원 쓰기의 CSRF 403, 모임 쿠키로는 모임장 동작이 되지 않음을 본다. Prior art: `be/src/test/java/kr/co/fitdining/api/auth/SecurityHttpTests.java`.
- AI (example, pytest), AC-50 ~ AC-55, AC-57, AC-59: 해석 주소의 조건과 요약, 모임 계산의 규칙을 항목마다 본다. 구조화된 지역과 업종이 설명보다 앞서는지, 원형 반경, 시간 거르기(브레이크타임, 1시간 안에 닫거나 쉬는 곳, 날짜만, 자정 넘김, 모르는 값 남김), 못 먹는 음식, 메뉴 가격 상한(가장 낮은 값, 110%, 모르는 값 남김), 선호 음식 하나로 세기, 먹고 싶은 메뉴(계산 한 번에 한 번만 해석, 적은 사람이 없으면 부르지 않음, 실패하거나 늦으면 규칙, 메뉴만 쓰기, 장소를 빼지 않기, `missedMenu`), 매운 음식, 합치는 규칙, 참여자 점수, 설명이 빈 모임에서 업종 이름으로 후보를 뽑는 것, 후보 없음 원인, 점수를 매길 조건이 없을 때 점수를 빼는지, 이전 버전의 `conditions`와 읽지 못하는 `conditions`, 틀린 입력 400이다.
- FE 순수 로직 (example, Vitest), AC-28, AC-29, AC-34: 날짜 표기("11월 14일 (금) 저녁 7시", "11월 21일까지 열 수 있어요"), 취향 요약, 남기지 않은 수, 임시 보관, 공유 대체를 본다.
- FE 화면 (example, jsdom과 Testing Library), AC-25 ~ AC-27, AC-29 ~ AC-33, AC-35, AC-43 ~ AC-45, AC-64, AC-65, AC-67: 스냅숏과 API를 대역으로 두고 `allowed`에 따른 버튼, 홈 시작 버튼, 프로필 유무에 따른 첫 화면, 가격 질문의 칩과 직접 입력, 먹고 싶은 메뉴 칸, 회원 프로필을 고를 때 로그인 안내와 돌아오기, 아바타 배지와 그 이름(모임장, 회원), 정한 곳에서 친구들 취향으로 가기와 수정 전 안내, 모임 정보 "수정"의 자리와 `EDIT_DATE`만 있을 때 날짜·시간만 고치는 화면, 모임 점수가 없을 때의 카드, 원한 메뉴가 없는 덜 맞는 사람 줄과 메뉴 조건 칩, 404에서 없는 링크 화면, `questions`에 따른 질문, 결과 카드의 누르는 영역, 409 안내, 투표 화면의 표 수와 5초 다시 받기(가짜 시계), 모임 뒤 화면을 본다.
- 수동 (manual), AC-46, AC-50 ~ AC-54: AI의 두 주소가 배포된 환경에서 모임 하나를 만들기부터 결과까지 돌린다. 화면 예시의 네 명과 모의 계산의 세 모임(취향이 갈리는 4명 포함)으로 덜 맞는 사람 표시를 본다.
- 수동 (manual), AC-7, AC-60, AC-66, AC-69: 실기기의 메신저 안 브라우저에서 링크 열기, 미리보기, 모임 쿠키 유지, 로그인 복귀를 본다(PRD OQ-31). 카카오톡 안 브라우저의 구글 로그인은 2026-11-10에 기존 서비스로 확인했다. 폭 360px에서 화면 예시와 맞는지 본다. 환경 변수 계약과 `/config.json`에 바뀐 것이 없는지 본다.

## Out of scope

- 기존 `/v1/search`를 다시 써서 모임 계산을 하는 방식. (D-12)
- 뷰의 가게 가격(`price`) 채우기. 대표 메뉴 규칙으로 채우는 마이그레이션을 나중에 따로 한다. 채워지면 메뉴 가격 질문과 거르기가 코드 변경 없이 살아난다. (D-17; PRD OQ-28)
- 로그인 복귀를 OAuth state로 바꾸기. (D-22)
- 매운 메뉴 판정 사전 넓히기. (PRD OQ-37)
- 음식 종류를 고르면 세부 메뉴 칩을 펼쳐 고르기, 결과 뒤 메뉴로 투표하기. (D-26)
- 실시간 전송, 알림, 채팅, 일정 조율, 모임 목록과 재사용, 다른 서비스 연동 공유, 길찾기. (PRD §4)
- 처리방침 문구. (PRD OQ-30)
- 성공 지표 측정(PRD H3~H5, 설문). 측정만을 위한 칸, 집계, 조회를 두지 않는다. (D-6)

## Open questions

- AI 계약(주소 두 개, AC-50 ~ AC-55, AC-57)은 회의에서 이 스펙을 함께 보고 정한 뒤 AI 문서에 옮긴다. 회의 전이다. 설명이 빈 상관없음 모임에서 후보를 뽑는 낱말(시작값 "맛집")과 먹고 싶은 메뉴를 한 번에 해석하는 요청의 모양, 후보 없음 원인(`emptyReason.cause`)의 값 목록도 그때 정한다. 후보 없음 화면의 버튼은 이 값으로 고른다. (D-12, D-15, D-26)
- `GET /meetups/area-check`와 미리보기의 응답 모양은 구현 이슈에서 정한다. (D-9)
- 뷰의 가게 가격을 채우면 일반 검색의 가격 표현("3만원 이하")도 걸러지기 시작한다. AI의 검색 코드가 이미 가게 가격으로 거르게 돼 있다. PRD 본문 FR-08(예산 표현은 추천에 반영하지 않는다)과 어긋나므로 뷰를 고칠 때 검색 담당과 정한다. (D-17)
- 식당 중 음식 종류가 채워진 비율은 구현 전에 운영 DB에서 확인한다(DB 권한이 있는 팀원). 낮으면 음식 질문과 못 먹는 음식 거르기의 효과가 작다. (PRD OQ-27)
- 기준값(덜 맞는 사람 50, 프로필 8개, 모임 날짜 30일, 계산 예산 12초, 멈춘 계산 45초, 다시 받기 1초와 5초, 쓰기 한도 15분 120회, 가격 직접 입력 5,000~100,000원, 먹고 싶은 메뉴 20자와 가중치, 메뉴 해석을 기다리는 시간, 가격 판단 기억 10분, 작업 스레드 2·대기열 8)은 시작값이다. 코드 상수 한곳에서 바꾼다. (PRD OQ-29)
