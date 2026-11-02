# 장소 북마크 (bookmark)

Status: approved
Decisions: [decisions.md](decisions.md) · Glossary and ADRs: none

## Problem

로그인한 사용자는 마음에 든 장소를 저장해 두었다가 메인 화면에서 내가 저장한 장소만 모아 보고 싶다. 지금은 장소 상세의 "저장" 버튼, 메인의 "저장한 장소" 버튼, 내 정보의 "저장한 장소" 메뉴가 모두 "준비 중이에요" 토스트만 띄운다.

이 spec은 Jira S15P31A302-114 "사용자별 장소 북마크 추가"의 BE·FE를 다룬다. 완료 기준은 상세에서 저장·해제가 되고, 메인에서 내 저장 장소만 보이며, 다른 사용자 계정에서는 보이지 않는 것이다. 화면 글자의 "저장"이 북마크이고 "저장 해제"가 북마크 취소다. **저장한 장소 화면**은 별도 페이지가 아니라 메인 첫 화면의 지도와 하단 패널이 내가 저장한 장소만 보이도록 바뀐 상태이고, 주소는 `/?view=saved`다.

이번 반복(Jira S15P31A302-137 "북마크 장소 FK 추가")은 북마크가 실제 장소만 가리키게 한다. 지금 `bookmarks.place_id`에는 `places`로 가는 FK가 없어서, Mock 시절 번호로 저장된 행이 같은 번호의 다른 장소에 붙거나 장소가 지워진 뒤에도 남을 수 있다. 기존 북마크를 모두 지우고 FK를 건다(D-1, D-16, D-17).

## Assumptions

1. 장소 조회는 장소 기능의 `PlaceService.getPlace`가 맡는다. Mock 엔진(`mock/places.json`)과 DB 엔진(S15P31A302-115)이 있고 `PLACE_MOCK_ENABLED`로 고른다. 2026-11-02 기준 dev는 DB 모드이고 `places`에 300곳이 적재돼 있으며 북마크는 시험 데이터 1행이다. prod DB에는 아직 앱 테이블이 없다. Mock은 local 화면 작업에서만 쓴다(D-1, D-16, D-17).
2. `getPlace`의 응답(`PlaceDetailResponse`)에는 핏 점수와 추천 이유가 없고, 장소 요약(`PlaceSummary`), 주소, `tags`, 응답을 만들 때의 시각으로 계산한 `openStatus`가 있다. Mock의 `tags`는 고정 문구에서 지어낸 값이고 실데이터는 AI 쪽이 나중에 준다(D-13).
3. BE는 null 필드를 응답에서 생략한다(`default-property-inclusion: non_null`). 전역 ProblemDetail 처리는 없고 기능마다 예외 처리기를 둔다. 운영의 `Clock` 빈은 UTC다.
4. 인증은 무상태 JWT다. AT가 만료되면 BE가 401과 토큰 만료 `type`을 돌려주고, FE의 `withAccessToken`이 RT로 한 번 갱신해 다시 보낸다. 만료가 아닌 401은 그대로 던지고 앱의 로그인 정보를 지우지 않는다. 페이지를 새로 열면 FE가 RT로 AT를 다시 받는다(로그인 복원). RT 쿠키는 탭끼리 공유된다. 탈퇴는 `auth_users.deleted_at`을 채우는 soft delete이고 재가입은 새 사용자 id를 만든다(D-2, D-7, D-15).
5. 로그인 화면은 이미 로그인된 상태면 홈으로 보낸다. 이메일·소셜 로그인과 가입은 성공하면 같은 탭에서 결국 홈(`/`)에 도착한다(develop에서 가입은 `/location`을 거친다)(D-8).
6. 홈(`/`)은 로그인했거나 게스트("나중에 가입하기")인 사용자에게 메인을, 가입했다가 로그아웃한 비로그인 사용자에게 온보딩을 보인다. 이 동작은 바꾸지 않으므로 `/?view=saved`도 같은 사용자에게는 온보딩이고, 메인 "저장한 장소" 버튼의 비로그인 사용자는 게스트다.
7. 장소는 300곳 이하이고 업종(`CategoryGroup`)은 `RESTAURANT`, `CAFE`, `BAR` 셋이다(D-6, D-13).
8. 화면 기준은 사용자가 준 초기 와이어프레임의 `Saved`, `SavedFull`, `SavedEmpty`, `SavedError`, `SavedNetError`, `DetailSaved`, `DetailSaveFail`, `StartGuest` 화면이다. 저장소 밖에 있고, `fe/AGENTS.md`가 적은 경로(`../../design_fitdining_v1/`)가 아니라 작성 시점에는 사용자 PC의 `Desktop/핏다이닝 디자인 v1/project/`에 있다.

## Usage

