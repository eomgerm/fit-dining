package kr.co.fitdining.api.ops;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.json.JsonCompareMode;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(controllers = OpsController.class,
		properties = {"app.version.sha=0123abcd", "app.version.built-at=2026-10-23T07:00:00Z"})
class OpsControllerTest {

	@Autowired
	MockMvc mockMvc;

	@Test
	@DisplayName("공개헬스_호출하면_상태만돌려준다")
	void healthz_called_returnsStatusOnly() throws Exception {
		mockMvc.perform(get("/healthz"))
				.andExpect(status().isOk())
				.andExpect(content().json("{\"status\":\"UP\"}", JsonCompareMode.STRICT));
	}

	@Test
	@DisplayName("버전_호출하면_이미지의SHA와빌드시각을돌려준다")
	void version_called_returnsShaAndBuiltAt() throws Exception {
		mockMvc.perform(get("/api/v1/version"))
				.andExpect(status().isOk())
				.andExpect(content().json("{\"sha\":\"0123abcd\",\"builtAt\":\"2026-10-23T07:00:00Z\"}",
						JsonCompareMode.STRICT));
	}

}
