package kr.co.fitdining.api.review.tag;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.util.List;
import kr.co.fitdining.api.place.dto.PlaceSummary.CategoryGroup;
import kr.co.fitdining.api.support.PostgresTestSupport;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;

/** 반복 마이그레이션의 임시 시드가 PRD FR-10 초안과 업종별 노출 표대로 들어갔는지 본다. */
class ReasonTagSeedTest extends PostgresTestSupport {

	private static ReasonTagRepository tags;

	@BeforeAll
	static void setUp() throws Exception {
		migrate();
		tags = new ReasonTagRepository(new NamedParameterJdbcTemplate(appSource()));
	}

	private static List<String> codes(CategoryGroup category) {
		return tags.findExposed(category).stream().map(ReasonTag::code).toList();
	}

	private static String label(CategoryGroup category, String code) {
		return tags.findExposed(category).stream().filter(tag -> tag.code().equals(code)).findFirst()
				.map(ReasonTag::label).orElseThrow();
	}

	@Test
	@DisplayName("시드_업종별노출수는_식당26카페22술집24다")
	void seed_exposedCountPerCategory() {
		assertThat(codes(CategoryGroup.RESTAURANT)).hasSize(26);
		assertThat(codes(CategoryGroup.CAFE)).hasSize(22);
		assertThat(codes(CategoryGroup.BAR)).hasSize(24);
	}

	@Test
	@DisplayName("시드_카페의좋았어요문구는_Figma7-01과같다")
	void seed_cafeGoodLabels_matchFigma() {
		List<String> good = tags.findExposed(CategoryGroup.CAFE).stream()
				.filter(tag -> tag.sentiment() == ReasonTag.Sentiment.GOOD).map(ReasonTag::label).toList();

		assertThat(good).containsExactly("조용해서 좋았어요", "활기차서 좋았어요", "아늑했어요", "자리가 넉넉했어요",
				"공간이 예뻤어요", "뷰가 좋았어요", "바로 들어갔어요", "가격만큼 만족했어요", "대화하기 좋았어요",
				"데이트하기 좋았어요", "작업·공부하기 좋았어요");
	}

	@Test
	@DisplayName("시드_혼밥과혼술은_한태그이고술집만문구가다르다")
	void seed_soloSharedTagWithBarLabel() {
		assertThat(label(CategoryGroup.RESTAURANT, "PURPOSE_SOLO_GOOD")).isEqualTo("혼밥하기 좋았어요");
		assertThat(label(CategoryGroup.BAR, "PURPOSE_SOLO_GOOD")).isEqualTo("혼술하기 좋았어요");
		assertThat(label(CategoryGroup.BAR, "PURPOSE_SOLO_BAD")).isEqualTo("혼술하기 불편했어요");
		assertThat(codes(CategoryGroup.CAFE)).doesNotContain("PURPOSE_SOLO_GOOD");
	}

	@Test
	@DisplayName("시드_소음축아쉬웠어요는_장소에서실제로그랬던쪽코드다")
	void seed_noiseBadTags_useFeltPole() {
		ReasonTag noisy = tags.findExposed(CategoryGroup.CAFE).stream()
				.filter(tag -> tag.label().equals("너무 시끄러웠어요")).findFirst().orElseThrow();
		ReasonTag empty = tags.findExposed(CategoryGroup.CAFE).stream()
				.filter(tag -> tag.label().equals("너무 썰렁했어요")).findFirst().orElseThrow();

		assertThat(noisy.featureCode()).isEqualTo("LIVELY");
		assertThat(empty.featureCode()).isEqualTo("QUIET");
	}

	@Test
	@DisplayName("시드_업종별노출표대로_빠진태그가있다")
	void seed_exposureFollowsPrdTable() {
		assertThat(codes(CategoryGroup.CAFE)).doesNotContain("GENEROUS_PORTION_GOOD", "PURPOSE_GROUP_GOOD");
		assertThat(codes(CategoryGroup.BAR)).doesNotContain("VIEW_OUTDOOR_GOOD", "PURPOSE_WORK_GOOD");
		assertThat(codes(CategoryGroup.RESTAURANT)).doesNotContain("PURPOSE_WORK_GOOD");
	}

	@Test
	@DisplayName("시드_다시적용해도_결과가같다")
	void seed_reapplied_sameResult() throws Exception {
		String sql = new String(new ClassPathResource("db/migration/R__reason_tag_seed.sql").getInputStream()
				.readAllBytes(), StandardCharsets.UTF_8);
		try (Connection connection = DriverManager.getConnection(POSTGRES.getJdbcUrl(), "fit_migrator",
				"test-migrator"); Statement statement = connection.createStatement()) {
			statement.execute(sql);
		}

		assertThat(codes(CategoryGroup.RESTAURANT)).hasSize(26);
		assertThat(label(CategoryGroup.BAR, "PURPOSE_SOLO_GOOD")).isEqualTo("혼술하기 좋았어요");
	}

}
