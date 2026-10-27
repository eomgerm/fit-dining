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
