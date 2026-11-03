package kr.co.fitdining.api.place.keyword;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;
import kr.co.fitdining.api.place.catalog.PlaceCatalog;
import kr.co.fitdining.api.place.catalog.PlaceSearchDocument;
import kr.co.fitdining.api.place.dto.PlaceCard;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse;

/** 검색 문서만 돌려주는 가짜 카탈로그. 읽은 횟수를 센다. */
final class FakePlaceCatalog implements PlaceCatalog {

	final AtomicInteger loads = new AtomicInteger();
	volatile Supplier<List<PlaceSearchDocument>> source;

	FakePlaceCatalog(List<PlaceSearchDocument> documents) {
		this.source = () -> documents;
	}

	@Override
	public List<PlaceSearchDocument> loadSearchDocuments() {
		loads.incrementAndGet();
		return source.get();
	}

	@Override
	public Optional<PlaceDetailResponse> findPlace(long id) {
		throw new UnsupportedOperationException();
	}

	@Override
	public List<Long> placeIds() {
		throw new UnsupportedOperationException();
	}

	@Override
	public List<PlaceCard> nearbyCandidates() {
		throw new UnsupportedOperationException();
	}

	@Override
	public List<PlaceCard> cards(Collection<Long> ids) {
		throw new UnsupportedOperationException();
	}

}
