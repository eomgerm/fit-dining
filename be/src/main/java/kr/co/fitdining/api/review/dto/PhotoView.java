package kr.co.fitdining.api.review.dto;

import java.util.UUID;

/**
 * 리뷰 사진 하나(D-45). 주소는 같은 출처 상대 경로다.
 *
 * @param photoId 사진 id. 수정할 때 남길 사진을 이 값으로 보낸다.
 * @param url 1,600px 사진
 * @param thumbUrl 썸네일(긴 변 약 400px)
 */
public record PhotoView(UUID photoId, String url, String thumbUrl) {
}
