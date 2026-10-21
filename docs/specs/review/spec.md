# 방문 평가와 리뷰 (review)

Status: draft
Decisions: [decisions.md](decisions.md) · Glossary and ADRs: none

## Problem

회원은 다녀온 장소를 이유 태그로 평가하고, 그 평가가 장소의 공개 리뷰가 되기를 원한다. 리뷰는 게시물이면서 취향 보정(FR-14)과 장소 근거의 원본 데이터라서, 작성·수정·삭제·숨김이 공개 목록에는 즉시 반영되어야 한다(PRD FR-10, FR-11, FR-12).

이 spec은 Jira S15P31A302-18([Full] 리뷰)의 BE·FE를 다룬다. Walking Skeleton(31 리뷰 작성, 32 리뷰 확인)은 누구나 쓰는 익명 댓글 수준으로 줄여 본문만으로 쓰고 장소별로 읽는 데까지만 만들고, 로그인·방문일·이유 태그를 비롯한 나머지는 1차 후속에서 붙인다(D-1). 화면은 Figma `핏다이닝` 파일의 UI/UX 페이지(장소 상세 6-xx, 방문 평가 7-xx와 각 예외 상태)를 따르되, Walking Skeleton의 작성 화면은 Figma에 없는 한 화면 폼이다(D-8, D-18). 다른 담당과 함께 정해야 하는 항목은 결정하지 않고 Open questions에 둔다.

## Assumptions

1. Walking Skeleton은 사용자를 식별하지 않고 인증 없이 등록한다. 1차 후속부터 사용자는 `Authorization` 헤더의 JWT로 식별한다(D-1, D-15).
2. Walking Skeleton은 방문일이 없고 작성일을 보인다. 1차 후속의 방문일은 KST 날짜이고 범위는 `오늘 - 1개월` 이상 `오늘` 이하이며 서버가 `Clock`으로 계산한다(D-4).
3. 이유 태그는 1차 후속에서 붙는다. 태그는 공용 특징 코드를 참조하고(D-16), 문구와 업종별 노출은 PRD FR-10 초안을 임시 시드로 쓴다. 기획이 문구를 확정하면 시드만 바꾼다(D-5).
4. 오류 응답, 알 수 없는 속성 거부, null 필드 생략, 컨트롤러 검증, 로그 규칙은 검색 spec이 정한 방식을 그대로 따른다(D-13).
5. FE는 검색 spec처럼 데이터를 브라우저 `fetch`로 가져오고 서버 전용 기능을 쓰지 않는다(D-8).
6. Walking Skeleton은 장소 존재를 확인하지 않는다. 1차 후속부터 장소의 존재 여부와 이름·업종·역은 장소 기능의 조회 인터페이스로 확인한다(D-14, D-19).
7. 취향·장소 분석·검색 색인은 리뷰 테이블을 직접 조회해 변경을 가져간다(D-17). Walking Skeleton의 리뷰는 익명이고 이유 태그가 없어 취향 보정에 쓰이지 않으며, 1차 후속 전에 지운다(D-3).
8. 위치 확인은 기기에서만 계산하며 BE API가 없다(D-12).

## Usage

Walking Skeleton

1. **리뷰 목록**: 장소 상세의 리뷰 영역을 열면 `GET /api/v1/places/{placeId}/reviews`로 첫 페이지와 `totalCount`를 받아 작성일과 본문을 최신순으로 그린다. 다음 페이지는 커서로 받는다(D-7).
2. **작성**: "방문 평가 남기기"를 누르면 로그인 없이 작성 화면(`/place/review?id=`)이 열린다. 본문을 입력하고(비워도 된다) "등록하기"를 누르면 `POST /api/v1/places/{placeId}/reviews`가 한 번 나가고, 성공하면 장소 상세로 돌아가 새 리뷰가 목록 맨 위에 보인다(D-6, D-8).

1차 후속

