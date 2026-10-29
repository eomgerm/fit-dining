package kr.co.fitdining.api.review.photo;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.Container.ExecResult;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.images.builder.Transferable;
import org.testcontainers.utility.DockerImageName;

/**
 * 운영과 같은 Garage(v2.4.1)에 붙여 presigned PUT, 크기, 앞부분 읽기, 복사, 삭제를 확인한다. 브라우저처럼 서명 밖의
 * 헤더 없이 {@code Content-Type: image/jpeg}만 보내 올린다.
 */
class S3PhotoStorageTest {

	private static final String BUCKET = "fit-test-photos";
	// 테스트 전용 값. Garage의 key import 형식(GK + 16진수 24자리, 16진수 64자리 비밀)을 따른다
	private static final String ACCESS_KEY = "GK" + "0123456789abcdef01234567";
	private static final String SECRET_KEY = "ab".repeat(32);
	private static final String CONFIG = """
			metadata_dir = "/tmp/meta"
			data_dir = "/tmp/data"
			db_engine = "lmdb"
			replication_factor = 1
			rpc_bind_addr = "[::]:3901"
			rpc_public_addr = "127.0.0.1:3901"

			[s3_api]
			s3_region = "garage"
			api_bind_addr = "[::]:3900"
			""";

	private static final GenericContainer<?> GARAGE = new GenericContainer<>(
			DockerImageName.parse("dxflrs/garage:v2.4.1"))
			.withCopyToContainer(Transferable.of(CONFIG), "/etc/garage.toml")
			.withEnv("GARAGE_RPC_SECRET", "cd".repeat(32))
			.withCommand("/garage", "-c", "/etc/garage.toml", "server")
			.withExposedPorts(3900)
			// 셸이 없는 이미지라 포트 검사 대신 로그를 기다린다
			.waitingFor(Wait.forLogMessage(".*S3 API server listening.*", 1));

	private static final HttpClient HTTP = HttpClient.newHttpClient();

	private static String origin;
	private static S3PhotoStorage storage;

	@BeforeAll
	static void start() throws Exception {
		GARAGE.start();
		Matcher node = Pattern.compile("(?m)^([0-9a-f]{16})\\s").matcher(garage("status"));
		assertThat(node.find()).as("Garage 노드 id").isTrue();
		garage("layout", "assign", "-z", "dc1", "-c", "1G", node.group(1));
		garage("layout", "apply", "--version", "1");
		garage("key", "import", "--yes", "-n", "test", ACCESS_KEY, SECRET_KEY);
		garage("bucket", "create", BUCKET);
		garage("bucket", "allow", "--read", "--write", "--owner", BUCKET, "--key", ACCESS_KEY);
		origin = "http://" + GARAGE.getHost() + ":" + GARAGE.getMappedPort(3900);
		storage = new S3PhotoStorage(properties(origin));
	}

	@AfterAll
	static void stop() {
		if (storage != null) {
			storage.close();
		}
		GARAGE.stop();
	}

	private static String garage(String... args) throws Exception {
		String[] command = new String[args.length + 3];
		command[0] = "/garage";
		command[1] = "-c";
		command[2] = "/etc/garage.toml";
		System.arraycopy(args, 0, command, 3, args.length);
		ExecResult result = GARAGE.execInContainer(command);
		assertThat(result.getExitCode()).as(String.join(" ", args) + ": " + result.getStderr()).isZero();
		return result.getStdout();
	}

	private static ReviewPhotoProperties properties(String endpoint) {
		return new ReviewPhotoProperties(endpoint, endpoint, "garage", BUCKET, ACCESS_KEY, SECRET_KEY, true,
				"/photos/test/confirmed/", 1000, 100, Duration.ofMinutes(10));
	}

	private static HttpResponse<String> put(String path, String contentType, byte[] body) throws Exception {
		return HTTP.send(HttpRequest.newBuilder(URI.create(origin + path)).header("Content-Type", contentType)
				.PUT(HttpRequest.BodyPublishers.ofByteArray(body)).build(), HttpResponse.BodyHandlers.ofString());
	}

