# 방문 평가와 리뷰 (review)

Status: draft
Decisions: [decisions.md](decisions.md) · Glossary and ADRs: none

## Problem

회원은 다녀온 장소를 이유 태그로 평가하고, 그 평가가 장소의 공개 리뷰가 되기를 원한다. 리뷰는 게시물이면서 취향 보정(FR-14)과 장소 근거의 원본 데이터라서, 작성·수정·삭제·숨김이 공개 목록에는 즉시 반영되어야 한다(PRD FR-10, FR-11, FR-12).

이 spec은 Jira S15P31A302-18([Full] 리뷰)의 BE·FE를 다룬다. Walking Skeleton(31 리뷰 작성, 32 리뷰 확인)은 누구나 쓰는 익명 댓글 수준으로 줄여 본문만으로 쓰고 장소별로 읽는 데까지만 만들고, 로그인·방문일·이유 태그를 비롯한 나머지는 1차 후속에서 붙인다(D-1). 화면은 Figma `핏다이닝` 파일의 UI/UX 페이지(장소 상세 6-xx, 방문 평가 7-xx와 각 예외 상태)를 따르되, 리뷰 목록은 Walking Skeleton부터 장소 상세의 리뷰 탭(6-03)과 홈 탭 미리보기(6-01)에 보이고(검색 담당이 만든 장소 상세 화면의 리뷰 자리에 리뷰 담당이 리뷰 컴포넌트를 붙인다), Walking Skeleton의 작성 화면은 Figma에 없는 한 화면 폼이다(D-32, D-18). 다른 담당과 함께 정해야 하는 항목은 결정하지 않고 Open questions에 둔다.

## Assumptions

1. Walking Skeleton은 사용자를 식별하지 않고 인증 없이 등록한다. 1차 후속부터 사용자는 `Authorization` 헤더의 JWT로 식별한다(D-1, D-15).
2. Walking Skeleton은 방문일이 없고 작성일을 보인다. 1차 후속의 방문일은 KST 날짜이고 범위는 `오늘 - 1개월` 이상 `오늘` 이하이며 서버가 `Clock`으로 계산한다(D-4).
3. 이유 태그는 1차 후속에서 붙는다. 태그는 공용 특징 코드를 참조하고(D-16), 문구와 업종별 노출은 PRD FR-10 초안을 임시 시드로 쓴다. 기획이 문구를 확정하면 시드만 바꾼다(D-5).
4. 오류 응답, 입력 검증, 알 수 없는 속성 거부, null 필드 생략, 로그 규칙은 팀 BE 컨벤션(`be/docs/convention.md`)을 따른다. 오류는 리뷰 기능의 예외 처리 클래스가 ProblemDetail로 바꾸고, 형식 검증은 Bean Validation으로 한다(D-20).
5. FE는 데이터를 브라우저에서 공통 API 클라이언트(`@/shared/api`)와 TanStack Query로 가져오고 서버 전용 기능을 쓰지 않는다. 상대 경로 `/api/v1/...`를 부르고, 로컬 `next dev`에서는 개발 서버 프록시가 BE로 넘긴다(D-31, 검색 D-58). 화면은 공통 UI 컴포넌트(`@/shared/ui`)와 디자인 토큰으로 그린다(D-31).
6. 장소 ID는 검색 spec과 같은 정수다. Walking Skeleton은 장소 존재를 확인하지 않는다. 1차 후속부터 장소의 존재 여부와 이름·업종·역은 장소 기능의 조회 인터페이스로 확인한다(D-21, D-22).
7. 취향·장소 분석·검색 색인은 1차 후속부터 리뷰 테이블을 직접 조회해 변경을 가져간다(D-17). Walking Skeleton의 리뷰는 익명이고 이유 태그가 없어 취향 보정에 쓰이지 않는다(D-27).
8. 위치 확인은 기기에서만 계산하며 BE API가 없다(D-12).
9. Walking Skeleton은 DB 테이블 없이 메모리 Mock 저장소에 저장한다. 저장소는 `REVIEW_MOCK_ENABLED`로 local과 dev에서만 켜고, 꺼진 환경에서는 리뷰 API가 503이다. 재시작하면 시드만 남는다. 1차 후속에서 저장소 구현만 `reviews` 테이블을 쓰는 구현으로 바꾼다(D-27, D-28).

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

