package kr.co.fitdining.api.meetup.dto;

import java.time.LocalDate;
import java.util.List;
import kr.co.fitdining.api.meetup.domain.AreaKind;
import kr.co.fitdining.api.meetup.domain.MeetupAction;
import kr.co.fitdining.api.meetup.domain.MeetupCategory;
import kr.co.fitdining.api.meetup.domain.MeetupPhase;
import kr.co.fitdining.api.meetup.domain.MeetupQuestions;
import kr.co.fitdining.api.meetup.domain.MeetupRole;
import kr.co.fitdining.api.meetup.domain.Taste;

/**
 * 모임의 지금 상태를 한 번에 주는 응답(D-9). 값이 없는 속성은 빠진다. 계산, 투표, 정한 곳은 그 기능을 만들 때 더한다.
 *
 * @param phase 저장한 상태
 * @param afterMeetup 모임 뒤인지
 * @param info 모임 정보
 * @param questions 질문지에 보일 질문
 * @param me 요청한 사람
 * @param allowed 지금 이 사람이 할 수 있는 동작
 * @param profiles 들어온 순서의 프로필 목록
 * @param pendingCount 아직 취향을 남기지 않은 수. 인원을 정했고 남긴 수가 인원보다 적을 때만 있다.
 */
public record MeetupSnapshot(
		MeetupPhase phase,
		boolean afterMeetup,
		Info info,
		MeetupQuestions questions,
		Me me,
		List<MeetupAction> allowed,
		List<Profile> profiles,
		Integer pendingCount
) {

	/**
	 * @param area 모임 지역
	 * @param category 업종
	 * @param date 모임 날짜. 없으면 빠진다.
	 * @param time 모임 시각("19:00"). 없으면 빠진다.
	 * @param headcount 인원. 정하지 않았으면 빠진다.
	 * @param description 모임 설명. 없으면 빠진다.
	 * @param hostNickname 모임장 닉네임
	 * @param expiresOn 모임을 열 수 있는 마지막 날(KST)
	 */
	public record Info(Area area, MeetupCategory category, LocalDate date, String time, Integer headcount,
			String description, String hostNickname, LocalDate expiresOn) {
	}

	/**
	 * @param kind 지역 종류
	 * @param name 역은 "역"을 뺀 이름, 동은 동 이름
	 */
	public record Area(AreaKind kind, String name) {
	}

	/**
	 * @param role 역할
	 * @param profileId 내 프로필. 없으면 빠진다.
	 * @param signedIn 로그인했는지
	 * @param convertible 비회원 프로필을 로그인한 회원의 프로필로 바꿀 수 있을 때만 true로 있다(D-25).
	 */
	public record Me(MeetupRole role, Long profileId, boolean signedIn, Boolean convertible) {
	}

	/**
	 * @param id 프로필 id
	 * @param name 이름
	 * @param color 아바타 색(0~7)
	 * @param member 회원 프로필인지
	 * @param host 모임장의 프로필인지
	 * @param taste 지금 보이는 질문의 답. 답이 하나도 없으면 빠진다.
	 * @param reflected 마지막으로 성공한 추천에 이 취향이 들어갔는지. 추천이 없으면 false다.
	 */
	public record Profile(long id, String name, int color, boolean member, boolean host, Taste taste,
			boolean reflected) {
	}

}
