package kr.co.fitdining.api.review.store;

/** 목록 페이지의 리뷰 태그 한 줄({@link ReviewRepository#findTags}). */
public interface ReviewTagRow {

	Long getReviewId();

	String getCode();

	String getSentiment();

	String getLabel();

}