- [ ] AC-1: 인증 헤더 없이 본문과 함께 리뷰를 등록하면 201과 `reviewId`를 받는다. 본문 없이도 등록되고, 같은 장소에 여러 번 등록할 수 있다. (D-1, D-6, D-15)
- [ ] AC-2: `placeId`가 양의 정수가 아니면(숫자가 아님, 0 이하, `long` 범위 밖) 400 ProblemDetail이다. 장소가 실제로 있는지는 확인하지 않아 Mock 장소 ID로도 등록된다. (D-21, D-22)
- [ ] AC-3: 본문이 500자를 넘으면 400 ProblemDetail이다. 공백뿐인 본문은 본문 없음으로 저장된다. (D-6)
- [ ] AC-4: 목록은 `created_at` 내림차순(같으면 `review_id` 내림차순)이고 커서로 20건씩 다음 페이지를 받으며 페이지 사이에 중복이 없다. 항목은 `reviewId`, 작성 시각, 본문을 담고 `totalCount`는 삭제되지 않은 리뷰 수다. (D-24)
- [ ] AC-5: 요청 본문에 정의되지 않은 속성(예: `userId`, `visitedAt`)이 있으면 400 ProblemDetail이다. 응답 JSON 키는 문서화된 필드를 벗어나지 않는다. (D-20)
- [ ] AC-6: 리뷰 등록과 조회를 처리한 뒤(400 포함) BE 로그에 요청 본문과 리뷰 본문이 나타나지 않는다. (D-20)
- [ ] AC-7: 장소 상세의 리뷰 탭은 리뷰 수와 리뷰 목록을 보이고, 목록 끝이 보이면 다음 페이지를 받는다. 홈 탭은 리뷰 수와 최신 3건을 보이고, 리뷰가 있으면 머리글의 "전체 보기"로 리뷰 탭을 연다. 리뷰가 없으면 "리뷰 0"과 빈 상태 안내(6-E03)를, 목록을 불러오지 못하면 "다시 시도" 버튼이 있는 안내를 보인다. 목록은 작성일을 KST 날짜("10월 20일 작성")로 보인다. 작성 화면은 본문 입력칸 하나이고, 입력칸은 500자까지만 받으며 글자 수(예: 44/500)를 보인다. 등록 요청이 처리 중이면 "등록하기"가 비활성이다. 등록에 성공하면 "리뷰가 등록됐어요" 토스트가 뜨고 들어오기 전의 장소 상세(같은 탭)로 돌아가 새 리뷰가 리뷰 탭 맨 위와 홈 미리보기 첫 줄에 보이며, 상세의 "뒤로" 한 번이면 그 전 화면이다. 실패하면 화면에 오류 안내가 뜨고 입력이 남아 있다. (D-24, D-32)
- [ ] AC-24: 리뷰는 메모리 Mock 저장소에 저장되고 `REVIEW_MOCK_ENABLED`가 꺼진 환경에서는 등록과 목록 모두 503 ProblemDetail이다. 전체 리뷰 수가 상한을 넘으면 가장 오래된 리뷰부터 목록과 `totalCount`에서 빠진다. 시드로 Mock 장소 30곳 모두에 리뷰가 있고, 1번 장소에는 25건이 있다. 장소 카드가 "앱 리뷰"로 드는 근거와 인용이 그 장소의 리뷰에 있다. (D-27, D-33)

1차 후속

