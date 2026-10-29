package kr.co.fitdining.api.review.photo;

/** 사진 저장소 설정이 없거나 접속하지 못할 때 던진다. {@code ReviewExceptionHandler}가 503으로 바꾼다. */
public class PhotoStorageUnavailableException extends RuntimeException {

	public PhotoStorageUnavailableException() {
	}

	public PhotoStorageUnavailableException(Throwable cause) {
		super(cause);
	}

}
