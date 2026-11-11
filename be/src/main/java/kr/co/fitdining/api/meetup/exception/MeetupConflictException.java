package kr.co.fitdining.api.meetup.exception;

import java.net.URI;

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
		HOST_PROFILE("host-profile", "모임장 프로필은 지울 수 없어요.");

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

	public MeetupConflictException(Conflict conflict) {
		super(conflict.name(), null, false, false);
		this.conflict = conflict;
	}

	public Conflict conflict() {
		return conflict;
	}

}
