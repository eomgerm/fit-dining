package kr.co.fitdining.api.place;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.auth.ports.AuthUseCases;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse;
import kr.co.fitdining.api.place.dto.PlaceSearchRequest;
import kr.co.fitdining.api.place.dto.PlaceSearchResponse;
import kr.co.fitdining.api.place.dto.PlaceSuggestResponse;
import kr.co.fitdining.api.place.engine.PlaceSearchResult;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
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
	private static final String BEARER = "Bearer ";

	private final PlaceService placeService;
	private final AuthUseCases auth;

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
	 * <p>오류는 본문, 인증, {@code cursor} 순서로 판단한다. 본문을 읽을 수 없거나 정의되지 않은 속성이 있거나,
	 * {@code query}가 비었거나 공백뿐이거나 200자를 넘거나, {@code preferences}가 가입의 검증에 맞지 않으면 400.
	 * {@code Authorization} 헤더가 있는데 {@code Bearer} 토큰이 유효하지 않으면 401(만료면 {@code type}이
	 * {@code urn:fitdining:auth:access-token-expired}). {@code cursor}가 잘못되면 400(DB 모드에서는 있으면 400).
	 * 카탈로그 DB를 읽지 못하면 503.
	 *
	 * @param request 추천 검색 요청
	 * @param authorization 선택. {@code Bearer <AT>}
	 * @return 추천 결과
	 */
	@PostMapping("/search")
	public ResponseEntity<PlaceSearchResponse> search(@Valid @RequestBody PlaceSearchRequest request,
			@RequestHeader(name = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
		PlaceSearchResult result = placeService.search(request, authorization == null ? null : userId(authorization));
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

	private String userId(String authorization) {
		if (!authorization.startsWith(BEARER)) {
			throw new AuthFailure("로그인이 필요합니다.");
		}
		return auth.authenticate(authorization.substring(BEARER.length())).userId();
	}

}
