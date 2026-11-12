package kr.co.fitdining.api.place.reason;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.github.benmanes.caffeine.cache.Caffeine;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import kr.co.fitdining.api.place.PlaceService;
import kr.co.fitdining.api.place.dto.PlaceCard.EvidenceSource;
import kr.co.fitdining.api.place.dto.PlaceCard.Reason;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse;
import kr.co.fitdining.api.place.dto.PlaceReasonsRequest;
import kr.co.fitdining.api.place.dto.PlaceReasonsResponse;
import kr.co.fitdining.api.place.dto.PlaceReasonsResponse.ReasonView;
import kr.co.fitdining.api.place.dto.PlaceReasonsResponse.ReviewEvidence;
import kr.co.fitdining.api.place.dto.PlaceSummary;
import kr.co.fitdining.api.place.dto.PlaceSummary.CategoryGroup;
import kr.co.fitdining.api.place.dto.PlaceSummary.Station;
import kr.co.fitdining.api.place.exception.PlaceNotFoundException;
import kr.co.fitdining.api.place.reason.ReasonEvidenceRepository.Persona;
import kr.co.fitdining.api.place.reason.ReasonEvidenceRepository.ReviewRow;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** 근거 모으기, 제목 합치기, 캐시를 확인한다. 근거 SQL은 {@code ReasonEvidenceRepositoryTest}가 실제 DB로 본다. */
class PlaceReasonServiceTest {

	static final long PLACE_ID = 7L;
	static final Reason QUIET = new Reason(EvidenceSource.REQUEST, "QUIET", "조용해요", 0.95, true, "카페 중 손꼽히게 조용해요");
	static final Reason COZY = new Reason(EvidenceSource.PREFERENCE, "COZY", "아늑해요", 0.8, true, "아늑한 편이에요");
	static final Reason PARKING = new Reason(EvidenceSource.PREFERENCE, "PARKING", "주차할 수 있어요", 1.0, false,
			"주차할 수 있어요");
	static final Persona READER = new Persona("조용한 독서가", "책 읽는 손님입니다.", "차분합니다.");
	static final ReviewRow REVIEW = new ReviewRow("밥친구", LocalDate.of(2026, 11, 1), "조용해서 좋았어요");

	PlaceService places = mock(PlaceService.class);
	ReasonEvidenceRepository evidence = mock(ReasonEvidenceRepository.class);
	AiReasonClient ai = mock(AiReasonClient.class);
	PlaceReasonService service = new PlaceReasonService(places, evidence, ai, Caffeine.newBuilder().build());

	@BeforeEach
	void setUp() {
		PlaceDetailResponse detail = mock(PlaceDetailResponse.class);
		when(detail.place()).thenReturn(new PlaceSummary(PLACE_ID, "카페", CategoryGroup.CAFE, Station.GANGNAM, 37.5,
				127.0, null));
		when(places.getPlace(PLACE_ID)).thenReturn(detail);
		when(evidence.persona(anyLong(), anyString())).thenReturn(Optional.empty());
		when(evidence.reviews(anyLong(), anyString(), anyString(), anyInt())).thenReturn(List.of());
		when(evidence.persona(PLACE_ID, "QUIET")).thenReturn(Optional.of(READER));
		when(evidence.persona(PLACE_ID, "COZY")).thenReturn(Optional.of(READER));
		when(evidence.reviews(PLACE_ID, "COZY", "CAFE", PlaceReasonService.REVIEW_COUNT)).thenReturn(List.of(REVIEW));
	}

	private static PlaceReasonsRequest request(Reason... reasons) {
		return new PlaceReasonsRequest("조용한 카페", List.of(reasons));
	}

	private void aiReturns(List<AiReasonClient.Title> titles, List<String> fallbacks) {
		when(ai.titles(any())).thenReturn(Optional.of(new AiReasonClient.Response(titles, fallbacks)));
	}

	@Nested
	@DisplayName("근거와 제목")
	class Evidence {

		@Test
		@DisplayName("추천이유_리뷰가있으면리뷰만_없으면페르소나요약만_장소정보항목은근거없이싣는다")
		void reasons_evidencePerReason_oneKindShown() {
			aiReturns(List.of(new AiReasonClient.Title("차분해서 오래 머물기 좋아요", "책 읽으러 오는 손님"),
					new AiReasonClient.Title("평소 좋아하시는 아늑함이 있어요", "책 읽으러 오는 손님"),
					new AiReasonClient.Title("주차할 수 있어요", null)), List.of());

			PlaceReasonsResponse response = service.reasons(PLACE_ID, request(QUIET, COZY, PARKING));

			assertThat(response.reasons()).containsExactly(
					new ReasonView(EvidenceSource.REQUEST, "조용해요", "차분해서 오래 머물기 좋아요", List.of(), "책 읽으러 오는 손님"),
					new ReasonView(EvidenceSource.PREFERENCE, "아늑해요", "평소 좋아하시는 아늑함이 있어요",
							List.of(new ReviewEvidence("밥친구", LocalDate.of(2026, 11, 1), "조용해서 좋았어요")), null),
					new ReasonView(EvidenceSource.PREFERENCE, "주차할 수 있어요", "주차할 수 있어요", List.of(), null));
			verify(evidence, never()).persona(PLACE_ID, "PARKING");
			verify(evidence, never()).reviews(PLACE_ID, "PARKING", "CAFE", PlaceReasonService.REVIEW_COUNT);
		}

