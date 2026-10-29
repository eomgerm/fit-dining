package kr.co.fitdining.api.searchthread;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * 검색 기록 저장소(V11). 요청과 응답은 원문 JSON 그대로 {@code jsonb}에 둔다.
 *
 * <p>요청 시각은 {@code timestamptz}이고 API의 {@code at}(정수 밀리초)과 SQL 안에서 정수 연산으로만 오간다. double을
 * 거치면 먼 미래 시각에서 밀리초가 틀어진다. 목록은 turn을 읽지 않고
 * {@code idx_search_threads_user_id_last_requested_at_thread_id} 순서로 정렬하고 행 비교로 범위를 좁힌다.
 */
@Repository
@RequiredArgsConstructor
class SearchThreadRepository {

	/** 밀리초 정수를 {@code timestamptz}로. PostgreSQL 15부터 interval 입력은 int64로 계산한다 */
	private static final String AT = "(TIMESTAMPTZ 'epoch' + CAST(:at || ' milliseconds' AS interval))";

	private static final String LOCK_THREAD = """
			SELECT turn_count FROM search_threads
			WHERE user_id = :userId AND thread_id = :threadId
			FOR UPDATE""";

	private static final String CREATE_THREAD = """
			INSERT INTO search_threads (user_id, thread_id, title, last_requested_at, turn_count)
			VALUES (:userId, :threadId, :title, %s, 0)
			ON CONFLICT DO NOTHING""".formatted(AT);

	/** 같은 id의 turn이 있으면 본문 전체가 같은지. 요청과 응답은 jsonb 값으로 비교해 키 순서와 공백을 무시한다 */
	private static final String SAME_TURN = """
			SELECT kind = :kind AND base_turn_id IS NOT DISTINCT FROM :baseId AND requested_at = %s
			       AND request = CAST(:request AS jsonb) AND response = CAST(:response AS jsonb)
			FROM search_thread_turns
			WHERE user_id = :userId AND thread_id = :threadId AND turn_id = :turnId""".formatted(AT);

	private static final String TURN_EXISTS = """
			SELECT EXISTS (SELECT 1 FROM search_thread_turns
			               WHERE user_id = :userId AND thread_id = :threadId AND turn_id = :turnId)""";

	private static final String INSERT_TURN = """
			INSERT INTO search_thread_turns
			    (user_id, thread_id, turn_id, seq, kind, base_turn_id, requested_at, request, response)
			VALUES (:userId, :threadId, :turnId, :seq, :kind, :baseId, %s,
			        CAST(:request AS jsonb), CAST(:response AS jsonb))""".formatted(AT);

	private static final String TOUCH_THREAD = """
			UPDATE search_threads SET last_requested_at = %s, turn_count = :turnCount
			WHERE user_id = :userId AND thread_id = :threadId""".formatted(AT);

	private static final String LAST_AT = "CAST(EXTRACT(EPOCH FROM last_requested_at) * 1000 AS bigint)";

	private static final String FIRST_PAGE = """
			SELECT thread_id, title, %s AS last_at FROM search_threads
			WHERE user_id = :userId
			ORDER BY last_requested_at DESC, thread_id DESC
			LIMIT :limit""".formatted(LAST_AT);

	private static final String PAGE_AFTER = """
			SELECT thread_id, title, %s AS last_at FROM search_threads
			WHERE user_id = :userId AND (last_requested_at, thread_id) < (%s, :threadId)
			ORDER BY last_requested_at DESC, thread_id DESC
			LIMIT :limit""".formatted(LAST_AT, AT);

	private static final String THREAD_EXISTS = """
			SELECT EXISTS (SELECT 1 FROM search_threads WHERE user_id = :userId AND thread_id = :threadId)""";

	private static final String TURNS = """
			SELECT turn_id, kind, base_turn_id, CAST(EXTRACT(EPOCH FROM requested_at) * 1000 AS bigint) AS at,
			       request::text AS request, response::text AS response
			FROM search_thread_turns
			WHERE user_id = :userId AND thread_id = :threadId
			ORDER BY seq""";

	private final NamedParameterJdbcTemplate jdbc;

