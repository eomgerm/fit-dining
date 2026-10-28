# 방문 평가와 리뷰 (review)

Status: draft
Decisions: [decisions.md](decisions.md) · Glossary and ADRs: none

## Problem

회원은 다녀온 장소를 이유 태그로 평가하고, 그 평가가 장소의 공개 리뷰가 되기를 원한다. 리뷰는 게시물이면서 취향 보정(FR-14)과 장소 근거의 원본 데이터라서, 작성·수정·삭제·숨김이 공개 목록에는 즉시 반영되어야 한다(PRD FR-10, FR-11, FR-12).

이 spec은 Jira S15P31A302-18([Full] 리뷰)의 BE·FE를 다룬다. Walking Skeleton(31 리뷰 작성, 32 리뷰 확인)은 누구나 쓰는 익명 댓글 수준으로 줄여 본문만으로 쓰고 장소별로 읽는 데까지만 만들고, 로그인·방문일·이유 태그를 비롯한 나머지는 1차 후속에서 붙인다(D-1). 화면은 Figma `핏다이닝` 파일의 UI/UX 페이지(장소 상세 6-xx, 방문 평가 7-xx와 각 예외 상태)를 따르되, 리뷰 목록은 Walking Skeleton부터 장소 상세의 리뷰 탭(6-03)과 홈 탭 미리보기(6-01)에 보이고(검색 담당이 만든 장소 상세 화면의 리뷰 자리에 리뷰 담당이 리뷰 컴포넌트를 붙인다), Walking Skeleton의 작성 화면은 Figma에 없는 한 화면 폼이다(D-32, D-18). 다른 담당과 함께 정해야 하는 항목은 결정하지 않고 Open questions에 둔다.

## Assumptions

1. 등록은 로그인한 사용자만 하고, 사용자는 `Authorization` 헤더의 JWT로 식별한다. Walking Skeleton은 인증 없이 등록했다(D-1, D-15, D-35).
2. Walking Skeleton은 방문일이 없고 작성일을 보인다. 1차 후속의 방문일은 KST 날짜이고 범위는 `오늘 - 1개월` 이상 `오늘` 이하이며 서버가 `Clock`으로 계산한다(D-4).
3. 이유 태그는 1차 후속에서 붙는다. 태그는 공용 특징 코드를 참조한다(D-16). 태그 목록, 문구, 업종별 노출은 아직 확정되지 않아 임시 시드로 진행하고, 확정되면 시드만 바꾼다(D-5).
4. 오류 응답, 입력 검증, 알 수 없는 속성 거부, null 필드 생략, 로그 규칙은 팀 BE 컨벤션(`be/docs/convention.md`)을 따른다. 오류는 리뷰 기능의 예외 처리 클래스가 ProblemDetail로 바꾸고, 형식 검증은 Bean Validation으로 한다(D-20).
5. FE는 데이터를 브라우저에서 공통 API 클라이언트(`@/shared/api`)와 TanStack Query로 가져오고 서버 전용 기능을 쓰지 않는다. 상대 경로 `/api/v1/...`를 부르고, 로컬 `next dev`에서는 개발 서버 프록시가 BE로 넘긴다(D-31, 검색 D-58). 화면은 공통 UI 컴포넌트(`@/shared/ui`)와 디자인 토큰으로 그린다(D-31).
6. 장소 ID는 검색 spec과 같은 정수다. Walking Skeleton은 장소 존재를 확인하지 않는다. 1차 후속부터 장소의 존재 여부와 이름·업종·역은 장소 기능의 조회 인터페이스로 확인한다(D-21, D-22).
7. 취향·장소 분석·검색 색인은 1차 후속부터 리뷰의 상태 시각과 `updated_at`으로 변경을 가져간다. 서버 안의 일괄 처리는 리뷰 테이블을 직접 조회할 수 있고, Modal에서 도는 AI가 읽는 경로는 AI·인프라 담당과 정한다(D-34). Walking Skeleton의 리뷰는 익명이고 이유 태그가 없어 취향 보정에 쓰이지 않는다(D-27).
8. 위치 확인은 기기에서만 계산하며 BE API가 없다(D-12).
9. 리뷰는 `reviews` 테이블에 저장한다. 메모리 저장소와 시드는 없고, dev도 빈 상태에서 시작한다(D-28, D-35).

## Usage

Walking Skeleton

1. **리뷰 목록**: 장소 상세의 홈 탭은 "리뷰 12" 아래 최신 3건을 보이고, 머리글의 "전체 보기"를 누르면 리뷰 탭이 열린다. 리뷰 탭은 `GET /api/v1/places/{placeId}/reviews`로 첫 페이지와 `totalCount`를 받아 작성일과 본문을 최신순으로 그리고, 목록 끝이 보이면 다음 페이지를 커서로 받는다(D-24, D-32).
2. **작성**: 장소 상세 하단 막대의 "방문 평가 남기기"를 누르면 로그인 없이 작성 화면(`/place/review?id=`)이 열린다. 본문을 입력하고(비워도 된다) "등록하기"를 누르면 `POST /api/v1/places/{placeId}/reviews`가 한 번 나가고, 성공하면 "리뷰가 등록됐어요" 토스트와 함께 들어오기 전의 장소 상세로 돌아가 새 리뷰가 리뷰 탭 맨 위와 홈 미리보기 첫 줄에 보인다(D-6, D-32).