1. **상세에서 저장**: 로그인한 사용자가 장소 상세(`/place?id=3`)를 열면 FE가 `GET /api/v1/me/bookmarks/3`으로 저장 여부를 받아 하단 막대의 북마크 버튼을 빈 북마크("저장")로 그린다. 누르면 `PUT /api/v1/me/bookmarks/3`이 나가는 동안 버튼이 눌리지 않고, 204를 받으면 채워진 북마크("저장 해제")가 되며 "저장했어요" 토스트가 뜬다. 다시 누르면 `DELETE`가 나가고 "저장을 해제했어요"가 뜬다.
2. **메인에서 저장한 장소 보기**: 로그인한 사용자가 메인 오른쪽 위 "저장한 장소" 버튼을 누르면 주소가 `/?view=saved`가 되고, FE가 `GET /api/v1/me/bookmarks`로 전체 목록을 받아 지도 핀과 하단 패널을 내가 저장한 장소만으로 바꾼다. 업종 탭 [카페]를 누르면 주소가 `/?view=saved&category=CAFE`가 되고 목록과 핀이 카페만 남는다. 카드를 누르면 `/place?id=3&from=saved`로 상세가 열리고, 브라우저 [뒤로]는 저장한 장소 화면으로, 한 번 더 [뒤로]는 들어오기 전 메인 화면으로 돌아간다.
3. **비로그인 사용자**: 상세의 북마크 버튼을 누르면 "로그인이 필요해요" 확인 창이 뜬다. [취소]는 아무 요청 없이 창만 닫는다. [로그인]을 고르면 로그인 화면으로 가고, 로그인을 마치면 그 장소 상세로 돌아와 버튼을 다시 누를 수 있다.

## Acceptance criteria

BE

- [x] AC-1: 북마크 API 네 개(내 목록, 저장 여부, 저장, 해제)는 `Authorization: Bearer` 토큰이 없거나 유효하지 않으면 401 ProblemDetail이고, 만료 토큰이면 401과 함께 인증 모듈의 토큰 만료 `type`(`urn:fitdining:auth:access-token-expired`)을 그대로 돌려준다. 사용자는 토큰에서만 정해지고 경로, 쿼리, 본문으로 지정할 수 없다(예: `?userId=` 같은 값은 무시된다). (D-2, D-4)
- [x] AC-2: 탈퇴한 사용자(`deleted_at`이 있음)는 토큰이 유효해도 네 API 모두 401 ProblemDetail이다. 이 판정은 장소 확인보다 먼저라, 장소가 없거나 장소 엔진이 없어도 탈퇴한 사용자는 404/503이 아니라 401을 받는다. (D-2, D-3, D-15)
- [x] AC-3: 장소 id를 받는 세 API(저장 여부, 저장, 해제)는 경로의 `placeId`가 양의 정수가 아니면(숫자로 변환되지 않음, 0 이하, `long` 범위 밖) 토큰과 상관없이 400 ProblemDetail이다. 리뷰 API처럼 이 검사는 인증보다 먼저이고, AC-1과 AC-2의 401은 `placeId`가 올바른 요청에 대한 것이다. 숫자 변환 규칙은 기존 장소·리뷰 API의 경로 변수와 같다. (D-1)
- [x] AC-4: 저장하지 않은 장소를 `PUT`하면 장소가 있을 때 204이고 행 하나가 생기며 저장 시각은 서버에 주입된 시계의 값이다. 장소가 없으면 404, 장소 엔진이 없으면 503 ProblemDetail이고 행이 생기지 않는다. (D-1, D-3)
- [x] AC-5: 이미 저장한 장소를 `PUT`하면 장소 엔진을 부르지 않고 204이며(엔진이 없거나 장소가 지금 404여도), 저장 시각과 목록 순서가 바뀌지 않는다. 다른 탭에서 `PUT`과 `DELETE`가 거의 동시에 오면 나중에 커밋된 쪽이 남는다. (D-3)
- [x] AC-6: 같은 사용자가 같은 장소를 동시에 여러 번 `PUT`해도 모두 204이고 행은 하나다. 저장 시각은 먼저 커밋된 삽입의 값이고 나머지 요청은 그 값을 바꾸지 않는다. (D-2, D-3)
- [x] AC-7: `DELETE`는 저장한 장소면 행을 지우고 204, 저장하지 않은 장소여도 204다. 장소 엔진을 부르지 않아 엔진이 없어도 204다. (D-3)
- [x] AC-8: 저장 여부 API는 북마크 테이블만 보고 `{"bookmarked": true|false}`를 돌려주며 장소 엔진을 부르지 않는다. (D-4, D-5)
- [x] AC-9: 두 사용자 A, B가 어떤 순서로 저장·해제하더라도 B의 목록과 저장 여부에는 B가 저장한 것만 반영되고, A의 요청은 B의 행을 만들거나 지우지 않는다. (D-2)
- [x] AC-10: 내 목록은 저장 시각 최신순, 같은 시각이면 장소 id 내림차순으로 전체를 한 번에 돌려준다(개수 상한과 페이징 없음). 해제한 뒤 다시 저장한 장소는 새 저장 시각으로 맨 앞에 온다. 응답 JSON은 Interfaces의 `BookmarkItem` 키만 담고(핏 점수와 추천 이유 없음), `savedAt`은 시계가 UTC여도 `+09:00` 오프셋 ISO-8601이다. (D-2, D-6, D-13)
- [x] AC-11: 내 목록을 만들 때 장소 조회가 404인 북마크는 목록에서 빠지고 행은 남는다. 그 밖의 장소 조회 실패가 하나라도 있으면 일부 목록을 돌려주지 않고 목록 전체가 5xx ProblemDetail이다(엔진 없음은 503, 예상하지 못한 오류는 500). 저장한 장소가 없으면 장소 엔진을 부르지 않고 `[]`다. (D-2, D-14)
- [x] AC-12: 새 마이그레이션 하나가 Interfaces의 `bookmarks` 테이블을 만든다. 버전은 develop에 합칠 때 비어 있는 다음 번호다(작성 시점 develop의 마지막은 V7이고, 리뷰 사진·신고 브랜치 S15P31A302-54가 V8·V9를 쓴다). 회원 탈퇴(`DELETE /api/v1/users/{userId}`)는 그 사용자의 북마크 행을 지우지 않는다. (D-1, D-15)

