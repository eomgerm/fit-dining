package kr.co.fitdining.api.review.photo;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.OptionalLong;
import java.util.UUID;
import java.util.stream.Stream;
import kr.co.fitdining.api.review.dto.PhotoView;
import kr.co.fitdining.api.review.dto.ReviewPhotoUploadResponse;
import kr.co.fitdining.api.review.dto.ReviewPhotoUploadResponse.PhotoUpload;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * 리뷰 사진의 업로드 주소 발급, 확정, 정리, 읽기 주소(D-9, D-45). 객체는 1,600px 사진({@code <id>.jpg})과
 * 썸네일({@code <id>.thumb.jpg}) 두 벌이다. 앱이 올린 사진은 업로드 id로 {@code pending/}에 있고, 리뷰에 붙으면 새 사진
 * id로 {@code confirmed/}에 복사된다. {@code pending/}은 저장소의 수명주기가 하루 뒤 지운다(인프라 7.4절).
 */
@Slf4j
@Component
public class ReviewPhotos {

	private static final byte[] JPEG = {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF};
	private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");

	private final ReviewPhotoProperties properties;
	private final ObjectProvider<PhotoStorage> storageProvider;
	private final Clock clock;

	public ReviewPhotos(ReviewPhotoProperties properties, ObjectProvider<PhotoStorage> storageProvider,
			Optional<Clock> clock) {
		this.properties = properties;
		this.storageProvider = storageProvider;
		this.clock = clock.orElseGet(() -> Clock.system(SEOUL));
	}

	/**
	 * @param count 올릴 사진 수(1~5, 컨트롤러가 확인한다)
	 * @throws PhotoStorageUnavailableException 저장소가 없을 때
	 */
	public ReviewPhotoUploadResponse issue(int count) {
		PhotoStorage storage = storage();
		Duration ttl = properties.uploadTtl();
		Instant expiresAt = clock.instant().plus(ttl).truncatedTo(ChronoUnit.SECONDS);
		List<PhotoUpload> uploads = new ArrayList<>();
		for (int i = 0; i < count; i++) {
			UUID id = UUID.randomUUID();
			uploads.add(new PhotoUpload(id, storage.presignPut(pending(id), ttl), storage.presignPut(pendingThumb(id), ttl),
					expiresAt.atZone(SEOUL).toOffsetDateTime()));
		}
		return new ReviewPhotoUploadResponse(uploads);
	}

	/**
	 * 올린 사진을 새 사진 id의 {@code confirmed/}로 복사하고, 복사본의 크기와 형식을 확인한다. 확정본은 요청마다 새 id라서
	 * 같은 업로드로 이미 붙은 사진이나 다른 요청의 복사본을 건드리지 않고, 확인 뒤에 업로드 원본이 바뀌어도 복사본은 그대로다.
	 * 하나라도 틀리면 이번에 복사한 것을 지운다. 업로드 원본은 그대로 두어, 등록이 다른 이유(409 등)로 실패해도 같은 사진으로
	 * 다시 보낼 수 있다.
	 *
	 * @param uploadIds 업로드 주소를 받을 때 받은 id
	 * @return 확정한 사진 id. {@code uploadIds}와 같은 순서다.
	 * @throws InvalidPhotoException 없거나, 상한을 넘거나, JPEG가 아닌 사진이 있을 때
	 * @throws PhotoStorageUnavailableException 저장소가 없거나 접속하지 못할 때
	 */
	public List<UUID> confirm(List<UUID> uploadIds) {
		if (uploadIds.isEmpty()) {
			return List.of();
		}
		PhotoStorage storage = storage();
		List<UUID> confirmedIds = new ArrayList<>();
		try {
			for (UUID upload : uploadIds) {
				UUID id = UUID.randomUUID();
				confirmedIds.add(id);
				if (!storage.copy(pending(upload), confirmed(id))
						|| !storage.copy(pendingThumb(upload), confirmedThumb(id))) {
					throw new InvalidPhotoException();
				}
				check(storage, confirmed(id), properties.maxBytes());
				check(storage, confirmedThumb(id), properties.thumbMaxBytes());
			}
		} catch (RuntimeException e) {
			discardConfirmed(confirmedIds);
			throw e;
		}
		return List.copyOf(confirmedIds);
	}