1차 후속

3. **작성 흐름**: 같은 작성 화면(`/place/review?id=`)이 Figma 2단계 흐름으로 바뀐다. 비회원은 로그인 후 돌아온다. 작성 진입 때 위치 확인과 함께 `GET /api/v1/places/{placeId}/review-form`으로 작성 화면 데이터를 받는다. 오늘 이미 리뷰를 썼으면 7-E01 모달, 근처 확인에 실패하면 7-E02 모달이 뜬다. 작성은 Figma 2단계 흐름이다. 1/2단계에서 방문일과 좋았던 점(1개 이상), 아쉬웠던 점(선택)을 고르고, 2/2단계에서 재방문 의사, 본문, 사진, 1인당 금액을 입력한다. 같은 방문일로 이미 썼으면 409를 받아 방문일을 바꾸라고 안내한다(D-28, D-5, D-31, D-12).
4. **목록**: 리뷰 탭(6-03)에서 작성일 대신 방문일이 보이고 닉네임, 재방문 의사, 태그, 사진이 더해진다. 본인 리뷰("나 · 내 리뷰")에는 수정·삭제, 남의 리뷰에는 신고 메뉴가 뜬다(D-24).
5. **사진**: 사진을 고르면 앱이 원본과 썸네일 두 벌로 줄이고 EXIF를 지운 뒤 `POST /api/v1/review-photos/upload-urls`로 받은 주소에 바로 올린다. 등록 요청에는 객체 키만 담는다. 목록은 썸네일을 보여 준다(D-9).
6. **수정·삭제**: 본인 리뷰는 본문과 사진만 고칠 수 있고, 삭제하면 목록에서 즉시 빠진다. 같은 방문일로 다시 쓸 수 있다(D-28, D-6).
7. **신고와 운영**: 회원은 사유를 골라 신고한다. 운영자는 관리자 API로 숨김, 분석 제외, 작성 차단과 각 해제를 하고 처리 기록이 남는다(D-11).

## Acceptance criteria

Walking Skeleton

- [x] AC-1: 인증 헤더 없이 본문과 함께 리뷰를 등록하면 201과 `reviewId`를 받는다. 본문 없이도 등록되고, 같은 장소에 여러 번 등록할 수 있다. (D-1, D-6, D-15) (D-35로 바뀜)
- [x] AC-2: `placeId`가 양의 정수가 아니면(숫자가 아님, 0 이하, `long` 범위 밖) 400 ProblemDetail이다. 장소가 실제로 있는지는 확인하지 않아 Mock 장소 ID로도 등록된다. (D-21, D-22)
- [x] AC-3: 본문이 500자를 넘으면 400 ProblemDetail이다. 공백뿐인 본문은 본문 없음으로 저장된다. (D-6)
- [x] AC-4: 목록은 `created_at` 내림차순(같으면 `review_id` 내림차순)이고 커서로 20건씩 다음 페이지를 받으며 페이지 사이에 중복이 없다. 항목은 `reviewId`, 작성 시각, 본문을 담고 `totalCount`는 삭제되지 않은 리뷰 수다. (D-24) (D-35로 바뀜)
- [x] AC-5: 요청 본문에 정의되지 않은 속성(예: `userId`, `createdAt`)이 있으면 400 ProblemDetail이다. 응답 JSON 키는 문서화된 필드를 벗어나지 않는다. (D-20)
- [x] AC-6: 리뷰 등록과 조회를 처리한 뒤(400 포함) BE 로그에 요청 본문과 리뷰 본문이 나타나지 않는다. (D-20)
- [x] AC-7: 장소 상세의 리뷰 탭은 리뷰 수와 리뷰 목록을 보이고, 목록 끝이 보이면 다음 페이지를 받는다. 홈 탭은 리뷰 수와 최신 3건을 보이고, 리뷰가 있으면 머리글의 "전체 보기"로 리뷰 탭을 연다. 리뷰가 없으면 "리뷰 0"과 빈 상태 안내(6-E03)를, 목록을 불러오지 못하면 "다시 시도" 버튼이 있는 안내를 보인다. 목록은 작성일을 KST 날짜("10월 20일 작성")로 보인다. 작성 화면은 본문 입력칸 하나이고, 입력칸은 500자까지만 받으며 글자 수(예: 44/500)를 보인다. 등록 요청이 처리 중이면 "등록하기"가 비활성이다. 등록에 성공하면 "리뷰가 등록됐어요" 토스트가 뜨고 들어오기 전의 장소 상세(같은 탭)로 돌아가 새 리뷰가 리뷰 탭 맨 위와 홈 미리보기 첫 줄에 보이며, 상세의 "뒤로" 한 번이면 그 전 화면이다. 실패하면 화면에 오류 안내가 뜨고 입력이 남아 있다. (D-24, D-32)
- [x] AC-24: 리뷰는 메모리 Mock 저장소에 저장되고 `REVIEW_MOCK_ENABLED`가 꺼진 환경에서는 등록과 목록 모두 503 ProblemDetail이다. 전체 리뷰 수가 상한을 넘으면 가장 오래된 리뷰부터 목록과 `totalCount`에서 빠진다. 시드로 Mock 장소 30곳 모두에 리뷰가 있고, 1번 장소에는 25건이 있다. 장소 카드가 "앱 리뷰"로 드는 근거와 인용이 그 장소의 리뷰에 있다. (D-27, D-33) (D-35로 바뀜)

