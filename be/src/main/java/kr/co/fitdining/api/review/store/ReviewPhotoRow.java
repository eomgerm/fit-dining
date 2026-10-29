package kr.co.fitdining.api.review.store;

import java.util.UUID;

/** 목록 페이지의 리뷰 사진 한 줄({@link ReviewRepository#findPhotos}). */
public interface ReviewPhotoRow {

	Long getReviewId();

	UUID getPhotoId();

}
