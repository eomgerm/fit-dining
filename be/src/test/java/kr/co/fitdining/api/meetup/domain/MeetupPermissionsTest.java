package kr.co.fitdining.api.meetup.domain;

import static kr.co.fitdining.api.meetup.domain.MeetupAction.CALCULATE;
import static kr.co.fitdining.api.meetup.domain.MeetupAction.CANCEL_DECISION;
import static kr.co.fitdining.api.meetup.domain.MeetupAction.CHANGE_DECISION;
import static kr.co.fitdining.api.meetup.domain.MeetupAction.CLOSE_POLL;
import static kr.co.fitdining.api.meetup.domain.MeetupAction.DECIDE;
import static kr.co.fitdining.api.meetup.domain.MeetupAction.EDIT_DATE;
import static kr.co.fitdining.api.meetup.domain.MeetupAction.EDIT_INFO;
import static kr.co.fitdining.api.meetup.domain.MeetupAction.EDIT_TASTE;
import static kr.co.fitdining.api.meetup.domain.MeetupAction.JOIN;
import static kr.co.fitdining.api.meetup.domain.MeetupAction.LINK_ACCOUNT;
import static kr.co.fitdining.api.meetup.domain.MeetupAction.OPEN_POLL;
import static kr.co.fitdining.api.meetup.domain.MeetupAction.REMOVE_PROFILE;
import static kr.co.fitdining.api.meetup.domain.MeetupAction.REOPEN_POLL;
import static kr.co.fitdining.api.meetup.domain.MeetupAction.VOTE;
import static org.assertj.core.api.Assertions.assertThat;

import java.util.EnumSet;
import java.util.Set;
import java.util.stream.Stream;
import kr.co.fitdining.api.meetup.domain.MeetupPermissions.Situation;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

/** 모임 추천 PRD §5.1 표를 그대로 옮겨 상태·역할별 허용 동작을 확인한다(AC-4). */
class MeetupPermissionsTest {

	private static final MeetupRole HOST = MeetupRole.HOST;
	private static final MeetupRole PARTICIPANT = MeetupRole.PARTICIPANT;
	private static final MeetupRole VIEWER = MeetupRole.VIEWER;

	/** 상태, 역할, 투표 상태, 동점, 기대 동작. 프로필은 모임장과 참여자에게 있고 보기만 하는 사람에게 없다. */
	static Stream<Arguments> table() {
		return Stream.of(
				row("대기_모임장", MeetupPhase.WAITING, HOST, null, false, EDIT_INFO, REMOVE_PROFILE, CALCULATE, EDIT_TASTE),
				row("대기_참여자", MeetupPhase.WAITING, PARTICIPANT, null, false, EDIT_TASTE),
				row("대기_프로필없음", MeetupPhase.WAITING, VIEWER, null, false, JOIN),
				row("결과_모임장", MeetupPhase.RESULT, HOST, null, false, EDIT_INFO, REMOVE_PROFILE, OPEN_POLL, DECIDE,
						EDIT_TASTE),
				row("결과_참여자", MeetupPhase.RESULT, PARTICIPANT, null, false, EDIT_TASTE),
				row("결과_프로필없음", MeetupPhase.RESULT, VIEWER, null, false, JOIN),
				row("투표중_모임장", MeetupPhase.VOTING, HOST, PollState.OPEN, false, EDIT_DATE, REMOVE_PROFILE,
						CLOSE_POLL, EDIT_TASTE, VOTE),
				row("투표중_참여자", MeetupPhase.VOTING, PARTICIPANT, PollState.OPEN, false, EDIT_TASTE, VOTE),
				row("투표중_프로필없음", MeetupPhase.VOTING, VIEWER, PollState.OPEN, false, JOIN),
				row("동점마감_모임장", MeetupPhase.VOTING, HOST, PollState.CLOSED, true, EDIT_DATE, REMOVE_PROFILE, DECIDE,
						REOPEN_POLL, EDIT_TASTE),
				row("정한곳취소뒤마감투표_모임장", MeetupPhase.VOTING, HOST, PollState.CLOSED, false, EDIT_DATE,
						REMOVE_PROFILE, DECIDE, EDIT_TASTE),
				row("마감투표_참여자", MeetupPhase.VOTING, PARTICIPANT, PollState.CLOSED, true, EDIT_TASTE),
				row("정함_모임장", MeetupPhase.DECIDED, HOST, PollState.CLOSED, false, CHANGE_DECISION, CANCEL_DECISION,
						EDIT_DATE, REMOVE_PROFILE, EDIT_TASTE),
				row("정함_참여자", MeetupPhase.DECIDED, PARTICIPANT, null, false, EDIT_TASTE),
				row("정함_프로필없음", MeetupPhase.DECIDED, VIEWER, null, false, JOIN));
	}

