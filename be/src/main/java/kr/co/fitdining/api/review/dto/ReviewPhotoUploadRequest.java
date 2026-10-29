package kr.co.fitdining.api.review.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

/**
 * 사진 업로드 주소 요청(D-9, D-45).
 *
 * @param count 올릴 사진 수
 */
public record ReviewPhotoUploadRequest(@NotNull @Min(1) @Max(ReviewCreateRequest.PHOTO_MAX) Integer count) {
}