- [ ] AC-8: 등록은 로그인한 사용자만 할 수 있다. `Authorization` 헤더 없이 등록이나 작성 화면 데이터를 요청하면 401 ProblemDetail이고, 목록은 헤더 없이도 조회된다. 리뷰에 작성자가 저장되고 목록 항목에 방문일과 현재 닉네임이 더해진다. 화면은 작성일 대신 방문일을 보이고, `createdAt`은 직전 FE를 위해 응답에 남는다. (D-24, D-15)
- [ ] AC-9: 방문일이 KST 오늘보다 미래이거나 `오늘 - 1개월`보다 이전이면 400 ProblemDetail이다. 경계일(오늘, 오늘 - 1개월)은 통과한다. (D-4)
- [ ] AC-10: 없는 장소에 등록하거나 작성 화면 데이터를 요청하면 404 ProblemDetail이다. Mock 장소는 통과한다. (D-21, D-22)
- [ ] AC-11: `GET /api/v1/places/{placeId}/review-form`은 장소 이름·업종·역, 방문일 범위(KST), 이 사용자가 이 장소에 이미 쓴 방문일, 업종에 맞는 좋았어요·아쉬웠어요 태그와 각 태그의 그룹, 작성 가능 여부를 돌려준다. (D-4, D-5, D-21)
- [ ] AC-12: 등록 요청에 이유 태그, 재방문 의사, 1인당 금액이 더해진다. 좋았어요 태그가 없거나, 업종에 노출되지 않는 태그가 있거나, 같은 그룹 태그가 둘 이상이면 400이다. 아쉬웠어요 태그는 없어도 된다. 소음 축 태그는 4개 중 하나만 고를 수 있다. 1인당 금액이 0원 미만 또는 1,000,000원 초과면 400이고 금액 없이도 등록된다. 리뷰와 태그는 한 트랜잭션에 저장된다. (D-28, D-5, D-6)
- [ ] AC-13: 같은 사용자·장소·방문일로 두 번 등록하면 두 번째는 409 ProblemDetail이고, 두 요청이 동시에 와도 한 건만 저장된다. 다른 오류(없는 장소 등)는 409로 바뀌지 않는다. FE는 409를 받으면 "이 날짜에는 이미 리뷰를 남겼어요"를 보여 주고 입력을 남긴다. (D-28, D-31)
- [ ] AC-14: 목록 항목에 재방문 의사, 태그(문구와 sentiment), 사진, `mine`, `hidden`이 더해진다. 헤더 없이 조회하면 `mine`은 모두 false다. (D-24)
- [ ] AC-15: 작성 화면은 Figma 2단계 흐름이다. 태그를 고르면 같은 그룹의 다른 태그가 페이지(7-01, 7-02)와 관계없이 비활성화된다. 좋았던 점을 하나도 고르지 않으면 7-01의 "다음"이 비활성이다. 태그는 분위기·공간·이용·방문 목적 묶음으로 나뉘어 보인다. 작성 중 닫으면 7-E03, 등록 실패는 7-E05와 7-E06으로 나뉜다. (D-5, D-31)
- [ ] AC-16: 작성자는 본문과 사진만 수정할 수 있다. 다른 필드(1인당 금액 포함)를 보내면 400, 남의 리뷰는 403 ProblemDetail이다. 수정해도 목록 순서는 그대로다. (D-6, D-24)
- [ ] AC-17: 삭제하면 목록과 `totalCount`에서 즉시 빠지고, 같은 방문일로 다시 등록할 수 있다. (D-28)
- [ ] AC-18: 사진은 리뷰당 5장 이하이고 사진마다 원본과 썸네일 키가 있다. 업로드 확인에 실패한 키(없음, 크기 초과, 형식 불일치)가 있으면 400 ProblemDetail이다. 확정된 사진만 공개 경로로 읽힌다. (D-9)
- [ ] AC-19: 신고는 리뷰당 한 번만 가능하다. 두 번째는 409, 본인 리뷰 신고는 400 ProblemDetail이고, 신고만으로 숨겨지지 않는다. "기타"를 고르면 설명 입력창이 나타나고 설명 없이도 신고된다. "기타"가 아닌 사유에 설명을 보내면 400이다. (D-11)
- [ ] AC-20: 운영자가 숨기면 공개 목록에서 빠지고 작성자 본인에게는 `hidden: true`로 보이며, 그 리뷰의 사진은 공개 경로로 읽히지 않는다. 숨김은 분석 제외를 자동 적용하지 않는다. (D-10, D-11)
- [ ] AC-21: 숨김, 분석 제외, 작성 차단과 각 해제는 처리자·시각·동작을 처리 기록에 남긴다. 작성 차단된 사용자는 `review-form`에서 작성 불가로 안내받고 등록은 403 ProblemDetail이다. (D-11)
- [ ] AC-22: "방문 평가 남기기"를 누르면 위치 확인이 시작되고 "측정 거리 + GPS 정확도 ≤ 100m"면 작성 화면에 "방문 확인 완료"가 보인다. 실패하면 7-E02 모달이 뜨고 "그냥 쓰기"로 작성할 수 있다. 좌표와 결과를 어떤 요청·로그·분석 이벤트에도 싣지 않는다. (D-12)
- [ ] AC-23: 오늘 이미 리뷰를 쓴 장소에서 "방문 평가 남기기"를 누르면 7-E01 모달이 뜨고, "다른 날 고르기"를 누르면 방문일 선택(7-03)이 열리며 이미 쓴 날은 "작성함"으로 막혀 있다. (D-4, D-12)

