# 방문 평가와 리뷰 (review)

Status: draft
Decisions: [decisions.md](decisions.md) · Glossary and ADRs: none

## Problem

회원은 다녀온 장소를 이유 태그로 평가하고, 그 평가가 장소의 공개 리뷰가 되기를 원한다. 리뷰는 게시물이면서 취향 보정(FR-14)과 장소 근거의 원본 데이터라서, 작성·수정·삭제·숨김이 공개 목록에는 즉시 반영되어야 한다(PRD FR-10, FR-11, FR-12).

이 spec은 Jira S15P31A302-18([Full] 리뷰)의 BE·FE를 다룬다. Walking Skeleton(31 리뷰 작성, 32 리뷰 확인)을 먼저 끝내고 1차 후속 기능을 붙인다(D-1). 화면은 Figma `핏다이닝` 파일의 UI/UX 페이지(장소 상세 6-xx, 방문 평가 7-xx와 각 예외 상태)를 따른다(D-20). 다른 담당과 함께 정해야 하는 항목은 결정하지 않고 Open questions에 둔다.

## Assumptions

1. 방문일은 KST 날짜이고 범위는 `오늘 - 1개월` 이상 `오늘` 이하다. 서버가 `Clock`으로 계산한다(D-4).
2. 이유 태그는 공용 특징 코드를 참조하고(D-17), 문구와 업종별 노출은 PRD FR-10 초안을 임시 시드로 쓴다. 기획이 문구를 확정하면 시드만 바꾼다(D-5).
3. 오류 응답, 알 수 없는 속성 거부, null 필드 생략, 컨트롤러 검증, 로그 규칙은 검색 spec이 정한 방식을 그대로 따른다(D-13).
4. FE는 검색 spec처럼 데이터를 브라우저 `fetch`로 가져오고 서버 전용 기능을 쓰지 않는다(D-8).
5. 사용자는 `Authorization` 헤더의 JWT로 식별한다(D-16). 토큰 발급과 Walking Skeleton 동안의 임시 식별은 회원 담당 결정을 기다린다.
6. 장소의 존재 여부와 이름·업종·역은 장소 기능의 조회 인터페이스로 확인한다(D-15). 장소 ID 타입과 닉네임 조회는 다른 담당의 결정을 기다린다.
7. Walking Skeleton에서 취향·장소 분석·검색 색인은 리뷰 테이블을 직접 조회해 변경을 가져간다(D-18).
8. 위치 확인은 기기에서만 계산하며 BE API가 없다(D-12).

## Usage

1. **리뷰 목록**: 장소 상세의 리뷰 탭(6-03)을 열면 `GET /api/v1/places/{placeId}/reviews`로 첫 페이지와 `totalCount`를 받아 "리뷰 12"와 항목을 그린다. 본인 리뷰("나 · 내 리뷰")에는 수정·삭제, 남의 리뷰에는 신고 메뉴가 뜬다(D-7).
2. **작성 진입**: 하단의 "방문 평가 남기기"를 누르면 비회원은 로그인 후 돌아온다. 회원은 위치 확인이 시작되고, 동시에 `GET /api/v1/places/{placeId}/review-form`으로 작성 화면 데이터를 받는다. 오늘 이미 리뷰를 썼으면 7-E01 모달, 근처 확인에 실패하면 7-E02 모달이 뜨고, 통과하면 작성 화면(`/place/review?id=`)으로 간다(D-8, D-12).
3. **작성**: 1/2단계에서 방문일과 좋았던 점(1개 이상), 아쉬웠던 점(선택)을 고르고, 2/2단계에서 재방문 의사, 본문, 사진, 1인당 금액을 입력한다. "등록하기"를 누르면 `POST /api/v1/places/{placeId}/reviews`가 한 번 나가고, 성공하면 장소 상세로 돌아가 새 리뷰가 목록 맨 위에 보인다(7-06)(D-4, D-5, D-6, D-8).
4. **사진**: 사진을 고르면 앱이 원본과 썸네일 두 벌로 줄이고 EXIF를 지운 뒤 `POST /api/v1/review-photos/upload-urls`로 받은 주소에 바로 올린다. 등록 요청에는 객체 키만 담는다. 목록은 썸네일을 보여 준다(D-9).
5. **수정·삭제**: 본인 리뷰는 본문과 사진만 고칠 수 있고, 삭제하면 목록에서 즉시 빠진다. 같은 방문일로 다시 쓸 수 있다(D-3, D-6).
6. **신고와 운영**: 회원은 사유를 골라 신고한다. 운영자는 관리자 API로 숨김, 분석 제외, 작성 차단과 각 해제를 하고 처리 기록이 남는다(D-11).

