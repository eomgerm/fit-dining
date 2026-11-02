package kr.co.fitdining.api.review.photo;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalLong;
import java.util.UUID;
import kr.co.fitdining.api.review.dto.PhotoView;
import kr.co.fitdining.api.review.dto.ReviewPhotoUploadResponse.PhotoUpload;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.support.StaticListableBeanFactory;

/** 사진 확인, 복사, 정리 규칙. 실제 S3 API 호출은 {@code S3PhotoStorageTest}가 확인한다. */
class ReviewPhotosTest {

	private static final ReviewPhotoProperties PROPERTIES = new ReviewPhotoProperties("http://garage:3900",
			"https://fit.example", "garage", "fit-dev-photos", "key", "secret", true, "/photos/dev/confirmed/", 1000, 100,
			Duration.ofMinutes(10));

	private final FakePhotoStorage storage = new FakePhotoStorage();
	private final ReviewPhotos photos = photos(storage);

	private static ReviewPhotos photos(PhotoStorage storage) {
		StaticListableBeanFactory beans = storage == null ? new StaticListableBeanFactory()
				: new StaticListableBeanFactory(Map.of("photoStorage", storage));
		return new ReviewPhotos(PROPERTIES, beans.getBeanProvider(PhotoStorage.class),
				Optional.of(Clock.fixed(Instant.parse("2026-10-21T03:00:00.700Z"), ZoneOffset.UTC)));
	}

	@Nested
	@DisplayName("업로드 주소")
	class Issue {

		@Test
		@DisplayName("발급_개수만큼_사진마다두주소와초단위만료시각을준다")
		void issue_count_twoUrlsPerPhotoWithExpiry() {
			List<PhotoUpload> uploads = photos.issue(2).uploads();

			assertThat(uploads).hasSize(2).extracting(PhotoUpload::photoId).doesNotHaveDuplicates();
			PhotoUpload first = uploads.getFirst();
			assertThat(first.uploadUrl()).startsWith("/fit-test-photos/pending/" + first.photoId() + ".jpg?");
			assertThat(first.thumbUploadUrl()).startsWith("/fit-test-photos/pending/" + first.photoId() + ".thumb.jpg?");
			assertThat(first.uploadUrl()).endsWith("X-Amz-Expires=600");
			assertThat(first.expiresAt()).isEqualTo(OffsetDateTime.parse("2026-10-21T12:10:00+09:00"));
		}

		@Test
		@DisplayName("발급_저장소가없으면_503이다")
		void issue_noStorage_unavailable() {
			assertThatThrownBy(() -> photos(null).issue(1)).isInstanceOf(PhotoStorageUnavailableException.class);
		}
	}

	@Nested
	@DisplayName("확정")
	class Confirm {

		@Test
		@DisplayName("확정_올린사진이면_새사진id로복사하고업로드원본은남긴다")
		void confirm_uploaded_copiesToNewIdAndKeepsPending() {
			UUID upload = storage.upload(901, 91);

			List<UUID> confirmed = photos.confirm(List.of(upload));

			assertThat(confirmed).hasSize(1).doesNotContain(upload);
			assertThat(storage.confirmedSize(confirmed.getFirst())).isEqualTo(901);
			assertThat(storage.hasConfirmed(upload)).isFalse();
			assertThat(storage.hasPending(upload)).isTrue();
		}

		@Test
		@DisplayName("확정_여러장이면_올린순서대로새id를돌려준다")
		void confirm_several_returnsIdsInOrder() {
			UUID first = storage.upload(901, 91);
			UUID second = storage.upload(902, 92);

			List<UUID> confirmed = photos.confirm(List.of(second, first));

			assertThat(confirmed).extracting(storage::confirmedSize).containsExactly(902, 901);
		}

		@Test
		@DisplayName("확정_같은업로드를두번확정하면_서로다른확정본이다")
		void confirm_sameUploadTwice_separateCopies() {
			UUID upload = storage.upload();

			UUID first = photos.confirm(List.of(upload)).getFirst();
			UUID second = photos.confirm(List.of(upload)).getFirst();
			photos.discardConfirmed(List.of(second));

			assertThat(first).isNotEqualTo(second);
			assertThat(storage.hasConfirmed(first)).isTrue();
		}

		@Test
		@DisplayName("확정_상한과같은크기면_통과한다")
		void confirm_atLimit_passes() {
			UUID upload = storage.upload(1000, 100);

			assertThatCode(() -> photos.confirm(List.of(upload))).doesNotThrowAnyException();
		}

