package kr.co.fitdining.api.place.reason;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

/** AI 제목 API 요청 모양과 응답 읽기를 확인한다. */
@ExtendWith(OutputCaptureExtension.class)
class AiReasonClientTest {

	static final String URL = "http://ai.test/v1/reasons/titles";
	static final String SECRET = "비밀표식9c41";
	static final AiReasonClient.Request REQUEST = new AiReasonClient.Request(SECRET, "CAFE", List.of(
			new AiReasonClient.Item("REQUEST", "QUIET", 0.95, true, new AiReasonClient.Persona("이름", "설명", "이유"),
					List.of()),
			new AiReasonClient.Item("PREFERENCE", "PARKING", 1.0, false, null, List.of())));

	MockRestServiceServer server;
	AiReasonClient client;

	@BeforeEach
	void setUp() {
		RestClient.Builder builder = RestClient.builder().baseUrl("http://ai.test");
		server = MockRestServiceServer.bindTo(builder).build();
		client = new AiReasonClient(builder.build());
	}

	@AfterEach
	void verify() {
		server.verify();
	}

	@Test
	@DisplayName("제목_AI가제목을주면_요청순서대로읽고모르는속성은무시한다")
	void titles_success_readInOrder() {
		server.expect(requestTo(URL)).andExpect(method(HttpMethod.POST))
				.andExpect(content().json("""
						{"request":"비밀표식9c41","categoryGroup":"CAFE","items":[
						 {"source":"REQUEST","code":"QUIET","value":0.95,"fromReviews":true,
						  "persona":{"name":"이름","description":"설명","reason":"이유"},"quotes":[]},
						 {"source":"PREFERENCE","code":"PARKING","value":1.0,"fromReviews":false,"quotes":[]}]}"""))
				.andRespond(withSuccess("""
						{"titles":[{"title":"차분해요","personaSummary":"책 읽는 손님"},{"title":"주차할 수 있어요"}],
						 "fallbacks":[],"model":"m","extra":1}""", MediaType.APPLICATION_JSON));

		AiReasonClient.Response response = client.titles(REQUEST).orElseThrow();

		assertThat(response.titles()).containsExactly(new AiReasonClient.Title("차분해요", "책 읽는 손님"),
				new AiReasonClient.Title("주차할 수 있어요", null));
		assertThat(response.llmFailed()).isFalse();
	}

	@Test
	@DisplayName("제목_LLM이실패했다고알리면_제목은읽고실패로표시한다")
	void titles_llmFailed_flagged() {
		server.expect(requestTo(URL)).andRespond(withSuccess("""
				{"titles":[{"title":"a"},{"title":"b"}],"fallbacks":["TITLE_LLM_FAILED"],"model":"m"}""",
				MediaType.APPLICATION_JSON));

		assertThat(client.titles(REQUEST).orElseThrow().llmFailed()).isTrue();
	}

	@ParameterizedTest
	@ValueSource(strings = {
			"{\"titles\":[{\"title\":\"비밀표식9c41\"}]}",
			"{\"titles\":[{\"title\":\"a\"},null]}",
			"{\"titles\":[{\"title\":\"a\"},{\"title\":\" \"}]}",
			"{\"fallbacks\":[]}"
	})
	@DisplayName("제목_개수가다르거나빈제목이면_실패이고본문을남기지않는다")
	void titles_invalidResponse_empty(String body, CapturedOutput output) {
		server.expect(requestTo(URL)).andRespond(withSuccess(body, MediaType.APPLICATION_JSON));

		assertThat(client.titles(REQUEST)).isEmpty();
		assertThat(output).contains("reason_titles_failed").doesNotContain(SECRET);
	}

	@Test
	@DisplayName("제목_AI가오류를주면_실패이고요청문장을남기지않는다")
	void titles_serverError_empty(CapturedOutput output) {
		server.expect(requestTo(URL)).andRespond(withServerError().body(SECRET));

		assertThat(client.titles(REQUEST)).isEmpty();
		assertThat(output).contains("reason_titles_failed").doesNotContain(SECRET);
	}

}