3. **작성 흐름**: 비회원은 로그인 후 돌아온다. 작성 진입 때 위치 확인과 함께 `GET /api/v1/places/{placeId}/review-form`으로 작성 화면 데이터를 받는다. 오늘 이미 리뷰를 썼으면 7-E01 모달, 근처 확인에 실패하면 7-E02 모달이 뜬다. 작성은 Figma 2단계 흐름이다. 1/2단계에서 방문일과 좋았던 점(1개 이상), 아쉬웠던 점(선택)을 고르고, 2/2단계에서 재방문 의사, 본문, 사진, 1인당 금액을 입력한다. 같은 방문일로 이미 썼으면 409를 받아 방문일을 바꾸라고 안내한다(D-3, D-5, D-8, D-12).
4. **목록**: 작성일 대신 방문일이 보이고 닉네임, 재방문 의사, 태그, 사진이 더해진다. 본인 리뷰("나 · 내 리뷰")에는 수정·삭제, 남의 리뷰에는 신고 메뉴가 뜬다(D-7).
5. **사진**: 사진을 고르면 앱이 원본과 썸네일 두 벌로 줄이고 EXIF를 지운 뒤 `POST /api/v1/review-photos/upload-urls`로 받은 주소에 바로 올린다. 등록 요청에는 객체 키만 담는다. 목록은 썸네일을 보여 준다(D-9).
6. **수정·삭제**: 본인 리뷰는 본문과 사진만 고칠 수 있고, 삭제하면 목록에서 즉시 빠진다. 같은 방문일로 다시 쓸 수 있다(D-3, D-6).
7. **신고와 운영**: 회원은 사유를 골라 신고한다. 운영자는 관리자 API로 숨김, 분석 제외, 작성 차단과 각 해제를 하고 처리 기록이 남는다(D-11).

## Acceptance criteria

Walking Skeleton

- [ ] AC-1: 인증 헤더 없이 본문과 함께 리뷰를 등록하면 201과 `reviewId`를 받는다. 본문 없이도 등록되고, 같은 장소에 여러 번 등록할 수 있다. (D-1, D-6, D-15)
- [ ] AC-2: `placeId`가 장소 ID 형식에 맞지 않거나 너무 길면 400 ProblemDetail이다. 장소가 실제로 있는지는 확인하지 않아 Mock 장소 ID로도 등록된다. (D-14, D-19)
- [ ] AC-3: 본문이 500자를 넘으면 400 ProblemDetail이다. 공백뿐인 본문은 본문 없음으로 저장된다. (D-6)
- [ ] AC-4: 목록은 `created_at` 내림차순(같으면 `review_id` 내림차순)이고 커서로 20건씩 다음 페이지를 받으며 페이지 사이에 중복이 없다. 항목은 `reviewId`, 작성 시각, 본문을 담고 `totalCount`는 삭제되지 않은 리뷰 수다. (D-7)
- [ ] AC-5: 요청 본문에 정의되지 않은 속성(예: `userId`, `visitedAt`)이 있으면 400 ProblemDetail이다. 응답 JSON 키는 문서화된 필드를 벗어나지 않는다. (D-13)
- [ ] AC-6: 리뷰 등록과 조회를 처리한 뒤(400 포함) BE 로그에 요청 본문과 리뷰 본문이 나타나지 않는다. (D-13)
- [ ] AC-7: 작성 화면은 본문 입력 하나이고, 본문이 500자를 넘거나 등록 요청이 처리 중이면 "등록하기"가 비활성이다. 등록에 성공하면 장소 상세로 돌아가 새 리뷰가 목록 맨 위에 보이고, 실패하면 화면에 오류 안내가 뜨고 입력이 남아 있다. 목록은 작성일을 KST 날짜로 보이고, 목록 끝에서 다음 페이지를 불러올 수 있다. (D-7, D-8)

1차 후속

