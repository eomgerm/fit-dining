package kr.co.fitdining.api.place.keyword;

import java.util.List;

/**
 * 장소 키워드 검색 포트. 지금은 문서 스냅샷과 Java 매처({@link DocumentKeywordSearch})가 구현하고, 나중에 OpenSearch가
 * 구현한다. 매칭 규칙은 docs/specs/place-lookup-db/spec.md의 "키워드 매칭 규칙"이 정본이다.
 */
public interface PlaceKeywordSearch {

	/**
	 * 입력에 맞는 장소를 순위 순으로 돌려준다.
	 *
	 * @param query 입력. 컨트롤러 검증(1~200자, 공백뿐인 값 제외)을 통과한 값이다.
	 * @param offset 건너뛸 히트 수(0 이상). 키워드 결과를 카드로 돌려주는 폴백을 나중에 얹을 때 쓴다.
	 * @param limit 돌려줄 최대 히트 수(1 이상)
	 * @return 순위, {@code place_id} 오름차순으로 정렬된 히트
	 */
	List<PlaceKeywordHit> search(String query, int offset, int limit);

}
