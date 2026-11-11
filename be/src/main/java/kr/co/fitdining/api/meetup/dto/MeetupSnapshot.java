package kr.co.fitdining.api.meetup.dto;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import kr.co.fitdining.api.meetup.domain.AreaKind;
import kr.co.fitdining.api.meetup.domain.CalculationState;
import kr.co.fitdining.api.meetup.domain.DecisionMethod;
import kr.co.fitdining.api.meetup.domain.MeetupAction;
import kr.co.fitdining.api.meetup.domain.MeetupCategory;
import kr.co.fitdining.api.meetup.domain.MeetupPhase;
import kr.co.fitdining.api.meetup.domain.MeetupQuestions;
import kr.co.fitdining.api.meetup.domain.MeetupRole;
import kr.co.fitdining.api.meetup.domain.PollState;
import kr.co.fitdining.api.meetup.domain.Taste;

/**
 * 모임의 지금 상태를 한 번에 주는 응답(D-9). 값이 없는 속성은 빠진다.
 *
 * @param phase 저장한 상태
 * @param afterMeetup 모임 뒤인지
 * @param info 모임 정보
 * @param questions 질문지에 보일 질문
 * @param me 요청한 사람
 * @param allowed 지금 이 사람이 할 수 있는 동작
 * @param profiles 들어온 순서의 프로필 목록
 * @param pendingCount 아직 취향을 남기지 않은 수. 인원을 정했고 남긴 수가 인원보다 적을 때만 있다.
 * @param calculation 가장 최근 계산. 추천받은 적이 없으면 빠진다.
 * @param resultCalculationId 마지막으로 성공한 계산. 결과는 이 값이 바뀔 때만 다시 받는다.
 * @param poll 투표. 연 적이 없으면 빠진다.
 * @param decision 정한 곳. 없으면 빠진다.
 */
public record MeetupSnapshot(
		MeetupPhase phase,
		boolean afterMeetup,
		Info info,
		MeetupQuestions questions,
		Me me,
		List<MeetupAction> allowed,
		List<Profile> profiles,
		Integer pendingCount,
		Calculation calculation,
		Long resultCalculationId,
		Poll poll,
		Decision decision
) {

	/**
	 * 투표(AC-38, AC-39). 익명 투표에는 누가 어디를 골랐는지와 투표하지 않은 사람이 없다.
	 *
	 * @param state 열림, 닫힘
	 * @param anonymous 익명 투표인지
	 * @param tie 동점으로 마감했는지. 마감할 때 고정한 값이다.
	 * @param tieVotes 동점으로 마감했을 때 고정한 표 수. 동점이 아니면 빠진다.
	 * @param reopenable 동점으로 닫혀 투표를 계속할 수 있는지
	 * @param candidates 후보. 모임장이 고른 순서다.
	 * @param votedCount 투표한 수
	 * @param notVotedCount 투표하지 않은 수
	 * @param notVoted 투표하지 않은 프로필. 이름이 보이는 투표에만 있다.
	 * @param hasVoted 내 프로필이 투표했는지. 프로필이 있을 때만 있다.
	 * @param myVote 내가 고른 곳. 익명 투표에서는 그 표를 던진 브라우저나 그 회원에게만 있다.
	 */
	public record Poll(PollState state, boolean anonymous, boolean tie, Integer tieVotes, boolean reopenable,
			List<Candidate> candidates, int votedCount, int notVotedCount, List<Long> notVoted, Boolean hasVoted,
			Long myVote) {
	}

	/**
	 * @param placeId 장소 id
	 * @param votes 표 수
	 * @param voters 고른 프로필. 이름이 보이는 투표에만 있다.
	 */
	public record Candidate(long placeId, int votes, List<Long> voters) {
	}

	/**
	 * @param placeId 정한 장소
	 * @param method 정한 방법
	 * @param tieVotes 동점에서 고른 경우의 동점 표 수. 그 밖에는 빠진다.
	 */
	public record Decision(long placeId, DecisionMethod method, Integer tieVotes) {
	}

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
	 * @param tasteReflected 내 취향이 마지막으로 성공한 추천에 들어갔는지. 프로필이 있을 때만 있다(AC-18).
	 * @param convertible 비회원 프로필을 로그인한 회원의 프로필로 바꿀 수 있을 때만 true로 있다(D-25).
	 */
	public record Me(MeetupRole role, Long profileId, boolean signedIn, Boolean tasteReflected,
			Boolean convertible) {
	}

	/**
	 * @param state 실행 중인 계산이 45초를 넘었으면 이미 실패로 바뀌어 있다(AC-17).
	 * @param tasteCount 계산에 넣은 프로필 수
	 * @param outdated 마지막으로 성공한 계산 뒤에 취향이나 모임 정보가 바뀌었거나 그 계산의 프로필이 지워졌는지(AC-18)
	 */
	public record Calculation(long id, CalculationState state, Instant startedAt, int tasteCount,
			boolean outdated) {
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
