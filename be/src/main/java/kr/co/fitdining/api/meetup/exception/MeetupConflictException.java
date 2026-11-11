package kr.co.fitdining.api.meetup.exception;

import java.net.URI;
import kr.co.fitdining.api.meetup.domain.MeetupPhase;

/** 같은 409 안에서 FE가 구분해 안내할 부딪힘. {@code type}은 {@code urn:fitdining:meetup:...}이다(D-9). */
public class MeetupConflictException extends RuntimeException {

	/** 부딪힘의 종류 */
	public enum Conflict {
		/** 이미 있는 이름 */
		NAME_TAKEN("name-taken", "이미 있는 이름이에요."),
		/** 프로필이 다 찼다 */
		FULL("full", "모임 인원이 다 찼어요."),
		/** 이미 이 모임에 프로필이 있는 회원 */
		ALREADY_JOINED("already-joined", "이미 이 모임에 참여했어요."),
		/** 모임장 자신의 프로필 지우기 */
		HOST_PROFILE("host-profile", "모임장 프로필은 지울 수 없어요."),
		/** 계산 중에 다시 추천받기 */
		CALCULATING("calculating", "지금 추천을 찾고 있어요."),
		/** 닫힌 투표에 투표 */
		POLL_CLOSED("poll-closed", "투표가 마감됐어요."),
		/** 표 없이 마감 */
		NO_VOTES("no-votes", "아직 아무도 투표하지 않았어요."),
		/** 지금 상태에서 할 수 없는 동작. 확장 필드 {@code phase}에 지금 상태를 싣는다. */
		PHASE("phase", "지금은 할 수 없는 동작이에요.");

		private final URI type;
		private final String detail;

		Conflict(String slug, String detail) {
			this.type = URI.create("urn:fitdining:meetup:" + slug);
			this.detail = detail;
		}

		public URI type() {
			return type;
		}

		public String detail() {
			return detail;
		}
	}

	private final Conflict conflict;
	private final MeetupPhase phase;

	public MeetupConflictException(Conflict conflict) {
		this(conflict, null);
	}

	private MeetupConflictException(Conflict conflict, MeetupPhase phase) {
		super(conflict.name(), null, false, false);
		this.conflict = conflict;
		this.phase = phase;
	}

	/** @param phase 지금 상태 */
	public static MeetupConflictException phase(MeetupPhase phase) {
		return new MeetupConflictException(Conflict.PHASE, phase);
	}

	public Conflict conflict() {
		return conflict;
	}

	/** @return {@link Conflict#PHASE}일 때의 지금 상태. 아니면 null이다. */
	public MeetupPhase phase() {
		return phase;
	}

}