FE: 장소 상세의 북마크 버튼

- [x] AC-13: 로그인한 사용자의 북마크 버튼은 로그인 여부나 저장 여부를 확인하는 동안 눌리지 않는(`disabled`) 확인 중 표시이고(접근 이름 "저장 상태 확인 중", `aria-pressed` 없음, 북마크 아이콘 아님), 결과가 true면 채워진 북마크(접근 이름 "저장 해제", `aria-pressed="true"`), false면 빈 북마크("저장", `aria-pressed="false"`)다. 확인에 실패하면 북마크 아이콘이 아닌 다시 시도 표시(접근 이름 "저장 상태 다시 확인", `aria-pressed` 없음)이고, 누르면 쓰기 없이 저장 여부를 다시 확인한다. (D-2, D-5)
- [x] AC-14: 저장·해제 요청이 나가면 응답이 올 때까지 버튼은 그대로이고 눌리지 않는다. 204면 버튼이 바뀌고 "저장했어요" / "저장을 해제했어요" 토스트가 뜬다. 4xx(401은 AC-17)면 "저장하지 못했어요. 다시 시도해 주세요." / "저장을 해제하지 못했어요. 다시 시도해 주세요." 토스트가 뜨고 버튼은 누르기 전 상태다. 5xx면 같은 실패 토스트가 뜨고 저장 여부를 다시 조회해 그 결과로 보인다(다시 조회가 실패하면 AC-13의 확인 실패 표시). 시간 초과나 연결 끊김이면 버튼을 확정하지 않고 저장 여부를 다시 조회해 그 결과로 보이고(토스트 없음), 다시 조회도 실패하면 AC-13의 확인 실패 표시가 되며 "인터넷 연결을 확인하고 다시 시도해 주세요." 토스트가 뜬다. 토스트는 지금의 공통 토스트다. (D-2, D-5)
- [x] AC-15: 오프라인이면 북마크 조회와 쓰기는 연결을 기다리며 멈추지 않고 바로 연결 끊김으로 끝나며(AC-14, AC-25), 연결이 돌아와도 저절로 다시 나가지 않는다. 북마크 조회는 자동 재시도 없이 실패를 보인다. 쓰기는 누른 계정의 토큰으로만 나간다: 실제로 보내는 순간(RT 갱신 뒤 포함) 토큰의 사용자가 누른 사용자와 다르거나 로그인 정보가 없으면 보내지 않는다(다른 탭에서의 로그인·로그아웃 포함). 로그아웃하거나 다른 계정으로 바뀌면 아직 끝나지 않은 요청의 결과는 버려지고, 이전 계정의 저장 여부·목록 캐시와 늦게 온 응답은 새 계정 화면에 나오지 않는다. (D-2, D-3)
- [x] AC-16: 저장·해제가 성공하면 같은 사용자의 그 장소 저장 여부와 내 목록 캐시가 함께 맞춰진다. 장소 상세 API와 FE의 장소 상세 데이터는 바뀌지 않는다. (D-5, D-13)

FE: 비로그인과 로그인 뒤 복귀

- [x] AC-17: 북마크 요청이 RT 갱신을 거쳐도 401로 끝나면(갱신 실패, 탈퇴한 계정, 무효 토큰) 세션이 끝난 것으로 보고, 실패 토스트 없이 인증 모듈의 `clearSession()`으로 앱의 로그인 정보를 지우며 북마크 버튼을 비로그인 모양으로 둔다. 공통 확인 창(제목 "로그인이 필요해요", [취소]·[로그인])은 다음 경우에 뜬다: 비로그인 사용자가 상세 북마크 버튼이나 메인 "저장한 장소" 버튼을 누를 때, 누른 저장·해제나 그 뒤 다시 조회가 401로 끝날 때, 비로그인 상태로 저장한 장소 화면에 들어오거나 그 화면의 목록 요청이 401로 끝날 때. 상세를 열 때 저절로 나간 저장 여부 조회가 401이면 창 없이 버튼만 바뀐다. 설명은 상세 북마크 버튼에서 "장소 저장은 로그인해야 이용할 수 있어요.", 메인 "저장한 장소" 버튼과 저장한 장소 화면에서 "저장한 장소는 로그인해야 볼 수 있어요."다. [취소]는 창만 닫고 다른 요청을 보내지 않으며, 저장한 장소 화면에서 뜬 창이면 그 화면의 [뒤로]와 같다(AC-20). [로그인]은 로그인 화면(`/login`)으로 가고, 로그인 정보가 지워졌으므로 로그인 화면이 입력 칸을 보인다. 비로그인 사용자에게는 저장 여부와 목록 API를 부르지 않고, 상세 북마크 버튼은 빈 북마크("저장", `aria-pressed="false"`)이며, 저장한 장소 화면은 안내 창 뒤에 지도와 제목만 있는 패널을 보인다. 페이지를 열 때 로그인 복원이 응답 없이 실패하거나 3초 안에 끝나지 않으면 지금 앱처럼 비로그인으로 보이고, 그 뒤 복원이 성공하면 로그인한 사용자의 화면으로 다시 그린다. (D-7)
- [x] AC-18: 로그인 안내에서 [로그인]을 고르면 돌아올 주소가 그 탭의 sessionStorage에 남는다. 상세에서 눌렀으면 그 장소 상세 주소(`/place?id=…`, `from=saved`가 있었으면 포함), 메인 "저장한 장소" 버튼이나 저장한 장소 화면에서 눌렀으면 `/?view=saved`(고른 탭이 있으면 포함)다. 쿼리 없는 홈(`/`)에 도착하면 남은 주소를 한 번 읽어 지우고, 로그인된 상태이며 남긴 지 10분이 지나지 않았고 같은 출처로 해석되는 경로일 때만 그 화면으로 `replace` 이동한다. 이메일·소셜 로그인과 가입 모두 같다. 로그인 없이 홈에 왔으면(로그인 화면을 닫음 등) 주소를 버린다. 누르려던 저장·해제는 실행되지 않는다. 로그인 화면, 가입 화면, 인증 BE는 바뀌지 않는다. (D-8)

