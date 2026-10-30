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

1. **리뷰 목록**: 장소 상세의 홈 탭은 "리뷰 12 >" 아래 최신 3건을 보이고, 이 머리글을 누르면 리뷰 탭이 열린다(6-01). 리뷰 탭은 `GET /api/v1/places/{placeId}/reviews`로 첫 페이지와 `totalCount`를 받아 작성일과 본문을 최신순으로 그리고, 목록 끝이 보이면 다음 페이지를 커서로 받는다(D-24, D-32).
2. **작성**: 장소 상세 하단 막대의 "방문 평가 남기기"를 누르면 로그인 없이 작성 화면(`/place/review?id=`)이 열린다. 본문을 입력하고(비워도 된다) "등록하기"를 누르면 `POST /api/v1/places/{placeId}/reviews`가 한 번 나가고, 성공하면 "리뷰가 등록됐어요" 토스트와 함께 들어오기 전의 장소 상세로 돌아가 새 리뷰가 리뷰 탭 맨 위와 홈 미리보기 첫 줄에 보인다(D-6, D-32).

1차 후속

3. **작성 흐름**: 같은 작성 화면(`/place/review?id=`)이 Figma 2단계 흐름으로 바뀐다. 비회원이 "방문 평가 남기기"를 누르면 로그인 안내(6-E05)가 뜨고 "로그인"을 고르면 로그인 화면으로 가고, 로그인하면 그 장소 상세로 돌아온다(D-47, D-48). 작성 진입 때 `GET /api/v1/places/{placeId}/review-form`으로 작성 화면 데이터를 먼저 받고, 오늘 쓴 장소가 아니면 위치를 확인한다. 오늘 이미 리뷰를 썼으면 7-E01 모달, 근처 확인에 실패하면 7-E02 모달이 장소 상세 위에 뜬다(D-43). 작성은 Figma 2단계 흐름이다. 1/2단계에서 방문일과 좋았던 점(1개 이상), 아쉬웠던 점(선택)을 고르고, 2/2단계에서 재방문 의사, 본문, 사진, 1인당 금액을 입력한다. 같은 방문일로 이미 썼으면 409를 받아 방문일을 바꾸라고 안내한다(D-28, D-5, D-31, D-12).
4. **목록**: 리뷰 탭(6-03)에서 작성일 대신 방문일이 보이고 닉네임, 재방문 의사, 태그, 사진이 더해진다. 본인 리뷰는 닉네임 옆에 "내 리뷰" 태그가 붙고(6-06), 탈퇴한 회원의 리뷰는 "탈퇴한 회원"으로 보인다. 본인 리뷰에는 수정·삭제, 남의 리뷰에는 신고 메뉴가 뜬다(D-24, D-42).
5. **사진**: 사진을 고르면 앱이 1,600px 사진과 썸네일 두 벌을 JPEG로 다시 만들어(EXIF 제거, 용량이 넘으면 품질과 크기를 낮춰 맞춘다) `POST /api/v1/review-photos/upload-urls`로 받은 주소에 바로 올린다. 등록·수정 요청에는 업로드 id(남길 사진은 사진 id)만 담고, BE는 확정할 때 새 사진 id를 매긴다. 목록은 썸네일 줄을 보이고 누르면 1,600px 사진을 넘겨 본다. 리뷰를 지우면 사진도 지운다(D-9, D-45).
6. **수정·삭제**: 내 리뷰의 ⋯ 메뉴(6-06)에서 "수정하기"를 누르면 수정 화면(`/place/review/edit?id=<placeId>&review=<reviewId>`, 6-07)이 열린다. `GET /api/v1/reviews/{reviewId}`로 본문을 받아 고치고 `PATCH`로 보내면 "리뷰를 수정했어요" 토스트와 함께 장소 상세로 돌아간다. 본인 리뷰는 본문과 사진만 고칠 수 있다. "삭제하기"는 확인(6-08) 뒤 `DELETE`를 보내고, 목록을 다시 받아 리뷰가 빠지면 "리뷰를 삭제했어요" 토스트(6-09)가 뜬다. 같은 방문일로 다시 쓸 수 있다(D-28, D-6, D-44).
7. **신고와 운영**: 회원은 남의 리뷰 ⋯ 메뉴의 "신고하기"(6-10)에서 사유를 골라 신고하고(6-11) 토스트를 본다(6-12, 6-E06). 로그인하지 않았으면 ⋯에 "신고하기"만 있고, 누르면 로그인 안내(6-E05)가 뜨며 "로그인"을 고르면 로그인 화면으로 가고, 로그인하면 그 장소 상세로 돌아온다. 운영자는 관리자 API로 숨김, 분석 제외, 작성 차단과 각 해제를 하고 처리 기록이 남는다(D-11, D-46, D-47, D-48).

## Acceptance criteria

Walking Skeleton

