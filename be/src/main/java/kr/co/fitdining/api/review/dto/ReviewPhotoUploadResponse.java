package kr.co.fitdining.api.review.dto;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * 사진 업로드 주소(D-9, D-45). 앱은 사진마다 두 주소에 {@code Content-Type: image/jpeg}로 PUT한 뒤, 등록이나 수정
 * 요청에 {@code photoId}만 담는다.
 */
public record ReviewPhotoUploadResponse(List<PhotoUpload> uploads) {

	/**
	 * @param photoId 업로드 id. 등록·수정 요청에 담는다. 확정하면 사진은 새 사진 id를 받는다(D-45).
	 * @param uploadUrl 1,600px 사진을 올릴 같은 출처 상대 주소
	 * @param thumbUploadUrl 썸네일을 올릴 같은 출처 상대 주소
	 * @param expiresAt 두 주소가 만료되는 시각(Asia/Seoul 오프셋)
	 */
	public record PhotoUpload(UUID photoId, String uploadUrl, String thumbUploadUrl, OffsetDateTime expiresAt) {
	}

}