	/** 확정한 사진을 지운다. 지우지 못해도 리뷰 처리를 막지 않고 기록만 남긴다. */
	public void discardConfirmed(Collection<UUID> ids) {
		deleteQuietly(ids.stream().flatMap(id -> Stream.of(confirmed(id), confirmedThumb(id))).toList());
	}

	/** 리뷰에 붙인 뒤 남은 업로드 원본을 지운다. 지우지 못하면 수명주기가 지운다. */
	public void discardPending(Collection<UUID> uploadIds) {
		deleteQuietly(uploadIds.stream().flatMap(id -> Stream.of(pending(id), pendingThumb(id))).toList());
	}

	/**
	 * 지금 트랜잭션이 끝나면 사진을 정리한다. 커밋되면 빠진 사진의 확정본과 새 사진의 업로드 원본을 지우고, 롤백되면 새로
	 * 확정한 사진을 지운다. 결과를 알 수 없으면 커밋됐을 수도 있어 지우지 않는다.
	 *
	 * @param uploadIds 이번에 확정한 사진의 업로드 id
	 * @param added 이번에 확정한 사진 id
	 * @param removed 리뷰에서 빠진 사진 id
	 */
	public void cleanUpAfterTransaction(List<UUID> uploadIds, List<UUID> added, List<UUID> removed) {
		List<UUID> uploads = List.copyOf(uploadIds);
		List<UUID> addedCopy = List.copyOf(added);
		List<UUID> removedCopy = List.copyOf(removed);
		TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
			@Override
			public void afterCompletion(int status) {
				switch (status) {
					case STATUS_COMMITTED -> {
						discardConfirmed(removedCopy);
						discardPending(uploads);
					}
					case STATUS_ROLLED_BACK -> discardConfirmed(addedCopy);
					default -> log.warn("Skipped review photo cleanup: transaction outcome is unknown");
				}
			}
		});
	}

	public PhotoView view(UUID id) {
		return new PhotoView(id, properties.readPrefix() + id + ".jpg", properties.readPrefix() + id + ".thumb.jpg");
	}

	private void check(PhotoStorage storage, String key, long maxBytes) {
		OptionalLong size = storage.size(key);
		if (size.isEmpty() || size.getAsLong() <= 0 || size.getAsLong() > maxBytes
				|| !Arrays.equals(storage.read(key, JPEG.length), JPEG)) {
			throw new InvalidPhotoException();
		}
	}

	private void deleteQuietly(List<String> keys) {
		if (keys.isEmpty()) {
			return;
		}
		PhotoStorage storage = storageProvider.getIfAvailable();
		if (storage == null) {
			log.warn("Skipped deleting review photo objects: storage is not configured, count={}", keys.size());
			return;
		}
		try {
			storage.delete(keys);
		} catch (RuntimeException e) {
			log.warn("Failed to delete review photo objects: reason={}, count={}", e.getClass().getSimpleName(),
					keys.size());
		}
	}

	private PhotoStorage storage() {
		PhotoStorage storage = storageProvider.getIfAvailable();
		if (storage == null) {
			throw new PhotoStorageUnavailableException();
		}
		return storage;
	}

	static String pending(UUID id) {
		return "pending/" + id + ".jpg";
	}

	static String pendingThumb(UUID id) {
		return "pending/" + id + ".thumb.jpg";
	}

	static String confirmed(UUID id) {
		return "confirmed/" + id + ".jpg";
	}

	static String confirmedThumb(UUID id) {
		return "confirmed/" + id + ".thumb.jpg";
	}

}