		@Test
		@DisplayName("추천이유_AI에는_작성자없이업종과근거와페르소나를순서대로보낸다")
		void reasons_aiRequest_withoutAuthor() {
			aiReturns(List.of(new AiReasonClient.Title("t", null), new AiReasonClient.Title("t", null)), List.of());

			service.reasons(PLACE_ID, request(QUIET, PARKING));

			ArgumentCaptor<AiReasonClient.Request> sent = ArgumentCaptor.forClass(AiReasonClient.Request.class);
			verify(ai).titles(sent.capture());
			assertThat(sent.getValue()).isEqualTo(new AiReasonClient.Request("조용한 카페", "CAFE", List.of(
					new AiReasonClient.Item("REQUEST", "QUIET", 0.95, true,
							new AiReasonClient.Persona("조용한 독서가", "책 읽는 손님입니다.", "차분합니다."), List.of()),
					new AiReasonClient.Item("PREFERENCE", "PARKING", 1.0, false, null, List.of()))));
		}

		@Test
		@DisplayName("추천이유_AI에닿지못하면_카드의대체제목이고페르소나는관계를몰라싣지않는다")
		void reasons_aiUnavailable_fallbackTitles() {
			when(ai.titles(any())).thenReturn(Optional.empty());

			PlaceReasonsResponse response = service.reasons(PLACE_ID, request(QUIET));

			assertThat(response.reasons()).containsExactly(
					new ReasonView(EvidenceSource.REQUEST, "조용해요", "카페 중 손꼽히게 조용해요", List.of(), null));
		}

		@Test
		@DisplayName("추천이유_AI가페르소나요약을주지않으면_특징과무관한페르소나라싣지않는다")
		void reasons_unrelatedPersona_noSummary() {
			aiReturns(List.of(new AiReasonClient.Title("조용해서 머물기 좋아요", null)), List.of());

			PlaceReasonsResponse response = service.reasons(PLACE_ID, request(QUIET));

			assertThat(response.reasons().getFirst().personaSummary()).isNull();
		}

		@Test
		@DisplayName("추천이유_장소가없으면_404예외이고AI를부르지않는다")
		void reasons_unknownPlace_notFound() {
			when(places.getPlace(8L)).thenThrow(new PlaceNotFoundException());

			assertThatThrownBy(() -> service.reasons(8L, request(QUIET))).isInstanceOf(PlaceNotFoundException.class);
			verify(ai, never()).titles(any());
		}
	}

	@Nested
	@DisplayName("캐시")
	class Cache {

		@Test
		@DisplayName("추천이유_같은요청을다시받으면_AI를다시부르지않고같은응답이다")
		void reasons_sameRequest_cached() {
			aiReturns(List.of(new AiReasonClient.Title("차분해요", null)), List.of());

			PlaceReasonsResponse first = service.reasons(PLACE_ID, request(QUIET));
			PlaceReasonsResponse second = service.reasons(PLACE_ID, request(QUIET));

			assertThat(second).isSameAs(first);
			verify(ai, times(1)).titles(any());
		}

		@Test
		@DisplayName("추천이유_요청문장이다르면_다른열쇠라AI를다시부른다")
		void reasons_differentSentence_notShared() {
			aiReturns(List.of(new AiReasonClient.Title("차분해요", null)), List.of());

			service.reasons(PLACE_ID, request(QUIET));
			service.reasons(PLACE_ID, new PlaceReasonsRequest("책 읽기 좋은 카페", List.of(QUIET)));

			verify(ai, times(2)).titles(any());
		}

		@Test
		@DisplayName("추천이유_LLM이실패했거나AI에닿지못한응답은_캐시에넣지않는다")
		void reasons_failure_notCached() {
			aiReturns(List.of(new AiReasonClient.Title("조용한 편이에요", null)), List.of("TITLE_LLM_FAILED"));
			service.reasons(PLACE_ID, request(QUIET));
			when(ai.titles(any())).thenReturn(Optional.empty());
			service.reasons(PLACE_ID, request(QUIET));
			aiReturns(List.of(new AiReasonClient.Title("차분해요", null)), List.of());

			PlaceReasonsResponse third = service.reasons(PLACE_ID, request(QUIET));

			assertThat(third.reasons().getFirst().title()).isEqualTo("차분해요");
			verify(ai, times(3)).titles(any());
		}
	}

}
