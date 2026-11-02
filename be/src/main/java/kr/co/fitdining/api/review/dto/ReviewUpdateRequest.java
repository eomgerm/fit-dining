package kr.co.fitdining.api.review.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;

/**
 * 리뷰 수정 요청(D-6, D-44, D-45). 고칠 수 있는 것은 본문과 사진뿐이라 다른 필드(방문일, 태그, 1인당 금액 등)는 받지
 * 않는다. 둘 중 하나 이상이 있어야 하고, 없는 필드는 그대로 둔다.
 *
 * @param description 본문. 빈 문자열이나 공백이면 본문 없음으로 저장된다.
 * @param photos 고친 뒤의 사진 전체. 남길 사진은 사진 id, 새로 올린 사진은 업로드 id를 화면 순서대로 담고, 빈 목록이면
 *        사진을 모두 뺀다.
 * @param basePhotos 수정 화면이 처음 받은 사진 id 목록. 지금 사진 목록과 다르면 409다(D-51). 없으면 요청이 도착했을 때의
 *        목록을 기준으로 삼는다(배포가 겹치는 동안의 옛 앱).
 */
public record ReviewUpdateRequest(
		@Size(max = ReviewCreateRequest.DESCRIPTION_MAX) String description,
		@Size(max = ReviewCreateRequest.PHOTO_MAX) List<@NotNull UUID> photos,
		@Size(max = ReviewCreateRequest.PHOTO_MAX) List<@NotNull UUID> basePhotos
) {

	public ReviewUpdateRequest(String description, List<UUID> photos) {
		this(description, photos, null);
	}

	/** 이름이 getter 꼴이 아니어서 JSON 속성으로 읽히지 않는다. */
	public boolean hasChange() {
		return description != null || photos != null;
	}

}
