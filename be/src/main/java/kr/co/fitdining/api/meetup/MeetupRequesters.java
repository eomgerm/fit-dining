package kr.co.fitdining.api.meetup;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.List;
import kr.co.fitdining.api.meetup.domain.MeetupRole;
import kr.co.fitdining.api.meetup.store.Meetup;
import kr.co.fitdining.api.meetup.store.MeetupProfile;
import kr.co.fitdining.api.meetup.store.MeetupProfileSessionRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 요청한 사람을 정한다(D-7). 로그인한 회원의 프로필, 모임 쿠키가 가리키는 프로필, 보기만 하는 사람 순서다. 회원 프로필을
 * 가리키는 쿠키는 그 회원으로 로그인한 요청에서만 인정한다(AC-9).
 */
@Component
@RequiredArgsConstructor
public class MeetupRequesters {

	private static final SecureRandom RANDOM = new SecureRandom();

	private final MeetupProfileSessionRepository sessions;

	/**
	 * @param role 역할. 모임을 만든 회원이면 프로필이 없어도 HOST다.
	 * @param profile 요청한 사람의 프로필. 없으면 null이다.
	 * @param sessionId 프로필을 모임 쿠키로 정했으면 그 쿠키 세션. 로그인으로 정했거나 프로필이 없으면 null이다.
	 * @param convertible 로그인한 회원에게 자기 프로필이 없고 쿠키가 비회원 프로필을 가리키는지(D-25)
	 */
	public record Requester(MeetupRole role, MeetupProfile profile, Long sessionId, boolean convertible) {

		public boolean hasProfile() {
			return profile != null;
		}

	}

	private record CookieProfile(MeetupProfile profile, long sessionId) {
	}

	/**
	 * @param meetup 모임
	 * @param profiles 그 모임의 프로필 전부
	 * @param userId 로그인한 회원. 비회원이면 null이다.
	 * @param cookieToken 모임 쿠키 값. 없으면 null이다.
	 */
	public Requester resolve(Meetup meetup, List<MeetupProfile> profiles, String userId, String cookieToken) {
		MeetupProfile own = userId == null ? null
				: profiles.stream().filter(profile -> profile.ownedBy(userId)).findFirst().orElse(null);
		CookieProfile fromCookie = own == null ? fromCookie(profiles, userId, cookieToken) : null;
		MeetupProfile profile = own != null ? own : fromCookie == null ? null : fromCookie.profile();
		MeetupRole role = userId != null && meetup.hostedBy(userId) ? MeetupRole.HOST
				: profile != null ? MeetupRole.PARTICIPANT : MeetupRole.VIEWER;
		boolean convertible = userId != null && fromCookie != null && !fromCookie.profile().member();
		return new Requester(role, profile, fromCookie == null ? null : fromCookie.sessionId(), convertible);
	}

	private CookieProfile fromCookie(List<MeetupProfile> profiles, String userId, String cookieToken) {
		if (cookieToken == null || cookieToken.isBlank()) {
			return null;
		}
		return sessions.findByTokenHash(hash(cookieToken))
				.flatMap(session -> profiles.stream()
						.filter(profile -> profile.getProfileId().equals(session.getProfileId())).findFirst()
						.filter(profile -> !profile.member() || profile.ownedBy(userId))
						.map(profile -> new CookieProfile(profile, session.getSessionId())))
				.orElse(null);
	}

	/** 모임 쿠키 값. 무작위 256비트를 base64url로 쓴 값이다(D-7). */
	public static String newToken() {
		byte[] bytes = new byte[32];
		RANDOM.nextBytes(bytes);
		return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
	}

	/** DB에는 쿠키 값 대신 이 해시만 둔다. */
	public static byte[] hash(String token) {
		try {
			return MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8));
		} catch (NoSuchAlgorithmException e) {
			throw new IllegalStateException(e);
		}
	}

}
