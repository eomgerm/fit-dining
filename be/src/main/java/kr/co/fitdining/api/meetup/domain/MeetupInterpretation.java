package kr.co.fitdining.api.meetup.domain;

import java.util.Map;

/**
 * AI가 해석한 모임 설명({@code meetups.parsed_conditions}, D-14). BE는 조건을 해석하지 않고 계산할 때 그대로 돌려보낸다.
 *
 * @param conditions AI가 준 조건. 모양은 AI가 정한다.
 * @param summary 보일 질문을 정하는 요약
 */
public record MeetupInterpretation(Map<String, Object> conditions, Summary summary) {

	/**
	 * @param mentionsFood 설명에 원하는 음식 종류나 메뉴가 있는지. 있으면 음식 질문을 묻지 않는다(D-17).
	 */
	public record Summary(boolean mentionsFood) {
	}

}
