package kr.co.fitdining.api.place;

import java.util.List;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse;
import kr.co.fitdining.api.place.dto.PlaceSearchRequest;
import kr.co.fitdining.api.place.dto.PlaceSearchResponse;
import kr.co.fitdining.api.place.dto.PlaceSuggestResponse;
import kr.co.fitdining.api.place.engine.PlaceSearchEngine;
import kr.co.fitdining.api.place.exception.PlaceNotFoundException;
import kr.co.fitdining.api.place.exception.PlaceSearchUnavailableException;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;

/** 엔진 유무(503)와 장소 존재 여부(404)만 판단하고, 엔진이 돌려준 값은 가공하지 않는다. */
@Service
@RequiredArgsConstructor
public class PlaceService {

	/**
	 * 실제 엔진이 아직 없어 Mock을 끈 환경에서는 엔진 빈이 없으므로 선택적으로 받는다(없으면 503).
	 * 실제 엔진이 Mock과 같은 스위치({@code place.mock.enabled})로 항상 하나 등록되면 직접 주입으로 바꾼다.
	 */
	private final ObjectProvider<PlaceSearchEngine> engineProvider;

	public List<PlaceSuggestResponse> suggest(String q) {
		return engine().suggest(q);
	}

	public PlaceSearchResponse search(PlaceSearchRequest request) {
		return engine().search(request);
	}

	public PlaceDetailResponse getPlace(long id) {
		return engine().findPlace(id).orElseThrow(PlaceNotFoundException::new);
	}

	private PlaceSearchEngine engine() {
		PlaceSearchEngine engine = engineProvider.getIfAvailable();
		if (engine == null) {
			throw new PlaceSearchUnavailableException();
		}
		return engine;
	}

}
