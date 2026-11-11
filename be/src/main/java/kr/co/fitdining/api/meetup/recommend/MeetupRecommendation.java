package kr.co.fitdining.api.meetup.recommend;

import java.util.List;
import kr.co.fitdining.api.meetup.domain.FoodType;
import kr.co.fitdining.api.meetup.domain.Mood;
import kr.co.fitdining.api.place.dto.PlaceCard;

/**
 * 추천기가 돌려준 계산 결과(D-11). 계산 행에 그대로 저장하고, 순위와 잘 맞는 사람 표시는 결과를 줄 때 정한다(D-18).
 * 이름은 담지 않고 프로필 번호만 담는다(D-5).
 *
 * @param places 20곳까지이고 추천기가 정한 순서다.
 * @param applied 추천에 쓴 합친 취향
 * @param emptyReason 장소가 없을 때만 있다.
 */
public record MeetupRecommendation(List<Place> places, Applied applied, EmptyReason emptyReason) {

	/**
	 * @param score 모임 점수(0~100). 점수를 매길 조건이 없으면 null이다(AC-20).
	 * @param members 계산에 넣은 프로필마다의 취향 점수
	 */
	public record Place(long placeId, Integer score, List<PlaceCard.Reason> reasons, String caution,
			List<MemberScore> members) {
	}

	/**
	 * @param score 참여자 취향 점수. 답이 없으면 null이고, 그 사람은 잘 맞는 사람이다(AC-19).
	 * @param unverified 근거를 확인하지 못한 항목이 있는지
	 * @param missedMenu 이 사람이 원한 메뉴를 이 장소가 팔지 않으면 그 메뉴(D-26)
	 */
	public record MemberScore(long profileId, Integer score, boolean unverified, String missedMenu) {
	}

	/** @param wantMenus 해석한 메뉴 이름 */
	public record Applied(Mood mood, List<FoodType> likeFoods, List<FoodType> avoidFoods, Boolean noSpicy,
			Integer priceCap, List<String> wantMenus) {

		public static final Applied NONE = new Applied(null, null, null, null, null, null);

		/** 합친 취향이 하나도 없는지. JSON 속성이 되지 않도록 getter 이름을 피했다. */
		public boolean blank() {
			return equals(NONE);
		}
	}

	/** @param profileIds 참여자의 조건 때문이면 그 프로필 번호 */
	public record EmptyReason(String cause, String suggestion, List<Long> profileIds) {
	}

}
