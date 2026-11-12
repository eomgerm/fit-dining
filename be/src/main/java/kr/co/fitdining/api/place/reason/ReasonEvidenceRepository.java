package kr.co.fitdining.api.place.reason;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/**
 * 상세 추천 이유의 근거를 읽는다. 장소 페르소나는 특징 코드표의 문구 벡터와 가장 비슷한 만족한 손님 것을, 앱 리뷰는 그 특징을
 * 좋았다고 고른 것을 고른다(ai/docs/comparison/spec.md 4.5).
 */
@Repository
@RequiredArgsConstructor
class ReasonEvidenceRepository {

	/**
	 * 짝지을 페르소나의 최소 유사도(특징 문구 벡터와의 코사인 유사도). 장소마다 페르소나가 평균 2.4개라 가장 가까운 것도 다른 특징
	 * 이야기인 경우가 많다. prod 장소 11곳, 이유 22개에서 특징과 무관한 짝은 0.25~0.34, 관계있거나 애매한 짝은 0.40 이상이었고 그
	 * 사이는 비어 있었다(2026-11-11). 임시값이고, 사람이 라벨한 짝으로 다시 정한다.
	 */
	static final double PERSONA_MIN_SIMILARITY = 0.38;

	/** 장소의 만족한 손님 페르소나 중 특징 문구 벡터와 가장 가까운 것. 최소 유사도보다 멀거나 코드표에 없는 코드(시설)면 행이 없다. */
	static final String PERSONA = """
			SELECT pe.name, pe.description, pe.reason
			FROM place_personas pe
			JOIN feature_codes f ON f.code = :code
			WHERE pe.place_id = :placeId AND pe.liked AND 1 - (pe.vector <=> f.vector) >= :minSimilarity
			ORDER BY pe.vector <=> f.vector, pe.persona_id
			LIMIT 1""";

	/**
	 * 그 특징을 좋았다고 고른 리뷰. 이유 태그의 {@code feature_code}는 장소가 실제로 그랬다는 쪽이라 좋았어요 태그만 본다.
	 * 지운 리뷰는 빼고 리뷰 탭처럼 최근 작성 순이다. 탈퇴한 회원의 닉네임은 돌려주지 않는다.
	 */
	static final String REVIEWS = """
			SELECT CASE WHEN u.deleted_at IS NULL THEN u.nickname END AS nickname,
			       r.visit_date AS visited_at, COALESCE(c.label, t.label) AS tag
			FROM reviews r
			JOIN review_reason_tags rt ON rt.review_id = r.review_id
			JOIN reason_tags t ON t.code = rt.code
			LEFT JOIN reason_tag_categories c ON c.category = :category AND c.code = rt.code
			JOIN auth_users u ON u.id = r.user_id
			WHERE r.place_id = :placeId AND r.deleted_at IS NULL
			  AND t.feature_code = :code AND t.sentiment = 'GOOD'
			ORDER BY r.created_at DESC, r.review_id DESC
			LIMIT :limit""";

	private final JdbcClient jdbc;

	Optional<Persona> persona(long placeId, String code) {
		return jdbc.sql(PERSONA).param("placeId", placeId).param("code", code)
				.param("minSimilarity", PERSONA_MIN_SIMILARITY).query(Persona.class).optional();
	}

	List<ReviewRow> reviews(long placeId, String code, String category, int limit) {
		return jdbc.sql(REVIEWS).param("placeId", placeId).param("code", code).param("category", category)
				.param("limit", limit).query(ReviewRow.class).list();
	}

	/**
	 * 짝지은 장소 페르소나.
	 *
	 * @param name 이름
	 * @param description 어떤 손님인지 3문장
	 * @param reason 좋아하는 이유 3문장
	 */
	record Persona(String name, String description, String reason) {
	}

	/**
	 * 근거 리뷰 1건.
	 *
	 * @param nickname 작성자 닉네임. 탈퇴한 회원이면 null이다.
	 * @param visitedAt 방문일
	 * @param tag 장소 업종의 이유 태그 문구
	 */
	record ReviewRow(String nickname, LocalDate visitedAt, String tag) {
	}

}