## Acceptance criteria

Walking Skeleton

- [ ] AC-1: `infra/local`의 Postgres를 띄우고 `SPRING_DATASOURCE_URL`, `SPRING_DATASOURCE_USERNAME`, `SPRING_DATASOURCE_PASSWORD`를 주면 BE가 기동한다. 공용 뼈대의 `build.gradle`과 datasource 설정은 바뀌지 않는다. (D-14)
- [ ] AC-2: `GET /api/v1/places/{placeId}/review-form`은 장소 이름·업종·역, 방문일 범위(KST), 이 사용자가 이 장소에 이미 쓴 방문일, 업종에 맞는 좋았어요·아쉬웠어요 태그와 각 태그의 그룹, 작성 가능 여부를 돌려준다. 없는 장소는 404 ProblemDetail이다. (D-4, D-5, D-15)
- [ ] AC-3: 유효한 요청으로 리뷰를 등록하면 201과 `reviewId`를 받고, 리뷰와 태그가 한 트랜잭션에 저장된다. (D-3)
- [ ] AC-4: 방문일이 미래이거나 1개월보다 이전이면 400 ProblemDetail이다. 경계일(오늘, 오늘 - 1개월)은 통과한다. (D-4)
- [ ] AC-5: 좋았어요 태그가 없거나, 업종에 노출되지 않는 태그가 있거나, 같은 그룹 태그가 둘 이상이면 400 ProblemDetail이다. 아쉬웠어요 태그는 없어도 된다. 소음 축 태그는 4개 중 하나만 고를 수 있다. (D-5)
- [ ] AC-6: 본문이 500자를 넘거나 1인당 금액이 0원 미만 또는 1,000,000원 초과면 400 ProblemDetail이다. 본문과 금액 없이도 등록된다. (D-6, D-13)
- [ ] AC-7: 같은 사용자·장소·방문일로 두 번 등록하면 두 번째는 409 ProblemDetail이고, 두 요청이 동시에 와도 한 건만 저장된다. (D-3)
- [ ] AC-8: 목록은 `created_at` 내림차순(같으면 `review_id` 내림차순)이고 커서로 다음 페이지를 받으며 페이지 사이에 중복이 없다. 항목은 현재 닉네임, 방문일, 재방문 의사, 태그(문구와 sentiment), 본문, 사진, `mine`을 담는다. (D-7)
- [ ] AC-9: 요청 본문에 정의되지 않은 속성이 있으면 400 ProblemDetail이다. 응답 JSON 키는 문서화된 필드를 벗어나지 않는다. (D-13)
- [ ] AC-10: 리뷰 등록과 조회를 처리한 뒤(400 포함) BE 로그에 요청 본문과 리뷰 본문이 나타나지 않는다. (D-13)
- [ ] AC-11: 작성 화면에서 태그를 고르면 같은 그룹의 다른 태그가 페이지(7-01, 7-02)와 관계없이 비활성화된다. 좋았던 점을 하나도 고르지 않으면 7-01의 "다음"이 비활성이다. 태그는 분위기·공간·이용·방문 목적 묶음으로 나뉘어 보인다. (D-5)
- [ ] AC-12: `Authorization` 헤더 없이 작성 화면 데이터나 등록을 요청하면 401 ProblemDetail이다. 목록은 헤더 없이도 조회되고 이때 `mine`은 모두 false다. (D-16)

1차 후속

