package kr.co.fitdining.api.meetup;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArrayList;
import kr.co.fitdining.api.auth.domain.AuthUser;
import kr.co.fitdining.api.auth.repository.AuthUserRepository;
import kr.co.fitdining.api.meetup.domain.AreaKind;
import kr.co.fitdining.api.meetup.domain.MeetupCategory;
import kr.co.fitdining.api.meetup.domain.MeetupInterpretation;
import kr.co.fitdining.api.meetup.domain.MeetupQuestions;
import kr.co.fitdining.api.meetup.dto.MeetupCreateRequest;
import kr.co.fitdining.api.meetup.dto.MeetupUpdateRequest;
import kr.co.fitdining.api.meetup.exception.MeetupForbiddenException;
import kr.co.fitdining.api.meetup.recommend.MeetupInterpreter;
import kr.co.fitdining.api.support.PostgresTestSupport;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * 실제 PostgreSQL로 모임 설명 해석의 저장을 확인한다(AC-47, AC-48, AC-49). 해석기는 가짜이고, 해석 결과는
 * {@code meetups.parsed_conditions}에 저장되는지와 보일 질문에 반영되는지를 본다.
 */
@SpringBootTest
@Import(MeetupInterpretationPersistenceTest.Configuration.class)
class MeetupInterpretationPersistenceTest extends PostgresTestSupport {

	/** 2026-11-11 12:00 KST */
	private static final Instant NOON = Instant.parse("2026-11-11T03:00:00Z");
	private static final String PREFIX = "meetup-interpret-test-";
	private static final String HOST = PREFIX + "host";
	private static final String OTHER = PREFIX + "other";

	@DynamicPropertySource
	static void placeCatalog(DynamicPropertyRegistry registry) {
		registry.add("place.mock.enabled", () -> "false");
	}

	@TestConfiguration
	static class Configuration {
		@Bean
		@Primary
		Clock meetupInterpretTestClock() {
			return Clock.fixed(NOON, ZoneOffset.UTC);
		}

		@Bean
		@Primary
		FakeInterpreter fakeMeetupInterpreter() {
			return new FakeInterpreter();
		}
	}

	/** 받은 설명을 남기고, {@code mentionsFood}가 null이면 실패한다. */
	static final class FakeInterpreter implements MeetupInterpreter {
		final List<String> calls = new CopyOnWriteArrayList<>();
		volatile Boolean mentionsFood = true;

		@Override
		public Optional<MeetupInterpretation> interpret(String description) {
			calls.add(description);
			return mentionsFood == null ? Optional.empty()
					: Optional.of(new MeetupInterpretation(Map.of("version", 3, "text", description),
							new MeetupInterpretation.Summary(mentionsFood)));
		}
	}

	@Autowired
	MeetupService meetupService;

	@Autowired
	AuthUserRepository users;

	@Autowired
	FakeInterpreter interpreter;

	private JdbcTemplate jdbc;

	@BeforeEach
	void setUp() {
		jdbc = new JdbcTemplate(appSource());
		cleanUp();
		interpreter.calls.clear();
		interpreter.mentionsFood = true;
		jdbc.update("""
				insert into places (place_id, naver_place_id, name, category_group, station, dong, lat, lng)
				overriding system value values (9312, 'meetup-interpret-test-9312', '해석 테스트', 'RESTAURANT',
				'SEOLLEUNG', '역삼동', 37.5, 127.05)""");
		users.saveAll(List.of(new AuthUser(HOST, HOST + "@example.com", "모임장민재", "hash", NOON, "2026-10-23"),
				new AuthUser(OTHER, OTHER + "@example.com", "회원도윤", "hash", NOON, "2026-10-23")));
	}

	@AfterEach
	void tearDown() {
		cleanUp();
	}

	private void cleanUp() {
		jdbc.update("delete from meetups where host_user_id like ?", PREFIX + "%");
		jdbc.update("delete from auth_users where id like ?", PREFIX + "%");
		jdbc.update("delete from places where place_id = 9312");
	}

