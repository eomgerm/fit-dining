package kr.co.fitdining.api.bookmark;

import java.sql.SQLException;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.auth.repository.AuthUserRepository;
import kr.co.fitdining.api.bookmark.dto.BookmarkItem;
import kr.co.fitdining.api.place.PlaceService;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse;
import kr.co.fitdining.api.place.exception.PlaceNotFoundException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;

/**
 * 사용자별 장소 북마크의 저장, 해제, 저장 여부, 내 목록(bookmark D-2, D-3). 모든 기능은 탈퇴하지 않은 사용자인지 먼저
 * 확인하고, 장소 정보와 존재 확인은 장소 기능에 맡긴다(D-1, D-13).
 */
@Service
public class BookmarkService {

	private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
	/** {@code places}로 가는 FK(V14). */
	static final String PLACE_CONSTRAINT = "fk_bookmarks_place_id";
	private static final String FOREIGN_KEY_VIOLATION = "23503";

	private final BookmarkRepository bookmarks;
	private final AuthUserRepository users;
	private final PlaceService places;
	private final Clock clock;

	public BookmarkService(BookmarkRepository bookmarks, AuthUserRepository users, PlaceService places,
			Optional<Clock> clock) {
		this.bookmarks = bookmarks;
		this.users = users;
		this.places = places;
		this.clock = clock.orElseGet(() -> Clock.system(SEOUL));
	}

	/**
	 * 장소를 저장한다. 이미 저장한 장소면 장소를 확인하지 않고 아무것도 바꾸지 않는다(D-3).
	 *
	 * @throws AuthFailure 탈퇴했거나 없는 사용자일 때(401)
	 * @throws PlaceNotFoundException 저장하지 않은 장소가 없는 장소일 때. 확인한 뒤 장소가 사라져 FK에 걸려도 같다(D-1)
	 * @throws kr.co.fitdining.api.place.exception.PlaceSearchUnavailableException 저장하지 않은 장소를 확인할 엔진이 없을 때
	 */
	public void save(String userId, long placeId) {
		requireActiveUser(userId);
		if (bookmarks.exists(userId, placeId)) {
			return;
		}
		places.getPlace(placeId);
		try {
			bookmarks.insertIfAbsent(userId, placeId, clock.instant().truncatedTo(ChronoUnit.MICROS));
		} catch (DataIntegrityViolationException e) {
			if (violatesPlaceConstraint(e)) {
				throw new PlaceNotFoundException();
			}
			throw e;
		}
	}

	/** JDBC 예외에는 제약 이름 필드가 없어 FK 위반 상태 코드와 서버 메시지의 제약 이름으로 판별한다. */
	static boolean violatesPlaceConstraint(Throwable e) {
		for (Throwable cause = e; cause != null; cause = cause.getCause()) {
			if (cause instanceof SQLException sql && FOREIGN_KEY_VIOLATION.equals(sql.getSQLState())) {
				return sql.getMessage() != null && sql.getMessage().contains(PLACE_CONSTRAINT);
			}
		}
		return false;
	}

	/**
	 * 저장을 해제한다. 저장하지 않은 장소여도 성공이고 장소 엔진을 부르지 않는다(D-3).
	 *
	 * @throws AuthFailure 탈퇴했거나 없는 사용자일 때(401)
	 */
	public void remove(String userId, long placeId) {
		requireActiveUser(userId);
		bookmarks.delete(userId, placeId);
	}

	/**
	 * 북마크 테이블만 본다(D-5).
	 *
	 * @throws AuthFailure 탈퇴했거나 없는 사용자일 때(401)
	 */
	public boolean isBookmarked(String userId, long placeId) {
		requireActiveUser(userId);
		return bookmarks.exists(userId, placeId);
	}

	/**
	 * 저장 시각 최신순, 같은 시각이면 장소 id 내림차순으로 전체를 돌려준다(D-6). 지금 404인 장소는 빼고 행은 남긴다.
	 * 그 밖의 장소 조회 실패는 그대로 던져 일부 목록을 돌려주지 않는다(D-14).
	 *
	 * @throws AuthFailure 탈퇴했거나 없는 사용자일 때(401)
	 * @throws kr.co.fitdining.api.place.exception.PlaceSearchUnavailableException 장소 엔진이 없을 때
	 */
	public List<BookmarkItem> list(String userId) {
		requireActiveUser(userId);
		List<BookmarkItem> items = new ArrayList<>();
		for (BookmarkRepository.Row row : bookmarks.findAll(userId)) {
			PlaceDetailResponse detail;
			try {
				detail = places.getPlace(row.placeId());
			} catch (PlaceNotFoundException e) {
				continue;
			}
			items.add(new BookmarkItem(detail.place(), detail.address(),
					detail.tags() == null ? List.of() : detail.tags(), detail.openStatus(),
					row.savedAt().atZone(SEOUL).toOffsetDateTime()));
		}
		return items;
	}

	/** 토큰 검증은 DB를 보지 않아 탈퇴 뒤에도 남은 토큰이 만료 전까지 유효하다(D-2). */
	private void requireActiveUser(String userId) {
		if (!users.existsByIdAndDeletedAtIsNull(userId)) {
			throw new AuthFailure("로그인이 필요합니다.");
		}
	}

}
