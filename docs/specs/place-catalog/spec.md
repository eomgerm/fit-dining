# 장소 카탈로그 저장소와 실데이터 상세 (place-catalog)

Status: approved
Decisions: [decisions.md](decisions.md) · Glossary and ADRs: none

## Problem

장소 검색(place-search)은 지금 손으로 지어낸 Mock 장소로만 동작하고, 그 데이터는 "영업시간은 자정을 넘지 않는다", "메뉴에는 항상 카테고리가 있다", "사진이 없다"는 가정 위에 서 있다. 네이버에서 수집해 정제한 강남·역삼·선릉 주변 300곳(`data/naver-places/clean/`)은 이 가정을 모두 깬다. 자정을 넘는 영업, 24시간 영업, 하루 여러 번의 브레이크, 카테고리 없는 메뉴, "가격 변동" 같은 숫자 없는 가격, 사진, 주차·반려동물·콜키지 같은 안내가 있다.

이번 반복은 세 가지를 한다(D-1). 첫째, 이 데이터를 담을 장소 테이블 8개를 PostgreSQL에 Flyway로 만든다. 둘째, CSV를 우리 스키마에 맞게 변형해 로컬 DB에만 넣는 적재 스크립트를 만든다. 셋째, 상세 응답 계약을 실데이터에 맞게 바꾸고 BE DTO, mock, FE를 고친다. API는 이번에도 mock만 읽는다. DB 조회는 다음 작업이다.

## Assumptions

1. DB는 PostgreSQL 16이다(`pgvector/pgvector:0.8.7-pg16`, 테스트도 같은 이미지).
2. 마이그레이션은 migrate 프로필에서 마이그레이션 계정(`fit_migrator`)이 실행하고, 웹 앱은 DML만 하는 계정(`fit_dev_app`)으로 접속한다. 새 테이블과 identity 시퀀스에 대한 앱 계정 권한은 인프라(`infra/data/ensure-databases.sh`)와 테스트 지원이 설정한 기본 권한(`ALTER DEFAULT PRIVILEGES FOR ROLE fit_migrator`)으로 생긴다(D-1).
3. 웹 앱은 `spring.jpa.hibernate.ddl-auto=validate`다. 이번에는 새 테이블의 JPA 엔티티를 만들지 않으므로 기동 검증에 영향이 없다(D-1).
4. develop의 마지막 마이그레이션은 `V5__create_reason_tags.sql`이다. CI의 `lint:migrations`가 기존 마이그레이션의 수정과 버전 중복·역순을 막는다(D-1).
5. develop의 `reviews`(V4)는 `reviews.place_id bigint`로 장소 번호를 FK 없이 받는다(D-21).
6. 입력 데이터는 `data/naver-places/clean/`의 정제 CSV 30개와 `DATA_DICTIONARY.md`(2026-10-23 수집, 300곳, 강남·역삼·선릉 각 100곳)이고 git이 추적하지 않는다. 데이터 사전의 뜻을 따른다. 예를 들어 CSV `phone`은 일반 번호뿐이고 대표 번호는 `primary_phone`이며, CSV `booking_url`은 예약 검색 화면이고 가게 예약 페이지는 `naver_booking_url`이다(D-12, D-14).
7. 실데이터의 모양(매장 시간표 기준): 300곳 모두 7일치 시간표 행이 있다. 자정을 넘는 요일 525개, 24시간 영업 요일 67개(7일 내내 24시간인 곳 8곳 이상), 하루 브레이크 최대 4개가 있다. 날짜가 붙은 휴무 요일은 10개(4곳, 그중 폴 바셋 강남삼성타운점은 7일 전부)이고, 날짜가 붙은 영업 줄도 있다(스타벅스 12곳의 매장 시간표 전부, 농민백암순대 본점 수요일). 기본 시간표가 없는 12곳(스타벅스)은 "매장", "딜리버스", "드라이브스루", "워크스루" 시간표가 있다. 메뉴가 있는 287곳 중 255곳은 카테고리가 없고, 메뉴가 없는 곳이 13곳이다. 업체 사진이 없는 곳은 카페드아마폴라 강남점 1곳이고, 이곳은 메뉴판 사진은 있고 메뉴는 없다. 업체·메뉴판 사진의 원본 순번은 중간이 빠져 있다(1, 3, …)(D-9, D-10, D-16, D-23, D-24).
8. 네이버는 임시 휴무가 있는 요일의 정규 시간 줄을 날짜 휴무 줄로 바꿔서 주고, 수집 원본에도 그 요일의 정규 시간이 없다(D-24).
9. `MockPlaceSearchEngine`은 `place.mock.enabled`가 켜졌을 때만 등록되고, `places.json`을 애플리케이션의 JSON 설정(알 수 없는 속성 거부)으로 읽는다(D-1, D-19).
10. 앱의 기본 로컬 DB 접속은 `127.0.0.1:15432/fit_dev`, 계정 `fit_dev_app`이다(`be/src/main/resources/application.yml`)(D-15).

## Usage

로컬에서 실데이터를 넣고 화면을 확인하는 흐름이다.

```text
# 1) 로컬 DB(infra/data 컴포즈)에 마이그레이션 적용 (migrate 프로필, 팀의 실행 방식대로)

# 2) 로컬 DB에 300곳 적재 (스크립트는 data/naver-places/ 안, git 미추적)
data/naver-places/.venv/Scripts/python data/naver-places/<적재 스크립트> --host 127.0.0.1 --port 15432 --dbname fit_dev --user fit_dev_app
  → 버린 이유별 행 수와 테이블별 행 수 출력. 호스트가 로컬이 아니면 아무것도 쓰지 않고 종료

# 3) mock 생성 (같은 폴더의 생성 스크립트) → be/src/main/resources/mock/places.json
#    + data/naver-places/ 안에 대응표 .md (naver_place_id ↔ mock id ↔ 이름 ↔ 넣은 이유)
data/naver-places/.venv/Scripts/python data/naver-places/<mock 생성 스크립트>              # 확인용 장소는 스크립트에 들어 있다
data/naver-places/.venv/Scripts/python data/naver-places/<mock 생성 스크립트> --include 1689752307   # 더 넣고 싶은 장소

# 4) PLACE_MOCK_ENABLED=true 로 앱을 띄우고 대응표의 id로 /place?id=<id> 를 연다
```

적재가 장소 하나를 넣는 모습(장소 단위 한 트랜잭션, D-15):

```sql
INSERT INTO places (naver_place_id, name, category_group, lat, lng, address, district, dong, facilities)
VALUES ('1689752307', '슬로우커피', 'CAFE', 37.50, 127.03, '서울 강남구 …', '강남구', '역삼동', '{포장,무선 인터넷}')
ON CONFLICT (naver_place_id) DO UPDATE SET name = EXCLUDED.name, /* … */ updated_at = now()
RETURNING place_id;

DELETE FROM place_hours WHERE place_id = :place_id;
INSERT INTO place_hours (place_id, day_of_week, open_time, close_time, closed, breaks, last_orders)
VALUES (:place_id, 'MON', '10:00', '22:00', false, '[]', '{}'),
       (:place_id, 'FRI', NULL, NULL, false, '[]', '{}');   -- "금(10/23) 휴무" → 정보 없음 (D-24)
```

상세 응답 일부(mock이 돌려주는 모양, D-17):

