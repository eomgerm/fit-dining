package kr.co.fitdining.api.place;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import kr.co.fitdining.api.auth.ports.AuthUseCases;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import kr.co.fitdining.api.place.dto.OpenStatus;
import kr.co.fitdining.api.place.dto.PlaceCard.EvidenceSource;
import kr.co.fitdining.api.place.dto.PlaceCard.Reason;
import kr.co.fitdining.api.place.dto.PlaceCard.ReasonTag;
import kr.co.fitdining.api.place.dto.PlaceCard.ScoreItem;
import kr.co.fitdining.api.place.dto.PlaceCard;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse.Break;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse.DayCode;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse.Hours;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse.Menu;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse;
import kr.co.fitdining.api.place.dto.PlaceSearchRequest;
import kr.co.fitdining.api.place.dto.PlaceSearchResponse.EmptyReason;
import kr.co.fitdining.api.place.dto.PlaceSearchResponse;
import kr.co.fitdining.api.place.dto.PlaceSuggestResponse.SuggestType;
import kr.co.fitdining.api.place.dto.PlaceSuggestResponse;
import kr.co.fitdining.api.place.dto.PlaceSummary.CategoryGroup;
import kr.co.fitdining.api.place.dto.PlaceSummary.Station;
import kr.co.fitdining.api.place.dto.PlaceSummary;
import kr.co.fitdining.api.place.engine.PlaceSearchEngine;
import kr.co.fitdining.api.place.engine.PlaceSearchResult;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.json.JsonCompareMode;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.json.JsonMapper;

/**
 * Mock 대신 계약을 벗어난 값을 돌려주는 가짜 엔진을 꽂아, 컨트롤러와 PlaceService가 엔진의 반환값을
 * 검증하거나 가공하지 않고 그대로 응답하는지 본다.
 */
@org.springframework.test.context.TestPropertySource(properties = {"auth.cookie-secure=false", "auth.frontend-origin=http://localhost:3000"})
@WebMvcTest(controllers = PlaceController.class, properties = "place.mock.enabled=false")
@Import({PlaceService.class, PlaceControllerPassThroughTest.FakeEngine.class})
class PlaceControllerPassThroughTest {

	static final PlaceSummary PLACE = new PlaceSummary(7L, "가짜 장소", CategoryGroup.BAR, Station.SEOLLEUNG, 0.0, -1.5,
			"https://example.com/t.jpg");

	static final List<PlaceSuggestResponse> SUGGESTIONS = List.of(
			new PlaceSuggestResponse(SuggestType.PLACE, PLACE, "메뉴", "PLACE에 붙은 라벨"),
			new PlaceSuggestResponse(SuggestType.PLACE, PLACE, null, null));

	static final PlaceSearchResponse SEARCH = new PlaceSearchResponse(
			conditions(),
			true,
			-3,
			List.of(new PlaceCard(PLACE, 150, List.of("하나", "둘", "셋"), "주의", OpenStatus.UNKNOWN,
					List.of(new Reason("이유", List.of(new ReasonTag(EvidenceSource.PREFERENCE, "취향")), null, null)),
					List.of(new ScoreItem(EvidenceSource.REQUEST, "항목", true, -1)))),
			"엔진의-커서",
			new EmptyReason("원인", "제안"),
			"요약");

	static final PlaceDetailResponse DETAIL = new PlaceDetailResponse(PLACE, "주소", List.of(), List.of("p.jpg"),
			"010", null, OpenStatus.BREAK,
			List.of(new Hours(DayCode.SUN, "25:00", "01:00", List.of(new Break("03:00", "02:00")), List.of(), false)),
			null, List.of(new Menu("분류", "이름", null, -100, null, List.of(), false, null)), List.of("무선 인터넷", "무선 인터넷"),
			List.of(), null, null, null, false, null, null, List.of(), null, List.of(), List.of(), List.of());

	private static Map<String, Object> conditions() {
		Map<String, Object> conditions = new LinkedHashMap<>();
		conditions.put("engineKey", Map.of("nested", 1));
		conditions.put("list", new ArrayList<>(Arrays.asList(1, null)));
		conditions.put("unset", null);
		return conditions;
	}

	@TestConfiguration
	static class FakeEngine implements PlaceSearchEngine {

		PlaceSearchRequest lastRequest;

		@Override
		public List<PlaceSuggestResponse> suggest(String q) {
			return SUGGESTIONS;
		}

		String lastUserId;
		String fallback;

