package kr.co.fitdining.api.meetup.store;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import kr.co.fitdining.api.meetup.domain.FoodType;
import kr.co.fitdining.api.meetup.domain.Mood;
import kr.co.fitdining.api.meetup.domain.Taste;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * 모임 안의 참여자 한 명과 모임 취향({@code meetup_profiles}, D-5). 프로필과 취향은 한 화면에서 함께 남기므로 한 행이다.
 * 표의 칸은 투표 단계에서 매핑한다.
 */
@Entity
@Table(name = "meetup_profiles")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class MeetupProfile {

	@Id
	@GeneratedValue(strategy = GenerationType.IDENTITY)
	private Long profileId;

	@Column(nullable = false)
	private Long meetupId;

	/** 앞뒤 공백을 지우고 NFC로 정규화한 이름(D-5) */
	@Column(nullable = false, length = 10)
	private String name;

	/** 아바타 색(0~7). 모임 안에서 유일하다. */
	@Column(nullable = false)
	private Integer color;

	/** 회원 프로필이면 그 회원({@code auth_users.id}), 비회원이면 null이다. */
	private String userId;

	@Enumerated(EnumType.STRING)
	private Mood mood;

	@JdbcTypeCode(SqlTypes.ARRAY)
	@Column(columnDefinition = "text[]")
	private String[] likeFoods;

	@JdbcTypeCode(SqlTypes.ARRAY)
	@Column(columnDefinition = "text[]")
	private String[] avoidFoods;

	private Boolean noSpicy;

	private Integer priceCap;

	@Column(length = 20)
	private String wantMenu;

	/** 취향을 마지막으로 남기거나 고친 시각. 추천에 반영됐는지 판단한다(D-9). */
	@Column(nullable = false)
	private Instant tasteUpdatedAt;

	public MeetupProfile(Long meetupId, String name, int color, String userId, Taste taste, Instant now) {
		this.meetupId = meetupId;
		this.name = name;
		this.color = color;
		this.userId = userId;
		replaceTaste(taste, now);
	}

	public Taste taste() {
		return new Taste(mood, foods(likeFoods), foods(avoidFoods), noSpicy, priceCap, wantMenu);
	}

	public void replaceTaste(Taste taste, Instant now) {
		this.mood = taste.mood();
		this.likeFoods = codes(taste.likeFoods());
		this.avoidFoods = codes(taste.avoidFoods());
		this.noSpicy = taste.noSpicy();
		this.priceCap = taste.priceCap();
		this.wantMenu = taste.wantMenu();
		this.tasteUpdatedAt = now;
	}

	public boolean member() {
		return userId != null;
	}

	public boolean ownedBy(String requester) {
		return userId != null && userId.equals(requester);
	}

	private static String[] codes(List<FoodType> foods) {
		return foods == null ? null : foods.stream().map(Enum::name).toArray(String[]::new);
	}

	private static List<FoodType> foods(String[] codes) {
		return codes == null ? null : Arrays.stream(codes).map(FoodType::valueOf).toList();
	}

}
