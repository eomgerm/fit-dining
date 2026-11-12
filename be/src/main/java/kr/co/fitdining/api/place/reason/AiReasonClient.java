package kr.co.fitdining.api.place.reason;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.List;
import java.util.Optional;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/**
 * AI 제목 API({@code POST /v1/reasons/titles}) 경계. 요청과 응답 본문, 예외 메시지는 로그에 남기지 않는다.
 * AI는 LLM이 실패해도 대체 제목으로 200을 주므로, 여기서 실패는 AI에 닿지 못했거나 응답이 계약과 다를 때다.
 */
@Slf4j
@Component
class AiReasonClient {

	private final RestClient client;

	@Autowired
	AiReasonClient(@Value("${fitdining.ai.base-url:http://localhost:8000}") String baseUrl,
			@Value("${fitdining.ai.modal-key:}") String key,
			@Value("${fitdining.ai.modal-secret:}") String secret,
			@Value("${fitdining.ai.reason-timeout-ms:12000}") long timeoutMs) {
		this(client(baseUrl, key, secret, timeoutMs));
	}

	AiReasonClient(RestClient client) {
		this.client = client;
	}

	private static RestClient client(String url, String key, String secret, long timeoutMs) {
		Duration timeout = Duration.ofMillis(timeoutMs);
		var factory = new JdkClientHttpRequestFactory(HttpClient.newBuilder().connectTimeout(timeout).build());
		factory.setReadTimeout(timeout);
		var builder = RestClient.builder().baseUrl(url).requestFactory(factory);
		if (!key.isBlank()) {
			builder.defaultHeader("Modal-Key", key);
		}
		if (!secret.isBlank()) {
			builder.defaultHeader("Modal-Secret", secret);
		}
		return builder.build();
	}

	/**
	 * 고른 이유마다 제목을 받는다.
	 *
	 * @param request 제목 요청
	 * @return 요청 {@code items}와 같은 순서의 제목. AI에 닿지 못했거나 응답이 계약과 다르면 빈 값이다.
	 */
	Optional<Response> titles(Request request) {
		try {
			Response response = client.post().uri("/v1/reasons/titles").contentType(MediaType.APPLICATION_JSON)
					.body(request).retrieve().body(Response.class);
			if (!valid(response, request.items().size())) {
				log.warn("reason_titles_failed kind=InvalidResponse");
				return Optional.empty();
			}
			return Optional.of(response);
		} catch (RuntimeException e) {
			log.warn("reason_titles_failed kind={}", e.getClass().getSimpleName());
			return Optional.empty();
		}
	}

	private static boolean valid(Response response, int size) {
		return response != null && response.titles() != null && response.titles().size() == size
				&& response.titles().stream().allMatch(t -> t != null && t.title() != null && !t.title().isBlank());
	}

	/**
	 * 제목 요청.
	 *
	 * @param request 그 검색의 요청 문장. 없으면 null이다.
	 * @param categoryGroup 장소 업종 그룹({@code RESTAURANT}, {@code CAFE}, {@code BAR})
	 * @param items 고른 이유와 근거. 요청의 {@code reasons} 순서다.
	 */
	record Request(String request, String categoryGroup, List<Item> items) {
	}

	/**
	 * 이유 하나와 근거. 작성자 정보는 넣지 않는다.
	 *
	 * @param source 근거 출처({@code REQUEST}, {@code PREFERENCE})
	 * @param code 조건 코드
	 * @param value 항목 점수(0~1)
	 * @param fromReviews 리뷰로 판정했는지
	 * @param persona 짝지은 장소 페르소나. 없으면 null이다.
	 * @param quotes 앱 리뷰 구절. 리뷰 본문 추출이 붙기 전까지는 빈 목록이다.
	 */
	record Item(String source, String code, Double value, Boolean fromReviews, Persona persona, List<String> quotes) {
	}

	/**
	 * 짝지은 장소 페르소나.
	 *
	 * @param name 이름
	 * @param description 어떤 손님인지
	 * @param reason 좋아하는 이유
	 */
	record Persona(String name, String description, String reason) {
	}

	/**
	 * 제목 응답.
	 *
	 * @param titles 요청 {@code items}와 같은 순서의 제목
	 * @param fallbacks LLM 호출이 실패했으면 {@code TITLE_LLM_FAILED}가 든다. 이때는 캐시에 넣지 않는다.
	 */
	@JsonIgnoreProperties(ignoreUnknown = true)
	record Response(List<Title> titles, List<String> fallbacks) {

		boolean llmFailed() {
			return fallbacks != null && !fallbacks.isEmpty();
		}
	}

	/**
	 * 이유 하나의 제목.
	 *
	 * @param title 제목 한 문장
	 * @param personaSummary "~하는 손님" 한 줄. AI가 짝지은 페르소나가 그 특징과 관계있다고 판단했을 때만 있다. 페르소나가
	 *     없거나 관계없거나 LLM이 실패했으면 빠져 null이다.
	 */
	@JsonIgnoreProperties(ignoreUnknown = true)
	record Title(String title, String personaSummary) {
	}

}
