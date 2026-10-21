# 백엔드 코드 컨벤션

패키지 루트는 `kr.co.fitdining.api`입니다.

## 1. DTO
- Entity를 응답으로 직접 반환하지 않고 DTO를 씁니다.
- 요청과 응답 DTO를 나누고 역할이 드러나게 짓습니다 (예: `PlaceSearchRequest`, `PlaceDetailResponse`).
- 역직렬화되는 record의 숫자와 boolean은 박싱 타입(`Boolean`/`Integer`/`Long`)으로 받습니다. 요청 본문과 외부 API 응답 매핑 모두 해당합니다.
  - 이유: Jackson 3은 record의 원시 타입에 값이 없으면 예외를 던져, 필드를 생략한 요청이 `@Valid`에 닿기 전에 원인 불명의 400이 됩니다.
  - 생략을 기본값으로 다루려면 `Boolean.TRUE.equals(x)`처럼 감싼 판정 메서드를 둡니다.

## 2. Lombok
- `@Data`와 무분별한 `@Setter`는 금지합니다.
- DI는 `@RequiredArgsConstructor`, 조회는 `@Getter`를 씁니다.
- `@Builder`는 생성 인자나 선택 옵션이 많을 때만 씁니다.

## 3. 검증과 예외 처리
- 형식 검증은 DTO의 `@Valid`, 비즈니스 검증(권한, 중복, 존재 여부)은 Service에서 합니다.
- Controller 안에서 try-catch를 쓰지 않고, 예외는 `@RestControllerAdvice`가 `ProblemDetail`로 바꿉니다.
- 오류 응답은 `ProblemDetail`(`application/problem+json`)입니다.
  - 상태 코드와 `detail`로 오류를 식별하고, 업무 오류 코드는 두지 않습니다.
  - `detail`에는 일반 문구만 넣습니다. 예외 메시지, stack trace, 요청 본문은 서버 로그에만 남깁니다.
  - 같은 상태 코드 안에서 오류 종류를 구분해야 할 때만 `type`이나 확장 필드를 추가합니다.
- 예외 처리 클래스는 기능별로 둡니다. 예: `PlaceExceptionHandler`는 `@RestControllerAdvice(basePackageClasses = PlaceController.class)`로 장소 API에만 적용합니다.
- 공통 응답과 예외 형식은 BE 팀 논의 뒤 정합니다 (place-search spec D-10).

## 4. 로깅
- `@Slf4j`를 쓰고 `System.out.println`은 금지합니다.
- 값은 `{}` 플레이스홀더로 넣고 문자열을 `+`로 잇지 않습니다.
- 서버 내부 오류는 예외 객체를 마지막 인자로 넘깁니다: `log.error("Failed to load place detail: placeId={}", placeId, e);`
- 사용자 입력이 원인인 오류(400 등)는 예외 객체와 메시지를 넘기지 않고 서버가 만든 식별자만 남깁니다.
- 토큰, 비밀번호, Secret, 키 같은 민감정보와 사용자 입력(검색어, 요청 본문)은 남기지 않습니다.

## 5. 응답 구조 (잠정)
- 성공: DTO를 반환합니다. 상태는 HTTP 상태 코드로 표현합니다.
- 실패: 3번의 `ProblemDetail`입니다.
- 값이 null인 선택 필드는 JSON에서 생략합니다(`application.yml`의 null 제외 설정). 빈 객체와 빈 목록은 그대로 내보냅니다.

## 6. 테스트
- 메서드명은 영어 `method_scenario_expected`입니다.
- `@DisplayName`은 한글 "주제_상황_기대" 문장입니다.
- 한 테스트는 한 시나리오만 검증하고, 필요하면 `@Nested`로 묶습니다.

## 7. 주석
- 주석은 Javadoc으로 답니다.
- record는 필드마다 `@param`을 적고, 생략될 수 있는 값은 언제 생략되는지도 적습니다.
- 이름만으로 뜻이 드러나지 않는 enum 상수에도 붙입니다.
- 다른 파트와의 계약인 인터페이스는 메서드마다 `@param`, `@return`, `@throws`를 적습니다.
- 메서드 본문 안에서 이유를 짧게 남길 때는 `//`도 됩니다.