- [ ] AC-13: 작성자는 본문과 사진만 수정할 수 있다. 다른 필드(1인당 금액 포함)를 보내면 400, 남의 리뷰는 403 ProblemDetail이다. 수정해도 목록 순서는 그대로다. (D-6, D-7)
- [ ] AC-14: 삭제하면 목록과 `totalCount`에서 즉시 빠지고, 같은 방문일로 다시 등록할 수 있다. (D-3)
- [ ] AC-15: 사진은 리뷰당 5장 이하이고 사진마다 원본과 썸네일 키가 있다. 업로드 확인에 실패한 키(없음, 크기 초과, 형식 불일치)가 있으면 400 ProblemDetail이다. 확정된 사진만 공개 경로로 읽힌다. (D-9)
- [ ] AC-16: 신고는 리뷰당 한 번만 가능하다. 두 번째는 409, 본인 리뷰 신고는 400 ProblemDetail이고, 신고만으로 숨겨지지 않는다. "기타"를 고르면 설명 입력창이 나타나고 설명 없이도 신고된다. "기타"가 아닌 사유에 설명을 보내면 400이다. (D-11)
- [ ] AC-17: 운영자가 숨기면 공개 목록에서 빠지고 작성자 본인에게는 `hidden: true`로 보이며, 그 리뷰의 사진은 공개 경로로 읽히지 않는다. 숨김은 분석 제외를 자동 적용하지 않는다. (D-10, D-11)
- [ ] AC-18: 숨김, 분석 제외, 작성 차단과 각 해제는 처리자·시각·동작을 처리 기록에 남긴다. 작성 차단된 사용자는 `review-form`에서 작성 불가로 안내받고 등록은 403 ProblemDetail이다. (D-11)
- [ ] AC-19: "방문 평가 남기기"를 누르면 위치 확인이 시작되고 "측정 거리 + GPS 정확도 ≤ 100m"면 작성 화면에 "방문 확인 완료"가 보인다. 실패하면 7-E02 모달이 뜨고 "그냥 쓰기"로 작성할 수 있다. 좌표와 결과를 어떤 요청·로그·분석 이벤트에도 싣지 않는다. (D-12)
- [ ] AC-20: 오늘 이미 리뷰를 쓴 장소에서 "방문 평가 남기기"를 누르면 7-E01 모달이 뜨고, "다른 날 고르기"를 누르면 방문일 선택(7-03)이 열리며 이미 쓴 날은 "작성함"으로 막혀 있다. (D-4, D-12)

## Implementation anchors

| Anchor | Action | Decision |
|---|---|---|
| `be/src/main/java/kr/co/fitdining/api/review/ReviewController.java#ReviewController` | new | D-2 |
| `be/src/main/java/kr/co/fitdining/api/review/ReviewService.java#ReviewService` | new | D-3 |
| `be/src/main/java/kr/co/fitdining/api/review/Review.java#Review` | new | D-3, D-6 |
| `be/src/main/java/kr/co/fitdining/api/review/VisitDatePolicy.java#VisitDatePolicy` | new | D-4 |
| `be/src/main/java/kr/co/fitdining/api/review/ReasonTagRule.java#ReasonTagRule` | new | D-5 |
| `be/src/main/resources/db/migration/` (리뷰 테이블 마이그레이션) | new | D-3, D-5 |
| `fe/src/app/place/review/page.tsx#ReviewWritePage` | new | D-8 |
| `fe/src/app/components/ReviewSection.tsx#ReviewSection` | new | D-8 |
| `fe/src/app/components/ReviewForm.tsx#ReviewForm` | new | D-5, D-8 |
| `fe/src/lib/reviewApi.ts#createReview` | new | D-8, D-16 |
| `fe/src/lib/reviewTags.ts#selectTag` | new | D-5 |
| `fe/src/lib/nearbyCheck.ts#isNearby` | new | D-12 |

BE 패키지는 검색 spec의 `kr.co.fitdining.api.place`를 본뜬 임시 위치다. 패키지 구조의 팀 규칙이 정해지면 그에 맞춘다. FE 폴더는 검색 spec D-12를 따른다.

## Interfaces

엔드포인트(오류는 ProblemDetail, 검색 spec D-10의 임시 형식):

| 메서드와 경로 | 인증 | 요청 | 응답 |
|---|---|---|---|
| `GET /api/v1/places/{placeId}/reviews` | 선택 | 쿼리 `cursor?` | `ReviewPage` |
| `GET /api/v1/places/{placeId}/review-form` | 필수 | 경로 `placeId` | `ReviewForm` |
| `POST /api/v1/places/{placeId}/reviews` | 필수 | `CreateReviewRequest` | 201 `{reviewId}` |
| `GET /api/v1/reviews/{reviewId}` | 필수(본인) | 경로 | `ReviewItem` |
| `PATCH /api/v1/reviews/{reviewId}` | 필수(본인) | `UpdateReviewRequest` | 204 |
| `DELETE /api/v1/reviews/{reviewId}` | 필수(본인) | 경로 | 204 |
| `POST /api/v1/review-photos/upload-urls` | 필수 | `{count}` (1~5) | `{uploads: PhotoUpload[]}` |
| `POST /api/v1/reviews/{reviewId}/reports` | 필수 | `ReportRequest` | 201 |
| `/api/v1/admin/...` | 관리자 | 신고 목록, 숨김·분석 제외·작성 차단과 해제, 처리 기록 | D-11 |

