# place-search decisions

Glossary: none · ADRs: none

## D-1 범위와 목표
- Status: settled
- Decision: 자동완성, 추천 검색과 후속 조건 수정, 결과 목록과 지도, 장소 상세만 만든다(Jira S15P31A302-15, 27~30). 목표는 "Mock으로 끝까지 동작"이다. 시점은 10-23 데모 기준이며 팀 확인이 필요하다(PRD는 10-23, 인프라 문서는 11-06).
- Rejected: 검색 기록, 온보딩, 저장, 리뷰, 인증 → Jira에 없고 다른 담당이다.

## D-2 AI 파트와의 경계
- Status: superseded by D-18
- Decision: BE는 인터페이스 하나(`PlaceSearchEngine`)만 두고 Mock 구현을 꽂는다. 요청 해석, 임베딩, OpenSearch 질의, 리랭크, 점수 계산을 이어 붙이는 주체는 미결이며, 확정되면 구현을 교체한다.
- Rejected: BE가 Modal과 OpenSearch를 직접 호출(`docs/infra/design.md` §12.2 제안) → 담당이 정해지지 않았다.
- Anchors: `be/src/main/java/kr/co/fitdining/api/place/PlaceSearchEngine.java#PlaceSearchEngine` (new) · `be/src/main/java/kr/co/fitdining/api/place/MockPlaceSearchEngine.java#MockPlaceSearchEngine` (new)

## D-3 Mock은 BE에 두고 시나리오는 검색어로 나눈다
- Status: superseded by D-16
- Decision: 고정 JSON(강남·역삼·선릉 약 12곳)을 BE가 실제 경로로 돌려준다. 검색어에 "근처"가 있으면 근처 모드, "없음"이 있으면 결과 없음으로 응답한다.
- Rejected: FE 쪽 Mock → 실제 연동 때 FE도 고쳐야 한다.
- Anchors: `be/src/main/resources/mock/places.json#places` (new)

## D-4 엔드포인트 3개와 패키지
- Status: settled
- Decision: `GET /api/v1/places/suggest?q=`, `POST /api/v1/places/search`, `GET /api/v1/places/{id}`. 패키지는 기존 `kr.co.fitdining.api.place`이고 DB와 JPA는 쓰지 않는다. 루트 패키지를 줄일지는 팀 결정으로 미룬다.
- Rejected: `kr.co.fitdining.place` → `ApiApplication`을 옮겨야 하고 공용 뼈대를 건드린다.
- Anchors: `be/src/main/java/kr/co/fitdining/api/ApiApplication.java#ApiApplication` (reuse) · `be/src/main/java/kr/co/fitdining/api/place/PlaceController.java#PlaceController` (new)

## D-5 DTO는 최소 구조로 전달만 한다
- Status: superseded by D-19
- Decision: 요청은 query, preferences?, previousConditions?, mapBounds?, cursor?. 응답은 conditions, nearby, items[], nextCursor?, emptyReason?. 카드는 place, score, labels[2], caution?. 상세는 hours, menus, facilities, reasons, missingEvidenceNotes. 후보는 place 또는 "이 조건으로 추천받기". BE는 내용을 검증하거나 가공하지 않으며, 확정되면 이 레이어만 고친다.
- Anchors: `be/src/main/java/kr/co/fitdining/api/place/PlaceDtos.java#PlaceDtos` (new)

## D-6 절대 일어나면 안 되는 일
- Status: superseded by D-17
- Decision: 구조로 보장한다. 요청 어디에도 위치 좌표 필드가 없고, 응답 어디에도 외부 리뷰 필드가 없다. 제공자(AI 파트)의 약속으로 기록한다. 점수는 0~100 정수이고, 근거 없는 특징은 보이지 않으며, 확인할 수 없는 지역 조건의 장소는 제외한다. FE는 점수를 정수 그대로 `%` 없이 표시한다.
- Anchors: `be/src/main/java/kr/co/fitdining/api/place/PlaceDtos.java#PlaceDtos` (new)

