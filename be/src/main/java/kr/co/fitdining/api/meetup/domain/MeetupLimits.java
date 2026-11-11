package kr.co.fitdining.api.meetup.domain;

import java.time.Duration;
import java.time.ZoneId;

/**
 * 모임 기능의 기준값을 한곳에 모은다. 모두 시작값이고 환경 변수로 빼지 않는다(spec Constraints, PRD OQ-29).
 * DB 제약(V26)과 FE 입력 제한은 이 값과 따로 맞춘다.
 */
public final class MeetupLimits {

	/** 날짜 계산의 기준 시간대. 서버 시각을 이 시간대의 날짜로 바꿔 판정한다(D-23). */
	public static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");

	public static final int HEADCOUNT_MIN = 2;
	public static final int HEADCOUNT_MAX = 8;
	public static final int DESCRIPTION_MAX = 100;

	/** 모임 날짜는 오늘부터 이 일수 뒤까지 고를 수 있다(AC-1). */
	public static final int DATE_RANGE_DAYS = 30;

	/** 모임 날짜(없으면 만든 날)에서 이 일수가 지나면 닫는다. 삭제는 그다음 날 0시다(AC-2). */
	public static final int KEEP_DAYS = 7;

	public static final int AREA_QUERY_MAX = 20;
	public static final int AREA_RESULTS_MAX = 10;

	/** 메뉴 하나 가격 상한(원)의 범위(AC-6). 단위는 화면의 입력 단위일 뿐 서버는 보지 않고, DB는 0보다 큰지만 본다(D-5). */
	public static final int PRICE_CAP_MIN = 5_000;
	public static final int PRICE_CAP_MAX = 100_000;

	/** 한 모임의 프로필 수. 색(0~7)이 모임 안에서 유일해 DB도 이 수를 넘기지 않는다(D-4). */
	public static final int PROFILE_MAX = 8;
	public static final int NAME_MAX = 10;
	public static final int WANT_MENU_MAX = 20;

	/** 로그인 없는 쓰기 한도. 모임과 IP마다 이 구간에 이 횟수까지다(D-8). */
	public static final int ANONYMOUS_WRITES = 120;
	public static final Duration ANONYMOUS_WRITE_WINDOW = Duration.ofMinutes(15);

	/** 계산 작업 스레드 수와 대기열 길이(D-10) */
	public static final int CALCULATION_THREADS = 2;
	public static final int CALCULATION_QUEUE = 8;
	/** 실행 중인 계산이 이 시간을 넘으면 멈춘 것으로 본다. AI 호출 세 번(한 번에 12초)에 여유를 더했다(D-10). */
	public static final Duration CALCULATION_STALE = Duration.ofSeconds(45);
	public static final int RESULT_MAX = 20;
	/** 참여자 취향 점수가 이 값보다 낮으면 덜 맞는 사람이다(D-18). */
	public static final int MISFIT_SCORE = 50;
	public static final int REASONS_MAX = 2;

	private MeetupLimits() {
	}

}
