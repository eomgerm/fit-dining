package kr.co.fitdining.api.place.dto;

import java.util.List;

/**
 * 장소 상세. 장소 고유 정보만 담고, 핏 점수와 추천 이유는 검색 카드({@link PlaceCard})에 있다.
 *
 * @param place 장소 요약
 * @param address 주소
 * @param tags 상세 화면 위쪽에 보이는 장소 태그 2~4개
 * @param photos 사진 URL 목록. 사진 슬라이드에 쓰고, 비어 있으면 FE가 자리표시를 그린다.
 * @param phone 전화번호. 없으면 생략한다.
 * @param website 웹사이트 주소. 없으면 생략한다.
 * @param openStatus 요청 시각 기준 영업 상태
 * @param hours 요일별 영업시간 7개(월~일)
 * @param closedDayNote 휴무 안내 문구(예: "매주 일요일 휴무"). 없으면 생략한다.
 * @param menus 메뉴 목록
 * @param facilities 이용할 수 있는 시설
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
		List<Facility> facilities
) {

	/**
	 * 하루 영업시간. 시각은 모두 {@code HH:mm}이고 자정을 넘지 않는다.
	 *
	 * @param dayOfWeek 요일
	 * @param open 여는 시각. 휴무일이면 없다.
	 * @param close 닫는 시각. 휴무일이면 없다.
	 * @param breakStart 브레이크타임 시작 시각. 없으면 생략한다.
	 * @param breakEnd 브레이크타임 끝 시각. 없으면 생략한다.
	 * @param lastOrders 라스트오더 시각 목록(예: 브레이크 전, 마감 전)
	 * @param closed 휴무일이면 true
	 */
	public record Hours(
			DayCode dayOfWeek,
			String open,
			String close,
			String breakStart,
			String breakEnd,
			List<String> lastOrders,
			Boolean closed
	) {
	}

	/**
	 * 메뉴 1개.
	 *
	 * @param category 메뉴 분류(예: "커피", "디저트"). 메뉴 탭에서 이 값으로 묶는다.
	 * @param name 메뉴 이름
	 * @param price 가격(원). 없으면 생략한다.
	 * @param photoUrl 메뉴 사진 URL. 없으면 생략한다.
	 */
	public record Menu(
			String category,
			String name,
			Integer price,
			String photoUrl
	) {
	}

	/** 요일 */
	public enum DayCode {
		MON, TUE, WED, THU, FRI, SAT, SUN
	}

	/** 시설 */
	public enum Facility {
		/** 주차 */
		PARKING,
		/** 무선 인터넷 */
		WIFI,
		/** 단체 이용 */
		GROUP,
		/** 예약 */
		RESERVATION
	}

}
