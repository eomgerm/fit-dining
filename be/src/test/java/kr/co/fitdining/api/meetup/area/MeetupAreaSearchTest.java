package kr.co.fitdining.api.meetup.area;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.stream.IntStream;
import kr.co.fitdining.api.meetup.domain.AreaKind;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class MeetupAreaSearchTest {

	private static final MeetupArea SEOLLEUNG = new MeetupArea(AreaKind.STATION, "선릉");
	private static final MeetupArea SEONJEONGNEUNG = new MeetupArea(AreaKind.STATION, "선정릉");
	private static final MeetupArea YEOKSAM = new MeetupArea(AreaKind.STATION, "역삼");
	private static final MeetupArea YEOKSAM_DONG = new MeetupArea(AreaKind.DONG, "역삼동");
	private static final List<MeetupArea> AREAS = List.of(SEOLLEUNG, SEONJEONGNEUNG, YEOKSAM, YEOKSAM_DONG);

	@Test
	@DisplayName("찾기_역을붙여도_역이름으로찾는다")
	void find_withStationSuffix_matches() {
		assertThat(MeetupAreaSearch.find(AREAS, "선릉역")).containsExactly(SEOLLEUNG);
	}

	@Test
	@DisplayName("찾기_이름이찾는말로시작하는곳이_먼저다")
	void find_prefixFirst() {
		assertThat(MeetupAreaSearch.find(AREAS, "릉")).containsExactly(SEOLLEUNG, SEONJEONGNEUNG);
		assertThat(MeetupAreaSearch.find(AREAS, "역삼")).containsExactly(YEOKSAM, YEOKSAM_DONG);
		assertThat(MeetupAreaSearch.find(AREAS, "삼동")).containsExactly(YEOKSAM_DONG);
	}

	@Test
	@DisplayName("찾기_맞는곳이많으면_10곳까지다")
	void find_manyMatches_limited() {
		List<MeetupArea> many = IntStream.range(0, 15).mapToObj(i -> new MeetupArea(AreaKind.DONG, "가" + i + "동"))
				.toList();
		assertThat(MeetupAreaSearch.find(many, "가")).hasSize(10);
	}

}
