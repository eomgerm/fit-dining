# place-search decisions

Glossary: none · ADRs: none

## D-1 범위와 목표
- Status: superseded by D-31
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
- Status: superseded by D-32
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
- Status: superseded by D-45
- Decision: 응답의 `conditions`를 FE가 `previousConditions`로 되돌려 보낸다(서버는 상태 없음). 검색 측이 `thread_id`로 관리하는 방식은 미결이며, 채택되면 필드만 교체한다. 페이징은 불투명한 `nextCursor`를 쓰고 한 번에 20개다.

## D-9 취향과 인증
- Status: superseded by D-33
- Decision: 취향은 요청 본문의 선택 필드(`preferences`, 태그 코드 목록)로 받고, JWT는 읽지 않는다. 검색이 취향을 실제로 쓰는지는 미결이다(AI 파트에 확인, PRD는 반영한다고 되어 있다).

## D-10 오류와 빈 결과
- Status: settled
- Decision: 오류는 Spring ProblemDetail을 임시로 쓴다. 결과 없음은 200과 빈 목록, `emptyReason`(원인과 수정 제안)으로 응답한다. 공통 응답과 예외 형식은 BE 팀 결정 전까지 미결이다.

## D-11 FE 배포 방식은 미결, 작성 원칙은 양쪽 호환
- Status: superseded by D-38
- Decision: 정적 export 여부는 미결이다. 어느 쪽이든 되도록 데이터는 전부 브라우저 `fetch`로 가져오고, 장소 상세는 `/place?id=`로 만들며, 서버 전용 기능은 쓰지 않는다. 정적 export를 택하면 `next.config.ts`의 `cacheComponents`(Node 필요)와 `partialPrefetching`을 빼야 한다.

## D-12 FE 구조
- Status: superseded by D-43
- Decision: UI 컴포넌트는 `src/app/components`, 화면이 아닌 로직(API 호출, DTO 타입, 근처 필터, 디바운스 훅)은 `src/lib`에 둔다. `features/` 폴더는 쓰지 않는다. 팀의 FE 폴더 규칙 확인은 미결이다.
- Rejected: `src/features/place-search` → 규칙이 없고, `src/app` 안 colocation이 Next 문서상 안전하며 파일 수가 적다.
- Anchors: `fe/src/app/page.tsx#Home` (modify) · `fe/src/app/place/page.tsx#PlaceDetailPage` (new) · `fe/src/lib/placeApi.ts#searchPlaces` (new)

## D-13 지도와 자동완성 디바운스
- Status: superseded by D-48
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
- Status: superseded by D-34
- Decision: Mock 장소는 25곳 이상이라 20개 페이징과 `nextCursor`가 실제로 나온다. 시나리오는 검색어가 아니라 요청 헤더 `X-Mock-Scenario`로 고르고, FE는 주소창의 `?mock=empty`를 읽어 이 헤더를 붙인다. 지금은 `empty`만 만들고 `error`는 필요해질 때 추가한다. 헤더가 없으면 정상 결과이며, "근처"가 들어간 검색어는 AI의 해석을 흉내 내 `nearby: true`로 응답한다. 후속 검색에서 Mock은 받은 `previousConditions`를 그대로 `conditions`에 담아 돌려준다. Mock은 설정 스위치(`*_ENABLED` 방식)로 켜고 local과 dev에서만 켠다. prod에서 실제 구현이 없으면 검색 API는 503을 돌려주며, 이 스위치 이름은 환경변수 계약(`docs/infra/contracts/env.md`)에 올려야 한다. prod에서 10-23 데모를 Mock으로 보여 줘야 하면 팀 확인이 필요하다.
- Rejected: 검색어 부분 문자열로 시나리오 분기("근처", "없음") → 평범한 문장과 충돌하고 우선순위가 없다. 입력창에 `mock:empty` 같은 명령어 입력 → 직관적이지 않다. 개발용 선택 상자 → 지금은 과하다(자주 바꿔 볼 일이 생기면 추가).
- Anchors: `be/src/main/java/kr/co/fitdining/api/place/MockPlaceSearchEngine.java#MockPlaceSearchEngine` (new) · `be/src/main/resources/mock/places.json#places` (new)

## D-17 절대 일어나면 안 되는 일(필드 수준 보장)
- Status: superseded by D-41
- Decision: 요청에 위치 좌표 필드가 없고 응답에 외부 리뷰 필드가 없다는 것은 **이름 있는 필드 수준의 보장**이다. 요청 본문은 알 수 없는 속성이 오면 거부해서 클라이언트가 `lat`, `lng` 같은 필드를 몰래 실어 보내도 받지 않는다. 자유 텍스트 필드(`reasons`, `caution`, `labels`, `preferences`)의 내용은 검증하지 않으며, 외부 리뷰 원문이나 좌표가 담기지 않게 하는 책임은 제공자(AI 파트)에게 있다(감수한 트레이드오프). 제공자의 약속은 점수 0~100 정수, 근거 없는 특징 미표시, 확인할 수 없는 지역 조건 장소 제외다. FE는 점수를 정수 그대로 `%` 없이 표시한다.
- Anchors: `be/src/main/resources/application.properties#spring` (modify)

## D-18 AI 파트와의 경계(교체 범위 정정)
- Status: superseded by D-62
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
- Status: superseded by D-40
- Decision: 이 기능은 DB를 쓰지 않지만 `be/build.gradle`에 JPA, Flyway, Postgres가 있고 datasource 설정이 없어 기동에 실패한다. 구현 때는 `infra/local`의 로컬 스택(Postgres)을 띄우고 `SPRING_DATASOURCE_URL`, `SPRING_DATASOURCE_USERNAME`, `SPRING_DATASOURCE_PASSWORD` 환경변수로 접속 정보를 넘긴다. 공용 뼈대 설정과 의존성은 이 기능에서 바꾸지 않으며, 정리는 팀 몫이다. Flyway가 마이그레이션 파일 없이 켜졌을 때의 동작은 확인하지 않았고 구현 단계에서 확인한다.
- Rejected: 이 기능을 위해 datasource 자동 설정을 제외 → 공용 뼈대를 건드린다.

