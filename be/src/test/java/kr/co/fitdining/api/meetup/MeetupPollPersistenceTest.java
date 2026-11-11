package kr.co.fitdining.api.meetup;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.function.Consumer;
import java.util.stream.LongStream;
import kr.co.fitdining.api.auth.domain.AuthUser;
import kr.co.fitdining.api.auth.repository.AuthUserRepository;
import kr.co.fitdining.api.meetup.domain.AreaKind;
import kr.co.fitdining.api.meetup.domain.DecisionMethod;
import kr.co.fitdining.api.meetup.domain.MeetupAction;
import kr.co.fitdining.api.meetup.domain.MeetupCategory;
import kr.co.fitdining.api.meetup.domain.MeetupPhase;
import kr.co.fitdining.api.meetup.domain.Mood;
import kr.co.fitdining.api.meetup.domain.PollState;
import kr.co.fitdining.api.meetup.domain.Taste;
import kr.co.fitdining.api.meetup.dto.MeetupCreateRequest;
import kr.co.fitdining.api.meetup.dto.MeetupSnapshot;
import kr.co.fitdining.api.meetup.dto.PollOpenRequest;
import kr.co.fitdining.api.meetup.dto.ProfileCreateRequest;
import kr.co.fitdining.api.meetup.exception.InvalidMeetupException;
import kr.co.fitdining.api.meetup.exception.MeetupConflictException;
import kr.co.fitdining.api.meetup.exception.MeetupConflictException.Conflict;
import kr.co.fitdining.api.meetup.exception.MeetupForbiddenException;
import kr.co.fitdining.api.meetup.recommend.MeetupRecommendation;
import kr.co.fitdining.api.meetup.recommend.MeetupRecommender;
import kr.co.fitdining.api.support.PostgresTestSupport;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * 실제 PostgreSQL로 투표 열기, 투표, 마감과 동점, 투표 계속하기, 정하기·바꾸기·취소, 투표의 노출 범위를 확인한다
 * (AC-36 ~ AC-42). 계산은 커밋 뒤 바로 같은 스레드에서 끝나게 바꾼다. 이 테스트가 만든 회원, 장소, 모임은 앞뒤로 지운다.
 */
@SpringBootTest
@Import(MeetupPollPersistenceTest.Configuration.class)
class MeetupPollPersistenceTest extends PostgresTestSupport {

	/** 2026-11-11 12:00 KST */
	private static final Instant NOON = Instant.parse("2026-11-11T03:00:00Z");
	private static final String PREFIX = "meetup-poll-test-";
	private static final String HOST = PREFIX + "host";
	private static final String MEMBER = PREFIX + "member";
	private static final long AREA_PLACE = 9300;
	/** 결과에 드는 장소. 장소 행은 없어도 된다. */
	private static final long P1 = 9301;
	private static final long P2 = 9302;
	private static final long P3 = 9303;
	private static final long P4 = 9304;
	private static final long P5 = 9305;
	private static final long P6 = 9306;
	private static final long OUTSIDE = 9399;
	private static final Taste TASTE = new Taste(Mood.QUIET, null, null, null, null, null);

	@DynamicPropertySource
	static void placeCatalog(DynamicPropertyRegistry registry) {
		registry.add("place.mock.enabled", () -> "false");
	}

	@TestConfiguration
	static class Configuration {
		@Bean
		@Primary
		Clock meetupPollTestClock() {
			return Clock.fixed(NOON, ZoneOffset.UTC);
		}

		@Bean
		@Primary
		MeetupRecommender meetupPollTestRecommender() {
			return input -> new MeetupRecommendation(LongStream.rangeClosed(P1, P6)
					.mapToObj(placeId -> new MeetupRecommendation.Place(placeId, 80, List.of(), null,
							input.members().stream().map(member -> new MeetupRecommendation.MemberScore(
									member.profileId(), 70, false, null)).toList()))
					.toList(), MeetupRecommendation.Applied.NONE, null);
		}

		@Bean
		@Primary
		MeetupCalculationExecutor meetupPollTestExecutor() {
			return new MeetupCalculationExecutor() {
				@Override
				void execute(Runnable task) {
					task.run();
				}
			};
		}
	}