1차 후속

- [ ] AC-8: 등록은 로그인한 사용자만 할 수 있다. `Authorization` 헤더 없이 등록이나 작성 화면 데이터를 요청하면 401 ProblemDetail이고, 목록은 헤더 없이도 조회된다. 리뷰에 작성자가 저장되고 목록 항목에 방문일과 현재 닉네임이 더해진다. 화면은 작성일 대신 방문일을 보이고, `createdAt`은 직전 FE를 위해 응답에 남는다. (D-24, D-15)
- [x] AC-9: 방문일이 KST 오늘보다 미래이거나 `오늘 - 1개월`보다 이전이면 400 ProblemDetail이다. 경계일(오늘, 오늘 - 1개월)은 통과한다. (D-4, D-40)
- [x] AC-10: 없는 장소에 등록하거나 작성 화면 데이터를 요청하면 404 ProblemDetail이다. Mock 장소는 통과한다. (D-21, D-22)
- [x] AC-11: `GET /api/v1/places/{placeId}/review-form`은 장소 이름·업종·역, 방문일 범위(KST), 이 사용자가 이 장소에 이미 쓴 방문일, 업종에 맞는 좋았어요·아쉬웠어요 태그와 각 태그의 그룹, 작성 가능 여부를 돌려준다. (D-4, D-5, D-21)
- [x] AC-12: 등록 요청에 이유 태그, 재방문 의사, 1인당 금액이 더해진다. 좋았어요 태그가 없거나, 업종에 노출되지 않는 태그가 있거나, 같은 그룹 태그가 둘 이상이면 400이다. 아쉬웠어요 태그는 없어도 된다. 소음 축 태그는 4개 중 하나만 고를 수 있다. 1인당 금액이 0원 미만 또는 1,000,000원 초과면 400이고 금액 없이도 등록된다. 리뷰와 태그는 한 트랜잭션에 저장된다. 로그인하지 않은 요청은 본문이 틀려도 400이 아니라 401이다. (D-28, D-5, D-6, D-40)
- [x] AC-13: 같은 사용자·장소·방문일로 두 번 등록하면 두 번째는 409 ProblemDetail이고, 두 요청이 동시에 와도 한 건만 저장된다. 다른 오류(없는 장소 등)는 409로 바뀌지 않는다. FE는 409를 받으면 "이 날짜에는 이미 리뷰를 남겼어요"를 보여 주고 입력을 남기며, "방문일 바꾸기"로 방문일 선택(7-03)을 연다. (D-28, D-31, D-41)
- [ ] AC-14: 목록 항목에 재방문 의사, 태그(문구와 sentiment), 사진, `mine`, `hidden`이 더해진다. 헤더 없이 조회하면 `mine`은 모두 false다. (D-24)
- [x] AC-15: 작성 화면은 Figma 2단계 흐름이다. 태그를 고르면 같은 그룹의 다른 태그가 페이지(7-01, 7-02)와 관계없이 비활성화된다. 좋았던 점을 하나도 고르지 않으면 7-01의 "다음"이 비활성이다. 태그는 분위기·공간·이용·양·방문 목적 묶음으로 나뉘어 보인다. "<"는 입력을 남긴 채 이전 페이지로 가고, 쓴 내용이 있을 때 "X"를 누르면 7-E03이다. "X"로 나간 뒤 다시 열면 빈 입력이다. 2/2단계가 모두 비면 "건너뛰고 등록하기"다. 등록 실패는 7-E05와 7-E06으로 나뉜다. (D-5, D-31, D-41)
- [ ] AC-16: 작성자는 본문과 사진만 수정할 수 있다. 다른 필드(1인당 금액 포함)를 보내면 400, 남의 리뷰는 403 ProblemDetail이다. 수정해도 목록 순서는 그대로다. (D-6, D-24)
- [ ] AC-17: 삭제하면 목록과 `totalCount`에서 즉시 빠지고, 같은 방문일로 다시 등록할 수 있다. (D-28)
- [ ] AC-18: 사진은 리뷰당 5장 이하이고 사진마다 원본과 썸네일 키가 있다. 업로드 확인에 실패한 키(없음, 크기 초과, 형식 불일치)가 있으면 400 ProblemDetail이다. 확정된 사진만 공개 경로로 읽힌다. (D-9)
- [ ] AC-19: 신고는 리뷰당 한 번만 가능하다. 두 번째는 409, 본인 리뷰 신고는 400 ProblemDetail이고, 신고만으로 숨겨지지 않는다. "기타"를 고르면 설명 입력창이 나타나고 설명 없이도 신고된다. 설명은 100자까지 입력되고 글자 수(예: 0/100)를 보인다. "기타"가 아닌 사유에 설명을 보내거나 설명이 100자를 넘으면 400이다. (D-11)
- [ ] AC-20: 운영자가 숨기면 공개 목록에서 빠지고 작성자 본인에게는 `hidden: true`로 보이며, 그 리뷰의 사진은 공개 경로로 읽히지 않는다. 작성자 본인에게는 "운영 정책에 따라 숨김 처리됨" 표시와 함께 사진도 보인다. 숨김은 분석 제외를 자동 적용하지 않는다. (D-11, D-39)
- [ ] AC-21: 숨김, 분석 제외, 작성 차단과 각 해제는 처리자·시각·동작을 처리 기록에 남긴다. 작성 차단된 사용자는 `review-form`에서 작성 불가로 안내받고 등록은 403 ProblemDetail이다. (D-11)
- [ ] AC-22: "방문 평가 남기기"를 누르면 위치 확인이 시작되고 "측정 거리 + GPS 정확도 ≤ 100m"면 작성 화면에 "방문 확인 완료"가 보인다. 실패하면 7-E02 모달이 뜨고 "그냥 쓰기"로 작성할 수 있다. 좌표와 결과를 어떤 요청·로그·분석 이벤트에도 싣지 않는다. (D-12)
- [ ] AC-23: 오늘 이미 리뷰를 쓴 장소에서 "방문 평가 남기기"를 누르면 7-E01 모달이 뜨고, "다른 날 고르기"를 누르면 방문일 선택(7-03)이 열리며 이미 쓴 날은 "작성함"으로 막혀 있다. (D-4, D-12)
- [ ] AC-25: 리뷰는 `reviews` 테이블에 저장된다. 목록은 목록 인덱스(`idx_reviews_place_id_created_at_review_id`)로 범위와 정렬을 처리하고, `totalCount`는 첫 페이지 응답에만 있다. (D-35)
- [ ] AC-26: 작성 화면은 로그인하지 않았으면 로그인 화면으로 바뀐다. 등록 요청의 AT가 만료됐으면 한 번 갱신해 다시 보내고, 갱신에 실패하면 다시 로그인하라는 안내를 보이며 입력을 남긴다. (D-15, D-35)
- [x] AC-27: 회원이 탈퇴해도 그 회원의 리뷰는 목록과 리뷰 수에 남고, 탈퇴 뒤 남은 토큰으로는 리뷰를 등록할 수 없다(401). (D-38)