	/** thread 행을 잠그고 지금까지의 turn 수를 돌려준다. 없으면 비어 있다 */
	Optional<Integer> lockThread(String userId, String threadId) {
		return jdbc.queryForList(LOCK_THREAD, key(userId, threadId), Integer.class).stream().findFirst();
	}

	/** 없으면 turn 없는 thread를 만든다. 다른 요청이 먼저 만들었으면 그 요청이 끝날 때까지 기다렸다가 false다 */
	boolean createThread(String userId, String threadId, String title, long at) {
		Map<String, Object> params = key(userId, threadId);
		params.put("title", title);
		params.put("at", at);
		return jdbc.update(CREATE_THREAD, params) == 1;
	}

	/** @return 같은 id의 turn이 없으면 비어 있고, 있으면 본문 전체가 같은지 */
	Optional<Boolean> sameTurn(String userId, String threadId, TurnFormat.Turn turn) {
		return jdbc.queryForList(SAME_TURN, turnParams(userId, threadId, turn), Boolean.class).stream().findFirst();
	}

	boolean turnExists(String userId, String threadId, String turnId) {
		Map<String, Object> params = key(userId, threadId);
		params.put("turnId", turnId);
		return Boolean.TRUE.equals(jdbc.queryForObject(TURN_EXISTS, params, Boolean.class));
	}

	/** turn을 {@code seq}번째로 더하고 thread의 마지막 요청 시각을 그 turn의 시각으로 바꾼다 */
	void appendTurn(String userId, String threadId, TurnFormat.Turn turn, int seq) {
		Map<String, Object> params = turnParams(userId, threadId, turn);
		params.put("seq", seq);
		jdbc.update(INSERT_TURN, params);
		params.put("turnCount", seq);
		jdbc.update(TOUCH_THREAD, params);
	}

	/**
	 * @param after 직전 페이지의 마지막 thread. 첫 페이지면 null
	 * @param limit 읽을 최대 건수
	 * @return 마지막 요청 시각 최신순, 같으면 thread id 역순
	 */
	List<ThreadPage.Item> page(String userId, ThreadCursor after, int limit) {
		Map<String, Object> params = new HashMap<>();
		params.put("userId", userId);
		params.put("limit", limit);
		if (after != null) {
			params.put("at", after.lastAt());
			params.put("threadId", after.threadId());
		}
		return jdbc.query(after == null ? FIRST_PAGE : PAGE_AFTER, params, (row, i) -> new ThreadPage.Item(
				row.getString("thread_id"), row.getString("title"), row.getLong("last_at")));
	}

	boolean threadExists(String userId, String threadId) {
		return Boolean.TRUE.equals(jdbc.queryForObject(THREAD_EXISTS, key(userId, threadId), Boolean.class));
	}

	/** 서버에 처음 저장된 순서의 turn. 요청과 응답은 jsonb가 내준 JSON 텍스트 그대로다 */
	List<StoredTurn> turns(String userId, String threadId) {
		return jdbc.query(TURNS, key(userId, threadId), (row, i) -> new StoredTurn(row.getString("turn_id"),
				row.getString("kind"), row.getString("base_turn_id"), row.getLong("at"), row.getString("request"),
				row.getString("response")));
	}

	private static Map<String, Object> key(String userId, String threadId) {
		Map<String, Object> params = new HashMap<>();
		params.put("userId", userId);
		params.put("threadId", threadId);
		return params;
	}

	private static Map<String, Object> turnParams(String userId, String threadId, TurnFormat.Turn turn) {
		Map<String, Object> params = key(userId, threadId);
		params.put("turnId", turn.id());
		params.put("kind", turn.kind());
		params.put("baseId", turn.baseId());
		params.put("at", turn.at());
		params.put("request", turn.request());
		params.put("response", turn.response());
		return params;
	}

	/**
	 * @param id turn id
	 * @param kind new, followUp, region
	 * @param baseId 기준 turn id. new면 null
	 * @param at 기기 시각(밀리초)
	 * @param request 요청 JSON 텍스트
	 * @param response 응답 JSON 텍스트
	 */
	record StoredTurn(String id, String kind, String baseId, long at, String request, String response) {
	}

}
