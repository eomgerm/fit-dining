package kr.co.fitdining.api.review.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.time.LocalDate;
import java.util.List;
import kr.co.fitdining.api.place.dto.PlaceSummary.CategoryGroup;
import kr.co.fitdining.api.place.dto.PlaceSummary.Station;

/**
 * 리뷰 작성 화면 데이터(D-37).
 *
 * @param reviewedDates 이 사용자가 이 장소에 이미 쓴 방문일. 방문일 범위 안의 날짜만 담는다.
 * @param writable 작성할 수 있는지. 작성 차단(S15P31A302-56) 전에는 늘 true다.
 */
public record ReviewFormResponse(
		Place place,
		VisitDate visitDate,
		List<LocalDate> reviewedDates,
		Tags tags,
		Limits limits,
		Boolean writable
) {

	/**
	 * @param thumbnailUrl 장소 대표 사진. 없으면 생략하고 FE가 기본 이미지를 그린다.
	 * @param lat 위도. FE가 기기 위치와 견줘 방문을 확인하는 데만 쓴다(D-43).
	 * @param lng 경도
	 */
	public record Place(String name, CategoryGroup categoryGroup, Station station, String thumbnailUrl, Double lat,
			Double lng) {
	}

	public record VisitDate(LocalDate min, LocalDate max, @JsonProperty("default") LocalDate defaultDate) {
	}

	public record Tags(List<FormTag> good, List<FormTag> bad) {
	}

	/** @param group 같은 값의 태그는 함께 고를 수 없다 */
	public record FormTag(String code, String label, String group, String displayGroup) {
	}

	public record Limits(Integer descriptionMax, Integer photoMax, Integer spentPerPersonMax) {
	}

}
