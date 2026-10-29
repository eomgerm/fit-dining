package kr.co.fitdining.api.place.keyword;

import java.util.List;
import kr.co.fitdining.api.place.catalog.PlaceSearchDocument;

/** 정규화(NFC, 소문자)한 검색 문서. 메뉴 이름은 원본 순서를 지키고, 원본 문서는 응답용으로 들고 있다. */
record IndexedDocument(PlaceSearchDocument source, String name, List<String> menus, List<String> categories,
		List<String> locations) {

	static IndexedDocument of(PlaceSearchDocument document) {
		return new IndexedDocument(document, KeywordMatcher.normalize(document.place().name()),
				document.menuNames().stream().map(KeywordMatcher::normalize).toList(),
				document.categoryNames().stream().map(KeywordMatcher::normalize).toList(),
				document.locationNames().stream().map(KeywordMatcher::normalize).toList());
	}

	long id() {
		return source.place().id();
	}

}