```json
{
  "hours": [
    {"dayOfWeek": "MON", "open": "17:00", "close": "02:00", "breaks": [], "lastOrders": ["01:00"], "closed": false},
    {"dayOfWeek": "TUE", "open": "00:00", "close": "00:00", "breaks": [], "lastOrders": [], "closed": false},
    {"dayOfWeek": "FRI", "breaks": [], "lastOrders": [], "closed": false}
  ],
  "menus": [
    {"name": "[주문제작] 생화 케이크", "description": "최소 4주 전 문의 부탁드립니다. …",
     "priceText": "가격 변동", "labels": ["사전예약"], "representative": false}
  ],
  "facilities": ["단체 이용 가능", "무선 인터넷", "노키즈존"],
  "noKidsZone": true,
  "corkage": {"allowed": true, "note": "콜키지 유료"}
}
```

## Acceptance criteria

스키마(마이그레이션)

- [x] AC-1: 마이그레이션 계정으로 Flyway를 실행하면 새 마이그레이션이 `flyway_schema_history`에 성공으로 기록되고, 아래 Interfaces의 8개 테이블이 각각 정확히 그 열만 가진다. 각 열의 타입(배열의 원소 타입 포함), NULL 허용 여부, 기본값이 Interfaces와 같고, 8개 테이블의 PK 열은 `GENERATED ALWAYS` identity다. 이름을 붙인 제약과 인덱스는 Interfaces에 적힌 이름 그대로 있다. 8개 테이블의 제약은 PK와 Interfaces에 적힌 것뿐이고(좌표 UNIQUE 같은 것은 없다), 인덱스는 PK와 UNIQUE 제약이 만든 인덱스와 Interfaces의 `CREATE INDEX`뿐이다. `place_naver_snapshots`와 `place_review_photos` 테이블은 없다. (D-1, D-2, D-3, D-4, D-6, D-7, D-8, D-9, D-11, D-12, D-13, D-16)
- [x] AC-2: 앱 계정으로 `places`에 `place_id` 없이 넣으면 `place_id`가 발급되고, 일반 INSERT로 `place_id`를 직접 넣으면 거부된다. 같은 `naver_place_id`를 두 번 넣거나 빈 문자열 `naver_place_id`를 넣으면 거부된다. 필수 열(`naver_place_id`, `name`, `category_group`, `lat`, `lng`)만 넣으면 배열 열은 빈 배열이고, `created_at`과 `updated_at`은 그 INSERT 트랜잭션의 `now()`다. (D-2, D-13, D-22)
- [x] AC-3: `category_group`이 `RESTAURANT`, `CAFE`, `BAR` 밖이거나, `lat`이 -90~90 밖이거나, `lng`이 -180~180 밖이면 거부된다. 좌표가 같은 서로 다른 `naver_place_id`의 두 장소는 모두 받아들인다. (D-13, D-22)
- [x] AC-4: `place_hours`에서 같은 장소, 같은 요일 줄을 두 번 넣으면 거부된다. 요일이 `MON`~`SUN` 밖이거나, 개점과 마감 중 하나만 있거나, `closed = true`인데 개점이 있거나, 개점이나 마감이 `24:00`이거나, `breaks`가 JSON 배열이 아니면 거부된다. 마감이 개점보다 이른 줄(`17:00`–`02:00`)과 개점과 마감이 같은 줄(`00:00`–`00:00`)은 받아들인다. 필수 열만 넣으면 `closed`는 false, `breaks`는 빈 JSON 배열, `last_orders`는 빈 배열이다. (D-10, D-13)
- [x] AC-5: `place_photos.source`가 `business`, `menuBoard` 밖이면 거부된다. `place_photos`에서 같은 장소, 같은 출처, 같은 `sort_order` 사진과, `place_menus`에서 같은 장소, 같은 `sort_order` 메뉴는 두 번째가 거부된다. 출처가 다르면 같은 `sort_order`를 받아들인다. 두 테이블 모두 음수 `sort_order`는 거부된다. 메뉴의 필수 열만 넣으면 `representative`는 false, `labels`와 `photo_urls`는 빈 배열이다. (D-7, D-8, D-9, D-13, D-16)
- [x] AC-6: 앱 계정으로 `places` 행을 지우면 그 장소의 7개 자식 테이블 행이 모두 지워지고 다른 장소의 행은 남는다. 존재하지 않는 `place_id`를 가리키는 자식 행은 거부된다. (D-13, D-22)
- [x] AC-7: 7개 자식 테이블은 모두 첫 열이 `place_id`인 인덱스를 가진다. UNIQUE 제약이 만든 인덱스도 인정한다. (D-13)
- [x] AC-8: 앱 계정으로 8개 테이블 각각에 SELECT, INSERT, UPDATE, DELETE를 실제로 실행하면 모두 성공한다. (D-1)
- [x] AC-9: 기존 BE 테스트 전체(`ddl-auto=validate` 기동을 확인하는 `ApiApplicationTests` 포함)와 기존 FE 테스트 전체가 통과한다. 이번 변경으로 고친 기존 테스트는 Existing code에 적힌 범위 안에서만 고쳤다. (D-1, D-19)

상세 응답과 영업 상태(mock)

