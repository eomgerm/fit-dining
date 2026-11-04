package kr.co.fitdining.api.review.tag;

import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;
import kr.co.fitdining.api.review.exception.InvalidReasonTagsException;

/** 이유 태그 선택 규칙(D-5, D-36). */
public final class ReasonTagRule {

	/** PRD L1의 유일한 양극 축. 네 태그가 한 그룹이다. */
	private static final Set<String> NOISE_AXIS = Set.of("QUIET", "LIVELY");

	private ReasonTagRule() {
	}

	/** 같은 그룹의 태그는 함께 고를 수 없다. */
	public static String group(ReasonTag tag) {
		return NOISE_AXIS.contains(tag.featureCode()) ? "NOISE" : tag.featureCode();
	}

	/**
	 * 취향 갱신에 보내는 사용자 쪽 코드(D-36). {@code featureCode}는 장소에서 실제로 그랬던 쪽이라
	 * "너무 시끄러웠어요"(LIVELY·BAD)를 쓴 사용자는 조용한 곳을 원한다. 소음 축 아쉬웠어요만 반대 극이다.
	 */
	public static String userFeatureCode(String featureCode, ReasonTag.Sentiment sentiment) {
		if (sentiment != ReasonTag.Sentiment.BAD || !NOISE_AXIS.contains(featureCode)) {
			return featureCode;
		}
		return featureCode.equals("QUIET") ? "LIVELY" : "QUIET";
	}

	/**
	 * @param codes 고른 태그 코드
	 * @param exposed 장소 업종에 노출되는 태그
	 * @throws InvalidReasonTagsException 좋았어요가 없거나, 노출되지 않은 태그가 있거나, 같은 그룹을 둘 이상 골랐을 때
	 */
	public static void validate(Collection<String> codes, List<ReasonTag> exposed) {
		Map<String, ReasonTag> byCode = exposed.stream()
				.collect(Collectors.toMap(ReasonTag::code, Function.identity()));
		Set<String> groups = new HashSet<>();
		boolean good = false;
		for (String code : codes) {
			ReasonTag tag = byCode.get(code);
			if (tag == null || !groups.add(group(tag))) {
				throw new InvalidReasonTagsException();
			}
			good |= tag.sentiment() == ReasonTag.Sentiment.GOOD;
		}
		if (!good) {
			throw new InvalidReasonTagsException();
		}
	}

}