	@Autowired
	MeetupService meetupService;

	@Autowired
	MeetupProfileService profileService;

	@Autowired
	MeetupCalculationService calculationService;

	@Autowired
	MeetupPollService pollService;

	@Autowired
	AuthUserRepository users;

	private JdbcTemplate jdbc;

	@BeforeEach
	void setUp() {
		jdbc = new JdbcTemplate(appSource());
		cleanUp();
		jdbc.update("""
				insert into places (place_id, naver_place_id, name, category_group, station, dong, lat, lng)
				overriding system value values (9300, 'meetup-poll-test-9300', '투표 테스트', 'RESTAURANT',
				'SEOLLEUNG', '역삼동', 37.5, 127.05)""");
		users.saveAll(List.of(
				new AuthUser(HOST, HOST + "@example.com", "모임장민재", "hash", NOON, "2026-10-23"),
				new AuthUser(MEMBER, MEMBER + "@example.com", "회원도윤", "hash", NOON, "2026-10-23")));
	}

	@AfterEach
	void tearDown() {
		cleanUp();
	}

	private void cleanUp() {
		jdbc.update("delete from meetups where host_user_id like ?", PREFIX + "%");
		jdbc.update("delete from auth_users where id like ?", PREFIX + "%");
		jdbc.update("delete from places where place_id = ?", AREA_PLACE);
	}

	/** 모임장, 회원 도윤, 비회원 하린·서진이 취향을 남기고 결과까지 받은 모임 */
	private final class Fixture {
		final String code;
		final long host;
		final long member;
		final long guest;
		final long other;
		final String guestToken;
		final String otherToken;

		Fixture() {
			code = meetupService.create(HOST, new MeetupCreateRequest(
					new MeetupCreateRequest.Area(AreaKind.STATION, "선릉"), MeetupCategory.RESTAURANT, null, null,
					null, null)).code();
			host = profileService.create(code, HOST, new ProfileCreateRequest("민재", TASTE)).profileId();
			member = profileService.create(code, MEMBER, new ProfileCreateRequest("도윤", TASTE)).profileId();
			MeetupProfileService.Joined harin = profileService.create(code, null, new ProfileCreateRequest("하린", TASTE));
			guest = harin.profileId();
			guestToken = harin.token();
			MeetupProfileService.Joined seojin = profileService.create(code, null,
					new ProfileCreateRequest("서진", TASTE));
			other = seojin.profileId();
			otherToken = seojin.token();
			calculationService.start(code, HOST);
			assertThat(phase()).isEqualTo(MeetupPhase.RESULT);
		}

		MeetupPhase phase() {
			return meetupService.snapshot(code, HOST, null).phase();
		}

		MeetupSnapshot asHost() {
			return meetupService.snapshot(code, HOST, null);
		}

		MeetupSnapshot asGuest() {
			return meetupService.snapshot(code, null, guestToken);
		}

		void open(boolean anonymous, Long... placeIds) {
			pollService.open(code, HOST, new PollOpenRequest(List.of(placeIds), anonymous));
		}

		void voteAsHost(long placeId) {
			pollService.vote(code, HOST, null, placeId);
		}

		void voteAsMember(long placeId) {
			pollService.vote(code, MEMBER, null, placeId);
		}

		void voteAsGuest(long placeId) {
			pollService.vote(code, null, guestToken, placeId);
		}

		void voteAsOther(long placeId) {
			pollService.vote(code, null, otherToken, placeId);
		}

		/** 다른 브라우저에서 하린을 고른 쿠키 */
		String guestElsewhere() {
			return profileService.select(code, guest, null).token();
		}
	}

	private static void expectConflict(Runnable action, Conflict conflict) {
		assertThatThrownBy(action::run).isInstanceOfSatisfying(MeetupConflictException.class,
				e -> assertThat(e.conflict()).isEqualTo(conflict));
	}

	private static void expectPhase(Runnable action, MeetupPhase phase) {
		assertThatThrownBy(action::run).isInstanceOfSatisfying(MeetupConflictException.class, e -> {
			assertThat(e.conflict()).isEqualTo(Conflict.PHASE);
			assertThat(e.phase()).isEqualTo(phase);
		});
	}