## Implementation anchors

| Anchor | Action | 단계 | Decision |
|---|---|---|---|
| `be/src/main/java/kr/co/fitdining/api/review/ReviewController.java#ReviewController` | new | WS | D-2 |
| `be/src/main/java/kr/co/fitdining/api/review/ReviewService.java#ReviewService` | new | WS | D-6, D-27 |
| `be/src/main/java/kr/co/fitdining/api/review/store/Review.java#Review` | new | 1차 | D-28, D-35 |
| `be/src/main/java/kr/co/fitdining/api/review/store/ReviewRepository.java#ReviewRepository` | new | 1차 | D-35 |
| `be/src/main/resources/db/migration/V4__create_reviews.sql` (`reviews` 테이블, 목록 인덱스, 같은 날 중복 금지) | new | 1차 | D-28, D-35 |
| `be/src/main/java/kr/co/fitdining/api/review/exception/ReviewExceptionHandler.java#ReviewExceptionHandler` | new | WS | D-20, D-35 |
| `be/src/main/java/kr/co/fitdining/api/review/dto/ReviewCreateRequest.java#ReviewCreateRequest` | new | WS | D-23, D-40 |
| `be/src/main/java/kr/co/fitdining/api/review/dto/ReviewListResponse.java#ReviewListResponse` | new | WS | D-23, D-24 |
| `be/src/main/resources/application.yml#review` (`review.mock.enabled`), `be/.env.example` (리뷰 Mock 스위치. 다른 기능 파일과 함께 따로 지운다) | modify | WS | D-27, D-35 |
| `fe/src/app/place/review/page.tsx#ReviewWritePage` (2단계 흐름 `ReviewForm`을 그린다) | new | WS | D-31, D-41 |
| `fe/src/app/place/review/with-access-token.ts#withAccessToken` (등록 요청에 AT를 붙이고 만료면 한 번 갱신) | new | 1차 | D-35 |
| `fe/src/domains/place/ui/place-detail-screen.tsx#PlaceDetailSlots` (검색 담당의 상세 화면에 리뷰 탭과 세 자리의 렌더 함수 props를 연다) | modify | WS | D-32 |
| `fe/src/app/place/place-detail-with-reviews.tsx#PlaceDetailWithReviews` (세 자리를 리뷰 컴포넌트로 채운다. `app/place/page.tsx`가 그린다) | new | WS | D-32 |
| `fe/src/domains/review/ui/review-section.tsx#ReviewSection` (리뷰 탭 목록, `onShowAll`을 주면 홈 탭 미리보기) | new | WS | D-24, D-32 |
| `fe/src/domains/review/api/review-api.ts#createReview` | new | WS | D-31 |
| `fe/src/domains/review/model/review.ts#reviewWriteHref` | new | WS | D-31 |
| `be/src/main/java/kr/co/fitdining/api/review/VisitDatePolicy.java#VisitDatePolicy` | new | 1차 | D-4 |
| `be/src/main/java/kr/co/fitdining/api/review/tag/ReasonTagRule.java#ReasonTagRule` | new | 1차 | D-5, D-36 |
| `be/src/main/resources/db/migration/V5__create_reason_tags.sql`, `R__reason_tag_seed.sql` (태그 테이블과 임시 시드) | new | 1차 | D-36 |
| `be/src/main/resources/db/migration/` (태그·사진·신고·운영 테이블) | new | 1차 | D-21, D-28, D-5 |
| `fe/src/domains/review/ui/review-form.tsx#ReviewForm` (Walking Skeleton의 한 화면 폼 `SimpleReviewForm`을 대신한다) | new | 1차 | D-5, D-41 |
| `fe/src/domains/review/ui/visit-calendar.tsx#VisitDateSheet` | new | 1차 | D-4, D-41 |
| `fe/src/domains/review/model/review-draft.ts#toCreateRequest` | new | 1차 | D-6, D-41 |
| `fe/src/domains/review/model/review-draft.ts#reconcileDraft` (다시 받은 작성 화면 데이터에 입력을 맞춘다) | new | 1차 | D-4, D-41 |
| `fe/src/domains/review/model/review-tags.ts#disabledTagCodes` | new | 1차 | D-5, D-36 |
| `fe/src/domains/review/model/nearby-check.ts#isNearby` | new | 1차 | D-12 |