- [ ] AC-8: 등록은 로그인한 사용자만 할 수 있다. `Authorization` 헤더 없이 등록이나 작성 화면 데이터를 요청하면 401 ProblemDetail이고, 목록은 헤더 없이도 조회된다. 리뷰에 작성자가 저장되고 목록 항목은 작성일 대신 방문일과 현재 닉네임을 담는다. (D-7, D-15)
- [ ] AC-9: 방문일이 KST 오늘보다 미래이거나 `오늘 - 1개월`보다 이전이면 400 ProblemDetail이다. 경계일(오늘, 오늘 - 1개월)은 통과한다. (D-4)
- [ ] AC-10: 없는 장소에 등록하거나 작성 화면 데이터를 요청하면 404 ProblemDetail이다. Mock 장소는 통과한다. (D-14, D-19)
- [ ] AC-11: `GET /api/v1/places/{placeId}/review-form`은 장소 이름·업종·역, 방문일 범위(KST), 이 사용자가 이 장소에 이미 쓴 방문일, 업종에 맞는 좋았어요·아쉬웠어요 태그와 각 태그의 그룹, 작성 가능 여부를 돌려준다. (D-4, D-5, D-14)
- [ ] AC-12: 등록 요청에 이유 태그, 재방문 의사, 1인당 금액이 더해진다. 좋았어요 태그가 없거나, 업종에 노출되지 않는 태그가 있거나, 같은 그룹 태그가 둘 이상이면 400이다. 아쉬웠어요 태그는 없어도 된다. 소음 축 태그는 4개 중 하나만 고를 수 있다. 1인당 금액이 0원 미만 또는 1,000,000원 초과면 400이고 금액 없이도 등록된다. 리뷰와 태그는 한 트랜잭션에 저장된다. (D-3, D-5, D-6)
- [ ] AC-13: 같은 사용자·장소·방문일로 두 번 등록하면 두 번째는 409 ProblemDetail이고, 두 요청이 동시에 와도 한 건만 저장된다. 다른 오류(없는 장소 등)는 409로 바뀌지 않는다. FE는 409를 받으면 "이 날짜에는 이미 리뷰를 남겼어요"를 보여 주고 입력을 남긴다. (D-3, D-8)
- [ ] AC-14: 목록 항목에 재방문 의사, 태그(문구와 sentiment), 사진, `mine`, `hidden`이 더해진다. 헤더 없이 조회하면 `mine`은 모두 false다. (D-7)
- [ ] AC-15: 작성 화면은 Figma 2단계 흐름이다. 태그를 고르면 같은 그룹의 다른 태그가 페이지(7-01, 7-02)와 관계없이 비활성화된다. 좋았던 점을 하나도 고르지 않으면 7-01의 "다음"이 비활성이다. 태그는 분위기·공간·이용·방문 목적 묶음으로 나뉘어 보인다. 작성 중 닫으면 7-E03, 등록 실패는 7-E05와 7-E06으로 나뉜다. (D-5, D-8)
- [ ] AC-16: 작성자는 본문과 사진만 수정할 수 있다. 다른 필드(1인당 금액 포함)를 보내면 400, 남의 리뷰는 403 ProblemDetail이다. 수정해도 목록 순서는 그대로다. (D-6, D-7)
- [ ] AC-17: 삭제하면 목록과 `totalCount`에서 즉시 빠지고, 같은 방문일로 다시 등록할 수 있다. (D-3)
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
| `be/src/main/java/kr/co/fitdining/api/review/ReviewService.java#ReviewService` | new | WS | D-3 |
| `be/src/main/java/kr/co/fitdining/api/review/Review.java#Review` | new | WS | D-3, D-6 |
| `be/src/main/resources/db/migration/` (`reviews` 테이블) | new | WS | D-3 |
| `fe/src/app/place/review/page.tsx#ReviewWritePage` | new | WS | D-8 |
| `fe/src/app/components/ReviewSection.tsx#ReviewSection` | new | WS | D-8 |
| `fe/src/lib/reviewApi.ts#createReview` | new | WS | D-8 |
| `be/src/main/java/kr/co/fitdining/api/review/VisitDatePolicy.java#VisitDatePolicy` | new | 1차 | D-4 |
| `be/src/main/java/kr/co/fitdining/api/review/ReasonTagRule.java#ReasonTagRule` | new | 1차 | D-5 |
| `be/src/main/resources/db/migration/` (익명 리뷰 삭제, 작성자·방문일, 중복 금지 인덱스, 태그·사진·신고·운영 테이블) | new | 1차 | D-3, D-5 |
| `fe/src/app/components/ReviewForm.tsx#ReviewForm` | new | 1차 | D-5, D-8 |
| `fe/src/lib/reviewTags.ts#selectTag` | new | 1차 | D-5 |
| `fe/src/lib/nearbyCheck.ts#isNearby` | new | 1차 | D-12 |

BE 패키지는 검색 spec의 `kr.co.fitdining.api.place`를 본뜬 임시 위치다. 패키지 구조의 팀 규칙이 정해지면 그에 맞춘다. FE 폴더는 검색 spec D-12를 따른다.

## Interfaces

엔드포인트(오류는 ProblemDetail, 검색 spec D-10의 임시 형식):

