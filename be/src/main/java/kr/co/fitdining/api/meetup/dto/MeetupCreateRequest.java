package kr.co.fitdining.api.meetup.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import java.time.LocalDate;
import java.time.LocalTime;
import kr.co.fitdining.api.meetup.domain.AreaKind;
import kr.co.fitdining.api.meetup.domain.MeetupCategory;
import kr.co.fitdining.api.meetup.domain.MeetupLimits;

/**
 * 모임 만들기 요청(AC-1). 날짜 범위, 지난 시각, 지역이 고를 수 있는 곳인지, 설명 길이는 서비스가 확인한다.
 *
 * @param area 모임 지역
 * @param category 업종. 빼면 식당이다.
 * @param date 모임 날짜(KST). 생략할 수 있다.
 * @param time 모임 시각("19:00"). 날짜가 있어야 하고 분 아래는 버린다.
 * @param headcount 인원. 생략하면 정하지 않은 것이다.
 * @param description 모임 설명. 앞뒤 공백을 지운 값이 100자까지이고 공백뿐이면 없는 것으로 본다.
 */
public record MeetupCreateRequest(
		@NotNull @Valid Area area,
		MeetupCategory category,
		LocalDate date,
		LocalTime time,
		@Min(MeetupLimits.HEADCOUNT_MIN) @Max(MeetupLimits.HEADCOUNT_MAX) Integer headcount,
		String description
) {

	/**
	 * 모임 지역. 역·동은 지역 찾기가 준 종류와 이름 그대로다. 지점({@code POINT})은 지점과 반경이고, 이름은 위치 이름이다
	 * (AC-58). 지점 이름을 비우면 반경 안 장소로 붙인 이름을 쓴다.
	 *
	 * @param kind 지역 종류
	 * @param name 역·동 이름, 또는 지점의 위치 이름
	 * @param lat 지점의 위도. 역·동이면 없다.
	 * @param lng 지점의 경도
	 * @param radiusM 지점의 반경(m)
	 */
	public record Area(@NotNull AreaKind kind, String name, Double lat, Double lng, Integer radiusM) {

		public Area(AreaKind kind, String name) {
			this(kind, name, null, null, null);
		}

		/** 지점이면 지점과 반경이 모두 있고, 역·동이면 하나도 없다. 값의 범위는 서비스가 본다. */
		@AssertTrue
		public boolean isWellShaped() {
			boolean located = lat != null && lng != null && radiusM != null;
			boolean unlocated = lat == null && lng == null && radiusM == null;
			return kind == AreaKind.POINT ? located : unlocated;
		}
	}

}
