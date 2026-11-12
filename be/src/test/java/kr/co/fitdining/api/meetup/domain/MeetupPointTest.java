package kr.co.fitdining.api.meetup.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 모임 지점의 값 검사와 직선거리(AC-58, AC-59) */
class MeetupPointTest {

	@Test
	@DisplayName("지점_위도경도가범위안이고반경이고를수있는값이어야한다")
	void valid_rangesAndRadii() {
		assertThat(MeetupPoint.valid(37.5, 127.05, 1000)).isTrue();
		assertThat(MeetupPoint.valid(-90.0, 180.0, 5000)).isTrue();
		assertThat(MeetupPoint.valid(37.5, 127.05, 700)).isFalse();
		assertThat(MeetupPoint.valid(90.5, 127.05, 500)).isFalse();
		assertThat(MeetupPoint.valid(37.5, -181.0, 500)).isFalse();
		assertThat(MeetupPoint.valid(Double.NaN, 127.05, 500)).isFalse();
		assertThat(MeetupPoint.valid(null, 127.05, 500)).isFalse();
		assertThat(MeetupPoint.valid(37.5, 127.05, null)).isFalse();
	}

	@Test
	@DisplayName("거리_위도0점01도는약1112m이고_반경경계는안이다")
	void metersTo_haversine() {
		MeetupPoint point = new MeetupPoint(37.5, 127.0, 1000);

		assertThat(point.metersTo(37.51, 127.0)).isCloseTo(1112, within(1.0));
		assertThat(point.metersTo(37.5, 127.0)).isZero();
		assertThat(point.contains(37.5 + 1000 / 111_195.0, 127.0)).isTrue();
		assertThat(point.contains(37.51, 127.0)).isFalse();
	}

}
