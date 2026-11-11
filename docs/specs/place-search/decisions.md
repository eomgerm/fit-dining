# place-search decisions

Glossary: none · ADRs: none

## D-1 범위와 목표
- Status: superseded by D-31
- Decision: 자동완성, 추천 검색과 후속 조건 수정, 결과 목록과 지도, 장소 상세만 만든다(Jira S15P31A302-15, 27~30). 목표는 "Mock으로 끝까지 동작"이다.

## D-2 AI 파트와의 경계
- Status: superseded by D-18
- Decision: BE는 인터페이스 하나(`PlaceSearchEngine`)만 두고 Mock 구현을 꽂는다.

## D-3 Mock은 BE에 두고 시나리오는 검색어로 나눈다
- Status: superseded by D-16
- Decision: 고정 JSON(강남·역삼·선릉 약 12곳)을 BE가 실제 경로로 돌려준다.

## D-4 엔드포인트 3개와 패키지
- Status: superseded by D-32
- Decision: `GET /api/v1/places/suggest?q=`, `POST /api/v1/places/search`, `GET /api/v1/places/{id}`. 패키지는 기존 `kr.co.fitdining.api.place`이고 DB와 JPA는 쓰지 않는다.

## D-5 DTO는 최소 구조로 전달만 한다
- Status: superseded by D-19
- Decision: 요청은 query, preferences?, previousConditions?, mapBounds?, cursor?. 응답은 conditions, nearby, items[], nextCursor?, emptyReason?. 카드는 place, score, labels[2], caution?. 상세는 hours, menus, facilities,…

## D-6 절대 일어나면 안 되는 일
- Status: superseded by D-17
- Decision: 구조로 보장한다.

## D-7 근처 모드
- Status: superseded by D-22
- Decision: 서버는 위치 없이 후보 전체(최대 약 100)를 점수순으로, 커서 없이 `nearby: true`로 내려주고, 브라우저가 반경으로 거른다.

## D-8 후속 조건과 페이징
- Status: superseded by D-45
- Decision: 응답의 `conditions`를 FE가 `previousConditions`로 되돌려 보낸다(서버는 상태 없음). 검색 측이 `thread_id`로 관리하는 방식은 미결이며, 채택되면 필드만 교체한다.

## D-9 취향과 인증
- Status: superseded by D-33
- Decision: 취향은 요청 본문의 선택 필드(`preferences`, 태그 코드 목록)로 받고, JWT는 읽지 않는다.

## D-10 오류와 빈 결과
- Status: settled
- Decision: 오류는 Spring ProblemDetail을 임시로 쓴다. 결과 없음은 200과 빈 목록, `emptyReason`(원인과 수정 제안)으로 응답한다. 공통 응답과 예외 형식은 BE 팀 결정 전까지 미결이다.

## D-11 FE 배포 방식은 미결, 작성 원칙은 양쪽 호환
- Status: superseded by D-38
- Decision: 정적 export 여부는 미결이다.

## D-12 FE 구조
- Status: superseded by D-43
- Decision: UI 컴포넌트는 `src/app/components`, 화면이 아닌 로직(API 호출, DTO 타입, 근처 필터, 디바운스 훅)은 `src/lib`에 둔다.

## D-13 지도와 자동완성 디바운스
- Status: superseded by D-48
- Decision: 네이버 지도 JS API를 한 컴포넌트에서만 로드하고, 키가 없으면 지도 영역만 비우고 목록은 동작한다(키와 요금은 PRD OQ-19로 미결). 자동완성은 300ms 안팎 디바운스, 빈 입력 미요청, 이전 요청 취소, 늦게 온 응답 무시를 지킨다.

## D-14 용어와 이름
- Status: superseded by D-23
- Decision: 코드, API, 화면은 "장소(Place)"로 통일하고 REST 경로는 복수형(`/places`)이다.

## D-15 검증 방식
- Status: superseded by D-30
- Decision: BE는 엔드포인트 3개를 `@WebMvcTest`로 확인한다(Mock 시나리오 포함). FE는 Vitest를 추가해 근처 필터와 거리 계산, 디바운스 훅만 단위 테스트한다.

## D-16 Mock의 규모, 시나리오, 노출 범위
- Status: superseded by D-34
- Decision: Mock 장소는 25곳 이상이라 20개 페이징과 `nextCursor`가 실제로 나온다.

## D-17 절대 일어나면 안 되는 일(필드 수준 보장)
- Status: superseded by D-41
- Decision: 요청에 위치 좌표 필드가 없고 응답에 외부 리뷰 필드가 없다는 것은 **이름 있는 필드 수준의 보장**이다.

## D-18 AI 파트와의 경계(교체 범위 정정)
- Status: superseded by D-62
- Decision: BE는 인터페이스 하나(`PlaceSearchEngine`)만 두고 Mock 구현을 꽂는다.

## D-19 DTO는 최소 구조로 전달만 한다(타입 정정)
- Status: superseded by D-24
- Decision: 요청은 query, preferences?, previousConditions?, mapBounds?, cursor?. 응답은 conditions, nearby, items[], nextCursor?, emptyReason?. 카드는 place, score, labels[2], caution?. 상세는 hours, menus, facilities,…

## D-20 로그 규칙
- Status: settled
- Decision: BE는 검색과 자동완성의 요청 본문, `preferences`, `q` 값을 로그에 남기지 않는다. 자동완성이 GET이라 `q`가 Caddy 접근 로그에 남는 문제는 인프라 담당에게 넘기는 미결 사항이다(`docs/infra/design.md` §5.4의 로그 필터는 `k`만 지운다).

## D-21 BE 기동
- Status: superseded by D-40
- Decision: 이 기능은 DB를 쓰지 않지만 `be/build.gradle`에 JPA, Flyway, Postgres가 있고 datasource 설정이 없어 기동에 실패한다.

## D-22 근처 모드(위치 위험 명시)
- Status: superseded by D-42
- Decision: 서버는 위치 없이 후보 전체(최대 약 100)를 점수순으로, 커서 없이 `nearby: true`로 내려주고, 브라우저가 반경으로 거른다.

## D-23 용어와 이름(ERD 근거 제거)
- Status: superseded by D-35
- Decision: 코드, API, 화면은 "장소(Place)"로 통일하고 REST 경로는 복수형(`/places`)이다.

## D-24 DTO 정정(추천 이유의 위치, id 타입)
- Status: superseded by D-44
- Decision: 요청은 query, preferences?, previousConditions?, mapBounds?, cursor?. 응답은 conditions, nearby, items[], nextCursor?, emptyReason?. 검색 응답의 항목(카드)은 place, score, labels[2], caution?에 더해 `reasons`와…