| 메서드와 경로 | 단계 | 인증 | 요청 | 응답 |
|---|---|---|---|---|
| `GET /api/v1/places/{placeId}/reviews` | WS | 없음(1차부터 선택) | 쿼리 `cursor?` | `ReviewPage` |
| `POST /api/v1/places/{placeId}/reviews` | WS | 없음(1차부터 필수) | `CreateReviewRequest` | 201 `{reviewId}` |
| `GET /api/v1/places/{placeId}/review-form` | 1차 | 필수 | 경로 `placeId` | `ReviewForm` |
| `GET /api/v1/reviews/{reviewId}` | 1차 | 필수(본인) | 경로 | `ReviewItem` |
| `PATCH /api/v1/reviews/{reviewId}` | 1차 | 필수(본인) | `UpdateReviewRequest` | 204 |
| `DELETE /api/v1/reviews/{reviewId}` | 1차 | 필수(본인) | 경로 | 204 |
| `POST /api/v1/review-photos/upload-urls` | 1차 | 필수 | `{count}` (1~5) | `{uploads: PhotoUpload[]}` |
| `POST /api/v1/reviews/{reviewId}/reports` | 1차 | 필수 | `ReportRequest` | 201 |
| `/api/v1/admin/...` | 1차 | 관리자 | 신고 목록, 숨김·분석 제외·작성 차단과 해제, 처리 기록 | D-11 |

1차 후속의 인증은 `Authorization: Bearer <JWT>`다(D-15).

```text
ReviewDtos (필드 목록만, 한 페이지 20건)

Walking Skeleton
  ReviewPage          : totalCount(int), items(ReviewItem[]), nextCursor?
  ReviewItem          : reviewId, createdAt(KST 오프셋 시각), description?
  CreateReviewRequest : description?(..500)

1차 후속에서 바꾸거나 더하는 것
  ReviewItem          : createdAt 대신 visitedAt(date), + nickname, revisitIntent(bool),
                        tags(TagView[]), photos({url, thumbUrl}[]), mine(bool), hidden(bool)
  CreateReviewRequest : + visitedAt(date), tagIds(1..), revisitIntent,
                        photos?({key, thumbKey}[], ..5), spentPerPerson?(0..1,000,000 정수)
  TagView             : tagId, label, sentiment(GOOD|BAD)
  ReviewForm          : place({name, categoryGroup, station}), visitDate({min, max, default}),
                        reviewedDates(date[]), tags({good: FormTag[], bad: FormTag[]}),
                        limits({descriptionMax: 500, photoMax: 5, spentPerPersonMax: 1000000}),
                        writable(bool)
  FormTag             : tagId, label, exclusiveGroup, displayGroup(분위기|공간|이용|방문 목적)
  ReportRequest       : reason(AD_SPAM|ABUSE|UNRELATED|OTHER), detail?(reason이 OTHER일 때만)
  PhotoUpload         : key, url, thumbKey, thumbUrl, expiresAt
  UpdateReviewRequest : description?, photos?({key, thumbKey}[], ..5)
```

`spentPerPerson`은 PRD상 화면 표시에 쓰지 않고 수정 화면에도 없어(6-07) 응답에 담지 않는다. 목록 정렬은 작성일 기준이다. Walking Skeleton은 작성일을 보이고, 1차 후속은 화면(6-03)에 방문일만 있어 작성일을 응답에서 뺀다. `placeId`의 타입은 검색 spec과 같은 결정을 따른다(검색 D-24, 미결). 업종과 역 값은 검색 spec 가정 9의 enum과 같다.

데이터(리뷰 기능이 만드는 테이블, 이름은 팀 명명 규칙을 따른다):