- [x] AC-1: 인증 헤더 없이 본문과 함께 리뷰를 등록하면 201과 `reviewId`를 받는다. 본문 없이도 등록되고, 같은 장소에 여러 번 등록할 수 있다. (D-1, D-6, D-15) (D-35로 바뀜)
- [x] AC-2: `placeId`가 양의 정수가 아니면(숫자가 아님, 0 이하, `long` 범위 밖) 400 ProblemDetail이다. 장소가 실제로 있는지는 확인하지 않아 Mock 장소 ID로도 등록된다. (D-21, D-22)
- [x] AC-3: 본문이 500자를 넘으면 400 ProblemDetail이다. 공백뿐인 본문은 본문 없음으로 저장된다. (D-6)
- [x] AC-4: 목록은 `created_at` 내림차순(같으면 `review_id` 내림차순)이고 커서로 20건씩 다음 페이지를 받으며 페이지 사이에 중복이 없다. 항목은 `reviewId`, 작성 시각, 본문을 담고 `totalCount`는 삭제되지 않은 리뷰 수다. (D-24) (D-35로 바뀜)
- [x] AC-5: 요청 본문에 정의되지 않은 속성(예: `userId`, `createdAt`)이 있으면 400 ProblemDetail이다. 응답 JSON 키는 문서화된 필드를 벗어나지 않는다. (D-20)
- [x] AC-6: 리뷰 등록과 조회를 처리한 뒤(400 포함) BE 로그에 요청 본문과 리뷰 본문이 나타나지 않는다. (D-20)
- [x] AC-7: 장소 상세의 리뷰 탭은 리뷰 수와 리뷰 목록을 보이고, 목록 끝이 보이면 다음 페이지를 받는다. 홈 탭은 리뷰 수와 최신 3건을 보이고, 리뷰가 있으면 머리글 "리뷰 N >"로 리뷰 탭을 연다(D-42에서 "전체 보기"를 바꿈). 리뷰가 없으면 "리뷰 0"과 빈 상태 안내(6-E03)를, 목록을 불러오지 못하면 "다시 시도" 버튼이 있는 안내를 보인다. 목록은 작성일을 KST 날짜("10월 20일 작성")로 보인다. 작성 화면은 본문 입력칸 하나이고, 입력칸은 500자까지만 받으며 글자 수(예: 44/500)를 보인다. 등록 요청이 처리 중이면 "등록하기"가 비활성이다. 등록에 성공하면 "리뷰가 등록됐어요" 토스트가 뜨고 들어오기 전의 장소 상세(같은 탭)로 돌아가 새 리뷰가 리뷰 탭 맨 위와 홈 미리보기 첫 줄에 보이며, 상세의 "뒤로" 한 번이면 그 전 화면이다. 실패하면 화면에 오류 안내가 뜨고 입력이 남아 있다. (D-24, D-32)
- [x] AC-24: 리뷰는 메모리 Mock 저장소에 저장되고 `REVIEW_MOCK_ENABLED`가 꺼진 환경에서는 등록과 목록 모두 503 ProblemDetail이다. 전체 리뷰 수가 상한을 넘으면 가장 오래된 리뷰부터 목록과 `totalCount`에서 빠진다. 시드로 Mock 장소 30곳 모두에 리뷰가 있고, 1번 장소에는 25건이 있다. 장소 카드가 "앱 리뷰"로 드는 근거와 인용이 그 장소의 리뷰에 있다. (D-27, D-33) (D-35로 바뀜)

1차 후속

