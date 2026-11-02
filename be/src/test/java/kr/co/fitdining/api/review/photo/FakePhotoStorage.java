package kr.co.fitdining.api.review.photo;

import java.time.Duration;
import java.util.Arrays;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.OptionalLong;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** 메모리 사진 저장소. 앱이 올린 것처럼 객체를 넣어 두고, 접속 실패를 흉내 낼 수 있다. */
public class FakePhotoStorage implements PhotoStorage {

	private final Map<String, byte[]> objects = new ConcurrentHashMap<>();
	private volatile boolean down;
	private final AtomicInteger callsInTransaction = new AtomicInteger();
	private volatile Runnable beforeNextCopy;

	/** JPEG 머리(FF D8 FF)로 시작하는 {@code size}바이트 */
	public static byte[] jpeg(int size) {
		byte[] bytes = new byte[size];
		bytes[0] = (byte) 0xFF;
		bytes[1] = (byte) 0xD8;
		bytes[2] = (byte) 0xFF;
		return bytes;
	}

	/** 앱이 사진 하나를 올린 상태로 만든다. 크기로 어느 사진인지 구분할 수 있다. */
	public UUID upload(int bytes, int thumbBytes) {
		UUID id = UUID.randomUUID();
		put(ReviewPhotos.pending(id), jpeg(bytes));
		put(ReviewPhotos.pendingThumb(id), jpeg(thumbBytes));
		return id;
	}

	public UUID upload() {
		return upload(1000, 100);
	}

	public void put(String key, byte[] bytes) {
		objects.put(key, bytes);
	}

	public boolean hasPending(UUID uploadId) {
		return objects.containsKey(ReviewPhotos.pending(uploadId))
				&& objects.containsKey(ReviewPhotos.pendingThumb(uploadId));
	}

	public boolean hasConfirmed(UUID photoId) {
		return objects.containsKey(ReviewPhotos.confirmed(photoId))
				&& objects.containsKey(ReviewPhotos.confirmedThumb(photoId));
	}

	/** 확정본 1,600px 사진의 크기. 없으면 -1 */
	public int confirmedSize(UUID photoId) {
		byte[] bytes = objects.get(ReviewPhotos.confirmed(photoId));
		return bytes == null ? -1 : bytes.length;
	}

	/** 확정본이 있는 사진 id */
	public Set<UUID> confirmedIds() {
		return objects.keySet().stream()
				.filter(key -> key.startsWith("confirmed/") && !key.endsWith(".thumb.jpg"))
				.map(key -> UUID.fromString(key.substring("confirmed/".length(), key.length() - ".jpg".length())))
				.collect(Collectors.toSet());
	}

	public void down(boolean down) {
		this.down = down;
	}

	/** 트랜잭션이 열린 채 불린 저장소 호출 수. 리뷰 수정·삭제는 0이어야 한다(D-51). */
	public int callsInTransaction() {
		return callsInTransaction.get();
	}

	/** 다음 복사 직전에 한 번 실행한다. 사진을 확정하는 사이에 다른 요청이 끼어드는 경우를 흉내 낸다. */
	public void beforeNextCopy(Runnable action) {
		beforeNextCopy = action;
	}

	public void reset() {
		objects.clear();
		down = false;
		callsInTransaction.set(0);
		beforeNextCopy = null;
	}

	@Override
	public String presignPut(String key, Duration ttl) {
		check();
		return "/fit-test-photos/" + key + "?X-Amz-Expires=" + ttl.toSeconds();
	}

	@Override
	public OptionalLong size(String key) {
		check();
		byte[] bytes = objects.get(key);
		return bytes == null ? OptionalLong.empty() : OptionalLong.of(bytes.length);
	}

	@Override
	public byte[] read(String key, int length) {
		check();
		byte[] bytes = objects.get(key);
		return bytes == null ? new byte[0] : Arrays.copyOf(bytes, Math.min(length, bytes.length));
	}

	@Override
	public boolean copy(String from, String to) {
		check();
		Runnable action = beforeNextCopy;
		if (action != null) {
			beforeNextCopy = null;
			action.run();
		}
		byte[] bytes = objects.get(from);
		if (bytes == null) {
			return false;
		}
		objects.put(to, bytes.clone());
		return true;
	}

	@Override
	public void delete(Collection<String> keys) {
		check();
		List.copyOf(keys).forEach(objects::remove);
	}

	private void check() {
		if (TransactionSynchronizationManager.isActualTransactionActive()) {
			callsInTransaction.incrementAndGet();
		}
		if (down) {
			throw new PhotoStorageUnavailableException(new IllegalStateException("down"));
		}
	}

}
