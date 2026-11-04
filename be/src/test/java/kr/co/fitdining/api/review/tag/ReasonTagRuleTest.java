package kr.co.fitdining.api.review.tag;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import kr.co.fitdining.api.review.exception.InvalidReasonTagsException;
import kr.co.fitdining.api.review.tag.ReasonTag.Sentiment;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class ReasonTagRuleTest {

	private static final List<ReasonTag> EXPOSED = List.of(
			tag("QUIET_GOOD", "QUIET", Sentiment.GOOD),
			tag("LIVELY_GOOD", "LIVELY", Sentiment.GOOD),
			tag("LIVELY_BAD", "LIVELY", Sentiment.BAD),
			tag("QUIET_BAD", "QUIET", Sentiment.BAD),
			tag("COZY_GOOD", "COZY", Sentiment.GOOD),
			tag("COZY_BAD", "COZY", Sentiment.BAD),
			tag("SHORT_WAIT_BAD", "SHORT_WAIT", Sentiment.BAD));

	private static ReasonTag tag(String code, String feature, Sentiment sentiment) {
		return new ReasonTag(code, feature, sentiment, code, "분위기");
	}

	private static void validate(String... codes) {
		ReasonTagRule.validate(List.of(codes), EXPOSED);
	}

	@Test
	@DisplayName("태그검증_좋았어요와다른그룹의아쉬웠어요면_통과한다")
	void validate_goodAndOtherGroupBad_passes() {
		assertThatCode(() -> validate("QUIET_GOOD", "COZY_BAD", "SHORT_WAIT_BAD")).doesNotThrowAnyException();
	}

	@Test
	@DisplayName("태그검증_좋았어요가없으면_예외다")
	void validate_noGood_throws() {
		assertThatThrownBy(() -> validate("COZY_BAD", "SHORT_WAIT_BAD")).isInstanceOf(InvalidReasonTagsException.class);
		assertThatThrownBy(() -> validate()).isInstanceOf(InvalidReasonTagsException.class);
	}

	@Test
	@DisplayName("태그검증_같은특징의좋았어요와아쉬웠어요면_예외다")
	void validate_sameFeatureGoodAndBad_throws() {
		assertThatThrownBy(() -> validate("COZY_GOOD", "COZY_BAD")).isInstanceOf(InvalidReasonTagsException.class);
	}

	@ParameterizedTest
	@ValueSource(strings = {"LIVELY_GOOD", "LIVELY_BAD", "QUIET_BAD"})
	@DisplayName("태그검증_소음축네태그는하나만_고를수있다")
	void validate_twoNoiseTags_throws(String other) {
		assertThatThrownBy(() -> validate("QUIET_GOOD", other)).isInstanceOf(InvalidReasonTagsException.class);
	}

	@Test
	@DisplayName("태그검증_업종에노출되지않은태그면_예외다")
	void validate_notExposed_throws() {
		assertThatThrownBy(() -> validate("QUIET_GOOD", "PURPOSE_WORK_GOOD"))
				.isInstanceOf(InvalidReasonTagsException.class);
	}

	@Test
	@DisplayName("태그검증_같은태그를두번보내면_예외다")
	void validate_duplicateCode_throws() {
		assertThatThrownBy(() -> validate("QUIET_GOOD", "QUIET_GOOD")).isInstanceOf(InvalidReasonTagsException.class);
	}

	@ParameterizedTest
	@org.junit.jupiter.params.provider.CsvSource({
			"QUIET, BAD, LIVELY", "LIVELY, BAD, QUIET", "QUIET, GOOD, QUIET", "LIVELY, GOOD, LIVELY",
			"SHORT_WAIT, BAD, SHORT_WAIT", "COZY, GOOD, COZY"})
	@DisplayName("사용자쪽코드_소음축아쉬웠어요만_반대극이다")
	void userFeatureCode_onlyNoiseBadFlips(String feature, Sentiment sentiment, String expected) {
		assertThat(ReasonTagRule.userFeatureCode(feature, sentiment)).isEqualTo(expected);
	}

	@Test
	@DisplayName("그룹_소음축은한그룹이고_나머지는특징코드다")
	void group_noiseAxisSharedOthersByFeature() {
		assertThat(ReasonTagRule.group(EXPOSED.get(0))).isEqualTo(ReasonTagRule.group(EXPOSED.get(2)));
		assertThat(ReasonTagRule.group(EXPOSED.get(4))).isEqualTo("COZY");
	}

}
