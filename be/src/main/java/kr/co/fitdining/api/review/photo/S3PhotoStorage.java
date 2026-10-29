package kr.co.fitdining.api.review.photo;

import java.net.URI;
import java.net.URL;
import java.time.Duration;
import java.util.Collection;
import java.util.OptionalLong;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.checksums.RequestChecksumCalculation;
import software.amazon.awssdk.core.checksums.ResponseChecksumValidation;
import software.amazon.awssdk.core.exception.SdkException;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.model.DeleteObjectsResponse;
import software.amazon.awssdk.services.s3.model.ObjectIdentifier;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.S3Exception;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

/**
 * Garage S3 API로 사진을 다룬다(D-9). BE는 내부 주소({@code endpoint})로 부르고, 업로드 주소는 브라우저가 보내는
 * Host({@code publicEndpoint})로 서명해 같은 출처 상대 주소로 돌려준다(D-45).
 */
public class S3PhotoStorage implements PhotoStorage, AutoCloseable {

	private static final int NOT_FOUND = 404;
	private static final int RANGE_NOT_SATISFIABLE = 416;
	// 저장소가 응답하지 않을 때 요청이 DB 커넥션과 행 잠금을 오래 잡지 않게 짧게 끊는다
	private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(2);
	private static final Duration SOCKET_TIMEOUT = Duration.ofSeconds(5);
	private static final Duration CALL_TIMEOUT = Duration.ofSeconds(10);

	private final S3Client client;
	private final S3Presigner presigner;
	private final String bucket;

	public S3PhotoStorage(ReviewPhotoProperties properties) {
		StaticCredentialsProvider credentials = StaticCredentialsProvider.create(
				AwsBasicCredentials.create(properties.accessKey(), properties.secretKey()));
		S3Configuration s3 = S3Configuration.builder().pathStyleAccessEnabled(properties.pathStyle()).build();
		Region region = Region.of(properties.region());
		// 체크섬 헤더는 브라우저가 붙이지 않으므로 요구될 때만 쓴다
		this.client = S3Client.builder()
				.endpointOverride(URI.create(properties.endpoint()))
				.region(region)
				.credentialsProvider(credentials)
				.serviceConfiguration(s3)
				.requestChecksumCalculation(RequestChecksumCalculation.WHEN_REQUIRED)
				.responseChecksumValidation(ResponseChecksumValidation.WHEN_REQUIRED)
				.httpClientBuilder(UrlConnectionHttpClient.builder()
						.connectionTimeout(CONNECT_TIMEOUT)
						.socketTimeout(SOCKET_TIMEOUT))
				.overrideConfiguration(override -> override.apiCallTimeout(CALL_TIMEOUT))
				.build();
		this.presigner = S3Presigner.builder()
				.endpointOverride(URI.create(properties.publicEndpoint()))
				.region(region)
				.credentialsProvider(credentials)
				.serviceConfiguration(s3)
				.build();
		this.bucket = properties.bucket();
	}

	@Override
	public String presignPut(String key, Duration ttl) {
		PutObjectRequest put = PutObjectRequest.builder().bucket(bucket).key(key).contentType("image/jpeg").build();
		URL url = presigner.presignPutObject(request -> request.signatureDuration(ttl).putObjectRequest(put)).url();
		// URL은 경로와 쿼리를 인코딩된 그대로 돌려준다
		return url.getPath() + "?" + url.getQuery();
	}

	@Override
	public OptionalLong size(String key) {
		try {
			return OptionalLong.of(client.headObject(request -> request.bucket(bucket).key(key)).contentLength());
		} catch (S3Exception e) {
			if (e.statusCode() == NOT_FOUND) {
				return OptionalLong.empty();
			}
			throw new PhotoStorageUnavailableException(e);
		} catch (SdkException e) {
			throw new PhotoStorageUnavailableException(e);
		}
	}

	@Override
	public byte[] read(String key, int length) {
		try {
			return client.getObjectAsBytes(request -> request.bucket(bucket).key(key).range("bytes=0-" + (length - 1)))
					.asByteArray();
		} catch (S3Exception e) {
			if (e.statusCode() == NOT_FOUND || e.statusCode() == RANGE_NOT_SATISFIABLE) {
				return new byte[0];
			}
			throw new PhotoStorageUnavailableException(e);
		} catch (SdkException e) {
			throw new PhotoStorageUnavailableException(e);
		}
	}

	@Override
	public boolean copy(String from, String to) {
		try {
			client.copyObject(request -> request.sourceBucket(bucket).sourceKey(from).destinationBucket(bucket)
					.destinationKey(to));
			return true;
		} catch (S3Exception e) {
			if (e.statusCode() == NOT_FOUND) {
				return false;
			}
			throw new PhotoStorageUnavailableException(e);
		} catch (SdkException e) {
			throw new PhotoStorageUnavailableException(e);
		}
	}

	@Override
	public void delete(Collection<String> keys) {
		if (keys.isEmpty()) {
			return;
		}
		DeleteObjectsResponse response;
		try {
			response = client.deleteObjects(request -> request.bucket(bucket).delete(delete -> delete.quiet(true)
					.objects(keys.stream().map(key -> ObjectIdentifier.builder().key(key).build()).toList())));
		} catch (SdkException e) {
			throw new PhotoStorageUnavailableException(e);
		}
		if (response.hasErrors() && !response.errors().isEmpty()) {
			throw new PhotoStorageUnavailableException(
					new IllegalStateException("objects not deleted: " + response.errors().size()));
		}
	}

	@Override
	public void close() {
		client.close();
		presigner.close();
	}

}
