package kr.co.fitdining.api.place;

import org.springframework.security.core.annotation.AuthenticationPrincipal;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;
import kr.co.fitdining.api.auth.ports.AuthUseCases;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse;
import kr.co.fitdining.api.place.dto.PlaceNearbyRequest;
import kr.co.fitdining.api.place.dto.PlaceRegionSearchRequest;
import kr.co.fitdining.api.place.dto.PlaceSearchRequest;
import kr.co.fitdining.api.place.dto.PlaceSearchResponse;
import kr.co.fitdining.api.place.dto.PlaceSuggestResponse;
import kr.co.fitdining.api.place.engine.PlaceSearchResult;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 장소 자동완성, 추천 검색, 상세 API. 요청 형식만 검증하고 처리는 {@link PlaceService}에 맡긴다.
 * 오류는 {@code PlaceExceptionHandler}가 ProblemDetail로 바꾼다.
 *
 * <p>클래스에 {@code @Validated}를 붙이지 않는다. 붙이면 Spring MVC 내장 메서드 검증이 꺼져
 * {@code q} 검증이 400으로 처리되지 않는다(D-59).
 *
 * <p>리뷰 API처럼 웹 서버로 뜰 때만 만든다. 마이그레이션 전용 {@code migrate} 프로필은 인증 빈을 만들지 않는다.
 */
@RestController
@ConditionalOnWebApplication
@RequestMapping("/api/v1/places")
@RequiredArgsConstructor
public class PlaceController {

	static final String FALLBACK_HEADER = "X-Fallback";

	private final PlaceService placeService;

	/**
	 * 입력 중인 문장에 맞는 장소 후보를 돌려준다. "이 조건으로 추천받기" 항목이 항상 함께 온다.
	 *
	 * <p>오류: {@code q}가 없거나, 비었거나, 공백뿐이거나, 200자를 넘으면 400. 검색 문서를 읽지 못하면 503.
	 *
	 * @param q 사용자가 입력 중인 문장(1~200자)
	 * @return 자동완성 후보 목록. 화면에 보일 순서대로다.
	 */
	@GetMapping("/suggest")
	public List<PlaceSuggestResponse> suggest(@RequestParam @NotBlank @Size(max = 200) String q) {
		return placeService.suggest(q);
	}

	/**
	 * 자연어 요청으로 장소를 추천한다. 후속 조건({@code previousConditions})과 다음 페이지({@code cursor})
	 * 요청도 같은 경로로 받는다. 결과가 없으면 오류가 아니라 200과 빈 목록이다. 로그인은 선택이다(place-ai-search D-4).
	 * AI 대신 처리했으면 {@code X-Fallback} 헤더에 이유를 쉼표로 이어 싣는다(D-7).
	 *
	 * <p>Authorization 헤더는 무시한다. 본문을 읽을 수 없거나 정의되지 않은 속성이 있거나,
	 * {@code query}가 비었거나 공백뿐이거나 200자를 넘거나, {@code preferences}가 가입의 검증에 맞지 않으면 400.
	 * 세션이 없으면 비회원으로 검색한다. 인증 주체가 있으면 본문의 취향 대신 회원 취향을 사용한다.
	 * 카탈로그 DB를 읽지 못하면 503.
	 *
	 * @param request 추천 검색 요청
	 * @param identity 선택적인 세션 인증 주체. 비회원은 null이다.
	 * @return 추천 결과
	 */
	@PostMapping("/search")
	public ResponseEntity<PlaceSearchResponse> search(@Valid @RequestBody PlaceSearchRequest request,
			@AuthenticationPrincipal AuthUseCases.Identity identity) {
		return respond(placeService.search(request, userId(identity)));
	}

	/**
	 * 홈 주변 카드. 지도 영역 안 장소를 10곳까지 준다(place-ai-search D-18). 인증, 응답, {@code X-Fallback}은
	 * {@link #search}와 같다.
	 *
	 * <p>오류: {@code mapBounds}가 없거나 네 값 중 하나라도 없거나, 유한하지 않거나, 위도·경도 범위 밖이거나, 남서쪽이 북동쪽보다
	 * 작지 않거나, 정의되지 않은 속성({@code query} 포함)이 있거나, {@code preferences}가 가입의 검증에 맞지 않으면 400.
	 *
	 * @param request 지도 영역과 비회원 답변
	 * @param identity 선택적인 세션 또는 Bearer 인증 주체. 비회원은 null이다.
	 * @return 주변 카드. {@code nearby}이고 커서가 없다.
	 */
	@PostMapping("/nearby")
	public ResponseEntity<PlaceSearchResponse> nearby(@Valid @RequestBody PlaceNearbyRequest request,
			@AuthenticationPrincipal AuthUseCases.Identity identity) {
		return respond(placeService.nearby(request, userId(identity)));
	}

	/**
	 * "이 지역에서 검색". 보던 결과의 조건을 지도 영역 안에서 다시 찾는다(place-ai-search D-18). 인증, 응답,
	 * {@code X-Fallback}, {@code cursor}는 {@link #search}와 같다.
	 *
	 * <p>오류: {@code query}가 비었거나 공백뿐이거나 200자를 넘거나, {@code mapBounds}가 {@link #nearby}의 검증에 맞지 않거나,
	 * {@code conditions}가 JSON 객체가 아니거나, 정의되지 않은 속성({@code previousConditions} 포함)이 있으면 400.
	 *
	 * @param request 보던 문장과 조건, 지도 영역
	 * @param identity 선택적인 세션 또는 Bearer 인증 주체. 비회원은 null이다.
	 * @return 추천 결과
	 */
	@PostMapping("/search/region")
	public ResponseEntity<PlaceSearchResponse> region(@Valid @RequestBody PlaceRegionSearchRequest request,
			@AuthenticationPrincipal AuthUseCases.Identity identity) {
		return respond(placeService.region(request, userId(identity)));
	}

	private static String userId(AuthUseCases.Identity identity) {
		return identity == null ? null : identity.userId();
	}

	private static ResponseEntity<PlaceSearchResponse> respond(PlaceSearchResult result) {
		ResponseEntity.BodyBuilder response = ResponseEntity.ok();
		if (result.fallback() != null) {
			response.header(FALLBACK_HEADER, result.fallback());
		}
		return response.body(result.response());
	}

	/**
	 * 장소 상세를 돌려준다. 핏 점수와 추천 이유는 담지 않는다(검색 카드에 있다).
	 *
	 * <p>오류: {@code id}가 정수가 아니면 400. 없는 장소면 404. DB를 읽지 못하면 503.
	 *
	 * @param id 장소 id
	 * @return 장소 상세
	 */
	@GetMapping("/{id}")
	public PlaceDetailResponse getPlace(@PathVariable long id) {
		return placeService.getPlace(id);
	}

	/**
	 * 상세를 열 수 있는 모든 장소의 id를 돌려준다. FE의 장소 sitemap이 쓴다. 로그인은 필요 없다.
	 *
	 * <p>오류: DB를 읽지 못하면 503.
	 *
	 * @return 장소 id 목록(오름차순)
	 */
	@GetMapping("/ids")
	public List<Long> placeIds() {
		return placeService.placeIds();
	}


}
