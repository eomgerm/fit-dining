package kr.co.fitdining.api.bookmark;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;
import kr.co.fitdining.api.support.PostgresTestSupport;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/**
 * 장소 FK 마이그레이션(V14)이 그 전에 저장된 북마크를 모두 지우고 FK를 거는지 확인한다(bookmark D-16). 공유 DB는 이미 최신까지
 * 마이그레이션돼 있어서, 같은 컨테이너에 이 테스트만의 DB를 만들어 V13까지 올린 뒤 행을 넣고 나머지를 적용한다.
 */
class BookmarkPlaceForeignKeyMigrationTest extends PostgresTestSupport {

	private static final String DATABASE = "bookmark_fk_migration";

	private JdbcTemplate jdbc;

	@BeforeEach
	void createDatabase() throws SQLException {
		admin("DROP DATABASE IF EXISTS " + DATABASE);
		admin("CREATE DATABASE " + DATABASE);
		try (Connection connection = DriverManager.getConnection(url(), POSTGRES.getUsername(), POSTGRES.getPassword());
				Statement sql = connection.createStatement()) {
			sql.execute("CREATE EXTENSION IF NOT EXISTS vector");
		}
		jdbc = new JdbcTemplate(new DriverManagerDataSource(url(), POSTGRES.getUsername(), POSTGRES.getPassword()));
	}

	@AfterEach
	void dropDatabase() throws SQLException {
		admin("DROP DATABASE IF EXISTS " + DATABASE + " WITH (FORCE)");
	}

	@Test
	@DisplayName("마이그레이션_기존북마크는장소가있든없든모두지우고장소FK를건다")
	void migrate_deletesAllBookmarksAndAddsPlaceForeignKey() {
		flyway("13").migrate();
		jdbc.update("""
				INSERT INTO auth_users (id, email, nickname, age_confirmed_at, terms_agreed_at, privacy_agreed_at,
				    terms_version, password_hash, created_at)
				VALUES ('u1', 'u1@example.com', '사용자1', now(), now(), now(), '2026-10-23', 'not-a-real-hash', now())""");
		jdbc.update("""
				INSERT INTO places (place_id, naver_place_id, name, category_group, station, lat, lng)
				OVERRIDING SYSTEM VALUE VALUES (7, 'n7', '장소7', 'CAFE', 'YEOKSAM', 37.5, 127.03)""");
		jdbc.update("INSERT INTO bookmarks (user_id, place_id, created_at) VALUES ('u1', 7, now()), ('u1', 999, now())");

		// V14만 확인한다. 최신 버전까지 올리면 뒤의 migration이 위 시드 행과 부딪혀 이 test가 깨질 수 있다
		flyway("14").migrate();

		assertThat(jdbc.queryForObject("SELECT count(*) FROM bookmarks", Integer.class)).isZero();
		assertThatThrownBy(() -> jdbc.update(
				"INSERT INTO bookmarks (user_id, place_id, created_at) VALUES ('u1', 999, now())"))
				.isInstanceOf(DataIntegrityViolationException.class)
				.hasMessageContaining(BookmarkService.PLACE_CONSTRAINT);
		jdbc.update("INSERT INTO bookmarks (user_id, place_id, created_at) VALUES ('u1', 7, now())");
		assertThat(jdbc.queryForObject("SELECT count(*) FROM bookmarks", Integer.class)).isEqualTo(1);
	}

	private Flyway flyway(String target) {
		return Flyway.configure().dataSource(url(), POSTGRES.getUsername(), POSTGRES.getPassword()).target(target).load();
	}

	private static String url() {
		return POSTGRES.getJdbcUrl().replaceFirst("/[^/?]+(\\?|$)", "/" + DATABASE + "$1");
	}

	private static void admin(String statement) throws SQLException {
		try (Connection connection = DriverManager.getConnection(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(),
				POSTGRES.getPassword()); Statement sql = connection.createStatement()) {
			sql.execute(statement);
		}
	}

}
