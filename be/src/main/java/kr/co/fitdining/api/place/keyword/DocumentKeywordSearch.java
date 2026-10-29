package kr.co.fitdining.api.place.keyword;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.locks.ReentrantLock;
import kr.co.fitdining.api.place.catalog.ConditionalOnCatalogMode;
import kr.co.fitdining.api.place.catalog.PlaceCatalog;
import kr.co.fitdining.api.place.exception.PlaceSearchUnavailableException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * 카탈로그에서 읽은 검색 문서를 스냅샷으로 들고 {@link KeywordMatcher}로 거르는 {@link PlaceKeywordSearch} 구현(D-5).
 * 첫 요청이 읽고, 읽은 뒤 60초가 지난 다음 처음 오는 요청이 다시 읽는다(D-11). 갱신은 한 번에 하나만 돌고 기존
 * 스냅샷이 있으면 다른 요청은 기다리지 않는다. 갱신이 실패하면 마지막 스냅샷을 쓰고, 한 번도 못 읽었으면
 * {@link PlaceSearchUnavailableException}이다. 실패한 뒤 5초 동안은 DB를 다시 읽지 않는다. DB가 죽었을 때
 * 기다리는 요청이 차례로 연결 제한 시간을 겪으며 서블릿 스레드를 붙잡지 않게 하려는 것이다.
 * 입력 문자열은 로그에 남기지 않는다.
 */
@Slf4j
@Component
@ConditionalOnCatalogMode
public class DocumentKeywordSearch implements PlaceKeywordSearch {

	static final Duration REFRESH_AFTER = Duration.ofSeconds(60);
	static final Duration RETRY_AFTER_FAILURE = Duration.ofSeconds(5);

	private record Snapshot(List<IndexedDocument> documents, Instant refreshAt) {
	}

	private final PlaceCatalog catalog;
	private final Clock clock;
	private final ReentrantLock loading = new ReentrantLock();
	private volatile Snapshot snapshot;
	/** 최초 읽기가 마지막으로 실패한 시각. 스냅샷이 아직 없을 때만 쓴다. */
	private volatile Instant firstLoadFailedAt;

	public DocumentKeywordSearch(PlaceCatalog catalog, Optional<Clock> clock) {
		this.catalog = catalog;
		this.clock = clock.orElseGet(Clock::systemUTC);
	}

	@Override
	public List<PlaceKeywordHit> search(String query, int offset, int limit) {
		return KeywordMatcher.search(documents(), query, offset, limit);
	}

	private List<IndexedDocument> documents() {
		Snapshot current = snapshot;
		if (current != null && clock.instant().isBefore(current.refreshAt())) {
			return current.documents();
		}
		if (current == null) {
			// 최초 읽기는 모든 요청이 그 결과를 기다린다.
			loading.lock();
			try {
				if (snapshot == null) {
					if (failedRecently()) {
						// 락을 기다리던 요청도 방금 실패한 읽기를 다시 하지 않고 함께 실패한다.
						throw new PlaceSearchUnavailableException();
					}
					snapshot = loadFirst();
				}
				return snapshot.documents();
			} finally {
				loading.unlock();
			}
		}
		if (!loading.tryLock()) {
			// 다른 요청이 갱신 중이면 기다리지 않고 기존 스냅샷을 쓴다.
			return current.documents();
		}
		try {
			Snapshot latest = snapshot;
			if (clock.instant().isBefore(latest.refreshAt())) {
				// 락을 잡는 사이 다른 요청이 이미 갱신했다.
				return latest.documents();
			}
			try {
				snapshot = load();
			} catch (RuntimeException e) {
				log.warn("Failed to refresh place search documents; keeping the last snapshot", e);
				// 같은 문서를 들고 5초 뒤로 만료 시각을 미룬다. 그동안 요청은 DB를 부르지 않는다.
				snapshot = new Snapshot(latest.documents(), clock.instant().plus(RETRY_AFTER_FAILURE));
			}
			return snapshot.documents();
		} finally {
			loading.unlock();
		}
	}

	private boolean failedRecently() {
		Instant failedAt = firstLoadFailedAt;
		return failedAt != null && clock.instant().isBefore(failedAt.plus(RETRY_AFTER_FAILURE));
	}

	private Snapshot loadFirst() {
		try {
			Snapshot loaded = load();
			firstLoadFailedAt = null;
			return loaded;
		} catch (RuntimeException e) {
			log.error("Failed to load place search documents", e);
			firstLoadFailedAt = clock.instant();
			throw new PlaceSearchUnavailableException();
		}
	}

	private Snapshot load() {
		List<IndexedDocument> documents = catalog.loadSearchDocuments().stream().map(IndexedDocument::of).toList();
		return new Snapshot(documents, clock.instant().plus(REFRESH_AFTER));
	}

}