FE: 저장한 장소 화면

- [x] AC-19: 로그인한 사용자가 메인 "저장한 장소" 버튼을 누르면 주소가 `/?view=saved`가 되며(브라우저 기록에 한 칸 쌓임) 메인의 지도와 하단 패널(중간·전체 높이, 전체 높이에서 [지도 보기])이 저장한 장소 화면이 된다. 이 주소로 직접 들어와도(새로고침, 로그인 뒤 복귀, 내 정보 메뉴) 같은 화면이다(메인을 보는 사용자 기준, Assumptions 6). 화면 위에는 [뒤로]와 기존 "내 위치" 버튼만 있고 검색창과 오른쪽 위 "저장한 장소"·"내 정보" 버튼은 보이지 않는다. 지도 핀은 순위 숫자 없는 북마크 모양이고 내 목록의 장소만 있으며, 주변 추천·검색 결과의 핀과 카드는 보이지 않는다. 진행 중이던 검색은 뒤에서 마저 끝나고, 그 결과가 도착해도 저장한 장소 화면은 바뀌지 않는다. 핀을 누르면 검색 결과 핀과 같은 방식으로 그 장소 카드를 가리키되, 밑에 있는 메인 화면의 선택은 바꾸지 않는다. (D-2, D-12)
- [x] AC-20: 저장한 장소 화면의 [뒤로]는 앱 안에서 들어왔으면 브라우저 뒤로 가기와 같다. 메인에서 들어왔으면 들어오기 전 메인 화면(주변 추천, 검색 결과, 지난 결과, 요청 기록 패널 중 그때의 화면과 패널 상태. 그사이 끝난 검색이 있으면 그 결과)으로, 내 정보에서 들어왔으면 내 정보로 돌아간다. 앱 안에서 들어온 것이 아니면(로그인 뒤 복귀, 주소 직접 입력, 외부 링크) 메인 기본 화면으로 `replace` 이동한다. 저장한 장소 화면을 연 것은 최근 검색과 요청 기록에 남지 않는다. (D-9, D-12)
- [x] AC-21: 저장한 장소 화면에 들어올 때마다(상세에서 돌아올 때 포함) 목록을 새로 받고, 받는 동안 패널에 로딩 표시를 하며 이전 목록을 보이지 않는다. (D-2, D-13)
- [x] AC-22: 패널 머리는 "저장한 장소"와 지금 보이는 개수다. 카드는 응답 순서대로 썸네일, 이름, 업종, "영업 상태 · 거리 · 주소" 줄, 태그 앞 2개를 보인다. 영업 상태가 `UNKNOWN`이면 빼고, 위치를 모르면 거리를 빼며, 주소가 없으면 빼고, 빠진 값의 구분자 " · "도 함께 뺀다. 태그가 없으면 태그 줄을 그리지 않는다. 핏 점수와 추천 이유, 정렬 선택은 없다. 카드를 한 번 누르면 `/place?id=…&from=saved`로 장소 상세가 열린다. (D-2, D-6, D-12, D-13)
- [x] AC-23: 저장한 장소가 1개 이상이면 업종 탭 [전체·식당·카페·술집]이 항상 보인다. 탭 목록과 이름은 업종 이름표 한 곳에서 만들어져 이름표에 업종을 더하면 탭도 는다. 탭을 고르면 주소의 `category`가 바뀌고(기록을 쌓지 않음) 목록, 지도 핀, 개수가 그 업종만으로 바뀐다. 고른 업종에 저장한 장소가 없으면 버튼 없이 "저장한 {업종 이름}이/가 없어요"(받침에 맞는 조사, 예: "저장한 식당이 없어요", "저장한 카페가 없어요")를 보인다. 새로고침해도 고른 탭이 유지된다. (D-12, D-13, D-14)
- [x] AC-24: 저장한 장소가 0개면 지도와 [뒤로]·"내 위치" 버튼은 그대로이고 핀이 없으며, 패널에는 제목 "저장한 장소"만(개수와 탭 없음) 두고 "아직 저장한 장소가 없어요" / "장소 상세에서 저장 버튼을 누르면 여기에 모여요." / [추천 받으러 가기]를 보인다. [추천 받으러 가기]는 보던 검색 결과를 닫고(최근 검색 기록은 남김) 메인 기본 화면(주변 추천, `/`)으로 `replace` 이동한다. (D-14)
- [x] AC-25: 목록 요청이 서버 오류(5xx), 시간 초과, 401이 아닌 4xx로 끝나면 같은 패널 자리에 제목 "저장한 장소"와 "저장한 장소를 불러오지 못했어요" / "잠시 후 다시 시도해 주세요." / [다시 시도]를 보인다. 연결 실패면 지도 없이 전체 페이지로 [뒤로], 제목 "저장한 장소", "인터넷에 연결되어 있지 않아요" / "연결을 확인하고 다시 시도해 주세요." / [다시 시도]를 보인다. [다시 시도]는 목록을 다시 요청한다. 어느 실패도 빈 상태나 이전 목록으로 보이지 않는다. 401은 AC-17이다. (D-2, D-14)
- [x] AC-26: `from=saved`로 연 장소 상세는 같은 세션에 그 장소의 검색 카드가 있어도 핏 점수와 추천 이유를 보이지 않고, 북마크 버튼은 저장 여부 API의 결과로 보인다. 상세의 [뒤로]로 돌아오면 저장한 장소 화면의 고른 업종 탭과 패널 높이가 그대로이고, 상세에서 해제한 장소는 목록과 핀에서 빠져 있다. 목록 카드에는 해제 버튼이 없다. (D-2, D-12)
- [x] AC-27: 내 정보의 "저장한 장소" 메뉴는 `/?view=saved`로 같은 저장한 장소 화면을 열고, 그 화면의 [뒤로]는 내 정보로 돌아간다. 내 정보의 다른 메뉴 동작은 바뀌지 않는다. (D-9)
- [x] AC-28: 이 기능이 place-search AC-35("저장한 장소" 버튼 토스트)와 AC-40(상세 "저장" 토스트)의 저장 부분을 대체한다. 상세 "공유" 버튼의 "준비 중이에요" 토스트와 메인 "내 정보" 버튼은 그대로다. (D-10)