		@Override
		public PlaceSearchResult search(PlaceSearchRequest request, String userId) {
			lastRequest = request;
			lastUserId = userId;
			return new PlaceSearchResult(SEARCH, fallback);
		}

		@Override
		public Optional<PlaceDetailResponse> findPlace(long id) {
			return id == 7 ? Optional.of(DETAIL) : Optional.empty();
		}

		@Override
		public List<Long> placeIds() {
			return List.of();
		}
	}

	@Autowired
	MockMvc mockMvc;

	@MockitoBean
	AuthUseCases auth;

	@Autowired
	JsonMapper jsonMapper;

	@Autowired
	FakeEngine fakeEngine;

	@Test
	@DisplayName("자동완성_엔진의반환값을_그대로응답한다")
	void suggest_fakeEngine_returnsEngineValueAsIs() throws Exception {
		mockMvc.perform(get("/api/v1/places/suggest").param("q", "아무거나"))
				.andExpect(status().isOk())
				.andExpect(content().json(jsonMapper.writeValueAsString(SUGGESTIONS), JsonCompareMode.STRICT));
	}

	@Test
	@DisplayName("추천검색_엔진의반환값을_그대로응답한다")
	void search_fakeEngine_returnsEngineValueAsIs() throws Exception {
		mockMvc.perform(post("/api/v1/places/search").contentType(MediaType.APPLICATION_JSON)
						.content("{\"query\":\"아무거나\",\"cursor\":\"엔진만 아는 값\"}"))
				.andExpect(status().isOk())
				.andExpect(content().json(jsonMapper.writeValueAsString(SEARCH), JsonCompareMode.STRICT));
		assertThat(fakeEngine.lastRequest.cursor()).isEqualTo("엔진만 아는 값");
	}

	@Test
	@DisplayName("추천검색_엔진의X-Fallback값을_헤더로그대로싣는다")
	void search_engineFallback_sentAsHeader() throws Exception {
		fakeEngine.fallback = "PREVIOUS_INVALID,TASTE_INVALID";
		try {
			mockMvc.perform(post("/api/v1/places/search").contentType(MediaType.APPLICATION_JSON)
							.content("{\"query\":\"아무거나\"}"))
					.andExpect(status().isOk())
					.andExpect(header().string("X-Fallback", "PREVIOUS_INVALID,TASTE_INVALID"));
		} finally {
			fakeEngine.fallback = null;
		}
	}

	@Test
	@DisplayName("추천검색_엔진의X-Fallback값이없으면_헤더가없다")
	void search_noEngineFallback_noHeader() throws Exception {
		mockMvc.perform(post("/api/v1/places/search").contentType(MediaType.APPLICATION_JSON)
						.content("{\"query\":\"아무거나\"}"))
				.andExpect(status().isOk())
				.andExpect(header().doesNotExist("X-Fallback"));
	}

	@Test
	@DisplayName("추천검색_유효한토큰이면_그사용자id만엔진에넘기고preferences는요청에남는다")
	void search_validToken_passesTokenUserIdOnly() throws Exception {
		when(auth.authenticate("token")).thenReturn(new AuthUseCases.Identity("user-1", "닉", "s", 0, 0));

		mockMvc.perform(post("/api/v1/places/search").contentType(MediaType.APPLICATION_JSON)
						.header("Authorization", "Bearer token")
						.content("{\"query\":\"아무거나\",\"preferences\":{\"mood\":\"QUIET\"}}"))
				.andExpect(status().isOk());
		assertThat(fakeEngine.lastUserId).isEqualTo("user-1");

		mockMvc.perform(post("/api/v1/places/search").contentType(MediaType.APPLICATION_JSON)
						.content("{\"query\":\"아무거나\",\"preferences\":{\"mood\":\"QUIET\"}}"))
				.andExpect(status().isOk());
		assertThat(fakeEngine.lastUserId).isNull();
	}

	@Test
	@DisplayName("장소상세_엔진의반환값을_그대로응답한다")
	void getPlace_fakeEngine_returnsEngineValueAsIs() throws Exception {
		mockMvc.perform(get("/api/v1/places/{id}", 7))
				.andExpect(status().isOk())
				.andExpect(content().json(jsonMapper.writeValueAsString(DETAIL), JsonCompareMode.STRICT));
	}

	@Test
	@DisplayName("장소상세_엔진이빈값을주면_404다")
	void getPlace_fakeEngineEmpty_returnsNotFound() throws Exception {
		mockMvc.perform(get("/api/v1/places/{id}", 8))
				.andExpect(status().isNotFound());
	}

}
