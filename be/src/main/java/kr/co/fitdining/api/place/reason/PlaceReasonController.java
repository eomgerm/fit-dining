package kr.co.fitdining.api.place.reason;

import jakarta.validation.Valid;
import kr.co.fitdining.api.place.dto.PlaceReasonsRequest;
import kr.co.fitdining.api.place.dto.PlaceReasonsResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 상세 화면의 AI 추천 이유 API. 오류는 {@code PlaceExceptionHandler}가 ProblemDetail로 바꾼다.
 *
 * <p>{@code PlaceController}처럼 {@code @Validated}를 붙이지 않는다(D-59).
 */
@RestController
@ConditionalOnWebApplication
@RequestMapping("/api/v1/places")
@RequiredArgsConstructor
public class PlaceReasonController {

	private final PlaceReasonService service;

	/**
	 * 검색 결과 카드에서 연 상세의 추천 이유. 이유마다 제목과 펼쳤을 때 보일 근거를 돌려준다. 로그인은 선택이다.
	 * AI가 실패해도 카드의 대체 제목으로 200을 준다.
	 *
	 * <p>오류: 본문을 읽을 수 없거나 정의되지 않은 속성이 있거나, {@code reasons}가 1~4개가 아니거나 항목 형식이 틀리면 400.
	 * 장소가 없으면 404. 근거를 읽지 못하면 503.
	 *
	 * @param placeId 장소 id
	 * @param request 그 검색의 요청 문장과 카드의 {@code reasons}
	 * @return 요청 {@code reasons}와 같은 순서의 이유
	 */
	@PostMapping("/{placeId}/reasons")
	public PlaceReasonsResponse reasons(@PathVariable long placeId, @Valid @RequestBody PlaceReasonsRequest request) {
		return service.reasons(placeId, request);
	}

}