- [x] AC-10: 모든 mock 장소에 대해 `GET /api/v1/places/{id}`의 응답 키는 Interfaces의 `PlaceDetailResponse`와 그 중첩 타입(`Hours`, `Break`, `Menu`, `Subway`, `Parking`, `Pet`, `Corkage`, `Seat`, `Broadcast`)에 문서화된 필드를 벗어나지 않는다. `hours`는 7개(월~일)이고 각 요일에 `breaks`(목록)와 `lastOrders`(목록)가 있으며 `breakStart`/`breakEnd`는 없다. 메뉴에는 `labels`와 `representative`가 있고 `category`, `priceText`는 없을 수 있다. `facilities`는 문자열 목록이다. 버스 정류장 필드는 없다. Interfaces에서 `?`가 없는 필드는 모든 장소의 응답에 있다. 검색 카드(`PlaceCard`), `PlaceSummary`, 자동완성 응답의 키는 바뀌지 않는다. (D-17)
- [x] AC-11: 시계를 고정하고 테스트 안에서 만든 영업시간으로 mock 엔진의 영업 상태 판정을 확인하면 Interfaces의 "영업 상태 규칙"을 따른다. 적어도 다음이 확인된다. 기존 경우: 영업 중 `OPEN`, 브레이크 안 `BREAK`, 마감 60분 이내 `CLOSING_SOON`, 휴무일 `CLOSED`, 개점 전과 마감 뒤 `CLOSED`. 새 경우: 월요일 `17:00`–`02:00`이고 화요일이 휴무인 장소는 화요일 `00:59`에 `OPEN`, `01:00`과 `01:30`에 `CLOSING_SOON`, `02:00`에 `CLOSED`다. 화요일이 정보 없음이어도 화요일 `00:59`는 `OPEN`이고 `03:00`은 `UNKNOWN`이다. 7일 내내 `00:00`–`00:00`인 장소는 어느 요일 `23:30`에도 `OPEN`이다. 월요일만 `00:00`–`00:00`이고 화요일이 휴무면 월요일 `23:30`은 `CLOSING_SOON`이다. 브레이크가 두 개인 날 두 번째 브레이크 안이면 `BREAK`다. 월요일이 정보 없음이고 화요일이 `09:00` 개점이면 화요일 `03:00`은 `UNKNOWN`, `08:00`도 `UNKNOWN`이고, 화요일 `09:00` 이후는 화요일 시간표대로다. 월요일이 정보 없음이고 화요일이 휴무면 화요일 `03:00`은 `CLOSED`다. 정보 없는 요일이 있어도 카드와 상세가 오류 없이 응답한다. 기존 테스트가 확인하던 성질(같은 시각의 카드와 상세가 같은 상태, 주입한 시계가 UTC여도 서울 시각으로 판정)도 유지된다. (D-23)
- [x] AC-12: `places.json`은 다음 데이터 규칙을 지킨다. 장소는 30~40곳이고 카드 `id`는 1부터 차례다. 카드와 상세의 `place`는 같고 `openStatus`는 파일에서 `UNKNOWN`이다. 카드 `thumbnailUrl`이 있으면 상세 `photos`의 첫 장과 같다. 점수는 0~100 정수, 카드 `labels`는 2개, `reasons`는 1개 이상, 상세 `tags`는 2~4개, `scoreItems`는 2~4개이고 그중 하나 이상은 `matched: false`, `evidenceCount`는 0 이상 정수다. `hours`는 7일이고 시각은 모두 `HH:mm`이다. 휴무일에는 `open`과 `close`가 없고, `open`과 `close`는 둘 다 있거나 둘 다 없다. 각 브레이크는 `start`와 `end`가 있다. 메뉴 이름은 비어 있지 않다. (D-19, D-23)
- [x] AC-13: `places.json`에는 대응표 기준으로 다음 장소가 있다: 모너트(`1235764696`), 플랫나인(`1793702349`), 신라스테이 역삼 카페(`37402198`), 야마야 강남점(`1737968708`), 스타벅스 강남서초초교점(`11555415`), 폴 바셋 강남삼성타운점(`37804253`, 7일 모두 정보 없음), 카페드아마폴라 강남점(업체 사진 없음, 메뉴 없음), 슬로우커피(`1689752307`, 금요일 정보 없음). 또 하루 브레이크가 둘 이상인 날, 자정을 넘는 날, 24시간 영업인 날, 노키즈존, 콜키지 정보가 있는 장소가 각각 하나 이상 있다. 기존 테스트가 확인하는 성질을 보일 수 있도록 업종마다 6곳 이상, 이름에는 없고 메뉴에만 있는 낱말로 찾을 수 있는 장소, 영문 대소문자가 섞인 메뉴 이름이 있는 장소가 있고, id 3은 카페다. 이 장소들은 인자 없이 실행해도 들어간다. 대응표에서 확인용으로 넣었다고 적힌 장소와 `--include`로 넣은 장소를 뺀 나머지는 강남·역삼·선릉 역이 고르게(가장 많은 역과 적은 역의 차이가 1곳 이하) 섞여 있다. 스타벅스 강남서초초교점의 금요일은 "매장" 시간표 `07:00`–`22:00`이다. (D-10, D-19, D-24)
- [x] AC-14: `places.json`과 DB(적재 결과)는 Interfaces의 "적재·mock 변형 규칙"을 따른다. 적어도 다음이 성립한다: `phone`은 CSV `primary_phone`, 예약 링크는 CSV `naver_booking_url`이다. 날짜가 붙은 휴무 요일은 정보 없음이고(슬로우커피 금요일, 폴 바셋 강남삼성타운점 7일), 날짜가 붙은 영업 줄은 그 시간 그대로다(농민백암순대 본점 수요일 `11:10`–`15:30`). `places.json`의 `closedDayNote`는 정기휴무 요일로만 만들고 정기휴무가 없으면 생략한다(DB에는 이 열이 없다). 죽은 링크는 없다. 메뉴는 원본 순서대로 빠짐없이 들어 있다. (D-6, D-12, D-16, D-23, D-24)
- [x] AC-15: 적재 스크립트와 mock 생성 스크립트는 정제 CSV의 `external_reviews.csv`, `external_review_keywords.csv`, `external_review_replies.csv`, `external_blog_posts.csv`, `place_micro_reviews.csv`, `place_review_themes.csv`, `place_review_menus.csv`, `place_voted_keywords.csv`를 열지 않는다. 그 결과로 리뷰 본문, 답글 본문, 블로그 요약, AI 요약 문구 중 20자 이상인 것 전부와 작성자 해시 전부는 `places.json`과 DB 8개 테이블의 어떤 문자열에도 들어 있지 않다. (D-4, D-5, D-22)

FE 화면

- [x] AC-16: 정보 탭은 기존 항목 아래, "정보가 실제와 다를 수 있어요" 안내 위에 Interfaces의 "정보 탭 줄" 순서대로 값이 있는 항목만 "제목 · 내용" 줄로 보이고, 값이 없는 항목의 줄은 없다(노키즈존은 `noKidsZone`이 true일 때만 보인다). 버스 정류장은 보이지 않는다. 시설 칩은 각 시설 이름을 글자 그대로 보이고, "아이콘 묶음"에 든 이름은 그 묶음의 아이콘을, 그 밖의 이름은 기본 아이콘을 붙인다. 묶음마다 아이콘이 다르고 기본 아이콘과도 다르다. (D-17, D-18)
- [x] AC-17: 영업시간 표와 안내는 다음과 같이 보인다. 정보 없는 요일은 "정보 없음"이고 "휴무"가 아니다. `00:00`–`00:00`은 "24시간 영업", 마감이 `00:00`인 요일은 "11:00 – 24:00", 자정을 넘는 요일은 "17:00 – 02:00"이다(마감 `00:00`은 화면에서 "24:00"이고 자정을 넘는 영업으로 치지 않는다). 브레이크는 하나마다 "15:00 – 16:00 브레이크타임" 줄이다. 오늘 안내(`OPEN`, `CLOSING_SOON`): 오늘 구간이 자정을 넘지 않으면 "오늘 22:00까지"(마감 `00:00`이면 "오늘 24:00까지"), 자정을 넘으면 "내일 02:00까지", 지금이 어제 구간의 새벽 부분이면 "02:00까지"다. 오늘이 `00:00`–`00:00`이면 다음 날도 `00:00`에 열 때 "24시간 영업", 아니면 "오늘 24:00까지"다. `BREAK`이면 지금 들어가 있는 브레이크의 끝 시각으로 "<끝>에 다시 열어요"다. 어제 구간의 새벽 부분에서는 오늘 줄이 휴무여도 "오늘 휴무"를 보이지 않는다. `openStatus`가 `UNKNOWN`이면 오늘 안내는 생략된다. 문구는 영업시간과 BE의 `openStatus`로 고르는 표시 서식이다(D-6). (D-23)
- [x] AC-18: 메뉴 탭은 메뉴를 원래 순서대로 보이며, 카테고리가 같은 메뉴가 이어지는 묶음마다 카테고리 이름을 머리글로 보이고, 카테고리 없는 메뉴는 머리글 없이 그 자리에 보인다. 각 줄에 64px 사진(없으면 자리표시), 이름, 이름 옆 라벨 칩과 대표 메뉴의 "대표" 칩, 이름 아래 설명(최대 두 줄, 넘치면 말줄임), 오른쪽 가격 원문(`priceText`, 없으면 생략)이 보인다. 메뉴가 없으면 지금처럼 메뉴 줄 없이 안내 문구("정보가 실제와 다를 수 있어요")만 보인다. "메뉴 정보 기준일"은 보이지 않는다. 홈 탭의 구조와 메뉴 미리보기는 바뀌지 않는다(홈 탭의 영업시간 문구는 AC-17을 따른다). (D-16, D-18)

로컬 적재와 대응표