BE는 팀이 정한 루트 패키지 `kr.co.fitdining.api`(검색 D-32) 아래 `review`에 두고, DTO는 `review.dto`에 둔다(D-23). 모듈 경계 규칙이 정해지면 그에 맞춘다. FE는 master의 공통 구조(`app → domains → shared`)를 따라 리뷰 코드를 `src/domains/review`에 둔다. 장소 상세는 검색 담당이 만들고(`src/domains/place`), 리뷰 담당이 상세 화면에 리뷰 자리 세 곳(`slots`)을 렌더 함수 props로 열어 `src/app/place/place-detail-with-reviews.tsx`에서 `ReviewSection`(리뷰 탭, `onShowAll`을 주면 홈 탭 미리보기)과 `reviewWriteHref`(하단 버튼)로 채운다. 도메인끼리는 import하지 않기 때문이다. 작성 화면(`src/app/place/review`)은 리뷰 담당이 만든다(D-32).

## Interfaces

엔드포인트(오류는 ProblemDetail, 컨벤션 3절과 검색 D-10의 임시 형식, D-20):

| 메서드와 경로 | 단계 | 인증 | 요청 | 응답 |
|---|---|---|---|---|
| `GET /api/v1/places/{placeId}/reviews` | WS | 없음(1차부터 선택) | 쿼리 `cursor?` | `ReviewListResponse` |
| `POST /api/v1/places/{placeId}/reviews` | WS | 필수(D-35) | `ReviewCreateRequest` | 201 `ReviewCreateResponse` |
| `GET /api/v1/places/{placeId}/review-form` | 1차 | 필수 | 경로 `placeId` | `ReviewFormResponse` |
| `GET /api/v1/reviews/{reviewId}` | 1차 | 필수(본인) | 경로 | `ReviewDetailResponse` |
| `PATCH /api/v1/reviews/{reviewId}` | 1차 | 필수(본인) | `ReviewUpdateRequest` | 204 |
| `DELETE /api/v1/reviews/{reviewId}` | 1차 | 필수(본인) | 경로 | 204 |
| `POST /api/v1/review-photos/upload-urls` | 1차 | 필수 | `ReviewPhotoUploadRequest` | `ReviewPhotoUploadResponse` |
| `POST /api/v1/reviews/{reviewId}/reports` | 1차 | 필수 | `ReviewReportRequest` | 201 |
| `/api/v1/admin/...` | 1차 | 관리자 | 신고 목록, 숨김·분석 제외·작성 차단과 해제, 처리 기록 | D-11 |

1차 후속의 인증은 `Authorization: Bearer <JWT>`다(D-15).