## D-22 근처 모드(위치 위험 명시)
- Status: superseded by D-42
- Decision: 서버는 위치 없이 후보 전체(최대 약 100)를 점수순으로, 커서 없이 `nearby: true`로 내려주고, 브라우저가 반경으로 거른다. 반경값은 FE 상수이며 값은 미결이다. `mapBounds`는 사용자의 위치가 아니라 검색 대상 지역으로 취급하며(PRD §7.1), "이 지역에서 검색"을 눌렀을 때와 위치 권한이 없을 때만 보낸다. 사용자가 "내 위치"를 누른 직후의 지도 영역이 위치를 대략 드러낼 수 있다는 위험은 감수하고, 위치 서버 전송 정책 재검토는 PRD OQ-18을 따른다.
- Rejected: 좌표 서버 전송 → 위치정보법 신고 대상이 될 가능성(PRD D-03).

## D-23 용어와 이름(ERD 근거 제거)
- Status: superseded by D-35
- Decision: 코드, API, 화면은 "장소(Place)"로 통일하고 REST 경로는 복수형(`/places`)이다. 테이블과 엔티티 이름은 내일 팀에서 확정한다. erd-cloud의 테이블이 지금 단수(`place`)이므로 복수(`places`)로 맞추자고 제안할 예정이다. 이 기능은 DB 테이블을 쓰지 않아 확정 결과가 영향을 주지 않는다.
- Rejected: 가게, 매장 → PRD 용어가 "장소"다.

## D-24 DTO 정정(추천 이유의 위치, id 타입)
- Status: superseded by D-44
- Decision: 요청은 query, preferences?, previousConditions?, mapBounds?, cursor?. 응답은 conditions, nearby, items[], nextCursor?, emptyReason?. 검색 응답의 항목(카드)은 place, score, labels[2], caution?에 더해 `reasons`와 `missingEvidenceNotes`를 담는다. 이 값은 요청과 취향에 따라 달라지므로 장소 ID만 받는 상세 API가 만들 수 없고, 과거 추천을 열 때도 이유를 복원해야 한다(PRD FR-08, FR-03). 이 값을 만드는 주체는 검색 결과 제공자(AI 파트)이며, 상세 API가 검색 맥락을 같이 받는 안도 열려 있어 AI 파트와 확정 전까지 미결이다. 상세 응답은 장소 고유 정보(hours, menus, facilities)만 담는다. 후보는 place 또는 "이 조건으로 추천받기"다. `score`는 정수 타입이고 `conditions`와 `previousConditions`는 BE와 FE가 해석하지 않는 불투명한 JSON 객체다. `id` 타입은 미결이며 Mock은 임시 값을 쓴다. 404, 후보 항목의 구분 필드, `q` 길이 제한은 `/wf-spec`에서 정한다. BE는 내용을 검증하거나 가공하지 않는다.
- Anchors: `be/src/main/java/kr/co/fitdining/api/place/PlaceDtos.java#PlaceDtos` (new)