- [x] AC-19: 적재 스크립트는 접속 대상을 `--host`, `--port`, `--dbname`, `--user` 인자로만 받는다(기본값 `127.0.0.1`, `15432`, `fit_dev`, `fit_dev_app`). 접속 URI나 접속 문자열을 받지 않는다(`--dbname`에 `=`나 `://`가 있으면 거부). 접속 전에 `PGHOST`, `PGHOSTADDR`, `PGSERVICE`, `PGSERVICEFILE` 환경 변수를 지워 호스트가 인자 말고 다른 곳에서 정해지지 않게 한다. 비밀번호는 `PGPASSWORD`, `~/.pgpass`, 입력 프롬프트 중 하나로 받는다. `--host`가 `localhost`, `127.0.0.1`, `::1`이 아니면 DB에 접속하기 전에 0이 아닌 코드로 끝난다. (D-15, D-22)
- [x] AC-20: 빈 로컬 DB에 마이그레이션 후 적재하면 300곳이 모두 들어가고(24:00 마감, 자정 넘김 장소 포함), 버린 이유별(예: 매장 외 시간표, 방문자·클립·영상 사진, 죽은 링크, 필수 값 없는 행) 행 수와 테이블별 행 수가 출력된다. 같은 입력으로 한 번 더 적재하면 모든 장소의 `place_id`가 처음과 같고, 장소 수와 테이블별 행 수가 같다. 각 장소의 메뉴 수, 사진 수, 지하철 수는 그 장소의 CSV 원본에서 규칙대로 센 수와 같다. (D-15, D-22)
- [x] AC-21: mock 생성 스크립트는 `places.json`과 함께 `data/naver-places/` 안에 대응표 마크다운(`naver_place_id`, mock `id`, 이름, 넣은 이유)을 쓰고, 표의 모든 mock `id`는 `places.json`의 카드 `id`와 같은 장소다. 인자로 받은 `naver_place_id`는 `places.json`에 들어간다. 인자의 `naver_place_id`가 CSV에 없거나 최종 장소 수가 40곳을 넘으면 아무 파일도 쓰지 않고 0이 아닌 코드로 끝난다. (D-19, D-20)

문서

- [x] AC-22: place-search spec의 Interfaces(`PlaceDetailResponse`, `Hours`, `Menu`, `Facility`), Mock 데이터(14번)·영업 상태(21번)·상세 화면(45번)·상세 탭(47번)·상세 모양(58번) 문단, AC-10, AC-25, AC-40, FE 파일 설명의 `place-labels.ts` 줄, Seams의 Mock 데이터 줄이 이 spec과 어긋나지 않는다. (D-1)

## Interfaces

### 스키마 (새 마이그레이션 하나)

새 마이그레이션이 만드는 스키마 전부다. 여기에 없는 열, 인덱스, 제약은 더하지 않는다. 테이블 안 열의 순서만 구현 재량이고, 인덱스 안 열의 순서는 적힌 대로다. PK 제약 자체에는 이름을 붙이지 않는다(D-2, D-13).

```sql
CREATE TABLE places (
    place_id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    naver_place_id     text NOT NULL
                       CONSTRAINT uk_places_naver_place_id UNIQUE
                       CONSTRAINT ck_places_naver_place_id CHECK (naver_place_id <> ''),
    name               text NOT NULL,
    category_group     text NOT NULL
                       CONSTRAINT ck_places_category_group CHECK (category_group IN ('RESTAURANT', 'CAFE', 'BAR')),
    category           text,
    category_code      text,
    category_code_path text[] NOT NULL DEFAULT '{}',
    lat                double precision NOT NULL CONSTRAINT ck_places_lat CHECK (lat BETWEEN -90 AND 90),
    lng                double precision NOT NULL CONSTRAINT ck_places_lng CHECK (lng BETWEEN -180 AND 180),
    address            text,          -- 도로명
    jibun_address      text,
    full_address       text,          -- 층 등 상세 포함
    district           text,          -- 구(주소에서 뽑음)
    dong               text,          -- 동(주소에서 뽑음)
    directions         text,          -- 찾아오는 길(업체 작성)
    description        text,          -- 업체 소개
    phone              text,          -- 대표 전화(일반 번호가 없으면 안심번호)
    website            text,
    extra_links        text[] NOT NULL DEFAULT '{}',   -- 대표 홈페이지 말고 업체가 등록한 링크 URL
    booking_url        text,                           -- 가게의 네이버 예약 페이지
    facilities         text[] NOT NULL DEFAULT '{}',   -- 네이버 편의시설 이름 그대로
    parking_free       boolean,
    parking_note       text,
    pet_allowed        boolean,
    pet_note           text,
    corkage_allowed    boolean,
    corkage_note       text,
    payment_methods    text[] NOT NULL DEFAULT '{}',
    keywords           text[] NOT NULL DEFAULT '{}',
    menu_updated_on    date,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE place_hours (
    place_hour_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    place_id      bigint NOT NULL
                  CONSTRAINT fk_place_hours_place_id REFERENCES places(place_id) ON DELETE CASCADE,
    day_of_week   text NOT NULL
                  CONSTRAINT ck_place_hours_day_of_week CHECK (day_of_week IN ('MON','TUE','WED','THU','FRI','SAT','SUN')),
    open_time     time,
    close_time    time,                                  -- open_time 이하면 다음 날 마감
    closed        boolean NOT NULL DEFAULT false,
    breaks        jsonb NOT NULL DEFAULT '[]'
                  CONSTRAINT ck_place_hours_breaks CHECK (jsonb_typeof(breaks) = 'array'),  -- [{start, end}]
    last_orders   time[] NOT NULL DEFAULT '{}',
    CONSTRAINT uk_place_hours_place_id_day_of_week UNIQUE (place_id, day_of_week),
    CONSTRAINT ck_place_hours_time_pair CHECK ((open_time IS NULL) = (close_time IS NULL)),
    CONSTRAINT ck_place_hours_closed_no_time CHECK (NOT closed OR open_time IS NULL),
    CONSTRAINT ck_place_hours_no_2400 CHECK (open_time <> '24:00' AND close_time <> '24:00')
);

CREATE TABLE place_menus (
    place_menu_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    place_id       bigint NOT NULL
                   CONSTRAINT fk_place_menus_place_id REFERENCES places(place_id) ON DELETE CASCADE,
    sort_order     integer NOT NULL CONSTRAINT ck_place_menus_sort_order CHECK (sort_order >= 0),
    category       text,
    name           text NOT NULL,
    description    text,
    price          integer,                            -- 정가(FIXED)일 때만
    price_text     text,                               -- 가격 원문("10,000~13,000원", "가격 변동")
    price_type     text,                               -- FIXED, DYNAMIC, FREE, RANGE
    representative boolean NOT NULL DEFAULT false,
    labels         text[] NOT NULL DEFAULT '{}',       -- "2인이상", "사전예약" 등
    photo_urls     text[] NOT NULL DEFAULT '{}',       -- 원본 URL
    CONSTRAINT uk_place_menus_place_id_sort_order UNIQUE (place_id, sort_order)
);

-- 업체 사진과 메뉴판 사진만(방문자 리뷰 사진은 저장하지 않는다, D-4, D-7).
CREATE TABLE place_photos (
    place_photo_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    place_id       bigint NOT NULL
                   CONSTRAINT fk_place_photos_place_id REFERENCES places(place_id) ON DELETE CASCADE,
    source         text NOT NULL CONSTRAINT ck_place_photos_source CHECK (source IN ('business', 'menuBoard')),
    sort_order     integer NOT NULL CONSTRAINT ck_place_photos_sort_order CHECK (sort_order >= 0),  -- 출처별 0부터
    url            text NOT NULL,                      -- 원본 URL(프록시 없음)
    CONSTRAINT uk_place_photos_place_id_source_sort_order UNIQUE (place_id, source, sort_order)
);

CREATE TABLE place_subways (
    place_subway_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    place_id        bigint NOT NULL
                    CONSTRAINT fk_place_subways_place_id REFERENCES places(place_id) ON DELETE CASCADE,
    station         text NOT NULL,   -- 네이버 역 이름 그대로
    line            text,            -- 네이버 노선 값 그대로('2', '신분당')
    exit            text,
    walk_minutes    integer,
    walk_meters     integer
);
CREATE INDEX idx_place_subways_place_id_walk_meters ON place_subways (place_id, walk_meters);

CREATE TABLE place_bus_stops (
    place_bus_stop_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    place_id          bigint NOT NULL
                      CONSTRAINT fk_place_bus_stops_place_id REFERENCES places(place_id) ON DELETE CASCADE,
    name              text NOT NULL,
    code              text,
    walk_minutes      integer,
    walk_meters       integer
);
CREATE INDEX idx_place_bus_stops_place_id_walk_meters ON place_bus_stops (place_id, walk_meters);

CREATE TABLE place_seats (
    place_seat_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    place_id      bigint NOT NULL
                  CONSTRAINT fk_place_seats_place_id REFERENCES places(place_id) ON DELETE CASCADE,
    name          text NOT NULL,
    description   text
);
CREATE INDEX idx_place_seats_place_id ON place_seats (place_id);

CREATE TABLE place_broadcasts (
    place_broadcast_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    place_id           bigint NOT NULL
                       CONSTRAINT fk_place_broadcasts_place_id REFERENCES places(place_id) ON DELETE CASCADE,
    channel            text,
    program            text,
    episode            text,
    aired_on           date,
    menu               text
);
CREATE INDEX idx_place_broadcasts_place_id ON place_broadcasts (place_id);
```