## D-7 근처 모드
- Status: superseded by D-22
- Decision: 서버는 위치 없이 후보 전체(최대 약 100)를 점수순으로, 커서 없이 `nearby: true`로 내려주고, 브라우저가 반경으로 거른다. 반경값은 FE 상수이며 값은 미결이다. 위치 서버 전송 정책의 재검토는 PRD OQ-18을 따른다.
- Rejected: 좌표 서버 전송 → 위치정보법 신고 대상이 될 가능성(PRD D-03).

## D-8 후속 조건과 페이징
- Status: settled
- Decision: 응답의 `conditions`를 FE가 `previousConditions`로 되돌려 보낸다(서버는 상태 없음). 검색 측이 `thread_id`로 관리하는 방식은 미결이며, 채택되면 필드만 교체한다. 페이징은 불투명한 `nextCursor`를 쓰고 한 번에 20개다.

## D-9 취향과 인증
- Status: settled
- Decision: 취향은 요청 본문의 선택 필드(`preferences`, 태그 코드 목록)로 받고, JWT는 읽지 않는다. 검색이 취향을 실제로 쓰는지는 미결이다(AI 파트에 확인, PRD는 반영한다고 되어 있다).

## D-10 오류와 빈 결과
- Status: settled
- Decision: 오류는 Spring ProblemDetail을 임시로 쓴다. 결과 없음은 200과 빈 목록, `emptyReason`(원인과 수정 제안)으로 응답한다. 공통 응답과 예외 형식은 BE 팀 결정 전까지 미결이다.

## D-11 FE 배포 방식은 미결, 작성 원칙은 양쪽 호환
- Status: settled
- Decision: 정적 export 여부는 미결이다. 어느 쪽이든 되도록 데이터는 전부 브라우저 `fetch`로 가져오고, 장소 상세는 `/place?id=`로 만들며, 서버 전용 기능은 쓰지 않는다. 정적 export를 택하면 `next.config.ts`의 `cacheComponents`(Node 필요)와 `partialPrefetching`을 빼야 한다.

## D-12 FE 구조
- Status: settled
- Decision: UI 컴포넌트는 `src/app/components`, 화면이 아닌 로직(API 호출, DTO 타입, 근처 필터, 디바운스 훅)은 `src/lib`에 둔다. `features/` 폴더는 쓰지 않는다. 팀의 FE 폴더 규칙 확인은 미결이다.
- Rejected: `src/features/place-search` → 규칙이 없고, `src/app` 안 colocation이 Next 문서상 안전하며 파일 수가 적다.
- Anchors: `fe/src/app/page.tsx#Home` (modify) · `fe/src/app/place/page.tsx#PlaceDetailPage` (new) · `fe/src/lib/placeApi.ts#searchPlaces` (new)

## D-13 지도와 자동완성 디바운스
- Status: settled
- Decision: 네이버 지도 JS API를 한 컴포넌트에서만 로드하고, 키가 없으면 지도 영역만 비우고 목록은 동작한다(키와 요금은 PRD OQ-19로 미결). 자동완성은 300ms 안팎 디바운스, 빈 입력 미요청, 이전 요청 취소, 늦게 온 응답 무시를 지킨다.
- Anchors: `fe/src/app/components/PlaceMap.tsx#PlaceMap` (new)

## D-14 용어와 이름
- Status: superseded by D-23
- Decision: 코드, API, 화면은 "장소(Place)"로 통일하고 REST 경로는 복수형(`/places`)이다. 테이블과 엔티티 이름의 최종 확정은 내일로 미룬다(ERD는 `places`).
- Rejected: 가게, 매장 → PRD 용어가 "장소"다.

## D-15 검증 방식
- Status: superseded by D-30
- Decision: BE는 엔드포인트 3개를 `@WebMvcTest`로 확인한다(Mock 시나리오 포함). FE는 Vitest를 추가해 근처 필터와 거리 계산, 디바운스 훅만 단위 테스트한다. E2E는 하지 않는다.
- Anchors: `fe/package.json#scripts` (modify) · `fe/src/lib/nearby.test.ts#nearby` (new)