	private static Arguments row(String name, MeetupPhase phase, MeetupRole role, PollState poll, boolean reopenable,
			MeetupAction... expected) {
		return Arguments.of(name, new Situation(phase, role, role != VIEWER, false, false, false, poll, reopenable,
				false), expected.length == 0 ? EnumSet.noneOf(MeetupAction.class) : EnumSet.of(expected[0], expected));
	}

	@ParameterizedTest(name = "{0}")
	@MethodSource("table")
	@DisplayName("허용동작_PRD표의상태와역할이면_표에있는동작만준다")
	void allowed_prdTable_matches(String name, Situation situation, Set<MeetupAction> expected) {
		assertThat(MeetupPermissions.allowed(situation)).containsExactlyInAnyOrderElementsOf(expected);
	}

	@Test
	@DisplayName("허용동작_결과에서추천뒤바뀐것이있으면_다시추천받기가있다")
	void allowed_resultOutdated_includesCalculate() {
		assertThat(MeetupPermissions.allowed(new Situation(MeetupPhase.RESULT, HOST, true, false, false, true, null,
				false, false))).contains(CALCULATE);
	}

	@Test
	@DisplayName("허용동작_계산중인모임장이면_모임장동작이없다")
	void allowed_calculatingHost_hasNoHostActions() {
		assertThat(MeetupPermissions.allowed(new Situation(MeetupPhase.WAITING, HOST, true, false, true, false, null,
				false, false))).containsExactly(EDIT_TASTE);
	}

	@Test
	@DisplayName("허용동작_계산중인참여자면_취향수정은남는다")
	void allowed_calculatingParticipant_keepsEditTaste() {
		assertThat(MeetupPermissions.allowed(new Situation(MeetupPhase.RESULT, PARTICIPANT, true, false, true, false,
				null, false, false))).containsExactly(EDIT_TASTE);
	}

	@Test
	@DisplayName("허용동작_프로필없는모임장이면_참여와모임장동작이있다")
	void allowed_hostWithoutProfile_joinsAndManages() {
		assertThat(MeetupPermissions.allowed(new Situation(MeetupPhase.WAITING, HOST, false, false, false, false, null,
				false, false))).containsExactly(EDIT_INFO, REMOVE_PROFILE, CALCULATE, JOIN);
	}

	@Test
	@DisplayName("허용동작_모임뒤면_프로필없는사람의참여만남는다")
	void allowed_afterMeetup_onlyJoinForViewer() {
		assertThat(MeetupPermissions.allowed(new Situation(MeetupPhase.DECIDED, HOST, true, true, false, false,
				PollState.CLOSED, false, false))).isEmpty();
		assertThat(MeetupPermissions.allowed(new Situation(MeetupPhase.DECIDED, VIEWER, false, true, false, false,
				null, false, false))).containsExactly(JOIN);
	}

	@Test
	@DisplayName("허용동작_비회원프로필을바꿀수있으면_회원프로필로바꾸기가있다")
	void allowed_convertible_includesLinkAccount() {
		assertThat(MeetupPermissions.allowed(new Situation(MeetupPhase.WAITING, PARTICIPANT, true, false, false, false,
				null, false, true))).containsExactly(EDIT_TASTE, LINK_ACCOUNT);
	}

	@Test
	@DisplayName("허용동작_순서는_동작선언순서다")
	void allowed_order_followsDeclaration() {
		assertThat(MeetupPermissions.allowed(new Situation(MeetupPhase.RESULT, HOST, true, false, false, true, null,
				false, false))).containsExactly(EDIT_INFO, REMOVE_PROFILE, CALCULATE, OPEN_POLL, DECIDE, EDIT_TASTE);
	}

}