- [x] AC-8: 등록은 로그인한 사용자만 할 수 있다. `Authorization` 헤더 없이 등록이나 작성 화면 데이터를 요청하면 401 ProblemDetail이고, 목록은 헤더 없이도 조회된다. 리뷰에 작성자가 저장되고 목록 항목에 방문일과 현재 닉네임이 더해진다. 화면은 작성일 대신 방문일을 보이고, `createdAt`은 직전 FE를 위해 응답에 남는다. (D-24, D-15)
- [x] AC-9: 방문일이 KST 오늘보다 미래이거나 `오늘 - 1개월`보다 이전이면 400 ProblemDetail이다. 경계일(오늘, 오늘 - 1개월)은 통과한다. (D-4, D-40)
- [x] AC-10: 없는 장소에 등록하거나 작성 화면 데이터나 목록을 요청하면 404 ProblemDetail이다. Mock 장소는 통과한다. (D-21, D-22, D-42)
- [x] AC-11: `GET /api/v1/places/{placeId}/review-form`은 장소 이름·업종·역, 방문일 범위(KST), 이 사용자가 이 장소에 이미 쓴 방문일, 업종에 맞는 좋았어요·아쉬웠어요 태그와 각 태그의 그룹, 작성 가능 여부를 돌려준다. (D-4, D-5, D-21)
- [x] AC-12: 등록 요청에 이유 태그, 재방문 의사, 1인당 금액이 더해진다. 좋았어요 태그가 없거나, 업종에 노출되지 않는 태그가 있거나, 같은 그룹 태그가 둘 이상이면 400이다. 아쉬웠어요 태그는 없어도 된다. 소음 축 태그는 4개 중 하나만 고를 수 있다. 1인당 금액이 0원 미만 또는 1,000,000원 초과면 400이고 금액 없이도 등록된다. 리뷰와 태그는 한 트랜잭션에 저장된다. 로그인하지 않은 요청은 본문이 틀려도 400이 아니라 401이다. (D-28, D-5, D-6, D-40)
- [x] AC-13: 같은 사용자·장소·방문일로 두 번 등록하면 두 번째는 409 ProblemDetail이고, 두 요청이 동시에 와도 한 건만 저장된다. 다른 오류(없는 장소 등)는 409로 바뀌지 않는다. FE는 409를 받으면 "이 날짜에는 이미 리뷰를 남겼어요"를 보여 주고 입력을 남기며, "방문일 바꾸기"로 방문일 선택(7-03)을 연다. (D-28, D-31, D-41)
- [x] AC-14: 목록 항목에 방문일, 닉네임(탈퇴한 회원이면 생략해 "탈퇴한 회원"으로 보인다), 재방문 의사, 태그(장소 업종의 문구와 sentiment, 좋았어요 먼저), `mine`이 더해진다. 헤더 없이 조회하면 `mine`은 모두 false이고, 헤더가 있는데 토큰이 유효하지 않으면 401 ProblemDetail이다. 페이지 하나는 쿼리 5번(다음 페이지는 4번, 사진 조회 한 번 포함)이다. 사진은 AC-18, `hidden`은 AC-20에서 더한다. (D-24, D-42, D-45)
- [x] AC-15: 작성 화면은 Figma 2단계 흐름이다. 태그를 고르면 같은 그룹의 다른 태그가 페이지(7-01, 7-02)와 관계없이 비활성화된다. 좋았던 점을 하나도 고르지 않으면 7-01의 "다음"이 비활성이다. 태그는 분위기·공간·이용·양·방문 목적 묶음으로 나뉘어 보인다. "<"는 입력을 남긴 채 이전 페이지로 가고, 쓴 내용이 있을 때 "X"를 누르면 7-E03이다. "X"로 나간 뒤 다시 열면 빈 입력이다. 2/2단계가 모두 비면 "건너뛰고 등록하기"다. 등록 실패는 7-E05와 7-E06으로 나뉜다. (D-5, D-31, D-41)
- [x] AC-16: 작성자는 본문과 사진만 수정할 수 있다. 다른 필드(1인당 금액 포함)를 보내면 400, 남의 리뷰는 403 ProblemDetail이다. 수정해도 목록 순서는 그대로다. 사진은 고친 뒤의 사진 전체를 보낸다(AC-18). (D-6, D-24, D-44, D-45)
- [x] AC-17: 삭제하면 목록과 `totalCount`에서 즉시 빠지고, 같은 방문일로 다시 등록할 수 있다. (D-28, D-44)
- [x] AC-18: 사진은 리뷰당 5장 이하이고 사진마다 1,600px 사진과 썸네일 두 벌이 있다. 쓸 수 없는 사진(없음, 상한 초과, JPEG 아님, 같은 사진 두 번, 이 리뷰에 쓸 수 없는 사진)이 있으면 400 ProblemDetail이고 `type`은 `urn:fitdining:review:invalid-photo`다. 확정된 사진만 공개 경로로 읽힌다. 목록 항목과 수정 화면 데이터에 사진(`photos`)이 더해지고, 리뷰를 지우면 사진도 지운다. 로컬 Garage와 서버(Caddy 경유)에서 브라우저로 확인했다. (D-9, D-39, D-42, D-45)
- [x] AC-19: 신고는 리뷰당 한 번만 가능하다. 두 번째는 409, 본인 리뷰 신고는 400 ProblemDetail이고, 신고만으로 숨겨지지 않는다. "기타"를 고르면 설명 입력창이 나타나고 설명 없이도 신고된다. 설명은 100자까지 입력되고 글자 수(예: 0/100)를 보인다. "기타"가 아닌 사유에 설명을 보내거나 설명이 100자를 넘으면 400이다. (D-11, D-46)
- [ ] AC-20: 운영자가 숨기면 공개 목록에서 빠지고 작성자 본인에게는 `hidden: true`(이때 목록 항목에 더한다)로 보이며, 그 리뷰의 사진은 공개 경로로 읽히지 않는다. 작성자 본인에게는 "운영 정책에 따라 숨김 처리됨" 표시와 함께 사진도 보인다. 숨김은 분석 제외를 자동 적용하지 않는다. (D-11, D-39)
- [ ] AC-21: 숨김, 분석 제외, 작성 차단과 각 해제는 처리자·시각·동작을 처리 기록에 남긴다. 작성 차단된 사용자는 `review-form`에서 작성 불가로 안내받고 등록은 403 ProblemDetail이다. (D-11)
- [x] AC-22: "방문 평가 남기기"를 누르면 위치 확인이 시작되고 "측정 거리 + GPS 정확도 ≤ 100m"면 작성 화면에 "방문 확인 완료"가 보인다. 실패(권한 거절, 시간 초과, 범위 밖)하면 7-E02 모달이 뜨고 "다시 확인"으로 위치만 다시 받거나 "그냥 쓰기"로 작성할 수 있다. 로그인하지 않았거나 작성 화면 데이터를 받지 못하면 위치를 묻지 않는다. 로그인하지 않았으면 작성 화면 대신 로그인 안내(6-E05)를 띄우고, "로그인"은 로그인 화면으로 가서 로그인하면 그 장소 상세로 돌아오고, "취소"는 장소 상세에 남는다. 권한 창에 답하지 않아도 20초 뒤 7-E02가 뜨고, 확인하는 동안 상세를 떠나면 그 결과로 화면을 옮기지 않는다. 좌표와 결과를 어떤 요청(주소 포함)·로그·분석 이벤트에도 싣지 않는다. (D-12, D-43, D-47, D-48)
- [x] AC-23: 오늘 이미 리뷰를 쓴 장소에서 "방문 평가 남기기"를 누르면 위치와 상관없이 7-E01 모달이 뜨고, "다른 날 고르기"를 누르면 작성 화면에서 방문일 선택(7-03)이 열리며 이미 쓴 날은 "작성함"으로 막혀 있다. "닫기"는 장소 상세에 남는다. 이때 위치는 묻지 않는다. (D-4, D-12, D-43)
- [x] AC-25: 리뷰는 `reviews` 테이블에 저장된다. 목록은 목록 인덱스(`idx_reviews_place_id_created_at_review_id`)로 범위와 정렬을 처리하고, `totalCount`는 첫 페이지 응답에만 있다. (D-35)
- [x] AC-26: 작성·수정 화면은 로그인하지 않았으면 로그인 화면으로 바뀌고, 로그인하면 그 화면으로 돌아온다. 등록 요청의 AT가 만료됐으면 한 번 갱신해 다시 보내고, 갱신에 실패하면 다시 로그인하라는 안내를 보이며 입력을 남긴다. (D-15, D-35, D-48)
- [x] AC-27: 회원이 탈퇴해도 그 회원의 리뷰는 목록과 리뷰 수에 남고, 탈퇴 뒤 남은 토큰으로는 리뷰를 등록할 수 없다(401). (D-38)
- [x] AC-28: 로그인하지 않으면 모든 리뷰의 ⋯ 메뉴에 "신고하기"만 있고, 누르면 시트를 열지 않고 로그인 안내(6-E05, "로그인이 필요해요")를 띄운다. "로그인"은 로그인 화면으로 가서 로그인하면 그 장소 상세로 돌아오고, "취소"는 창만 닫는다. 로그인하면 내 리뷰에는 "수정하기"·"삭제하기", 남의 리뷰에는 "신고하기"가 있다. (PRD FR-12, D-46, D-47, D-48)

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
| `be/src/main/resources/application.yml#review` (`review.mock.enabled`), `be/.env.example` (리뷰 Mock 스위치. 다른 기능 파일과 함께 지웠다) | delete | WS | D-27, D-35 |
| `be/src/main/java/kr/co/fitdining/api/review/ReviewService.java#ReviewService.list` (작성자와 태그를 페이지 단위로 읽는다) | modify | 1차 | D-42 |
| `be/src/main/java/kr/co/fitdining/api/review/store/ReviewRepository.java#ReviewRepository.findTags` | new | 1차 | D-42 |
| `fe/src/app/place/review/page.tsx#ReviewWritePage` (2단계 흐름 `ReviewForm`을 그린다) | new | WS | D-31, D-41 |
| `fe/src/domains/auth/api/with-access-token.ts#withAccessToken` (등록 요청에 AT를 붙이고 만료면 한 번 갱신. S15P31A302-104가 인증 도메인으로 옮겼다) | new | 1차 | D-35 |
| `fe/src/app/place/with-optional-access-token.ts#withOptionalAccessToken` (목록 요청에 세션이 있을 때만 AT를 붙인다) | new | 1차 | D-42 |
| `fe/src/domains/review/ui/review-list-view.tsx#ReviewListView` (6-03 항목) | modify | 1차 | D-24, D-42 |
| `fe/src/domains/place/ui/place-detail-screen.tsx#PlaceDetailSlots` (검색 담당의 상세 화면에 리뷰 탭과 세 자리의 렌더 함수 props를 연다) | modify | WS | D-32 |
| `fe/src/app/place/place-detail-with-reviews.tsx#PlaceDetailWithReviews` (세 자리를 리뷰 컴포넌트로 채운다. `app/place/page.tsx`가 그린다. 로그인 안내의 "로그인"은 돌아올 주소를 남긴다) | new | WS | D-32, D-48 |
| `fe/src/domains/review/ui/review-section.tsx#ReviewSection` (리뷰 탭 목록, `onShowAll`을 주면 홈 탭 미리보기) | new | WS | D-24, D-32 |
| `fe/src/domains/review/api/review-api.ts#createReview` | new | WS | D-31 |
| `fe/src/domains/review/model/review.ts#reviewWriteHref` | new | WS | D-31 |
| `be/src/main/java/kr/co/fitdining/api/review/VisitDatePolicy.java#VisitDatePolicy` | new | 1차 | D-4 |
| `be/src/main/java/kr/co/fitdining/api/review/tag/ReasonTagRule.java#ReasonTagRule` | new | 1차 | D-5, D-36 |
| `be/src/main/resources/db/migration/V5__create_reason_tags.sql`, `R__reason_tag_seed.sql` (태그 테이블과 임시 시드) | new | 1차 | D-36 |
| `be/src/main/resources/db/migration/` (운영 테이블, S15P31A302-56) | new | 1차 | D-11 |
| `fe/src/domains/review/ui/review-form.tsx#ReviewForm` (Walking Skeleton의 한 화면 폼 `SimpleReviewForm`을 대신한다) | new | 1차 | D-5, D-41 |
| `fe/src/domains/review/ui/visit-calendar.tsx#VisitDateSheet` | new | 1차 | D-4, D-41 |
| `fe/src/domains/review/model/review-draft.ts#toCreateRequest` | new | 1차 | D-6, D-41 |
| `fe/src/domains/review/model/review-draft.ts#reconcileDraft` (다시 받은 작성 화면 데이터에 입력을 맞춘다) | new | 1차 | D-4, D-41 |
| `fe/src/domains/review/model/review-tags.ts#disabledTagCodes` | new | 1차 | D-5, D-36 |
| `fe/src/domains/review/model/nearby-check.ts#isNearby` | new | 1차 | D-12, D-43 |
| `fe/src/domains/review/ui/review-entry-button.tsx#ReviewEntryButton` (장소 상세 하단 "방문 평가 남기기", 6-E05·7-E01·7-E02) | new | 1차 | D-12, D-43, D-47 |
| `fe/src/domains/review/ui/visit-entry-store.ts#useVisitEntry` (확인 결과를 작성 화면에 메모리로 넘긴다) | new | 1차 | D-43 |
| `be/src/main/java/kr/co/fitdining/api/review/ReviewService.java#ReviewService.update`, `#ReviewService.delete` (본인 리뷰만 행을 잠가 읽는다) | new | 1차 | D-44 |
| `be/src/main/java/kr/co/fitdining/api/review/store/ReviewRepository.java#ReviewRepository.findLockedByReviewIdAndUserIdAndDeletedAtIsNull` | new | 1차 | D-44 |
| `be/src/main/java/kr/co/fitdining/api/review/dto/ReviewDetailResponse.java#ReviewDetailResponse`, `ReviewUpdateRequest.java#ReviewUpdateRequest` | new | 1차 | D-44 |
| `fe/src/domains/review/ui/review-section.tsx#ReviewSection` (내 리뷰 ⋯ 메뉴, 삭제 확인 6-08과 토스트 6-09) | modify | 1차 | D-44 |
| `fe/src/domains/review/ui/review-edit-form.tsx#ReviewEditForm` (수정 화면 6-07, 6-E07) | new | 1차 | D-44 |
| `fe/src/app/place/review/edit/review-edit-screen.tsx#ReviewEditScreen`, `fe/src/app/place/review/review-screen.ts#useSignedIn` (작성·수정 화면의 세션 확인, 돌아올 주소 남기기, 나가기) | new | 1차 | D-44, D-48 |
| `be/src/main/java/kr/co/fitdining/api/review/ReviewService.java#ReviewService.report`, `review/report/ReviewReport.java`, `be/src/main/resources/db/migration/V8__create_review_reports.sql` | new | 1차 | D-11, D-46 |
| `fe/src/domains/review/ui/review-report-sheet.tsx#ReviewReportSheet` (6-11), `review-section.tsx#ReviewSection` (로그인 확인 뒤 로그인 안내 6-E05 또는 시트), `report-failure.ts#reportFailure` (6-E06) | new | 1차 | D-46, D-47 |
| `fe/src/domains/review/ui/review-list-view.tsx#ReviewMenu` (내 리뷰는 수정·삭제, 남의 리뷰와 비로그인은 신고) | modify | 1차 | D-46 |
| `be/src/main/java/kr/co/fitdining/api/review/photo/ReviewPhotos.java#ReviewPhotos` (발급, 확정, 정리, 읽기 주소), `S3PhotoStorage.java#S3PhotoStorage`, `ReviewPhotoConfiguration.java` | new | 1차 | D-9, D-45 |
| `be/src/main/resources/db/migration/V9__create_review_photos.sql`, `store/Review.java#Review.changePhotos` | new | 1차 | D-45 |
| `be/src/main/resources/application.yml#review.photo`, `docs/infra/contracts/env.md` (`S3_PUBLIC_ENDPOINT`), `infra/app/app.env.example`, `be/.env.example` | modify | 1차 | D-45 |
| `fe/src/domains/review/model/photo-compress.ts#compressPhoto`, `ui/use-review-photos.ts#useReviewPhotos`, `ui/review-photo-field.tsx#ReviewPhotoField` (7-04·7-05·6-07, 7-E04) | new | 1차 | D-45 |
| `fe/src/domains/review/ui/review-photo-viewer.tsx#ReviewPhotoStrip` (목록 썸네일과 크게 보기) | new | 1차 | D-45 |
| `fe/next.config.ts#rewrites` (`/fit-dev-photos/*`), `fe/src/app/photos/[env]/confirmed/[name]/route.ts#GET` (로컬 사진 읽기) | new | 1차 | D-45 |