## D-16 Mock의 규모, 시나리오, 노출 범위
- Status: settled
- Decision: Mock 장소는 25곳 이상이라 20개 페이징과 `nextCursor`가 실제로 나온다. 시나리오는 검색어가 아니라 요청 헤더 `X-Mock-Scenario`로 고르고, FE는 주소창의 `?mock=empty`를 읽어 이 헤더를 붙인다. 지금은 `empty`만 만들고 `error`는 필요해질 때 추가한다. 헤더가 없으면 정상 결과이며, "근처"가 들어간 검색어는 AI의 해석을 흉내 내 `nearby: true`로 응답한다. 후속 검색에서 Mock은 받은 `previousConditions`를 그대로 `conditions`에 담아 돌려준다. Mock은 설정 스위치(`*_ENABLED` 방식)로 켜고 local과 dev에서만 켠다. prod에서 실제 구현이 없으면 검색 API는 503을 돌려주며, 이 스위치 이름은 환경변수 계약(`docs/infra/contracts/env.md`)에 올려야 한다. prod에서 10-23 데모를 Mock으로 보여 줘야 하면 팀 확인이 필요하다.
- Rejected: 검색어 부분 문자열로 시나리오 분기("근처", "없음") → 평범한 문장과 충돌하고 우선순위가 없다. 입력창에 `mock:empty` 같은 명령어 입력 → 직관적이지 않다. 개발용 선택 상자 → 지금은 과하다(자주 바꿔 볼 일이 생기면 추가).
- Anchors: `be/src/main/java/kr/co/fitdining/api/place/MockPlaceSearchEngine.java#MockPlaceSearchEngine` (new) · `be/src/main/resources/mock/places.json#places` (new)

## D-17 절대 일어나면 안 되는 일(필드 수준 보장)
- Status: settled
- Decision: 요청에 위치 좌표 필드가 없고 응답에 외부 리뷰 필드가 없다는 것은 **이름 있는 필드 수준의 보장**이다. 요청 본문은 알 수 없는 속성이 오면 거부해서 클라이언트가 `lat`, `lng` 같은 필드를 몰래 실어 보내도 받지 않는다. 자유 텍스트 필드(`reasons`, `caution`, `labels`, `preferences`)의 내용은 검증하지 않으며, 외부 리뷰 원문이나 좌표가 담기지 않게 하는 책임은 제공자(AI 파트)에게 있다(감수한 트레이드오프). 제공자의 약속은 점수 0~100 정수, 근거 없는 특징 미표시, 확인할 수 없는 지역 조건 장소 제외다. FE는 점수를 정수 그대로 `%` 없이 표시한다.
- Anchors: `be/src/main/resources/application.properties#spring` (modify)

## D-18 AI 파트와의 경계(교체 범위 정정)
- Status: settled
- Decision: BE는 인터페이스 하나(`PlaceSearchEngine`)만 두고 Mock 구현을 꽂는다. 요청 해석, 임베딩, OpenSearch 질의, 리랭크, 점수 계산을 이어 붙이는 주체는 미결이다. 구현을 교체할 때 DTO뿐 아니라 이 인터페이스의 시그니처(실패, 폴백 표시, 타임아웃 처리)도 바뀔 수 있으며, 이를 감수한다. 타임아웃, 서킷 브레이커, 예산, 속도 제한, `X-Fallback` 헤더는 이번 범위가 아니고 연동 시점에 다룬다(`docs/infra/design.md` §11.2, §12.1).
- Rejected: BE가 Modal과 OpenSearch를 직접 호출(`docs/infra/design.md` §12.2 제안) → 담당이 정해지지 않았다. 지금 실패 모델을 인터페이스에 넣기 → 실제 계약이 없어서 추측이 된다.
- Anchors: `be/src/main/java/kr/co/fitdining/api/place/PlaceSearchEngine.java#PlaceSearchEngine` (new)

## D-19 DTO는 최소 구조로 전달만 한다(타입 정정)
- Status: superseded by D-24
- Decision: 요청은 query, preferences?, previousConditions?, mapBounds?, cursor?. 응답은 conditions, nearby, items[], nextCursor?, emptyReason?. 카드는 place, score, labels[2], caution?. 상세는 hours, menus, facilities, reasons, missingEvidenceNotes. 후보는 place 또는 "이 조건으로 추천받기". `score`는 정수 타입이다. `conditions`와 `previousConditions`는 BE와 FE가 해석하지 않는 불투명한 JSON 객체다. `id`는 ERD(`places.id`)를 따라 정수(bigint)이고, 404, 후보 항목의 구분 필드, `q` 길이 제한은 `/wf-spec`에서 정한다. BE는 내용을 검증하거나 가공하지 않으며, 확정되면 이 레이어와 D-18의 인터페이스를 고친다.
- Anchors: `be/src/main/java/kr/co/fitdining/api/place/PlaceDtos.java#PlaceDtos` (new)