	private static Consumer<MeetupSnapshot.Candidate> votes(long placeId, int votes) {
		return candidate -> {
			assertThat(candidate.placeId()).isEqualTo(placeId);
			assertThat(candidate.votes()).isEqualTo(votes);
		};
	}

	@Test
	@DisplayName("투표열기_후보5곳까지_고른순서로열리고다시추천받을수없다")
	void open_fiveCandidates_opensInOrder() {
		Fixture f = new Fixture();

		f.open(true, P5, P1, P3, P2, P4);

		MeetupSnapshot snapshot = f.asHost();
		assertThat(snapshot.phase()).isEqualTo(MeetupPhase.VOTING);
		assertThat(snapshot.poll().state()).isEqualTo(PollState.OPEN);
		assertThat(snapshot.poll().anonymous()).isTrue();
		assertThat(snapshot.poll().tie()).isFalse();
		assertThat(snapshot.poll().candidates()).extracting(MeetupSnapshot.Candidate::placeId)
				.containsExactly(P5, P1, P3, P2, P4);
		assertThat(snapshot.poll().votedCount()).isZero();
		assertThat(snapshot.poll().notVotedCount()).isEqualTo(4);
		assertThat(snapshot.allowed()).contains(MeetupAction.CLOSE_POLL, MeetupAction.VOTE, MeetupAction.EDIT_DATE)
				.doesNotContain(MeetupAction.OPEN_POLL, MeetupAction.DECIDE, MeetupAction.CALCULATE);
		assertThat(f.asGuest().allowed()).contains(MeetupAction.VOTE);
		expectPhase(() -> calculationService.start(f.code, HOST), MeetupPhase.VOTING);
		expectPhase(() -> f.open(true, P1, P2), MeetupPhase.VOTING);
	}

	@Test
	@DisplayName("투표열기_익명여부를빼면_익명이다")
	void open_anonymousOmitted_isAnonymous() {
		Fixture f = new Fixture();

		pollService.open(f.code, HOST, new PollOpenRequest(List.of(P1, P2), null));

		assertThat(f.asHost().poll().anonymous()).isTrue();
	}

	@Test
	@DisplayName("투표열기_겹치거나결과에없는후보면_400이고상태는그대로다")
	void open_invalidCandidates_rejected() {
		Fixture f = new Fixture();

		assertThatThrownBy(() -> f.open(true, P1, P1)).isInstanceOf(InvalidMeetupException.class);
		assertThatThrownBy(() -> f.open(true, P1, OUTSIDE)).isInstanceOf(InvalidMeetupException.class);
		assertThat(f.phase()).isEqualTo(MeetupPhase.RESULT);
	}

	@Test
	@DisplayName("투표열기_모임장이아니면403_결과전이면409phase다")
	void open_notHostOrWaiting_rejected() {
		Fixture f = new Fixture();
		assertThatThrownBy(() -> pollService.open(f.code, MEMBER, new PollOpenRequest(List.of(P1, P2), true)))
				.isInstanceOf(MeetupForbiddenException.class);

		String waiting = meetupService.create(HOST, new MeetupCreateRequest(
				new MeetupCreateRequest.Area(AreaKind.STATION, "선릉"), MeetupCategory.RESTAURANT, null, null, null,
				null)).code();
		expectPhase(() -> pollService.open(waiting, HOST, new PollOpenRequest(List.of(P1, P2), true)),
				MeetupPhase.WAITING);
	}

	@Test
	@DisplayName("투표열기와정하기_계산중이면409calculating이고멈춘계산은실패로바꾼뒤연다")
	void open_running_conflictUnlessStale() {
		Fixture f = new Fixture();
		long meetupId = jdbc.queryForObject("select meetup_id from meetups where code = ?", Long.class, f.code);
		jdbc.update("""
				insert into meetup_calculations (meetup_id, state, started_at, taste_count, profile_ids)
				values (?, 'RUNNING', ?, 0, '{}')""", meetupId, java.sql.Timestamp.from(NOON.minusSeconds(10)));

		expectConflict(() -> f.open(true, P1, P2), Conflict.CALCULATING);
		expectConflict(() -> pollService.decide(f.code, HOST, P1), Conflict.CALCULATING);

		jdbc.update("update meetup_calculations set started_at = ? where state = 'RUNNING' and meetup_id = ?",
				java.sql.Timestamp.from(NOON.minusSeconds(60)), meetupId);
		f.open(true, P1, P2);
		assertThat(f.phase()).isEqualTo(MeetupPhase.VOTING);
	}