BE는 팀이 정한 루트 패키지 `kr.co.fitdining.api`(검색 D-32) 아래 `review`에 두고, DTO는 `review.dto`에 둔다(D-23). 모듈 경계 규칙이 정해지면 그에 맞춘다. FE는 master의 공통 구조(`app → domains → shared`)를 따라 리뷰 코드를 `src/domains/review`에 둔다. 장소 상세는 검색 담당이 만들고(`src/domains/place`), 리뷰 담당이 상세 화면에 리뷰 자리 세 곳(`slots`)을 렌더 함수 props로 열어 `src/app/place/place-detail-with-reviews.tsx`에서 `ReviewSection`(리뷰 탭, `onShowAll`을 주면 홈 탭 미리보기)과 `ReviewEntryButton`(하단 버튼, 위치 확인 뒤 `reviewWriteHref`로 간다)으로 채운다. 도메인끼리는 import하지 않기 때문이다. 작성 화면(`src/app/place/review`)은 리뷰 담당이 만든다(D-32).

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
| `POST /api/v1/reviews/{reviewId}/reports` | 1차 | 필수 | `ReviewReportRequest` | 201(본문 없음) |
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
  ReviewItem           : + visitedAt(date), nickname?(탈퇴한 회원이면 생략), revisitIntent(bool),
                         tags(TagView[], 좋았어요 먼저), mine(bool) (D-42)
                         + photos(PhotoView[], 없으면 빈 목록) (D-45), hidden(bool)은 S15P31A302-56
  ReviewDetailResponse : reviewId, placeId, description?, photos(PhotoView[]),
                         limits({descriptionMax: 500, photoMax: 5}) (D-44, D-45)
  ReviewCreateRequest  : + visitedAt(date), tagCodes(1..), revisitIntent,
                         spentPerPerson?(0..1,000,000 정수), photos?(업로드 id uuid[], ..5, 화면 순서) (D-45)
  PhotoView            : photoId(사진 id, 확정할 때 매긴다), url, thumbUrl (같은 출처 /photos/<APP_ENV>/confirmed/)
  TagView              : code, label, sentiment(GOOD|BAD)
  ReviewFormResponse   : place({name, categoryGroup, station, thumbnailUrl?, lat?, lng?}), visitDate({min, max, default}),
                         reviewedDates(date[]), tags({good: FormTag[], bad: FormTag[]}),
                         limits({descriptionMax: 500, photoMax: 5, spentPerPersonMax: 1000000}),
                         writable(bool)
  FormTag              : code, label, group, displayGroup(분위기|공간|이용|양|방문 목적)
  ReviewReportRequest  : reason(AD_SPAM|ABUSE|UNRELATED|OTHER), detail?(..100, reason이 OTHER일 때만)
  ReviewPhotoUploadRequest  : count(1..5)
  ReviewPhotoUploadResponse : uploads(PhotoUpload[])
  PhotoUpload          : photoId(업로드 id), uploadUrl, thumbUploadUrl(같은 출처 상대 주소, Content-Type: image/jpeg로
                         PUT), expiresAt (D-45)
  ReviewUpdateRequest  : description?(..500), photos?(uuid[], ..5, 고친 뒤의 사진 전체: 남길 사진은 사진 id, 새 사진은
                         업로드 id). 하나 이상이고 없는 필드는 그대로 둔다 (D-44, D-45)
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
V8__create_review_reports.sql(D-46)
review_reports : review_report_id, review_id(FK), reporter_id(FK auth_users), reason(AD_SPAM|ABUSE|UNRELATED|OTHER),
                 detail(VARCHAR(100), OTHER일 때만), created_at
                 uk_review_reports_review_id_reporter_id UNIQUE (review_id, reporter_id)