	@Test
	@DisplayName("업로드주소_같은출처상대경로이고_서명헤더는Host와ContentType뿐이다")
	void presignPut_relativePathSigningHostAndContentTypeOnly() {
		String path = storage.presignPut("pending/a.jpg", Duration.ofMinutes(10));

		assertThat(path).startsWith("/" + BUCKET + "/pending/a.jpg?");
		assertThat(path).contains("X-Amz-SignedHeaders=content-type%3Bhost").contains("X-Amz-Expires=600");
	}

	@Test
	@DisplayName("업로드주소로_JPEG를PUT하면_크기와앞부분을읽을수있다")
	void presignPut_browserPut_storedAndReadable() throws Exception {
		byte[] jpeg = FakePhotoStorage.jpeg(500);

		HttpResponse<String> response = put(storage.presignPut("pending/b.jpg", Duration.ofMinutes(1)), "image/jpeg",
				jpeg);

		assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
		assertThat(storage.size("pending/b.jpg")).hasValue(500);
		assertThat(storage.read("pending/b.jpg", 3)).containsExactly(0xFF, 0xD8, 0xFF);
	}

	@Test
	@DisplayName("업로드주소로_다른ContentType을보내면_서명이맞지않아거부된다")
	void presignPut_otherContentType_rejected() throws Exception {
		HttpResponse<String> response = put(storage.presignPut("pending/c.jpg", Duration.ofMinutes(1)), "image/png",
				FakePhotoStorage.jpeg(10));

		assertThat(response.statusCode()).isEqualTo(403);
		assertThat(storage.size("pending/c.jpg")).isEmpty();
	}

	@Test
	@DisplayName("없는객체는_크기가없고앞부분은빈배열이다")
	void missing_sizeEmptyAndReadEmpty() {
		assertThat(storage.size("pending/missing.jpg")).isEmpty();
		assertThat(storage.read("pending/missing.jpg", 3)).isEmpty();
	}

	@Test
	@DisplayName("복사하고원본을지우면_복사본만남는다")
	void copyThenDelete_keepsCopyOnly() throws Exception {
		put(storage.presignPut("pending/d.jpg", Duration.ofMinutes(1)), "image/jpeg", FakePhotoStorage.jpeg(20));

		assertThat(storage.copy("pending/d.jpg", "confirmed/d.jpg")).isTrue();
		storage.delete(List.of("pending/d.jpg"));

		assertThat(storage.size("confirmed/d.jpg")).hasValue(20);
		assertThat(storage.size("pending/d.jpg")).isEmpty();
	}

	@Test
	@DisplayName("원본이없으면_복사하지않고false다")
	void copy_missingSource_false() {
		assertThat(storage.copy("pending/missing.jpg", "confirmed/missing.jpg")).isFalse();
		assertThat(storage.size("confirmed/missing.jpg")).isEmpty();
	}

	@Test
	@DisplayName("여러키를지우면_한번에지우고없는키는건너뛴다")
	void delete_severalKeys_deletesAllAndSkipsMissing() throws Exception {
		put(storage.presignPut("pending/e.jpg", Duration.ofMinutes(1)), "image/jpeg", FakePhotoStorage.jpeg(20));
		put(storage.presignPut("pending/e.thumb.jpg", Duration.ofMinutes(1)), "image/jpeg", FakePhotoStorage.jpeg(10));

		assertThatCode(() -> storage.delete(List.of("pending/e.jpg", "pending/e.thumb.jpg", "pending/none.jpg")))
				.doesNotThrowAnyException();

		assertThat(storage.size("pending/e.jpg")).isEmpty();
		assertThat(storage.size("pending/e.thumb.jpg")).isEmpty();
	}

	@Test
	@DisplayName("저장소에접속하지못하면_사진저장소없음예외다")
	void unreachable_unavailable() {
		try (S3PhotoStorage unreachable = new S3PhotoStorage(properties("http://127.0.0.1:1"))) {
			assertThatThrownBy(() -> unreachable.size("pending/a.jpg"))
					.isInstanceOf(PhotoStorageUnavailableException.class);
		}
	}

}