수동 확인

- [x] AC-29: 두 계정 A, B로 local에서 직접 확인한다. A가 저장한 장소가 B의 저장한 장소 화면과 상세 버튼에 보이지 않는다. 같은 브라우저에서 A로 저장한 장소 화면을 본 뒤 로그아웃하고 B로 로그인하면 A의 목록과 저장 상태가 보이지 않는다. 게스트로 상세에서 저장을 눌러 로그인하면 그 상세로, 메인 "저장한 장소" 버튼에서 눌러 로그인하면 저장한 장소 화면으로 돌아온다(이메일 로그인으로 확인하고, 같은 복귀 경로인 소셜 로그인은 직접 확인하지 않는다, D-11). 저장한 장소 화면 → 상세 → 브라우저 [뒤로]가 저장한 장소 화면(탭·패널 유지)으로, 다시 [뒤로]가 들어오기 전 화면으로 온다. 화면을 Assumptions 8의 와이어프레임과 비교해 배치, 문구, 흐름이 같다. 간격과 다음은 달라도 된다: 정렬 드롭다운 없음(D-6), 공통 토스트 모양(D-5), 영업 상태 글자와 주소는 지금 데이터와 기존 라벨 그대로, "내 위치" 버튼은 기존 메인 버튼 그대로. 와이어프레임이 있는 사람이 확인한다. (D-2, D-11)

장소 FK (S15P31A302-137)

- [x] AC-30: 장소 확인을 통과한 뒤 저장할 때 `places`에 그 장소 행이 없어 장소 FK에 걸리면 404 ProblemDetail이고 행이 생기지 않는다(500이 아니다). (D-1, D-2)
- [x] AC-31: 새 마이그레이션 하나가 기존 `bookmarks` 행을 장소가 있든 없든 모두 지운 뒤 `place_id` → `places(place_id)` FK `fk_bookmarks_place_id`를 `ON DELETE CASCADE`로 건다. 적용 뒤 `places`에 없는 `place_id`는 거부되고, 장소를 지우면 그 장소의 북마크만 지워지며 다른 장소의 북마크는 남는다. 기본키, 사용자 FK, 양수 CHECK는 그대로다. 버전은 develop에 합칠 때 비어 있는 다음 번호다(작성 시점 V14). (D-2, D-16)

## Interfaces

API (모두 `Authorization: Bearer <AT>` 필요, 오류는 ProblemDetail)

| 메서드 | 경로 | 성공 | 오류 |
|---|---|---|---|
| GET | `/api/v1/me/bookmarks` | 200 `BookmarkItem[]` | 401, 5xx(엔진 없음 503) |
| GET | `/api/v1/me/bookmarks/{placeId}` | 200 `{"bookmarked": boolean}` | 400, 401 |
| PUT | `/api/v1/me/bookmarks/{placeId}` | 204 | 400, 401, 404, 503 |
| DELETE | `/api/v1/me/bookmarks/{placeId}` | 204 | 400, 401 |

