package kr.co.fitdining.api.bookmark.dto;

/**
 * 장소 하나의 저장 여부(bookmark D-5).
 *
 * @param bookmarked 내가 저장한 장소면 true
 */
public record BookmarkStatus(boolean bookmarked) {
}