	@Test
	@DisplayName("투표_다시보내면표가바뀌고_한프로필은한표다")
	void vote_again_replacesVote() {
		Fixture f = new Fixture();
		f.open(false, P1, P2, P3);

		f.voteAsGuest(P1);
		f.voteAsGuest(P2);
		f.voteAsMember(P2);

		MeetupSnapshot.Poll poll = f.asHost().poll();
		assertThat(poll.candidates()).satisfiesExactly(votes(P1, 0), votes(P2, 2), votes(P3, 0));
		assertThat(poll.votedCount()).isEqualTo(2);
		assertThat(poll.notVotedCount()).isEqualTo(2);
	}

	@Test
	@DisplayName("투표_프로필이없으면403_후보가아니면400_열기전이면409phase다")
	void vote_invalid_rejected() {
		Fixture f = new Fixture();
		expectPhase(() -> f.voteAsGuest(P1), MeetupPhase.RESULT);
		f.open(true, P1, P2);

		assertThatThrownBy(() -> pollService.vote(f.code, null, null, P1))
				.isInstanceOf(MeetupForbiddenException.class);
		assertThatThrownBy(() -> f.voteAsGuest(P3)).isInstanceOf(InvalidMeetupException.class);
	}

	@Test
	@DisplayName("익명투표_표수와투표한수만있고_내표는던진브라우저와그회원에게만보인다")
	void anonymousPoll_hidesVoters() {
		Fixture f = new Fixture();
		f.open(true, P1, P2);
		f.voteAsGuest(P1);
		f.voteAsHost(P2);

		MeetupSnapshot.Poll guest = f.asGuest().poll();
		assertThat(guest.candidates()).allSatisfy(candidate -> assertThat(candidate.voters()).isNull());
		assertThat(guest.notVoted()).isNull();
		assertThat(guest.votedCount()).isEqualTo(2);
		assertThat(guest.notVotedCount()).isEqualTo(2);
		assertThat(guest.hasVoted()).isTrue();
		assertThat(guest.myVote()).isEqualTo(P1);

		MeetupSnapshot.Poll elsewhere = meetupService.snapshot(f.code, null, f.guestElsewhere()).poll();
		assertThat(elsewhere.hasVoted()).isTrue();
		assertThat(elsewhere.myVote()).isNull();

		assertThat(f.asHost().poll().myVote()).isEqualTo(P2);
		MeetupSnapshot.Poll member = meetupService.snapshot(f.code, MEMBER, null).poll();
		assertThat(member.hasVoted()).isFalse();
		assertThat(member.myVote()).isNull();
		MeetupSnapshot.Poll viewer = meetupService.snapshot(f.code, null, null).poll();
		assertThat(viewer.hasVoted()).isNull();
		assertThat(viewer.myVote()).isNull();
	}

	@Test
	@DisplayName("다른브라우저에서다시고르면_익명투표에서도그브라우저에내표가보인다")
	void anonymousPoll_voteAgainElsewhere_showsThere() {
		Fixture f = new Fixture();
		f.open(true, P1, P2);
		f.voteAsGuest(P1);
		String elsewhere = f.guestElsewhere();

		pollService.vote(f.code, null, elsewhere, P2);

		assertThat(meetupService.snapshot(f.code, null, elsewhere).poll().myVote()).isEqualTo(P2);
		assertThat(f.asGuest().poll().myVote()).isNull();
		assertThat(f.asGuest().poll().hasVoted()).isTrue();
	}

	@Test
	@DisplayName("이름이보이는투표_후보별로고른사람과투표하지않은사람이있다")
	void namedPoll_showsVoters() {
		Fixture f = new Fixture();
		f.open(false, P1, P2);
		f.voteAsGuest(P1);
		f.voteAsMember(P1);

		MeetupSnapshot.Poll poll = meetupService.snapshot(f.code, null, f.guestElsewhere()).poll();
		assertThat(poll.candidates().getFirst().voters()).containsExactly(f.member, f.guest);
		assertThat(poll.candidates().get(1).voters()).isEmpty();
		assertThat(poll.notVoted()).containsExactly(f.host, f.other);
		assertThat(poll.myVote()).isEqualTo(P1);
	}

