package kr.co.fitdining.api.place;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import kr.co.fitdining.api.auth.ports.AuthUseCases;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@ExtendWith(OutputCaptureExtension.class)
@WebMvcTest(controllers = PlaceController.class)
class PlaceControllerDataAccessTest {

	@Autowired
	MockMvc mockMvc;

	@MockitoBean
	AuthUseCases auth;

	@MockitoBean
	PlaceService placeService;

	@Test
	@DisplayName("장소상세_DB접근오류가나면_503이고응답에예외내용이없고서버로그에만남는다")
	void getPlace_dataAccessFailure_returnsServiceUnavailable(CapturedOutput output) throws Exception {
		when(placeService.getPlace(1L)).thenThrow(new DataAccessResourceFailureException("connection refused: secret-host"));

		mockMvc.perform(get("/api/v1/places/{id}", 1))
				.andExpect(status().isServiceUnavailable())
				.andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON))
				.andExpect(jsonPath("$.status").value(503))
				.andExpect(jsonPath("$.detail").value("지금은 장소 검색을 쓸 수 없어요."))
				.andExpect(content().string(not(containsString("secret-host"))));

		// 예외 내용은 응답이 아니라 서버 로그에 남는다.
		assertThat(output).contains("Place catalog access failed").contains("secret-host");
	}

}
