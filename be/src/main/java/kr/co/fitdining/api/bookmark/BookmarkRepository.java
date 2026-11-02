package kr.co.fitdining.api.bookmark;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

/** {@code bookmarks} 테이블(V10, 장소 FK는 V14). 모든 쿼리는 사용자 id로 제한한다(bookmark D-2). */
@Repository
@RequiredArgsConstructor
class BookmarkRepository {

	/**
	 * 북마크 한 행.
	 *
	 * @param placeId 저장한 장소 id
	 * @param savedAt 저장 시각({@code created_at})
	 */
	record Row(long placeId, Instant savedAt) {
	}

	/** 동시에 넣어도 먼저 커밋된 행만 남고 나머지는 아무것도 바꾸지 않는다(D-3). */
	static final String INSERT = """
			INSERT INTO bookmarks (user_id, place_id, created_at) VALUES (:userId, :placeId, :savedAt)
			ON CONFLICT DO NOTHING""";

	static final String EXISTS = """
			SELECT EXISTS (SELECT 1 FROM bookmarks WHERE user_id = :userId AND place_id = :placeId)""";

	static final String DELETE = "DELETE FROM bookmarks WHERE user_id = :userId AND place_id = :placeId";

	static final String LIST = """
			SELECT place_id, created_at FROM bookmarks WHERE user_id = :userId
			ORDER BY created_at DESC, place_id DESC""";

	private final NamedParameterJdbcTemplate jdbc;

	void insertIfAbsent(String userId, long placeId, Instant savedAt) {
		jdbc.update(INSERT, Map.of("userId", userId, "placeId", placeId, "savedAt", Timestamp.from(savedAt)));
	}

	boolean exists(String userId, long placeId) {
		return Boolean.TRUE.equals(
				jdbc.queryForObject(EXISTS, Map.of("userId", userId, "placeId", placeId), Boolean.class));
	}

	void delete(String userId, long placeId) {
		jdbc.update(DELETE, Map.of("userId", userId, "placeId", placeId));
	}

	List<Row> findAll(String userId) {
		return jdbc.query(LIST, Map.of("userId", userId),
				(row, i) -> new Row(row.getLong("place_id"), row.getTimestamp("created_at").toInstant()));
	}

}
