package kr.co.fitdining.api.place;

import java.util.List;

/**
 * 서비스 역 코드의 기준 목록. DB 제약({@code ck_places_station})과 BE {@code PlaceSummary.Station}이 이 목록과 같아야 한다.
 * AI와 FE는 {@code ai/tests/match/test_station_contract.py}가 BE enum과 견준다. 새 역을 더하면 이 목록부터 고친다.
 */
final class StationCodes {

	/** 서울(강남권 15개), 대전, 구미, 부산 순서다. 서울의 나머지 역은 나중에 더한다. */
	static final List<String> ALL = List.of(
			"GANGNAM", "YEOKSAM", "SEOLLEUNG",
			"SINNONHYEON", "NONHYEON", "EONJU", "HANTI", "SAMSEONG_JUNGANG", "GYODAE", "SEONJEONGNEUNG",
			"SAMSEONG", "HAKDONG", "SAPYEONG", "DOGOK", "BONGEUNSA",
			"YUSEONG_ONCHEON", "GUAM", "NOEUN", "BANSEOK", "DAEJEON_WORLDCUP_STADIUM", "JIJOK", "GAPCHEON",
			"HYEONCHUNGWON", "WOLPYEONG",
			"GUMI", "SAGOK",
			"JEONPO", "SEOMYEON", "GEUMNYEONSAN", "SASANG", "HADAN", "GWANGAN", "NAMPO", "DONGNAE");

	private StationCodes() {
	}

}