## Implementation anchors

| Anchor | Action | 단계 | Decision |
|---|---|---|---|
| `be/src/main/java/kr/co/fitdining/api/review/ReviewController.java#ReviewController` | new | WS | D-2 |
| `be/src/main/java/kr/co/fitdining/api/review/ReviewService.java#ReviewService` | new | WS | D-6, D-27 |
| `be/src/main/java/kr/co/fitdining/api/review/store/ReviewStore.java#ReviewStore` | new | WS | D-27 |
| `be/src/main/java/kr/co/fitdining/api/review/store/InMemoryReviewStore.java#InMemoryReviewStore` | new | WS | D-27 |
| `be/src/main/java/kr/co/fitdining/api/review/ReviewExceptionHandler.java#ReviewExceptionHandler` | new | WS | D-20 |
| `be/src/main/java/kr/co/fitdining/api/review/dto/ReviewCreateRequest.java#ReviewCreateRequest` | new | WS | D-23 |
| `be/src/main/java/kr/co/fitdining/api/review/dto/ReviewListResponse.java#ReviewListResponse` | new | WS | D-23, D-24 |
| `be/src/main/resources/mock/reviews.json` (시드, 장소 Mock 30곳의 근거에 맞춤) | new | WS | D-27, D-33 |
| `be/src/main/resources/application.yml#review` (`review.mock.enabled`), `be/.env.example` | modify | WS | D-27 |
| `fe/src/app/place/review/page.tsx#ReviewWritePage` (1차에 2단계 흐름으로 바꾼다) | new | WS | D-31 |
| `fe/src/domains/place/ui/place-detail-screen.tsx#PlaceDetailSlots` (검색 담당의 상세 화면에 리뷰 탭과 세 자리의 렌더 함수 props를 연다) | modify | WS | D-32 |
| `fe/src/app/place/place-detail-with-reviews.tsx#PlaceDetailWithReviews` (세 자리를 리뷰 컴포넌트로 채운다. `app/place/page.tsx`가 그린다) | new | WS | D-32 |
| `fe/src/domains/review/ui/review-section.tsx#ReviewSection` (리뷰 탭 목록, `onShowAll`을 주면 홈 탭 미리보기) | new | WS | D-24, D-32 |
| `fe/src/domains/review/ui/simple-review-form.tsx#SimpleReviewForm` (한 화면 폼) | new | WS | D-31 |
| `fe/src/domains/review/api/review-api.ts#createReview` | new | WS | D-31 |
| `fe/src/domains/review/model/review.ts#reviewWriteHref` | new | WS | D-31 |
| `be/src/main/java/kr/co/fitdining/api/review/VisitDatePolicy.java#VisitDatePolicy` | new | 1차 | D-4 |
| `be/src/main/java/kr/co/fitdining/api/review/ReasonTagRule.java#ReasonTagRule` | new | 1차 | D-5 |
| `be/src/main/java/kr/co/fitdining/api/review/Review.java#Review` | new | 1차 | D-6, D-28 |
| `be/src/main/java/kr/co/fitdining/api/review/store/JpaReviewStore.java#JpaReviewStore` | new | 1차 | D-27, D-28 |
| `be/src/main/resources/db/migration/` (`reviews` 테이블과 중복 금지 인덱스, 태그·사진·신고·운영 테이블) | new | 1차 | D-21, D-28, D-5 |
| `fe/src/domains/review/ui/review-form.tsx#ReviewForm` | new | 1차 | D-5, D-31 |
| `fe/src/domains/review/model/review-tags.ts#selectTag` | new | 1차 | D-5 |
| `fe/src/domains/review/model/nearby-check.ts#isNearby` | new | 1차 | D-12 |

