package kr.co.fitdining.api.review.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.util.List;

/**
 * 리뷰 등록 요청(D-40).
 *
 * @param visitedAt 방문일(KST). 작성 화면 데이터의 방문일 범위 안이어야 한다.
 * @param tagCodes 이유 태그 코드. 좋았어요 1개 이상, 같은 그룹은 하나만(D-5).
 * @param description 본문. 공백뿐이면 본문 없음으로 저장된다(D-6).
 * @param spentPerPerson 1인당 금액(원). 생략할 수 있다.
 */
public record ReviewCreateRequest(
		@NotNull LocalDate visitedAt,
		@NotEmpty List<String> tagCodes,
		@NotNull Boolean revisitIntent,
		@Size(max = DESCRIPTION_MAX) String description,
		@Min(0) @Max(SPENT_PER_PERSON_MAX) Integer spentPerPerson
) {

	/** 작성 화면 데이터의 제한값도 이 값을 쓴다. DB 제약(V4)은 따로 맞춘다. */
	public static final int DESCRIPTION_MAX = 500;

	public static final int SPENT_PER_PERSON_MAX = 1_000_000;

}
