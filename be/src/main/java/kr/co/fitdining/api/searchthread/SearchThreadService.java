package kr.co.fitdining.api.searchthread;

import java.io.ByteArrayOutputStream;
import java.util.List;
import java.util.Optional;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.auth.repository.AuthUserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.JsonGenerator;

/**
 * 회원의 검색 기록을 저장하고 돌려준다(search-thread D-1, D-3, D-4). thread의 주인은 인증된 사용자 id로만 정한다.
 */
@Service
@RequiredArgsConstructor
public class SearchThreadService {

	static final int PAGE_SIZE = 20;

	/** 회원마다 남기는 thread 수. 넘으면 마지막 요청 시각이 오래된 것부터 지운다(D-19) */
	static final int MAX_THREADS = 20;

	private final SearchThreadRepository threads;
	private final AuthUserRepository users;

	/** 토큰 검증은 DB를 보지 않으므로 기록 API는 다른 판단보다 먼저 탈퇴하지 않은 회원인지 확인한다(D-2, D-3). */
	public void requireActiveUser(String userId) {
		if (!users.existsByIdAndDeletedAtIsNull(userId)) {
			throw new AuthFailure("로그인이 필요합니다.");
		}
	}

	/**
	 * 형식을 확인한 turn 하나를 thread에 더한다. 같은 id가 이미 있으면 비교, thread 규칙, 기준 turn 확인, 저장 순서로
	 * 판단하고(spec "turn 추가 규칙"의 3~6), 모두 회원 행과 thread를 잠근 한 트랜잭션에서 일어난다. thread를 새로 만들었으면
	 * 상한을 넘는 오래된 thread를 지운다(D-19).
	 *
	 * @throws AuthFailure 그사이 탈퇴했을 때(D-13)
	 * @throws TurnConflictException 같은 id가 다른 내용으로 이미 있을 때. 아무것도 바꾸지 않는다
	 * @throws InvalidSearchThreadException thread 규칙을 어길 때
	 * @throws BaseTurnMissingException 기준 turn이 같은 thread에 아직 없을 때
	 */
	@Transactional
	public void addTurn(String userId, String threadId, TurnFormat.Turn turn) {
		// 탈퇴와 순서를 정해 탈퇴한 회원의 기록이 남지 않게 하고, 같은 회원의 저장끼리 상한 정리가 엇갈리지 않게 한다
		if (!threads.lockActiveUser(userId)) {
			throw new AuthFailure("로그인이 필요합니다.");
		}
		boolean created = false;
		Optional<Integer> turnCount = threads.lockThread(userId, threadId);
		if (turnCount.isEmpty()) {
			// 없는 thread에는 같은 id의 turn도 없으므로 첫 turn 규칙부터 본다
			if (!turn.kind().equals("new") || turn.baseId() != null) {
				throw new InvalidSearchThreadException("first turn");
			}
			// 다른 요청이 동시에 만들었으면 그 요청이 끝난 뒤 그 thread를 잠근다
			created = threads.createThread(userId, threadId, turn.query(), turn.at());
			turnCount = created ? Optional.of(0) : threads.lockThread(userId, threadId);
			if (turnCount.isEmpty()) {
				throw new IllegalStateException("search thread vanished while locking");
			}
		}
		Optional<Boolean> same = threads.sameTurn(userId, threadId, turn);
		if (same.isPresent()) {
			if (same.get()) {
				return;
			}
			throw new TurnConflictException();
		}
		boolean followsBase = !turn.kind().equals("new");
		if (followsBase != (turn.baseId() != null) || turn.id().equals(turn.baseId())) {
			throw new InvalidSearchThreadException("thread rule");
		}
		if (followsBase && !threads.turnExists(userId, threadId, turn.baseId())) {
			throw new BaseTurnMissingException();
		}
		threads.appendTurn(userId, threadId, turn, turnCount.get() + 1);
		if (created) {
			// 기기 시각이 틀려 방금 만든 thread가 가장 오래돼도 지우지 않는다
			threads.trim(userId, threadId, MAX_THREADS - 1);
		}
	}

	/**
	 * @param cursor 직전 응답의 {@code nextCursor}. 첫 페이지면 null
	 * @throws InvalidSearchThreadException cursor를 해석할 수 없을 때
	 */
	@Transactional(readOnly = true)
	public ThreadPage page(String userId, String cursor) {
		ThreadCursor after = cursor == null ? null : ThreadCursor.decode(cursor);
		List<ThreadPage.Item> rows = threads.page(userId, after, PAGE_SIZE + 1);
		if (rows.size() <= PAGE_SIZE) {
			return new ThreadPage(rows, null);
		}
		List<ThreadPage.Item> items = List.copyOf(rows.subList(0, PAGE_SIZE));
		ThreadPage.Item last = items.getLast();
		return new ThreadPage(items, new ThreadCursor(last.lastAt(), last.id()).encode());
	}

	/** turn까지 지운다. 그 thread에 turn을 더하는 중이면 그 트랜잭션이 끝난 뒤 지운다(D-18). */
	@Transactional
	public void deleteThread(String userId, String threadId) {
		threads.deleteThread(userId, threadId);
	}

	/** 최근 검색의 전체 삭제(D-18)와 탈퇴 처리(D-13)가 쓴다. 탈퇴는 회원 행을 잠근 트랜잭션 안에서 부른다 */
	@Transactional
	public void deleteAll(String userId) {
		threads.deleteAll(userId);
	}

	/**
	 * thread 하나를 {@code {id, turns}} JSON으로 돌려준다. 요청과 응답은 jsonb가 내준 텍스트를 그대로 넣어 숫자가 double을
	 * 거치지 않는다. {@code baseId}가 없는 turn은 키를 뺀다(FE {@code parseThreads}가 null을 거부한다).
	 *
	 * @throws SearchThreadNotFoundException 내 계정에 그 thread가 없을 때
	 */
	@Transactional(readOnly = true)
	public byte[] thread(String userId, String threadId) {
		List<SearchThreadRepository.StoredTurn> turns = threads.turns(userId, threadId);
		if (turns.isEmpty() && !threads.threadExists(userId, threadId)) {
			throw new SearchThreadNotFoundException();
		}
		ByteArrayOutputStream out = new ByteArrayOutputStream();
		try (JsonGenerator json = TurnFormat.MAPPER.createGenerator(out)) {
			json.writeStartObject();
			json.writeStringProperty("id", threadId);
			json.writeName("turns");
			json.writeStartArray();
			for (SearchThreadRepository.StoredTurn turn : turns) {
				json.writeStartObject();
				json.writeStringProperty("id", turn.id());
				json.writeStringProperty("kind", turn.kind());
				if (turn.baseId() != null) {
					json.writeStringProperty("baseId", turn.baseId());
				}
				json.writeNumberProperty("at", turn.at());
				json.writeName("request");
				json.writeRawValue(turn.request());
				json.writeName("response");
				json.writeRawValue(turn.response());
				json.writeEndObject();
			}
			json.writeEndArray();
			json.writeEndObject();
		}
		return out.toByteArray();
	}

}