`place_hours`, `place_menus`, `place_photos`는 UNIQUE 제약으로 `place_id`로 시작하는 인덱스를 갖춘다(D-13). DB가 보장하는 것은 위 SQL이 적은 것뿐이다. `breaks`의 원소 모양, `last_orders`의 값, 공백뿐인 문자열은 적재가 맞춘다. 순서 열이 없는 자식 테이블(지하철, 버스, 좌석, 방송)은 적재가 원본 순서대로 넣고, 읽을 때 같은 값이면 PK 순서로 원본 순서를 지킨다(D-9).

### 상세 응답 (`GET /api/v1/places/{id}`, 바뀌는 부분)

`?`는 선택 필드로 없으면 JSON에서 생략한다. 목록은 없으면 빈 목록이다. 숫자와 boolean은 박싱 타입이다(D-17).

```text
PlaceDetailResponse : place(PlaceSummary), address, tags(String[]), photos(String[] URL),
                      phone?, website?, openStatus(OpenStatus), hours(Hours[7]), closedDayNote?(String),
                      menus(Menu[]), facilities(String[]),
                      subways(Subway[]), directions?(String), parking?(Parking), pet?(Pet),
                      noKidsZone(Boolean), corkage?(Corkage), bookingUrl?(String), seats(Seat[]),
                      description?(String), paymentMethods(String[]), broadcasts(Broadcast[]),
                      extraLinks(String[])
  Hours     : dayOfWeek(DayCode), open?(HH:mm), close?(HH:mm), breaks(Break[]), lastOrders(String[] HH:mm),
              closed(Boolean)                      -- breakStart, breakEnd 삭제
  Break     : start(HH:mm), end(HH:mm)
  Menu      : category?, name, description?, price?(Integer 원, 정가일 때만), priceText?, labels(String[]),
              representative(Boolean), photoUrl?
  Subway    : station, line?, exit?, walkMinutes?(Integer)          -- 도보 거리순, line은 네이버 값 그대로
  Parking   : free?(Boolean), note?, valet(Boolean)                 -- valet은 facilities의 "발렛파킹"
  Pet       : allowed?(Boolean), note?
  Corkage   : allowed?(Boolean), note?
  Seat      : name, description?
  Broadcast : channel?, program?, episode?(String), airedOn?(yyyy-MM-dd), menu?
enum Facility 삭제. PlaceSummary, PlaceCard, 검색·자동완성 응답은 그대로다.
```

`parking`은 `free`와 `note`가 없고 `valet`이 false면 생략한다. `pet`과 `corkage`는 `allowed`와 `note`가 모두 없으면 생략한다. `noKidsZone`은 `facilities`에 "노키즈존"이 있으면 true다(D-6). FE는 노선이 숫자면 "2호선", 아니면 끝에 "선"이 없을 때 붙여 "신분당선"처럼 보이고, 마감 `00:00`은 "24:00"으로 보인다. 이것은 표시 서식이다.

**영업시간 형식(D-10, D-23)**: 시각은 `HH:mm`이다. `close`가 `open`과 같거나 이르면 다음 날 마감이고, 자정 마감은 `"00:00"`이다. 24시간 영업은 `open`과 `close`가 모두 `"00:00"`이다. 휴무일은 `closed: true`이고 `open`과 `close`가 없다. 영업시간 정보가 없는 요일은 `closed: false`이고 `open`과 `close`가 없다. 브레이크와 라스트오더는 그 요일의 영업 구간 안의 시각이다.

**영업 상태 규칙(D-23)**: 카드와 상세가 같은 규칙을 쓴다. 요청 시각(`Asia/Seoul`, 주입한 `Clock`)을 `t`라 하자.
1. 요일 d의 영업 구간은 d의 `open`부터 `close`까지이고, `close`가 `open`과 같거나 이르면 다음 날의 `close`까지다. 구간은 시작 포함, 끝 제외다.
2. 어떤 구간의 끝이 다음 요일 구간의 시작과 같으면(예: 월요일 `00:00`–`00:00` 다음 화요일 `00:00` 개점) 두 구간을 한 구간으로 잇는다. 이은 구간의 끝은 마지막 구간의 끝이다.
3. `t`가 어제 구간(다음 날로 넘어온 부분)이나 오늘 구간(2번으로 이은 것 포함)에 들면 그 구간으로 판정한다. 그 구간의 브레이크 `[start, end)` 중 하나 안이면 `BREAK`, 아니고 구간 끝 60분 전부터 끝 전이면 `CLOSING_SOON`, 그 밖에는 `OPEN`이다. 브레이크 시작 전은 `CLOSING_SOON`으로 보지 않는다.
4. 어느 구간에도 들지 않을 때, 오늘이 정보 없음이거나, 오늘이 영업일이고 `t`가 오늘 첫 구간 시작 전인데 어제가 정보 없음이면 `UNKNOWN`, 아니면 `CLOSED`다. 오늘이 휴무일이면 어제가 정보 없음이어도 `CLOSED`다.

### 적재·mock 변형 규칙 (D-6, D-9, D-10, D-12, D-16, D-24)

적재 스크립트와 mock 생성 스크립트가 CSV를 같은 규칙으로 변형한다. "원본 순서"는 CSV의 `position`(또는 `link_order`, `break_seq`, `seq`) 순서이고, 순서 열이 없는 파일은 파일에 적힌 줄 순서다.