	@Test
	@DisplayName("마감_표가없으면_409no-votes다")
	void close_noVotes_conflict() {
		Fixture f = new Fixture();
		f.open(true, P1, P2);

		expectConflict(() -> pollService.close(f.code, HOST), Conflict.NO_VOTES);
		assertThat(f.asHost().poll().state()).isEqualTo(PollState.OPEN);
	}

	@Test
	@DisplayName("마감_가장많은곳이하나면_그곳으로정하고닫힌투표에는투표할수없다")
	void close_singleLeader_decides() {
		Fixture f = new Fixture();
		f.open(true, P1, P2, P3);
		f.voteAsGuest(P2);
		f.voteAsMember(P2);
		f.voteAsOther(P1);

		pollService.close(f.code, HOST);

		MeetupSnapshot snapshot = f.asHost();
		assertThat(snapshot.phase()).isEqualTo(MeetupPhase.DECIDED);
		assertThat(snapshot.poll().state()).isEqualTo(PollState.CLOSED);
		assertThat(snapshot.poll().tie()).isFalse();
		assertThat(snapshot.decision()).isEqualTo(new MeetupSnapshot.Decision(P2, DecisionMethod.VOTE, null));
		assertThat(snapshot.allowed()).contains(MeetupAction.CHANGE_DECISION, MeetupAction.CANCEL_DECISION)
				.doesNotContain(MeetupAction.VOTE);
		expectConflict(() -> f.voteAsGuest(P1), Conflict.POLL_CLOSED);
		expectPhase(() -> pollService.close(f.code, HOST), MeetupPhase.DECIDED);
	}

	@Test
	@DisplayName("마감_동점이면_닫힌채머물고동점은고정되며투표계속하기는표를남긴다")
	void close_tie_staysVoting() {
		Fixture f = new Fixture();
		f.open(false, P1, P2);
		f.voteAsGuest(P1);
		f.voteAsOther(P2);

		pollService.close(f.code, HOST);

		MeetupSnapshot tied = f.asHost();
		assertThat(tied.phase()).isEqualTo(MeetupPhase.VOTING);
		assertThat(tied.poll().state()).isEqualTo(PollState.CLOSED);
		assertThat(tied.poll().tie()).isTrue();
		assertThat(tied.poll().tieVotes()).isEqualTo(1);
		assertThat(tied.poll().reopenable()).isTrue();
		assertThat(tied.allowed()).contains(MeetupAction.DECIDE, MeetupAction.REOPEN_POLL)
				.doesNotContain(MeetupAction.CLOSE_POLL);
		expectConflict(() -> f.voteAsGuest(P2), Conflict.POLL_CLOSED);

		profileService.remove(f.code, HOST, f.other);
		MeetupSnapshot afterRemoval = f.asHost();
		assertThat(afterRemoval.poll().tie()).isTrue();
		assertThat(afterRemoval.poll().tieVotes()).isEqualTo(1);
		assertThat(afterRemoval.poll().reopenable()).isTrue();
		assertThat(afterRemoval.poll().candidates()).satisfiesExactly(votes(P1, 1), votes(P2, 0));

		pollService.reopen(f.code, HOST);
		MeetupSnapshot reopened = f.asHost();
		assertThat(reopened.poll().state()).isEqualTo(PollState.OPEN);
		assertThat(reopened.poll().tie()).isFalse();
		assertThat(reopened.poll().tieVotes()).isNull();
		assertThat(reopened.poll().candidates()).satisfiesExactly(votes(P1, 1), votes(P2, 0));
		expectPhase(() -> pollService.reopen(f.code, HOST), MeetupPhase.VOTING);
	}