		@ParameterizedTest(name = "1,600px {0}바이트, 썸네일 {1}바이트")
		@CsvSource({"1001, 100", "1000, 101", "0, 100", "1000, 0"})
		@DisplayName("확정_상한을넘거나빈사진이면_400이고이번에복사한것을남기지않는다")
		void confirm_badSize_invalidWithoutCopies(int bytes, int thumbBytes) {
			UUID valid = storage.upload();
			UUID upload = UUID.randomUUID();
			storage.put(ReviewPhotos.pending(upload), bytes == 0 ? new byte[0] : FakePhotoStorage.jpeg(bytes));
			storage.put(ReviewPhotos.pendingThumb(upload),
					thumbBytes == 0 ? new byte[0] : FakePhotoStorage.jpeg(thumbBytes));

			assertThatThrownBy(() -> photos.confirm(List.of(valid, upload))).isInstanceOf(InvalidPhotoException.class);
			assertThat(storage.confirmedIds()).isEmpty();
		}

		@Test
		@DisplayName("확정_올리지않은사진이면_400이다")
		void confirm_missing_invalid() {
			assertThatThrownBy(() -> photos.confirm(List.of(UUID.randomUUID())))
					.isInstanceOf(InvalidPhotoException.class);
		}

		@Test
		@DisplayName("확정_JPEG가아니면_400이다")
		void confirm_notJpeg_invalid() {
			UUID upload = storage.upload();
			byte[] png = new byte[100];
			png[0] = (byte) 0x89;
			png[1] = 'P';
			png[2] = 'N';
			storage.put(ReviewPhotos.pendingThumb(upload), png);

			assertThatThrownBy(() -> photos.confirm(List.of(upload))).isInstanceOf(InvalidPhotoException.class);
		}

		@Test
		@DisplayName("확정_복사하다접속이끊기면_503이고이번에복사한것을지운다")
		void confirm_copyFails_removesCopies() {
			UUID first = storage.upload();
			UUID second = storage.upload();
			ReviewPhotos photosWithFailure = photos(new FailingSecondCopy(storage));

			assertThatThrownBy(() -> photosWithFailure.confirm(List.of(first, second)))
					.isInstanceOf(PhotoStorageUnavailableException.class);
			assertThat(storage.confirmedIds()).isEmpty();
		}

		@Test
		@DisplayName("확정_사진이없으면_저장소가없어도된다")
		void confirm_none_needsNoStorage() {
			assertThat(photos(null).confirm(List.of())).isEmpty();
		}

		@Test
		@DisplayName("확정_저장소가없으면_503이다")
		void confirm_noStorage_unavailable() {
			assertThatThrownBy(() -> photos(null).confirm(List.of(UUID.randomUUID())))
					.isInstanceOf(PhotoStorageUnavailableException.class);
		}
	}

	/** 두 번째 사진의 1,600px 복사에서 접속이 끊기는 저장소 */
	private static final class FailingSecondCopy implements PhotoStorage {
		private final FakePhotoStorage delegate;
		private int copies;

		FailingSecondCopy(FakePhotoStorage delegate) {
			this.delegate = delegate;
		}

		@Override
		public String presignPut(String key, Duration ttl) {
			return delegate.presignPut(key, ttl);
		}

		@Override
		public OptionalLong size(String key) {
			return delegate.size(key);
		}

		@Override
		public byte[] read(String key, int length) {
			return delegate.read(key, length);
		}

		@Override
		public boolean copy(String from, String to) {
			if (++copies == 3) {
				throw new PhotoStorageUnavailableException();
			}
			return delegate.copy(from, to);
		}

		@Override
		public void delete(Collection<String> keys) {
			delegate.delete(keys);
		}
	}

	@Nested
	@DisplayName("정리")
	class CleanUp {

		@Test
		@DisplayName("지우기_저장소에접속하지못해도_예외를던지지않는다")
		void discard_storageDown_doesNotThrow() {
			UUID upload = storage.upload();
			storage.down(true);

			assertThatCode(() -> photos.discardPending(List.of(upload))).doesNotThrowAnyException();
		}

		@Test
		@DisplayName("지우기_저장소가없으면_예외없이건너뛴다")
		void discard_noStorage_skips() {
			assertThatCode(() -> photos(null).discardConfirmed(List.of(UUID.randomUUID())))
					.doesNotThrowAnyException();
		}
	}

	@Test
	@DisplayName("읽기주소_확정본의같은출처경로다")
	void view_id_returnsReadPaths() {
		UUID id = UUID.fromString("3f2a1b4c-0000-4000-8000-000000000001");

		assertThat(photos.view(id)).isEqualTo(new PhotoView(id,
				"/photos/dev/confirmed/3f2a1b4c-0000-4000-8000-000000000001.jpg",
				"/photos/dev/confirmed/3f2a1b4c-0000-4000-8000-000000000001.thumb.jpg"));
	}

}