```text
DTO (review.dto 패키지, 클래스마다 파일 하나, 필드 목록만, 한 페이지 20건)

Walking Skeleton
  ReviewListResponse   : totalCount?(int, 첫 페이지에만), items(ReviewItem[]), nextCursor?
  ReviewItem           : reviewId, createdAt(KST 오프셋 시각), description?
  ReviewCreateRequest  : description?(..500)
  ReviewCreateResponse : reviewId

1차 후속에서 더하는 것
  ReviewItem           : + visitedAt(date), nickname, revisitIntent(bool),
                         tags(TagView[]), photos({url, thumbUrl}[]), mine(bool), hidden(bool)
  ReviewDetailResponse : ReviewItem과 같은 필드
  ReviewCreateRequest  : + visitedAt(date), tagCodes(1..), revisitIntent,
                         photos?({key, thumbKey}[], ..5), spentPerPerson?(0..1,000,000 정수)
  TagView              : code, label, sentiment(GOOD|BAD)
  ReviewFormResponse   : place({name, categoryGroup, station, thumbnailUrl?}), visitDate({min, max, default}),
                         reviewedDates(date[]), tags({good: FormTag[], bad: FormTag[]}),
                         limits({descriptionMax: 500, photoMax: 5, spentPerPersonMax: 1000000}),
                         writable(bool)
  FormTag              : code, label, group, displayGroup(분위기|공간|이용|양|방문 목적)
  ReviewReportRequest  : reason(AD_SPAM|ABUSE|UNRELATED|OTHER), detail?(..100, reason이 OTHER일 때만)
  ReviewPhotoUploadRequest  : count(1..5)
  ReviewPhotoUploadResponse : uploads(PhotoUpload[])
  PhotoUpload          : key, url, thumbKey, thumbUrl, expiresAt
  ReviewUpdateRequest  : description?, photos?({key, thumbKey}[], ..5)
```

역직렬화되는 요청 record의 숫자와 boolean은 박싱 타입이다(D-23). `spentPerPerson`은 PRD상 화면 표시에 쓰지 않고 수정 화면에도 없어(6-07) 응답에 담지 않는다. 목록 정렬은 작성일 기준이다. Walking Skeleton은 작성일을 보인다. 1차 후속의 화면(6-03)은 방문일만 보이지만, `createdAt`은 직전 배포의 FE를 위해 응답에 남긴다(D-24). `placeId`는 양의 정수다(D-21). 업종과 역 값은 검색 spec 가정 9의 enum과 같다.

데이터(리뷰 기능이 만드는 테이블, 이름은 팀 명명 규칙을 따른다):

```text
V4__create_reviews.sql(D-28, D-35)
reviews        : review_id, place_id(BIGINT, FK 없음), user_id(TEXT, auth_users 참조), visit_date(DATE) (NOT NULL),
                 description(VARCHAR(500), NULL 허용), revisit_intent(NOT NULL, 기본 false), spent_per_person(NULL 허용),
                 created_at, updated_at, deleted_at (TIMESTAMPTZ)
                 idx_reviews_place_id_created_at_review_id (place_id, created_at DESC, review_id DESC) WHERE deleted_at IS NULL
                 uk_reviews_user_id_place_id_visit_date UNIQUE (user_id, place_id, visit_date) WHERE deleted_at IS NULL
                 CHECK (place_id > 0), CHECK (spent_per_person BETWEEN 0 AND 1000000)
                 hidden_at, analysis_excluded_at은 S15P31A302-56에서 새 마이그레이션으로 더한다

1차 후속에서 더하는 것
V5__create_reason_tags.sql, R__reason_tag_seed.sql(D-36)
reason_tags           : code(PK), feature_code, sentiment(GOOD|BAD), label, display_group, sort_order
reason_tag_categories : (category, code)(PK), label(업종 문구, NULL 허용)
review_reason_tags    : (review_id, code)(PK)
review_photos  : review_photo_id, review_id, object_key, thumb_key, sort_order
review_reports : review_report_id, review_id, reporter_id, reason, detail, created_at
                 UNIQUE (review_id, reporter_id)
review_moderation_logs : moderation_log_id, target_type, target_id, action, actor_id, created_at
review_write_blocks    : user_id, blocked_by, blocked_at
```

## Seams & test plan

Walking Skeleton

- **도메인 규칙** (example), AC-3: 본문의 빈 값·공백을 본문 없음으로 바꾸는 정규화를 순수 Java 단위 테스트로 확인한다.
- **영속성** (example), AC-25, AC-27: `ReviewPersistenceTest`가 Testcontainers의 PostgreSQL과 V4로 저장, KST 방문일, 정렬, 커서 페이지 경계(같은 `createdAt` 포함), 리뷰 수는 첫 페이지에만, 삭제·숨김 제외, 같은 날 중복 409와 동시 등록, 삭제 후 재작성, 회원 탈퇴 뒤에도 리뷰가 남는지를 확인한다. 순차 스캔을 끈 `EXPLAIN`으로 목록 쿼리가 목록 인덱스를 타고 Sort가 없는지 본다(D-29, D-35, D-38).
- **컨트롤러 경계** (example), AC-1, AC-2, AC-3, AC-5, AC-6: `@WebMvcTest`에 서비스와 인증 모듈을 대신 꽂아 Bean Validation(`placeId`의 문자·0·음수·`long` 범위 밖, 본문 500자·501자), 인증 헤더 유무와 토큰 만료 `type`, 409, ProblemDetail 상태 코드, 알 수 없는 속성 거부, 로그에 본문과 토큰이 없음을 확인한다. 잡는 것: 길이 경계.
- **FE 순수 로직과 정적 렌더** (example), AC-7: `src/domains/review/model`의 KST 날짜 변환(자정 경계)과 등록 요청 만들기(공백뿐이면 본문 없음)를 Vitest로 확인한다. 목록 항목, 홈 미리보기 3건과 "전체 보기", 빈 상태, 불러오기 실패 안내는 데이터 훅과 나눈 그리는 컴포넌트를 `renderToStaticMarkup`으로 확인한다(공통 UI 테스트와 같은 방식, D-31, D-32). 놓치는 것: 누르기·입력·스크롤 같은 상호작용(수동 확인).
- **수동 확인** AC-7: 장소 상세 하단 버튼 → 작성 화면 → 등록 → 토스트와 함께 들어오기 전 탭으로 복귀해 새 리뷰가 리뷰 탭 맨 위와 홈 미리보기 첫 줄에 보이는지, 상세의 "뒤로" 한 번에 검색 결과로 가는지, 홈 미리보기의 "전체 보기"가 리뷰 탭을 여는지, 목록 끝까지 스크롤하면 다음 페이지가 붙는지, 실패 때 입력이 남는지, 버튼을 연달아 눌러도 한 번만 등록되는지, 500자에서 더 입력되지 않는지 확인한다.

