package kr.co.fitdining.api.place.keyword;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

/** 마지막 글자의 조합 완화 규칙(place-lookup-db D-9). typed는 입력의 마지막 글자, 텍스트의 index 자리 글자가 이어질 수 있는지 본다. */
class HangulCompositionTest {

	@ParameterizedTest(name = "{0} ~ {1}[{2}] → {3}")
	@CsvSource({
			// 받침 없는 글자: 같은 초성과 중성이면 받침이 무엇이든 맞는다
			"구, 국수, 0, true",
			"구, 구슬, 0, true",
			"구, 궁, 0, true",
			"구, 가, 0, false",
			"구, 꾸, 0, false",
			"가, 각, 0, true",
			// 홀로 쓴 자음: 그 자음을 초성으로 하는 모든 글자
			"ㄱ, 국, 0, true",
			"ㄱ, 나, 0, false",
			"ㄱ, ㄱ, 0, true",
			// 받침이 다음 글자의 초성으로 넘어간 형태
			"알, 아라, 0, true",
			"알, 아나, 0, false",
			"알, 알아, 0, true",
			"알, 안, 0, false",
			"닭, 달가, 0, true",
			// 받침이 겹받침의 첫 자음일 때 그 겹받침인 글자
			"달, 닭, 0, true",
			"달, 담, 0, false",
			"닥, 닭, 0, false",
			"갑, 값, 0, true",
			"안, 않, 0, true",
			// 받침 없는 글자의 중성이 복합 모음으로 이어지는 형태
			"고, 과, 0, true",
			"고, 괘, 0, true",
			"고, 괴, 0, true",
			"고, 구, 0, false",
			"구, 궈, 0, true",
			"구, 귀, 0, true",
			"그, 긔, 0, true",
			"그, 귀, 0, false",
			// 글자가 같으면 맞고, 그 밖의 글자는 글자 그대로만 맞는다
			"a, a, 0, true",
			"a, b, 0, false",
			"ㅏ, 아, 0, false",
			"국, 국수, 0, true",
			"국, 쌀국수, 1, true"
	})
	@DisplayName("한글조합_마지막글자가덜쓴글자일때_이어질수있는글자만맞는다")
	void canComplete_typedLastCharacter_matchesOnlyPossibleCompletions(char typed, String text, int index,
			boolean expected) {
		assertThat(HangulComposition.canComplete(typed, text, index)).isEqualTo(expected);
	}

}
