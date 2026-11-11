package kr.co.fitdining.api.meetup;

import java.time.Clock;
import java.util.Optional;
import kr.co.fitdining.api.meetup.domain.MeetupLimits;
import kr.co.fitdining.api.meetup.exception.TooManyMeetupWritesException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

/**
 * 로그인 없는 쓰기의 한도(D-8, AC-13). Redis 고정 구간 카운터이고, 키는 모임 코드와 클라이언트 주소다. 같은 와이파이의
 * 친구들이 한도를 함께 쓰므로 넉넉하게 둔다. Blue/Green의 두 색이 같은 Redis를 보아 함께 센다.
 */
@Component
public class MeetupWriteLimiter {

	private static final String KEY = "meetup:anonymous-writes:";

	private final StringRedisTemplate redis;
	private final Clock clock;

	public MeetupWriteLimiter(StringRedisTemplate redis, Optional<Clock> clock) {
		this.redis = redis;
		this.clock = clock.orElseGet(() -> Clock.system(MeetupLimits.SEOUL));
	}

	/**
	 * 쓰기 한 번을 센다.
	 *
	 * @param code 모임 코드
	 * @param clientAddress 클라이언트 주소. 프록시 뒤에서는 전달된 주소다(forward-headers-strategy).
	 * @throws TooManyMeetupWritesException 구간 안에서 한도를 넘었을 때
	 */
	public void count(String code, String clientAddress) {
		long window = clock.millis() / MeetupLimits.ANONYMOUS_WRITE_WINDOW.toMillis();
		String key = KEY + code + ":" + clientAddress + ":" + window;
		Long writes = redis.opsForValue().increment(key);
		if (writes != null && writes == 1) {
			redis.expire(key, MeetupLimits.ANONYMOUS_WRITE_WINDOW);
		}
		if (writes != null && writes > MeetupLimits.ANONYMOUS_WRITES) {
			throw new TooManyMeetupWritesException();
		}
	}

}
