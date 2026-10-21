package kr.co.fitdining.api.place;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;
import kr.co.fitdining.api.place.dto.PlaceSearchRequest;
import kr.co.fitdining.api.place.dto.PlaceSearchResponse;
import kr.co.fitdining.api.place.dto.PlaceSuggestResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 장소 자동완성, 추천 검색 API. 요청 형식만 검증하고 처리는 {@link PlaceService}에 맡긴다.
 * 오류는 {@code PlaceExceptionHandler}가 ProblemDetail로 바꾼다.
 *
 * <p>클래스에 {@code @Validated}를 붙이지 않는다. 붙이면 Spring MVC 내장 메서드 검증이 꺼져
 * {@code q} 검증이 400으로 처리되지 않는다(D-59).
 */
@RestController
@RequestMapping("/api/v1/places")
@RequiredArgsConstructor
public class PlaceController {

	private final PlaceService placeService;

	/**
	 * 입력 중인 문장에 맞는 장소 후보를 돌려준다. "이 조건으로 추천받기" 항목이 항상 함께 온다.
	 *
	 * <p>오류: {@code q}가 없거나, 비었거나, 공백뿐이거나, 200자를 넘으면 400. 검색 엔진이 없으면 503.
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
	 * 요청도 같은 경로로 받는다. 결과가 없으면 오류가 아니라 200과 빈 목록이다.
	 *
	 * <p>오류: 본문을 읽을 수 없거나 정의되지 않은 속성이 있으면 400. {@code query}가 비었거나, 공백뿐이거나,
	 * 200자를 넘으면 400. {@code cursor}가 잘못되면 400. 검색 엔진이 없으면 503.
	 *
	 * @param request 추천 검색 요청
	 * @return 추천 결과
	 */
	@PostMapping("/search")
	public PlaceSearchResponse search(@Valid @RequestBody PlaceSearchRequest request) {
		return placeService.search(request);
	}

}
