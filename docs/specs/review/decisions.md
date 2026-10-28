# review decisions

Glossary: none · ADRs: none

리뷰 담당이 정한 결정만 둔다. 다른 담당이나 팀이 정해야 하는 항목은 [spec.md](spec.md)의 Open questions에 있다.

## D-1 범위와 단계
- Status: settled
- Decision: Jira S15P31A302-18의 BE·FE를 다룬다. Walking Skeleton(31 작성, 32 확인)은 누구나 쓰는 익명 댓글 수준이다. 사용자를 식별하지 않고 본문(선택)만으로 작성하며, 장소별 목록(작성일, 본문, 커서 페이지)을 보여 주고, 작성 화면은 한 화면 폼이다. 장소 존재와 중복은 확인하지 않는다. 1차 후속으로 로그인과 작성자 저장, 닉네임, 방문일, 장소 존재 확인, 중복 금지, 이유 태그, 재방문 의사, 1인당 금액, 작성 화면 데이터(`review-form`), Figma 2단계 흐름과 위치 확인, 사진, 수정·삭제, 신고·운영, 작성 차단을 붙인다(2026-10-21). Walking Skeleton의 익명 리뷰는 시험 데이터로 보고 메모리에만 두며 1차 후속으로 옮기지 않는다(D-27). 익명 쓰기는 누구나 반복해서 등록할 수 있으므로 Walking Skeleton 기간에만 둔다.
- Rejected: Walking Skeleton에 태그 조회·태그 검증·2단계 흐름 포함(2026-10-20 범위), 로그인 사용자·방문일·중복 금지 포함(2026-10-21 오전 범위) → 다른 담당의 결정(특징 코드 목록, 사용자 식별, 닉네임 조회 등)을 기다리는 항목이 많아, 끝에서 끝까지 연결되는 가장 작은 기능을 먼저 만든다. 리뷰 자동 필터링 → PRD 2차 범위다. 취향 보정과 근거 장부 → 티켓 20. 장소 특징 추출·페르소나·색인 → 다른 담당이다.

## D-2 엔드포인트
- Status: settled
- Decision: 장소별 목록·작성 화면 데이터·등록은 `/api/v1/places/{placeId}/reviews`, `/api/v1/places/{placeId}/review-form`, 리뷰 하나는 `/api/v1/reviews/{reviewId}`, 사진 업로드 주소는 `/api/v1/review-photos/upload-urls`, 운영은 `/api/v1/admin/...`이다. 리뷰는 장소의 하위 자원이라 장소 경로 아래에 두고, 컨트롤러는 리뷰 기능에 둔다. 검색 spec의 `/api/v1` 접두사와 복수형 경로(검색 D-23)를 따르고, 장소 상세 응답에는 리뷰를 넣지 않는다(검색 D-24는 상세 응답에 장소 고유 정보만 둔다).
- 장소 경로 아래에 두는 것은 확정이다(2026-10-21).
- Rejected: `/api/v1/reviews?placeId=` → 장소와 리뷰의 관계가 경로에 드러나지 않는다. 장소 상세 응답에 리뷰 포함 → 검색 담당의 DTO를 바꾸고 페이지를 나눌 수 없다.

## D-3 리뷰 상태와 중복 금지
- Status: superseded by D-28
- Decision: 삭제, 공개 숨김, 분석 제외는 서로 독립이라(PRD AC-13) 세 시각 컬럼(`deleted_at`, `hidden_at`, `analysis_excluded_at`)으로 둔다. 삭제는 soft delete이고, 같은 방문일 재작성(FR-11)을 위해 `(user_id, place_id, visited_at) WHERE deleted_at IS NULL` 부분 유니크 인덱스를 마이그레이션 SQL로 만든다. 동시 등록은 이 제약이 막는다. 서비스는 `saveAndFlush`로 저장해 그 자리에서 `DataIntegrityViolationException`을 받고, 원인 예외의 제약 이름이 이 인덱스일 때만 409로 바꾼다. 다른 제약 위반은 그대로 둔다. PostgreSQL은 제약 위반 뒤 트랜잭션을 더 쓸 수 없으므로 잡은 뒤 다른 작업을 잇지 않는다. 저장 전 조회는 하지 않는다. 리뷰와 태그는 한 트랜잭션에 저장한다. Walking Skeleton은 사용자와 방문일이 없어 `deleted_at`만 두고 중복을 막지 않는다. 1차 후속 마이그레이션은 Walking Skeleton 리뷰를 지운 뒤 `user_id`·`visited_at`(NOT NULL), 숨김·분석 제외 컬럼, 부분 유니크 인덱스를 더한다.
- Rejected: 저장 전 `exists` 조회로 막기 → 두 요청이 함께 조회를 통과하면 둘 다 저장된다. Walking Skeleton 익명 리뷰를 남기고 `user_id`·`visited_at`을 NULL 허용으로 추가 → 중복 금지와 목록 표시에 익명 예외가 계속 남는다. status 단일 컬럼 → 숨김과 분석 제외를 동시에 표현할 수 없다. 하드 삭제 → 일괄 처리가 삭제된 리뷰를 알아볼 수 없다(D-17).