인증은 `Authorization: Bearer <JWT>`다(D-16).

```text
ReviewDtos (필드 목록만, 한 페이지 20건)
  ReviewPage          : totalCount(int), items(ReviewItem[]), nextCursor?
  ReviewItem          : reviewId, nickname, visitedAt(date), revisitIntent(bool),
                        tags(TagView[]), description?, photos({url, thumbUrl}[]),
                        mine(bool), hidden(bool)
  TagView             : tagId, label, sentiment(GOOD|BAD)
  ReviewForm          : place({name, categoryGroup, station}), visitDate({min, max, default}),
                        reviewedDates(date[]), tags({good: FormTag[], bad: FormTag[]}),
                        limits({descriptionMax: 500, photoMax: 5, spentPerPersonMax: 1000000}),
                        writable(bool)
  FormTag             : tagId, label, exclusiveGroup, displayGroup(분위기|공간|이용|방문 목적)
  ReportRequest       : reason(AD_SPAM|ABUSE|UNRELATED|OTHER), detail?(reason이 OTHER일 때만)
  PhotoUpload         : key, url, thumbKey, thumbUrl, expiresAt
  CreateReviewRequest : visitedAt, tagIds(1..), revisitIntent, description?(..500),
                        photos?({key, thumbKey}[], ..5), spentPerPerson?(0..1,000,000 정수)
  UpdateReviewRequest : description?, photos?({key, thumbKey}[], ..5)
```

`spentPerPerson`은 PRD상 화면 표시에 쓰지 않고 수정 화면에도 없어(6-07) 응답에 담지 않는다. 목록 정렬은 작성일 기준이지만 화면에 작성일이 없어(6-03) 응답에도 담지 않는다. `placeId`의 타입은 검색 spec과 같은 결정을 따른다(검색 D-24, 미결). 업종과 역 값은 검색 spec 가정 9의 enum과 같다.

데이터(리뷰 기능이 만드는 테이블, 이름은 팀 명명 규칙을 따른다):

