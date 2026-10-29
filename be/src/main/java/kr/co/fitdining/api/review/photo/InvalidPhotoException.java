package kr.co.fitdining.api.review.photo;

/**
 * 사진이 없거나, 상한을 넘거나, JPEG가 아니거나, 같은 사진이 두 번 있거나, 이 리뷰에 쓸 수 없는 사진일 때 던진다.
 * {@code ReviewExceptionHandler}가 400으로 바꾼다.
 */
public class InvalidPhotoException extends RuntimeException {
}
