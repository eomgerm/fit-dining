package kr.co.fitdining.api.meetup.dto;

import jakarta.validation.constraints.NotNull;

/**
 * 투표와 정하기에서 고른 장소(AC-37, AC-41).
 *
 * @param placeId 장소 id
 */
public record PlaceChoiceRequest(@NotNull Long placeId) {
}