BE는 팀이 정한 루트 패키지 `kr.co.fitdining.api`(검색 D-32) 아래 `review`에 두고, DTO는 `review.dto`에 둔다(D-23). 모듈 경계 규칙이 정해지면 그에 맞춘다. FE는 master의 공통 구조(`app → domains → shared`)를 따라 리뷰 코드를 `src/domains/review`에 둔다. 장소 상세는 검색 담당이 만들고(`src/domains/place`), 리뷰 담당이 상세 화면에 리뷰 자리 세 곳(`slots`)을 렌더 함수 props로 열어 `src/app/place/place-detail-with-reviews.tsx`에서 `ReviewSection`(리뷰 탭, `onShowAll`을 주면 홈 탭 미리보기)과 `reviewWriteHref`(하단 버튼)로 채운다. 도메인끼리는 import하지 않기 때문이다. 작성 화면(`src/app/place/review`)은 리뷰 담당이 만든다(D-32).

## Interfaces

엔드포인트(오류는 ProblemDetail, 컨벤션 3절과 검색 D-10의 임시 형식, D-20):

| 메서드와 경로 | 단계 | 인증 | 요청 | 응답 |
|---|---|---|---|---|
| `GET /api/v1/places/{placeId}/reviews` | WS | 없음(1차부터 선택) | 쿼리 `cursor?` | `ReviewListResponse` |
| `POST /api/v1/places/{placeId}/reviews` | WS | 없음(1차부터 필수) | `ReviewCreateRequest` | 201 `ReviewCreateResponse` |
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
  ReviewListResponse   : totalCount(int), items(ReviewItem[]), nextCursor?
  ReviewItem           : reviewId, createdAt(KST 오프셋 시각), description?
  ReviewCreateRequest  : description?(..500)
  ReviewCreateResponse : reviewId

1차 후속에서 더하는 것
  ReviewItem           : + visitedAt(date), nickname, revisitIntent(bool),
                         tags(TagView[]), photos({url, thumbUrl}[]), mine(bool), hidden(bool)
  ReviewDetailResponse : ReviewItem과 같은 필드
  ReviewCreateRequest  : + visitedAt(date), tagIds(1..), revisitIntent,
                         photos?({key, thumbKey}[], ..5), spentPerPerson?(0..1,000,000 정수)
  TagView              : tagId, label, sentiment(GOOD|BAD)
  ReviewFormResponse   : place({name, categoryGroup, station}), visitDate({min, max, default}),
                         reviewedDates(date[]), tags({good: FormTag[], bad: FormTag[]}),
                         limits({descriptionMax: 500, photoMax: 5, spentPerPersonMax: 1000000}),
                         writable(bool)
  FormTag              : tagId, label, exclusiveGroup, displayGroup(분위기|공간|이용|방문 목적)
  ReviewReportRequest  : reason(AD_SPAM|ABUSE|UNRELATED|OTHER), detail?(reason이 OTHER일 때만)
  ReviewPhotoUploadRequest  : count(1..5)
  ReviewPhotoUploadResponse : uploads(PhotoUpload[])
  PhotoUpload          : key, url, thumbKey, thumbUrl, expiresAt
  ReviewUpdateRequest  : description?, photos?({key, thumbKey}[], ..5)
```

역직렬화되는 요청 record의 숫자와 boolean은 박싱 타입이다(D-23). `spentPerPerson`은 PRD상 화면 표시에 쓰지 않고 수정 화면에도 없어(6-07) 응답에 담지 않는다. 목록 정렬은 작성일 기준이다. Walking Skeleton은 작성일을 보인다. 1차 후속의 화면(6-03)은 방문일만 보이지만, `createdAt`은 직전 배포의 FE를 위해 응답에 남긴다(D-24). `placeId`는 양의 정수다(D-21). 업종과 역 값은 검색 spec 가정 9의 enum과 같다.

데이터(리뷰 기능이 만드는 테이블, 이름은 팀 명명 규칙을 따른다):

```text
Walking Skeleton(테이블 없음, 메모리 Mock 저장소, D-27)
리뷰           : reviewId, placeId, description?(..500), createdAt(마이크로초로 자른 시각)
                 장소별 목록, createdAt DESC·reviewId DESC, 전체 상한(임시 5,000건)

