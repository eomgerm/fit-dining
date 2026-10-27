package kr.co.fitdining.api.review.tag;

import java.util.List;
import java.util.Map;
import kr.co.fitdining.api.place.dto.PlaceSummary.CategoryGroup;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
@RequiredArgsConstructor
public class ReasonTagRepository {

	static final String EXPOSED = """
			SELECT t.code, t.feature_code, t.sentiment, COALESCE(c.label, t.label) AS label, t.display_group
			FROM reason_tag_categories c JOIN reason_tags t ON t.code = c.code
			WHERE c.category = :category
			ORDER BY t.sort_order""";

	private final NamedParameterJdbcTemplate jdbc;

	public List<ReasonTag> findExposed(CategoryGroup category) {
		return jdbc.query(EXPOSED, Map.of("category", category.name()), (row, i) -> new ReasonTag(
				row.getString("code"), row.getString("feature_code"),
				ReasonTag.Sentiment.valueOf(row.getString("sentiment")), row.getString("label"),
				row.getString("display_group")));
	}

}