	@Test
	@DisplayName("동점에서고르면PICK과동점표수_바꾸면DIRECT_취소하면닫힌투표로돌아간다")
	void decide_fromTie_thenChangeAndCancel() {
		Fixture f = new Fixture();
		f.open(true, P1, P2);
		f.voteAsGuest(P1);
		f.voteAsOther(P2);
		pollService.close(f.code, HOST);

		assertThatThrownBy(() -> pollService.decide(f.code, HOST, P3)).isInstanceOf(InvalidMeetupException.class);
		pollService.decide(f.code, HOST, P2);
		assertThat(f.asGuest().decision()).isEqualTo(new MeetupSnapshot.Decision(P2, DecisionMethod.PICK, 1));

		assertThatThrownBy(() -> pollService.decide(f.code, HOST, P2)).isInstanceOf(InvalidMeetupException.class);
		pollService.decide(f.code, HOST, P6);
		assertThat(f.asGuest().decision()).isEqualTo(new MeetupSnapshot.Decision(P6, DecisionMethod.DIRECT, null));

		pollService.cancelDecision(f.code, HOST);
		MeetupSnapshot cancelled = f.asHost();
		assertThat(cancelled.phase()).isEqualTo(MeetupPhase.VOTING);
		assertThat(cancelled.decision()).isNull();
		assertThat(cancelled.poll().state()).isEqualTo(PollState.CLOSED);
		assertThat(cancelled.poll().reopenable()).isTrue();
		expectPhase(() -> pollService.cancelDecision(f.code, HOST), MeetupPhase.VOTING);
	}

	@Test
	@DisplayName("투표로정한뒤취소하고후보에서고르면_DIRECT다")
	void decide_afterCancellingVote_isDirect() {
		Fixture f = new Fixture();
		f.open(true, P1, P2);
		f.voteAsGuest(P1);
		pollService.close(f.code, HOST);
		pollService.cancelDecision(f.code, HOST);

		assertThat(f.asHost().poll().reopenable()).isFalse();
		pollService.decide(f.code, HOST, P2);

		assertThat(f.asHost().decision()).isEqualTo(new MeetupSnapshot.Decision(P2, DecisionMethod.DIRECT, null));
	}

	@Test
	@DisplayName("결과에서바로정하고취소하면_결과로돌아간다")
	void decide_fromResult_thenCancel() {
		Fixture f = new Fixture();
		assertThatThrownBy(() -> pollService.decide(f.code, HOST, OUTSIDE)).isInstanceOf(InvalidMeetupException.class);

		pollService.decide(f.code, HOST, P4);
		MeetupSnapshot decided = f.asGuest();
		assertThat(decided.phase()).isEqualTo(MeetupPhase.DECIDED);
		assertThat(decided.poll()).isNull();
		assertThat(decided.decision()).isEqualTo(new MeetupSnapshot.Decision(P4, DecisionMethod.DIRECT, null));

		pollService.cancelDecision(f.code, HOST);
		assertThat(f.phase()).isEqualTo(MeetupPhase.RESULT);
		assertThat(f.asHost().allowed()).contains(MeetupAction.OPEN_POLL, MeetupAction.DECIDE);
	}

	@Test
	@DisplayName("열린투표에서정하기는409phase_모임장이아니면403이다")
	void decide_openPollOrNotHost_rejected() {
		Fixture f = new Fixture();
		f.open(true, P1, P2);

		expectPhase(() -> pollService.decide(f.code, HOST, P1), MeetupPhase.VOTING);
		assertThatThrownBy(() -> pollService.decide(f.code, MEMBER, P1)).isInstanceOf(MeetupForbiddenException.class);
		assertThatThrownBy(() -> pollService.close(f.code, MEMBER)).isInstanceOf(MeetupForbiddenException.class);
	}

	@Test
	@DisplayName("투표중에프로필을지우면_그표도지워진다")
	void removeProfile_duringPoll_dropsVote() {
		Fixture f = new Fixture();
		f.open(false, P1, P2);
		f.voteAsGuest(P1);
		f.voteAsOther(P1);

		profileService.remove(f.code, HOST, f.guest);

		MeetupSnapshot.Poll poll = f.asHost().poll();
		assertThat(poll.candidates().getFirst().votes()).isEqualTo(1);
		assertThat(poll.candidates().getFirst().voters()).containsExactly(f.other);
		assertThat(poll.votedCount()).isEqualTo(1);
		assertThat(poll.notVotedCount()).isEqualTo(2);
	}

}
