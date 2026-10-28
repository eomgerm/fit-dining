package kr.co.fitdining.api.place.dto;

import java.util.List;

/**
 * 장소 상세. 장소 고유 정보만 담고, 핏 점수와 추천 이유는 검색 카드({@link PlaceCard})에 있다.
 *
 * @param place 장소 요약
 * @param address 주소
 * @param tags 상세 화면 위쪽에 보이는 장소 태그 2~4개
 * @param photos 사진 URL 목록(업체 사진 다음 메뉴판 사진). 원본 URL이고, 비어 있으면 FE가 자리표시를 그린다.
 * @param phone 대표 전화번호. 없으면 생략한다.
 * @param website 웹사이트 주소. 없으면 생략한다.
 * @param openStatus 요청 시각 기준 영업 상태
 * @param hours 요일별 영업시간 7개(월~일)
 * @param closedDayNote 정기휴무 안내 문구(예: "매주 일요일 휴무"). 정기휴무가 없으면 생략한다.
 * @param menus 메뉴 목록. 원본 순서다.
 * @param facilities 편의시설 이름(네이버 이름 그대로)
 * @param subways 가까운 지하철역. 도보 거리순이다.
 * @param directions 찾아오는 길. 없으면 생략한다.
 * @param parking 주차 정보. 없으면 생략한다.
 * @param pet 반려동물 정책. 없으면 생략한다.
 * @param noKidsZone 노키즈존이면 true({@code facilities}에 "노키즈존"이 있다)
 * @param corkage 콜키지 정책. 없으면 생략한다.
 * @param bookingUrl 가게의 네이버 예약 페이지. 없으면 생략한다.
 * @param seats 좌석 종류
 * @param description 업체 소개. 없으면 생략한다.
 * @param paymentMethods 결제 수단
 * @param broadcasts 방송 출연
 * @param extraLinks 대표 웹사이트 말고 업체가 등록한 링크 URL
 */
public record PlaceDetailResponse(
		PlaceSummary place,
		String address,
		List<String> tags,
		List<String> photos,
		String phone,
		String website,
		OpenStatus openStatus,
		List<Hours> hours,
		String closedDayNote,
		List<Menu> menus,
		List<String> facilities,
		List<Subway> subways,
		String directions,
		Parking parking,
		Pet pet,
		Boolean noKidsZone,
		Corkage corkage,
		String bookingUrl,
		List<Seat> seats,
		String description,
		List<String> paymentMethods,
		List<Broadcast> broadcasts,
		List<String> extraLinks
) {

	/**
	 * 하루 영업시간. 시각은 모두 {@code HH:mm}이다. {@code close}가 {@code open}과 같거나 이르면 다음 날 마감이고,
	 * 24시간 영업은 둘 다 {@code "00:00"}이다. 영업시간 정보가 없는 요일은 {@code closed}가 false이고 시각이 없다.
	 *
	 * @param dayOfWeek 요일
	 * @param open 여는 시각. 휴무일이나 정보 없는 요일이면 없다.
	 * @param close 닫는 시각. 휴무일이나 정보 없는 요일이면 없다.
	 * @param breaks 브레이크타임 목록
	 * @param lastOrders 라스트오더 시각 목록
	 * @param closed 휴무일이면 true
	 */
	public record Hours(
			DayCode dayOfWeek,
			String open,
			String close,
			List<Break> breaks,
			List<String> lastOrders,
			Boolean closed
	) {
	}

	/**
	 * 브레이크타임 1개. 시작 포함, 끝 제외다.
	 *
	 * @param start 시작 시각
	 * @param end 끝 시각
	 */
	public record Break(
			String start,
			String end
	) {
	}

	/**
	 * 메뉴 1개.
	 *
	 * @param category 사장님이 붙인 메뉴 분류. 없으면 생략한다.
	 * @param name 메뉴 이름
	 * @param description 메뉴 설명. 없으면 생략한다.
	 * @param price 가격(원). 정가일 때만 있다.
	 * @param priceText 가격 원문(예: "10,000~13,000원", "가격 변동"). 없으면 생략한다.
	 * @param labels 라벨(예: "2인이상", "사전예약")
	 * @param representative 대표 메뉴면 true
	 * @param photoUrl 메뉴 사진 URL. 없으면 생략한다.
	 */
	public record Menu(
			String category,
			String name,
			String description,
			Integer price,
			String priceText,
			List<String> labels,
			Boolean representative,
			String photoUrl
	) {
	}

	/**
	 * 지하철역 1개.
	 *
	 * @param station 역 이름(네이버 값 그대로)
	 * @param line 노선(네이버 값 그대로, 예: "2", "신분당"). 없으면 생략한다.
	 * @param exit 가까운 출구. 없으면 생략한다.
	 * @param walkMinutes 도보 분. 없으면 생략한다.
	 */
	public record Subway(
			String station,
			String line,
			String exit,
			Integer walkMinutes
	) {
	}

	/**
	 * 주차 정보.
	 *
	 * @param free 기본 주차가 무료면 true. 모르면 생략한다.
	 * @param note 주차 안내. 없으면 생략한다.
	 * @param valet 발렛파킹이 되면 true({@code facilities}에 "발렛파킹"이 있다)
	 */
	public record Parking(
			Boolean free,
			String note,
			Boolean valet
	) {
	}

	/**
	 * 반려동물 정책.
	 *
	 * @param allowed 동반 가능하면 true. 모르면 생략한다.
	 * @param note 안내. 없으면 생략한다.
	 */
	public record Pet(
			Boolean allowed,
			String note
	) {
	}

	/**
	 * 콜키지 정책.
	 *
	 * @param allowed 콜키지가 되면 true. 모르면 생략한다.
	 * @param note 안내. 없으면 생략한다.
	 */
	public record Corkage(
			Boolean allowed,
			String note
	) {
	}

	/**
	 * 좌석 종류 1개.
	 *
	 * @param name 좌석 이름(예: "단체석")
	 * @param description 설명. 없으면 생략한다.
	 */
	public record Seat(
			String name,
			String description
	) {
	}

	/**
	 * 방송 출연 1건.
	 *
	 * @param channel 채널. 없으면 생략한다.
	 * @param program 프로그램. 없으면 생략한다.
	 * @param episode 회차. 없으면 생략한다.
	 * @param airedOn 방영일({@code yyyy-MM-dd}). 없으면 생략한다.
	 * @param menu 소개된 메뉴. 없으면 생략한다.
	 */
	public record Broadcast(
			String channel,
			String program,
			String episode,
			String airedOn,
			String menu
	) {
	}

	/** 요일 */
	public enum DayCode {
		MON, TUE, WED, THU, FRI, SAT, SUN
	}

}