| 대상 | 규칙 |
|---|---|
| 영업시간 시간표 | 시간표가 `DEFAULT`이면 그것, 없으면 `DINE_IN`("매장")만 쓴다 |
| 영업시간 요일 | `is_closed`가 true이고 `label_date`가 있는 요일(날짜가 붙은 휴무)은 정보 없음이다. `is_closed`가 true이고 `label_date`가 없으면 휴무다. 날짜가 붙은 영업 줄은 그 시각 그대로 쓴다. 24:00은 00:00이다. 시각은 `open_time`/`close_time`에서 가져온다 |
| 브레이크, 라스트오더 | 같은 시간표·요일의 `place_hours_breaks`(원본 순서, `{start, end}`)와 `place_hours_last_orders`(원본 순서, 종류 없이 시각만) |
| 휴무 안내 | `closedDayNote`는 정기휴무 요일(위 규칙의 휴무)을 월요일부터 세어 "매주 일요일 휴무", 여럿이면 "매주 토·일요일 휴무"처럼 만들고, 정기휴무가 없으면 생략한다 |
| 이름, 분류 | `name`, `category` ← `category_name`, `category_group` ← `category_group_code`, `category_code`, `category_code_path` ← `place_category_codes`에서 `is_category_path`가 true인 코드(원본 순서) |
| 전화, 예약 | `phone` ← `primary_phone`, `booking_url`/`bookingUrl` ← `naver_booking_url`. CSV `booking_url`, `talktalk_url`은 쓰지 않는다 |
| 링크 | `website` ← `homepage_url`, `extra_links` ← `place_links.url`(죽은 링크 제외, 원본 순서) |
| 주소, 구·동 | `address` ← `road_address`, `jibun_address`, `full_address`, `district` ← `district_name`, `dong` ← `dong_name` |
| 안내 글 | `directions` ← `directions_text`, `description` ← `place_description`, `menu_updated_on` |
| 목록 | `facilities` ← `place_facilities.facility_label`, `payment_methods` ← `place_payments.payment_label`, `keywords` ← `place_keywords.keyword`(모두 원본 순서) |
| 주차, 반려동물, 콜키지 | `parking_free` ← `basic_parking_is_free`, `parking_note` ← `place_parking.description`, `pet_allowed`/`pet_note` ← `place_policies.pet_allowed`/`pet_description`, `corkage_allowed` ← `corkage_available`, `corkage_note` ← `corkage_description`(없으면 `corkage_status_description`) |
| 메뉴 | 원본 순서 전부를 `sort_order` 0부터. `category` ← `category_name`, `price`는 `FIXED`일 때만, `price_text`, `price_type`, `representative` ← `is_representative`, `labels` ← `menu_item_labels`(원본 순서), `photo_urls` ← `menu_item_images`(원본 순서), 응답 `photoUrl`은 첫 장 |
| 사진 | `place_photos`에는 `photo_kind`가 `BUSINESS`이고 `media_source`가 `business`인 것(`source = business`)과 `MENU_BOARD`(`source = menuBoard`)만 넣고, `sort_order`는 출처마다 원본 순서로 0부터 다시 매긴다. 응답 `photos`는 업체 사진 다음 메뉴판 사진이고, `thumbnailUrl`은 업체 사진 첫 장(없으면 생략)이다 |
| 교통, 좌석, 방송 | `place_transit`의 `SUBWAY` → 지하철(`stop_name`, `line_name`, `exit_number`, 도보), `BUS` → 버스(`stop_name`, `stop_code`, 도보), `place_seat_types` → 좌석(`seat_name`, `description`), `place_broadcasts` → 방송(`episode`는 문자열, `aired_on`). 모두 원본 순서로 넣는다 |
| 기준 역 | mock의 `place.station` ← CSV `station_code`(이번에는 mock만 읽으므로 좌표 계산(D-6)은 DB 조회 작업에서 한다) |
| 지어내는 값(mock) | 점수, 추천 이유, 카드 `labels`, 상세 `tags`, `scoreItems`는 고정 문구 목록에서 지어낸다. 리뷰에서 나온 파일은 원천으로 쓰지 않는다 |
| 넣지 않는 것 | AC-15의 파일 전부, `place_michelin`, 방문자·클립·영상·`pai` 사진, 메뉴 옵션과 코스 구성, 매장 외 시간표 |

### FE 정보 탭 줄과 시설 아이콘 (D-18)

정보 탭 줄 순서(기존 항목 아래, "정보가 실제와 다를 수 있어요" 안내 위): 지하철(역 · 노선 · 출구 · 도보 n분, 도보 거리순 전부) → 찾아오는 길 → 주차(무료/유료, 발렛, 안내) → 예약(링크) → 반려동물 → 노키즈존 → 콜키지 → 좌석(이름과 설명) → 업체 소개 → 결제 수단 → 방송 → 다른 링크.

아이콘 묶음: 주차("주차", "발렛파킹", "장애인 주차구역"), 와이파이("무선 인터넷"), 단체("단체 이용 가능"), 예약("예약"), 포장·배달("포장", "배달", "테이크아웃 할인"), 화장실("남/녀 화장실 구분"), 아이("유아의자", "키즈메뉴", "노키즈존"), 휠체어("출입구 휠체어 이용가능", "좌석 휠체어 이용가능", "화장실 휠체어 이용가능"), 반려동물("반려동물 동반"), 메뉴 특성("비건 메뉴", "글루텐프리 메뉴", "유기농 메뉴", "무한 리필", "와인 페어링"). 그 밖의 이름은 기본 아이콘이다. 공통 아이콘(`fe/src/shared/ui/icon/icons/`)에 없는 아이콘은 새로 만들고, 아이콘의 모양은 재량이다.

## Constraints

- 새 마이그레이션은 파일 하나이고, 버전은 그 시점 마지막 버전의 다음 번호다(작성 시점 V6). 기존 마이그레이션 파일은 고치지 않는다(D-1).
- 새 마이그레이션에는 `CREATE TABLE`과 `CREATE INDEX`만 쓴다. 기존 객체의 ALTER와 DROP, `CREATE EXTENSION`, 트리거, 함수, GRANT, COMMENT는 쓰지 않는다. `reviews.place_id`에 FK를 걸지 않는다(D-1, D-11, D-21).
- 리뷰 원문, 답글, 블로그 요약, 리뷰어 정보(작성자 해시 포함), 외부 리뷰 집계와 리뷰 사진을 담는 열이나 테이블을 만들지 않는다(D-4, D-5).
- Interfaces에 없는 파생값 열(대표 사진, 휴무 안내, 영업 상태, 기준 역과 거리, 안심번호 여부, 링크 종류, 네이버 링크, 사진 프록시 주소, 노키즈존, 발렛, 지하철 순서)을 만들지 않는다(D-6).
- 적재 스크립트, mock 생성 스크립트, 대응표는 `data/naver-places/` 안에 두고 커밋하지 않는다. 커밋하는 것은 생성된 `places.json`뿐이다(D-14, D-15, D-19, D-20).
- mock 생성 스크립트는 같은 입력과 같은 인자면 같은 `places.json`과 대응표를 만든다(D-19).
- 적재 스크립트는 Python이고 로컬 앱 계정으로 접속한다. 장소마다 한 트랜잭션으로 `naver_place_id`로 장소를 갱신하고(`place_id` 유지) 자식 행은 지운 뒤 다시 넣는다. 테이블을 비우고 다시 넣지 않는다(D-15).
- API는 이번에도 mock만 읽는다. JPA 엔티티, 리포지토리, mock/DB 선택 설정을 만들지 않는다(D-1).
- 사진 URL은 원본 그대로 응답한다. 리사이즈 프록시를 만들지 않는다(D-7).
- place-search spec 수정(AC-22)은 응답 계약을 바꾸는 코드와 같은 커밋에 넣는다(D-1).
- `infra/`와 `docs/infra/`는 고치지 않는다. 계정 권한에 바꿀 것이 생기면 인프라 담당에게 넘긴다.

