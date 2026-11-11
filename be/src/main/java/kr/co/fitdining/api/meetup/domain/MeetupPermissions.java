package kr.co.fitdining.api.meetup.domain;

import java.util.EnumSet;
import java.util.Set;

/**
 * 모임 추천 PRD §5.1의 상태·역할별 화면 표를 옮긴 것이다(D-3). 스냅숏의 {@code allowed}는 여기서만 정한다.
 *
 * <p>계산 중에는 모임장이 불러오는 중 화면만 보므로 모임장 동작이 없다. 모임 뒤에는 정한 곳 보기와 방문 평가만 남아 참여와
 * 회원 프로필로 바꾸기 말고는 동작이 없다. 프로필이 없는 사람은 닫히기 전 어느 상태에서든 참여할 수 있다(PRD §5.1).
 */
public final class MeetupPermissions {

	private MeetupPermissions() {
	}

	/**
	 * 지금 모임과 요청한 사람.
	 *
	 * @param phase 저장한 상태
	 * @param role 요청한 사람의 역할
	 * @param hasProfile 요청한 사람에게 이 모임의 프로필이 있는지. 모임장도 없을 수 있다.
	 * @param afterMeetup 모임 뒤인지(D-3)
	 * @param calculating 실행 중인 계산이 있는지
	 * @param outdated 마지막으로 성공한 계산 뒤에 취향이나 모임 정보가 바뀌었거나 프로필이 지워졌는지
	 * @param poll 투표 상태. 연 적이 없으면 null이다.
	 * @param reopenable 동점으로 닫혀 다시 열 수 있는지
	 * @param convertible 로그인한 회원이 비회원 프로필을 자기 프로필로 바꿀 수 있는지(D-25)
	 */
	public record Situation(MeetupPhase phase, MeetupRole role, boolean hasProfile, boolean afterMeetup,
			boolean calculating, boolean outdated, PollState poll, boolean reopenable, boolean convertible) {
	}

	/** @return 지금 이 사람이 할 수 있는 동작. 순서는 {@link MeetupAction}의 선언 순서다. */
	public static Set<MeetupAction> allowed(Situation s) {
		EnumSet<MeetupAction> actions = EnumSet.noneOf(MeetupAction.class);
		if (s.convertible()) {
			actions.add(MeetupAction.LINK_ACCOUNT);
		}
		if (!s.hasProfile()) {
			actions.add(MeetupAction.JOIN);
		}
		if (s.afterMeetup()) {
			return actions;
		}
		if (s.hasProfile()) {
			actions.add(MeetupAction.EDIT_TASTE);
			if (s.poll() == PollState.OPEN) {
				actions.add(MeetupAction.VOTE);
			}
		}
		if (s.role() == MeetupRole.HOST && !s.calculating()) {
			actions.addAll(hostActions(s));
		}
		return actions;
	}

	private static Set<MeetupAction> hostActions(Situation s) {
		return switch (s.phase()) {
			case WAITING -> EnumSet.of(MeetupAction.CALCULATE, MeetupAction.EDIT_INFO, MeetupAction.REMOVE_PROFILE);
			case RESULT -> {
				EnumSet<MeetupAction> result = EnumSet.of(MeetupAction.OPEN_POLL, MeetupAction.DECIDE,
						MeetupAction.EDIT_INFO, MeetupAction.REMOVE_PROFILE);
				// 투표를 한 번 열었으면 다시 추천받을 수 없다(PRD §5.1).
				if (s.outdated() && s.poll() == null) {
					result.add(MeetupAction.CALCULATE);
				}
				yield result;
			}
			case VOTING -> {
				EnumSet<MeetupAction> voting = EnumSet.of(MeetupAction.EDIT_DATE, MeetupAction.REMOVE_PROFILE);
				if (s.poll() == PollState.OPEN) {
					voting.add(MeetupAction.CLOSE_POLL);
				} else {
					voting.add(MeetupAction.DECIDE);
					if (s.reopenable()) {
						voting.add(MeetupAction.REOPEN_POLL);
					}
				}
				yield voting;
			}
			case DECIDED -> EnumSet.of(MeetupAction.CHANGE_DECISION, MeetupAction.CANCEL_DECISION,
					MeetupAction.EDIT_DATE, MeetupAction.REMOVE_PROFILE);
		};
	}

}