## D-4 방문일
- Status: settled
- Decision: 방문일은 1차 후속부터 받는다. Walking Skeleton은 방문일이 없고 목록에 작성일(`created_at`의 KST 날짜)을 보인다. 방문일은 KST `DATE`이고 기본값은 오늘이며 범위는 `today.minusMonths(1)` 이상 `today` 이하다. 서버는 주입한 `Clock`(Asia/Seoul)으로 계산하고(인프라 BE 계약 #6의 `TZ=Asia/Seoul`), 1차 후속의 작성 화면 데이터에 범위와 이 사용자가 이 장소에 이미 쓴 방문일을 내려 달력에서 미리 막는다.
- Rejected: `LocalDate.now()` 직접 호출 → 서버 시간대에 따라 하루 어긋날 수 있고 테스트할 수 없다.

## D-5 이유 태그 검증
- Status: settled
- Decision: 1차 후속부터 적용한다(D-1). 태그는 특징 코드(D-16), 문구, 좋았어요·아쉬웠어요(`sentiment`), 동시 선택 불가 그룹(`exclusive_group`), 화면 묶음(`display_group`: 분위기, 공간, 이용, 방문 목적), 사용 여부를 데이터로 갖고, 업종 노출은 `tag_categories`로 둔다. 서버는 좋았어요 태그 1개 이상(아쉬웠어요는 선택), 업종에 노출되는 태그만, 그룹당 하나만을 검증한다. 그룹은 L2·L3에서 같은 특징의 좋았어요·아쉬웠어요 한 쌍이고, 소음 축(L1)은 4개("조용해서 좋았어요", "활기차서 좋았어요", "너무 시끄러웠어요", "너무 썰렁했어요")가 한 그룹이다. 작성 화면은 좋았던 점(7-01)과 아쉬웠던 점(7-02)이 다른 페이지라도 같은 그룹의 다른 태그를 비활성화한다. 예를 들어 7-01에서 "조용해서 좋았어요"를 고르면 7-02의 소음 축 태그 3개가 비활성이다. 좋았던 점을 하나도 고르지 않으면 7-01의 "다음"이 비활성이다. 문구와 노출은 PRD FR-10 초안으로 임시 시드를 두고 기획 확정 문구로 바꾼다.
- PRD FR-10은 이유 태그를 좋았어요·아쉬웠어요 구분 없이 1개 이상 필수로 두지만, 리뷰는 좋았어요 1개 이상을 유지한다. PRD와 대조한 뒤 리뷰 담당이 확인한 결정이다(2026-10-26). 태그 목록과 업종별 노출은 아직 확정되지 않아 PRD FR-10 초안을 임시 시드로 쓴다(D-36). Figma 7-01·7-02는 카페 화면이라 그 22개가 PRD 노출 표의 카페 태그와 같다(2026-10-27).
- Rejected: 소음 축을 쌍만 배타 → "조용해서 좋았어요"와 "활기차서 좋았어요"를 함께 고를 수 있어 모순된 평가가 된다. 좋았어요·아쉬웠어요 합산 1개 이상(PRD FR-10 문구) → 2단계 작성 흐름에서 좋았던 점을 먼저 고르게 하는 디자인에 맞춰 좋았어요 1개 이상으로 정했다(2026-10-20). 페이지가 다르면 비활성화하지 않기 → 서버가 400을 돌려줘 작성 끝에서야 실패한다. 태그를 코드 상수로 관리 → 문구와 노출이 바뀔 때마다 배포가 필요하다.

## D-6 본문, 수정 범위와 1인당 금액
- Status: settled
- Decision: 본문은 Walking Skeleton부터 선택 입력이고 최대 500자다. 공백만 있으면 본문 없음(null)으로 저장한다(2026-10-21). 그래서 Walking Skeleton에서는 작성일만 있는 빈 리뷰도 등록된다. 작성자는 본문과 사진만 고친다(PRD AC-10). 방문일, 태그, 재방문 의사, 1인당 금액은 고칠 수 없고, 수정 화면(Figma 6-07)에는 본문과 사진만 보인다. 엔티티는 setter 대신 본문·사진 수정 메서드만 연다. 수정은 `updated_at`만 바꾸고 목록 순서(`created_at`)는 그대로다. 분석 제외는 수정해도 풀리지 않는다(FR-12). 1인당 금액은 1차 후속에서 붙는 선택 입력이고 0원 이상 1,000,000원 이하의 정수다. 빈칸은 값 없음(null)이다.
- Rejected: Walking Skeleton에서 본문 필수 → 1차 후속에서 다시 선택으로 바꾸면 컬럼 변경 마이그레이션이 하나 더 필요하고, PRD FR-10도 본문을 선택으로 둔다. 1인당 금액 수정 허용 → PRD와 다르다. 상한 없음 → 0을 더 누르는 오타가 그대로 쌓인다.

## D-7 목록
- Status: superseded by D-24
- Decision: 장소별로 `created_at DESC, review_id DESC` 정렬, 불투명 커서, 한 번에 20건이다(검색 D-8과 같은 페이지 크기). 조건은 삭제되지 않았고, 숨김이 아니거나 조회자 본인의 리뷰다. `totalCount`는 공개 리뷰 수(삭제·숨김 제외)다. Walking Skeleton 항목은 `reviewId`, 작성 시각(`createdAt`), 본문이고 화면은 작성일을 보인다. 1차 후속에서 작성 시각을 방문일로 바꾸고, 현재 닉네임, 재방문 의사, 태그와 `sentiment`, 사진, `mine`, `hidden`을 더한다. 화면(Figma 6-03)은 날짜로 방문일만 보이고, 좋았어요 태그와 아쉬웠어요 태그("아쉬움" 표시)를 구분해 그리며, 본인 리뷰는 닉네임 대신 "나 · 내 리뷰"로 보인다.
- Rejected: offset 페이지 → 새 리뷰가 올라오면 중복·누락이 생긴다.

## D-8 FE 호출과 화면
- Status: superseded by D-25
- Decision: 리뷰 영역(목록, 메뉴, 작성 버튼)과 작성 화면은 검색 spec D-11처럼 데이터를 브라우저 `fetch`로 가져오고 서버 전용 기능을 쓰지 않는다. 등록·수정·삭제·신고 후에는 목록을 다시 불러와 즉시 반영한다(PRD AC-11). 작성 화면 경로는 장소 상세 경로 규칙(`/place?id=`, 검색 D-11)을 따라 `/place/review?id=`이고, 검색 담당이 상세 경로를 바꾸면 함께 바꾼다. Walking Skeleton의 작성 화면은 본문만 받는 한 화면 폼이고, 로그인 없이 쓸 수 있다. 실패하면 화면에 오류를 보여 주고 입력을 남긴다. 등록 요청이 처리되는 동안 "등록하기"를 비활성화해 연타를 막는다. 1차 후속에서 중복 금지가 붙으면 409를 이미 쓴 날짜라고 안내해 방문일만 바꿔 다시 등록하게 하고, `review-form`의 `reviewedDates`로 달력에서 미리 막는다. 1차 후속부터 작성은 Figma의 2단계 흐름을 따른다. 1/2단계는 방문일과 좋았던 점(7-01), 아쉬웠던 점(7-02)이고, 2/2단계는 재방문 의사·본문·사진·1인당 금액(7-04, 7-05)이다. 입력은 화면 상태로만 들고 있다가 마지막 "등록하기"에서 한 번에 보낸다. 작성 중 닫으면 확인 모달(7-E03)을 띄운다. 등록 실패는 서버 오류(7-E05)와 연결 문제(7-E06)를 구분해 보여 준다. UI 컴포넌트는 `src/app/components`, API 호출과 순수 로직은 `src/lib`에 둔다(검색 D-12).
- Rejected: 동적 경로 `/places/[id]/review` → 지금의 장소 상세 경로와 형식이 다르다. 리뷰 목록을 서버에서 렌더링 → `mine`과 숨김 표시가 사용자마다 달라 인증 정보를 서버 호출에 넘겨야 한다.

## D-9 사진 업로드와 읽기
- Status: settled
- Decision: 인프라 설계 7.4절의 흐름을 따른다. 앱이 사진마다 원본(긴 변 1,600px)과 썸네일(긴 변 약 400px) 두 벌을 JPEG·EXIF 제거로 만들고, BE가 발급한 presigned URL로 Garage `pending/`에 올린다. 등록 때 BE가 두 객체의 크기와 앞부분 바이트로 형식을 확인한 뒤 `confirmed/`로 옮긴다. presigned PUT은 크기를 정책으로 묶을 수 없어(인프라 5.1절) 이 확인이 필요하다. 목록은 썸네일, 사진을 누르면 원본을 보여 준다. 객체 키는 추측할 수 없는 UUID다(인프라 5.2절). 브라우저는 같은 출처의 상대 경로로 업로드(`/fit-<env>-photos/`, S3 API)하고 읽기(`/photos/<env>/confirmed/`, 웹 엔드포인트)한다(인프라 5.2절, 12.5절 #2). presigned URL이 Caddy를 거쳐 통과하는지는 인프라의 Garage 스파이크(7.4절)가 아직 확인 중이다.
- Rejected: 원본 한 벌만 → 서버에 이미지 최적화가 없어(인프라 12.5절 #7) 목록이 원본을 그대로 받는다. BE를 거치는 업로드 → API 본문 2MB 상한(인프라 5.1절).

## D-10 숨김 리뷰의 사진
- Status: superseded by D-39
- Decision: `confirmed/`는 URL만 알면 공개로 읽히고, Caddy는 `confirmed/`만 공개 경로로 연다(인프라 5.2절). 운영자가 숨기면 그 리뷰의 사진(원본과 썸네일)을 `confirmed/` 밖의 접두사로 옮기고 해제하면 되돌린다. 삭제하면 객체를 지운다.
- Rejected: 숨김 때 사진 그대로 두기 → "욕설·혐오·음란물" 숨김이 사진에는 효과가 없다.

## D-11 신고와 운영
- Status: settled
- Decision: 신고는 `(review_id, reporter_id)` 유니크로 한 번만, 본인 리뷰는 불가다. 사유는 광고·도배, 욕설·혐오·음란물, 장소와 무관한 내용, 기타이고 신고만으로 숨기지 않는다(FR-12). 신고 사유 시트(Figma 6-11)에서 "기타"를 누르면 설명 입력창이 나타나고, 설명은 선택 입력이다. 서버는 설명을 "기타"일 때만 받는다. 관리자 API는 신고 목록(최신순, 신고 수), 숨김·분석 제외·작성 차단과 각 해제를 제공하고, 각 동작은 같은 트랜잭션에 처리 기록(처리자, 시각, 동작)을 남긴다. 사유별 기본 처리는 권장 동작으로만 내려주고 담당자가 정한다.
- 설명은 100자까지다. Figma 6-11이 "기타" 설명 입력창("어떤 점이 문제인지 적어 주세요 (선택)")과 글자 수 0/100을 그렸다. 서버도 100자를 넘으면 400이다(2026-10-23).

## D-12 위치 확인
- Status: settled
- Decision: 1차 후속부터 적용한다(D-1). "방문 평가 남기기"를 누르면 위치 확인을 자동으로 시작한다. 버튼을 누른 것을 PRD FR-15의 "확인을 요청한 순간"으로 본다. 계산은 기기에서만 한다. "측정 거리 + GPS 정확도 ≤ 100m"면 근처이고 작성 화면에 "방문 확인 완료" 표시가 붙는다(Figma 7-01). 권한 거절, 값 없음, 범위 밖이면 "근처에서 확인하지 못했어요" 모달(7-E02)에서 "다시 확인"과 "그냥 쓰기"를 준다. 같은 진입 시점에 오늘 이미 리뷰를 썼으면(작성 화면 데이터의 `reviewedDates`) "오늘은 이미 리뷰를 남겼어요" 모달(7-E01)에서 "다른 날 고르기"와 "닫기"를 준다. BE API는 없고, 좌표와 결과를 요청·로그·분석 이벤트에 싣지 않는다(PRD AC-19, AC-35, 검색 D-17과 같은 원칙). 위치 확인 모달이 도는 동안 작성 화면 데이터를 미리 받는다.
- PRD FR-15는 위치 확인을 선택 사항으로 두고 "확인을 요청한 순간에만" 위치를 쓰게 하지만, 리뷰는 "방문 평가 남기기"를 누른 것을 확인 요청으로 보는 이 해석을 유지한다. 위치 권한을 거절하거나 확인에 실패해도 "그냥 쓰기"로 작성할 수 있어 선택성은 지킨다. PRD와 대조한 뒤 리뷰 담당이 확인한 결정이다(2026-10-26).
- Rejected: 작성 화면 안의 버튼으로 시작 → Figma 디자인과 흐름이 달라지고 단계가 늘어난다.

## D-13 검색 spec이 정한 BE 규칙을 따른다
- Status: superseded by D-20
- Decision: 오류는 검색 spec이 만든 ProblemDetail 예외 처리 클래스를 함께 쓴다(검색 D-10, 가정 18). 요청의 알 수 없는 속성 거부와 응답의 null 필드 생략(검색 D-17, 가정 22)이 리뷰에도 적용된다. 입력 검증은 검색 가정 24처럼 validation starter 없이 컨트롤러와 도메인에서 한다. 요청 본문, 리뷰 본문, 신고 설명은 로그에 남기지 않는다(검색 D-20).
- Rejected: validation starter 추가 → 공용 의존성이 바뀌고 검색과 검증 방식이 갈린다.

## D-14 장소 정보 조회
- Status: superseded by D-21
- Decision: Walking Skeleton은 장소 존재를 확인하지 않고 `placeId`의 형식과 길이만 검사한다. 목록은 `placeId`로만 조회하므로 없는 장소의 리뷰는 화면에 나오지 않는다. 1차 후속부터 리뷰는 장소의 존재 여부와 이름·업종·역을 장소 기능이 공개하는 조회 인터페이스로만 확인하고, 장소 테이블을 직접 조회하지 않는다. 인터페이스의 모양과 구현은 장소 담당이 정한다.
- Rejected: `places` 테이블 직접 조회 → 장소 테이블 구조가 바뀌면 리뷰 코드도 고쳐야 한다.

## D-15 인증 방식
- Status: settled
- Decision: 1차 후속부터 리뷰 API는 `Authorization` 헤더의 JWT로 사용자를 식별한다. Walking Skeleton은 사용자를 식별하지 않고 인증 없이 등록한다(D-1). 쿠키 인증이 아니라 쓰기 요청에 CSRF 방어가 따로 필요 없다. FE는 리뷰 API를 부를 때 토큰을 헤더에 싣는다. 토큰 발급·저장·갱신은 회원 담당이 정한다. 인프라 설계도 JWT를 `Authorization` 헤더에 담는다고 보고 있지만(5.4절의 basic auth 기각, 12.5절 #10), BE 계약 #21과 프런트 계약 #9는 인증 쿠키(HttpOnly·Secure)를 전제로 적혀 있어 회원·인프라 담당과 맞춰야 한다.
- 회원 담당의 로그인 브랜치(`docs/auth/01_login.md`)는 AT를 FE 메모리에 두고 `Authorization: Bearer`로 보내며, RT만 HttpOnly 쿠키(`Path=/api/auth`)에 둔다. 리뷰 API는 AT만 받으므로 이 결정과 맞고, 인증 쿠키는 갱신 경로에만 쓰여 BE 계약 #21·프런트 계약 #9와도 어긋나지 않는다. 남은 것은 머지 시점과 인터셉터 적용 방식이다(spec Open questions)(2026-10-23).
- Rejected: HttpOnly 쿠키 → 쓰기 요청마다 CSRF 방어가 필요하다.

## D-16 특징 코드 공유
- Status: settled
- Decision: 리뷰 이유 태그, 온보딩 태그, 검색 `preferences`는 PRD §2의 L1~L4 모델을 따른 공용 특징 코드 목록 하나를 쓴다. 리뷰 `tags`는 그 코드를 참조하고 문구·sentiment·그룹·업종 노출은 리뷰가 관리한다. 목록을 누가 관리하는지는 미결이다.
- AI 비교 spec(브랜치)이 AI 분석의 코드표(`features.py`, `QUIET`, `PURPOSE_GROUP` 등)를 공용 조건 코드로 쓴다. 리뷰 태그도 이 코드표를 참조하는 것을 기본안으로 두고, 그대로 써도 되는지와 공유 시점은 분석 담당에게 묻는다(spec Open questions)(2026-10-23).
- 취향 분석 브랜치(S15P31A302-39, 머지 전)의 `ai/src/fit_ai/features.py`가 "39가 관리하고 40·41과 공유한다"고 정했다. 리뷰 태그는 이 코드표의 코드를 쓴다(D-36). develop의 온보딩 코드(`SPACIOUS`, `VALUE`, `CONVERSATION` 등)는 이 코드표와 7개가 달라 회원·AI 담당이 맞춰야 한다(2026-10-27).
- Rejected: 리뷰 태그를 따로 관리 → 취향 보정과 검색이 리뷰 태그를 특징으로 다시 매핑해야 한다.

## D-17 리뷰 변경 전달 (Walking Skeleton)
- Status: superseded by D-34
- Decision: Walking Skeleton에서는 취향·장소 분석·검색 색인의 일괄 처리가 리뷰 테이블을 직접 조회해 변경을 가져간다. 리뷰는 삭제·숨김·분석 제외를 시각 컬럼으로 남기고(D-3) `updated_at`을 갱신해 일괄 처리가 상태와 변경 시점을 알 수 있게 한다. 이벤트나 아웃박스 같은 고도화는 이후에 정한다.
- Rejected: 지금 아웃박스 이벤트 도입 → 공용 인프라가 필요하고 받는 쪽이 아직 없다.

## D-18 화면 기준과 재방문 의사
- Status: settled
- Decision: 화면은 Figma `핏다이닝` 파일의 UI/UX 페이지(장소 상세 6-03, 6-06~6-12, 방문 평가 7-01~7-06, 예외 상태 6-E03, 6-E06, 6-E07, 7-E01~7-E06)를 기준으로 한다. Walking Skeleton의 한 화면 작성 폼은 Figma에 없어 리뷰 담당이 간단히 만든다(D-25). 재방문 의사는 PRD FR-14대로 취향 추론과 추천에 쓰지 않는다. 7-04의 "앞으로 이 장소와 비슷한 곳을 찾아드릴게요" 문구는 이와 맞지 않아 문구만 바꾼다.
- Figma 7-04 문구가 "비슷한 취향의 장소를 찾아드릴게요"로 바뀌었지만 여전히 재방문 의사를 추천에 쓴다는 뜻이라 문구를 바꿔야 하는 것은 그대로다(2026-10-23).
- 작성 화면은 7-04 문구를 와이어프레임 그대로 쓴다. 리뷰 담당이 정한 것이고, 재방문 의사를 추천에 쓰지 않는 것은 그대로다(D-41).
- Rejected: 재방문 의사를 비슷한 장소 추천에 사용 → PRD FR-14와 충돌한다.

## D-19 Mock 장소의 리뷰
- Status: superseded by D-22
- Decision: 리뷰는 검색 Mock 장소(`p-001` 등, 검색 D-16)에도 쓸 수 있어야 한다. 실제 장소 데이터가 들어오기 전에도 검색 → 장소 상세 → 리뷰 작성·조회가 끝까지 이어져야 하기 때문이다. Walking Skeleton은 장소를 확인하지 않아 Mock ID로도 쓸 수 있다(D-14). 1차 후속에서 장소 확인을 붙일 때 Mock 장소도 통과하게 하는 방법은 장소 담당과 정한다.
- Rejected: Mock 장소에는 리뷰를 막기 → 실제 데이터 적재 전까지 리뷰 기능을 화면에서 확인할 수 없다.

## D-20 팀 BE 컨벤션을 따른다(기능별 예외 처리, Bean Validation)
- Status: settled
- Decision: 팀 BE 컨벤션(`be/docs/convention.md`)을 따른다. 오류는 리뷰 기능의 `ReviewExceptionHandler`(`@RestControllerAdvice(basePackageClasses = ReviewController.class)`)가 ProblemDetail로 바꾸고, `detail`에는 일반 문구만 넣는다(컨벤션 3절, 검색 D-10의 임시 형식). 형식 검증은 요청 DTO와 경로 변수의 Bean Validation(`@Valid`, `@Validated`)으로 하고, 비즈니스 검증(1차 후속의 장소 존재, 중복, 권한)은 `ReviewService`에서 한다(컨벤션 3절, 검색 D-55). 요청의 알 수 없는 속성 거부와 응답의 null 필드 생략은 `application.yml`의 JSON 설정 한 곳에 두고(검색 D-41, 컨벤션 5절), 검색과 리뷰 중 먼저 머지하는 MR이 넣는다. 요청 본문, 리뷰 본문, 신고 설명은 로그에 남기지 않고, 400은 예외 객체와 메시지 없이 남긴다(컨벤션 4절, 검색 D-20).
- Rejected: 검색의 예외 처리 클래스를 함께 쓰기 → 컨벤션이 기능별 처리 클래스로 정했다. validation starter 없이 컨트롤러와 도메인에서 직접 검증 → 컨벤션과 다르고, starter는 이미 `be/build.gradle`에 있다.
- Anchors: `be/src/main/java/kr/co/fitdining/api/review/ReviewExceptionHandler.java#ReviewExceptionHandler` (new) · `be/src/main/resources/application.yml#spring` (modify)

## D-21 장소 정보 조회(장소 ID는 정수)
- Status: settled
- Decision: 장소 ID는 검색 spec을 따라 정수다(검색 D-44, D-54: ERD의 `places.place_id` bigint, BE `Long`, JSON 숫자, FE `number`). `reviews.place_id`는 `BIGINT`이고 경로의 `placeId`는 양의 정수만 받는다. 숫자가 아니거나 0 이하이거나 `long` 범위를 넘으면 400이다. Walking Skeleton은 장소 존재를 확인하지 않는다. 목록은 `placeId`로만 조회하므로 없는 장소의 리뷰는 화면에 나오지 않는다. 1차 후속부터 리뷰는 장소의 존재 여부와 이름·업종·역을 장소 기능이 공개하는 조회 인터페이스로만 확인하고, 장소 테이블을 직접 조회하지 않는다. 인터페이스의 모양과 구현은 장소 담당이 정한다.
- 장소 상세 API의 `PlaceService#getPlace(long)`가 이름·업종·역(`PlaceSummary`)을 돌려주고 Mock 장소도 통과한다. 다만 없는 장소의 `PlaceNotFoundException`은 장소 컨트롤러에만 걸린 `PlaceExceptionHandler`(`basePackageClasses = PlaceController.class`)가 404로 바꾸므로 리뷰에서 그대로 부르면 500이 된다(2026-10-23). 리뷰 예외 처리기가 이 예외를 404로 바꾸기로 했다(D-37).
- Rejected: 문자열 ID(`p-001`) → 검색 spec과 ERD가 bigint로 정했다. `places` 테이블 직접 조회 → 장소 테이블 구조가 바뀌면 리뷰 코드도 고쳐야 한다.

## D-22 Mock 장소의 리뷰(Mock ID 정정)
- Status: settled
- Decision: 리뷰는 검색 Mock 장소에도 쓸 수 있어야 한다. Mock 장소의 ID는 1부터 차례로 매긴 정수다(검색 D-44, D-54). 실제 장소 데이터가 들어오기 전에도 검색 → 장소 상세 → 리뷰 작성·조회가 끝까지 이어져야 하기 때문이다. Walking Skeleton은 장소를 확인하지 않아 Mock ID로도 쓸 수 있다(D-21). 1차 후속에서 장소 확인을 붙일 때 Mock 장소도 통과하게 하는 방법은 장소 담당과 정한다.
- Rejected: Mock 장소에는 리뷰를 막기 → 실제 데이터 적재 전까지 리뷰 기능을 화면에서 확인할 수 없다.

## D-23 DTO를 팀 BE 컨벤션에 맞춰 파일로 나눈다
- Status: settled
- Decision: 팀 BE 컨벤션(1절)과 검색 D-54에 맞춰 DTO를 `kr.co.fitdining.api.review.dto` 패키지에 클래스마다 파일 하나로 둔다. 엔드포인트의 요청과 응답은 역할이 드러나게 `Review` + 동작 + `Request`/`Response`로 짓는다. Walking Skeleton은 `ReviewListResponse`, `ReviewCreateRequest`, `ReviewCreateResponse`이고, 목록 항목 `ReviewItem`은 하위 구조다. 1차 후속은 `ReviewFormResponse`, `ReviewDetailResponse`, `ReviewUpdateRequest`, `ReviewReportRequest`, `ReviewPhotoUploadRequest`, `ReviewPhotoUploadResponse`이고, 하위 구조(`TagView`, `FormTag`, `PhotoUpload`)도 같은 패키지에 하나씩 둔다. 역직렬화되는 record의 숫자와 boolean(재방문 의사, 1인당 금액, 사진 수 등)은 박싱 타입이다. 엔티티는 응답으로 반환하지 않는다.
- Rejected: 한 파일(`ReviewDtos`)에 모으기, `ReviewPage`·`CreateReviewRequest` 같은 이름 → 컨벤션의 이름 규칙과 다르고 여러 사람이 고칠 때 병합 충돌이 잦다. 원시 타입 record → Jackson 3에서 값이 빠진 원시 타입은 원인을 알기 어려운 400이 된다.
- Anchors: `be/src/main/java/kr/co/fitdining/api/review/dto/ReviewCreateRequest.java#ReviewCreateRequest` (new) · `be/src/main/java/kr/co/fitdining/api/review/dto/ReviewListResponse.java#ReviewListResponse` (new)

## D-24 목록(1차 후속에서도 작성 시각 유지)
- Status: settled
- Decision: 장소별로 `created_at DESC, review_id DESC` 정렬, 불투명 커서, 한 번에 20건이다(검색 D-8과 같은 페이지 크기). 조건은 삭제되지 않았고, 숨김이 아니거나 조회자 본인의 리뷰다. `totalCount`는 공개 리뷰 수(삭제·숨김 제외)다. Walking Skeleton 항목은 `reviewId`, 작성 시각(`createdAt`), 본문이고 화면은 작성일을 보인다. 1차 후속에서 방문일, 현재 닉네임, 재방문 의사, 태그와 `sentiment`, 사진, `mine`, `hidden`을 더하고, 작성 시각은 응답에 남긴다. 직전 배포의 FE 번들이 한 버전 동안 그대로 동작해야 하고 필드 삭제는 expand/contract로 하기 때문이다(인프라 BE 계약 #16). 화면(Figma 6-03)은 날짜로 방문일만 보이고, 좋았어요 태그와 아쉬웠어요 태그("아쉬움" 표시)를 구분해 그리며, 본인 리뷰는 닉네임 대신 "나 · 내 리뷰"로 보인다.
- Rejected: offset 페이지 → 새 리뷰가 올라오면 중복·누락이 생긴다. 1차 후속에서 작성 시각을 방문일로 바꾸기(D-7) → 직전 FE 번들이 작성일을 그리지 못한다(인프라 BE 계약 #16).

## D-25 FE 호출과 화면(리뷰 탭, 공통 API 클라이언트, 폴더 구조)
- Status: superseded by D-31
- Decision: 리뷰 화면은 데이터를 브라우저에서 가져오고 서버 전용 기능을 쓰지 않는다(검색 D-38). 호출은 FE 공통 API 클라이언트(`@/shared/api`의 `request`)로 상대 경로 `/api/v1/...`를 부르고, 서버 상태는 TanStack Query로 다룬다. 로컬 `next dev`에서는 개발 서버 프록시가 `/api`를 BE로 넘긴다(검색 D-58). 등록·수정·삭제·신고 후에는 목록을 다시 불러와 즉시 반영한다(PRD AC-11). 폴더는 master의 FE 공통 구조(S15P31A302-36)를 따른다. 화면 경로는 `src/app`에 두고, 리뷰 코드는 `src/domains/review`에 둔다. 순수 타입과 규칙은 ESLint가 정한 `model`에, 호출과 컴포넌트는 `shared`를 본떠 `api`와 `ui`에 둔다. 의존 방향은 `app → domains → shared`다. 순수 규칙은 Vitest(`pnpm test`)로 확인한다. 장소 상세의 리뷰 탭(Figma 6-03)은 Walking Skeleton부터 둔다. 리뷰 담당이 BE 엔드포인트와 리뷰 도메인의 `ReviewSection`(목록과 "방문 평가 남기기" 버튼)을 만들어 넘기면, 검색 담당이 장소 상세 화면(`src/app/place/page.tsx`)의 탭에 이 컴포넌트를 붙인다(2026-10-21 검색 담당과 합의). 목록 UI는 리뷰 담당이 맡으므로 1차 후속에서 늘어나는 필드(닉네임, 태그, 사진, 내 리뷰 메뉴, 신고)도 리뷰 담당이 고친다. 작성은 리뷰 담당이 만드는 별도 작성 화면에서 하고, 경로는 장소 상세 경로 규칙(`/place?id=`, 검색 D-38)을 따라 `/place/review?id=`다. 검색 담당이 상세 경로를 바꾸면 함께 바꾼다. Walking Skeleton의 작성 화면은 본문만 받는 한 화면 폼이고, 로그인 없이 쓸 수 있다. 등록 요청이 처리되는 동안 "등록하기"를 비활성화해 연타를 막는다. 성공하면 장소 상세의 리뷰 탭으로 돌아가 새 리뷰를 목록 맨 위에 보인다. 실패하면 화면에 오류를 보여 주고 입력을 남긴다. 1차 후속에서 중복 금지가 붙으면 409를 이미 쓴 날짜라고 안내해 방문일만 바꿔 다시 등록하게 하고, `review-form`의 `reviewedDates`로 달력에서 미리 막는다. 1차 후속부터 작성은 Figma의 2단계 흐름을 따른다. 1/2단계는 방문일과 좋았던 점(7-01), 아쉬웠던 점(7-02)이고, 2/2단계는 재방문 의사·본문·사진·1인당 금액(7-04, 7-05)이다. 입력은 화면 상태로만 들고 있다가 마지막 "등록하기"에서 한 번에 보낸다. 작성 중 닫으면 확인 모달(7-E03)을 띄운다. 등록 실패는 서버 오류(7-E05)와 연결 문제(7-E06)를 구분해 보여 준다.
- Rejected: Walking Skeleton에 리뷰 담당의 별도 리뷰 페이지(목록과 작성 칸, 상세에는 링크만) 두기 → 검색 담당이 Walking Skeleton부터 리뷰 탭을 붙이기로 해 Figma 6-03 구조를 처음부터 따를 수 있다. 검색 담당이 탭 안의 목록 UI를 직접 만들기 → 1차 후속에서 목록 필드가 늘 때마다 검색 담당 코드를 고쳐야 한다. 동적 경로 `/places/[id]/review` → 지금의 장소 상세 경로와 형식이 다르다. 리뷰 목록을 서버에서 렌더링 → `mine`과 숨김 표시가 사용자마다 달라 인증 정보를 서버 호출에 넘겨야 한다. `src/app/components`와 `src/lib`(검색 D-43, D-8) → master의 FE 공통 구조가 `domains`와 `shared`로 나누고 ESLint로 의존 방향을 강제한다.

## D-26 영속성 테스트 DB
- Status: superseded by D-29
- Decision: 저장과 커서 페이지(1차 후속의 부분 유니크 인덱스와 409 변환 포함)는 Testcontainers로 띄운 PostgreSQL에 마이그레이션으로 스키마를 만들어 확인한다. 인프라 BE 계약 #13(제안 상태)이 Testcontainers를 쓰기로 했고, 부분 인덱스(`WHERE deleted_at IS NULL`)와 제약 위반 뒤의 트랜잭션 동작은 H2로 재현되지 않는다. 의존성 추가는 공용 `be/build.gradle`을 바꾸므로 BE 팀과 합의한 뒤 한다(spec Open questions).
- Rejected: H2 → PostgreSQL 동작을 재현하지 못한다. 로컬 스택(`infra/local`)의 DB에 붙기 → 테스트 결과가 개발 데이터와 로컬 스택 실행 여부에 따라 달라진다.

## D-27 Walking Skeleton 저장소는 메모리 Mock이다
- Status: superseded by D-35
- Decision: Walking Skeleton은 DB 테이블과 마이그레이션 없이 메모리 저장소로 구현한다. `ReviewService`는 저장소 인터페이스 `ReviewStore`(저장, 장소별 커서 페이지 조회, 개수)만 알고, Walking Skeleton은 `InMemoryReviewStore`를 꽂는다. 이 구현은 `review.mock.enabled`(환경변수 `REVIEW_MOCK_ENABLED`, 코드 기본값 꺼짐)가 켜졌을 때만 등록되고 local과 dev에서만 켠다(`be/.env.example`). 저장소가 없으면 `ReviewService`가 503을 낸다(검색 `PlaceService`와 같은 방식). 장소별 목록을 메모리에 두고 `reviewId`는 차례로 매긴다. 정렬(`createdAt DESC, reviewId DESC`), 커서 형식(`createdAt|reviewId`를 패딩 없는 base64url로 인코딩), 마이크로초로 자른 작성 시각은 1차 후속의 DB 구현과 같게 둔다. 그래서 1차 후속에서 저장소 구현만 `reviews` 테이블을 쓰는 `JpaReviewStore`로 바꾸면 API와 FE는 그대로다. 익명 쓰기로 메모리가 차지 않도록 전체 건수에 상한(임시 5,000건)을 두고, 넘으면 가장 오래된 리뷰부터 버린다. 시드는 `classpath:mock/reviews.json`으로 1번 Mock 장소에 25건을 넣어 커서 페이지를 바로 볼 수 있게 한다. 데이터는 재시작하면 시드만 남고 인스턴스마다 따로다. 그래서 1차 후속 전에 Walking Skeleton 리뷰를 지우는 작업이 없다. `reviews` 테이블, 마이그레이션, 영속성 테스트는 1차 후속부터이고(D-28, D-29), 일괄 처리가 읽는 리뷰 테이블(D-17)도 그때 생긴다. `REVIEW_MOCK_ENABLED`를 env 계약에 올리는 일은 인프라 담당에게 알린다(이 기능은 `docs/infra/`를 고치지 않는다).
- Rejected: Walking Skeleton부터 `reviews` 테이블 → `migrate` 프로필, DB 공통 규칙, Testcontainers 의존성 합의를 기다려야 한다. 첫 마이그레이션과 DML 전용 계정 권한 같은 통합 위험이 1차 후속으로 미뤄지는 것은 감수한다. FE만 Mock(MSW 등) → BE 경로가 연결되지 않아 Walking Skeleton이 아니다. JSON 파일에 쓰기 → 컨테이너 파일 시스템과 동시 쓰기를 다뤄야 한다. 상한 없음 → 익명 등록을 반복하면 dev 서버의 메모리가 찬다.
- Anchors: `be/src/main/java/kr/co/fitdining/api/review/store/ReviewStore.java#ReviewStore` (new) · `be/src/main/java/kr/co/fitdining/api/review/store/InMemoryReviewStore.java#InMemoryReviewStore` (new) · `be/src/main/resources/mock/reviews.json` (new)

## D-28 리뷰 상태와 중복 금지(테이블은 1차 후속부터)
- Status: settled
- Decision: `reviews` 테이블은 1차 후속에서 처음 만든다(D-27). 삭제, 공개 숨김, 분석 제외는 서로 독립이라(PRD AC-13) 세 시각 컬럼(`deleted_at`, `hidden_at`, `analysis_excluded_at`)으로 둔다. 삭제는 soft delete이고, 같은 방문일 재작성(FR-11)을 위해 `(user_id, place_id, visited_at) WHERE deleted_at IS NULL` 부분 유니크 인덱스를 마이그레이션 SQL로 만든다. 동시 등록은 이 제약이 막는다. 서비스는 `saveAndFlush`로 저장해 그 자리에서 `DataIntegrityViolationException`을 받고, 원인 예외의 제약 이름이 이 인덱스일 때만 409로 바꾼다. 다른 제약 위반은 그대로 둔다. PostgreSQL은 제약 위반 뒤 트랜잭션을 더 쓸 수 없으므로 잡은 뒤 다른 작업을 잇지 않는다. 저장 전 조회는 하지 않는다. 리뷰와 태그는 한 트랜잭션에 저장한다. 첫 마이그레이션이 `user_id`·`visited_at`(NOT NULL), 숨김·분석 제외 컬럼, 부분 유니크 인덱스를 처음부터 담는다. Walking Skeleton 리뷰는 메모리에만 있어 옮기거나 지울 것이 없다.
- Rejected: 저장 전 `exists` 조회로 막기 → 두 요청이 함께 조회를 통과하면 둘 다 저장된다. status 단일 컬럼 → 숨김과 분석 제외를 동시에 표현할 수 없다. 하드 삭제 → 일괄 처리가 삭제된 리뷰를 알아볼 수 없다(D-17).

## D-29 영속성 테스트 DB(1차 후속부터)
- Status: settled
- Decision: Walking Skeleton은 메모리 저장소라 저장, 정렬, 커서 경계, 상한을 순수 단위 테스트로 확인한다(D-27). 1차 후속의 `JpaReviewStore`와 마이그레이션(부분 유니크 인덱스와 409 변환 포함)은 Testcontainers로 띄운 PostgreSQL에 마이그레이션으로 스키마를 만들어 확인한다. 인프라 BE 계약 #13(제안 상태)이 Testcontainers를 쓰기로 했고, 부분 인덱스(`WHERE deleted_at IS NULL`)와 제약 위반 뒤의 트랜잭션 동작은 H2로 재현되지 않는다. 의존성 추가는 공용 `be/build.gradle`을 바꾸므로 1차 후속 전에 BE 팀과 합의한다(spec Open questions).
- 방식은 인프라 BE 계약 #13으로 이미 정해졌으므로 따로 합의를 기다리지 않는다. 리뷰 담당이 1차 후속의 첫 영속성 MR에서 Testcontainers 의존성을 `be/build.gradle`에 넣고 BE 팀을 리뷰어로 두어 그 MR에서 합의를 받는다(2026-10-23).
- Rejected: H2 → PostgreSQL 동작을 재현하지 못한다. 로컬 스택(`infra/local`)의 DB에 붙기 → 테스트 결과가 개발 데이터와 로컬 스택 실행 여부에 따라 달라진다.

## D-30 FE 화면은 공통 UI 컴포넌트와 디자인 시스템 규칙으로 만든다
- Status: superseded by D-31
- Decision: 리뷰 화면은 master의 공통 UI(`@/shared/ui`, S15P31A302-35)를 조합해 만들고 리뷰 전용 모양을 새로 정의하지 않는다. 색·글자·라운드·그림자는 `globals.css` 토큰만 쓰고, 공통 컴포넌트에는 폭·바깥 여백 같은 배치용 `className`만 넘긴다(디자인 시스템 린트). 파일 이름은 `shared/ui`처럼 kebab-case다(`review-section.tsx`, `simple-review-form.tsx`, `review-api.ts`). Walking Skeleton은 이렇게 조합한다. 리뷰 탭(`ReviewSection`)은 `SectionHeader`(제목 "리뷰"와 개수), 목록 항목(작성일과 본문, 토큰으로 그린 div), "더 보기" `Button`(outline·md), "방문 평가 남기기" `Button`(primary, `render`로 링크), 리뷰가 없으면 `EmptyState`(`ChatIcon`), 불러오기 실패면 `EmptyState`(warn, `WifiOffIcon`)와 "다시 시도", 불러오는 중이면 `skeleton` 유틸리티다. 작성 화면(`SimpleReviewForm`)은 `TopBar`(제목과 닫기 `IconButton`), `Textarea`(화면에 숨긴 라벨, `maxLength` 500과 글자 수), `BottomBar` 안의 "등록하기" `Button`(공통 Button은 기본이 `type="button"`이라 `type="submit"`을 준다), 등록 실패 안내 `Note`(warn)다. 본문 500자는 FE `Textarea`의 `maxLength`와 글자 수, BE `@Size`가 모두 UTF-16 단위로 같게 센다. 이모지는 2자로 세지만 FE와 BE가 어긋나지 않는다. 1차 후속은 `StepProgress`(2단계), `Chip`(이유 태그), `Tag`(`prefix="아쉬움"`), `Menu`(⋯ 수정·삭제는 `tone="danger"`, 신고), `BottomSheet`(신고 사유 6-11), `ConfirmDialog`(작성 중 닫기 7-E03, 삭제 확인), `AlertDialog`(등록 실패 7-E05·7-E06), `TextField`(`suffix` "원", 1인당 금액), `Toast`(삭제 알림), `Carousel`(사진)을 쓴다. 공통 UI에 없는 방문일 달력(7-03)과 사진 고르기 칸은 FE 공통 담당과 정한다(spec Open questions). 화면 테스트는 공통 UI처럼 Vitest에서 `renderToStaticMarkup`으로 정적 마크업을 확인하고, jsdom과 Testing Library는 쓰지 않는다(검색 D-30). 그래서 데이터 훅과 그리는 컴포넌트를 나눠 그리는 쪽만 정적으로 확인한다.
- Rejected: 리뷰 화면에 직접 마크업과 색 → 디자인 시스템 린트(토큰 밖 색·임의값·공통 컴포넌트 모양 바꾸기 금지)에 걸리고 화면마다 모양이 달라진다. PascalCase 파일 이름(D-25 초안) → `shared/ui`의 kebab-case와 다르다. 코드 포인트로 글자 수 세기 → 공통 `Textarea`와 BE `@Size`가 UTF-16으로 세므로 리뷰만 다르게 세면 FE와 BE가 어긋난다.
- Anchors: `fe/src/domains/review/ui/review-section.tsx#ReviewSection` (new) · `fe/src/domains/review/ui/simple-review-form.tsx#SimpleReviewForm` (new)

## D-31 장소 상세가 리뷰를 붙이는 공개 인터페이스(Figma 6-01·6-03 기준)
- Status: superseded by D-32
- Decision: 장소 상세가 쉽게 붙일 수 있도록 리뷰 FE는 컴포넌트 하나와 주소 함수 하나만 공개한다. `ReviewSection`(`placeId`)은 리뷰 탭(6-03) 내용이고, 같은 컴포넌트에 `previewHref`를 주면 홈 탭(6-01)의 "리뷰 12 ›" 미리보기가 되어 최신 3건을 보이며 제목 전체가 `previewHref`(리뷰 탭) 링크다. 두 자리는 보이는 정보가 같고 건수, 제목 링크, 여백, 다음 페이지만 달라 옵션 하나로 나눈다. `reviewWriteHref(placeId)`는 작성 화면 주소다. "방문 평가 남기기"는 Figma처럼 장소 상세의 하단 막대(저장 버튼 옆)에 있으므로 리뷰 컴포넌트는 작성 버튼을 그리지 않고, 장소 상세가 그 버튼을 `reviewWriteHref(placeId)`에 연결한다. 두 자리는 같은 쿼리를 써서 홈과 리뷰 탭을 오가도 목록을 두 번 받지 않는다. 등록에 성공하면 작성 화면이 "리뷰가 등록됐어요" 토스트(7-06)를 띄우고 `/place?id=<placeId>&tab=review`로 돌아가므로, 장소 상세는 주소의 `tab`으로 탭을 고르고 리뷰 탭의 값을 `review`로 둔다. 리뷰 탭 목록은 Figma에 다음 페이지 버튼이 없어 목록 끝이 보이면 다음 페이지를 저절로 받고, 실패하면 그 자리에 "다시 불러오기" 글자 버튼을 보인다. 리뷰가 없으면 6-E03처럼 "리뷰 0"과 빈 상태 안내를 보이고, 불러오기 실패는 경고 빈 상태와 "다시 시도"다. 항목은 6-03의 간격(위아래 16, 줄 사이 8, 아래 구분선)과 글자(날짜 `text-caption-md` 회색, 본문 `text-body-sm`)를 따른다. Walking Skeleton 항목은 날짜와 본문만 있고 날짜는 Figma의 "10월 12일 방문" 꼴에 맞춰 "10월 20일 작성"으로 보인다. 6-03 제목 옆 "최신순"은 Walking Skeleton에 정렬이 하나뿐이라 그리지 않는다. 섹션 안쪽 여백(좌우 20, 리뷰 탭 위 16·아래 28, 홈 미리보기 위아래 28)은 컴포넌트가 갖고, 섹션 사이 구분 띠와 바탕색은 장소 상세가 정한다. 그 밖은 D-25·D-30 그대로다. 데이터는 브라우저에서 공통 API 클라이언트와 TanStack Query로 받고(검색 D-38, D-58), 코드는 `src/domains/review`(`model`, `api`, `ui`)에 kebab-case 파일로 두며, 화면은 공통 UI 컴포넌트와 디자인 토큰으로 그린다. 작성 화면(`/place/review?id=`)은 리뷰 담당의 한 화면 폼(`TopBar`, `Textarea` 500자와 글자 수, `BottomBar`의 "등록하기", 실패 안내 `Note`)이고, 본문 500자는 FE와 BE 모두 UTF-16 단위로 센다. 화면 테스트는 `renderToStaticMarkup`으로 한다.
- Rejected: 리뷰 탭 안에 작성 버튼(D-25) → Figma 6-01·6-03에서 버튼은 장소 상세 하단 막대에 있어 같은 버튼이 두 번 보인다. "더 보기" 버튼(D-30) → Figma에 없다. 홈 미리보기를 장소 상세가 직접 그리기 → 목록 조회와 항목 모양이 두 곳에 생기고 1차 후속에서 항목이 바뀔 때마다 장소 상세도 고쳐야 한다. 홈 미리보기에 "더 보기"·작성 버튼 → Figma 6-01에 없다. 홈 미리보기를 별도 컴포넌트(`ReviewPreview`)로 공개 → 보이는 정보가 같아 장소 상세가 알아야 할 이름만 늘어난다.
- Anchors: `fe/src/domains/review/ui/review-section.tsx#ReviewSection` (new) · `fe/src/domains/review/model/review.ts#reviewWriteHref` (new)

## D-32 실제 장소 상세 화면에 맞춘 리뷰 붙이기(검색 브랜치 기준)
- Status: settled
- Decision: 장소 상세 화면(검색 담당의 `PlaceDetailScreen`, 2026-10-23 master 병합)에 리뷰 담당이 직접 리뷰 탭, 홈 미리보기, "방문 평가 남기기"를 붙인다. 상세 화면은 `src/domains/place`에 있고 ESLint가 도메인끼리 import를 막으므로(`app → domains → shared`), 상세 화면이 세 자리를 렌더 함수 props(`slots`의 `homeReviews`는 홈 탭 맨 아래, `reviewTab`은 리뷰 탭 내용, `bottomAction`은 하단 막대 안)로 열고 `src/app/place`의 클라이언트 컴포넌트(`PlaceDetailWithReviews`)가 `ReviewSection`과 `reviewWriteHref`로 채운다. 자리를 넘기지 않으면 상세 화면은 리뷰 탭과 하단 막대를 그리지 않는다. 리뷰 탭은 메뉴와 정보 사이에 둔다. 상세 탭은 주소가 아니라 화면 상태로 바뀌고 "정보 더보기"와 메뉴 "전체 보기"도 콜백으로 탭을 바꾼다. 그래서 홈 미리보기는 `previewHref` 링크 대신 `onShowAll` 콜백을 받아 메뉴 섹션처럼 머리글 오른쪽에 "전체 보기"(`SectionHeaderAction`)를 두고, 리뷰가 없으면 이 버튼을 숨긴다. 작성 화면은 등록에 성공하거나 닫으면 상세에서 들어왔을 때 `router.back()`으로 돌아가고, 주소로 바로 열었을 때만 `/place?id=<placeId>`로 바꿔치기한다. 상세는 들어가기 전 탭을 그대로 보이고, 다시 받은 목록에서 새 리뷰가 리뷰 탭 맨 위나 홈 미리보기 첫 줄에 보이며, 상세의 "뒤로" 한 번이면 검색 결과로 간다. 여백은 실제 상세 화면을 따른다. 홈 미리보기는 바깥 여백이 없어 홈 탭(`px-4 py-6`, 섹션 사이 `gap-8`) 안에 다른 섹션처럼 놓이고, 리뷰 탭은 메뉴·정보 탭처럼 `px-4 py-6`이다. 작성 화면에서 장소 id가 잘못되면 상세 화면과 같은 아이콘(`PinOffIcon`)과 안내("주소가 맞는지 확인해 주세요")를 보인다. 같은 MR에서 `place-detail-screen.test.tsx`의 "리뷰 탭은 없다"를 자리 기준으로 고치고 검색 담당을 리뷰어로 둔다. 그 밖(공개 이름은 `ReviewSection`과 `reviewWriteHref` 둘, 두 자리가 같은 쿼리, 리뷰 탭의 다음 페이지와 "다시 불러오기", 빈 상태와 오류, 항목 모양, 등록 토스트)은 D-31 그대로다.
- Rejected: 상세 탭을 주소의 `tab`으로 고르기(D-31) → 검색 담당 코드의 탭 상태와 "정보 더보기"·"전체 보기"를 모두 바꿔야 하고, 등록 뒤 `?tab=review`로 바꿔치기하면 방문 기록에 상세가 두 번 남아 "뒤로"를 두 번 눌러야 검색 결과로 간다. 등록 뒤 Figma 7-06처럼 늘 리뷰 탭 열기 → 주소 탭이 필요하다. Figma 6-01의 "리뷰 12 ›" 제목 링크 → 상세 탭이 화면 상태라 링크로는 탭을 바꾸지 못하고 방문 기록만 늘어난다. 상세 화면(`domains/place`)에서 리뷰 컴포넌트를 바로 import → ESLint 의존 방향 규칙에 걸린다. Figma 여백(좌우 20) → 실제 상세 화면이 16을 써서 리뷰만 어긋난다. 장소 상세 연동 문서를 따로 두기 → 리뷰 담당이 직접 붙이므로 이 결정과 spec으로 충분하다.
- Anchors: `fe/src/domains/review/ui/review-section.tsx#ReviewSection` (modify) · `fe/src/app/place/review/review-write-screen.tsx#ReviewWriteScreen` (modify) · `fe/src/domains/place/ui/place-detail-screen.tsx#PlaceDetailSlots` (modify) · `fe/src/app/place/place-detail-with-reviews.tsx#PlaceDetailWithReviews` (new) · `fe/src/app/place/page.tsx#PlaceDetailPage` (modify)

## D-33 리뷰 시드는 장소 Mock의 근거에 맞춘다
- Status: superseded by D-35
- Decision: 리뷰 시드(`classpath:mock/reviews.json`)를 장소 Mock 30곳 모두에 넣는다(D-27의 "1번 장소에 25건"을 넓힌다). 장소 카드가 "앱 리뷰"를 근거로 드는 항목(`scoreItems`의 `matched: true`)마다 `evidenceCount`만큼 그 내용을 말하는 리뷰를 두고, 추천 이유의 인용(`quoteSource` "앱 리뷰")은 그중 하나로 그대로 넣어 그 장소의 가장 최근 리뷰로 둔다. 근거가 없는(`matched: false`) 항목은 말하지 않는다. 장소 Mock이 "조용해요"(근거 있음)와 "조용한 곳"(근거 없음)을 함께 두는 곳은 앞쪽을 따른다. 여기에 메뉴 2개, 주의점, 일반 평 하나와 내용 없는 리뷰 1~2건을 더해 장소마다 7~21건이다. 1번 장소는 커서 페이지를 확인하도록 25건과 작성 시각을 그대로 두고 내용만 맞춘다. 작성 시각은 2026-09-02~10-20 사이에서 업종에 맞는 시간대(식당 11~20시, 카페 10~19시, 술집 19~23시 KST)다. 그래서 상세 화면의 추천 이유·핏 점수 설명과 리뷰 탭이 어긋나 보이지 않는다. 시드와 장소 Mock은 id와 내용으로만 맞춘 것이고, 장소 분석이 리뷰를 읽는 실제 연결은 1차 후속(D-17)이다. 장소 Mock이 바뀌면 시드도 다시 맞춘다.
- Rejected: 1번·2번 장소에만 시드 → 나머지 28곳은 카드가 "앱 리뷰 n개가 근거"라고 하는데 리뷰 탭은 "리뷰 0"이다. 장소 Mock이 리뷰 저장소를 읽어 근거를 계산 → 장소 담당 코드를 바꾸는 일이고 1차 후속의 분석 연결과 겹친다. 시드와 장소 Mock을 테스트로 묶기 → 장소 담당이 Mock을 고칠 때마다 리뷰 테스트가 깨진다.
- Anchors: `be/src/main/resources/mock/reviews.json` (modify)

## D-34 리뷰 변경 전달(읽는 경로는 받는 쪽이 정한다)
- Status: settled
- Decision: 리뷰는 삭제·숨김·분석 제외를 시각 컬럼으로 남기고(D-28) 바뀔 때마다 `updated_at`을 갱신해, 읽는 쪽이 상태와 변경 시점을 알 수 있게 한다. 리뷰 기능이 책임지는 것은 여기까지다. 어떤 경로로 읽을지는 받는 쪽마다 정한다. 서버 안에서 도는 일괄 처리(검색 색인 등)는 리뷰 테이블을 직접 조회할 수 있다. 하지만 AI 분석·비교는 Modal에서 돌아 서버 내부망의 Postgres에 붙지 못하므로(AI 비교 spec 6절) 다른 경로가 필요하다. 그 경로(BE 조회 API, 정기 내보내기 등)와 필요한 필드·주기는 AI·인프라 담당과 정한다(spec Open questions). 이벤트나 아웃박스 같은 고도화는 이후에 정한다.
- Rejected: 모든 일괄 처리가 리뷰 테이블을 직접 조회(D-17) → AI 서비스는 내부망 DB에 붙을 수 없다. 리뷰가 내보내기 API를 먼저 만들기 → 받는 쪽이 필요한 필드와 주기가 정해지지 않았다. 지금 아웃박스 이벤트 도입 → 공용 인프라가 필요하고 받는 쪽이 아직 없다.

## D-35 리뷰 저장소를 DB로 바꾸고 메모리 저장소와 시드를 지운다
- Status: settled
- Decision: 리뷰를 `reviews` 테이블(`V4__create_reviews.sql`)에 저장한다. 와이어프레임 화면에 있는 컬럼만 담고, 공개 숨김·분석 제외(S15P31A302-56)는 그 기능을 만들 때 새 마이그레이션으로 더한다. develop에 머지되면 dev DB에 바로 적용돼 고칠 수 없으므로 컬럼을 더할 때는 NULL 허용이나 기본값으로 더한다. 날짜 컬럼은 팀 DB 규칙 초안을 따라 `visit_date`이고(D-28의 `visited_at`), API 필드는 그대로 `visitedAt`이다. `revisit_intent`는 7-04 토글의 기본값과 같은 `NOT NULL DEFAULT false`, `spent_per_person`(7-04의 1인당 쓴 금액)은 NULL 허용이다. `user_id`는 `auth_users(id)`(text)를 참조하고, `place_id`는 `places` 테이블이 없어 FK가 없다. 인덱스는 장소별 목록 `(place_id, created_at DESC, review_id DESC) WHERE deleted_at IS NULL`과 같은 날 중복 금지 `UNIQUE (user_id, place_id, visit_date) WHERE deleted_at IS NULL`이다. 목록은 행 비교 커서 `(created_at, review_id) < (?, ?)`로 읽어 인덱스가 범위와 정렬을 맡고, 리뷰 수는 첫 페이지(`cursor` 없음)에서만 세어 다음 페이지 응답에서는 생략한다. 등록은 로그인한 사용자만 한다. 리뷰 컨트롤러가 `Authorization` 헤더로 인증 모듈의 `AuthUseCases.authenticate`를 직접 부르고, 인증 모듈의 예외 처리기는 인증 API에만 걸려 있어 `AuthFailure`는 리뷰 예외 처리기가 상태 코드와 `type`(토큰 만료)을 유지해 ProblemDetail로 바꾼다. 방문일 입력은 아직 없어 서버가 KST 오늘로 넣는다. 메모리와 DB를 바꿔 끼우려고 둔 `ReviewStore`는 지우고 `ReviewService`가 `ReviewRepository`를 바로 쓴다. 메모리 저장소, 시드(`mock/reviews.json`), 저장소가 없을 때의 503을 지운다. `REVIEW_MOCK_ENABLED`와 `review.mock.enabled`는 다른 기능의 파일에도 있어 따로 지운다. FE 작성 화면은 들어올 때 세션을 확인해 없으면 로그인 화면으로 바꿔치기하고, 등록 요청에 AT를 붙이며 만료면 한 번 갱신해 다시 보낸다. 인증 도메인은 app 계층(`with-access-token.ts`)에서만 부른다.
- Rejected: 메모리 저장소를 dev 시드용으로 남기기 → 저장소가 둘이면 local·dev와 prod의 동작이 갈리고 스위치를 계속 관리해야 한다. 시드를 마이그레이션에 넣기 → Mock 데이터가 운영 DB에 들어간다. `ReviewStore` 유지 → 구현이 하나뿐이다. 페이지마다 리뷰 수 세기 → 다음 페이지마다 쿼리가 하나 는다. 리뷰용 인증 인터셉터 → 인증이 필요한 리뷰 API가 하나이고 목록은 인증이 선택이라 컨트롤러에서 직접 부르는 편이 단순하다.
- 감수: dev 리뷰는 빈 상태에서 시작한다. 장소 카드가 "앱 리뷰 n개가 근거"라고 해도 리뷰 탭이 비어 보일 수 있다(D-33이 막던 상황). 로그인 뒤 작성 화면으로 돌아오는 기능은 아직 없다.
- Anchors: `be/src/main/resources/db/migration/V4__create_reviews.sql` (new) · `be/src/main/java/kr/co/fitdining/api/review/store/Review.java#Review` (new) · `be/src/main/java/kr/co/fitdining/api/review/store/ReviewRepository.java#ReviewRepository` (new) · `be/src/main/java/kr/co/fitdining/api/review/ReviewController.java#ReviewController` (modify) · `fe/src/app/place/review/with-access-token.ts#withAccessToken` (new)

## D-38 회원이 탈퇴해도 그 회원의 리뷰는 남긴다
- Status: settled
- Decision: 회원이 탈퇴해도 그 회원의 리뷰는 지우지 않는다. 목록과 리뷰 수에 그대로 보이고 리뷰 행(`deleted_at`, `updated_at`)도 바꾸지 않는다. 탈퇴는 회원 담당(S15P31A302-60)이 `auth_users.deleted_at`으로 처리하고, 리뷰는 탈퇴 처리(`UserService.withdraw`)에 끼어들지 않는다. 탈퇴한 회원의 리뷰는 작성자를 닉네임 대신 "탈퇴한 회원"으로 보인다. 탈퇴해도 `auth_users.nickname`은 남으므로, 닉네임을 붙이는 목록 확장(S15P31A302-52)이 `auth_users.deleted_at`을 보고 바꾼다. 리뷰 사진(S15P31A302-54)도 리뷰와 함께 남는다. 탈퇴한 회원의 신고 기록 처리(S15P31A302-55, S15P31A302-56)는 각 이슈에서 다룬다. `fk_reviews_user_id`는 기본값(NO ACTION) 그대로 둔다. 같은 사람이 탈퇴한 뒤 다시 가입하면 새 계정(새 id)이라서 같은 장소·날짜에 다시 쓸 수 있고 예전 리뷰도 남는다. 시험은 회원 테이블을 고치지 않고 새 id 사용자로 확인한다.
- 토큰 검증(`AuthUseCases.authenticate`)은 DB를 보지 않아 탈퇴 뒤에도 남은 AT가 만료 전까지 유효하므로, 등록은 작성자가 탈퇴하지 않은 기존 사용자인지(`existsByIdAndDeletedAtIsNull`) 먼저 확인하고 아니면 401이다. 그 사이 계정 행이 사라져 `fk_reviews_user_id`를 어기면 그것도 401로 바꾼다. 탈퇴 트랜잭션과 정확히 같은 순간 들어온 등록은 확인을 지나칠 수 있지만, 같은 사용자가 탈퇴와 등록을 동시에 해야 해서 잠금은 두지 않았다.
- PRD FR-07은 탈퇴하면 리뷰를 삭제 상태로 표시한다고 정하지만, 리뷰는 남긴다. PRD와 대조한 뒤 리뷰 담당이 확인한 결정이다. PRD OQ-17(soft delete 탈퇴의 법·심사 위험)이 회원 행을 hard delete하기로 정하면 `fk_reviews_user_id`가 회원 행 삭제를 막으므로, 그때 작성자 익명화나 `ON DELETE SET NULL`을 다시 정한다.
- Rejected: 탈퇴와 함께 그 회원의 리뷰를 soft delete(PRD FR-07, 이 결정의 처음 내용) → 탈퇴로 장소의 리뷰 수와 분석 근거가 줄지 않게 한다. 리뷰는 남기되 `auth_users.deleted_at`을 보고 목록과 리뷰 수에서 빼기 → 목록마다 회원 테이블을 조인해야 하고, AI 전달이 숨김을 알아보지 못한다.
- Anchors: `be/src/main/java/kr/co/fitdining/api/review/ReviewService.java#ReviewService.create` (new) · `be/src/test/java/kr/co/fitdining/api/review/ReviewPersistenceTest.java#ReviewPersistenceTest.Withdrawal` (new)

## D-39 숨긴 리뷰의 사진은 작성자 본인에게 계속 보인다
- Status: settled
- Decision: PRD FR-12대로 운영자가 숨긴 리뷰는 작성자 본인에게 "운영 정책에 따라 숨김 처리됨" 표시와 함께 사진까지 계속 보인다. 공개 목록에서는 리뷰와 사진이 모두 빠진다. 숨기면 그 리뷰의 사진(원본과 썸네일)을 지금처럼 공개 경로(`confirmed/`) 밖의 접두사로 옮기고, 작성자 본인이 볼 때는 BE가 수명이 짧은 presigned GET URL을 내려준다. 해제하면 공개 경로로 되돌리고, 삭제하면 객체를 지운다. 구현은 사진(S15P31A302-54)과 운영(S15P31A302-56)에서 한다.
- Rejected: 숨김 때 사진 그대로 두기 → "욕설·혐오·음란물" 숨김이 사진에는 효과가 없다. 작성자에게도 사진을 보이지 않기(D-10) → PRD FR-12는 숨긴 리뷰가 작성자에게 계속 보이도록 한다.

## D-36 이유 태그 테이블과 반복 마이그레이션 시드
- Status: settled
- Decision: 태그는 `reason_tags`(`code`, `feature_code`, `sentiment`, `label`, `display_group`, `sort_order`), 업종 노출은 `reason_tag_categories`(`category`, `code`, `label`), 리뷰의 태그는 `review_reason_tags`(`review_id`, `code`)에 둔다(`V5__create_reason_tags.sql`). 기본 키는 각각 `code`, `(category, code)`, `(review_id, code)`이다. 태그는 바뀌지 않는 `code`로 참조하고 API도 `code`를 쓴다. `feature_code`는 AI 코드표(S15P31A302-39)의 코드이고, 장소 특징 분석(S15P31A302-40) 규칙대로 장소에서 실제로 그랬던 쪽을 적는다. 그래서 "너무 시끄러웠어요"는 `LIVELY`·`BAD`, "너무 썰렁했어요"는 `QUIET`·`BAD`다. 사용자 취향 쪽 코드는 소음 축 아쉬웠어요만 반대 극이고 나머지는 같아 컬럼으로 두지 않고, AI 전달(S15P31A302-57)에서 이 규칙으로 바꿔 함께 보낸다. 같은 그룹은 같은 `feature_code`이고, PRD L1의 유일한 양극 축인 `QUIET`·`LIVELY` 네 태그만 한 그룹(`NOISE`)이다. 같은 특징이 업종마다 문구만 다르면 태그 하나로 두고 `reason_tag_categories.label`에 업종 문구를 적는다(혼밥·혼술은 `PURPOSE_SOLO` 하나, 술집 문구만 혼술). 태그는 아직 확정되지 않아 PRD FR-10 초안 28개와 업종별 노출 표를 임시 시드로 쓰고, 시드는 반복 마이그레이션 `R__reason_tag_seed.sql`에 둔다. 태그는 `code`로 덮어쓰고 노출 행은 지운 뒤 다시 넣으므로, 확정되면 이 파일만 고쳐 dev·prod에 다시 적용한다. 목록에서 빼려면 노출 표에서 그 특징을 지우고, 이미 쓴 리뷰가 참조하는 태그 행은 남긴다. 화면 묶음은 Figma의 분위기·공간·이용·방문 목적에 양을 더했다(양 충분은 "양", 혼밥·모임은 "방문 목적").
- Rejected: 숫자 `tag_id` → `code`가 이미 바뀌지 않는 식별자다. `exclusive_group` 컬럼 → 소음 축 말고는 `feature_code`와 같다. `active` 컬럼 → 노출 행이 없으면 고를 수 없다. 사용자 쪽 코드 컬럼 → 다른 경우가 두 태그뿐이고 규칙 하나로 정해진다. 혼밥·혼술을 태그 둘로 → 같은 특징이 두 코드로 나뉜다. 버전 마이그레이션에 시드 → 태그가 바뀔 때마다 새 버전 파일이 쌓인다. Figma 화면의 22개만 시드 → 카페 화면이라 식당·술집 태그가 빠진다.
- Anchors: `be/src/main/resources/db/migration/V5__create_reason_tags.sql` (new) · `be/src/main/resources/db/migration/R__reason_tag_seed.sql` (new) · `be/src/main/java/kr/co/fitdining/api/review/tag/ReasonTagRule.java#ReasonTagRule` (new) · `fe/src/domains/review/model/review-tags.ts#disabledTagCodes` (new)

## D-37 작성 화면 데이터와 장소 확인
- Status: settled
- Decision: `GET /api/v1/places/{placeId}/review-form`은 로그인한 사용자에게 장소(이름·업종·역), 방문일 범위(`min`, `max`, `default`), 이 사용자가 이 장소에 범위 안에서 남긴 방문일(`reviewedDates`), 업종에 노출되는 태그(좋았어요·아쉬웠어요로 나누고 태그마다 `group`을 담는다), 제한값(본문 500자, 사진 5장, 1인당 금액 1,000,000원), `writable`을 돌려준다. `group`은 BE의 `ReasonTagRule.group`이 계산해 내려 FE가 소음 축 규칙을 따로 갖지 않는다. 방문일 범위는 `VisitDatePolicy`가 주입한 `Clock`의 KST 날짜로 계산한다(D-4). `reviewedDates`는 `(user_id, place_id, visit_date >= min) WHERE deleted_at IS NULL`이라 중복 금지 인덱스를 탄다. 장소는 장소 기능의 `PlaceService.getPlace`를 직접 불러 확인하고, 작성 화면 데이터와 등록 둘 다 적용한다(D-21). 작성 화면 데이터도 등록처럼 탈퇴하지 않은 사용자인지 장소보다 먼저 확인하고 아니면 401이다(D-38). 장소 예외 처리기는 장소 컨트롤러에만 걸려 있어 리뷰 예외 처리기가 `PlaceNotFoundException`을 404로, `PlaceSearchUnavailableException`을 503으로 바꾼다. 작성 차단(S15P31A302-56) 전에는 `writable`이 늘 `true`다. API 경로가 `/reviews`와 `/review-form`으로 나뉘어 리뷰 컨트롤러는 `/api/v1/places/{placeId}` 아래에 둔다.
- Rejected: 장소 기능에 `Optional`을 돌려주는 조회 메서드를 새로 요청 → 다른 모듈은 있는 메서드를 직접 부르기로 했다. 태그 그룹 규칙을 FE에도 두기 → 같은 규칙이 두 곳에 생긴다. `reviewedDates`를 범위 밖까지 → 달력은 범위 안만 그린다.
- Anchors: `be/src/main/java/kr/co/fitdining/api/review/VisitDatePolicy.java#VisitDatePolicy` (new) · `be/src/main/java/kr/co/fitdining/api/review/dto/ReviewFormResponse.java#ReviewFormResponse` (new) · `be/src/main/java/kr/co/fitdining/api/review/ReviewService.java#ReviewService.reviewForm` (new)

## D-40 등록 요청에 방문일, 이유 태그, 재방문 의사, 1인당 금액을 더한다
- Status: settled
- Decision: `ReviewCreateRequest`는 `visitedAt`(필수), `tagCodes`(필수, 1개 이상), `revisitIntent`(필수), `description`(선택, 500자), `spentPerPerson`(선택, 0~1,000,000)이다. 사진(`photos`)은 S15P31A302-54에서 더한다. 처리 순서는 인증(401) → 필드 형식(400) → 작성자가 탈퇴하지 않았는지(401, D-38) → 장소(404, 503) → 방문일 범위(`VisitDatePolicy`, 400) → 태그 규칙(`ReasonTagRule`, 400) → 저장(같은 방문일이면 409)이다. 컨트롤러는 `@Valid` 대신 인증한 뒤 `Validator`로 본문을 검증한다. `@Valid`는 메서드 실행 전에 돌아 필수 필드가 생기면 토큰 없는 `{}` 요청이 401이 아니라 400이 되기 때문이다(회원 담당의 `AuthApplicationFlowTests`가 이 요청을 401로 확인한다). 400은 모두 같은 `detail`이고 FE는 상태 코드로만 구분한다. FE가 방문일과 태그를 미리 막으므로 400은 작성 화면 데이터가 낡았을 때만 생긴다. 태그는 `Review`의 `@ElementCollection`(`review_reason_tags`)으로 들어 리뷰와 같은 `saveAndFlush`에 저장된다. 리뷰 행이 중복으로 실패하면 태그 행도 남지 않고, 저장 트랜잭션이 장소 조회(외부 검색 엔진일 수 있다)를 감싸지 않는다. `review-form`의 장소에 대표 사진(`thumbnailUrl`)을 더해 7-01 머리에 보인다. 본문과 1인당 금액 상한은 `ReviewCreateRequest`의 상수 하나를 검증과 작성 화면 데이터의 `limits`가 함께 쓴다(DB 제약 V4는 따로 맞춘다). 서비스는 컨트롤러가 검증한 요청을 받는다고 보고 필드 null을 다시 확인하지 않는다.
- Rejected: `@Valid` 유지하고 인증 테스트의 본문을 채우기 → 로그인하지 않은 요청이 본문 형식을 먼저 알게 되고 다른 담당의 테스트를 고쳐야 한다. `revisitIntent`를 `boolean`으로 받아 언박싱을 없애기 → 값을 빠뜨려도 400이 아니라 `false`로 저장된다. `create` 전체를 `@Transactional`로 감싸고 JDBC로 태그 넣기 → 장소 조회 동안 DB 연결을 잡는다. 400마다 `type` 나누기 → FE가 미리 막아 쓰는 곳이 없다(spec Open questions의 400 구분 질문은 남긴다).
- Anchors: `be/src/main/java/kr/co/fitdining/api/review/dto/ReviewCreateRequest.java#ReviewCreateRequest` (modify) · `be/src/main/java/kr/co/fitdining/api/review/ReviewController.java#ReviewController.create` (modify) · `be/src/main/java/kr/co/fitdining/api/review/ReviewService.java#ReviewService.create` (modify) · `be/src/main/java/kr/co/fitdining/api/review/store/Review.java#Review` (modify)

## D-41 작성 화면을 Figma 2단계 흐름으로 바꾼다
- Status: settled
- Decision: 작성 화면은 한 화면 폼(`SimpleReviewForm`)을 지우고 `ReviewForm`으로 바꾼다. `review-form`을 AT로 받은 뒤 7-01(좋았던 점) → 7-02(아쉬웠던 점) → 7-04·7-05(재방문 의사, 본문, 사진, 1인당 금액)를 한 컴포넌트 상태로 오가고 마지막에 한 번 등록한다. 1/2단계는 7-01·7-02, 2/2단계는 7-04다. 방문일은 7-01 머리의 방문일 줄을 누르면 뜨는 시트(7-03)에서 고르고, 달력은 리뷰 도메인에 둔다(`visit-calendar`). 7-01·7-02의 장소·방문일 줄은 상단 막대와 함께 고정해 태그를 내려 봐도 남는다. 7-03은 닫히는 동안에도 달력을 그려 두어 시트가 줄어들지 않고 그대로 내려간다. 범위 밖 날은 비활성, 이미 쓴 날은 "작성함"(취소선)이며 날짜 계산은 BE가 준 `min`·`max`만 쓴다. 기본 방문일은 오늘이고, 오늘 이미 쓴 장소면 비운 채 시작해 방문일과 좋았어요 태그가 있어야 7-01의 "다음"이 켜진다. "<"는 확인 없이 이전 페이지로 가고 입력을 남긴다. 7-01의 "X"는 쓴 내용(방문일 변경, 태그, 2/2단계 입력)이 있을 때만 7-E03("나가기"·"계속 쓰기")을 띄운다. 쓴 내용은 처음 입력을 지금 작성 화면 데이터에 맞춘 것과 비교해, 다시 받은 데이터 때문에 비워진 방문일은 쓴 내용으로 보지 않는다. 브라우저 뒤로 가기는 막지 않는다. 2/2단계가 모두 비면 버튼이 "건너뛰고 등록하기"다. 7-04 문구("비슷한 취향의 장소를 찾아드릴게요.")는 와이어프레임 그대로 둔다(D-18). 사진 칸은 "최대 5장"과 "추가" 칸만 보이고, 누르면 "사진은 아직 올릴 수 없어요" 토스트다(업로드는 S15P31A302-54). 1인당 금액은 숫자만 받고 세 자리마다 쉼표를 찍으며 상한을 넘는 입력은 받지 않는다. 장소 대표 사진이 없으면 장소 카드와 같은 그라데이션을 그린다. 등록 실패는 연결 끊김이면 7-E06, 5xx와 시간 초과면 7-E05("다시 등록"), 409면 "이 날짜에는 이미 리뷰를 남겼어요"와 "방문일 바꾸기"(작성 화면 데이터를 다시 받고 7-01에서 7-03을 연다), 401(AT 갱신까지 실패)이면 다시 로그인하라는 안내, 404(쓰는 동안 장소가 없어짐)면 "장소를 찾을 수 없어요"와 "나가기"(작성 화면 데이터를 다시 받지 않는다), 그 밖의 4xx면 "입력한 내용을 확인해 주세요"다. 404를 빼면 어느 경우든 입력은 남는다. 409, 401, 404 안내는 예외 상태 화면에 없어 7-E05와 같은 다이얼로그 꼴로 그린다. 같은 그룹 태그 비활성 표시는 공통 `Chip`에 비활성 모양(회색 바탕과 글자)을 더했다. 등록에 성공하면 목록과 작성 화면 데이터를 다시 받는다. 등록하거나 "X"로 나가면 흐름을 새로 만들어, Next가 숨겨 둔 화면을 다시 열면 빈 입력으로 시작한다. 브라우저 뒤로 가기로 나가면 입력이 남는다. 작성 화면 데이터를 다시 받으면(400·409 뒤, 창 복귀) 고를 수 없게 된 방문일(범위 밖, 이미 쓴 날)과 더는 노출되지 않는 태그를 입력에서 뺀다(`reconcileDraft`). 그래서 방문일이나 좋았어요 태그가 빠진 채 등록하면 보내지 않고 7-01로 돌아가며, 방문일이 비었으면 7-03을 연다. 로그인 화면으로 보내는 401은 작성 화면 데이터를 처음 불러올 때뿐이다. 쓰는 중에 다시 받다가 난 401은 입력을 지키려고 넘기고, 등록할 때 다시 로그인하라고 안내한다.
- Rejected: "<"에서도 7-E03 → 이전 페이지로 가도 입력이 남아 "작성한 내용이 사라져요"와 맞지 않는다(2026-10-27 리뷰 담당 결정). 7-04 부제를 빼기 → 리뷰 담당이 와이어프레임대로 두기로 했다. 사진 칸 숨기기 → 리뷰 담당이 빈 칸을 보이기로 했다. 사진을 골라 미리보기만 → 올라가지 않는 사진을 올린 것처럼 보인다. 오늘 이미 쓴 장소도 오늘을 기본값으로 → 등록 끝에서야 409를 받는다. 페이지마다 주소를 나누기 → 등록 전 입력을 주소 사이에 들고 다녀야 한다. 다시 받은 작성 화면 데이터를 입력에 맞추지 않기 → 범위 밖 방문일로 7-03이 깨지고, 보이지 않는 태그 때문에 같은 400이 되풀이된다. 데이터가 있어도 401이면 로그인 화면으로 → 창으로 돌아오기만 해도 쓰던 입력이 사라진다. 등록 404를 "입력한 내용을 확인해 주세요"로 → 다시 받아도 404라 이전 데이터로 화면이 남고 같은 안내만 되풀이된다. KST 자정에 작성 화면 데이터를 다시 받기 → 400은 한 달 전 날을 고른 채 자정을 넘겼을 때만 나고, 그때도 다시 받은 데이터로 방문일을 비워 바로잡는다. "오늘 · " 표기는 창으로 돌아올 때 맞춰진다.
- Anchors: `fe/src/domains/review/ui/review-form.tsx#ReviewForm` (new) · `fe/src/domains/review/ui/visit-calendar.tsx#VisitDateSheet` (new) · `fe/src/domains/review/model/review-draft.ts#toCreateRequest` (new) · `fe/src/domains/review/model/review-draft.ts#reconcileDraft` (new) · `fe/src/domains/review/ui/submit-failure.ts#submitFailure` (new) · `fe/src/shared/ui/button/chip.tsx#Chip` (modify)