## Existing code

| Locator | Action | Obligation | Decision |
|---|---|---|---|
| `be/src/main/resources/application-migrate.yml#spring.flyway` | reuse | 마이그레이션은 migrate 프로필의 Flyway로만 실행한다. 새 파일은 기본 위치(`be/src/main/resources/db/migration/`)에 두고, 웹 앱 설정(`flyway.enabled: false`)은 그대로 둔다 | D-1 |
| `be/src/test/java/kr/co/fitdining/api/support/PostgresTestSupport.java#PostgresTestSupport` | reuse | 테스트 DB를 같은 이미지, 마이그레이션 계정과 앱 계정, 기본 권한으로 구성하고 Flyway 기본 위치의 마이그레이션을 적용한다. 고치지 않는다 | D-1 |
| `be/src/main/java/kr/co/fitdining/api/place/dto/PlaceDetailResponse.java#PlaceDetailResponse` | modify | Interfaces의 상세 응답 모양으로 필드와 중첩 타입만 바꾼다(`Facility` enum 삭제 포함) | D-17 |
| `be/src/main/java/kr/co/fitdining/api/place/engine/MockPlaceSearchEngine.java#openStatus` | modify | 영업 상태 계산을 Interfaces의 "영업 상태 규칙"으로 바꾸고, 테스트가 영업시간을 넣어 판정을 부를 수 있게 한다(방법은 재량). 상세 응답을 다시 만드는 부분은 새 필드를 그대로 옮기게 고친다. 검색, 자동완성, 커서, `place.mock.enabled` 스위치의 동작은 그대로 둔다 | D-1, D-23 |
| `be/src/main/resources/mock/places.json#places` | modify | 생성 스크립트의 출력으로 통째로 바꾼다. 루트 모양(`places[{card, detail}]`)은 그대로다 | D-19 |
| `be/src/test/java/kr/co/fitdining/api/place/engine/MockPlaceSearchEngineTest.java#MockPlaceSearchEngineTest` | modify | 데이터 규칙을 AC-12로 바꾼다(장소 수, 사진, 영업시간 형식, 메뉴 카테고리와 "메뉴 1개 이상" 규칙만 바뀌고 나머지는 유지). "언제 검색해도 `UNKNOWN` 없음" 규칙은 지우고, 고정 시각 영업 상태 테스트는 테스트 안에서 만든 영업시간으로 옮겨 AC-11의 경우를 모두 확인하고, 카드와 상세가 같은 상태인지와 UTC 시계에서도 서울 시각으로 판정하는지는 mock 장소로 계속 확인한다. mock의 특정 장소 내용에 기대던 기대값은 새 mock에 맞추되 각 테스트가 확인하는 성질은 줄이지 않는다 | D-19, D-23 |
| `be/src/test/java/kr/co/fitdining/api/place/PlaceControllerTest.java#PlaceControllerTest` | modify | `ResponseShape`의 키 집합을 Interfaces에 맞추고 새 중첩 타입의 키 집합을 더하며 모든 mock 장소를 검사한다. 다른 테스트는 mock 내용에 묶인 입력과 기대값(질의 문자열, 장소 이름, id, 장소 수, 페이지 경계, 자동완성 결과)만 새 mock에 맞추고, 각 테스트가 확인하는 성질(메뉴로만 맞는 장소, 대소문자 무시, 5개 제한, 두 페이지와 커서 등)과 검사 항목은 줄이지 않는다 | D-17, D-19 |
| `be/src/test/java/kr/co/fitdining/api/place/PlaceControllerPassThroughTest.java#PlaceControllerPassThroughTest` | modify | 새 DTO 생성자에 맞춰 테스트 데이터만 고친다 | D-17 |
| `fe/src/domains/place/model/place-types.ts#PlaceDetail` | modify | `PlaceDetail`, `Hours`, `Menu` 타입을 Interfaces와 같은 모양으로 바꾸고 `Facility` 타입을 지운다 | D-17 |
| `fe/src/domains/place/model/opening-hours.ts#todayNotice` | modify | 오늘 안내를 AC-17대로 바꾼다 | D-23 |
| `fe/src/domains/place/model/opening-hours.ts#hoursText` | modify | "정보 없음", "24시간 영업", 자정 넘김 표기(AC-17) | D-23 |
| `fe/src/domains/place/model/opening-hours.ts#hoursNotes` | modify | 브레이크마다 한 줄 | D-18, D-23 |
| `fe/src/domains/place/model/opening-hours.test.ts#todayNotice` | modify | 픽스처를 새 타입 모양으로 바꾸고 AC-17 경우를 더한다. 기존 경우의 확인은 줄이지 않는다 | D-23 |
| `fe/src/domains/place/model/place-labels.ts#FACILITY_LABELS` | modify | 코드→이름 표 대신 시설 이름→아이콘 묶음 표로 바꾼다 | D-18 |
| `fe/src/domains/place/ui/place-detail-tabs.tsx#InfoTab` | modify | 정보 탭에 새 줄과 시설 칩 아이콘(AC-16) | D-18 |
| `fe/src/domains/place/ui/place-detail-tabs.tsx#MenuTab` | modify | 메뉴 묶음과 카테고리 없는 메뉴(AC-18) | D-18 |
| `fe/src/domains/place/ui/menu-card.tsx#MenuRow` | modify | 메뉴 탭 한 줄에 설명, 라벨·대표 칩, 가격 원문(AC-18). 홈 탭의 `MenuCard`는 고치지 않는다 | D-18 |
| `fe/src/domains/place/ui/place-detail-screen.test.tsx#PlaceDetailScreen` | modify | 픽스처를 새 타입 모양(새 필수 필드, 시설 이름, 브레이크 목록, 메뉴 `priceText`)으로 바꾸고, 가격 표시 기대값을 가격 원문으로 맞추며, AC-16~AC-18 경우를 더한다. 기존 확인은 줄이지 않는다 | D-18 |
| `be/src/test/java/kr/co/fitdining/api/review/ReviewPersistenceTest.java#ReviewPersistenceTest` | modify | 새 mock으로도 통과해야 한다. mock 장소 id에 묶인 상수만 고칠 수 있고 확인하는 성질은 줄이지 않는다(AC-13이 id 3을 카페로 두므로 원래는 고칠 것이 없다) | D-19 |
| `docs/specs/place-search/spec.md#Interfaces` | modify | AC-22에 적힌 정의, 문단, AC, Seams 줄만 이 spec과 어긋나지 않게 고친다 | D-1 |

## Seams & test plan

