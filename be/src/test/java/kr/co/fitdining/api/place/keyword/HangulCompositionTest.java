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
			"국, 쌀국수, 1, true",
			// 받침 27개 전부: 넘어가는 형태는 맞고 초성이 다른 다음 글자는 맞지 않는다. 초성 자모 19개 전부
			"각, 가가, 0, true",
			"각, 가마, 0, false",
			"갂, 가까, 0, true",
			"갂, 가마, 0, false",
			"갃, 각사, 0, true",
			"갃, 각마, 0, false",
			"간, 가나, 0, true",
			"간, 가마, 0, false",
			"갅, 간자, 0, true",
			"갅, 간마, 0, false",
			"갆, 간하, 0, true",
			"갆, 간마, 0, false",
			"갇, 가다, 0, true",
			"갇, 가마, 0, false",
			"갈, 가라, 0, true",
			"갈, 가마, 0, false",
			"갉, 갈가, 0, true",
			"갉, 갈마, 0, false",
			"갊, 갈마, 0, true",
			"갊, 갈나, 0, false",
			"갋, 갈바, 0, true",
			"갋, 갈마, 0, false",
			"갌, 갈사, 0, true",
			"갌, 갈마, 0, false",
			"갍, 갈타, 0, true",
			"갍, 갈마, 0, false",
			"갎, 갈파, 0, true",
			"갎, 갈마, 0, false",
			"갏, 갈하, 0, true",
			"갏, 갈마, 0, false",
			"감, 가마, 0, true",
			"감, 가나, 0, false",
			"갑, 가바, 0, true",
			"갑, 가마, 0, false",
			"값, 갑사, 0, true",
			"값, 갑마, 0, false",
			"갓, 가사, 0, true",
			"갓, 가마, 0, false",
			"갔, 가싸, 0, true",
			"갔, 가마, 0, false",
			"강, 가아, 0, true",
			"강, 가마, 0, false",
			"갖, 가자, 0, true",
			"갖, 가마, 0, false",
			"갗, 가차, 0, true",
			"갗, 가마, 0, false",
			"갘, 가카, 0, true",
			"갘, 가마, 0, false",
			"같, 가타, 0, true",
			"같, 가마, 0, false",
			"갚, 가파, 0, true",
			"갚, 가마, 0, false",
			"갛, 가하, 0, true",
			"갛, 가마, 0, false",
			"ㄱ, 가, 0, true",
			"ㄲ, 까, 0, true",
			"ㄴ, 나, 0, true",
			"ㄷ, 다, 0, true",
			"ㄸ, 따, 0, true",
			"ㄹ, 라, 0, true",
			"ㅁ, 마, 0, true",
			"ㅂ, 바, 0, true",
			"ㅃ, 빠, 0, true",
			"ㅅ, 사, 0, true",
			"ㅆ, 싸, 0, true",
			"ㅇ, 아, 0, true",
			"ㅈ, 자, 0, true",
			"ㅉ, 짜, 0, true",
			"ㅊ, 차, 0, true",
			"ㅋ, 카, 0, true",
			"ㅌ, 타, 0, true",
			"ㅍ, 파, 0, true",
			"ㅎ, 하, 0, true",
			"구, 궤, 0, true"
	})
	@DisplayName("한글조합_마지막글자가덜쓴글자일때_이어질수있는글자만맞는다")
	void canComplete_typedLastCharacter_matchesOnlyPossibleCompletions(char typed, String text, int index,
			boolean expected) {
		assertThat(HangulComposition.canComplete(typed, text, index)).isEqualTo(expected);
	}

}
