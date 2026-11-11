package kr.co.fitdining.api.meetup.dto;

import java.time.Instant;
import java.util.List;
import kr.co.fitdining.api.meetup.domain.ResultGroup;
import kr.co.fitdining.api.meetup.recommend.MeetupRanking;
import kr.co.fitdining.api.meetup.recommend.MeetupRecommendation;
import kr.co.fitdining.api.place.dto.OpenStatus;
import kr.co.fitdining.api.place.dto.PlaceCard;
import kr.co.fitdining.api.place.dto.PlaceSummary;

/**
 * 마지막으로 성공한 계산의 결과(AC-19, AC-20, D-9). 프로필 번호만 담고 이름은 담지 않는다. 값이 없는 속성은 빠진다.
 *
 * @param calculatedAt 계산이 끝난 시각
 * @param tasteCount 계산에 넣은 프로필 수
 * @param applied 추천에 쓴 합친 취향
 * @param items 정한 순서의 장소
 * @param emptyReason 장소가 없을 때만 있다.
 */
public record MeetupResult(long calculationId, Instant calculatedAt, int tasteCount,
		MeetupRecommendation.Applied applied, List<Item> items, EmptyReason emptyReason) {

	/**
	 * @param openStatus 모임 날짜·시간이 있으면 그 시각, 없으면 지금의 영업 상태. 알 수 없으면 빠진다.
	 * @param score 모임 점수. 점수를 매길 조건이 없으면 빠진다.
	 * @param facilities 단체 이용·예약 중 되는 것만 담는다.
	 */
	public record Item(int rank, PlaceSummary place, OpenStatus openStatus, Integer score, ResultGroup group,
			MeetupRanking.Fit fit, List<PlaceCard.Reason> reasons, String caution, Menu menu, Facilities facilities,
			Distance distance) {
	}

	/** @param price 가격(원). 모르면 빠진다. */
	public record Menu(String name, Integer price) {
	}

	public record Facilities(Boolean group, Boolean reservation) {
	}

	/** 역·동 모임은 가까운 역과 도보 시간, 지점 모임은 지점에서 직선거리다. */
	public record Distance(String station, Integer walkMinutes, Integer meters) {
	}

	/** @param profileIds 지금 있는 프로필 중 원인이 된 프로필 */
	public record EmptyReason(String cause, String suggestion, List<Long> profileIds) {
	}

}