- PostgreSQL 통합 테스트(example), AC-1~AC-8: `PostgresTestSupport`를 상속해 공유 컨테이너에 마이그레이션을 적용한다. `flyway_schema_history`로 적용을, `information_schema.columns`(`udt_name`, `is_nullable`, `column_default`, `is_identity`, `identity_generation`)로 열을 정확히 비교하고, `pg_constraint`와 `pg_indexes`로 제약·인덱스의 이름과 첫 열, 그리고 그 밖의 제약·인덱스가 없음을 확인한다. 앱 계정(`appSource()`)으로 실제 DML을 실행해 제약 위반, 기본값, 권한, CASCADE를 확인한다. 테스트 데이터는 실행마다 겹치지 않게 만든다. 잡는 것: 열 누락이나 남는 열, 타입, NULL 허용, 기본값, identity, 이름, CHECK, UNIQUE, CASCADE, 인덱스, 앱 계정 권한. 놓치는 것: 운영 DB 권한, 실제 300곳 적재. Prior art: `be/src/test/java/kr/co/fitdining/api/user/PreferencesFlowTests.java`.
- mock 엔진 단위 테스트(example), AC-11, AC-12: 고정한 `Clock`과 테스트 안에서 만든 영업시간으로 영업 상태 판정을 부르고, `places.json`을 애플리케이션 JSON 설정으로 읽어 데이터 규칙을 확인한다. 잡는 것: 영업 상태 판정 오류(자정 넘김, 이어진 24시간, 정보 없음, 여러 브레이크), mock 데이터 규칙 위반. 놓치는 것: CSV와의 값 일치. Prior art: `MockPlaceSearchEngineTest`.
- 컨트롤러 테스트(example), AC-9, AC-10: `PlaceControllerTest`의 `ResponseShape`가 모든 mock 장소에서 문서화된 키 집합을 넘는 키를 잡고, `?` 없는 필드와 요일마다의 `breaks`·`lastOrders`가 있는지도 검사하며, 나머지 테스트가 검색·자동완성·커서 동작이 그대로임을 확인한다. Prior art: 같은 클래스.
- FE 단위·화면 테스트(example), AC-16~AC-18: `opening-hours.test.ts`에서 `hoursText`, `hoursNotes`, `todayNotice`를 고정 시각으로 확인하고, `place-detail-screen.test.tsx`에서 상세 화면을 그려 정보 탭 줄 순서와 숨김, 시설 칩의 묶음별 아이콘과 기본 아이콘, 메뉴 탭 묶음·칩·가격 원문·빈 상태를 확인한다. 잡는 것: 문구와 순서, 빈 값 숨김, 아이콘 선택. 놓치는 것: 시각적 모양. Prior art: `fe/src/domains/place/model/opening-hours.test.ts`, `fe/src/domains/place/ui/place-detail-screen.test.tsx`.
- 기존 테스트 전체(example), AC-9: `./gradlew test`(Docker 필요), CI `be:test`, FE 테스트 실행.
- 로컬 적재 확인(manual), AC-14(DB 쪽), AC-15, AC-19, AC-20: 로컬 DB에 마이그레이션 후 적재 스크립트를 두 번 실행하고, `PGHOSTADDR`를 다른 주소로 두고도 `--host 127.0.0.1`로 로컬에 들어가는지 보고, 출력된 행 수와 `SELECT naver_place_id, place_id FROM places`를 두 번 비교한다. `--host`를 원격 주소로 주어 접속하지 않고 끝나는지 본다. 일회용 확인 스크립트로 모든 장소의 메뉴·사진·지하철 수, `phone`, `booking_url`, 메뉴 순서를 CSV에서 규칙대로 만든 값과 비교한다. `PGSERVICE`를 설정하거나 `--dbname`에 접속 문자열을 넣어도 로컬 밖으로 접속하지 않는지 본다. SQL로 슬로우커피 금요일, 폴 바셋 7일이 정보 없음인지, 농민백암순대 수요일이 `11:10`–`15:30`인지, 스타벅스 강남서초초교점이 매장 시간표인지, 죽은 링크가 없는지 본다. 두 스크립트의 소스에서 AC-15의 파일 이름을 여는 곳이 없는지 보고, AC-15의 20자 이상 문자열과 작성자 해시 전부를 8개 테이블의 텍스트 값 전체와 대조하는 일회용 확인 스크립트로 0건임을 본다. 적재 스크립트는 저장소 밖이라 자동 테스트를 두지 않는다(D-15).
- mock과 대응표 확인(manual), AC-13, AC-14(mock 쪽), AC-15(mock 쪽), AC-16~AC-18(눈으로), AC-21: 대응표의 각 행을 `places.json`과 대조하고 역별 장소 수를 센다. 대응표에 적힌 확인용 장소를 `/place?id=<id>`로 열어 정보 탭 줄, 시설 아이콘, 메뉴 탭(64px 사진, 두 줄 말줄임, 칩), 영업시간 문구와 홈 탭의 구조가 그대로인지 눈으로 본다(AC-16~AC-18). 확인용 장소 몇 곳의 `phone`, `bookingUrl`, `closedDayNote`, 메뉴 순서를 CSV와 대조한다. AC-15의 20자 이상 문자열과 작성자 해시 전부를 `places.json`과 대조해 0건임을 본다. 없는 `naver_place_id`를 `--include`로 주거나 40곳을 넘게 주어 아무 파일도 바뀌지 않는지 보고, 같은 인자로 두 번 만들어 결과가 같은지 본다.
- 문서 검토(manual), AC-9(고친 기존 테스트가 Existing code 범위 안인지), AC-22와 Constraints: diff로 place-search spec 수정 범위, 새 마이그레이션이 파일 하나이고 `CREATE TABLE`과 `CREATE INDEX`만 쓰는지, `infra/`와 `docs/infra/`가 바뀌지 않았는지, `data/naver-places/`가 커밋되지 않았는지 확인한다.
- CI `lint:migrations`(example, 기존), Constraints: 기존 마이그레이션 수정과 버전 중복·역순을 막는다.

## Out of scope

- API가 DB를 읽게 하는 일: JPA 엔티티, 리포지토리, mock/DB 선택 설정, AI 검색 응답(`placeId`)과 장소 정보 연결, 좌표로 기준 역 계산(D-1, D-6). 이 일은 `docs/specs/place-lookup-db/spec.md`가 한다(JPA 엔티티는 만들지 않고 SQL 읽기 모델로 한다. AI 검색 응답과의 연결과 좌표로 기준 역 계산은 여전히 범위 밖이다).
- dev와 운영 DB 적재, 적재 스크립트의 저장소 커밋(D-1, D-15).
- `reviews.place_id`에서 `places.place_id`로 FK를 거는 일. 모든 환경에 장소가 적재되는 작업에서 리뷰 담당과 함께 한다(D-21).
- 검색 카드, `PlaceSummary`, 자동완성 응답의 변경, `PlaceSummary.station` 삭제, 홈 탭 변경(D-17, D-18).
- "곧 마감" 상태 자체의 변경(D-23).
- 사진 리사이즈 프록시(`src`/`srcSet`)(D-7).
- 상세 `tags`의 실데이터. AI 쪽이 준다(D-17).
- 버스 정류장의 응답과 화면 표시(D-17).
- 메뉴 옵션, 코스 구성, 신메뉴 배지, 최저·최고 가격, 메뉴 기준일 표시(D-16).
- 외부 리뷰 집계, 리뷰 원문, 블로그 요약의 저장. AI 검색 파트가 가져간다(D-4, D-5).
- 역 테이블, 공간 인덱스와 확장, 법정동 코드(D-6, D-11).
- `updated_at` 자동 갱신 트리거. 적재가 넣는다.
- 찜(`saved_places`), 검색 기록 테이블. 회원 테이블 변경.
- 시설 아이콘의 디자인 확정(D-18).

## Open questions

- 다시 수집하면 임시 휴무 4곳의 정규 영업시간을 채울 수 있다. 재수집 시점은 정하지 않았다(D-24).
