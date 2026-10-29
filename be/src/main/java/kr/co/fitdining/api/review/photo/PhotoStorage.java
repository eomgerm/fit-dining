package kr.co.fitdining.api.review.photo;

import java.time.Duration;
import java.util.Collection;
import java.util.OptionalLong;

/**
 * 리뷰 사진 객체 저장소. 운영은 Garage의 S3 API다(D-9). 접속 실패는 {@link PhotoStorageUnavailableException}으로
 * 던진다.
 */
public interface PhotoStorage {

	/**
	 * @param key 객체 키
	 * @param ttl 주소 수명
	 * @return 브라우저가 {@code Content-Type: image/jpeg}로 PUT할 같은 출처 상대 주소(경로와 쿼리)
	 */
	String presignPut(String key, Duration ttl);

	/** @return 객체 크기. 객체가 없으면 빈 값 */
	OptionalLong size(String key);

	/** @return 객체의 앞 {@code length}바이트. 객체가 그보다 짧으면 있는 만큼 */
	byte[] read(String key, int length);

	/** @return 복사했으면 true, 원본이 없으면 false */
	boolean copy(String from, String to);

	/** 한 번의 요청으로 지운다. 없는 키는 건너뛴다. */
	void delete(Collection<String> keys);

}