## D-20 로그 규칙
- Status: settled
- Decision: BE는 검색과 자동완성의 요청 본문, `preferences`, `q` 값을 로그에 남기지 않는다. 자동완성이 GET이라 `q`가 Caddy 접근 로그에 남는 문제는 인프라 담당에게 넘기는 미결 사항이다(`docs/infra/design.md` §5.4의 로그 필터는 `k`만 지운다).

## D-21 BE 기동
- Status: settled
- Decision: 이 기능은 DB를 쓰지 않지만 `be/build.gradle`에 JPA, Flyway, Postgres가 있고 datasource 설정이 없어 기동에 실패한다. 구현 때는 `infra/local`의 로컬 스택(Postgres)을 띄우고 `SPRING_DATASOURCE_URL`, `SPRING_DATASOURCE_USERNAME`, `SPRING_DATASOURCE_PASSWORD` 환경변수로 접속 정보를 넘긴다. 공용 뼈대 설정과 의존성은 이 기능에서 바꾸지 않으며, 정리는 팀 몫이다. Flyway가 마이그레이션 파일 없이 켜졌을 때의 동작은 확인하지 않았고 구현 단계에서 확인한다.
- Rejected: 이 기능을 위해 datasource 자동 설정을 제외 → 공용 뼈대를 건드린다.

## D-22 근처 모드(위치 위험 명시)
- Status: settled
- Decision: 서버는 위치 없이 후보 전체(최대 약 100)를 점수순으로, 커서 없이 `nearby: true`로 내려주고, 브라우저가 반경으로 거른다. 반경값은 FE 상수이며 값은 미결이다. `mapBounds`는 사용자의 위치가 아니라 검색 대상 지역으로 취급하며(PRD §7.1), "이 지역에서 검색"을 눌렀을 때와 위치 권한이 없을 때만 보낸다. 사용자가 "내 위치"를 누른 직후의 지도 영역이 위치를 대략 드러낼 수 있다는 위험은 감수하고, 위치 서버 전송 정책 재검토는 PRD OQ-18을 따른다.
- Rejected: 좌표 서버 전송 → 위치정보법 신고 대상이 될 가능성(PRD D-03).

## D-23 용어와 이름(ERD 근거 제거)
- Status: settled
- Decision: 코드, API, 화면은 "장소(Place)"로 통일하고 REST 경로는 복수형(`/places`)이다. 테이블과 엔티티 이름은 내일 팀에서 확정한다. erd-cloud의 테이블이 지금 단수(`place`)이므로 복수(`places`)로 맞추자고 제안할 예정이다. 이 기능은 DB 테이블을 쓰지 않아 확정 결과가 영향을 주지 않는다.
- Rejected: 가게, 매장 → PRD 용어가 "장소"다.

## D-24 DTO 정정(추천 이유의 위치, id 타입)
- Status: settled
- Decision: 요청은 query, preferences?, previousConditions?, mapBounds?, cursor?. 응답은 conditions, nearby, items[], nextCursor?, emptyReason?. 검색 응답의 항목(카드)은 place, score, labels[2], caution?에 더해 `reasons`와 `missingEvidenceNotes`를 담는다. 이 값은 요청과 취향에 따라 달라지므로 장소 ID만 받는 상세 API가 만들 수 없고, 과거 추천을 열 때도 이유를 복원해야 한다(PRD FR-08, FR-03). 이 값을 만드는 주체는 검색 결과 제공자(AI 파트)이며, 상세 API가 검색 맥락을 같이 받는 안도 열려 있어 AI 파트와 확정 전까지 미결이다. 상세 응답은 장소 고유 정보(hours, menus, facilities)만 담는다. 후보는 place 또는 "이 조건으로 추천받기"다. `score`는 정수 타입이고 `conditions`와 `previousConditions`는 BE와 FE가 해석하지 않는 불투명한 JSON 객체다. `id` 타입은 미결이며 Mock은 임시 값을 쓴다. 404, 후보 항목의 구분 필드, `q` 길이 제한은 `/wf-spec`에서 정한다. BE는 내용을 검증하거나 가공하지 않는다.
- Anchors: `be/src/main/java/kr/co/fitdining/api/place/PlaceDtos.java#PlaceDtos` (new)