```ts
// GET /api/v1/me/bookmarks 응답의 항목. null인 필드는 키가 빠진다(Assumptions 3)
type BookmarkItem = {
  place: PlaceSummary;      // 장소 상세 응답의 place와 같은 모양 (id, name, categoryGroup, station, lat, lng, thumbnailUrl?)
  address?: string;         // 장소 상세의 address. 없으면 키가 빠진다
  tags: string[];           // 장소 상세의 tags. 없으면 []
  openStatus: "OPEN" | "CLOSING_SOON" | "BREAK" | "CLOSED" | "UNKNOWN"; // 응답을 만들 때 항목마다 계산
  savedAt: string;          // 저장 시각, +09:00 오프셋 ISO-8601 (리뷰 createdAt과 같은 형식)
};
```

FE 주소

| 주소 | 화면 |
|---|---|
| `/?view=saved` | 저장한 장소 화면(전체 탭) |
| `/?view=saved&category=RESTAURANT\|CAFE\|BAR` | 저장한 장소 화면(그 업종 탭) |
| `/place?id=<placeId>&from=saved` | 저장한 장소 화면에서 연 장소 상세(핏 점수와 추천 이유 숨김) |

저장 형태 (테이블은 AC-12, 장소 FK는 AC-31)

```sql
CREATE TABLE bookmarks (
    user_id    text        NOT NULL CONSTRAINT fk_bookmarks_user_id REFERENCES auth_users(id),
    place_id   bigint      NOT NULL CONSTRAINT ck_bookmarks_place_id CHECK (place_id > 0),
                           -- AC-31: CONSTRAINT fk_bookmarks_place_id REFERENCES places(place_id) ON DELETE CASCADE
    created_at timestamptz NOT NULL,
    CONSTRAINT pk_bookmarks PRIMARY KEY (user_id, place_id)
);
```

- `created_at`이 저장 시각(API의 `savedAt`)이다. 삭제 시각 컬럼은 없다(D-15).
- `places`로 가는 FK `fk_bookmarks_place_id`(`ON DELETE CASCADE`)는 AC-31의 마이그레이션이 기존 행을 모두 지운 뒤 더한다. 이 마이그레이션은 prod를 사용자에게 열기 전에 나가야 한다(D-2의 10, D-16).

## Constraints

- 북마크의 장소 정보와 존재 확인은 장소 기능의 `PlaceService`를 거치고 `places` 테이블을 직접 읽지 않는다. (D-1, D-13)
- 사용자는 `AuthUseCases.authenticate`로 Bearer 토큰에서 얻고, 모든 북마크 API에서 탈퇴하지 않은 사용자인지 장소 확인보다 먼저 확인한다(확인하는 계층은 구현이 정한다). 북마크 예외 처리기는 북마크 컨트롤러에만 걸리고 `AuthFailure`의 상태와 `type`, 경로 변수 오류의 400, 장소 예외의 404/503, 처리되지 않은 예외의 500을 ProblemDetail로 바꾼다. Spring이 원래 4xx로 처리하는 요청 오류는 4xx로 둔다. 장소·리뷰 예외 처리기가 걸리지 않게 북마크 코드는 `api.place`, `api.review` 패키지 밖에 둔다. 북마크 컨트롤러는 리뷰 컨트롤러처럼 웹 애플리케이션일 때만 뜬다(`migrate` 프로필 기동). (D-4)
- 저장은 `INSERT … ON CONFLICT DO NOTHING`으로 하고 저장 시각은 주입한 `Clock`에서 얻는다. 리뷰의 `saveAndFlush` 뒤 제약 이름으로 나누는 방식을 쓰지 않는다. 다만 장소 FK 위반은 제약 이름 `fk_bookmarks_place_id`로 알아보고 없는 장소(404)로 바꾼다. (D-1, D-3)
- 마이그레이션은 새 파일 하나로 더하고 기존 마이그레이션은 고치지 않는다. 탈퇴 처리(`UserService.withdraw`)는 바꾸지 않는다. (D-15, D-16)
- FE의 place 도메인은 auth 도메인을 직접 import하지 않고, 인증이 필요한 호출과 세션 상태는 app 계층이 이어 준다(지금 FE 의존 방향 규칙). 서버 상태는 지금 FE 관례대로 공통 API 클라이언트와 TanStack Query로 다룬다. (D-5)
- 공통 토스트, 공통 확인 창, 로그인 화면, 가입 화면, 인증 BE, 인증 FE 모듈(`auth-client`, `withAccessToken`)은 고치지 않는다. 계정 확인과 세션 정리는 app 계층에서 기존 함수(`withAccessToken`, `getSession`, `clearSession`)를 써서 하고, 로그인 뒤 복귀는 FE의 sessionStorage와 홈 도착 처리로만 한다. (D-3, D-5, D-7, D-8)
- place 기능 문서(place-search, place-catalog, place-ai-search)는 이번 반복에서 사실을 지금 코드에 맞추는 것만 고치고 결정은 바꾸지 않는다. place-lookup-db 문서는 고치지 않는다. (D-10)

