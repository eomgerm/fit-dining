package kr.co.fitdining.api.bookmark.dto;

import java.time.OffsetDateTime;
import java.util.List;
import kr.co.fitdining.api.place.dto.OpenStatus;
import kr.co.fitdining.api.place.dto.PlaceSummary;

/**
 * 내 목록의 북마크 하나(bookmark D-13). 장소 정보는 응답을 만들 때 장소 상세에서 채우고, 핏 점수와 추천 이유는 없다.
 *
 * @param place 장소 요약. 장소 상세의 {@code place}와 같다.
 * @param address 주소. 없으면 생략한다.
 * @param tags 장소 상세의 태그. 없으면 빈 배열이다.
 * @param openStatus 응답을 만든 시각 기준 영업 상태
 * @param savedAt 저장 시각. Asia/Seoul 오프셋이다.
 */
public record BookmarkItem(
		PlaceSummary place,
		String address,
		List<String> tags,
		OpenStatus openStatus,
		OffsetDateTime savedAt
) {
}
