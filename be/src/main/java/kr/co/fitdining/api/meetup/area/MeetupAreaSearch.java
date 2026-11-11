package kr.co.fitdining.api.meetup.area;

import java.util.Comparator;
import java.util.List;
import kr.co.fitdining.api.meetup.domain.MeetupLimits;

/** 지역 찾기. 화면 이름("선릉역", "역삼동")에 찾는 말이 들어 있는 곳을 고른다. */
public final class MeetupAreaSearch {

	private MeetupAreaSearch() {
	}

	/**
	 * @param areas 고를 수 있는 지역(역 먼저, 그다음 동)
	 * @param query 앞뒤 공백을 지운 찾는 말
	 * @return 이름이 찾는 말로 시작하는 곳 먼저, 그다음 들어 있는 곳. 같은 묶음 안은 {@code areas}의 순서다. 최대
	 *         {@link MeetupLimits#AREA_RESULTS_MAX}곳
	 */
	public static List<MeetupArea> find(List<MeetupArea> areas, String query) {
		return areas.stream()
				.filter(area -> area.label().contains(query))
				.sorted(Comparator.comparing(area -> !area.label().startsWith(query)))
				.limit(MeetupLimits.AREA_RESULTS_MAX)
				.toList();
	}

}