## Existing code

| Locator | Action | Obligation | Decision |
|---|---|---|---|
| `be/src/main/java/kr/co/fitdining/api/place/PlaceService.java#getPlace` | reuse | 새 장소 저장 전 존재 확인(404/503)과 목록 항목의 장소 정보 | D-1, D-13 |
| `be/src/main/java/kr/co/fitdining/api/auth/ports/AuthUseCases.java#authenticate` | reuse | Bearer 토큰에서 사용자 확인 | D-4 |
| `be/src/main/java/kr/co/fitdining/api/auth/repository/AuthUserRepository.java#existsByIdAndDeletedAtIsNull` | reuse | 탈퇴한 사용자를 401로 막는 확인 | D-2 |
| `fe/src/domains/auth/api/with-access-token.ts#withAccessToken` | reuse | 북마크 요청에 AT를 붙이고 만료 시 RT로 한 번 갱신해 다시 보냄. app 계층에서 감싸 보내는 순간의 사용자를 누른 사용자와 비교한다(AC-15) | D-3, D-5 |
| `fe/src/domains/auth/api/auth-client.ts#clearSession` | reuse | 세션이 끝난 401에서 앱의 로그인 정보를 지움 | D-7 |
| `fe/src/shared/ui/overlay/confirm-dialog.tsx#ConfirmDialog` | reuse | 로그인 안내 창 | D-7 |
| `fe/src/domains/place/model/place-labels.ts#CATEGORY_LABELS` | reuse | 업종 탭 목록과 이름 | D-13 |
| `fe/src/domains/place/ui/place-detail-screen.tsx#PlaceDetailScreen` | modify | 하단 막대 북마크 버튼의 "준비 중" 토스트를 저장·해제와 로그인 안내로 바꾸고, `from=saved`면 핏 점수와 추천 이유를 숨긴다. 공유 버튼은 그대로 | D-5, D-7, D-10, D-12 |
| `fe/src/app/place/place-detail-with-reviews.tsx#PlaceDetailWithReviews` | modify | 장소 상세에 북마크의 인증 호출과 세션 상태를 이어 준다(app 계층) | D-5 |
| `fe/src/domains/place/ui/search-screen.tsx#SearchScreen` | modify | "저장한 장소" 버튼의 "준비 중" 토스트를 저장한 장소 화면과 로그인 안내로 바꾸고, 메인에 `/?view=saved` 상태를 더한다 | D-7, D-12 |
| `fe/src/app/home-entry.tsx#HomeEntry` | modify | 메인에 북마크의 인증 호출과 세션 상태를 이어 주고, 홈 도착 때 sessionStorage에 남은 주소로 한 번 보낸다. 온보딩 게이트는 그대로 | D-8, D-12 |
| `fe/src/app/my/page.tsx#MyPage` | modify | "저장한 장소" 메뉴의 토스트만 `/?view=saved` 열기로 바꾼다 | D-9 |
| `be/src/main/java/kr/co/fitdining/api/bookmark/BookmarkService.java#save` | modify | 저장 중 장소 FK 위반을 `PlaceNotFoundException`(404)으로 바꾼다. 그 밖의 동작은 그대로 | D-1 |
| `be/src/test/java/kr/co/fitdining/api/bookmark/BookmarkPersistenceTest.java#BookmarkPersistenceTest` | modify | 장소 FK가 요구하는 시험 장소 행을 넣는다. 확인하는 성질은 줄이지 않는다 | D-16 |

## Seams & test plan

