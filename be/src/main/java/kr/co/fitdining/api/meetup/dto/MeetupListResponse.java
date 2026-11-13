package kr.co.fitdining.api.meetup.dto;

import java.time.LocalDate;
import java.util.List;
import kr.co.fitdining.api.meetup.domain.MeetupCategory;
import kr.co.fitdining.api.meetup.domain.MeetupPhase;
import kr.co.fitdining.api.meetup.domain.MeetupRole;

/**
 * 내 모임(AC-75). 진행 중인 모임이 먼저 최근에 만든 순서로, 끝난 모임(정함)이 그 뒤에 최근에 정한 순서로 온다.
 *
 * @param items 모임 목록
 */
public record MeetupListResponse(List<Item> items) {

	/**
	 * @param code 모임 코드
	 * @param role 만든 모임이면 HOST, 회원 프로필로 참여한 모임이면 PARTICIPANT
	 * @param phase 저장한 상태
	 * @param area 모임 지역
	 * @param category 업종
	 * @param date 모임 날짜. 없으면 빠진다.
	 * @param time 모임 시각("19:00"). 없으면 빠진다.
	 * @param headcount 정한 인원. 없으면 빠진다.
	 * @param profileCount 취향을 남긴 프로필 수
	 * @param decidedPlaceName 정한 곳 이름. 정한 곳이 없거나 장소를 찾지 못하면 빠진다.
	 */
	public record Item(String code, MeetupRole role, MeetupPhase phase, MeetupSnapshot.Area area,
			MeetupCategory category, LocalDate date, String time, Integer headcount, int profileCount,
			String decidedPlaceName) {
	}

}