## D-25 임베딩 계산 주체와 벡터 저장 위치(미결)
- Status: settled
- Decision: 임베딩을 누가 계산하는지(Modal, 또는 OpenSearch가 외부 모델 호출)와 벡터를 OpenSearch에만 둘지 Postgres(pgvector)에도 둘지는 미결이다(`docs/infra/design.md:488`, `:960` §16 #21, 담당 BE·AI 팀). `PlaceSearchEngine` 뒤쪽의 일이라 이 기능의 API 계약에는 영향이 없다.

## D-26 상세 데이터 출처와 두 저장소의 동기화(미결)
- Status: settled
- Decision: 장소 상세 정보(영업시간, 메뉴, 시설 등)를 Postgres에서 읽을지 OpenSearch 문서에서 읽을지, 두 저장소를 어떻게 동기화할지는 미결이다. 단서는 `docs/infra/design.md:487`(복구는 Postgres에서 재색인)이 유일하고, PRD OQ-13(갱신 순서와 일관성), OQ-14(DB 제품과 저장 구조)가 미정이다. 두 저장소를 쓰면 색인에는 있는데 DB에는 없는 장소처럼 어긋날 위험이 있다. Mock 단계에서는 `PlaceSearchEngine` 뒤쪽이라 영향이 없다.

## D-27 검색 상태 보관 방식(미결)
- Status: settled
- Decision: 결과 목록에서 상세로 갔다가 뒤로 가도 기존 결과가 유지되어야 하고(PRD AC-4), 상세 화면은 검색 응답 카드의 추천 이유를 써야 한다(D-24). 이 검색 상태를 프런트 메모리(React Context 등)에 둘지 `sessionStorage`까지 쓸지는 더 확인이 필요해 미결이다. 메모리는 새로고침이나 탭 재로드, PWA 재로드에서 사라질 수 있다.

## D-28 로컬에서 FE가 BE를 부르는 방법(미결)
- Status: settled
- Decision: 운영은 같은 출처(`/api`)지만 로컬은 FE(`localhost:3000`)와 BE(`localhost:8080`)가 달라서 BE의 CORS 허용이나 FE 개발 서버의 프록시 같은 방법이 필요하다. 정적 export에서는 `rewrites`를 못 쓰므로(D-11) 방법은 정적 export 결정과 함께 미결이며, 구현에서 처음 연결할 때 정한다.

## D-29 지도 클라이언트 ID의 주입 방식(미결)
- Status: settled
- Decision: FE가 네이버 지도 클라이언트 ID를 어떻게 얻는지(빌드 시점 `NEXT_PUBLIC_*` 환경변수, 런타임 설정 파일 등)는 보안 확인 후 정하며 미결이다. 이 기능은 키를 읽는 코드를 `PlaceMap.tsx` 안의 한 곳에 모으고, 값이 없으면 지도 영역을 비운다(D-13). 서버용 Client Secret은 브라우저로 내리지 않는다.

## D-30 검증 방식(자동완성 로직은 React와 분리해 테스트)
- Status: settled
- Decision: BE는 엔드포인트 3개를 `@WebMvcTest`로 확인한다(Mock 시나리오 포함). FE는 Vitest만 추가해 근처 필터, 거리 계산, 자동완성 로직(디바운스, 취소, 늦은 응답 무시)을 단위 테스트한다. 자동완성 로직은 React와 무관한 모듈로 분리하고 훅은 그 모듈을 감싸는 얇은 껍데기로 두며, `jsdom`과 `@testing-library/react`는 추가하지 않는다. E2E는 하지 않는다.
- Rejected: `jsdom`과 `@testing-library/react`로 훅을 직접 테스트 → 개발 의존성이 늘어난다.
- Anchors: `fe/package.json#scripts` (modify) · `fe/src/lib/nearby.test.ts#nearby` (new)