- BE 서비스·영속성 (example), AC-2, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12, AC-30, AC-31(FK 정의와 장소 삭제): Spring Boot 테스트에서 실제 PostgreSQL(Testcontainers)과 마이그레이션 위에 북마크 서비스를 직접 부른다. 시계는 고정·이동 가능한 UTC `Clock`, 장소 조회는 Mock 엔진 또는 `PlaceService` 대역(없는 장소, 엔진 없음, 예상 못 한 예외, 호출 횟수)을 쓴다. 동시 `PUT`은 여러 스레드로 같은 키를 넣고 행 수와 이후 시각 불변을 본다. `savedAt`의 `+09:00` 변환을 서비스 결과에서 본다. AC-12는 탈퇴 처리를 부른 뒤 행이 남는지 본다. 잡는 것: 유일성, 저장 시각 유지, 정렬, 격리, 탈퇴 판정 순서, 404 빼기, 엔진 미호출. 놓치는 것: HTTP 상태와 JSON 키. Prior art: `be/src/test/java/kr/co/fitdining/api/review/ReviewPersistenceTest.java`, `support/PostgresTestSupport`.
- BE 마이그레이션 (example), AC-31(기존 행 삭제): 같은 컨테이너에 따로 만든 DB를 V13까지 올리고 장소가 있는 행과 없는 행을 넣은 뒤 나머지를 적용해, 행이 모두 지워지고 없는 장소가 거부되는지 본다. 잡는 것: 기존 행을 남기거나 일부만 지우는 마이그레이션. Prior art: `support/PostgresTestSupport`.
- BE 컨트롤러 (example), AC-1, AC-2, AC-3, AC-4, AC-7, AC-10, AC-11: `@WebMvcTest`로 북마크 컨트롤러에 서비스와 `AuthUseCases`를 대역으로 넣어 상태 코드, ProblemDetail, 만료 `type`, 400 경로와 인증보다 먼저인 순서, `?userId=` 무시, 응답 JSON 키와 null 키 생략, 서비스 예외의 503·500을 본다. 놓치는 것: DB 동작과 엔진 호출 여부. Prior art: `ReviewControllerTest`.
- FE 상세 북마크 버튼 (example, jsdom), AC-13, AC-14, AC-15, AC-16, AC-17, AC-26: 장소 상세 화면을 Testing Library로 그리고 북마크 API와 세션을 대역으로 두어 확인 중·확인 실패·저장됨·미저장의 접근 속성, 요청 중 눌리지 않음, 성공·4xx·5xx·연결 끊김과 재조회, 오프라인(`onlineManager`)에서 멈추지 않고 실패하며 다시 나가지 않음, 보내는 순간 사용자가 다르면 보내지 않음, 계정 전환 뒤 늦은 응답 버리기, 비로그인과 세션 종료 401의 안내 창·`clearSession` 호출·버튼 모양, 저절로 나간 조회의 401은 창 없음, 로그인 복원 3초 시간 제한, [취소]·[로그인]이 남기는 주소, `from=saved`면 검색 카드가 있어도 핏 점수 숨김을 본다. 기존 "준비 중이에요" 단언 테스트는 공유와 저장을 나눠 새 동작으로 바꾼다. Prior art: `fe/src/domains/place/ui/place-detail-screen.test.tsx`, `review-edit-form.test.tsx`(`onlineManager`).
- FE 저장한 장소 화면 (example, jsdom), AC-17, AC-19, AC-20, AC-21, AC-22, AC-23, AC-24, AC-25, AC-26, AC-28: 메인 화면을 그리고 목록 API, 세션, 주소를 대역으로 두어 버튼이 `/?view=saved`로 가는지와 그 주소·`category`로 직접 들어온 경우, 비로그인 메인 버튼과 비로그인 직접 진입의 안내 창 문구와 목록 미요청, 숨긴 검색창·버튼, 핀·카드에 저장 장소만 있는지, 검색 결과가 늦게 와도 화면 유지와 메인 선택 불변, [뒤로]의 앱 안·밖 진입별 행선지와 검색 기록 미기록, 진입마다 다시 받기와 로딩, 카드 내용과 빠지는 값, 카드가 `from=saved`로 상세를 여는지, 업종 탭 거르기·개수·조사·주소 반영, 0개와 [추천 받으러 가기], 서버·시간 초과·연결 실패와 다시 시도, 목록 401, 다시 그렸을 때 탭·패널 유지와 해제 반영을 본다. 기존 "준비 중이에요" 단언 테스트는 새 동작으로 바꾼다. 놓치는 것: 지도 핀의 실제 모양, 라우트를 실제로 오가는 [뒤로]. Prior art: `fe/src/domains/place/ui/search-screen.test.tsx`.
- FE 내 정보와 로그인 뒤 복귀 (example, jsdom), AC-18, AC-27: 내 정보 메뉴가 `/?view=saved`로 가는지, 홈 도착 때 로그인된 상태면 남은 주소로 한 번만 `replace`하고 지우는지, 로그인 없이 왔거나 10분이 지났거나 다른 출처 경로(`//…`, `/\…`, `https://…`)면 따르지 않는지, 온보딩 게이트가 그대로인지 본다. 기존 내 정보의 "준비 중이에요" 단언 테스트는 새 동작으로 바꾼다. Prior art: `fe/src/app/my/page.test.tsx`, `fe/src/app/onboarding.test.tsx`(HomeEntry).
- 수동 (manual), AC-28, AC-29: 두 계정으로 local에서 저장·해제·계정 전환·로그인 복귀(이메일, D-11)·브라우저 [뒤로]를 직접 하고, 화면을 와이어프레임과 비교하며, 공유 버튼과 내 정보 버튼이 그대로인지 본다.

## Out of scope

- 저장 목록 카드에서 바로 해제하기(나중에 해제 API로 더한다). (D-12)
- 정렬 선택(가까운순, 이름순 등)과 정렬 드롭다운. (D-6)
- 페이징과 저장 개수 상한. (D-6)
- 공통 토스트의 모양·위치 변경. (D-5)
- 로그인 주소의 `next` 같은 앱 공통 로그인 복귀 장치, 리뷰 작성·내 정보의 로그인 복귀, 로그인 뒤 저장 자동 실행. (D-8)
- 홈의 온보딩 게이트 변경(로그아웃한 비게스트에게 `/?view=saved`를 여는 것). (D-12)
- 탈퇴 시 북마크 삭제(보관 정책 PRD OQ-17이 정해지면 다시 본다). (D-15)
- local Mock 모드의 장소 id를 DB `place_id`와 맞추는 일. (D-17)
- 여러 장소 일괄 조회. (D-13)
- 장소 상세 응답에 저장 여부 넣기. (D-5)
- "공유" 버튼 기능. (D-10)

## Open questions

- 탈퇴한 사용자의 북마크 보관 기간과 파기는 PRD OQ-17(soft delete 탈퇴의 보관·파기)을 따라 정한다. 지금은 남긴다(D-15).