1차 후속

- **도메인 규칙** (example), AC-9, AC-12, AC-16: 방문일 정책은 고정 `Clock`으로 경계일과 KST 자정 전후를, 태그 규칙은 그룹(소음 축 4개 포함)·업종·개수 조합을, 금액은 경계값(0, 1,000,000, 1,000,001)을 단위 테스트로 확인한다.
- **컨트롤러 경계** (example), AC-8, AC-10, AC-11, AC-12, AC-16, AC-19: 인증 헤더 유무(본문이 틀려도 401이 먼저), 필수 필드 누락, 금액 경계, 404, 403, 409를 `@WebMvcTest`로 확인한다(D-40).
- **영속성** (example), AC-9, AC-12, AC-13, AC-17: 방문일 경계와 KST 자정 직후의 오늘, 태그 저장과 규칙 위반 때 아무것도 남지 않는지, 409 뒤 태그 행이 남지 않는지, 동시 등록, 삭제 후 재작성을 `ReviewPersistenceTest`에서 확인한다(D-29, D-40).
- **FE 순수 로직과 정적 렌더** (example), AC-13, AC-15, AC-22: `src/domains/review/model`의 태그 선택 함수(같은 그룹 비활성화, 소음 축 4개), 입력 상태(첫 방문일, "다음" 조건, 버튼 문구, 금액 입력, 등록 요청, 다시 받은 데이터에 맞추기), 달력 칸 계산, 근처 판정 함수와 `ui`의 등록 실패 분류를 Vitest(`pnpm test`)로 확인한다. 태그 칩 비활성, 달력의 "작성함"과 범위 밖 날, 2/2단계 문구는 정적 렌더로 확인한다. 1/2단계 상단 고정, "나가기" 뒤 빈 입력, 다시 받은 데이터로 비워진 방문일과 "X", 등록 404, 쓰는 중의 401, 다시 받은 데이터 반영, 방문일이 빠진 등록, 범위 밖 방문일을 받은 7-03은 jsdom 렌더(Testing Library)로 확인한다(D-31, D-41). 놓치는 것: Next가 숨겨 둔 화면을 다시 여는 동작, 시트·다이얼로그 모양과 닫힘 모션은 수동 확인.
- **사진** (manual), AC-18, AC-20: `infra/edge/test` 환경에서 Caddy를 거친 presigned 업로드(원본·썸네일)와 공개 읽기를 확인한다.
- **수동 확인** AC-22, AC-23: Figma 흐름(상세 → 위치 확인·오늘 작성 여부 모달 → 1/2·2/2단계 → 상세로 복귀, 검색 상태 유지).

## Out of scope

- 리뷰 자동 필터링(PRD 2차)(D-1)
- 취향 보정과 근거 장부(티켓 20), 장소 특징 추출·페르소나·임베딩·색인(D-1)
- 리뷰 변경 전달의 고도화(이벤트, 아웃박스)(D-34)
- 토큰 발급·저장·갱신, 관리자 권한, 닉네임 저장(회원 담당)(D-15)
- 장소 테이블, 장소 조회 인터페이스의 구현, 장소 상세 API(장소·검색 담당)(D-21)
- 공통 응답과 예외 형식, 모듈 경계 같은 BE 공용 규칙의 확정
- 위치 확인의 서버 처리(D-12)

## Open questions

다른 담당이나 팀이 정해야 하는 것들이다. 정해지면 결정 로그에 옮긴다. 구현을 막는 시점에 따라 나눴다.

### 1차 후속 전에 필요

로그인과 회원 테이블(`auth_users`, `V1__auth`)은 develop에 들어왔다(S15P31A302-38). 남은 선행 조건 중 가장 큰 것은 `places` 테이블과 AI가 리뷰를 읽는 경로다.

회원 담당
- 공통 인증 인터셉터를 `/api/v1/**`에도 걸 계획인가요? 지금 인터셉터는 `/api/auth/**`에만 걸려 있고, 사용자 ID는 `AuthUseCases.authenticate`가 AT(`Authorization: Bearer`)에서 꺼낸다(D-15). 리뷰 목록처럼 헤더 없이도 되는 선택 인증이 필요하다.
- 관리자 권한은 어떻게 구분하나요? `auth_users`에는 역할이 없다. 관리자 API(D-11)가 여기에 달려 있다.

