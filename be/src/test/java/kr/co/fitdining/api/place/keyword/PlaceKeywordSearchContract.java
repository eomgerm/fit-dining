package kr.co.fitdining.api.place.keyword;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import kr.co.fitdining.api.place.catalog.PlaceSearchDocument;
import kr.co.fitdining.api.place.dto.PlaceSummary;
import kr.co.fitdining.api.place.dto.PlaceSummary.CategoryGroup;
import kr.co.fitdining.api.place.dto.PlaceSummary.Station;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * {@link PlaceKeywordSearch}가 지켜야 할 규칙(place-lookup-db spec의 키워드 매칭 규칙). 구현마다 이 클래스를 상속해
 * {@link #create}만 채우면 같은 검사를 받는다. 나중에 OpenSearch 구현도 같은 검사를 통과해야 한다(D-5).
 */
public abstract class PlaceKeywordSearchContract {

	/** 문서 목록으로 검색을 만든다. 문서는 {@code place_id} 순서가 아닐 수 있다. */
	protected abstract PlaceKeywordSearch create(List<PlaceSearchDocument> documents);

	protected static PlaceSearchDocument doc(long id, String name, Station station, CategoryGroup group,
			String naverCategory, String... menus) {
		return new PlaceSearchDocument(new PlaceSummary(id, name, group, station, 37.5, 127.0, null),
				List.of(menus), naverCategory);
	}

	protected static final List<PlaceSearchDocument> CATALOG = List.of(
			doc(1, "하노이 쌀국수 역삼점", Station.YEOKSAM, CategoryGroup.RESTAURANT, "베트남음식", "분짜"),
			doc(2, "포레스트 키친", Station.YEOKSAM, CategoryGroup.RESTAURANT, "퓨전음식", "양지 쌀국수", "분짜"),
			doc(3, "사이공 테이블", Station.GANGNAM, CategoryGroup.RESTAURANT, "베트남음식", "쌀국수"),
			doc(4, "역삼 국밥", Station.GANGNAM, CategoryGroup.RESTAURANT, "국밥", "순대국밥"),
			doc(5, "카페 온담", Station.SEOLLEUNG, CategoryGroup.CAFE, "카페", "아메리카노", "닭가슴살 샐러드"),
			doc(6, "Cafe ONDAM", Station.GANGNAM, CategoryGroup.CAFE, null),
			doc(7, "달콤 닭갈비", Station.YEOKSAM, CategoryGroup.RESTAURANT, "닭요리", "닭갈비", "닭발"),
			doc(8, "과일 가게", Station.YEOKSAM, CategoryGroup.CAFE, "카페"),
			doc(9, "100% 주스", Station.SEOLLEUNG, CategoryGroup.CAFE, null),
			doc(10, "a_b 가게", Station.SEOLLEUNG, CategoryGroup.CAFE, null),
			doc(11, "별빛 라운지", Station.GANGNAM, CategoryGroup.BAR, "라운지바"),
			doc(12, "아라 놀이터", Station.SEOLLEUNG, CategoryGroup.CAFE, null));

	/** 한 번에 넉넉히(20개) 받아 순서 전체를 비교한다. 개수 제한은 limit 테스트가 따로 본다. */
	private List<PlaceKeywordHit> search(String query) {
		return create(CATALOG).search(query, 0, 20);
	}

	private static List<Long> ids(List<PlaceKeywordHit> hits) {
		return hits.stream().map(hit -> hit.place().id()).toList();
	}

	@Test
	@DisplayName("키워드검색_단어를섞어입력하면_모든단어가이름메뉴업종위치중하나에있는장소만나온다")
	void search_words_requireEveryWord() {
		List<PlaceKeywordHit> hits = search("역삼 쌀국수");

		// 1번은 두 단어가 모두 이름에, 2번은 역삼이 위치이고 쌀국수가 메뉴다. 3번은 역삼이 어디에도 없다.
		assertThat(ids(hits)).containsExactly(1L, 2L);
		assertThat(hits.get(0).matchedMenu()).isNull();
		assertThat(hits.get(1).matchedMenu()).isEqualTo("양지 쌀국수");
	}

	@Test
	@DisplayName("키워드검색_위치는역이름과역을붙인형태로만맞는다")
	void search_location_matchesStationNameAndWithYeok() {
		assertThat(ids(search("역삼역 쌀국수"))).containsExactly(1L, 2L);
		assertThat(ids(search("강남 쌀국수"))).containsExactly(3L);
	}

	@Test
	@DisplayName("키워드검색_업종은그룹한글명과코드와네이버업종이름으로맞는다")
	void search_category_matchesGroupNameCodeAndNaverCategory() {
		assertThat(ids(search("식당"))).containsExactly(1L, 2L, 3L, 4L, 7L);
		assertThat(ids(search("베트남음식"))).containsExactly(1L, 3L);
		assertThat(ids(search("bar"))).containsExactly(11L);
		// 이름이 입력으로 시작하는 6번이 먼저, 나머지는 업종으로 맞아 id 순이다.
		assertThat(ids(search("cafe"))).containsExactly(6L, 5L, 8L, 9L, 10L, 12L);
	}

	@Test
	@DisplayName("키워드검색_마지막글자가덜쓴글자여도_이어질수있는글자에맞는다")
	void search_lastCharacterStillComposing_matchesCompletedCharacter() {
		assertThat(ids(search("쌀구"))).containsExactly(1L, 2L, 3L);
		assertThat(ids(search("쌀ㄱ"))).containsExactly(1L, 2L, 3L);
		// 달 → 닭(겹받침): 7번은 이름이 달로 시작해 앞, 5번은 메뉴의 닭으로 맞는다.
		assertThat(ids(search("달"))).containsExactly(7L, 5L);
		// 고 → 과(복합 모음): 8번은 이름이 과로 시작해 앞, 3번은 이름의 공(고에 받침 ㅇ)으로 맞는다.
		assertThat(ids(search("고"))).containsExactly(8L, 3L);
		// 알 → 아라(받침이 다음 글자 초성으로)
		assertThat(ids(search("알"))).containsExactly(12L);
	}

	@Test
	@DisplayName("키워드검색_마지막이아닌글자는_글자그대로맞는다")
	void search_earlierCharacters_areExact() {
		assertThat(search("살국")).isEmpty();
		// 입력의 마지막 단어만 덜 쓴 글자로 본다. 앞 단어 쌀구는 글자 그대로 맞아야 해서 쌀국수에 맞지 않는다.
		assertThat(search("쌀구 역삼")).isEmpty();
		assertThat(ids(search("역삼 쌀구"))).containsExactly(1L, 2L);
	}

	@Test
	@DisplayName("키워드검색_순위는이름시작_이름전체_이름일부_메뉴업종_위치순이고동순위는id순이다")
	void search_ranking_followsRanksThenId() {
		PlaceKeywordSearch search = create(List.of(
				doc(5, "하루 주점", Station.YEOKSAM, CategoryGroup.BAR, null),
				doc(10, "하루 식당", Station.YEOKSAM, CategoryGroup.RESTAURANT, null, "라멘"),
				doc(20, "역삼 식당", Station.GANGNAM, CategoryGroup.RESTAURANT, null, "라멘"),
				doc(30, "라멘 역삼점", Station.GANGNAM, CategoryGroup.RESTAURANT, null),
				doc(40, "역삼 라멘 하우스", Station.GANGNAM, CategoryGroup.RESTAURANT, null)));

		// 순위 0 → 1 → 2 → 3이 id의 역순으로 나와 순위가 id보다 먼저임을 보인다.
		assertThat(ids(search.search("역삼 라멘", 0, 5))).containsExactly(40L, 30L, 20L, 10L);
		// 순위 0(20, 40), 1(30), 4(5, 10: 위치로만)
		assertThat(ids(search.search("역삼", 0, 5))).containsExactly(20L, 40L, 30L, 5L, 10L);
	}

	@Test
	@DisplayName("키워드검색_메뉴로맞은장소가_위치로만맞은장소보다id가커도앞선다")
	void search_menuMatch_beforeLocationOnlyMatch() {
		PlaceKeywordSearch search = create(List.of(
				doc(1, "하루 주점", Station.YEOKSAM, CategoryGroup.BAR, null),
				doc(2, "저녁 식당", Station.GANGNAM, CategoryGroup.RESTAURANT, null, "역삼 라멘")));

		// 1번은 위치로만(순위 4), 2번은 메뉴 이름으로(순위 3) 맞는다.
		assertThat(ids(search.search("역삼", 0, 5))).containsExactly(2L, 1L);
	}

	@Test
	@DisplayName("키워드검색_순위0인히트만namePrefix가참이다")
	void search_namePrefix_trueOnlyForRankZero() {
		List<PlaceKeywordHit> hits = search("cafe");

		assertThat(hits.get(0).namePrefix()).isTrue();
		assertThat(hits.subList(1, hits.size())).allSatisfy(hit -> assertThat(hit.namePrefix()).isFalse());
	}

	@Test
	@DisplayName("키워드검색_limit과offset은같은순서를잘라낸다")
	void search_limitAndOffset_slicesTheSameOrder() {
		PlaceKeywordSearch search = create(CATALOG);

		assertThat(ids(search.search("식당", 0, 2))).containsExactly(1L, 2L);
		assertThat(ids(search.search("식당", 1, 2))).containsExactly(2L, 3L);
		assertThat(ids(search.search("식당", 4, 5))).containsExactly(7L);
		assertThat(search.search("식당", 5, 5)).isEmpty();
	}

	@Test
	@DisplayName("키워드검색_대소문자와연속공백은무시한다")
	void search_caseAndWhitespace_areIgnored() {
		assertThat(ids(search("  ONDAM  "))).containsExactly(6L);
		assertThat(ids(search("cafe   ondam"))).containsExactly(6L);
		assertThat(ids(search("CAFE"))).isEqualTo(ids(search("cafe")));
	}

	@Test
	@DisplayName("키워드검색_와일드카드문자는글자그대로맞는다")
	void search_wildcardCharacters_areLiteral() {
		assertThat(ids(search("%"))).containsExactly(9L);
		assertThat(ids(search("100%"))).containsExactly(9L);
		assertThat(ids(search("_"))).containsExactly(10L);
		assertThat(search("\\")).isEmpty();
	}

	@Test
	@DisplayName("키워드검색_맞는장소가없거나입력이비면_빈목록이다")
	void search_noMatchOrBlank_empty() {
		assertThat(search("존재하지않는검색어")).isEmpty();
		assertThat(search("   ")).isEmpty();
	}

	@Test
	@DisplayName("키워드검색_matchedMenu는이름으로채워지지않은단어를가장많이담은메뉴다")
	void search_matchedMenu_coversMostUncoveredWords() {
		PlaceKeywordSearch search = create(List.of(doc(1, "하루 식당", Station.YEOKSAM, CategoryGroup.RESTAURANT, null,
				"소고기 덮밥", "양지 쌀국수", "소고기 쌀국수")));

		// 두 단어를 모두 담은 세 번째 메뉴가 첫 메뉴보다 우선한다.
		assertThat(search.search("소고기 쌀국수", 0, 5).get(0).matchedMenu()).isEqualTo("소고기 쌀국수");
		// 동점이면 원본 순서가 앞선 메뉴다.
		assertThat(search.search("쌀국수", 0, 5).get(0).matchedMenu()).isEqualTo("양지 쌀국수");
		// 이름으로 맞은 단어만 있으면 메뉴를 보이지 않는다.
		assertThat(search("쌀국수").get(0).matchedMenu()).isNull();
	}

}