```text
reviews        : review_id, user_id, place_id, visited_at(DATE), revisit_intent, description,
                 spent_per_person, created_at, updated_at,
                 deleted_at, hidden_at, analysis_excluded_at (TIMESTAMPTZ)
                 UNIQUE (user_id, place_id, visited_at) WHERE deleted_at IS NULL
                 INDEX (place_id, created_at DESC, review_id DESC) WHERE deleted_at IS NULL
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

- **도메인 규칙** (example), AC-4, AC-5, AC-6, AC-13: 방문일 정책은 고정 `Clock`으로 경계일과 KST 자정 전후를, 태그 규칙은 그룹(소음 축 4개 포함)·업종·개수 조합을, 금액은 경계값(0, 1,000,000, 1,000,001)을 순수 Java 단위 테스트로 확인한다. 잡는 것: 규칙 누락, 시간대 오류. 놓치는 것: DB 제약.
- **컨트롤러 경계** (example), AC-2, AC-4, AC-5, AC-9, AC-10, AC-12, AC-13, AC-16: 검색 spec D-30처럼 `@WebMvcTest`로 요청 검증, 인증 헤더 유무, ProblemDetail 상태 코드, 알 수 없는 속성 거부, 로그에 본문이 없음을 확인한다. 놓치는 것: DB 제약.
- **영속성** (example), AC-3, AC-7, AC-8, AC-14: 부분 유니크(삭제 후 재작성 포함), 동시 등록 두 건, 커서 페이지 경계는 H2로 재현되지 않아 실제 Postgres가 필요하다. 테스트 DB 방식은 팀 결정을 따른다(Open questions).
- **FE 순수 로직** (example), AC-11, AC-19: 태그 선택 함수(같은 그룹 비활성화, 소음 축 4개)와 근처 판정 함수를 Vitest로 확인한다(검색 spec D-30 방식).
- **사진** (manual), AC-15, AC-17: `infra/edge/test` 환경에서 Caddy를 거친 presigned 업로드(원본·썸네일)와 공개 읽기를 확인한다.
- **수동 확인** AC-19, AC-20: Figma 흐름(상세 → 위치 확인·오늘 작성 여부 모달 → 1/2·2/2단계 → 상세로 복귀, 검색 상태 유지).

## Out of scope

- 리뷰 자동 필터링(PRD 2차)(D-1)
- 취향 보정과 근거 장부(티켓 20), 장소 특징 추출·페르소나·임베딩·색인(D-1)
- 리뷰 변경 전달의 고도화(이벤트, 아웃박스)(D-18)
- 토큰 발급·저장·갱신, 관리자 권한, 닉네임 저장(회원 담당)(D-16)
- 장소 테이블, 장소 조회 인터페이스의 구현, 장소 상세 API(장소·검색 담당)(D-15)
- 공통 응답과 예외 형식, 패키지 구조, 테스트 DB 방식 같은 BE 공용 규칙의 확정
- 위치 확인의 서버 처리(D-12)

## Open questions

다른 담당이나 팀이 정해야 하는 것들이다. 정해지면 결정 로그에 옮긴다.

장소·검색 담당
- 장소 ID는 정수인가요, 문자열인가요? `reviews.place_id`의 타입이 여기에 달려 있다(검색 D-24).
- 검색 Mock 장소(`p-001` 등)에도 리뷰를 쓸 수 있어야 하나요? 그렇다면 Mock 장소가 DB에 있어야 한다.
- 장소 조회 인터페이스(D-15)는 어떤 모양으로 언제 제공하나요?
- 리뷰 API를 장소 경로 아래(`/api/v1/places/{placeId}/reviews`)에 두는 것에 동의하나요?(D-2)

회원 담당
- JWT 발급·저장·갱신은 어떻게 하나요? 인프라 BE 계약 #21과 프런트 계약 #9의 인증 쿠키 전제와 맞춰야 한다(D-16).
- 인증이 준비되기 전 Walking Skeleton에서 사용자를 어떻게 식별하나요?
- 닉네임은 어떻게 조회하나요? 목록에 현재 닉네임을 보여야 한다(PRD AC-22).
- 관리자 권한은 어떻게 구분하나요?

취향·AI·검색 담당
- 공용 특징 코드 목록(D-17)은 누가 관리하나요?
- 일괄 처리가 리뷰 테이블을 직접 조회하는 방식(D-18)에 필요한 조회 조건과 시점을 함께 정해야 한다.
- 삭제·숨김·분석 제외된 리뷰 구절이 검색 카드의 `evidencePhrase`에 인용되지 않게 하는 쪽은 누구인가요?

BE 팀 공통
- 공통 응답과 예외 형식은 어떻게 정하나요? 리뷰는 오류 종류(중복, 방문일 범위, 태그 위반 등)를 FE가 구분할 수 있어야 한다(검색 D-10).
- 패키지 구조와 모듈 경계 규칙은 무엇인가요(검색 D-4)?
- 통합 테스트의 DB는 로컬 스택에 붙나요, Testcontainers로 띄우나요?

인프라 담당
- presigned URL을 공개 호스트로 서명하려면 공개 S3 주소가 필요하다. 지금 env 계약에는 내부 주소 `S3_ENDPOINT`뿐이다. 어떻게 하나요?

기획·디자인
- 이유 태그 최종 문구는 언제 확정되나요?
- 7-02(아쉬웠던 점)에 7-01 선택에 따른 비활성화 표시를 그려야 한다(D-5). 소음 축은 4개가 한 그룹이다.
- 7-01에서 좋았던 점을 고르지 않았을 때 "다음" 비활성 상태와 "하나 이상 필수" 안내를 그려야 한다(D-5).
- 7-04의 재방문 안내 문구("앞으로 이 장소와 비슷한 곳을 찾아드릴게요")를 바꿔야 한다. 재방문 의사는 추천에 쓰지 않는다(D-20).
- 6-11에 "기타"를 고르면 나타나는 설명 입력창을 그려야 한다. 설명의 최대 길이는 몇 자인가요?(D-11)
- 숨김 처리된 내 리뷰 표시, 작성 차단 안내, 리뷰 다음 페이지 불러오기 화면은 리뷰 담당이 직접 추가한다.

팀장
- 관리자 도구(Appsmith)는 관리자 API를 부르나요, DB에 직접 붙나요?