취향·AI·검색 담당
- 코드표(`features.py`)는 취향 분석 브랜치(S15P31A302-39)가 관리하기로 했고 리뷰 태그도 이 코드를 쓴다(D-16, D-36). 이 브랜치는 언제 머지되나요? develop의 온보딩 코드(`SPACIOUS`, `VALUE`, `CONVERSATION` 등)와 7개가 다른데 어느 쪽에 맞추나요?
- AI는 리뷰를 어디서 읽나요? AI는 Modal에서 돌아 서버 내부망의 Postgres를 직접 읽지 못한다(비교 spec 6절). 리뷰는 삭제·숨김·분석 제외 시각과 `updated_at`을 남긴다(D-34). BE 조회 API나 정기 내보내기 같은 받는 방법, 필요한 필드와 주기를 인프라 담당과 함께 정해야 한다.
- 삭제·숨김·분석 제외된 리뷰가 카드의 인용(`reasons[].quote`, `quoteSource` "앱 리뷰")과 근거 수(`evidenceCount`)에서 빠지게 하는 쪽은 비교 쪽인가요? 지금 베이스라인은 인용을 넣지 않지만 다음 단계에서 앱 리뷰 인용을 붙인다.

BE 팀 공통
- DB 공통 규칙 초안의 이름 규칙, 삭제 행 제외 방식, 마이그레이션 버전 형식을 언제 합의하나요? 1차 후속의 `reviews` 마이그레이션이 이를 따른다(D-28).
- `places` 테이블과 마이그레이션은 누가 언제 만드나요? 리뷰의 장소 참조가 여기에 달려 있다. 이 테이블로 FK를 거나요? FK를 걸면 Mock 장소(D-22)도 `places`에 있어야 한다. 회원은 `auth_users`(`V1__auth`, `id`는 text)가 있다.
- 같은 상태 코드 안의 오류 구분은 컨벤션 3절대로 ProblemDetail의 `type`이나 확장 필드로 하면 되나요? 리뷰는 400 안에서 방문일 범위와 태그 위반을 FE가 구분해야 한다(409 중복은 상태 코드로 구분된다). 인증 오류는 ProblemDetail의 `type`(`urn:fitdining:auth:access-token-expired`)으로 토큰 만료를 구분한다.
- 모듈 경계 규칙은 무엇인가요? 장소와 리뷰는 기능 패키지(`place`, `review`) 아래에 평평하게 두는데(D-23), `auth`는 `domain`·`ports`·`application`·`infrastructure`·`presentation`으로 나눈다.

인프라 담당
- BE는 브라우저가 쓰는 공개 호스트의 경로(`/fit-<env>-photos/`)로 presigned URL을 서명해야 한다(인프라 5.2절, 12.5절 #2). app env 계약에는 내부 주소 `S3_ENDPOINT`뿐인데 공개 호스트는 어떤 키로 받나요?
- Garage 스파이크(인프라 7.4절) 중 서버에서 남은 확인은 언제 끝나나요? presigned PUT·POST가 Caddy를 거쳐 서명이 통과하는지, PostObject의 `content-length-range`, 수명주기가 남았다. 웹 엔드포인트 공개 읽기와 익명 S3 GET 거부는 로컬에서 확인됐다. 실패하면 저장소가 바뀐다(D-9).
- AI가 리뷰를 읽는 경로(취향·AI·검색 담당 질문, D-34)를 함께 정해야 한다.

FE 공통 담당
- 사진 고르기·미리보기 칸은 공통 UI 컴포넌트로 만드나요, 리뷰 도메인에서 만드나요? 방문일 달력(7-03)은 리뷰 도메인에 만들었다(D-41).

기획·디자인
- 이유 태그 목록, 문구, 업종별 노출은 언제 확정되나요? 그 전까지는 PRD FR-10 초안을 임시 시드로 쓰고, 확정되면 `R__reason_tag_seed.sql`만 고친다(D-36).
- 7-01에서 좋았던 점을 고르지 않았을 때 "다음" 비활성 상태와 "하나 이상 필수" 안내를 그려야 한다. 7-01, 7-01b와 예외 상태(7-E01~7-E06) 어디에도 아직 없다(D-5).
- 409(같은 날 두 번째 등록)와 401(로그인 만료) 안내 화면이 예외 상태에 없다. 지금은 7-E05와 같은 다이얼로그 꼴로 그린다(D-41).

팀장
- 관리자 도구(Appsmith)는 관리자 API를 부르나요, DB에 직접 붙나요?

### 리뷰 담당이 준비할 것

- 작성 화면에 남은 것: 근처 판정 함수와 "방문 확인 완료", 7-E01·7-E02(S15P31A302-51), 사진 업로드와 7-E04(S15P31A302-54), 로그인 뒤 작성 화면으로 돌아오기(D-12, D-41).
- 1차 후속 전: Figma에 없는 화면(숨김 처리된 내 리뷰 표시, 작성 차단 안내)을 추가한다.