1차 후속(첫 마이그레이션, D-28)
reviews        : review_id, place_id(BIGINT), user_id, visited_at(DATE) (NOT NULL),
                 description(VARCHAR(500), NULL 허용), revisit_intent, spent_per_person,
                 created_at, updated_at, deleted_at, hidden_at, analysis_excluded_at (TIMESTAMPTZ)
                 INDEX (place_id, created_at DESC, review_id DESC) WHERE deleted_at IS NULL
                 UNIQUE (user_id, place_id, visited_at) WHERE deleted_at IS NULL
                 CHECK (spent_per_person BETWEEN 0 AND 1000000)
tags           : tag_id, feature_code, sentiment, exclusive_group, display_group, label, active
tag_categories : (tag_id, category)
review_tags    : (review_id, tag_id)
review_photos  : review_photo_id, review_id, object_key, thumb_key, sort_order
review_reports : review_report_id, review_id, reporter_id, reason, detail, created_at
                 UNIQUE (review_id, reporter_id)
review_moderation_logs : moderation_log_id, target_type, target_id, action, actor_id, created_at
review_write_blocks    : user_id, blocked_by, blocked_at
```

## Seams & test plan

Walking Skeleton

- **도메인 규칙** (example), AC-3: 본문의 빈 값·공백을 본문 없음으로 바꾸는 정규화를 순수 Java 단위 테스트로 확인한다.
- **메모리 저장소** (example), AC-1, AC-4, AC-24: 저장, 정렬, 커서 페이지 경계(같은 `createdAt` 포함), 깨진 커서, 상한을 넘었을 때 오래된 리뷰 버리기를 `InMemoryReviewStore` 단위 테스트로 확인한다(D-29). 놓치는 것: DB 제약(1차 후속).
- **컨트롤러 경계** (example), AC-1, AC-2, AC-3, AC-5, AC-6, AC-24: 검색 spec D-30처럼 `@WebMvcTest`에 실제 서비스와 메모리 저장소를 꽂아 Bean Validation(`placeId`의 문자·0·음수·`long` 범위 밖, 본문 500자·501자), 인증 없는 등록, ProblemDetail 상태 코드, 알 수 없는 속성 거부, 로그에 본문이 없음, 스위치가 꺼졌을 때 503을 확인한다. 잡는 것: 길이 경계.
- **FE 순수 로직과 정적 렌더** (example), AC-7: `src/domains/review/model`의 KST 날짜 변환(자정 경계)과 등록 요청 만들기(공백뿐이면 본문 없음)를 Vitest로 확인한다. 목록 항목, 홈 미리보기 3건과 "전체 보기", 빈 상태, 불러오기 실패 안내는 데이터 훅과 나눈 그리는 컴포넌트를 `renderToStaticMarkup`으로 확인한다(공통 UI 테스트와 같은 방식, D-31, D-32). 놓치는 것: 누르기·입력·스크롤 같은 상호작용(수동 확인).
- **수동 확인** AC-7: 장소 상세 하단 버튼 → 작성 화면 → 등록 → 토스트와 함께 들어오기 전 탭으로 복귀해 새 리뷰가 리뷰 탭 맨 위와 홈 미리보기 첫 줄에 보이는지, 상세의 "뒤로" 한 번에 검색 결과로 가는지, 홈 미리보기의 "전체 보기"가 리뷰 탭을 여는지, 목록 끝까지 스크롤하면 다음 페이지가 붙는지, 실패 때 입력이 남는지, 버튼을 연달아 눌러도 한 번만 등록되는지, 500자에서 더 입력되지 않는지 확인한다.

1차 후속

- **도메인 규칙** (example), AC-9, AC-12, AC-16: 방문일 정책은 고정 `Clock`으로 경계일과 KST 자정 전후를, 태그 규칙은 그룹(소음 축 4개 포함)·업종·개수 조합을, 금액은 경계값(0, 1,000,000, 1,000,001)을 단위 테스트로 확인한다.
- **컨트롤러 경계** (example), AC-8, AC-10, AC-11, AC-16, AC-19: 인증 헤더 유무, 404, 403, 409를 `@WebMvcTest`로 확인한다.
- **영속성** (example), AC-13, AC-17: 부분 유니크 위반의 409 변환, 동시 등록 두 건, 삭제 후 재작성은 H2로 재현되지 않아 Testcontainers의 PostgreSQL로 확인한다(D-29). `JpaReviewStore`가 메모리 저장소와 같은 정렬·커서 결과를 내는지도 함께 확인한다(D-27).
- **FE 순수 로직** (example), AC-15, AC-22: `src/domains/review/model`의 태그 선택 함수(같은 그룹 비활성화, 소음 축 4개)와 근처 판정 함수를 Vitest(`pnpm test`)로 확인한다(검색 spec D-30 방식, D-31). 태그 칩 비활성 표시는 정적 렌더로 확인한다(D-31).
- **사진** (manual), AC-18, AC-20: `infra/edge/test` 환경에서 Caddy를 거친 presigned 업로드(원본·썸네일)와 공개 읽기를 확인한다.
- **수동 확인** AC-22, AC-23: Figma 흐름(상세 → 위치 확인·오늘 작성 여부 모달 → 1/2·2/2단계 → 상세로 복귀, 검색 상태 유지).

## Out of scope

- 리뷰 자동 필터링(PRD 2차)(D-1)
- 취향 보정과 근거 장부(티켓 20), 장소 특징 추출·페르소나·임베딩·색인(D-1)
- 리뷰 변경 전달의 고도화(이벤트, 아웃박스)(D-17)
- 토큰 발급·저장·갱신, 관리자 권한, 닉네임 저장(회원 담당)(D-15)
- 장소 테이블, 장소 조회 인터페이스의 구현, 장소 상세 API(장소·검색 담당)(D-21)
- 공통 응답과 예외 형식, 모듈 경계 같은 BE 공용 규칙의 확정
- 위치 확인의 서버 처리(D-12)

## Open questions

다른 담당이나 팀이 정해야 하는 것들이다. 정해지면 결정 로그에 옮긴다. 구현을 막는 시점에 따라 나눴다.

### Walking Skeleton 전에 필요

인프라 담당
- `REVIEW_MOCK_ENABLED`를 env 계약(`docs/infra/contracts/env.md`)에 언제 올리나요? dev 배포에서 켜야 리뷰 API가 503이 아니다(D-27).

### 1차 후속 전에 필요

장소·검색 담당
- 장소 조회 인터페이스(D-21)는 어떤 모양으로 언제 제공하나요? Mock 장소(D-22)도 통과해야 한다. Mock은 검색 구현이 `be/src/main/resources/mock/places.json`에 둔다(검색 D-47, D-54).

회원 담당
- JWT 발급·저장·갱신은 어떻게 하나요? 인프라 BE 계약 #21과 프런트 계약 #9의 인증 쿠키 전제와 맞춰야 한다(D-15).
- 닉네임은 어떻게 조회하나요? 목록에 현재 닉네임을 보여야 한다(PRD AC-22).
- 관리자 권한은 어떻게 구분하나요?

취향·AI·검색 담당
- 공용 특징 코드 목록(D-16)은 누가 관리하나요? 태그 시드 마이그레이션이 이 코드를 참조하므로 마이그레이션을 머지하기 전에 정해야 한다.
- 일괄 처리가 리뷰 테이블을 직접 조회하는 방식(D-17)에 필요한 조회 조건과 시점을 함께 정해야 한다.
- 삭제·숨김·분석 제외된 리뷰 구절이 검색 카드의 `evidencePhrase`에 인용되지 않게 하는 쪽은 누구인가요?

BE 팀 공통
- 마이그레이션 전용 `migrate` 프로필(인프라 BE 계약 #9, 6.5절)은 언제 머지하나요? 리뷰 담당이 브랜치(`be/chore/migrate-profile-S15P31A302-18`)를 올렸다. 웹 앱은 DML 전용 계정으로 접속하고 Flyway를 꺼 두어(검색 D-40) 이 프로필이 없으면 `reviews` 테이블을 만들 수 없다. `db/migration/`을 바꾸는 MR은 인프라 담당 승인이 필요하다(인프라 10.8절).
- DB 공통 규칙 초안의 이름 규칙, 삭제 행 제외 방식, 마이그레이션 버전 형식을 언제 합의하나요? 1차 후속의 `reviews` 마이그레이션이 이를 따른다(D-28).
- Testcontainers 의존성은 누가 언제 `be/build.gradle`에 넣나요? 방식은 인프라 BE 계약 #13대로 Testcontainers다(D-29).
- `places`, `users` 테이블과 첫 마이그레이션은 누가 언제 만드나요? 리뷰의 작성자·장소 참조와 닉네임 조회가 여기에 달려 있다.
- 다른 모듈 테이블(`places`, `users`)로 FK를 거나요? Mock 장소를 리뷰할 수 있어야 하므로(D-22) FK를 걸면 Mock 장소가 `places`에 있어야 한다.
- 공통 응답과 예외 형식은 어떻게 정하나요? 리뷰는 오류 종류(중복, 방문일 범위, 태그 위반 등)를 FE가 구분할 수 있어야 한다(검색 D-10). 그 전까지는 임시 ProblemDetail로 진행한다.
- 모듈 경계 규칙은 무엇인가요? 루트 패키지는 팀 합의로 `kr.co.fitdining.api`이고(검색 D-32), 리뷰는 그 아래 `review`에 둔다(D-23).

인프라 담당
- BE는 브라우저가 쓰는 공개 호스트의 경로(`/fit-<env>-photos/`)로 presigned URL을 서명해야 한다(인프라 5.2절, 12.5절 #2). app env 계약에는 내부 주소 `S3_ENDPOINT`뿐인데 공개 호스트는 어떤 키로 받나요?
- Garage 스파이크(인프라 7.4절)의 presigned URL 확인 결과는 언제 나오나요? 실패하면 저장소가 바뀐다(D-9).

FE 공통 담당
- 방문일 달력(7-03)과 사진 고르기·미리보기 칸은 공통 UI 컴포넌트로 만드나요, 리뷰 도메인에서 만드나요? 지금 `@/shared/ui`에는 없다(D-31).

기획·디자인
- 이유 태그 최종 문구는 언제 확정되나요? 그 전까지는 임시 시드로 진행한다(D-5).
- 7-01에서 좋았던 점을 고르지 않았을 때 "다음" 비활성 상태와 "하나 이상 필수" 안내를 그려야 한다(D-5).
- 7-02(아쉬웠던 점)에 7-01 선택에 따른 비활성화 표시를 그려야 한다(D-5). 소음 축은 4개가 한 그룹이다.
- 7-04의 재방문 안내 문구("앞으로 이 장소와 비슷한 곳을 찾아드릴게요")를 바꿔야 한다. 재방문 의사는 추천에 쓰지 않는다(D-18).
- 6-11에 "기타"를 고르면 나타나는 설명 입력창을 그려야 한다. 설명의 최대 길이는 몇 자인가요?(D-11)

팀장
- 관리자 도구(Appsmith)는 관리자 API를 부르나요, DB에 직접 붙나요?

### 리뷰 담당이 준비할 것

- Walking Skeleton 전: Figma에 없는 한 화면 작성 폼을 간단히 그린다(D-31).
- Walking Skeleton: 장소 상세 화면(검색 담당, 2026-10-23 master 병합)에 리뷰 담당이 리뷰 탭, 홈 미리보기, 하단 버튼을 붙인다. 같은 MR에서 상세 화면 테스트의 "리뷰 탭은 없다"를 고치고 검색 담당을 리뷰어로 둔다(D-32).
- Walking Skeleton 뒤 1차 선행 작업: 다른 담당을 기다리지 않는 부분을 1차 작성 화면(`/place/review?id=`)에서 먼저 만든다. 방문일 정책(`Clock`, 범위), 재방문 의사·1인당 금액 입력, 근처 판정 함수와 7-E02, 닫기 확인(7-E03), 등록 실패 구분(7-E05, 7-E06)이 해당한다. 태그, 7-E01과 409, 사진은 각 질문이 풀린 뒤에 붙인다(D-4, D-6, D-12, D-31).
- 1차 후속 전: 임시 태그 시드 표(특징 코드, 문구, sentiment, 동시 선택 불가 그룹, 화면 묶음, 업종 노출)를 Figma 7-01·7-02 문구와 PRD FR-10 초안으로 만든다(D-5, AC-11, AC-12, AC-15).
- 1차 후속 전: Figma에 없는 화면(숨김 처리된 내 리뷰 표시, 작성 차단 안내)을 추가한다.