## D-25 임베딩 계산 주체와 벡터 저장 위치(미결)
- Status: superseded by D-36
- Decision: 임베딩을 누가 계산하는지(Modal, 또는 OpenSearch가 외부 모델 호출)와 벡터를 OpenSearch에만 둘지 Postgres(pgvector)에도 둘지는 미결이다(`docs/infra/design.md:488`, `:960` §16 #21, 담당 BE·AI 팀). `PlaceSearchEngine` 뒤쪽의 일이라 이 기능의 API 계약에는 영향이 없다.

## D-26 상세 데이터 출처와 두 저장소의 동기화(미결)
- Status: superseded by D-37
- Decision: 장소 상세 정보(영업시간, 메뉴, 시설 등)를 Postgres에서 읽을지 OpenSearch 문서에서 읽을지, 두 저장소를 어떻게 동기화할지는 미결이다. 단서는 `docs/infra/design.md:487`(복구는 Postgres에서 재색인)이 유일하고, PRD OQ-13(갱신 순서와 일관성), OQ-14(DB 제품과 저장 구조)가 미정이다. 두 저장소를 쓰면 색인에는 있는데 DB에는 없는 장소처럼 어긋날 위험이 있다. Mock 단계에서는 `PlaceSearchEngine` 뒤쪽이라 영향이 없다.

## D-27 검색 상태 보관 방식(미결)
- Status: settled
- Decision: 결과 목록에서 상세로 갔다가 뒤로 가도 기존 결과가 유지되어야 하고(PRD AC-4), 상세 화면은 검색 응답 카드의 추천 이유를 써야 한다(D-24). 이 검색 상태를 프런트 메모리(React Context 등)에 둘지 `sessionStorage`까지 쓸지는 더 확인이 필요해 미결이다. 메모리는 새로고침이나 탭 재로드, PWA 재로드에서 사라질 수 있다.

## D-28 로컬에서 FE가 BE를 부르는 방법(미결)
- Status: superseded by D-39
- Decision: 운영은 같은 출처(`/api`)지만 로컬은 FE(`localhost:3000`)와 BE(`localhost:8080`)가 달라서 BE의 CORS 허용이나 FE 개발 서버의 프록시 같은 방법이 필요하다. 정적 export에서는 `rewrites`를 못 쓰므로(D-11) 방법은 정적 export 결정과 함께 미결이며, 구현에서 처음 연결할 때 정한다.

## D-29 지도 클라이언트 ID의 주입 방식(미결)
- Status: superseded by D-57
- Decision: FE가 네이버 지도 클라이언트 ID를 어떻게 얻는지(빌드 시점 `NEXT_PUBLIC_*` 환경변수, 런타임 설정 파일 등)는 보안 확인 후 정하며 미결이다. 이 기능은 키를 읽는 코드를 `PlaceMap.tsx` 안의 한 곳에 모으고, 값이 없으면 지도 영역을 비운다(D-13). 서버용 Client Secret은 브라우저로 내리지 않는다.

## D-30 검증 방식(자동완성 로직은 React와 분리해 테스트)
- Status: settled
- Decision: BE는 엔드포인트 3개를 `@WebMvcTest`로 확인한다(Mock 시나리오 포함). FE는 Vitest만 추가해 근처 필터, 거리 계산, 자동완성 로직(디바운스, 취소, 늦은 응답 무시)을 단위 테스트한다. 자동완성 로직은 React와 무관한 모듈로 분리하고 훅은 그 모듈을 감싸는 얇은 껍데기로 두며, `jsdom`과 `@testing-library/react`는 추가하지 않는다. E2E는 하지 않는다.
- Rejected: `jsdom`과 `@testing-library/react`로 훅을 직접 테스트 → 개발 의존성이 늘어난다.
- Anchors: `fe/package.json#scripts` (modify) · `fe/src/lib/nearby.test.ts#nearby` (new)

## D-31 범위와 목표(일정 제외)
- Status: superseded by D-49
- Decision: 자동완성, 추천 검색과 후속 조건 수정, 결과 목록과 지도, 장소 상세만 만든다(Jira S15P31A302-15, 27~30). 목표는 "Mock으로 끝까지 동작"이다. 데모 일정은 이 기능의 결정에 고려하지 않는다.
- Rejected: 검색 기록, 온보딩, 저장, 리뷰, 인증 → Jira에 없고 다른 담당이다.

## D-32 엔드포인트 3개와 패키지(루트 패키지 유지)
- Status: settled
- Decision: `GET /api/v1/places/suggest?q=`, `POST /api/v1/places/search`, `GET /api/v1/places/{id}`. 패키지는 `kr.co.fitdining.api.place`이고 DB와 JPA는 쓰지 않는다. 루트 패키지 `kr.co.fitdining.api`는 팀 합의로 유지한다.
- Rejected: `kr.co.fitdining.place` → `ApiApplication`을 옮겨야 하고 공용 뼈대를 건드린다.
- Anchors: `be/src/main/java/kr/co/fitdining/api/ApiApplication.java#ApiApplication` (reuse) · `be/src/main/java/kr/co/fitdining/api/place/PlaceController.java#PlaceController` (new)

## D-33 취향과 인증(취향은 검색에 쓰인다)
- Status: settled
- Decision: 취향은 요청 본문의 선택 필드(`preferences`, 태그 코드 목록)로 받고, JWT는 읽지 않는다. 실제 검색은 취향을 결과에 반영한다(팀 확인). Mock은 받아 두기만 하고 결과에 반영하지 않는다.

## D-34 Mock의 규모, 시나리오, 노출 범위(prod는 실제 데이터)
- Status: superseded by D-47
- Decision: Mock 장소는 25곳 이상이라 20개 페이징과 `nextCursor`가 실제로 나온다. 시나리오는 요청 헤더 `X-Mock-Scenario`로 고르고, FE는 주소창의 `?mock=empty`를 읽어 이 헤더를 붙인다. 지금은 `empty`만 만들고 `error`는 필요해질 때 추가한다. 헤더가 없으면 정상 결과이며, "근처"가 들어간 검색어는 AI의 해석을 흉내 내 `nearby: true`로 응답한다. 후속 검색에서 Mock은 받은 `previousConditions`를 그대로 `conditions`에 담아 돌려준다. Mock은 설정 스위치(`*_ENABLED` 방식)로 켜고 local과 dev에서만 켠다. prod는 실제 데이터만 보여 주며 Mock을 켜지 않는다. 실제 구현이 없으면 검색 API는 503을 돌려주고, 스위치 이름은 환경변수 계약(`docs/infra/contracts/env.md`)에 올린다.
- Rejected: 검색어 부분 문자열로 시나리오 분기("근처", "없음") → 평범한 문장과 충돌하고 우선순위가 없다. 입력창에 `mock:empty` 같은 명령어 입력 → 직관적이지 않다. 개발용 선택 상자 → 지금은 과하다. prod에서 Mock으로 시연 → 팀이 실제 데이터로 보여 주기로 했다.
- Anchors: `be/src/main/java/kr/co/fitdining/api/place/MockPlaceSearchEngine.java#MockPlaceSearchEngine` (new) · `be/src/main/resources/mock/places.json#places` (new)

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
- Decision: FE는 항상 상대 경로 `/api/v1/...`를 부르고, Next.js 서버가 `next.config.ts`의 `rewrites`로 `/api/:path*`를 BE에 넘긴다. 대상 주소는 환경변수 `API_PROXY_TARGET`(기본값 `http://localhost:8080`)이다. BE는 CORS를 설정하지 않는다.
- Rejected: BE CORS 허용 → Node 서버가 있으니 프록시로 같은 출처를 유지하는 편이 단순하다.
- Anchors: `fe/next.config.ts#nextConfig` (modify)

## D-40 BE 설정을 yml로 옮기고 접속 정보에 로컬 기본값을 둔다
- Status: settled
- Decision: `application.properties`를 `application.yml`로 바꾼다. `spring.datasource.url`, `username`, `password`는 `${SPRING_DATASOURCE_URL:jdbc:postgresql://127.0.0.1:15432/fit_dev}`, `${SPRING_DATASOURCE_USERNAME:fit_dev_app}`처럼 `infra/local` 기준의 로컬 기본값을 두고, 비밀번호는 기본값 없이 `be/.env`(gitignore)에서 `spring.config.import=optional:file:.env[.properties]`로 읽는다. 예제는 `be/.env.example`에 둔다. 웹 앱은 DML 전용 계정으로 접속해 부팅할 때 Flyway가 실패하므로 `spring.flyway.enabled=false`로 둔다(`docs/infra/design.md` §9의 웹 프로필). 마이그레이션 전용 프로필은 팀 몫이다. 운영 값은 계속 환경변수(`docs/infra/contracts/env.md`)로 넘긴다.
- Rejected: 공용 뼈대 설정을 바꾸지 않고 환경변수 세 개로 띄우기 → 팀이 이 기능에서 정리하기로 했다.
- Anchors: `be/src/main/resources/application.yml#spring` (new)

## D-41 절대 일어나면 안 되는 일(설정 위치 변경)
- Status: settled
- Decision: 요청에 위치 좌표 필드가 없고 응답에 외부 리뷰 필드가 없다는 것은 **이름 있는 필드 수준의 보장**이다. 요청 본문은 알 수 없는 속성이 오면 거부해서 클라이언트가 `lat`, `lng` 같은 필드를 몰래 실어 보내도 받지 않는다. 이 설정은 `application.yml`에 둔다(D-40). 자유 텍스트 필드(`reasons`, `caution`, `labels`, `preferences`)의 내용은 검증하지 않으며, 외부 리뷰 원문이나 좌표가 담기지 않게 하는 책임은 제공자(AI 파트)에게 있다(감수한 트레이드오프). 제공자의 약속은 점수 0~100 정수, 근거 없는 특징 미표시, 확인할 수 없는 지역 조건 장소 제외다. FE는 점수를 정수 그대로 `%` 없이 표시한다.
- Anchors: `be/src/main/resources/application.yml#spring` (new)

## D-42 근처 모드(기기 위치 사용 확정)
- Status: superseded by D-46
- Decision: 근처 모드는 기기 위치를 쓰되 서버로 보내지 않는다. 서버는 위치 없이 후보 전체(최대 약 100)를 점수순으로, 커서 없이 `nearby: true`로 내려준다. FE(웹과 설치한 PWA 모두)는 이 응답이 왔을 때 처음 `navigator.geolocation`으로 위치 권한을 요청하고, 허용되면 현재 위치와 반경으로 항목을 거른다. 거부되거나 위치를 얻지 못하면 지도 영역(`mapBounds`)을 검색 대상 지역으로 보내는 방식으로 대체한다. 반경은 FE 상수이며 임시값은 1000m이다. `mapBounds`는 사용자의 위치가 아니라 검색 대상 지역으로 취급하며(PRD §7.1), "이 지역에서 검색"을 눌렀을 때와 위치를 얻지 못했을 때만 보낸다. "내 위치"를 누른 직후의 지도 영역이 위치를 대략 드러낼 수 있다는 위험은 감수하고, 위치 정책의 재검토는 PRD OQ-18을 따른다.
- Rejected: 좌표 서버 전송 → 위치정보법 신고 대상이 될 가능성(PRD D-03). 위치를 쓰지 않고 지역 안 상위 몇 개만 표시 → 팀이 기기 위치 사용을 택했다.

## D-43 FE 구조(팀 확인)
- Status: settled
- Decision: UI 컴포넌트는 `src/app/components`, 화면이 아닌 로직(API 호출, DTO 타입, 근처 필터, 자동완성 로직과 훅)은 `src/lib`에 둔다. `features/` 폴더는 쓰지 않는다. 팀이 이 구조를 확인했다.
- Rejected: `src/features/place-search` → 규칙이 없고, `src/app` 안 colocation이 Next 문서상 안전하며 파일 수가 적다.
- Anchors: `fe/src/app/page.tsx#Home` (modify) · `fe/src/app/place/page.tsx#PlaceDetailPage` (new) · `fe/src/lib/placeApi.ts#searchPlaces` (new)

## D-44 DTO 정정(장소 id는 정수)
- Status: superseded by D-53
- Decision: 요청은 query, preferences?, previousConditions?, mapBounds?, cursor?. 응답은 conditions, nearby, items[], nextCursor?, emptyReason?. 검색 응답의 항목(카드)은 place, score, labels[2], caution?에 더해 `reasons`와 `missingEvidenceNotes`를 담는다. 이 값은 요청과 취향에 따라 달라지므로 장소 ID만 받는 상세 API가 만들 수 없고, 과거 추천을 열 때도 이유를 복원해야 한다(PRD FR-08, FR-03). 이 값을 만드는 주체는 검색 결과 제공자(AI 파트)이며, 상세 API가 검색 맥락을 같이 받는 안도 열려 있어 검색이 구체화될 때까지 미결이다. 상세 응답은 장소 고유 정보(hours, menus, facilities)만 담는다. 후보는 place 또는 "이 조건으로 추천받기"다. `score`는 정수 타입이고 `conditions`와 `previousConditions`는 BE와 FE가 해석하지 않는 불투명한 JSON 객체다. 장소 `id`는 ERD의 `places.place_id`(bigint)를 따라 정수이며 BE는 `long`, JSON은 숫자, FE는 `number`로 다룬다. Mock은 1부터 차례로 번호를 매긴다. 404, 후보 항목의 구분 필드, `q` 길이 제한은 spec에서 정한다. BE는 내용을 검증하거나 가공하지 않는다.
- Rejected: 문자열 id(`p-001`, UUID) → ERD가 bigint PK로 정했다.
- Anchors: `be/src/main/java/kr/co/fitdining/api/place/PlaceDtos.java#PlaceDtos` (new)

## D-45 후속 조건과 페이징(새 검색과 후속 조건의 구분)
- Status: superseded by D-50
- Decision: 응답의 `conditions`를 FE가 `previousConditions`로 되돌려 보낸다(서버는 상태 없음). 검색 측이 `thread_id`로 관리하는 방식은 미결이며, 채택되면 필드만 교체한다. 페이징은 불투명한 `nextCursor`를 쓰고 한 번에 20개다. 결과가 떠 있는 동안 검색창 입력은 후속 조건으로 보고 현재 `conditions`를 `previousConditions`로 붙이며, 화면에 이전 조건에 이어서 검색 중임을 표시한다. "새로 검색" 버튼을 누르면 조건을 비우고 다음 입력은 새 검색이 된다. 이 구분 방식은 임시이며 바뀔 수 있다.
- Rejected: 결과 위에 별도 후속 입력창 → 화면이 늘어난다. 자동완성 ACTION으로만 후속 → 사용자가 발견하기 어렵다.

## D-46 근처 모드(위치 실패 시 동작 명시)
- Status: superseded by D-52
- Decision: 근처 모드는 기기 위치를 쓰되 서버로 보내지 않는다. 서버는 위치 없이 후보 전체(최대 약 100)를 점수순으로, 커서 없이 `nearby: true`로 내려준다. FE(웹과 설치한 PWA 모두)는 이 응답이 왔을 때 `navigator.geolocation`으로 위치를 요청하고, 허용되면 현재 위치와 반경으로 항목을 거른다. 반경은 FE 상수이며 임시값은 1000m이다. 위치를 얻지 못하면(거부, 오류, 시간 초과) 자동으로 다시 검색하지 않고 받은 근처 응답을 거르지 않은 채 보여 주며 위치를 확인할 수 없다고 알린다. 그 뒤의 검색 요청에는 지도 영역(`mapBounds`)을 검색 대상 지역으로 담는다. `mapBounds`는 사용자의 위치가 아니라 검색 대상 지역으로 취급하며(PRD §7.1), "이 지역에서 검색"을 눌렀을 때와 위치를 얻지 못한 뒤에만 보낸다. "내 위치"를 누른 직후의 지도 영역이 위치를 대략 드러낼 수 있다는 위험은 감수하고, 위치 정책의 재검토는 PRD OQ-18을 따른다.
- Rejected: 좌표 서버 전송 → 위치정보법 신고 대상이 될 가능성(PRD D-03). 위치를 쓰지 않고 지역 안 상위 몇 개만 표시 → 팀이 기기 위치 사용을 택했다. 위치 실패 즉시 `mapBounds`로 자동 재검색 → Mock처럼 근처 응답이 다시 오면 반복될 수 있다.

## D-47 Mock의 규모, 시나리오, 노출 범위(인프라 문서는 고치지 않음)
- Status: superseded by D-63
- Decision: Mock 장소는 25곳 이상이라 20개 페이징과 `nextCursor`가 실제로 나온다. 시나리오는 요청 헤더 `X-Mock-Scenario`로 고르고, FE는 주소창의 `?mock=empty`를 읽어 이 헤더를 붙인다. 지금은 `empty`만 만들고 `error`는 필요해질 때 추가한다. 헤더가 없으면 정상 결과이며, "근처"가 들어간 검색어는 AI의 해석을 흉내 내 `nearby: true`로 응답한다. 후속 검색에서 Mock은 받은 `previousConditions`를 그대로 `conditions`에 담아 돌려준다. Mock은 설정 스위치(`PLACE_MOCK_ENABLED`)로 켜고 local과 dev에서만 켠다. prod는 실제 데이터만 보여 주며 Mock을 켜지 않는다. 실제 구현이 없으면 검색 API는 503을 돌려준다. 이 기능은 `docs/infra/` 아래 문서(`contracts/env.md` 포함)를 고치지 않으며, 스위치를 환경변수 계약에 올리는 일은 인프라 담당에게 알린다.
- Rejected: 검색어 부분 문자열로 시나리오 분기("근처", "없음") → 평범한 문장과 충돌하고 우선순위가 없다. 입력창에 `mock:empty` 같은 명령어 입력 → 직관적이지 않다. 개발용 선택 상자 → 지금은 과하다. prod에서 Mock으로 시연 → 팀이 실제 데이터로 보여 주기로 했다. 이 기능에서 `env.md`에 행 추가 → 인프라 담당의 문서다.
- Anchors: `be/src/main/java/kr/co/fitdining/api/place/MockPlaceSearchEngine.java#MockPlaceSearchEngine` (new) · `be/src/main/resources/mock/places.json#places` (new)

## D-48 지도(네이버 웹 SDK 사용 방식과 핀 연동)와 자동완성 디바운스
- Status: superseded by D-51
- Decision: 네이버 지도 웹 SDK(JavaScript v3)를 `PlaceMap` 한 컴포넌트에서만 `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=<Client ID>`로 동적 로드한다(파라미터는 `ncpKeyId`, 서브 모듈은 로드하지 않는다). 키가 없거나 `window.navermap_authFailure`가 호출되면 지도 영역만 비우고 목록은 동작한다. "이 지역에서 검색"은 버튼을 눌렀을 때만 `map.getBounds()`를 읽는다(팀 실측: 사용량과 네트워크 요청이 늘지 않음). 핀은 HTML 아이콘으로 점수를 표시하고, 핀을 누르면 해당 카드를 선택하고 핀을 강조하며, 카드를 누르면 지도가 그 핀으로 이동(`panTo`)하고 선택한다. 상세 화면은 카드 안의 별도 버튼으로 연다. 자동완성은 300ms 안팎 디바운스, 빈 입력 미요청, 이전 요청 취소, 늦게 온 응답 무시를 지킨다. 근거: 팀의 공식 지도 API 정리와 시험 페이지(`~/Desktop/A302/naver-map-official-api.md` §5.4, §5.6).
- Rejected: 근처 필터에 SDK의 `getProjection().getDistance` 사용 → 지도 키가 없으면 쓸 수 없다. haversine 순수 함수로 계산한다(실측 차이 1m). 결과에 맞춘 화면 맞춤(`fitBounds`)과 내 위치 표시 → 팀이 이번 범위에서 뺐다. geocoder 등 서브 모듈 → 필요 없고 검색어를 네이버로 보낸다.
- Anchors: `fe/src/app/components/PlaceMap.tsx#PlaceMap` (new)

## D-49 범위와 목표(Figma 화면 기준)
- Status: settled
- Decision: 자동완성, 추천 검색과 후속 조건, 이번 세션의 요청 기록, 결과 목록과 지도, 장소 상세만 만든다(Jira S15P31A302-15, 27~30). 화면 기준은 Figma 파일 `VC2HKXkesDRQjbLoqey1B5`의 "5. 검색·추천 결과"(5-01, 5-03~5-07)와 "6. 장소 상세"(6-01, 6-02, 6-04, 6-05)다. 목표는 "Mock으로 끝까지 동작"이며 데모 일정은 고려하지 않는다.
- Rejected: 5-02 "이 조건으로 추천받기" 토글 → 다음 기능으로 미룬다. 5-08 지난날 결과 보기 → 서버 저장과 인증이 필요하다. 6-03 리뷰 탭, 6-06~6-12 리뷰 수정·삭제·신고, "방문 평가 남기기", 저장, 프로필, 공유 → 다른 담당이다. 검색 기록(서버 저장), 온보딩, 인증 → Jira에 없고 다른 담당이다.

## D-50 새 검색과 후속 조건의 입력 분리, 이번 세션의 요청 기록
- Status: settled
- Decision: 응답의 `conditions`를 FE가 `previousConditions`로 되돌려 보낸다(서버는 상태 없음). 검색 측이 `thread_id`로 관리하는 방식은 미결이며, 채택되면 필드만 교체한다. 페이징은 불투명한 `nextCursor`를 쓰고 한 번에 20개다. 결과가 없을 때는 위쪽 검색창(자동완성 있음)이 새 검색이고, 결과가 있을 때는 결과 패널 아래 입력창("조건을 더 말해 보세요", 자동완성 없음)이 항상 후속 조건이다. 패널의 "새 검색"은 결과를 비우고 위쪽 검색창으로 돌아간다. 요청 기록(5-07)은 이번 페이지 세션의 요청을 FE 메모리에 쌓아 보여 주고, "결과 보기"는 요청 없이 그 시점의 결과로 돌아가며, "여기서 이어 검색"은 그 시점의 `conditions`를 다음 후속 조건의 기준으로 삼는다.
- Rejected: 검색창 하나를 상태에 따라 새 검색과 후속으로 나눠 쓰기 → 디자인과 다르고 사용자가 헷갈린다.

## D-51 지도(네이버 웹 SDK, 순위 핀, 핀과 카드 연동)와 자동완성 디바운스
- Status: settled
- Decision: 네이버 지도 웹 SDK(JavaScript v3)를 `PlaceMap` 한 컴포넌트에서만 `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=<Client ID>`로 동적 로드한다(서브 모듈 없음). 키가 없거나 `window.navermap_authFailure`가 호출되면 지도 영역만 비우고 목록은 동작한다. "이 지역에서 검색"은 버튼을 눌렀을 때만 `map.getBounds()`를 읽는다. 핀과 카드에는 같은 순위 번호를 표시하고(디자인 5-04), 선택된 핀은 강조한다. 핀을 누르면 그 카드를 선택하고, 선택되지 않은 카드를 누르면 지도가 그 핀으로 이동하며 선택하고, 선택된 카드를 다시 누르면 장소 상세로 간다. 자동완성은 300ms 안팎 디바운스, 빈 입력 미요청, 이전 요청 취소, 늦게 온 응답 무시를 지킨다. 근거: 팀의 공식 지도 API 정리와 시험 페이지(`~/Desktop/A302/naver-map-official-api.md` §5.4, §5.6).
- Rejected: 핀에 점수 표시 → 디자인은 순위 번호다. 근처 필터에 SDK의 `getDistance` 사용 → 지도 키가 없으면 쓸 수 없다. 결과에 맞춘 화면 맞춤(`fitBounds`) → 이번 범위에서 뺐다. geocoder 등 서브 모듈 → 필요 없고 검색어를 네이버로 보낸다.
- Anchors: `fe/src/app/components/PlaceMap.tsx#PlaceMap` (new)

## D-52 위치 사용(내 위치 버튼과 근처 모드)
- Status: settled
- Decision: 기기 위치는 서버로 보내지 않는다. 위치 권한은 사용자가 지도의 "내 위치" 버튼을 누르거나 근처 응답(`nearby: true`)을 받았을 때 요청한다. 위치를 얻으면 지도에 내 위치 점을 표시하고, 자동완성 후보, 카드, 상세의 거리를 브라우저에서 계산해 보여 준다. 위치가 없으면 거리를 숨긴다. 근처 응답은 서버가 위치 없이 후보 전체(최대 약 100)를 점수순으로, 커서 없이 내려주고, FE가 현재 위치와 반경(FE 상수, 임시 1000m)으로 거른다. 위치를 얻지 못하면 자동으로 다시 검색하지 않고 근처 응답을 거르지 않은 채 보여 주며 알린다. 그 뒤의 검색 요청에는 지도 영역(`mapBounds`)을 검색 대상 지역으로 담는다. `mapBounds`는 사용자의 위치가 아니라 검색 대상 지역으로 취급하며(PRD §7.1), "이 지역에서 검색"을 눌렀을 때와 위치를 얻지 못한 뒤에만 보낸다. 위치 정책의 재검토는 PRD OQ-18을 따른다.
- Rejected: 좌표 서버 전송 → 위치정보법 신고 대상이 될 가능성(PRD D-03). 화면을 열자마자 권한 요청 → 팀이 버튼 방식을 택했다. 위치 실패 즉시 `mapBounds`로 자동 재검색 → 근처 응답이 다시 오면 반복될 수 있다.

## D-53 DTO를 디자인에 맞게 확장
- Status: superseded by D-54
- Decision: Mock과 DTO를 Figma 5, 6 화면이 요구하는 필드까지 늘리고, AI 파트 계약이 정해지면 이 DTO를 기준으로 맞춘다. 장소 요약에 대표 사진, 자동완성 후보에 일치한 메뉴 이름, 검색 응답에 전체 건수와 조건 변경 요약, 카드에 영업 상태와 구조화된 추천 이유(제목, 출처가 붙은 칩, 인용과 출처)와 핏 점수 설명 항목(출처, 항목, 반영 여부, 근거 수), 상세에 장소 특징 라벨, 사진, 전화, 웹사이트, 영업 상태, 라스트오더, 휴무 안내, 메뉴 카테고리와 사진을 더한다. 근거가 부족한 항목은 핏 점수 설명 항목의 "반영 안 됨"으로 나타내며 별도의 `missingEvidenceNotes`는 두지 않는다. 장소 `id`는 ERD의 `places.place_id`(bigint)를 따라 정수다. 추천 이유와 핏 점수 설명은 요청과 취향에 따라 달라지므로 검색 응답 카드에 담고 상세 응답에는 장소 고유 정보만 담는다. 이 값을 만드는 주체는 검색 결과 제공자(AI 파트)이며, 상세 API가 검색 맥락을 받는 안도 열려 있어 검색 구체화 뒤에 다시 정한다. `score`는 정수, `conditions`와 `previousConditions`는 BE와 FE가 해석하지 않는 불투명한 JSON 객체다. BE는 내용을 검증하거나 가공하지 않는다.
- Rejected: 지금 DTO를 유지하고 디자인 일부를 비워 두기 → 팀이 디자인대로 그리기로 했다. 문자열 id → ERD가 bigint PK다.
- Anchors: `be/src/main/java/kr/co/fitdining/api/place/PlaceDtos.java#PlaceDtos` (new)

## D-54 DTO를 팀 BE 컨벤션에 맞춰 파일로 나눈다
- Status: superseded by D-64
- Decision: D-53의 필드 구성은 그대로 두고, 팀 BE 컨벤션(`be/docs/convention.md`)에 맞춰 DTO를 `kr.co.fitdining.api.place.dto` 패키지에 클래스마다 파일 하나로 둔다. 엔드포인트의 요청과 응답은 `PlaceSuggestResponse`(자동완성 후보 1개), `PlaceSearchRequest`, `PlaceSearchResponse`, `PlaceDetailResponse`이고, 하위 구조(`PlaceSummary`, `PlaceCard`, `Reason`, `ReasonTag`, `ScoreItem`, `EmptyReason`, `MapBounds`, `Hours`, `Menu`)와 enum도 같은 패키지에 하나씩 둔다. 역직렬화되는 record(요청과 Mock이 읽는 `places.json` 매핑 모두)의 숫자와 boolean은 박싱 타입(`Long`, `Integer`, `Double`, `Boolean`)이다. 장소 `id`는 ERD의 `places.place_id`(bigint)를 따라 정수다. 추천 이유와 핏 점수 설명은 검색 응답 카드에 담고 상세 응답에는 장소 고유 정보만 담는다. 이 값을 만드는 주체는 AI 파트이며, 상세 API가 검색 맥락을 받는 안도 열려 있어 검색 구체화 뒤에 다시 정한다. `conditions`와 `previousConditions`는 BE와 FE가 해석하지 않는 불투명한 JSON 객체다. BE는 엔진이 돌려준 내용을 검증하거나 가공하지 않는다.
- Rejected: `PlaceDtos` 한 파일에 모으기 → 여러 사람이 DTO를 고칠 때 병합 충돌이 잦고 컨벤션의 이름 규칙과 다르다. 원시 타입 record → Jackson 3에서 값이 빠진 원시 타입은 원인을 알기 어려운 400이 된다.
- Anchors: `be/src/main/java/kr/co/fitdining/api/place/dto/PlaceSearchRequest.java#PlaceSearchRequest` (new) · `be/src/main/java/kr/co/fitdining/api/place/dto/PlaceSearchResponse.java#PlaceSearchResponse` (new) · `be/src/main/java/kr/co/fitdining/api/place/dto/PlaceSuggestResponse.java#PlaceSuggestResponse` (new) · `be/src/main/java/kr/co/fitdining/api/place/dto/PlaceDetailResponse.java#PlaceDetailResponse` (new)

## D-55 입력 형식 검증은 Bean Validation(`@Valid`)으로 한다
- Status: settled
- Decision: 팀 BE 컨벤션에 따라 형식 검증은 요청 DTO와 요청 파라미터의 Bean Validation 어노테이션(`@NotBlank`, `@Size(max = 200)`)과 `@Valid`/`@Validated`로 한다. 필요한 `spring-boot-starter-validation` 의존성은 사용자가 `be/build.gradle`에 직접 추가하며, 이 기능의 구현은 그 밖의 `build.gradle` 변경을 하지 않는다. 검증 실패는 `PlaceExceptionHandler`가 400 ProblemDetail로 바꾼다.
- Rejected: 컨트롤러에서 직접 검증 → 컨벤션과 다르다.

## D-56 컨트롤러와 엔진 사이에 얇은 PlaceService를 둔다
- Status: settled
- Decision: 팀 BE 컨벤션에 따라 존재 여부 같은 비즈니스 판단은 Service에서 한다. `PlaceController`는 `PlaceService`에 위임만 하고, `PlaceService`가 `PlaceSearchEngine`을 선택적 의존성으로 받아 엔진이 없으면 503 예외를, `findPlace`가 비어 있으면 404 예외를 던진다. `PlaceService`도 엔진이 돌려준 값을 가공하지 않는다.
- Rejected: 컨트롤러가 404와 503을 직접 처리 → 컨벤션과 다르다.
- Anchors: `be/src/main/java/kr/co/fitdining/api/place/PlaceService.java#PlaceService` (new)

## D-57 지도 클라이언트 ID는 FE의 `/config.json`으로 전달한다
- Status: settled
- Decision: 인프라 설계(`docs/infra/design.md` §12.5 #3, `contracts/env.md`의 "프런트 런타임 설정")에 맞춰 브라우저가 쓰는 공개 값은 FE(Next.js)의 `/config.json` 라우트가 런타임 환경변수에서 읽어 돌려준다. 이 기능에서 `fe/src/app/config.json/route.ts`를 새로 만들고, 계약의 `env`(`APP_ENV`)와 새 키 `naverMapClientId`(환경변수 `NAVER_MAP_CLIENT_ID`)만 돌려준다. 로컬은 `fe/.env.local`에 둔다. 브라우저는 앱이 시작될 때 한 번 받아 메모리에 두고, `PlaceMap`은 그 값을 쓴다. 값이 없으면 지도 영역을 비운다. 네이버 지도 Client ID는 스크립트 주소에 드러나는 공개 키이고 도메인 등록과 한도로 보호되며, Client Secret은 브라우저로 보내지 않는다. `NAVER_MAP_CLIENT_ID`를 env 계약에 올리는 일은 인프라 담당에게 알린다(이 기능은 `docs/infra/`를 고치지 않는다).
- Rejected: `NEXT_PUBLIC_*` 빌드 시점 주입 → 인프라 설계가 금지하고, CI 빌드에서 값을 빠뜨리면 빈 지도가 이미지에 굳는다. SSR로 HTML에 넣기 → 인프라 문서의 공개 값 경로와 달라진다.
- Anchors: `fe/src/app/config.json/route.ts#GET` (new)

## D-58 로컬에서 FE가 BE를 부르는 방법(개발 서버 전용 프록시)
- Status: settled
- Decision: FE는 항상 상대 경로 `/api/v1/...`를 부른다. 운영에서는 Caddy가 `/api/*`를 BE로 보낸다. 로컬에서는 `next dev`일 때만 `next.config.ts`의 `rewrites`가 `/api/:path*`를 `BE_INTERNAL_URL`(인프라가 정한 FE 서버의 BE 주소 이름, 기본값 `http://localhost:8080`)로 넘긴다. 운영 빌드에는 rewrites가 없어 산출물에 `localhost`가 남지 않는다. BE는 CORS를 설정하지 않는다.
- Rejected: 항상 켜는 rewrites와 `API_PROXY_TARGET` 이름 → 운영 빌드 산출물에 `localhost`가 남아 인프라의 산출물 검사에 걸리고, 인프라가 정한 이름과 다르다. BE CORS 허용 → 같은 출처를 유지하는 편이 단순하다.
- Anchors: `fe/next.config.ts#nextConfig` (modify)

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
- Decision: BE는 인터페이스 하나(`PlaceSearchEngine`)만 두고 Mock 구현을 꽂는다. 요청 해석, 임베딩, OpenSearch 질의, 리랭크, 점수 계산을 이어 붙이는 주체는 미결이다. 구현을 교체할 때 DTO뿐 아니라 이 인터페이스의 시그니처(실패, 폴백 표시, 타임아웃 처리)도 바뀔 수 있으며, 이를 감수한다. 타임아웃, 서킷 브레이커, 예산, 속도 제한, `X-Fallback` 헤더는 이번 범위가 아니고 연동 시점에 다룬다(`docs/infra/design.md` §11.2, §12.1). 교체 지점인 엔진 관련 파일(`PlaceSearchEngine`, 그 구현, 엔진 계약의 예외 `InvalidCursorException`)은 하위 패키지 `kr.co.fitdining.api.place.engine`에 모아 교체 지점이 구조로 드러나게 한다. 엔진은 장소 기능 전용이라 최상위 패키지로 빼지 않는다.
- Rejected: BE가 Modal과 OpenSearch를 직접 호출(`docs/infra/design.md` §12.2 제안) → 담당이 정해지지 않았다. 지금 실패 모델을 인터페이스에 넣기 → 실제 계약이 없어서 추측이 된다. 최상위 `kr.co.fitdining.api.search` → 엔진 시그니처가 `place.dto`를 써서 상호 의존이 생기고, 다른 기능이 함께 쓰는 모듈이 아니다. 이름에 `I` 접두사나 `Impl` 접미사 → Java 주류가 아니고, 구현이 Mock과 실제 엔진처럼 여럿이라 구현 이름은 특징을 담는다.
- Anchors: `be/src/main/java/kr/co/fitdining/api/place/engine/PlaceSearchEngine.java#PlaceSearchEngine` (new)

## D-63 Mock의 규모, 시나리오, 노출 범위(Mock 위치는 `place.engine`)
- Status: settled
- Decision: Mock 장소는 25곳 이상이라 20개 페이징과 `nextCursor`가 실제로 나온다. 시나리오는 요청 헤더 `X-Mock-Scenario`로 고르고, FE는 주소창의 `?mock=empty`를 읽어 이 헤더를 붙인다. 지금은 `empty`만 만들고 `error`는 필요해질 때 추가한다. 헤더가 없으면 정상 결과이며, "근처"가 들어간 검색어는 AI의 해석을 흉내 내 `nearby: true`로 응답한다. 후속 검색에서 Mock은 받은 `previousConditions`를 그대로 `conditions`에 담아 돌려준다. Mock은 설정 스위치(`PLACE_MOCK_ENABLED`)로 켜고 local과 dev에서만 켠다. prod는 실제 데이터만 보여 주며 Mock을 켜지 않는다. 실제 구현이 없으면 검색 API는 503을 돌려준다. 이 기능은 `docs/infra/` 아래 문서(`contracts/env.md` 포함)를 고치지 않으며, 스위치를 환경변수 계약에 올리는 일은 인프라 담당에게 알린다. Mock 구현은 D-62에 따라 `kr.co.fitdining.api.place.engine`에 둔다.
- Rejected: 검색어 부분 문자열로 시나리오 분기("근처", "없음") → 평범한 문장과 충돌하고 우선순위가 없다. 입력창에 `mock:empty` 같은 명령어 입력 → 직관적이지 않다. 개발용 선택 상자 → 지금은 과하다. prod에서 Mock으로 시연 → 팀이 실제 데이터로 보여 주기로 했다. 이 기능에서 `env.md`에 행 추가 → 인프라 담당의 문서다.
- Anchors: `be/src/main/java/kr/co/fitdining/api/place/engine/MockPlaceSearchEngine.java#MockPlaceSearchEngine` (new) · `be/src/main/resources/mock/places.json#places` (new)

## D-64 DTO는 응답별 파일에 하위 타입을 중첩한다
- Status: settled
- Decision: D-53의 필드 구성은 그대로 두고 DTO를 `kr.co.fitdining.api.place.dto` 패키지에 둔다. 엔드포인트의 요청과 응답은 `PlaceSuggestResponse`(자동완성 후보 1개), `PlaceSearchRequest`, `PlaceSearchResponse`, `PlaceDetailResponse`이고 각각 파일 하나다. 여러 곳이 함께 쓰는 `PlaceSummary`, `OpenStatus`와 하위 구조가 많은 `PlaceCard`도 파일 하나씩 둔다. 부모 하나에서만 쓰는 하위 record와 enum은 그 부모 안에 중첩한다(`PlaceSummary`의 `CategoryGroup`, `Station`, `PlaceSuggestResponse`의 `SuggestType`, `PlaceSearchRequest`의 `MapBounds`, `PlaceSearchResponse`의 `EmptyReason`, `PlaceCard`의 `Reason`, `ReasonTag`, `ScoreItem`, `EvidenceSource`, `PlaceDetailResponse`의 `Hours`, `Menu`, `DayCode`, `Facility`). 응답 하나의 모양이 파일 하나에 보이게 하려는 것이며 JSON 모양은 바뀌지 않는다. 역직렬화되는 record(요청과 Mock이 읽는 `places.json` 매핑 모두)의 숫자와 boolean은 박싱 타입(`Long`, `Integer`, `Double`, `Boolean`)이다. 장소 `id`는 ERD의 `places.place_id`(bigint)를 따라 정수다. 추천 이유와 핏 점수 설명은 검색 응답 카드에 담고 상세 응답에는 장소 고유 정보만 담는다. 이 값을 만드는 주체는 AI 파트이며, 상세 API가 검색 맥락을 받는 안도 열려 있어 검색 구체화 뒤에 다시 정한다. `conditions`와 `previousConditions`는 BE와 FE가 해석하지 않는 불투명한 JSON 객체다. BE는 엔진이 돌려준 내용을 검증하거나 가공하지 않는다.
- Rejected: 클래스마다 파일 하나(D-54) → 파일이 20개라 응답 하나의 모양을 보려면 여러 파일을 열어야 한다. 하위 패키지(`dto/search` 등)로 묶기 → 파일 수가 줄지 않는다. `PlaceDtos` 한 파일에 모으기 → 여러 사람이 DTO를 고칠 때 병합 충돌이 잦고 컨벤션의 이름 규칙과 다르다. 원시 타입 record → Jackson 3에서 값이 빠진 원시 타입은 원인을 알기 어려운 400이 된다.
- Anchors: `be/src/main/java/kr/co/fitdining/api/place/dto/PlaceSearchRequest.java#PlaceSearchRequest` (new) · `be/src/main/java/kr/co/fitdining/api/place/dto/PlaceSearchResponse.java#PlaceSearchResponse` (new) · `be/src/main/java/kr/co/fitdining/api/place/dto/PlaceSuggestResponse.java#PlaceSuggestResponse` (new) · `be/src/main/java/kr/co/fitdining/api/place/dto/PlaceDetailResponse.java#PlaceDetailResponse` (new)

## D-65 `be/.env.example`의 DB 비밀번호는 `REPLACE_ME`로 둔다
- Status: settled
- Decision: 리뷰 기능(S15P31A302-18)이 먼저 master에 올린 `be/.env.example`의 `SPRING_DATASOURCE_PASSWORD=REPLACE_ME`를 따른다. 개발자는 복사한 뒤 이 값을 `infra/local/.env`의 `FIT_DEV_APP_PASSWORD`로 바꾸며, 파일 주석에 이 방법을 적는다. `PLACE_MOCK_ENABLED=true`는 그대로 둔다.
- Rejected: `infra/local` 예제와 같은 가짜 값(`local-app-password`)을 미리 넣기 → 팀이 정한 `REPLACE_ME` 표시(`docs/infra/contracts/env.md`의 "비밀이 아직 없다는 표시")와 어긋난다.