V9__create_review_photos.sql(D-45)
review_photos  : (review_id, sort_order)(PK, sort_order 0..4), photo_id(UUID, UNIQUE)
                 객체는 pending/<업로드 id>(.thumb).jpg → 확정할 때 새 사진 id로 confirmed/<photo_id>(.thumb).jpg

S15P31A302-56에서 더하는 것(D-11)
review_moderation_logs : moderation_log_id, target_type, target_id, action, actor_id, created_at
review_write_blocks    : user_id, blocked_by, blocked_at
```

## Seams & test plan

Walking Skeleton

- **도메인 규칙** (example), AC-3: 본문의 빈 값·공백을 본문 없음으로 바꾸는 정규화를 순수 Java 단위 테스트로 확인한다.
- **영속성** (example), AC-25, AC-27: `ReviewPersistenceTest`가 Testcontainers의 PostgreSQL과 V4로 저장, KST 방문일, 정렬, 커서 페이지 경계(같은 `createdAt` 포함), 리뷰 수는 첫 페이지에만, 삭제·숨김 제외, 같은 날 중복 409와 동시 등록, 삭제 후 재작성, 회원 탈퇴 뒤에도 리뷰가 남는지를 확인한다. 순차 스캔을 끈 `EXPLAIN`으로 목록 쿼리가 목록 인덱스를 타고 Sort가 없는지 본다(D-29, D-35, D-38).
- **컨트롤러 경계** (example), AC-1, AC-2, AC-3, AC-5, AC-6: `@WebMvcTest`에 서비스와 인증 모듈을 대신 꽂아 Bean Validation(`placeId`의 문자·0·음수·`long` 범위 밖, 본문 500자·501자), 인증 헤더 유무와 토큰 만료 `type`, 409, ProblemDetail 상태 코드, 알 수 없는 속성 거부, 로그에 본문과 토큰이 없음을 확인한다. 잡는 것: 길이 경계.
- **FE 순수 로직과 정적 렌더** (example), AC-7: `src/domains/review/model`의 KST 날짜 변환(자정 경계)과 등록 요청 만들기(공백뿐이면 본문 없음)를 Vitest로 확인한다. 목록 항목, 홈 미리보기 3건과 머리글 "리뷰 N >", 빈 상태, 불러오기 실패 안내는 데이터 훅과 나눈 그리는 컴포넌트를 `renderToStaticMarkup`으로 확인한다(공통 UI 테스트와 같은 방식, D-31, D-32). 놓치는 것: 누르기·입력·스크롤 같은 상호작용(수동 확인).
- **수동 확인** AC-7: 장소 상세 하단 버튼 → 작성 화면 → 등록 → 토스트와 함께 들어오기 전 탭으로 복귀해 새 리뷰가 리뷰 탭 맨 위와 홈 미리보기 첫 줄에 보이는지, 상세의 "뒤로" 한 번에 검색 결과로 가는지, 홈 미리보기의 머리글 "리뷰 N >"가 리뷰 탭을 여는지, 목록 끝까지 스크롤하면 다음 페이지가 붙는지, 실패 때 입력이 남는지, 버튼을 연달아 눌러도 한 번만 등록되는지, 500자에서 더 입력되지 않는지 확인한다.

1차 후속

- **도메인 규칙** (example), AC-9, AC-12, AC-16: 방문일 정책은 고정 `Clock`으로 경계일과 KST 자정 전후를, 태그 규칙은 그룹(소음 축 4개 포함)·업종·개수 조합을, 금액은 경계값(0, 1,000,000, 1,000,001)을 단위 테스트로 확인한다.
- **컨트롤러 경계** (example), AC-8, AC-10, AC-11, AC-12, AC-16, AC-19: 인증 헤더 유무(본문이 틀려도 401이 먼저), 필수 필드 누락, 금액 경계, 404, 403, 409를 `@WebMvcTest`로 확인한다(D-40).
- **영속성** (example), AC-9, AC-12, AC-13, AC-17: 방문일 경계와 KST 자정 직후의 오늘, 태그 저장과 규칙 위반 때 아무것도 남지 않는지, 409 뒤 태그 행이 남지 않는지, 동시 등록, 삭제 후 재작성을 `ReviewPersistenceTest`에서 확인한다(D-29, D-40).
- **목록 항목과 쿼리 수** (example), AC-10, AC-14: `ReviewPersistenceTest`가 항목의 방문일·닉네임·재방문 의사·태그(업종 문구, 시드 순서를 바꿔도 좋았어요 먼저)·`mine`, 탈퇴한 작성자의 닉네임 생략, 없는 장소 예외를 확인한다. Hibernate 통계로 첫 페이지와 다음 페이지의 쿼리 수(사진 조회를 더해 5번과 4번, D-45)를, 순차 스캔을 끈 `EXPLAIN`으로 태그 조회가 `review_reason_tags` 기본키를 타는지를, HTTP로 토큰 유무에 따른 `mine`과 틀린 토큰의 401을 본다. FE는 항목의 작성자 자리, 배지, 태그 모양과 읽기용 공백, "최신순"을 정적 렌더로, 선택 인증 요청(세션 없음과 그 기억, 3초 제한, 만료 뒤 갱신, 갱신 실패, 거부된 AT와 갱신한 AT의 거부)과 목록 요청에 AT가 실리는지를 Vitest로 확인한다(D-42).
- **FE 순수 로직과 정적 렌더** (example), AC-13, AC-15, AC-22: `src/domains/review/model`의 태그 선택 함수(같은 그룹 비활성화, 소음 축 4개), 입력 상태(첫 방문일, "다음" 조건, 버튼 문구, 금액 입력, 등록 요청, 다시 받은 데이터에 맞추기), 달력 칸 계산, 근처 판정 함수와 `ui`의 등록 실패 분류를 Vitest(`pnpm test`)로 확인한다. 태그 칩 비활성, 달력의 "작성함"과 범위 밖 날, 2/2단계 문구는 정적 렌더로 확인한다. 1/2단계 상단(질문까지) 고정과 태그 목록만의 스크롤, "나가기" 뒤 빈 입력, 다시 받은 데이터로 비워진 방문일과 "X", 등록 404, 쓰는 중의 401, 다시 받은 데이터 반영, 방문일이 빠진 등록, 범위 밖 방문일을 받은 7-03은 jsdom 렌더(Testing Library)로 확인한다(D-31, D-41). 놓치는 것: Next가 숨겨 둔 화면을 다시 여는 동작, 시트·다이얼로그 모양과 닫힘 모션은 수동 확인.
- **수정·삭제** (example), AC-16, AC-17: `ReviewPersistenceTest`가 본문만 바뀌고 다른 필드·태그·목록 순서가 그대로인지, `updated_at`(같은 본문이면 그대로), 공백뿐인 본문, 삭제가 목록·리뷰 수·이미 쓴 날짜에서 빠지고 같은 날 다시 쓸 수 있는지를 확인한다. 조회·수정·삭제마다 남의 리뷰 403과 행이 바뀌지 않는지, 없거나 삭제한 리뷰 404, 탈퇴한 사용자 401을 본다. 삭제가 행을 잠근 동안 온 본인 수정은 잠금 대기를 `pg_locks`로 확인한 뒤 404이고 리뷰가 되살아나지 않는지, 남의 수정·삭제는 기다리지 않고 403인지를 시간 제한을 두어 확인한다. HTTP로 토큰별 204·403·404와 다른 필드 400을 본다. 컨트롤러 경계는 인증이 필드 검증보다 먼저인지, 고칠 필드 없음·다른 필드·501자 400, `reviewId` 형식, 본문이 없으면 `description` 생략, 로그에 본문이 없음을 본다. FE는 ⋯ 메뉴가 내 리뷰에만 방문일 이름으로 있는지(정적 렌더), 수정하기, 삭제 중 상태(버튼 막힘·포커스·알림·Esc), 작성 화면 데이터 무효화, 삭제 뒤 리뷰 섹션 포커스, 취소, 404·시간 초과의 목록 다시 받기, 403·401·서버 오류·오프라인 토스트, 수정 화면의 비활성 조건·PATCH·빈 본문·토스트·상세 캐시 갱신과 목록 무효화·나가기 확인·보내는 중 "<" 막기·6-E07과 다시 수정·403/404·401·오프라인 안내·불러오기 중 알림·불러오기 404/403/401/오프라인·다시 열면 지금 본문으로 시작을 jsdom으로 확인한다(D-44). 놓치는 것: 메뉴·다이얼로그 모양과 모션, Next가 숨겨 둔 화면을 다시 여는 동작은 수동 확인.
- **방문 위치 확인** (example), AC-22, AC-23: 근처 판정(거리와 정확도의 합 100m 경계, 장소 좌표 없음)과 진입 판단(오늘 쓴 날이 위치보다 먼저)을 Vitest로 확인한다. `ReviewEntryButton`의 근처·7-E01(위치를 묻지 않음)·7-E02·"다시 확인"·로그인 전 로그인 안내와 그 "로그인"·"취소"·데이터 실패(다시 시도하지 않고 위치를 묻지 않음)·확인 중 떠나기·권한 창 마감은 앱과 같은 재시도 설정의 jsdom 렌더로 확인한다. 작성 화면의 "방문 확인 완료"(오늘일 때만)·방문일 시트 열기·결과를 옮긴 뒤 지우기·"X" 뒤 지우기도 jsdom으로 본다(D-43). 놓치는 것: 실제 기기의 위치 권한 창과 정확도(브라우저에서 위치를 바꿔 넣어 수동 확인).
- **사진** (example), AC-18: `ReviewPhotosTest`가 가짜 저장소로 업로드 주소 발급, 확정(새 사진 id와 순서, 같은 업로드를 두 번 확정해도 따로인 복사본, 상한 경계, 빈 파일, JPEG 아님, 올리지 않은 사진, 복사 실패 때 이번 복사본 정리), 트랜잭션 뒤 정리(커밋·롤백·결과 불명)를, `S3PhotoStorageTest`가 운영과 같은 Garage v2.4.1 컨테이너로 presigned PUT(서명 헤더는 Host와 Content-Type뿐, 다른 Content-Type은 403), 크기, 앞부분 읽기, 복사(원본이 없으면 false), 여러 키 한 번에 지우기, 접속 실패를 확인한다. `ReviewPersistenceTest`는 등록·목록·수정 화면의 순서, 업로드 원본과 확정본 정리, 409 뒤 다시 보내기, 저장된 리뷰의 업로드로 다시 등록해도 먼저 저장된 사진이 남는지, 남은 남의 업로드를 따로 복사하는지, 같은 사진 두 번, 남의 사진 id, 순서 바꾸기, 같은 목록의 `updated_at`, 삭제 뒤 정리, 저장소 장애 503과 HTTP로 발급부터 목록까지(목록의 사진 id는 업로드 id와 다르다)와 400 `type`을 본다. 첫 페이지 쿼리는 5번, 다음 페이지는 4번이다. FE는 품질·크기 낮추기 순서, 방향 옵션을 모르는 브라우저의 다시 읽기, 그리기 실패, canvas 비우기(Vitest), 칸 상태·data URL 미리보기·차례로 줄이기·모든 압축 실패의 7-E04·다시 올리기·줄이는 중과 올리는 중 빼기·화면을 떠날 때 멈추기(`renderHook`), 칸을 뺀 뒤 포커스와 실패 알림, 작성·수정 화면의 사진 요청과 사진 400 안내, 목록 썸네일 줄, 로컬 사진 읽기 경로(업스트림 404 포함)를 확인한다(D-45).
- **신고** (example), AC-19, AC-28: 컨트롤러 경계(사유·설명 형식, 인증 먼저, 404·400·409, 로그), `ReviewPersistenceTest`(저장 값, 공백 설명, 중복 409, 다른 신고자, 내 리뷰, 지운·없는 리뷰, 탈퇴한 사용자, 숨기지 않음, 설명 CHECK, HTTP 201·409·400), FE(⋯ 메뉴 이름과 항목, 비로그인 로그인 안내와 그 "로그인"·"취소", 시트 비활성·기타 설명·보낸 요청, 409·404·연결 끊김 처리, 404로 닫힐 때 리뷰 섹션 포커스)를 확인한다(D-46, D-47).
- **로그인 뒤 돌아오기** (example), AC-22, AC-26, AC-28: 장소 상세의 신고·방문 평가 안내 "로그인"과 작성·수정 화면의 로그인 이동이 지금 주소를 남기는지 jsdom으로 본다(`place-detail-with-reviews.test.tsx`, `review-screen.test.tsx`). 남은 주소로 보내는 것은 북마크의 `HomeEntry` 테스트가 맡는다(D-48). 놓치는 것: 소셜 로그인 복귀(local에 소셜 로그인 환경변수가 없다).
- **수동 확인** AC-18, AC-19, AC-22, AC-26, AC-28: 로컬 Garage와 `next dev`로 비로그인 ⋯에서 로그인 화면, 신고 201과 409 토스트, 4000×3000 사진을 1,600px로 줄여 올리기, 깨진 파일의 7-E04, 등록 뒤 확정본만 남기, 목록 썸네일과 크게 보기, 수정에서 빼고 더하기, 삭제 뒤 객체 삭제를 확인했다(2026-10-29). 비로그인 신고와 "방문 평가 남기기"의 로그인 안내(6-E05)와 그 "취소"·"로그인"은 2026-10-30에 확인했다(D-47). 신고 안내와 작성 화면 직접 열기에서 이메일로 로그인하면 그 장소 상세와 그 작성 화면으로 돌아오는 것도 같은 날 확인했다(D-48). 서버의 Caddy 경유 업로드와 공개 읽기는 `infra/edge/test`나 dev 서버에서 확인한다.
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

로그인과 회원 테이블(`auth_users`, `V1__auth`)은 develop에 들어왔다(S15P31A302-38). `places` 테이블도 V6으로 들어왔다(S15P31A302-103). 남은 선행 조건 중 가장 큰 것은 AI가 리뷰를 읽는 경로다.

회원 담당
- 공통 인증 인터셉터를 `/api/v1/**`에도 걸 계획인가요? 지금 인터셉터는 `/api/auth/**`에만 걸려 있고, 사용자 ID는 `AuthUseCases.authenticate`가 AT(`Authorization: Bearer`)에서 꺼낸다(D-15). 리뷰 목록처럼 헤더 없이도 되는 선택 인증이 필요해 지금은 리뷰 컨트롤러가 직접 처리한다(D-42).
- 관리자 권한은 어떻게 구분하나요? `auth_users`에는 역할이 없다. 관리자 API(D-11)가 여기에 달려 있다.

취향·AI·검색 담당
- 코드표(`ai/src/fit_ai/features.py`)는 S15P31A302-39로 develop에 들어왔고 리뷰 태그도 이 코드를 쓴다(D-16, D-36). V6(S15P31A302-103)이 같은 코드를 `feature_codes` 테이블로 만들었고 `reason_tags.feature_code`가 이 테이블을 참조한다(FK). develop의 온보딩 코드(`SPACIOUS`, `VALUE`, `CONVERSATION` 등)는 아직 코드표와 다른데 어느 쪽에 맞추나요?
- AI는 리뷰를 어디서 읽나요? AI는 Modal에서 돌아 서버 내부망의 Postgres를 직접 읽지 못한다(비교 spec 6절). 리뷰는 삭제·숨김·분석 제외 시각과 `updated_at`을 남긴다(D-34). BE 조회 API나 정기 내보내기 같은 받는 방법, 필요한 필드와 주기를 인프라 담당과 함께 정해야 한다.
- 삭제·숨김·분석 제외된 리뷰가 카드의 인용(`reasons[].quote`, `quoteSource` "앱 리뷰")과 근거 수(`evidenceCount`)에서 빠지게 하는 쪽은 비교 쪽인가요? 지금 베이스라인은 인용을 넣지 않지만 다음 단계에서 앱 리뷰 인용을 붙인다.

BE 팀 공통
- DB 공통 규칙 초안의 이름 규칙, 삭제 행 제외 방식, 마이그레이션 버전 형식을 언제 합의하나요? 1차 후속의 `reviews` 마이그레이션이 이를 따른다(D-28).
- `places` 테이블은 V6(S15P31A302-103)으로 들어왔다(`place_id`는 서비스 자체 장소 ID). 리뷰의 `place_id`를 이 테이블로 FK를 거나요? FK를 걸면 Mock 장소(D-22)도 `places`에 있어야 한다. 회원은 `auth_users`(`V1__auth`, `id`는 text)가 있다.
- 같은 상태 코드 안의 오류 구분은 컨벤션 3절대로 ProblemDetail의 `type`이나 확장 필드로 하면 되나요? 리뷰는 400 안에서 방문일 범위와 태그 위반을 FE가 구분해야 한다(409 중복은 상태 코드로 구분된다). 인증 오류는 ProblemDetail의 `type`(`urn:fitdining:auth:access-token-expired`)으로 토큰 만료를 구분한다.
- 모듈 경계 규칙은 무엇인가요? 장소와 리뷰는 기능 패키지(`place`, `review`) 아래에 평평하게 두는데(D-23), `auth`는 `domain`·`ports`·`application`·`infrastructure`·`presentation`으로 나눈다.

인프라 담당
- presigned URL 서명 호스트는 env 계약에 선택 키 `S3_PUBLIC_ENDPOINT`로 더했다(D-45). 값은 서버마다 `AUTH_FRONTEND_ORIGIN`과 같은 출처(`https://<DEV_HOST>`, `https://<PROD_HOST>`)다. dev·prod 서버 env에 언제 넣나요? 넣기 전까지 서버에서는 사진 업로드가 503이고 사진 없는 리뷰는 그대로 된다.
- Garage 스파이크(인프라 7.4절) 중 서버에서 남은 확인은 언제 끝나나요? presigned PUT이 Caddy를 거쳐 서명이 통과하는지와 수명주기(남은 업로드 원본을 하루 뒤 지운다)가 남았다. 리뷰는 PUT으로 올리고 확정할 때 크기를 검사해 PostObject의 `content-length-range`는 쓰지 않는다(D-45). 웹 엔드포인트 공개 읽기와 익명 S3 GET 거부는 로컬에서 확인됐다. 실패하면 저장소가 바뀐다(D-9).
- AI가 리뷰를 읽는 경로(취향·AI·검색 담당 질문, D-34)를 함께 정해야 한다.

기획·디자인
- 이유 태그 목록, 문구, 업종별 노출은 언제 확정되나요? 그 전까지는 PRD FR-10 초안을 임시 시드로 쓰고, 확정되면 `R__reason_tag_seed.sql`만 고친다(D-36).
- 7-01에서 좋았던 점을 고르지 않았을 때 "다음" 비활성 상태와 "하나 이상 필수" 안내를 그려야 한다. 7-01, 7-01b와 예외 상태(7-E01~7-E06) 어디에도 아직 없다(D-5).
- 409(같은 날 두 번째 등록)와 401(로그인 만료) 안내 화면이 예외 상태에 없다. 지금은 7-E05와 같은 다이얼로그 꼴로 그린다(D-41).
- PRD OQ-07(사진 용량 상한, 압축 품질)을 제안값(1,600px 1MB, 썸네일 100KB, 품질 0.85에서 0.65까지)으로 정해도 되나요? 값은 BE 설정과 앱 상수에 있다(D-45).
- 쓸 수 없는 사진(400)과 업로드 실패, 이미 신고한 리뷰(409) 안내가 예외 상태에 없다. 지금은 사진 안내 다이얼로그, 칸의 "다시 시도", 토스트로 그린다(D-45, D-46).

팀장
- 관리자 도구(Appsmith)는 관리자 API를 부르나요, DB에 직접 붙나요?

### 리뷰 담당이 준비할 것

- 작성 중 등록이 401로 끝나면 입력을 지키려고 로그인 화면으로 보내지 않아, 로그인 뒤 돌아오기가 없다(D-41, D-48).
- 6-10, 6-11, 6-12, 6-E06, 7-E04의 문구와 배치를 Figma와 대조한다. 구현 때 Figma MCP 호출 한도로 보지 못해 spec·결정의 문구(D-11)로 그렸다(D-45, D-46).
- 1차 후속 전: Figma에 없는 화면(숨김 처리된 내 리뷰 표시, 작성 차단 안내)을 추가한다.