	private String create(String description) {
		return meetupService.create(HOST, new MeetupCreateRequest(
				new MeetupCreateRequest.Area(AreaKind.STATION, "선릉"), MeetupCategory.RESTAURANT,
				LocalDate.of(2026, 11, 14), LocalTime.of(19, 0), 4, description)).code();
	}

	private void describe(String code, String userId, String description) {
		meetupService.update(code, userId, new MeetupUpdateRequest(null, null, null, null, null, description,
				Set.of("description")));
	}

	/** 저장한 해석의 설명 글. 해석이 없으면 null이다. */
	private String storedText(String code) {
		return jdbc.queryForObject("select parsed_conditions -> 'conditions' ->> 'text' from meetups where code = ?",
				String.class, code);
	}

	private MeetupQuestions questions(String code) {
		return meetupService.snapshot(code, HOST, null).questions();
	}

	@Test
	@DisplayName("만들기_설명이있으면_한번해석해저장하고음식언급이면음식질문을숨긴다")
	void create_description_interpretedOnce() {
		String code = create("곱창 먹을 곳");

		assertThat(interpreter.calls).containsExactly("곱창 먹을 곳");
		assertThat(storedText(code)).isEqualTo("곱창 먹을 곳");
		assertThat(jdbc.queryForObject(
				"select parsed_conditions -> 'summary' ->> 'mentionsFood' from meetups where code = ?", String.class,
				code)).isEqualTo("true");
		assertThat(questions(code).food()).isFalse();
		// 지금 뷰의 가게 가격은 모두 비어 있어 메뉴 가격 질문이 없다
		assertThat(questions(code).price()).isFalse();
	}

	@Test
	@DisplayName("만들기_해석이실패해도_모임을만들고질문을모두보인다")
	void create_interpretFails_createdWithAllQuestions() {
		interpreter.mentionsFood = null;

		String code = create("곱창 먹을 곳");

		assertThat(storedText(code)).isNull();
		assertThat(questions(code).food()).isTrue();
	}

	@Test
	@DisplayName("만들기_설명이없으면_해석하지않는다")
	void create_noDescription_noCall() {
		String code = create("  ");

		assertThat(interpreter.calls).isEmpty();
		assertThat(storedText(code)).isNull();
	}

	@Test
	@DisplayName("수정_설명이바뀌면_새설명을해석해바꾸고그대로면부르지않는다")
	void update_changedDescription_reinterprets() {
		String code = create("곱창 먹을 곳");
		interpreter.mentionsFood = false;

		describe(code, HOST, "조용한 곳");
		describe(code, HOST, "조용한 곳");

		assertThat(interpreter.calls).containsExactly("곱창 먹을 곳", "조용한 곳");
		assertThat(storedText(code)).isEqualTo("조용한 곳");
		assertThat(questions(code).food()).isTrue();
	}

	@Test
	@DisplayName("수정_새설명의해석이실패하면_저장한해석을지운다")
	void update_interpretFails_clears() {
		String code = create("곱창 먹을 곳");
		interpreter.mentionsFood = null;

		describe(code, HOST, "조용한 곳");

		assertThat(storedText(code)).isNull();
		assertThat(questions(code).food()).isTrue();
	}

	@Test
	@DisplayName("수정_설명을비우면_해석하지않고저장한해석을지운다")
	void update_clearDescription_clears() {
		String code = create("곱창 먹을 곳");

		describe(code, HOST, null);

		assertThat(interpreter.calls).containsExactly("곱창 먹을 곳");
		assertThat(jdbc.queryForObject("select parsed_conditions is null from meetups where code = ?",
				Boolean.class, code)).isTrue();
	}

	@Test
	@DisplayName("수정_모임장이아니면_해석하지않고403이다")
	void update_notHost_noCall() {
		String code = create("곱창 먹을 곳");

		assertThatThrownBy(() -> describe(code, OTHER, "조용한 곳")).isInstanceOf(MeetupForbiddenException.class);
		assertThat(interpreter.calls).containsExactly("곱창 먹을 곳");
		assertThat(storedText(code)).isEqualTo("곱창 먹을 곳");
	}

}