## D-25 임베딩 계산 주체와 벡터 저장 위치(미결)
- Status: superseded by D-36
- Decision: 임베딩을 누가 계산하는지(Modal, 또는 OpenSearch가 외부 모델 호출)와 벡터를 OpenSearch에만 둘지 Postgres(pgvector)에도 둘지는 미결이다(`docs/infra/design.md:488`, `:960` §16 #21, 담당 BE·AI 팀). `PlaceSearchEngine` 뒤쪽의 일이라 이 기능의 API 계약에는…

## D-26 상세 데이터 출처와 두 저장소의 동기화(미결)
- Status: superseded by D-37
- Decision: 장소 상세 정보(영업시간, 메뉴, 시설 등)를 Postgres에서 읽을지 OpenSearch 문서에서 읽을지, 두 저장소를 어떻게 동기화할지는 미결이다.

## D-27 검색 상태 보관 방식(미결)
- Status: settled
- Decision: 결과 목록에서 상세로 갔다가 뒤로 가도 기존 결과가 유지되어야 하고(PRD AC-4), 상세 화면은 검색 응답 카드의 추천 이유를 써야 한다(D-24). 이 검색 상태를 프런트 메모리(React Context 등)에 둘지 `sessionStorage`까지 쓸지는 더 확인이 필요해 미결이다. 메모리는 새로고침이나 탭 재로드, PWA 재로드에서 사라질 수 있다.

## D-28 로컬에서 FE가 BE를 부르는 방법(미결)
- Status: superseded by D-39
- Decision: 운영은 같은 출처(`/api`)지만 로컬은 FE(`localhost:3000`)와 BE(`localhost:8080`)가 달라서 BE의 CORS 허용이나 FE 개발 서버의 프록시 같은 방법이 필요하다.

## D-29 지도 클라이언트 ID의 주입 방식(미결)
- Status: superseded by D-57
- Decision: FE가 네이버 지도 클라이언트 ID를 어떻게 얻는지(빌드 시점 `NEXT_PUBLIC_*` 환경변수, 런타임 설정 파일 등)는 보안 확인 후 정하며 미결이다.

## D-30 검증 방식(자동완성 로직은 React와 분리해 테스트)
- Status: superseded by D-68
- Decision: BE는 엔드포인트 3개를 `@WebMvcTest`로 확인한다(Mock 시나리오 포함). FE는 Vitest만 추가해 근처 필터, 거리 계산, 자동완성 로직(디바운스, 취소, 늦은 응답 무시)을 단위 테스트한다.

## D-31 범위와 목표(일정 제외)
- Status: superseded by D-49
- Decision: 자동완성, 추천 검색과 후속 조건 수정, 결과 목록과 지도, 장소 상세만 만든다(Jira S15P31A302-15, 27~30). 목표는 "Mock으로 끝까지 동작"이다.

## D-32 엔드포인트 3개와 패키지(루트 패키지 유지)
- Status: settled
- Decision: `GET /api/v1/places/suggest?q=`, `POST /api/v1/places/search`, `GET /api/v1/places/{id}`. 패키지는 `kr.co.fitdining.api.place`이고 DB와 JPA는 쓰지 않는다. 루트 패키지 `kr.co.fitdining.api`는 팀 합의로 유지한다.
- Rejected: `kr.co.fitdining.place` → `ApiApplication`을 옮겨야 하고 공용 뼈대를 건드린다.

## D-33 취향과 인증(취향은 검색에 쓰인다)
- Status: settled
- Decision: 취향은 요청 본문의 선택 필드(`preferences`, 태그 코드 목록)로 받고, JWT는 읽지 않는다. 실제 검색은 취향을 결과에 반영한다(팀 확인). Mock은 받아 두기만 하고 결과에 반영하지 않는다. 이후 place-ai-search D-4가 바꿨다: `preferences`는 온보딩 답 모양 객체이고, 검색은 토큰을 선택으로 읽어 회원 id를 AI에 넘긴다.

## D-34 Mock의 규모, 시나리오, 노출 범위(prod는 실제 데이터)
- Status: superseded by D-47
- Decision: Mock 장소는 25곳 이상이라 20개 페이징과 `nextCursor`가 실제로 나온다.

## D-35 용어와 이름(테이블 복수, 엔티티 단수)
- Status: settled
- Decision: 코드, API, 화면은 "장소(Place)"로 통일하고 REST 경로는 복수형(`/places`)이다. 테이블 이름은 복수(`places`), JPA 엔티티 이름은 단수(`Place`)다. 이 기능은 DB 테이블을 쓰지 않으므로 이 이름을 만들지 않는다.
- Rejected: 가게, 매장 → PRD 용어가 "장소"다.

## D-36 임베딩과 벡터 저장 위치
- Status: settled
- Decision: 임베딩 계산과 벡터의 최종 관리는 OpenSearch가 맡는다. Postgres의 pgvector는 OpenSearch 연동이 준비되기 전에 빠르게 써 보는 임시 용도다. `PlaceSearchEngine` 뒤쪽의 일이라 이 기능의 API 계약에는 영향이 없다.

## D-37 상세 데이터 출처와 동기화
- Status: settled
- Decision: 장소 데이터는 Postgres에 저장하고 OpenSearch로 동기화한다. 동기화 방식(갱신 순서, 일관성)은 미결이다(PRD OQ-13). Mock 단계에서는 `PlaceSearchEngine` 뒤쪽이라 영향이 없다.

## D-38 FE는 Next.js Node 서버로 배포한다
- Status: settled
- Decision: 팀 회의에서 FE를 정적 export가 아닌 Next.js Node 서버로 띄우기로 했다. `docs/infra/design.md` §12.5 #1(정적 export, Node 서버 없음)과 다르며, 이 기능은 그 문서를 고치지 않고 인프라 담당에게 알린다. 데이터는 계속 브라우저 `fetch`로 가져오고 장소 상세는 `/place?id=`로 만든다. `next.config.ts`의 `cacheComponents`와 `partialPrefetching`은 그대로 둔다.
- Rejected: 정적 export → 팀이 Node 서버로 정했다. 이 기능에서 `docs/infra/design.md` 수정 → 인프라 담당의 문서다.

## D-39 FE가 BE를 부르는 방법(Next 프록시)
- Status: superseded by D-58
- Decision: FE는 항상 상대 경로 `/api/v1/...`를 부르고, Next.js 서버가 `next.config.ts`의 `rewrites`로 `/api/:path*`를 BE에 넘긴다.

## D-40 BE 설정을 yml로 옮기고 접속 정보에 로컬 기본값을 둔다
- Status: settled
- Decision: `application.properties`를 `application.yml`로 바꾼다. `spring.datasource.url`, `username`, `password`는 `${SPRING_DATASOURCE_URL:jdbc:postgresql://127.0.0.1:15432/fit_dev}`, `${SPRING_DATASOURCE_USERNAME:fit_dev_app}`처럼 `infra/local` 기준의 로컬 기본값을 두고, 비밀번호는 기본값 없이 `be/.env`(gitignore)에서 `spring.config.import=optional:file:.env[.properties]`로 읽는다. 예제는 `be/.env.example`에 둔다. 웹 앱은 DML 전용 계정으로 접속해 부팅할 때 Flyway가 실패하므로 `spring.flyway.enabled=false`로 둔다(`docs/infra/design.md` §9의 웹 프로필). 마이그레이션 전용 프로필은 팀 몫이다. 운영 값은 계속 환경변수(`docs/infra/contracts/env.md`)로 넘긴다.
- Rejected: 공용 뼈대 설정을 바꾸지 않고 환경변수 세 개로 띄우기 → 팀이 이 기능에서 정리하기로 했다. 이 기능을 위해 datasource 자동 설정을 제외 → 공용 뼈대를 건드린다.

## D-41 절대 일어나면 안 되는 일(설정 위치 변경)
- Status: settled
- Decision: 요청에 위치 좌표 필드가 없고 응답에 외부 리뷰 필드가 없다는 것은 **이름 있는 필드 수준의 보장**이다. 요청 본문은 알 수 없는 속성이 오면 거부해서 클라이언트가 `lat`, `lng` 같은 필드를 몰래 실어 보내도 받지 않는다. 이 설정은 `application.yml`에 둔다(D-40). 자유 텍스트 필드(`reasons`, `caution`, `labels`, `preferences`)의 내용은 검증하지 않으며, 외부 리뷰 원문이나 좌표가 담기지 않게 하는 책임은 제공자(AI 파트)에게 있다(감수한 트레이드오프). 제공자의 약속은 점수 0~100 정수, 근거 없는 특징 미표시, 확인할 수 없는 지역 조건 장소 제외다. FE는 점수를 정수 그대로 `%` 없이 표시한다.

## D-42 근처 모드(기기 위치 사용 확정)
- Status: superseded by D-46
- Decision: 근처 모드는 기기 위치를 쓰되 서버로 보내지 않는다.

## D-43 FE 구조(팀 확인)
- Status: superseded by D-66
- Decision: UI 컴포넌트는 `src/app/components`, 화면이 아닌 로직(API 호출, DTO 타입, 근처 필터, 자동완성 로직과 훅)은 `src/lib`에 둔다.

## D-44 DTO 정정(장소 id는 정수)
- Status: superseded by D-53
- Decision: 요청은 query, preferences?, previousConditions?, mapBounds?, cursor?. 응답은 conditions, nearby, items[], nextCursor?, emptyReason?. 검색 응답의 항목(카드)은 place, score, labels[2], caution?에 더해 `reasons`와…

## D-45 후속 조건과 페이징(새 검색과 후속 조건의 구분)
- Status: superseded by D-50
- Decision: 응답의 `conditions`를 FE가 `previousConditions`로 되돌려 보낸다(서버는 상태 없음). 검색 측이 `thread_id`로 관리하는 방식은 미결이며, 채택되면 필드만 교체한다.

## D-46 근처 모드(위치 실패 시 동작 명시)
- Status: superseded by D-52
- Decision: 근처 모드는 기기 위치를 쓰되 서버로 보내지 않는다.

## D-47 Mock의 규모, 시나리오, 노출 범위(인프라 문서는 고치지 않음)
- Status: superseded by D-63
- Decision: Mock 장소는 25곳 이상이라 20개 페이징과 `nextCursor`가 실제로 나온다.

## D-48 지도(네이버 웹 SDK 사용 방식과 핀 연동)와 자동완성 디바운스
- Status: superseded by D-51
- Decision: 네이버 지도 웹 SDK(JavaScript v3)를 `PlaceMap` 한 컴포넌트에서만 `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=<Client ID>`로 동적 로드한다(파라미터는 `ncpKeyId`, 서브 모듈은 로드하지 않는다). 키가 없거나…

## D-49 범위와 목표(Figma 화면 기준)
- Status: settled
- Decision: 자동완성, 추천 검색과 후속 조건, 이번 세션의 요청 기록, 결과 목록과 지도, 장소 상세만 만든다(Jira S15P31A302-15, 27~30). 화면 기준은 Figma 파일 `VC2HKXkesDRQjbLoqey1B5`의 "5. 검색·추천 결과"(5-01, 5-03~5-07)와 "6. 장소 상세"(6-01, 6-02, 6-04, 6-05)다. 목표는 "Mock으로 끝까지 동작"이며 데모 일정은 고려하지 않는다.
- Rejected: 5-02 "이 조건으로 추천받기" 토글 → 다음 기능으로 미룬다. 5-08 지난날 결과 보기 → 서버 저장과 인증이 필요하다. 6-03 리뷰 탭, 6-06~6-12 리뷰 수정·삭제·신고, "방문 평가 남기기", 저장, 프로필, 공유 → 다른 담당이다. 검색 기록(서버 저장), 온보딩, 인증 → Jira에 없고 다른 담당이다. 검색 기록, 온보딩, 저장, 리뷰, 인증 → Jira에 없고 다른 담당이다.

## D-50 새 검색과 후속 조건의 입력 분리, 이번 세션의 요청 기록
- Status: settled
- Decision: 응답의 `conditions`를 FE가 `previousConditions`로 되돌려 보낸다(서버는 상태 없음). 검색 측이 `thread_id`로 관리하는 방식은 미결이며, 채택되면 필드만 교체한다. 페이징은 불투명한 `nextCursor`를 쓰고 한 번에 20개다. 결과가 없을 때는 위쪽 검색창(자동완성 있음)이 새 검색이고, 결과가 있을 때는 결과 패널 아래 입력창("조건을 더 말해 보세요", 자동완성 없음)이 항상 후속 조건이다. 패널의 "새 검색"은 결과를 비우고 위쪽 검색창으로 돌아간다. 요청 기록(5-07)은 이번 페이지 세션의 요청을 FE 메모리에 쌓아 보여 주고, "결과 보기"는 요청 없이 그 시점의 결과로 돌아가며, "여기서 이어 검색"은 그 시점의 `conditions`를 다음 후속 조건의 기준으로 삼는다.
- Rejected: 검색창 하나를 상태에 따라 새 검색과 후속으로 나눠 쓰기 → 디자인과 다르고 사용자가 헷갈린다. 결과 위에 별도 후속 입력창 → 화면이 늘어난다. 자동완성 ACTION으로만 후속 → 사용자가 발견하기 어렵다.

## D-51 지도(네이버 웹 SDK, 순위 핀, 핀과 카드 연동)와 자동완성 디바운스
- Status: superseded by D-70
- Decision: 네이버 지도 웹 SDK(JavaScript v3)를 `PlaceMap` 한 컴포넌트에서만 `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=<Client ID>`로 동적 로드한다(서브 모듈 없음). 키가 없거나 `window.navermap_authFailure`가 호출되면 지도 영역만 비우고 목록은…

## D-52 위치 사용(내 위치 버튼과 근처 모드)
- Status: settled
- Decision: 기기 위치는 서버로 보내지 않는다. 위치는 앱을 열 때(D-83)와 사용자가 지도의 "내 위치" 버튼을 누를 때만 요청한다. 근처 응답(`nearby: true`)을 받았다고 요청하지 않는다(D-108). 위치를 얻으면 지도에 내 위치 점을 표시하고, 자동완성 후보, 카드, 상세의 거리를 브라우저에서 계산해 보여 준다. 위치가 없으면 거리를 숨긴다. FE는 거리로 거르지 않고 표시만 한다. 근처 응답(`nearby: true`)은 서버가 지도 영역으로 거른 결과라 위치가 있든 없든 서버 순서 그대로 보인다(D-111). 위치를 얻지 못하면 알리기만 하고 아무것도 다시 검색하지 않는다. `mapBounds`는 사용자의 위치가 아니라 검색 대상 지역으로 취급하며(PRD §7.1), 어떤 검색 요청에 담는지는 위치를 얻었는지와 상관없이 D-109가 정한다. 위치 정책의 재검토는 PRD OQ-18을 따른다.
- Rejected: 좌표 서버 전송 → 위치정보법 신고 대상이 될 가능성(PRD D-03). 화면을 열자마자 권한 요청 → 팀이 버튼 방식을 택했다. 위치 실패 즉시 `mapBounds`로 자동 재검색 → 근처 응답이 다시 오면 반복될 수 있다. 근처 응답 뒤 자동 위치 요청 → 위치를 얻는 길이 앱을 열 때와 버튼에 더해 셋이 되어, 진행 중인 조회와 겹치면 늦게 끝난 쪽이 위치를 덮는다(D-108). 위치를 쓰지 않고 지역 안 상위 몇 개만 표시 → 팀이 기기 위치 사용을 택했다. 기기 위치와 반경(FE 상수 1000m)으로 FE가 근처 응답을 거르기 → 위치 없이 받은 전국 후보를 자르면 구로처럼 반경 안에 남는 곳이 없어 홈이 비고, 거르는 일은 AI와 BE가 지도 영역으로 한다(D-111).

## D-53 DTO를 디자인에 맞게 확장
- Status: superseded by D-54
- Decision: Mock과 DTO를 Figma 5, 6 화면이 요구하는 필드까지 늘리고, AI 파트 계약이 정해지면 이 DTO를 기준으로 맞춘다.

## D-54 DTO를 팀 BE 컨벤션에 맞춰 파일로 나눈다
- Status: superseded by D-64
- Decision: D-53의 필드 구성은 그대로 두고, 팀 BE 컨벤션(`be/docs/convention.md`)에 맞춰 DTO를 `kr.co.fitdining.api.place.dto` 패키지에 클래스마다 파일 하나로 둔다.

## D-55 입력 형식 검증은 Bean Validation(`@Valid`)으로 한다
- Status: settled
- Decision: 팀 BE 컨벤션에 따라 형식 검증은 요청 DTO와 요청 파라미터의 Bean Validation 어노테이션(`@NotBlank`, `@Size(max = 200)`)과 `@Valid`/`@Validated`로 한다. 필요한 `spring-boot-starter-validation` 의존성은 사용자가 `be/build.gradle`에 직접 추가하며, 이 기능의 구현은 그 밖의 `build.gradle` 변경을 하지 않는다. 검증 실패는 `PlaceExceptionHandler`가 400 ProblemDetail로 바꾼다.
- Rejected: 컨트롤러에서 직접 검증 → 컨벤션과 다르다.

## D-56 컨트롤러와 엔진 사이에 얇은 PlaceService를 둔다
- Status: settled
- Decision: 팀 BE 컨벤션에 따라 존재 여부 같은 비즈니스 판단은 Service에서 한다. `PlaceController`는 `PlaceService`에 위임만 하고, `PlaceService`가 `PlaceSearchEngine`을 선택적 의존성으로 받아 엔진이 없으면 503 예외를, `findPlace`가 비어 있으면 404 예외를 던진다. `PlaceService`도 엔진이 돌려준 값을 가공하지 않는다.
- Rejected: 컨트롤러가 404와 503을 직접 처리 → 컨벤션과 다르다.

## D-57 지도 클라이언트 ID는 FE의 `/config.json`으로 전달한다
- Status: settled
- Decision: 인프라 설계(`docs/infra/design.md` §12.5 #3, `contracts/env.md`의 "프런트 런타임 설정")에 맞춰 브라우저가 쓰는 공개 값은 FE(Next.js)의 `/config.json` 라우트가 런타임 환경변수에서 읽어 돌려준다. 이 기능에서 `fe/src/app/config.json/route.ts`를 새로 만들고, 계약의 `env`(`APP_ENV`)와 새 키 `naverMapClientId`(환경변수 `NAVER_MAP_CLIENT_ID`)만 돌려준다. 로컬은 `fe/.env.local`에 둔다. 브라우저는 앱이 시작될 때 한 번 받아 메모리에 두고, `PlaceMap`은 그 값을 쓴다. 값이 없으면 지도 영역을 비운다. 네이버 지도 Client ID는 스크립트 주소에 드러나는 공개 키이고 도메인 등록과 한도로 보호되며, Client Secret은 브라우저로 보내지 않는다. `NAVER_MAP_CLIENT_ID`를 env 계약에 올리는 일은 인프라 담당에게 알린다(이 기능은 `docs/infra/`를 고치지 않는다).
- Rejected: `NEXT_PUBLIC_*` 빌드 시점 주입 → 인프라 설계가 금지하고, CI 빌드에서 값을 빠뜨리면 빈 지도가 이미지에 굳는다. SSR로 HTML에 넣기 → 인프라 문서의 공개 값 경로와 달라진다.

## D-58 로컬에서 FE가 BE를 부르는 방법(개발 서버 전용 프록시)
- Status: superseded by D-69
- Decision: FE는 항상 상대 경로 `/api/v1/...`를 부른다.

## D-59 `q` 검증은 MVC 내장 메서드 검증으로 한다(클래스 `@Validated` 없음)
- Status: settled
- Decision: `PlaceController`에는 클래스 수준 `@Validated`를 붙이지 않고, `q` 파라미터의 `@NotBlank`, `@Size(max = 200)`만으로 Spring MVC 내장 메서드 검증(Spring 6.1+)을 받는다. 실패하면 `HandlerMethodValidationException`이 나고 `PlaceExceptionHandler`가 400으로 바꾼다. 의존성(`spring-boot-starter-validation`)은 그대로다.
- Rejected: 클래스 `@Validated` 유지 → Spring 7.0.9는 클래스에 `@Validated`가 있으면 내장 검증을 끄고(`HandlerMethod.MethodValidationInitializer`) AOP 프록시가 `ConstraintViolationException`을 던져, 처리 목록에 없는 예외가 500이 된다. 그 예외를 처리 목록에 추가 → 같은 검증에 두 방식이 섞인다.

## D-60 Mock 데이터 파일은 `places` 루트 객체로 감싼다
- Status: settled
- Decision: `classpath:mock/places.json`은 최상위 배열이 아니라 `{"places": [{"card": PlaceCard, "detail": PlaceDetailResponse}]}`이다. Mock 엔진 안의 private record로 읽고, 전역 알 수 없는 속성 거부를 그대로 받는다.
- Rejected: 최상위 배열을 두고 anchor 이름을 바꾸기 → 결정 로그 변경이 더 크고, 루트 이름이 있으면 파일이 스스로 설명된다.

## D-61 `conditions` 내부의 null 값은 그대로 내보낸다
- Status: settled
- Decision: 전역 null 생략 설정(`spring.jackson.default-property-inclusion: non_null`)은 Spring Boot 4.1.1에서 Map 내부 값에도 적용되어 `conditions`의 null 값을 지운다. `PlaceSearchResponse.conditions`에만 `@JsonInclude(content = JsonInclude.Include.ALWAYS)`를 붙여 받은 `previousConditions`를 내부 null 값까지 그대로 돌려준다.
- Rejected: 생략을 감수 → `{"a": null}`이 `{}`로 바뀌어 AC-5의 "그대로"와 어긋난다.

## D-62 AI 파트와의 경계(엔진은 `place.engine` 하위 패키지)
- Status: settled
- Decision: BE는 인터페이스 하나(`PlaceSearchEngine`)만 두고 Mock 구현을 꽂는다. 요청 해석, 임베딩, OpenSearch 질의, 리랭크, 점수 계산을 이어 붙이는 주체는 place-ai-search D-1이 정했다(DB 모드 엔진이 AI 검색 API를 부른다). 구현을 교체할 때 DTO뿐 아니라 이 인터페이스의 시그니처(실패, 폴백 표시, 타임아웃 처리)도 바뀔 수 있으며, 이를 감수한다. 실제로 `search`는 회원 id를 받고 `PlaceSearchResult`(응답과 대체 이유)를 돌려주도록 바뀌었다. 타임아웃, 서킷 브레이커, 예산, `X-Fallback` 헤더는 place-ai-search가 다뤘고, 속도 제한은 아직 범위 밖이다(`docs/infra/design.md` §11.2, §12.1). 교체 지점인 엔진 관련 파일(`PlaceSearchEngine`, 그 구현, 엔진 계약의 예외 `InvalidCursorException`)은 하위 패키지 `kr.co.fitdining.api.place.engine`에 모아 교체 지점이 구조로 드러나게 한다. 엔진은 장소 기능 전용이라 최상위 패키지로 빼지 않는다.
- Rejected: BE가 Modal과 OpenSearch를 직접 호출(`docs/infra/design.md` §12.2 제안) → 담당이 정해지지 않았다. 지금 실패 모델을 인터페이스에 넣기 → 실제 계약이 없어서 추측이 된다. 최상위 `kr.co.fitdining.api.search` → 엔진 시그니처가 `place.dto`를 써서 상호 의존이 생기고, 다른 기능이 함께 쓰는 모듈이 아니다. 이름에 `I` 접두사나 `Impl` 접미사 → Java 주류가 아니고, 구현이 Mock과 실제 엔진처럼 여럿이라 구현 이름은 특징을 담는다.

## D-63 Mock의 규모, 시나리오, 노출 범위(Mock 위치는 `place.engine`)
- Status: settled
- Decision: Mock 장소는 25곳 이상이라 20개 페이징과 `nextCursor`가 실제로 나온다. 시나리오는 요청 헤더 `X-Mock-Scenario`로 고르고, FE는 주소창의 `?mock=empty`를 읽어 이 헤더를 붙인다. 지금은 `empty`만 만들고 `error`는 필요해질 때 추가한다. 헤더가 없으면 정상 결과이며, "근처"가 들어간 검색어는 AI의 해석을 흉내 내 `nearby: true`로 응답한다. 후속 검색에서 Mock은 받은 `previousConditions`를 그대로 `conditions`에 담아 돌려준다. Mock은 설정 스위치(`PLACE_MOCK_ENABLED`)로 켜고 local과 dev에서만 켠다. prod는 실제 데이터만 보여 주며 Mock을 켜지 않는다. 실제 구현이 없으면 검색 API는 503을 돌려준다. 이 기능은 `docs/infra/` 아래 문서(`contracts/env.md` 포함)를 고치지 않으며, 스위치를 환경변수 계약에 올리는 일은 인프라 담당에게 알린다. Mock 구현은 D-62에 따라 `kr.co.fitdining.api.place.engine`에 둔다.
- Rejected: 검색어 부분 문자열로 시나리오 분기("근처", "없음") → 평범한 문장과 충돌하고 우선순위가 없다. 입력창에 `mock:empty` 같은 명령어 입력 → 직관적이지 않다. 개발용 선택 상자 → 지금은 과하다. prod에서 Mock으로 시연 → 팀이 실제 데이터로 보여 주기로 했다. 이 기능에서 `env.md`에 행 추가 → 인프라 담당의 문서다. FE 쪽 Mock → 실제 연동 때 FE도 고쳐야 한다.

## D-64 DTO는 응답별 파일에 하위 타입을 중첩한다
- Status: settled
- Decision: D-53의 필드 구성은 그대로 두고 DTO를 `kr.co.fitdining.api.place.dto` 패키지에 둔다. 엔드포인트의 요청과 응답은 `PlaceSuggestResponse`(자동완성 후보 1개), `PlaceSearchRequest`, `PlaceSearchResponse`, `PlaceDetailResponse`이고 각각 파일 하나다. 여러 곳이 함께 쓰는 `PlaceSummary`, `OpenStatus`와 하위 구조가 많은 `PlaceCard`도 파일 하나씩 둔다. 부모 하나에서만 쓰는 하위 record와 enum은 그 부모 안에 중첩한다(`PlaceSummary`의 `CategoryGroup`, `Station`, `PlaceSuggestResponse`의 `SuggestType`, `PlaceSearchRequest`의 `MapBounds`, `PlaceSearchResponse`의 `EmptyReason`, `PlaceCard`의 `Reason`, `ReasonTag`, `ScoreItem`, `EvidenceSource`, `PlaceDetailResponse`의 `Hours`, `Menu`, `DayCode`, `Facility`). 응답 하나의 모양이 파일 하나에 보이게 하려는 것이며 JSON 모양은 바뀌지 않는다. 역직렬화되는 record(요청과 Mock이 읽는 `places.json` 매핑 모두)의 숫자와 boolean은 박싱 타입(`Long`, `Integer`, `Double`, `Boolean`)이다. 장소 `id`는 ERD의 `places.place_id`(bigint)를 따라 정수다. 추천 이유와 핏 점수 설명은 검색 응답 카드에 담고 상세 응답에는 장소 고유 정보만 담는다. 이 값을 만드는 주체는 AI 파트다(place-ai-search에서 AI가 카드의 점수와 이유를 준다). 상세 API는 장소 id만 받는다. `conditions`와 `previousConditions`는 BE와 FE가 해석하지 않는 불투명한 JSON 객체다. BE는 엔진이 돌려준 내용을 검증하거나 가공하지 않는다.
- Rejected: 클래스마다 파일 하나(D-54) → 파일이 20개라 응답 하나의 모양을 보려면 여러 파일을 열어야 한다. 하위 패키지(`dto/search` 등)로 묶기 → 파일 수가 줄지 않는다. `PlaceDtos` 한 파일에 모으기 → 여러 사람이 DTO를 고칠 때 병합 충돌이 잦고 컨벤션의 이름 규칙과 다르다. 원시 타입 record → Jackson 3에서 값이 빠진 원시 타입은 원인을 알기 어려운 400이 된다. 문자열 id(`p-001`, UUID) → ERD가 bigint PK로 정했다. 지금 DTO를 유지하고 디자인 일부를 비워 두기 → 팀이 디자인대로 그리기로 했다. 문자열 id → ERD가 bigint PK다.

## D-65 `be/.env.example`의 DB 비밀번호는 `REPLACE_ME`로 둔다
- Status: settled
- Decision: 리뷰 기능(S15P31A302-18)이 먼저 master에 올린 `be/.env.example`의 `SPRING_DATASOURCE_PASSWORD=REPLACE_ME`를 따른다. 개발자는 복사한 뒤 이 값을 `infra/local/.env`의 `FIT_DEV_APP_PASSWORD`로 바꾸며, 파일 주석에 이 방법을 적는다. `PLACE_MOCK_ENABLED=true`는 그대로 둔다.
- Rejected: `infra/local` 예제와 같은 가짜 값(`local-app-password`)을 미리 넣기 → 팀이 정한 `REPLACE_ME` 표시(`docs/infra/contracts/env.md`의 "비밀이 아직 없다는 표시")와 어긋난다.

## D-66 FE 구조는 팀 FE 구조(`app → domains → shared`)를 따른다
- Status: settled
- Decision: 팀이 S15P31A302-36에서 정한 FE 구조를 따른다. `src/app`에는 라우트와 레이아웃만 두고, 장소 검색과 상세는 도메인 `src/domains/place`에 `model`(타입과 순수 규칙, React와 fetch import 금지), `api`(`place-api.ts`의 BE 호출 함수와 `place-queries.ts`), `ui`(화면과 컴포넌트, 훅)로 나눈다. 도메인 안의 의존은 `ui → api → model` 방향만 쓴다. 도메인을 모르는 코드는 `src/shared`에 두며 `/config.json`을 받는 모듈은 `src/shared/lib/runtime-config.ts`다. 파일 이름은 kebab-case이고 테스트는 소스 옆 `*.test.ts(x)`이며 barrel 파일은 만들지 않는다. 같은 도메인 안은 상대 경로로, 그 밖은 `@/` 경로로 import한다(ESLint가 `src/domains`에서 `@/domains`를 막는다). BE 호출은 공통 `request`(`/api` 접두, timeout, `ApiError`)를 쓴다. DTO 타입은 처음에는 도메인 모델과 나누지 않고 `model`에 둔다.
- Rejected: D-43의 `src/app/components`와 `src/lib` → 팀이 master에 다른 구조를 올리고 ESLint로 강제한다. `fetch` 직접 호출 → 공통 클라이언트가 오류와 timeout을 한 곳에서 다룬다. `src/features/place-search` → 규칙이 없고, `src/app` 안 colocation이 Next 문서상 안전하며 파일 수가 적다.

## D-67 서버 상태는 TanStack Query로, 화면 상태는 `model`의 store로 둔다
- Status: settled
- Decision: 세 API의 응답은 TanStack Query 캐시에 둔다. 쿼리 키와 `queryOptions`는 `place-queries.ts`에서만 만들고 `ui`는 `useQuery(placeQueries.detail(id))`처럼 그것을 넘겨 훅을 부른다. 자동완성은 300ms 늦춘 입력을 키로 하는 쿼리이고 Query가 넘기는 `signal`로 이전 요청을 취소하며 키가 바뀐 응답은 화면에 쓰지 않는다. 검색은 요청 기록 항목마다 무한 쿼리 하나(키에 항목 id)를 두고 `staleTime`과 `gcTime`을 무한으로 두어, "결과 보기"와 상세에서 돌아오기가 캐시로 동작한다. 첫 페이지는 성공했을 때만 기록에 넣기 위해 화면을 바꾸기 전에 받아 둔다. 재시도는 공통 `QueryClient` 기본값(5xx와 연결 실패만 두 번)을 따른다. 서버가 모르는 화면 상태(요청 기록의 메타 정보, 지금 보는 항목, 선택된 카드, 위치 결과, 장소별 최근 카드)는 React 없는 모듈 `src/domains/place/model/search-store.ts`에 두고, `ui`의 훅이 `useSyncExternalStore`로 화면에 잇는다. 캐시와 store 모두 메모리라 재로드하면 사라진다(보관 방식은 D-27대로 미결).
- Rejected: store가 검색 페이지와 커서를 직접 들기 → 서버 상태가 Query 밖에 따로 생겨 팀 표준과 갈린다. `place-queries.ts`가 `usePlaceDetail` 같은 훅까지 내보내기 → 팀이 키와 `queryOptions`만 모으는 쪽을 골랐다. store를 `ui`에 두기 → React 없는 모듈이라 `model`의 import 규칙(React, fetch 금지)을 지키고, `model`에 두면 React 없이 테스트할 수 있다. 화면 상태를 `useState`로 두기 → 상세로 이동하면 검색 화면이 사라지며 상태가 함께 사라진다.

## D-68 FE 테스트는 Vitest에 jsdom과 Testing Library를 더한다
- Status: settled
- Decision: 이미 들어온 Vitest에 개발 의존성 `jsdom`, `@testing-library/react`와 그 필수 동반 패키지 `@testing-library/dom`을 더한다. 순수 로직(근처 필터, 거리, 요청 본문, store)과 API 함수는 Node 환경에서, 훅(자동완성의 디바운스, 취소, 늦은 응답 무시)과 일부 화면은 jsdom 환경에서 렌더링해 테스트한다. `@/` 경로와 테스트 환경을 위한 Vitest 설정은 구현 때 정한다. E2E는 하지 않는다.
- Rejected: jsdom 없이 훅을 React와 무관한 모듈로 떼어 테스트(D-30) → 사용자가 훅과 화면을 직접 테스트하기로 했다. `jsdom`과 `@testing-library/react`로 훅을 직접 테스트 → 개발 의존성이 늘어난다.

## D-69 로컬에서 FE가 BE를 부르는 방법(이미 master에 있는 개발 서버 프록시)
- Status: settled
- Decision: FE는 항상 상대 경로 `/api/v1/...`를 부른다. 운영에서는 Caddy가 `/api/*`를 BE로 보낸다. 로컬에서는 `next dev`일 때만 `next.config.ts`의 `rewrites`가 `/api/:path*`를 `BE_INTERNAL_URL`(기본값 `http://localhost:8080`)로 넘긴다. 이 설정은 S15P31A302-36에서 master에 들어왔으므로 고치지 않고 그대로 쓴다. 운영 빌드에는 rewrites가 없어 산출물에 `localhost`가 남지 않는다. BE는 CORS를 설정하지 않는다.
- Rejected: 항상 켜는 rewrites → 운영 빌드 산출물에 `localhost`가 남는다. BE CORS 허용 → 같은 출처를 유지하는 편이 단순하다. 항상 켜는 rewrites와 `API_PROXY_TARGET` 이름 → 운영 빌드 산출물에 `localhost`가 남아 인프라의 산출물 검사에 걸리고, 인프라가 정한 이름과 다르다.

## D-70 지도(네이버 웹 SDK, 순위 핀, 핀과 카드 연동)와 자동완성 디바운스(`PlaceMap`은 `place` 도메인 ui)
- Status: settled
- Decision: D-51의 내용을 그대로 두고 `PlaceMap`의 위치만 D-66의 구조로 옮긴다. 네이버 지도 웹 SDK(JavaScript v3)를 `PlaceMap` 한 컴포넌트에서만 `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=<Client ID>`로 동적 로드한다(서브 모듈 없음). 키가 없거나 `window.navermap_authFailure`가 호출되면 지도 영역만 비우고 목록은 동작한다. 지도 영역은 검색 요청을 보낼 때만 읽는다(D-109). 핀과 카드에는 같은 순위 번호를 표시하고(디자인 5-04), 선택된 핀은 강조한다. 핀을 누르면 그 카드를 선택하고, 선택되지 않은 카드를 누르면 지도가 그 핀으로 이동하며 선택하고, 선택된 카드를 다시 누르면 장소 상세로 간다. 자동완성은 300ms 안팎 디바운스, 빈 입력 미요청, 이전 요청 취소, 늦게 온 응답 무시를 지킨다. 근거: 팀의 공식 지도 API 정리와 시험 페이지(`~/Desktop/A302/naver-map-official-api.md` §5.4, §5.6).
- Rejected: 핀에 점수 표시 → 디자인은 순위 번호다. 근처 필터에 SDK의 `getDistance` 사용 → 지도 키가 없으면 쓸 수 없다. geocoder 등 서브 모듈 → 필요 없고 검색어를 네이버로 보낸다. 근처 필터에 SDK의 `getProjection().getDistance` 사용 → 지도 키가 없으면 쓸 수 없다. haversine 순수 함수로 계산한다(실측 차이 1m).

## D-71 화면 스타일은 S15P31A302-35의 토큰과 `shared/ui`를 따른다
- Status: settled
- Decision: 화면의 색, 글자, radius, 그림자, 모션은 S15P31A302-35가 `fe/src/app/globals.css`에 둔 semantic 토큰만 쓰고, 그 작업의 ESLint 디자인 시스템 규칙(날색과 임의 값 금지, `shared/ui` 컴포넌트는 variant와 size로 모양을 고르고 `className`으로는 배치만 바꾼다)을 지킨다. `shared/ui`에 있는 것(Tabs, BottomSheet, Toast, EmptyState, Chip, Tag, Fab, IconButton, TextField, Icon, `skeleton` 유틸 등)은 그대로 쓴다. 모달 시트인 BottomSheet는 ⓘ 시트와 요청 기록에 쓰고, 지도 위에 늘 떠 있는 결과 패널(중간, 전체)은 모달이 아니므로 도메인 ui에서 만든다. `shared/ui`에 없는 장소 전용 모양(장소 카드, 지도 핀과 순위 배지, 핏 점수, 검색창, 메뉴 카드, 결과 패널)은 `src/domains/place/ui`에 토큰으로 만든다. 기준은 Figma 디자인 시스템 페이지(파일 `VC2HKXkesDRQjbLoqey1B5`, node `80:33933`)와 화면 5-xx, 6-xx이며 픽셀 단위 일치는 요구하지 않는다.
- Rejected: 장소 전용 컴포넌트를 `shared/ui`에 추가 → 다른 도메인이 쓰지 않고 공통 UI 담당의 영역이다. 이 기능에서 토큰을 따로 정의 → -35의 토큰과 겹친다.

## D-72 화면 문구와 날짜·입력 규칙은 `model`의 순수 함수 파일로 둔다
- Status: settled
- Decision: D-66의 `model`(타입과 순수 규칙)에 `place-labels.ts`(업종, 영업 상태, 시설, 근거 출처의 한글 이름), `opening-hours.ts`(`Asia/Seoul` 기준 오늘 영업시간과 오늘 안내, 요일별 영업시간 문구), `highlight.ts`(자동완성의 입력 일치 부분 나누기), `place-id.ts`(상세 `?id` 검사)를 더한다. 모두 React와 fetch 없이 Node 환경 Vitest로 테스트한다. 요청 기록 줄의 업종 이름이 `search-store.ts`에서 필요해 한글 이름은 `model`에 둔다.
- Rejected: `ui` 파일 안의 비공개 함수 → 화면을 렌더링해야만 경계값(시간대, 안전한 정수 범위)을 확인할 수 있다. `nearby.ts`나 `search-store.ts`에 합치기 → 두 파일의 역할(거리, 화면 상태)과 맞지 않는다.

## D-73 결과 0건 응답은 결과 패널에 보여 준다
- Status: settled
- Decision: 첫 페이지 응답에 `emptyReason`이 있어도 성공한 요청이므로 요청 기록에 "결과 0곳"으로 쌓고 지금 보는 요청이 된다. 결과 패널은 카드 목록 대신 `emptyReason`의 원인과 수정 제안을 보여 주고, 패널 아래 후속 입력창과 "새 검색"은 그대로 둔다. D-50의 "결과가 없을 때의 위쪽 검색창"은 지금 보는 요청이 없을 때(처음, "새 검색" 뒤)를 말한다. 기준은 Figma 5-E05, 5-E06이다.
- Rejected: 0건이면 위쪽 검색창으로 돌아가기 → 0건 결과를 후속 조건으로 좁히거나 넓힐 수 없고, 요청 기록의 "결과 0곳"과 맞지 않는다.

## D-74 요청 기록의 이어 검색 표시에서 첫 번째 요청은 "첫 요청"이라고 쓴다
- Status: settled
- Decision: 기준 요청이 직전 요청이 아닐 때의 표시는 기준 요청이 1번째면 "첫 요청에서 이어 검색", 그 밖에는 "<n>번째 요청에서 이어 검색"이다(Figma 5-07).
- Rejected: 모든 순서를 "<n>번째"로 쓰기 → "1번째"는 쉬운 한국어가 아니고 디자인과 다르다.

## D-75 FE 환경변수 예제는 `fe/.env.example`에 둔다
- Status: settled
- Decision: `be/.env.example`처럼 `fe/.env.example`에 `NAVER_MAP_CLIENT_ID`(빈 값)와 선택 값 `APP_ENV`, `BE_INTERNAL_URL`을 설명과 함께 둔다. 개발자는 `fe/.env.local`로 복사해 채운다. `fe/.gitignore`의 `.env*`가 예제까지 막으므로 `!.env.example`을 더한다.
- Rejected: 예제 없이 spec과 README에만 적기 → 새로 받은 사람이 지도 키 이름을 찾기 어렵다.

## D-76 "이 지역에서 검색" 항목은 기준 요청의 문장을 그대로 쓴다
- Status: settled
- Decision: 요청 기록에서 "이 지역에서 검색"으로 쌓인 항목의 문장은 기준 요청의 문장 그대로이고 " (이 지역)"을 붙이지 않는다. 기준 요청은 그때 보던 요청이다. 같은 문장의 항목은 업종과 곳 수, 시각으로 구분한다.
- Rejected: 기준 문장 뒤에 " (이 지역)"을 붙이기(처음 spec 27번) → 입력하지 않은 말이 문장에 섞이고, 연달아 누르면 "(이 지역) (이 지역)"이 쌓인다. 버튼이 동작했는지는 화면 전환과 기록 줄로 이미 알 수 있다.

## D-77 "이 지역에서 검색" 버튼은 사용자가 지도를 움직인 뒤에만 보인다
- Status: settled
- Decision: 네이버 지도의 "현 지도에서 검색"처럼, 결과가 있을 때 사용자가 지도를 끌거나(`dragend`) 확대·축소한(`zoom_changed`) 뒤에만 버튼을 보인다. 버튼을 누르거나, 보는 결과가 바뀌거나(새 요청, "결과 보기"), "새 검색"을 누르면 다시 숨긴다. 카드 선택, "내 위치", 결과 맞춤 이동(D-110)처럼 코드가 지도를 옮길 때는 보이지 않는다. 지도 영역은 D-109대로 버튼을 누를 때 읽는다.
- Rejected: 결과가 있으면 버튼을 늘 보이기 → 지도를 움직이지 않아도 떠 있어 같은 영역을 다시 검색하게 만든다. 지도 이동마다 자동으로 다시 검색 → 지도 영역은 검색 요청을 보낼 때만 읽는다(D-70, D-109).

## D-78 요청 기록이 있으면 위쪽 검색창에도 요청 기록 버튼을 둔다
- Status: superseded by D-84
- Decision: "새 검색"으로 위쪽 검색창에 돌아와도 이번 세션의 요청 기록은 남으므로, 기록이 하나 이상이면 위쪽 검색창 오른쪽에 요청 기록 버튼을 두어 같은 시트(5-07)를 연다.

## D-79 다시 보는 검색 결과의 영업 상태는 검색한 시각의 값을 그대로 둔다
- Status: settled
- Decision: "결과 보기"나 상세에서 돌아오기로 예전 검색 결과를 다시 보여 줄 때, 카드의 영업 상태(`openStatus`)는 BE가 그 검색 시각 기준으로 계산한 값 그대로 보여 준다. 그래서 탭을 오래 켜 두면 실제와 다를 수 있다(예: 오후 2시 결과를 밤 11시에 다시 보면 "영업 중"). 정확한 영업 상태는 상세 화면이 들어갈 때마다 새로 받는 값으로 확인한다. 검색 결과 캐시와 요청 기록은 메모리에만 있고 개수 상한이 없으며 재로드하면 사라진다.
- Rejected: 오래된 결과에서 영업 상태를 숨기기, "오후 2:10 기준"처럼 기준 시각 표시, 오래된 결과를 다시 검색하기 → 검색 기록 보관 방식(D-27)과 서버 저장이 정해진 뒤 함께 정한다. 카드에는 영업시간이 없어 FE가 상태를 다시 계산할 수 없다.

## D-80 범위 추가(와이어프레임의 첫 화면)
- Status: settled
- Decision: D-49의 범위에 Jira S15P31A302-42(와이어프레임과 다른 디자인 수정)의 첫 화면을 더한다. 기준은 와이어프레임 `~/Desktop/핏다이닝 디자인 v1/project/`의 `Start.dc.html`(첫 화면과 주변 추천 카드), `StartRecent.dc.html`과 `StartRecentEmpty.dc.html`(최근 검색 시트), `StartNoLoc.dc.html`(위치가 없을 때), `Typing.dc.html`(아래 검색창의 자동완성), `Results.dc.html`(결과 화면의 지도 위 버튼)이다. 이 화면들에서 와이어프레임과 Figma가 다르면 와이어프레임을 따른다. 그 밖의 화면은 D-49대로 Figma를 따른다.
- Rejected: "내 주변 추천" 라벨 → 사용자가 이번에는 빼기로 했다. 위치 권한 안내 화면(`Location`, `LocationPrompt`), 앱 설치 안내(`StartInstall*`), 지난 결과 보기(`PastResult`, 5-08) → 온보딩과 결과 보관 방식(D-27)이 정해지지 않았다.

## D-81 첫 화면의 검색창은 화면 아래에 떠 있다
- Status: settled
- Decision: D-50의 "위쪽 검색창"(지금 보는 요청이 없을 때의 새 검색 입력, D-73)을 지도 위 화면 아래쪽에 떠 있는 검색창으로 옮긴다. 문구는 "분위기나 목적을 말해 보세요"이고 오른쪽에 최근 검색 버튼(D-84)과 추천받기 버튼(위쪽 화살표)이 있다. 자동완성 후보는 검색창 바로 위에 열리며 순서는 응답 그대로다. 결과가 있을 때는 지금처럼 결과 패널 아래의 후속 입력창이 화면 맨 아래에 있고 결과 목록은 그 위에 있다. 새 검색과 후속 조건의 구분(D-50)은 바꾸지 않는다.
- Rejected: 위쪽 검색창 유지 → 와이어프레임은 첫 화면과 결과 화면 모두 입력을 화면 아래 같은 자리에 둔다. 자동완성 후보를 검색창 아래에 열기 → 화면 아래라 자리가 없고 키보드에 가린다.

## D-82 첫 화면의 주변 추천 카드는 지도 영역의 근처 검색으로 채운다
- Status: settled
- Decision: 지금 보는 요청이 없고 검색 중이 아닐 때, 검색창 위에 주변 장소 카드를 가로로 넘기는 목록(`shared/ui`의 `Carousel`)으로 보여 주고 지도에는 같은 순위 번호의 핀을 찍는다. 데이터는 `POST /api/v1/places/nearby`가 `mapBounds`로 받은 근처 응답(서버가 지도 영역 안에서 거른 10곳까지, 커서 없음)이고 FE는 그대로 보인다. 요청 본문은 `mapBounds`(와 보낼 때만 `preferences`)를 담고 영역은 D-111이 정하며 요청 기록에 쌓지 않는다. 받은 카드는 장소별 최근 카드에 둬서 상세 화면이 핏 점수와 추천 이유를 쓴다. 카드는 위쪽 사진(없으면 자리표시), 순위, 이름, 업종 · 거리(기기 위치가 있을 때만) · 영업 상태, 핏 점수, 라벨 2개이고 주의점은 없다. 선택된 카드가 목록에서 놓이는 자리는 D-103이다. 카드를 넘기면 그 카드를 선택하고 지도를 그 핀으로 옮긴다(`panTo`). 핀이나 선택되지 않은 카드를 누르면 그 카드로 넘긴다. 선택된 카드를 누르면 상세로 간다. 영역 안에 장소가 없으면 응답의 `emptyReason`을, 요청이 실패하면 실패 안내를 카드 자리에 보인다(D-111).
- Rejected: 고정 문장 "근처 맛집"만 보내 받은 전국 후보를 기기 위치 반경으로 거르기(옛 결정) → 장소 데이터가 여러 지역으로 늘면 구로처럼 반경 안에 남는 곳이 없어 홈이 비고 빈 이유도 보이지 않는다(D-111). 지도 영역으로 검색하면 대략의 위치가 서버로 간다는 걱정 → 보이는 영역은 사용자가 보는 지도이고 `mapBounds`는 검색 대상 지역이라 위치가 아니다(D-52, D-109). 요청 기록에 쌓기 → 사용자가 보낸 요청이 아니다.

## D-83 위치 권한이 이미 허용이면 화면을 열 때 위치를 받는다
- Status: settled
- Decision: D-52에 더한다. 앱을 열 때의 위치 결정은 페이지 세션에 하나인 `initialLocation()`이 맡고, 다시 들어온 화면은 같은 결과를 기다린다. `navigator.permissions.query({ name: "geolocation" })`의 결과가 `granted`이면 묻지 않고 위치를 받는다. 결과는 `located(here)`, `denied`, `failed`(허용했는데 위치를 못 얻음), `unavailable`(`prompt`이거나 Permissions API가 없거나 실패해 요청하지 않음)이다. 권한을 묻는 때는 "내 위치" 버튼뿐이다. 위치를 얻어도 지도를 옮기는 것은 D-108의 처음 이동과 버튼뿐이다. 위치가 없으면 주변 카드를 포함해 어디서나 거리를 숨긴다(D-52). 처음 조회가 `denied`이면 "위치 권한이 꺼져 있어요. 브라우저 설정에서 허용해 주세요"를, `failed`이면 "위치를 확인할 수 없어요"를 페이지 세션에 한 번 알린다(알림 규칙은 D-108). `mapBounds` 규칙은 D-52 그대로다. 첫 화면의 "내 위치" 버튼은 주변 카드 바로 위 오른쪽(카드가 없으면 검색창 위 오른쪽)에 둔다.
- Rejected: 첫 진입 때 바로 권한 묻기 → D-52가 버튼 방식을 택했다. 위치가 없을 때 역삼역 기준으로 카드를 거르고 "역삼역 350m"를 보이기(옛 결정, 와이어프레임 `StartNoLoc`) → 홈 카드는 지도 영역이 정하고 거리는 기기 위치가 있을 때만 표시한다(D-111). 화면을 열 때 한 번만 확인하는 `locateIfGranted`(`openLocationChecked`) → 조회가 끝나기 전에 다시 부르면 기다리지 않고 `skipped`를 돌려줘 "권한 미결정"과 "이미 확인함"을 구별하지 못하고 조회가 둘이 된다.

## D-84 최근 검색은 기기에 문장만 저장한다
- Status: superseded by D-91
- Decision: 첫 화면 검색창과 후속 입력창의 최근 검색 버튼은 "최근 검색" 시트를 연다.

## D-85 지도 위 "저장한 장소"와 "내 정보" 버튼은 준비 중 토스트를 띄운다
- Status: settled
- Decision: 첫 화면과 결과 화면의 지도 오른쪽 위에 "저장한 장소"(북마크 아이콘)와 "내 정보"(사람 아이콘) `Fab`을 세로로 둔다. 연결할 화면이 아직 없으므로 누르면 "준비 중이에요" 토스트를 띄운다. 저장 화면과 내 정보 화면이 생기면 그 화면으로 이동하도록 바꾼다(바뀌었다: "저장한 장소"는 bookmark의 저장한 장소 화면, "내 정보"는 `/my`). 결과 패널이 전체 상태면 패널에 가려 보이지 않는다. 공유 버튼은 그리지 않는다.
- Rejected: 눌러도 아무 일이 없는 버튼 → 사용자가 고장으로 여기고, 화면 낭독기가 반응 없는 버튼을 읽는다. 아직 없는 경로로 이동 → 404가 나고 로그인 담당(S15P31A302-38)과 경로를 정하지 않았다.

## D-86 장소 상세는 리뷰 자리 세 곳을 연다
- Status: settled
- Decision: D-49가 그리지 않기로 한 리뷰 탭(6-03), 홈 탭의 리뷰 미리보기(6-01), 하단의 "방문 평가 남기기"는 리뷰 담당이 붙인다(review spec D-32). `PlaceDetailScreen`은 렌더 함수 props `slots`(`homeReviews`, `reviewTab`, `bottomAction`)를 받는다. `reviewTab`이 있으면 탭은 홈, 메뉴, 리뷰, 정보 순서다. `homeReviews`는 홈 탭 맨 아래에 그리며 리뷰 탭으로 바꾸는 함수를 받는다. `bottomAction`은 하단 막대(`BottomBar`)에 그린다. 자리를 받지 않으면 홈, 메뉴, 정보 탭만 있고 하단 막대가 없다. 자리는 `src/app/place/place-detail-with-reviews.tsx`가 채우며, 장소 도메인은 리뷰 도메인을 import하지 않는다(D-66).
- Rejected: 장소 상세가 리뷰 컴포넌트를 직접 import → ESLint 의존 방향 규칙에 걸린다(D-66).

## D-87 자동완성 후보는 "이 조건으로 추천받기"를 늘 맨 위에 둔다
- Status: settled
- Decision: 와이어프레임 `Typing`을 따른다. FE는 응답의 `ACTION` 항목을 응답 안 위치와 상관없이 후보 상자 맨 위에 두고, 나머지 `PLACE` 항목은 응답 순서 그대로 그 아래에 둔다. BE의 순서 규칙(spec 20번, AC-1)은 바꾸지 않는다. `ACTION` 줄은 강조 배경, 원 안의 반짝이 아이콘, 오른쪽 › 표시이고, `PLACE` 줄은 원 안의 핀 아이콘이다. 검색창에 초점이 있고 공백을 뺀 입력이 있어 후보가 보이는 동안 지도 위에 어두운 막을 깔아 주변 카드와 지도 버튼을 가리고, 막을 누르면 검색창 초점을 풀어 후보를 닫는다(입력은 남는다). 검색창은 초점이 있으면 테두리를 강조하고, 입력이 있으면 최근 검색 버튼 대신 입력 지우기(✕) 버튼을 둔다. 지우기는 입력을 비우고 초점을 검색창에 둔다.
- Rejected: BE가 `ACTION`을 늘 맨 위에 두도록 바꾸기 → 화면 배치 규칙이라 FE에서 정하면 된다. 엔진 계약(AC-1)을 다시 바꿀 이유가 없다.

## D-88 검색 중에는 단계 문구를 차례로 보인다
- Status: settled
- Decision: 와이어프레임 `Loading`을 따른다. 첫 페이지를 받는 동안 결과 패널은 입력 문장 아래에 깜빡이는 점과 "요청을 이해하는 중", "주변 장소를 찾는 중", "취향과 맞춰 보는 중"을 1.5초마다 차례로(끝나면 처음부터) 보인다. 실제 진행 단계가 아니라 기다리는 동안의 안내다. 동작 줄이기 설정이면 문구만 바뀌고 움직임은 없다. 그동안 후속 입력창은 흐리게 비활성이고 최근 검색 버튼을 숨긴다. 빈 카드 자리표시는 그대로다.
- Rejected: 서버가 단계를 알려 주기 → 검색 API는 한 번에 응답하고 AI 파트 계약이 정해지지 않았다.

## D-89 요청 기록은 결과 패널 안에서 펼친다
- Status: settled
- Decision: 와이어프레임 `RequestHistory`를 따라 D-71의 요청 기록 시트(`BottomSheet`)를 결과 패널의 세 번째 상태로 바꾼다. 패널 머리글의 "요청 기록 ⌄"를 누르면 패널이 지도 위 버튼 아래까지 펼쳐지며 결과 목록 자리에 요청 기록 타임라인이 보이고("요청 기록 ⌃"), 다시 누르면 펼치기 전 상태로 돌아간다. 패널 아래 후속 입력창과 "새 검색"은 그대로 있다. 타임라인의 줄(문장, 업종과 곳 수와 시각, 이어 검색 표시, "보는 중")은 D-50, D-74, D-76대로다. 지금 보는 요청이 아닌 줄에는 "결과 보기"(D-90의 과거 결과 화면)와 "여기서 이어 검색"(그 요청을 지금 보는 요청으로 바꾸고 패널을 결과 목록으로 되돌린 뒤 후속 입력창에 초점)이 있다.
- Rejected: 모달 시트 유지 → 와이어프레임은 후속 입력창을 가리지 않는 펼침이다.

## D-90 과거 결과는 그때의 스냅샷을 따로 보여 준다
- Status: settled
- Decision: 와이어프레임 `PastResult`를 따른다. 요청 기록(지금 thread, D-91)에서 지금 보는 요청이 아닌 줄의 "결과 보기"는 지금 보는 요청을 바꾸지 않고 과거 결과 화면을 연다. 과거 결과는 그때 받은 결과를 다시 받지 않고 그대로 보인다. 이번 페이지 세션에 받은 요청은 캐시에 받아 둔 페이지(다음 페이지를 더 부르지 않는다), 기기에서 다시 연 thread의 요청은 저장한 첫 페이지다. 영업 상태도 그때 값이다(D-79). 화면은 왼쪽 위 "‹ 현재 검색으로", 패널 위쪽 "🕑 <시각> 결과 · “<문장>”"(시각은 최근 검색과 같은 "오늘 오후 2:10", "10월 14일"), 카드 목록과 지도 핀, 패널 아래 "이 조건으로 다시 검색" 버튼과 "새 결과는 기록 끝에 추가되고, 이 결과는 그대로 남아요."다. 패널 머리글(요청 기록, 새 검색), 후속 입력창, "이 지역에서 검색"은 없다. 카드와 핀은 D-70대로 동작하고 상세 화면은 이 스냅샷의 카드를 쓴다. "현재 검색으로"는 요청 기록을 펼친 결과 패널로 돌아간다. "이 조건으로 다시 검색"은 그 요청의 첫 페이지 요청 본문을 그대로(같은 종류와 기준 요청으로, 다시 연 기록은 D-109대로 만든 실행 요청) 다시 보내고, 성공하면 새 요청이 지금 thread 끝에 쌓여 지금 보는 요청이 되며 과거 결과 화면은 닫힌다. 원래 요청과 그 결과는 그대로 남는다. 상세에 갔다가 돌아오면 과거 결과 화면이 그대로 있다.
- Rejected: 과거 결과를 지금 기준으로 다시 검색해 보여 주기 → 사용자가 그때의 스냅샷이어야 한다고 정했다. "결과 보기"가 지금 보는 요청을 바꾸기(처음 spec) → 와이어프레임은 현재 검색과 과거 결과를 나누고 돌아가는 버튼을 둔다.

## D-91 검색은 thread로 묶고, 최근 검색은 thread 목록이다
- Status: settled
- Decision: D-84를 바꾼다. LLM 대화처럼, 새 검색 하나가 thread 하나를 시작하고 그 뒤의 후속 조건, "이 지역에서 검색", "이 조건으로 다시 검색"은 같은 thread에 요청으로 쌓인다. 패널의 "새 검색"은 지금 thread를 닫고 다음 새 검색이 새 thread를 연다. 요청 기록(D-89)은 지금 thread의 요청만 보인다. 요청마다 쌓인 조건은 D-50대로 `previousConditions`로 이어진다("이 지역에서 검색"은 D-109대로 `conditions`). thread는 첫 페이지 응답을 받을 때마다 `localStorage`에 저장해 재로드와 다음 접속 뒤에도 남는다. 요청마다 문장, 시각, 종류, 기준 요청, 첫 페이지 요청 본문, 첫 페이지 응답(커서 없이)을 저장한다. 개수 제한과 지우기 규칙은 두지 않는다(Mock 데모용 임시 저장이고 나중에 서버 저장으로 바뀐다). 저장에 실패하거나 저장된 값의 형식이 틀리면 그 thread는 저장되지 않거나 버려지고 화면과 검색은 그대로 동작한다. 기기 밖으로는 보내지 않는다. 최근 검색 시트(첫 화면 검색창과 후속 입력창의 기록 버튼)는 thread 목록이다. 줄은 thread의 첫 문장과 마지막 요청 시각이고 마지막 요청 시각 최신순이며, 지금 thread에는 "보는 중"을 붙인다. 줄을 누르면 시트를 닫고 그 thread로 바꾼다. 그 thread의 마지막 요청이 지금 보는 요청이 되어 일반 결과 화면에 네트워크 요청 없이 그때 결과로 보이고(다시 연 thread의 결과는 저장한 첫 페이지뿐이고 다음 페이지를 부르지 않는다), 요청 기록에는 그 thread의 요청들이 보이며, 후속 조건으로 이어서 검색할 수 있다. 목록이 비면 D-84의 빈 안내를 보인다. 재로드하면 첫 화면에서 시작하고 지금 thread는 없다. 저장소는 `ui`의 한 모듈(목록 읽기, thread 하나 읽기, thread 저장)로만 읽고 써서, 나중에 서버 저장(thread 목록은 cursor paging, thread는 하나씩 받기)으로 그 모듈만 바꾼다. thread의 모양, 요청 더하기, 목록 정렬, 형식 검사, 시각 문구는 `model`의 순수 함수다. 이 결정으로 D-50, D-67의 "요청 기록은 메모리에만"과 D-27의 요청 기록 보관 방식이 정해진다. 이후 search-thread(S15P31A302-116)가 회원의 thread를 서버에 저장하게 했고, 비회원은 지금처럼 기기에 저장한다.
- Rejected: 문장만 저장하고 누르면 새 검색(D-84) → 사용자가 최근 검색은 thread를 고르는 창이고 누르면 그 thread가 열려야 한다고 정했다. 새 검색 하나씩을 따로 저장 → 후속 조건이 빠져 대화가 끊긴다. 용량이 차면 오래된 thread부터 지우기 → Mock 데모의 임시 저장이라 서버 저장이 생기면 필요 없는 코드다. 같은 문장 합치기 → thread마다 결과가 다르다. 결과 패널에만 요청 기록 버튼 두기 → "새 검색" 뒤에는 남아 있는 기록을 열 방법이 없다. 첫 화면 검색창의 요청 기록 버튼(D-78) → 와이어프레임은 그 자리에 최근 검색을 둔다. 이번 세션의 요청 기록을 그대로 열기 → 재로드하면 사라져 지난날 검색을 볼 수 없다. 지난 결과까지 저장해 다시 보기(5-08, `PastResult`) → 결과 보관 방식(D-27)과 서버 저장이 정해지지 않았다.

## D-92 장소 상세의 위쪽 영역과 홈·메뉴·정보 탭은 와이어프레임을 따른다
- Status: settled
- Decision: 와이어프레임 `Detail`, `DetailMenu`, `DetailInfo`를 따른다. 위쪽 상단 막대를 없애고 사진(없으면 자리표시)을 화면 폭 가득 크게 보이며 아래쪽은 바탕색으로 흐려진다. 사진 위 왼쪽에 "뒤로"(`Fab`), 오른쪽에 "공유"(`Fab`, D-94)를 띄우고 사진이 둘 이상이면 넘김 점(`CarouselDots`)을 둔다. 업종 · 거리, 이름, 핏 점수, 영업 상태와 오늘 안내, 상세 `tags`는 흐려진 사진 위 바탕에 둔다. 핏 점수는 "84 핏 점수 ⓘ" 전체가 하나의 버튼이고 ⓘ 시트를 연다. 탭은 위쪽에 붙는다. 홈 탭의 섹션(추천 이유와 주의, 장소 정보, 메뉴, 리뷰 자리)은 두꺼운 띠로 나눈다. 추천 이유 아래에 주의점을 주의 안내로 보인다. 근거 부족 안내는 D-105대로 보이지 않는다. 장소 정보의 영업시간 줄은 "<영업 상태> · 오늘 08:00 – 22:00"이고 펼치면 정보 탭과 같은 요일별 표다. 전화 줄은 ›, 웹사이트 줄은 바깥 링크 아이콘을 붙이고, "정보 더보기 ›"는 가운데 둥근 테두리 버튼이다. 메뉴 섹션 머리글은 "메뉴 <개수> ›" 링크로 메뉴 탭을 연다. 메뉴 탭은 카테고리 이름을 작은 흐린 글씨로, 줄마다 64px 사진, 굵은 이름, 오른쪽 가격을 두고 줄 사이를 선으로 나눈다. 정보 탭 영업시간은 위에 "<영업 상태> · <오늘 안내>"를 두고, 요일별 표에서 오늘 줄은 "<요일> · 오늘"로 굵게, 브레이크타임은 "15:00 – 16:00 브레이크타임", 라스트오더는 "14:30, 21:30 라스트오더" 줄로, 휴무일은 "휴무"로 쓴다. 시각 범위는 "08:00 – 22:00"(앞뒤 공백이 있는 – )로 쓴다. 주소 줄에는 복사 버튼(누르면 주소를 클립보드에 넣고 "주소를 복사했어요"를 알림, 실패하면 "주소를 복사하지 못했어요")을 두고, 시설은 아이콘이 붙은 테두리 칩(무선 인터넷, 단체 이용, 예약에 아이콘, 주차는 글자만)이며 맨 아래에 "정보가 실제와 다를 수 있어요"를 둔다. 하단 막대는 저장(북마크) 버튼(D-94)과 리뷰 자리의 `bottomAction`을 나란히 둔다. 상세 `tags`의 강조 색은 근거가 없어 쓰지 않는다. 리뷰 자리 안의 모양(머리글, 리뷰 항목)은 리뷰 담당의 것이라 바꾸지 않는다.
- Rejected: 지금 모양 유지(상단 막대, 240px 사진, 흰 정보 영역) → 와이어프레임과 다르다. 상세 태그 앞 두 개를 강조 → 카드 라벨과 상세 태그는 다른 값이라 고를 근거가 없다.

## D-93 정보 탭의 위치에는 장소 핀 하나만 있는 지도를 둔다
- Status: settled
- Decision: D-49가 그리지 않기로 한 정보 탭의 위치 지도를 그린다. 주소 줄 아래에 높이를 CSS로 정한 작은 `PlaceMap`을 두고 장소 핀 하나만 찍으며 중심은 그 장소다. 지도 사용량은 지도를 만들 때마다 집계되므로 정보 탭을 열었을 때만 만들고, 지도 키가 없거나 인증이 실패하면 지도 자리를 그리지 않는다(D-70의 실패 처리와 같다). 내 위치 점과 "이 지역에서 검색"은 없다.
- Rejected: 지도를 그리지 않기(D-49) → 사용자가 와이어프레임대로 그리기로 했다. 정적 지도 이미지 API → 다른 API와 키 설정이 늘어난다.

## D-94 장소 상세의 공유와 저장 버튼은 준비 중 토스트를 띄운다
- Status: settled
- Decision: D-85와 같은 방식으로, 상세 사진 위 오른쪽의 "공유"와 하단 막대의 "저장"(북마크 테두리 버튼)을 그리고 누르면 "준비 중이에요" 토스트를 띄운다. 기능이 생기면 동작만 바꾼다("저장"은 bookmark의 북마크 버튼으로 바뀌었고 "공유"는 아직 토스트다). D-85의 "공유 버튼은 그리지 않는다"는 이 결정으로 바뀐다.
- Rejected: 그리지 않기 → 와이어프레임에 있고, 사용자가 D-85와 같이 두기로 했다.

## D-95 FE는 `?mock=empty`를 읽지 않고 `X-Mock-Scenario`를 보내지 않는다
- Status: settled
- Decision: D-63 가운데 "FE는 주소창의 `?mock=empty`를 읽어 이 헤더를 붙인다"만 이 결정으로 바뀐다. `place-api.ts`는 검색 요청에 `X-Mock-Scenario`를 붙이지 않고, 결과 없음 화면은 FE 테스트가 가짜 응답으로 확인한다. BE Mock은 그대로 헤더를 읽으므로 BE 테스트와 직접 호출(curl 등)로는 `empty` 시나리오를 계속 쓴다. 배포 번들에 개발용 mock 스위치가 들어가 인프라의 번들 검사(`mock-words`)가 WARN을 내기 때문이다(`docs/infra/plans/2026-10-23-plan-1c3-ci-pipeline.md` FE 체크리스트 4).
- Rejected: `/config.json`의 `env`가 dev일 때만 헤더 붙이기 → 코드가 번들에 남아 WARN이 그대로이고, 런타임 설정을 기다리는 분기가 검색 요청에 생긴다.

## D-96 장소 상세를 전체 화면 Visual QA(2026-10-29)의 시안 보정대로 맞춘다
- Status: settled
- Decision: D-92 가운데 "상세 `tags`의 강조 색은 쓰지 않는다"와 "휴무일은 '휴무'로 쓴다"만 이 결정으로 바뀐다. 상세 `tags`는 그 장소의 검색 카드(D-86) `reasons`에 출처가 PREFERENCE인 근거 칩과 문구가 같으면 주황(`Tag` match), 그 밖(REQUEST 근거와 같거나, 카드가 없거나, `from=saved`)은 회색이다(VQA D-12). 추천 이유 인용은 주황 선과 진한 본문으로 그린다(VQA D-13). 탭 바로 아래 첫 섹션에는 두꺼운 띠가 없다. 홈 탭 메뉴 미리보기는 `representative` 메뉴를 먼저, 나머지를 원래 순서로 채워 6개까지 보인다. 웹사이트 줄은 주소의 도메인만 글자로 보이고 링크는 원래 주소다. 요일별 표의 휴무 요일은 "정기휴무 (매주 <요일>요일)"로 쓰고 `closedDayNote`를 표 아래 따로 적지 않는다. 휴무 요일은 BE가 정기휴무만 `closed: true`로 보내고 날짜가 붙은 휴무는 정보 없음으로 보내므로(place-catalog AC-14) 모두 정기휴무다.
- Rejected: 태그 자체의 긍정·부정으로 색 나누기 → 상세 태그는 긍정이 다수인 특징만 들어와 모두 주황이 된다. 서버가 태그마다 일치 여부를 보내기 → API 계약 변경이라 이번 보정 범위를 넘는다. 상세 태그를 정하지 못한 지금은 실제 BE가 `tags`를 빈 목록으로 보내므로 이 색은 Mock에서만 보인다.

## D-97 결과 패널 제목은 첫 요청 문장이고 후속 입력은 칩으로만 보인다
- Status: settled
- Decision: 결과 패널 제목은 지금 보는 요청에서 기준 요청을 따라 거슬러 올라간 새 검색의 문장이다. 후속 입력은 28번의 "추가 조건 · <입력>" 칩으로만 보이고 제목이 되지 않는다. 검색 중과 실패에도 보낸 요청의 기준 요청에서 같은 제목을 찾고, 새 검색이면 보낸 문장이다. 전체 화면 VQA(2026-10-29) 결정 D-9다.
- Rejected: 후속 입력을 제목으로 쓰기 → 제목과 칩에 같은 말이 두 번 나온다(5-06).

## D-98 전체 패널의 "지도 보기"와 과거 결과 화면의 지도 위 버튼은 두지 않는다
- Status: settled
- Decision: 시안(5-05, 5-08)대로 전체 상태 결과 패널의 "지도 보기" 버튼을 없앤다. 중간 상태로는 손잡이로 돌아간다. 과거 결과 화면에는 지도 위 "저장한 장소"와 "내 정보" 버튼을 두지 않고 "현재 검색으로"와 "내 위치"만 둔다. 패널 아래 "새 결과는 기록 끝에 추가되고, 이 결과는 그대로 남아요." 안내도 없애고 "이 조건으로 다시 검색" 버튼만 둔다(시안도 같이 고쳤다). D-90의 안내 문구는 이 결정으로 바뀐다. 전체 화면 VQA(2026-10-29) 결정 D-11이다.
- Rejected: spec대로 유지 → 시안에 없고, 사용자가 시안을 따르기로 했다.

## D-99 조건이 좁아 결과가 없으면 다시 찾기 버튼 없이 안내만 가운데에 둔다
- Status: settled
- Decision: `emptyReason`이 있는 결과 없음(5-E06)은 원인과 제안 문구만 보이고 다시 찾기 버튼은 두지 않는다. 안내는 제목 아래 남은 자리의 가운데에 두고, 패널 높이는 다른 결과 화면과 같다. 시안도 버튼을 빼고 같은 높이·위치로 고쳤다. 전체 화면 VQA(2026-10-29) 결정 D-10의 ②안이다.
- Rejected: 뺄 조건을 API에 더해 버튼 만들기(①안) → `emptyReason`은 문장 두 개뿐이고 `conditions`는 FE에 불투명해 AI·BE·FE 계약을 바꿔야 한다. 시안처럼 패널을 30px 높이기 → 버튼이 없으면 필요 없다.

## D-100 "내 위치" 버튼은 위치를 찾아 지도를 옮기는 동안 파란색이다
- Status: settled
- Decision: D-52에 더한다. "내 위치"를 누르면 아이콘이 지도의 내 위치 점과 같은 파란색(`--color-location`)이 되고, 지도가 받은 위치로 이동을 마치면(이동과 확대·축소(D-104) 뒤 지도의 `idle` 이벤트, 지도가 이미 그 위치와 확대 정도라 움직이지 않으면 바로), 위치를 얻지 못하면, 다른 화면으로 가거나 지도가 새로 만들어지면 원래 색으로 돌아온다. 파란색인 동안 다시 누르면 무시한다. 어떤 경우에도 파란색이 남아 있지 않는다. 버튼이 있는 첫 화면, 결과, 과거 결과, 저장한 장소 화면이 모두 같다. 실기기 피드백(2026-11-03)이다.
- Rejected: 사용자가 지도를 끌 때까지 파란색 유지(따라가기) → 피드백은 이동을 마치면 꺼지는 쪽이다. 찾는 중에 다시 누르면 처음부터 다시 찾기 → 요청이 겹쳐 지도가 두 번 움직이거나 파란색이 일찍 꺼진다.

## D-101 5분 안에 얻은 기기 위치는 다시 쓴다
- Status: settled
- Decision: D-52에 더한다. 위치를 요청할 때 브라우저가 5분 안에 얻은 위치가 있으면 새로 찾지 않고 그 위치를 쓴다(`getCurrentPosition`의 `maximumAge: 300000`). "내 위치" 버튼과 앱을 열 때(D-83)가 같다. 이 옵션은 브라우저가 위치를 들고 있을 때만 효과가 있다. 처음 찾는 위치는 브라우저와 기기가 정하는 시간이 걸린다. 버튼으로 찾을 때는 D-100의 파란색이 찾는 중임을 알리고, 앱을 열 때는 버튼 색이 바뀌지 않는다(그 조회가 진행 중일 때 버튼을 누르면 그 순간부터 파란색이다).
- Rejected: 버튼에만 적용 → 나눌 이유가 없고 코드만 늘어난다. 30초(처음 값) → 5분 안에 앱을 다시 열거나 새로고침해도 위치를 새로 찾아 처음 홈 요청이 길게 기다린다(D-108, 2026-11-10 사용자 결정). 5분보다 길게 → 장소를 옮긴 뒤(집 → 회사) 이전 위치로 홈 카드를 받을 수 있다.

## D-102 다른 화면에 다녀와도 검색 화면은 떠나기 전 그대로다
- Status: settled
- Decision: D-27에 더한다. 앱 안에서 상세, 내 정보 같은 다른 화면에 갔다가 돌아오면 첫 화면 주변 카드 목록은 미끄러지지 않고 떠나기 전 선택된 카드 자리에 바로 놓이며, 지도는 떠나기 전 중심과 확대 정도로 보인다. 지도는 검색 화면의 지도(첫 화면, 결과, 과거 결과, 저장한 장소)만 해당하고, 상세 정보 탭의 위치 지도는 D-93대로 그 장소가 중심이다. 돌아와도 선택된 장소는 바뀌지 않아 순위 배지, 핀, 카드 목록이 같은 장소를 가리킨다. 지도를 되살리는 일(확대 정도 포함)로 "이 지역에서 검색" 버튼이 새로 나타나지 않고, 떠나기 전 보이던 버튼은 그대로 보인다. 새로고침과 PWA 재로드는 D-27대로 정해지지 않았고 이 결정에 들지 않는다. Next의 `cacheComponents`는 떠난 화면을 숨겨 보관했다가 다시 보일 때 Effect를 다시 실행하므로, 카드 목록과 지도가 새로 만들어져도 이 상태를 지켜야 한다. 실기기 피드백(2026-11-03)이다.
- Rejected: 돌아오면 지도를 선택된 카드 위치로 옮기기 → 사용자가 손으로 옮겨 보던 곳을 잃는다. 선택된 카드를 URL에 담기 → 화면은 이미 선택을 기억하고 있어 미끄러짐을 고치지 못하고, 넘길 때마다 주소가 바뀐다.

## D-103 휴대폰 폭에서 주변 카드는 검색창과 같은 폭으로 가운데에 놓인다
- Status: settled
- Decision: D-82에 더한다. 화면 폭이 640px 미만이면 선택된 카드는 검색창과 같은 폭(화면 좌우 16px 여백)으로 가운데에 놓이고, 양옆 카드는 카드 사이 8px 간격 너머로 조금 보인다. 640px 이상이면 카드 폭은 320px이고 선택된 카드는 목록의 왼쪽 첫 자리에 놓인다. 실기기 피드백(2026-11-03)이다.
- Rejected: 모든 폭에서 검색창과 같은 폭 → 넓은 화면에서 카드가 지나치게 넓어진다.

## D-104 "내 위치" 버튼은 지도를 내 위치로 옮기며 확대 정도를 15로 맞춘다
- Status: settled
- Decision: D-100에 더한다. "내 위치"를 눌러 얻은 위치로 지도를 옮길 때 확대 정도를 첫 화면과 같은 15로 맞춘다. 더 축소돼 있으면 확대하고 더 확대돼 있으면 축소하며, 이동과 확대·축소를 한 번의 부드러운 움직임(네이버 지도 `morph`)으로 한다. 지도가 이미 그 위치이고 확대 정도도 15면 움직이지 않는다. 앱을 열 때의 처음 이동(D-83, D-108)과 카드나 핀을 눌러 장소로 옮길 때는 확대 정도를 바꾸지 않는다. 이 확대·축소로는 결과 화면의 "이 지역에서 검색" 버튼이 나타나지 않는다(홈에는 버튼이 없다, D-111). 실기기 피드백(2026-11-03)이다.
- Rejected: 기준보다 축소돼 있을 때만 확대하고 더 확대돼 있으면 그대로 → 크게 확대해 둔 상태에서 누르면 주변이 보이지 않는다. 기준 16~17(네이버·카카오 지도의 내 위치 수준) → 주변 카드 핀 일부가 화면 밖으로 나가고 첫 화면과 달라진다. 열 때와 근처 응답 뒤에도 15로 맞추기 → 사용자가 일부러 축소해 둔 지도를 코드가 바꾼다.

## D-105 장소 상세 홈 탭은 근거 부족 안내를 보이지 않는다
- Status: provisional
- Decision: D-92에 더한다. 홈 탭은 좋은 이유(`reasons`)와 주의점만 보이고, `scoreItems` 중 `matched: false`인 항목의 "이 장소는 ‘<label>’ 취향을 확인할 근거가 부족해요" 안내는 보이지 않는다. 취향을 많이 저장한 사용자일수록 안내가 길게 늘어나 추천 이유가 묻혔다. AI와 BE는 `scoreItems`를 그대로 보내고, FE는 안내를 그리는 코드를 지우지 않고 주석으로 남긴다.
- Default: 안내를 숨긴다. 근거 부족 내용을 ⓘ 시트(spec 46번)나 묶은 한 줄로 다시 보이기로 정하면 다시 연다.
- Rejected: AI가 `matched: false` 항목을 빼고 보내기 → ⓘ 시트가 쓸 점수 항목까지 사라진다. 안내를 한 줄로 묶기 → 이번에는 좋은 말만 보이기로 했다.

## D-106 장소 상세는 `/places/<id>` 경로이고 서버에서 그린다
- Status: settled
- Decision: D-38의 장소 상세 주소(`/place?id=`)와 "데이터는 브라우저 `fetch`" 중 상세 부분을 바꾼다(S15P31A302-163). 상세는 `/places/<id>`, 리뷰 작성은 `/places/<id>/review`, 리뷰 수정은 `/places/<id>/reviews/<reviewId>/edit`이다. 저장한 장소에서 연 상세의 `from=saved`(D-12)는 화면 상태라 쿼리로 남긴다. 상세 페이지는 서버에서 `BE_INTERNAL_URL`로 상세를 3초 제한으로 읽어 TanStack Query 캐시에 넣고 그린다. 그래서 JS를 끈 사용자와 JS를 실행하지 않는 크롤러도 본문을 읽는다. 주소의 id가 잘못됐거나 BE가 ProblemDetail로 404를 주면 `notFound()`로 경로별 `not-found.tsx`(장소, 리뷰, 그 밖의 주소)를 그린다. 본문 없는 404(dev 엣지 게이트 등 BE 앞단)와 그 밖의 실패는 상세 없이 그려 브라우저가 다시 받는다. 서버가 넣은 상세는 60초 동안 브라우저가 다시 받지 않는다(`staleTime`). robots의 리뷰 화면 차단은 `/places/*/review`로 옮긴다. 리뷰 작성·수정 화면은 로그인이 필요해 서버는 주소의 id만 검사하고 데이터는 계속 브라우저에서 받는다. 예상하지 못한 렌더 예외는 `error.tsx`, 루트 레이아웃의 예외는 `global-error.tsx`가 "문제가 생겼어요"와 "다시 시도"·"처음으로"로 받는다. 옛 주소(`/place?id=`)는 옮기지 않고 "페이지를 찾을 수 없어요"가 된다. 아직 사용자에게 공개하기 전이라 남은 링크가 없다. 장소 경로는 정적 껍데기를 먼저 보내는 부분 사전 렌더링(◐)이라 `notFound()`가 응답을 시작한 뒤에 정해진다. 그래서 없는 장소와 잘못된 id는 404가 아니라 200과 `noindex`이고, not-found 화면은 JS가 있어야 보인다. 맞는 경로가 없는 주소는 404다.
- Rejected: 옛 주소를 301로 옮기기 → 공개 전이라 옮길 링크가 없다. 리뷰 화면 주소는 그대로 두기 → 장소 주소와 체계가 어긋난다. Proxy에서 id를 검사해 404 내기 → 없는 장소는 BE를 불러야 알 수 있어 Proxy에서 상세를 읽게 된다(Next 문서가 피하라는 방식).

## D-107 장소 상세는 장소마다 메타데이터와 구조화 데이터를 싣고 장소 sitemap을 낸다
- Status: settled
- Decision: D-106에 더한다(S15P31A302-145). 상세 페이지의 `generateMetadata`는 페이지와 같은 `loadPlace` 결과(React `cache`라 BE는 한 번)로 제목(장소명, 레이아웃 템플릿 "%s | 핏다이닝"), 설명(장소 소개, 없으면 "<업종> · <주소>"), canonical(`from` 없는 `/places/<id>`), Open Graph(사이트 공통 값 + 첫 사진, 사진이 없으면 사이트 공유 이미지)를 정한다. 본문 앞에 schema.org 구조화 데이터(JSON-LD)를 싣는다. 타입은 식당 `Restaurant`, 카페 `CafeOrCoffeeShop`, 술집 `BarOrPub`이고 이름, 상세 주소, 사진(절대 주소), 주소, 좌표, 전화, 영업시간(브레이크타임으로 나눈 구간, 휴무·정보 없는 요일은 뺀다, `00:00`–`00:00`은 `00:00`–`23:59`)을 담는다. `<`는 `<`로 바꿔 script를 닫지 못하게 한다. 잘못된 id·없는 장소·BE 실패면 메타데이터를 정하지 않는다(없는 장소는 `notFound()`가 noindex를 붙인다). `/places/sitemap.xml`은 요청마다 `GET /api/v1/places/ids`(인증 없음, 열 수 있는 장소 id 오름차순)를 읽어 상세 주소를 싣고, robots.txt에 올린다. `lastModified`는 싣지 않는다. `places.updated_at`은 재수집 때마다 바뀌어 실제 변경 시각이 아니다. 페이지가 `openGraph`를 정하면 레이아웃 값을 통째로 바꾸므로(얕은 병합) 사이트 공통 값(`siteUrl`, `siteOpenGraph`)은 `app/site.ts`에 둔다.
- Rejected: 빌드 때 sitemap 만들기 → 빌드 환경에 BE가 없고 장소는 배포 없이 는다. 장소마다 공유 이미지를 따로 그리기(`opengraph-image`) → 첫 사진으로 충분하다. `lastModified`에 `updated_at` 싣기 → 위와 같이 실제 변경 시각이 아니다.

## D-108 지도는 저장된 화면에서 시작하고 처음 위치는 지도를 한 번만 옮긴다
- Status: settled
- Decision: S15P31A302-202. 지도 화면 `{lat, lng, zoom}`을 기기 `localStorage`에 `idle`마다(지도를 만든 뒤 처음 `idle`은 제외) 저장해 다음 시작 화면으로 쓰고, 저장값이 없으면 `DEFAULT_VIEW`(SSAFY 서울캠퍼스)다. 지도를 옮기는 명령은 앱을 연 뒤 처음 위치(한 번, `initialView`로 관리)와 "내 위치" 버튼뿐이고, `here` 감시 effect와 근처 응답 뒤 자동 위치 요청은 없앤다. "내 위치" 버튼은 처음 이동이 남아 있으면(`pending`, `applying`) 그것을 가져가고, 이동이 끝난(실패 포함) 뒤에 `done`으로 만든다. 버튼이 가진 동안 처음 조회의 결과와 처음 `panTo`의 끝은 `done`으로 만들지 않는다. 처음 홈 요청은 위치 결정과 처음 이동이 끝난 뒤 한 번 보낸다(D-111). 상세 규칙은 spec.md 61~63번이다.
- Rejected: 처음 홈 요청에 짧은 대기 상한을 두고 늦은 위치는 지도만 옮기는 안(design.md 6-3 "실측 필요") → 실측 값 없이 정할 수 없다. 기기 위치를 `localStorage`에 따로 저장 → 지도 화면 저장과 겹치고 위치를 디스크에 남긴다. 위치를 기다리는 동안 사용자가 끌어도 처음 이동 유지 → 사용자가 보던 곳을 잃는다. `here` 감시 effect 유지 → 화면이 다시 마운트되거나 상세에서 돌아와 effect가 다시 돌면 선릉으로 끌어 둔 지도가 내 위치로 튄다. 지도 실패로 `done`이 돼도 처음 조회를 건너뛰기 → 지도 키가 없거나 인증이 실패하면 권한이 허용이어도 위치를 받지 못해 주변 카드가 역삼역 기준으로 남는다(2026-11-10 리뷰). 새 조회를 건너뛰는 것은 버튼이 대신했거나 사용자가 지도를 움직였을 때뿐이다. 버튼을 누르는 즉시 처음 이동을 `done`으로 만들기 → 처음 홈 요청이 버튼 이동이 끝나기 전 화면으로 나간다(D-111).

## D-109 검색 요청은 보이는 지도 영역을 담고 "이 지역에서 검색"은 region API로 보낸다
- Status: settled
- Decision: S15P31A302-203. 새 검색은 지금 지도에서 사용자에게 보이는 영역을, 후속 검색은 기준 항목 실행 요청의 `mapBounds`를 담는다(없거나 기준이 실행 불가 region 기록이면 담지 않는다). 보이는 영역은 지도에서 위쪽 safe-area와 아래쪽 UI(결과 패널, 홈 카드·검색창)가 실제로 겹친 높이를 빼고 SDK의 화면 좌표→위경도 변환으로 구하며, 키보드와 자동완성 막은 빼지 않는다. 보이는 높이가 지도의 1/4(임시값) 미만이거나 변환이 실패하면 `getBounds()` 전체, 지도가 없으면 bounds 없이 보낸다. "이 지역에서 검색"은 `POST /api/v1/places/search/region`에 보던 항목의 문장과 `conditions`, 보이는 영역을 보낸다. API는 기록의 종류로 고르고 다음 페이지, 다시 검색, 실패 재시도도 같은 API다. 지역 고정 상태와 위치 실패 뒤 bounds 자동 포함은 없앤다. 저장된 기록은 저장 JSON을 다시 쓰지 않고 실행 전에 아는 필드만 옮기며, region은 정규화해(객체가 아닌 `conditions`는 없는 것으로, `mapBounds`는 네 값만) bounds가 place-ai-search AC-29 규칙에 어긋나면 결과 보기만 되고 다시 검색은 HTTP 없이 "다시 검색할 수 없어요"를 알린다. region 결과의 AI fallback 안내는 영역 기준 문구다. 기기 좌표 전송, region 본문의 `previousConditions`, region 기록이 `/places/search`로 가는 일, 실행 불가 기록의 HTTP, thread 복원의 HTTP와 지도 이동, 저장 JSON 다시 쓰기는 어떤 경우에도 없다. 상세 규칙은 spec.md다.
- Rejected: 위치를 얻지 못한 뒤와 "이 지역에서 검색" 뒤에만 bounds(옛 D-52, 지역 고정) → 위치를 허용한 사용자의 요청에는 지역 정보가 하나도 가지 않는다. 후속 검색에 지금 지도 → 결과 맞춤 이동(D-110)으로 화면이 좁아져 사용자가 아무것도 하지 않았는데 검색 지역이 준다. region이 `previousConditions`를 `/places/search`로 다시 보내기 → AI가 원래 문장의 지역("강남역")을 다시 읽어 지도를 선릉으로 옮겨도 강남역 결과가 나온다. `getBounds()` 전체 → 패널과 카드에 가려 사용자가 보지 못한 곳까지 찾는다. 키보드까지 빼기 → 휴대폰의 새 검색은 늘 키보드가 열린 채 보내므로 매번 지도의 1/4 정도로 좁아진다. 위쪽 `Fab`과 버튼 높이까지 빼기 → 화면 폭 일부만 가리는데 지도 위쪽 띠 전체가 빠진다. 저장된 region JSON을 새 모양으로 다시 쓰기 → 회원 thread는 서버에 있고, 읽을 때 정규화하면 충분하다. 실행 불가 region 기록 버리기 → 결과 보기와 이어 검색은 bounds 없이도 된다.
- Reuse: `fe/src/domains/place/model/search-threads.ts#isTurn` (reuse) — 저장 형식 검사는 지금처럼 `request.query`만 보고 옛 region 모양도 받는다 · `fe/src/domains/place/api/place-queries.ts#placeQueries` (modify) — `search`가 기록 종류로 API를 고르고 key `["places","search",entryId]`는 그대로 둔다 · `fe/src/domains/place/api/place-api.ts#searchPlaces` (modify) — region 호출도 `searchAccess`, 15초 timeout, `X-Fallback` 처리를 같이 쓴다

## D-110 새 검색과 후속 검색의 첫 페이지에 맞춰 지도를 옮긴다
- Status: settled
- Decision: S15P31A302-203. 종류가 new·followUp인 요청의 첫 페이지를 받아 화면에 반영하면(다시 검색과 실패 재시도 포함) 그때 화면에 그리는 핀으로 지도를 옮긴다. 2곳 이상이면 `fitBounds`(아래 여백은 결과 패널이 지도와 실제로 겹친 높이, 네 방향에 핀 크기 40px을 더하고 위는 safe-area도 더한다, 확대 정도 상한은 옵션 `maxZoom` 17), 1곳이면 `panTo`(확대 정도 유지), 0곳이면 옮기지 않는다. 맞춤 이동을 시작하면 남은 처음 이동(D-108)은 끝낸다. region, 다음 페이지, 상세에서 복귀, thread 복원, 홈은 옮기지 않는다. 이 이동은 코드 이동이라 "이 지역에서 검색" 버튼을 띄우지 않는다. 지역 이름이 아니라 결과 좌표로 옮기므로 AI와 BE는 지역 좌표를 주지 않는다. 상세 규칙은 spec.md다.
- Rejected: 맞춤 이동 없음(옛 D-70) → 다른 지역 화면에서 "강남역 파스타"를 찾으면 결과 핀이 화면 밖에 있다. 결과 패널 높이 전체를 여백으로 → 패널이 있으면 지도는 위쪽 절반이라 패널은 지도 아래쪽 일부만 가린다. 여백을 아래만 주기 → 핀이 상태바와 화면 가장자리에 걸린다. 맞춤 이동 뒤에도 처음 이동 남기기 → 위치가 늦게 오면 방금 맞춘 결과 화면을 내 위치로 끌고 간다. thread 복원 때 핀이 화면 밖이면 옮기기 → 다시 연 결과는 새 응답이 아니라 저장한 응답이다. region에서도 맞추기 → 사용자가 고른 화면을 바꾼다. 멈춘 뒤 `setZoom(17)`으로 낮추기(처음 spec) → 멈춤을 기다리고 취소해야 하며, 그 사이 "내 위치" 같은 다른 코드 이동 뒤에 확대 정도가 바뀌는 경합이 생긴다. 네이버 지도 v3 `FitBoundsOptions.maxZoom`이 같은 결과를 한 번에 준다(S15P31A302-203 리뷰).
- Reuse: `fe/src/domains/place/ui/place-map.tsx#PlaceMap` (modify) — 코드 이동을 사용자 이동으로 세지 않는 구분을 맞춤 이동과 확대 상한 맞춤에도 쓴다

## D-111 홈 주변 카드는 보이는 지도 영역으로 /places/nearby를 불러 보인다
- Status: settled
- Decision: S15P31A302-204. 홈은 `POST /api/v1/places/nearby` `{mapBounds}`로 받아 서버 순서 그대로 보이고, FE는 거르지 않고 거리는 기기 위치가 있을 때만 표시한다. 같은 원칙으로 결과 화면의 근처 응답도 거르지 않는다(1km 필터, `unfilteredNearby`, `locating`, 역삼 기준 거리 라벨, `YEOKSAM_STATION`, 반경 상수와 앞 10곳 자르기를 지우고 맞춤 이동(D-110)의 위치 대기 gate도 뺀다). 영역은 D-109의 보이는 영역이고 홈 아래 묶음의 위 끝(`coverTop`)으로 재며, 확정할 때 지금 wrapper 크기를 SDK에 직접 알린(`setSize`) 뒤 바로 읽는다(`boundsAfterResize`, 크기 변화를 기다리지 않는다, 2026-11-11 사용자 결정). 요청 영역은 네 좌표를 0.001도로 반올림하고 폭이 0인 축만 원본 SW 내림·NE 올림으로 보정한 같은 객체를 cache key와 본문에 쓴다(SW<NE이고 유효하지 않으면 요청하지 않고 지도 실패 상태). nearby cache는 key `["places","nearby", 정규화 영역]`, `staleTime`·`gcTime` 10분이고 AI fallback 응답만 `staleTime` 0이다. 로그인 세션이 바뀌면 기존 `clearOnSessionChange`의 `queryClient.clear()`가 지우고 새 코드는 없다. 홈 영역(`homeBounds`)은 처음 한 번(위치 결정과 처음 이동이 끝난 뒤, 사용자가 먼저 지도를 움직였으면 멈춘 뒤, 위치 실패·권한 없음이면 저장된 화면 기준, 지도 실패면 요청 없음, 그때까지 skeleton)과 홈 진입마다 확정한다. 홈 진입은 결과·과거 결과·저장한 장소 화면을 보다가 첫 화면이 되는 것과 홈이 보이는 동안의 로그인 세션 변경이고, render 중 전이로 판정하며 같은 렌더에 겹치면 한 번이다. 검색 중·실패에서 취소해 돌아오는 것, 결과 화면 복귀, 상세 왕복은 진입이 아니다. 로그인 세션이 바뀌면 `homeBounds`를 비운다. 끌기, 확대·축소, 카드 `panTo`, "내 위치"로는 `homeBounds`를 바꾸지 않는다. 지금 진입의 영역이 정해지기 전에는 이전 영역의 카드·핀·빈 안내·오류를 그리지 않고 카드 높이의 skeleton을 보인다(cache는 유지, 같은 key의 fresh cache면 요청 없이 그린다). 홈에는 "이 지역에서 검색" 버튼이 없다(2026-11-11 사용자 결정, 이 버튼은 LLM 검색 결과 화면 전용이다). 홈에서 지도를 끌거나 확대·축소하거나 "내 위치"로 옮겨도 지도만 움직이고 카드·핀·선택은 그대로이며 nearby 요청이 없다. 홈 카드는 앱을 열 때와 홈 진입 때만 그때 화면의 영역으로 받고, 그래서 홈에서 지도를 옮기면 다른 화면에 다녀오기 전까지 카드와 지도가 어긋날 수 있다(감수한다). 영역 안에 장소가 없으면 `emptyReason`을 카드 자리의 상자에 `EmptyState`로 보이고(`emptyReason`이 없는 0곳은 아무것도 그리지 않는다), 지도 SDK가 실패하면 skeleton 대신 실패 안내(문구는 spec)를 보이며 다시 시도 버튼은 없다. 홈의 AI fallback 안내는 "지도 안의 장소만 보여드려요. 검색 조건은 적용되지 않았어요"이다. 이 기능에서 절대 일어나면 안 되는 일: 새 홈 진입의 첫 렌더부터 이전 영역의 카드·핀·빈 안내·오류가 보이는 것, 로그인 세션이 바뀐 뒤 이전 세션용 nearby 카드가 보이는 것, 요청 본문의 영역과 cache key의 영역이 다른 것. 상세 규칙은 spec.md다.
- Rejected: 홈 영역을 `getBounds()` 전체로 읽기(design 6-2 처음 안) → 아래 카드와 검색창이 가린 곳까지 찾는다. D-109와 같은 보이는 영역을 쓴다. 홈 진입을 `firstScreen && !savedView`의 false→true 전이로만 잡기 → 검색 취소·실패 복귀가 진입으로 잡히고 홈이 숨은 동안의 세션 변경을 놓친다. 처음 홈 요청의 gate를 `initialView === "done"`만으로 두기 → "내 위치"가 누르는 즉시 `done`으로 만들어 이동 전 화면으로 요청이 나간다(D-108). 홈 "이 지역에서 검색" 버튼(영역이 다르면 띄우기, 사용자 이동 뒤에만 띄우기 포함) → 2026-11-11 사용자 결정으로 이 버튼은 LLM 검색 결과 화면 전용이다. 2026-11-10 설계가 홈에도 두기로 한 것은 사용자의 뜻을 잘못 받은 것이다. 홈에서 "내 위치"나 끌기 뒤 카드를 다시 받기 → 지도 이동만으로 요청이 나가 홈 요청이 앱을 열 때와 홈 진입 때로 정해진 규칙이 깨진다. `staleTime`·`gcTime` Infinity → 04:00 배치로 점수가 바뀌고 영역마다 key가 생겨 다녀간 영역이 쌓인다. 기기 위치 반경으로 FE가 거르기와 앞 10곳 자르기 → 거르는 일은 AI·BE의 지도 영역이고 BE가 10곳으로 자른다(place-ai-search D-18). 지도 실패 때 영역 없이 nearby 요청 → nearby는 `mapBounds`가 필수다. 크기 적용을 time-out 없이 기다리기(처음 spec) → 화면 배율 125%·150%에서 wrapper 크기와 `contentRect`가 0.01px 다르게 재져 홈이 skeleton에 멈췄다. 크기 비교에 1px 허용과 1초 상한을 더해 기다리기(2026-11-11 중간 안) → 막으려던 것은 절반 지도에서 전체로 올 때 SDK가 절반 크기의 영역을 주는 것 하나라, 크기를 직접 알리면 기다릴 것이 없어 무한 skeleton과 배율 문제가 구조상 생기지 않는다(2026-11-11 사용자 결정).
- Reuse: `fe/src/domains/place/api/place-queries.ts#placeQueries` (modify) — `nearby`가 정규화한 영역을 받아 key와 10분 cache 규칙을 따른다 · `fe/src/domains/place/ui/use-nearby-picks.ts#useNearbyPicks` (modify) — 홈 영역이 정해지기 전에는 카드·오류를 돌려주지 않는다 · `fe/src/domains/place/ui/place-map.tsx#PlaceMap` (modify) — `boundsAfterResize`(크기를 직접 알린 뒤의 보이는 영역)와 멈춤(`idle`) 알림을 더한다 · `fe/src/domains/place/model/search-store.ts#createSearchStore` (modify) — 홈 영역과 진입을 두고 `reset()`이 비운다 · `fe/src/domains/place/ui/locate-device.ts#locateFromButton` (modify) — 처음 이동을 `applying`으로 소유하고 이동이 끝난 뒤 `done`으로 만든다 · `fe/src/domains/place/ui/result-panel.tsx#AiFallbackNote` (modify) — 홈도 같은 안내 문구를 쓴다 · `fe/src/app/search-thread-auth.ts#clearOnSessionChange` (reuse) — 세션 변경 때 nearby cache를 지우는 기존 연결을 그대로 쓴다