```text
Walking Skeleton
reviews        : review_id, place_id, description(VARCHAR(500), NULL 허용),
                 created_at, updated_at, deleted_at (TIMESTAMPTZ)
                 INDEX (place_id, created_at DESC, review_id DESC) WHERE deleted_at IS NULL

1차 후속에서 더하는 것(새 마이그레이션, 먼저 Walking Skeleton 리뷰를 지운다)
reviews        : + user_id, visited_at(DATE) (NOT NULL)
                 + UNIQUE (user_id, place_id, visited_at) WHERE deleted_at IS NULL
                 + revisit_intent, spent_per_person, hidden_at, analysis_excluded_at
                 + CHECK (spent_per_person BETWEEN 0 AND 1000000)
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

- **도메인 규칙** (example), AC-2, AC-3: `placeId` 형식·길이, 본문의 빈 값·공백(본문 없음으로 정규화)·500자·501자를 순수 Java 단위 테스트로 확인한다. 잡는 것: 길이 경계. 놓치는 것: DB 제약.
- **컨트롤러 경계** (example), AC-1, AC-2, AC-3, AC-5, AC-6: 검색 spec D-30처럼 `@WebMvcTest`로 요청 검증, 인증 없는 등록, ProblemDetail 상태 코드, 알 수 없는 속성 거부, 로그에 본문이 없음을 확인한다. 놓치는 것: DB 제약.
- **영속성** (example), AC-1, AC-4: 저장과 커서 페이지 경계(같은 `created_at` 포함)를 실제 Postgres로 확인한다. 마이그레이션의 부분 인덱스(`WHERE deleted_at IS NULL`)는 H2에서 돌지 않는다. 테스트 DB 방식은 팀 결정을 따른다(Open questions).
- **수동 확인** AC-7: 장소 상세 → 작성 화면 → 등록 → 상세로 복귀해 목록 맨 위에 보이는지, 실패 때 입력이 남는지, 버튼을 연달아 눌러도 한 번만 등록되는지, 작성일이 KST 날짜로 보이는지 확인한다.

1차 후속

- **도메인 규칙** (example), AC-9, AC-12, AC-16: 방문일 정책은 고정 `Clock`으로 경계일과 KST 자정 전후를, 태그 규칙은 그룹(소음 축 4개 포함)·업종·개수 조합을, 금액은 경계값(0, 1,000,000, 1,000,001)을 단위 테스트로 확인한다.
- **컨트롤러 경계** (example), AC-8, AC-10, AC-11, AC-16, AC-19: 인증 헤더 유무, 404, 403, 409를 `@WebMvcTest`로 확인한다.
- **영속성** (example), AC-13, AC-17: 부분 유니크 위반의 409 변환, 동시 등록 두 건, 삭제 후 재작성은 H2로 재현되지 않아 실제 Postgres가 필요하다.
- **FE 순수 로직** (example), AC-15, AC-22: 태그 선택 함수(같은 그룹 비활성화, 소음 축 4개)와 근처 판정 함수를 Vitest로 확인한다(검색 spec D-30 방식).
- **사진** (manual), AC-18, AC-20: `infra/edge/test` 환경에서 Caddy를 거친 presigned 업로드(원본·썸네일)와 공개 읽기를 확인한다.
- **수동 확인** AC-22, AC-23: Figma 흐름(상세 → 위치 확인·오늘 작성 여부 모달 → 1/2·2/2단계 → 상세로 복귀, 검색 상태 유지).

## Out of scope

- 리뷰 자동 필터링(PRD 2차)(D-1)
- 취향 보정과 근거 장부(티켓 20), 장소 특징 추출·페르소나·임베딩·색인(D-1)
- 리뷰 변경 전달의 고도화(이벤트, 아웃박스)(D-17)
- 토큰 발급·저장·갱신, 관리자 권한, 닉네임 저장(회원 담당)(D-15)
- 장소 테이블, 장소 조회 인터페이스의 구현, 장소 상세 API(장소·검색 담당)(D-14)
- 공통 응답과 예외 형식, 패키지 구조, 테스트 DB 방식 같은 BE 공용 규칙의 확정
- 위치 확인의 서버 처리(D-12)

## Open questions

다른 담당이나 팀이 정해야 하는 것들이다. 정해지면 결정 로그에 옮긴다. 구현을 막는 시점에 따라 나눴다.

### Walking Skeleton 전에 필요

장소·검색 담당
- 장소 ID는 정수인가요, 문자열인가요? `reviews.place_id`의 타입과 `placeId` 형식 검사(AC-2)가 여기에 달려 있다(검색 D-24).
- 공용 ProblemDetail 처리 클래스와 JSON 설정(알 수 없는 속성 거부, null 생략)은 검색 구현이 먼저 머지하나요? 리뷰가 먼저 필요해지면 누가 만드나요?(D-13)
- 로컬에서 FE가 BE를 부르는 방법은 무엇인가요(검색 D-28)? SSR로 정해져 개발 서버 프록시를 쓸 수 있다(인프라 12.5절 #2).

BE 팀 공통
- DB 공통 규칙 초안의 이름 규칙, 삭제 행 제외 방식, 마이그레이션 버전 형식을 언제 합의하나요? Walking Skeleton의 `reviews` 마이그레이션이 이를 따른다.
- 통합 테스트의 DB는 로컬 스택에 붙나요, Testcontainers로 띄우나요? 영속성 확인(AC-1, AC-4)에 필요하다.

### 1차 후속 전에 필요

장소·검색 담당
- 장소 조회 인터페이스(D-14)는 어떤 모양으로 언제 제공하나요? Mock 장소(D-19)도 통과해야 한다. Mock은 지금 `be/src/main/resources/mock/places.json`에만 있다(검색 D-16).
- FE Vitest 설정은 검색 구현이 먼저 머지하나요?(D-13)

회원 담당
- JWT 발급·저장·갱신은 어떻게 하나요? 인프라 BE 계약 #21과 프런트 계약 #9의 인증 쿠키 전제와 맞춰야 한다(D-15).
- 닉네임은 어떻게 조회하나요? 목록에 현재 닉네임을 보여야 한다(PRD AC-22).
- 관리자 권한은 어떻게 구분하나요?

취향·AI·검색 담당
- 공용 특징 코드 목록(D-16)은 누가 관리하나요? 태그 시드 마이그레이션이 이 코드를 참조하므로 마이그레이션을 머지하기 전에 정해야 한다.
- 일괄 처리가 리뷰 테이블을 직접 조회하는 방식(D-17)에 필요한 조회 조건과 시점을 함께 정해야 한다.
- 삭제·숨김·분석 제외된 리뷰 구절이 검색 카드의 `evidencePhrase`에 인용되지 않게 하는 쪽은 누구인가요?

BE 팀 공통
- `places`, `users` 테이블과 첫 마이그레이션은 누가 언제 만드나요? 리뷰의 작성자·장소 참조와 닉네임 조회가 여기에 달려 있다.
- 다른 모듈 테이블(`places`, `users`)로 FK를 거나요? Mock 장소를 리뷰할 수 있어야 하므로(D-19) FK를 걸면 Mock 장소가 `places`에 있어야 한다.
- 공통 응답과 예외 형식은 어떻게 정하나요? 리뷰는 오류 종류(중복, 방문일 범위, 태그 위반 등)를 FE가 구분할 수 있어야 한다(검색 D-10). 그 전까지는 임시 ProblemDetail로 진행한다.
- 패키지 구조와 모듈 경계 규칙은 무엇인가요(검색 D-4)? 그 전까지는 임시 패키지에 둔다.

인프라 담당
- BE는 브라우저가 쓰는 공개 호스트의 경로(`/fit-<env>-photos/`)로 presigned URL을 서명해야 한다(인프라 5.2절, 12.5절 #2). app env 계약에는 내부 주소 `S3_ENDPOINT`뿐인데 공개 호스트는 어떤 키로 받나요?
- Garage 스파이크(인프라 7.4절)의 presigned URL 확인 결과는 언제 나오나요? 실패하면 저장소가 바뀐다(D-9).

기획·디자인
- 이유 태그 최종 문구는 언제 확정되나요? 그 전까지는 임시 시드로 진행한다(D-5).
- 7-01에서 좋았던 점을 고르지 않았을 때 "다음" 비활성 상태와 "하나 이상 필수" 안내를 그려야 한다(D-5).
- 7-02(아쉬웠던 점)에 7-01 선택에 따른 비활성화 표시를 그려야 한다(D-5). 소음 축은 4개가 한 그룹이다.
- 7-04의 재방문 안내 문구("앞으로 이 장소와 비슷한 곳을 찾아드릴게요")를 바꿔야 한다. 재방문 의사는 추천에 쓰지 않는다(D-18).
- 6-11에 "기타"를 고르면 나타나는 설명 입력창을 그려야 한다. 설명의 최대 길이는 몇 자인가요?(D-11)

팀장
- 관리자 도구(Appsmith)는 관리자 API를 부르나요, DB에 직접 붙나요?

### 리뷰 담당이 준비할 것

- Walking Skeleton 전: Figma에 없는 한 화면 작성 폼과 리뷰 다음 페이지 불러오기를 간단히 그린다(D-8).
- 1차 후속 전: 임시 태그 시드 표(특징 코드, 문구, sentiment, 동시 선택 불가 그룹, 화면 묶음, 업종 노출)를 Figma 7-01·7-02 문구와 PRD FR-10 초안으로 만든다(D-5, AC-11, AC-12, AC-15).
- 1차 후속 전: Walking Skeleton 리뷰를 지우는 마이그레이션(또는 공용 DB 초기화)을 1차 마이그레이션 앞에 준비한다(D-3).
- 1차 후속 전: Figma에 없는 화면(숨김 처리된 내 리뷰 표시, 작성 차단 안내)을 추가한다.
