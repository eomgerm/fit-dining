package kr.co.fitdining.api.place;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import kr.co.fitdining.api.support.PostgresTestSupport;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/**
 * 장소 카탈로그 마이그레이션이 만든 테이블 8개를 카탈로그로 정확히 비교하고, 앱 계정으로 실제 DML을 실행해
 * 제약, 기본값, 권한, CASCADE를 확인한다.
 */
class PlaceCatalogSchemaTest extends PostgresTestSupport {

	private static final String MIGRATION = "V6__create_place_catalog.sql";

	private static final List<String> CHILDREN = List.of("place_hours", "place_menus", "place_photos", "place_subways",
			"place_bus_stops", "place_seats", "place_broadcasts");

	private static final List<String> TABLES = List.of("places", "place_hours", "place_menus", "place_photos",
			"place_subways", "place_bus_stops", "place_seats", "place_broadcasts");

	private static final String EMPTY_TEXTS = "'{}'::text[]";

	/** 열 이름 → "타입|NULL 허용|기본값". 기본값이 없으면 빈 칸, identity는 "ALWAYS"다. */
	private static final Map<String, Map<String, String>> COLUMNS = Map.of(
			"places", columns(
					"place_id", "int8|NO|ALWAYS",
					"naver_place_id", "text|NO|",
					"name", "text|NO|",
					"category_group", "text|NO|",
					"category", "text|YES|",
					"category_code", "text|YES|",
					"category_code_path", "_text|NO|" + EMPTY_TEXTS,
					"lat", "float8|NO|",
					"lng", "float8|NO|",
					"address", "text|YES|",
					"jibun_address", "text|YES|",
					"full_address", "text|YES|",
					"district", "text|YES|",
					"dong", "text|YES|",
					"directions", "text|YES|",
					"description", "text|YES|",
					"phone", "text|YES|",
					"website", "text|YES|",
					"extra_links", "_text|NO|" + EMPTY_TEXTS,
					"booking_url", "text|YES|",
					"facilities", "_text|NO|" + EMPTY_TEXTS,
					"parking_free", "bool|YES|",
					"parking_note", "text|YES|",
					"pet_allowed", "bool|YES|",
					"pet_note", "text|YES|",
					"corkage_allowed", "bool|YES|",
					"corkage_note", "text|YES|",
					"payment_methods", "_text|NO|" + EMPTY_TEXTS,
					"keywords", "_text|NO|" + EMPTY_TEXTS,
					"menu_updated_on", "date|YES|",
					"created_at", "timestamptz|NO|now()",
					"updated_at", "timestamptz|NO|now()"),
			"place_hours", columns(
					"place_hour_id", "int8|NO|ALWAYS",
					"place_id", "int8|NO|",
					"day_of_week", "text|NO|",
					"open_time", "time|YES|",
					"close_time", "time|YES|",
					"closed", "bool|NO|false",
					"breaks", "jsonb|NO|'[]'::jsonb",
					"last_orders", "_time|NO|'{}'::time without time zone[]"),
			"place_menus", columns(
					"place_menu_id", "int8|NO|ALWAYS",
					"place_id", "int8|NO|",
					"sort_order", "int4|NO|",
					"category", "text|YES|",
					"name", "text|NO|",
					"description", "text|YES|",
					"price", "int4|YES|",
					"price_text", "text|YES|",
					"price_type", "text|YES|",
					"representative", "bool|NO|false",
					"labels", "_text|NO|" + EMPTY_TEXTS,
					"photo_urls", "_text|NO|" + EMPTY_TEXTS),
			"place_photos", columns(
					"place_photo_id", "int8|NO|ALWAYS",
					"place_id", "int8|NO|",
					"source", "text|NO|",
					"sort_order", "int4|NO|",
					"url", "text|NO|"),
			"place_subways", columns(
					"place_subway_id", "int8|NO|ALWAYS",
					"place_id", "int8|NO|",
					"station", "text|NO|",
					"line", "text|YES|",
					"exit", "text|YES|",
					"walk_minutes", "int4|YES|",
					"walk_meters", "int4|YES|"),
			"place_bus_stops", columns(
					"place_bus_stop_id", "int8|NO|ALWAYS",
					"place_id", "int8|NO|",
					"name", "text|NO|",
					"code", "text|YES|",
					"walk_minutes", "int4|YES|",
					"walk_meters", "int4|YES|"),
			"place_seats", columns(
					"place_seat_id", "int8|NO|ALWAYS",
					"place_id", "int8|NO|",
					"name", "text|NO|",
					"description", "text|YES|"),
			"place_broadcasts", columns(
					"place_broadcast_id", "int8|NO|ALWAYS",
					"place_id", "int8|NO|",
					"channel", "text|YES|",
					"program", "text|YES|",
					"episode", "text|YES|",
					"aired_on", "date|YES|",
					"menu", "text|YES|"));

	/** PK를 뺀 이름 붙은 제약. 접두어가 종류다(uk UNIQUE, ck CHECK, fk FK). */
	private static final Map<String, Set<String>> CONSTRAINTS = Map.of(
			"places", Set.of("uk_places_naver_place_id", "ck_places_naver_place_id", "ck_places_category_group",
					"ck_places_lat", "ck_places_lng"),
			"place_hours", Set.of("fk_place_hours_place_id", "ck_place_hours_day_of_week", "ck_place_hours_breaks",
					"uk_place_hours_place_id_day_of_week", "ck_place_hours_time_pair", "ck_place_hours_closed_no_time",
					"ck_place_hours_no_2400"),
			"place_menus", Set.of("fk_place_menus_place_id", "ck_place_menus_sort_order",
					"uk_place_menus_place_id_sort_order"),
			"place_photos", Set.of("fk_place_photos_place_id", "ck_place_photos_source", "ck_place_photos_sort_order",
					"uk_place_photos_place_id_source_sort_order"),
			"place_subways", Set.of("fk_place_subways_place_id"),
			"place_bus_stops", Set.of("fk_place_bus_stops_place_id"),
			"place_seats", Set.of("fk_place_seats_place_id"),
			"place_broadcasts", Set.of("fk_place_broadcasts_place_id"));

	private static final Map<String, String> UNIQUE_COLUMNS = Map.of(
			"uk_places_naver_place_id", "UNIQUE (naver_place_id)",
			"uk_place_hours_place_id_day_of_week", "UNIQUE (place_id, day_of_week)",
			"uk_place_menus_place_id_sort_order", "UNIQUE (place_id, sort_order)",
			"uk_place_photos_place_id_source_sort_order", "UNIQUE (place_id, source, sort_order)");

	/** {@code CREATE INDEX}로 만든 인덱스와 그 열. */
	private static final Map<String, String> CREATED_INDEXES = Map.of(
			"idx_place_subways_place_id_walk_meters", "place_subways USING btree (place_id, walk_meters)",
			"idx_place_bus_stops_place_id_walk_meters", "place_bus_stops USING btree (place_id, walk_meters)",
			"idx_place_seats_place_id", "place_seats USING btree (place_id)",
			"idx_place_broadcasts_place_id", "place_broadcasts USING btree (place_id)");

	private static JdbcTemplate catalog;
	private static JdbcTemplate app;

	@BeforeAll
	static void migrateSchema() throws Exception {
		migrate();
		catalog = new JdbcTemplate(new DriverManagerDataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(),
				POSTGRES.getPassword()));
		app = new JdbcTemplate(appSource());
	}

	@Nested
	@DisplayName("스키마")
	class Schema {

		@Test
		@DisplayName("마이그레이션_Flyway로실행하면_성공으로기록된다")
		void migration_flyway_recordedAsSuccess() {
			assertThat(catalog.queryForList("SELECT success FROM flyway_schema_history WHERE script = ?",
					Boolean.class, MIGRATION)).containsExactly(true);
		}

		@Test
		@DisplayName("테이블_8개는_문서의열만정확히가진다")
		void tables_columns_exactlyAsDocumented() {
			for (String table : TABLES) {
				Map<String, String> actual = new HashMap<>();
				catalog.query("""
						SELECT column_name, udt_name, is_nullable, column_default, is_identity, identity_generation
						FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ?
						""", rs -> {
					String defaultValue = "YES".equals(rs.getString("is_identity"))
							? rs.getString("identity_generation")
							: rs.getString("column_default");
					actual.put(rs.getString("column_name"), rs.getString("udt_name") + "|" + rs.getString("is_nullable")
							+ "|" + (defaultValue == null ? "" : defaultValue));
				}, table);
				assertThat(actual).as(table).isEqualTo(COLUMNS.get(table));
			}
		}

		@Test
		@DisplayName("제약_PK와문서의이름붙은제약뿐이다")
		void constraints_onlyPrimaryKeyAndDocumented() {
			for (String table : TABLES) {
				Map<String, String> actual = new HashMap<>();
				catalog.query("""
						SELECT conname, contype FROM pg_constraint
						WHERE conrelid = to_regclass('public.' || ?) AND contype IN ('p', 'u', 'c', 'f', 'x')
						""", rs -> {
					actual.put(rs.getString("conname"), rs.getString("contype"));
				}, table);

				Map<String, String> expected = new HashMap<>();
				expected.put(table + "_pkey", "p");
				CONSTRAINTS.get(table).forEach(name -> expected.put(name, switch (name.substring(0, 2)) {
					case "uk" -> "u";
					case "ck" -> "c";
					default -> "f";
				}));
				assertThat(actual).as(table).isEqualTo(expected);
			}
		}

		@Test
		@DisplayName("PK_8개테이블모두_단수형id열하나다")
		void primaryKeys_singularIdColumn() {
			for (String table : TABLES) {
				assertThat(catalog.queryForObject("""
						SELECT pg_get_constraintdef(oid) FROM pg_constraint
						WHERE conrelid = to_regclass('public.' || ?) AND contype = 'p'
						""", String.class, table)).as(table).isEqualTo("PRIMARY KEY (" + idColumn(table) + ")");
			}
		}

		@Test
		@DisplayName("UNIQUE제약_문서의열순서다")
		void uniqueConstraints_documentedColumns() {
			UNIQUE_COLUMNS.forEach((name, definition) -> assertThat(catalog.queryForObject(
					"SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = ?", String.class, name))
					.as(name).isEqualTo(definition));
		}

		@Test
		@DisplayName("FK_자식테이블의place_id가_places를가리키고_지우면함께지운다")
		void foreignKeys_cascadeFromPlaces() {
			for (String child : CHILDREN) {
				Map<String, Object> fk = catalog.queryForMap("""
						SELECT confrelid::regclass::text AS target, confdeltype::text AS on_delete,
						       pg_get_constraintdef(oid) AS definition
						FROM pg_constraint WHERE conname = ?
						""", "fk_" + child + "_place_id");
				assertThat(fk.get("target")).isEqualTo("places");
				assertThat(fk.get("on_delete")).isEqualTo("c");
				assertThat((String) fk.get("definition")).startsWith("FOREIGN KEY (place_id) REFERENCES places(place_id)");
			}
		}

		@Test
		@DisplayName("인덱스_PK와UNIQUE와문서의CREATE_INDEX뿐이다")
		void indexes_onlyKeysAndDocumented() {
			for (String table : TABLES) {
				Set<String> expected = new HashSet<>();
				expected.add(table + "_pkey");
				CONSTRAINTS.get(table).stream().filter(name -> name.startsWith("uk_")).forEach(expected::add);
				CREATED_INDEXES.forEach((name, definition) -> {
					if (definition.startsWith(table + " ")) {
						expected.add(name);
					}
				});
				assertThat(catalog.queryForList(
						"SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = ?", String.class,
						table)).as(table).containsExactlyInAnyOrderElementsOf(expected);
			}
			CREATED_INDEXES.forEach((name, definition) -> assertThat(catalog.queryForObject(
					"SELECT indexdef FROM pg_indexes WHERE indexname = ?", String.class, name))
					.isEqualTo("CREATE INDEX " + name + " ON public." + definition));
		}

		@Test
		@DisplayName("자식테이블_모두첫열이place_id인인덱스가있다")
		void children_haveIndexLeadingWithPlaceId() {
			for (String child : CHILDREN) {
				assertThat(catalog.queryForObject("""
						SELECT count(*) FROM pg_index i
						JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
						WHERE i.indrelid = to_regclass('public.' || ?) AND a.attname = 'place_id'
						""", Integer.class, child)).as(child).isPositive();
			}
		}

		@Test
		@DisplayName("외부리뷰테이블_만들지않는다")
		void reviewSnapshotTables_absent() {
			for (String table : List.of("place_naver_snapshots", "place_review_photos")) {
				assertThat(catalog.queryForObject("SELECT to_regclass('public.' || ?)::text", String.class, table))
						.as(table).isNull();
			}
		}
	}

	@Nested
	@DisplayName("places")
	class Places {

		@Test
		@DisplayName("장소_place_id없이넣으면_발급되고_필수열만이면_배열은비고시각은트랜잭션now다")
		void insert_requiredOnly_issuesIdAndDefaults() throws SQLException {
			try (Connection connection = appSource().getConnection()) {
				connection.setAutoCommit(false);
				var sql = connection.createStatement();
				var rs = sql.executeQuery("SELECT now()");
				rs.next();
				Timestamp now = rs.getTimestamp(1);
				rs = sql.executeQuery("INSERT INTO places (naver_place_id, name, category_group, lat, lng) VALUES ('"
						+ naverId() + "', '이름', 'CAFE', 37.5, 127.0) RETURNING place_id, created_at, updated_at,"
						+ " category_code_path, extra_links, facilities, payment_methods, keywords");
				rs.next();
				assertThat(rs.getLong("place_id")).isPositive();
				assertThat(rs.getTimestamp("created_at")).isEqualTo(now);
				assertThat(rs.getTimestamp("updated_at")).isEqualTo(now);
				for (String column : List.of("category_code_path", "extra_links", "facilities", "payment_methods",
						"keywords")) {
					assertThat((Object[]) rs.getArray(column).getArray()).as(column).isEmpty();
				}
				connection.commit();
			}
		}

		@Test
		@DisplayName("장소_place_id를직접넣으면_거부된다")
		void insert_explicitPlaceId_rejected() {
			assertRejected("428C9", "INSERT INTO places (place_id, naver_place_id, name, category_group, lat, lng)"
					+ " VALUES (999999, ?, '이름', 'CAFE', 37.5, 127.0)", naverId());
		}

		@Test
		@DisplayName("장소_같은naver_place_id두번이나빈문자열은_거부된다")
		void insert_duplicateOrEmptyNaverId_rejected() {
			String naverId = naverId();
			insertPlace(naverId, 37.5, 127.0);
			assertRejected("23505", insertPlaceSql(), naverId, 37.5, 127.0);
			assertRejected("23514", insertPlaceSql(), "", 37.5, 127.0);
		}

		@Test
		@DisplayName("장소_업종이나좌표범위밖은_거부되고_같은좌표의다른장소는받아들인다")
		void insert_categoryAndCoordinates_checked() {
			assertRejected("23514", "INSERT INTO places (naver_place_id, name, category_group, lat, lng)"
					+ " VALUES (?, '이름', 'PUB', 37.5, 127.0)", naverId());
			assertRejected("23514", insertPlaceSql(), naverId(), 90.0001, 127.0);
			assertRejected("23514", insertPlaceSql(), naverId(), -90.0001, 127.0);
			assertRejected("23514", insertPlaceSql(), naverId(), 37.5, 180.0001);
			assertRejected("23514", insertPlaceSql(), naverId(), 37.5, -180.0001);

			long first = insertPlace(naverId(), 37.123456, 127.654321);
			long second = insertPlace(naverId(), 37.123456, 127.654321);
			assertThat(first).isNotEqualTo(second);
		}
	}

	@Nested
	@DisplayName("place_hours")
	class PlaceHours {

		@Test
		@DisplayName("영업시간_같은장소같은요일두번은_거부된다")
		void insert_duplicateDay_rejected() {
			long placeId = insertPlace(naverId(), 37.5, 127.0);
			app.update("INSERT INTO place_hours (place_id, day_of_week) VALUES (?, 'MON')", placeId);
			assertRejected("23505", "INSERT INTO place_hours (place_id, day_of_week) VALUES (?, 'MON')", placeId);
		}

		@Test
		@DisplayName("영업시간_요일과시각과휴무와브레이크모양이틀리면_거부된다")
		void insert_invalidRows_rejected() {
			long placeId = insertPlace(naverId(), 37.5, 127.0);
			assertRejected("23514", "INSERT INTO place_hours (place_id, day_of_week) VALUES (?, 'HOL')", placeId);
			assertRejected("23514", "INSERT INTO place_hours (place_id, day_of_week, open_time) VALUES (?, 'MON', '10:00')",
					placeId);
			assertRejected("23514", "INSERT INTO place_hours (place_id, day_of_week, close_time) VALUES (?, 'MON', '10:00')",
					placeId);
			assertRejected("23514", "INSERT INTO place_hours (place_id, day_of_week, open_time, close_time, closed)"
					+ " VALUES (?, 'MON', '10:00', '22:00', true)", placeId);
			assertRejected("23514", "INSERT INTO place_hours (place_id, day_of_week, open_time, close_time)"
					+ " VALUES (?, 'MON', '24:00', '22:00')", placeId);
			assertRejected("23514", "INSERT INTO place_hours (place_id, day_of_week, open_time, close_time)"
					+ " VALUES (?, 'MON', '10:00', '24:00')", placeId);
			assertRejected("23514", "INSERT INTO place_hours (place_id, day_of_week, breaks)"
					+ " VALUES (?, 'MON', '{\"start\": \"15:00\"}')", placeId);
		}

		@Test
		@DisplayName("영업시간_자정넘김과24시간은_받아들이고_필수열만이면_기본값이다")
		void insert_overnightAndAllDay_accepted() {
			long placeId = insertPlace(naverId(), 37.5, 127.0);
			app.update("INSERT INTO place_hours (place_id, day_of_week, open_time, close_time)"
					+ " VALUES (?, 'MON', '17:00', '02:00'), (?, 'TUE', '00:00', '00:00')", placeId, placeId);
			app.update("INSERT INTO place_hours (place_id, day_of_week) VALUES (?, 'WED')", placeId);

			Map<String, Object> wed = app.queryForMap("SELECT closed, breaks::text AS breaks,"
					+ " cardinality(last_orders) AS last_orders FROM place_hours WHERE place_id = ? AND day_of_week = 'WED'",
					placeId);
			assertThat(wed.get("closed")).isEqualTo(false);
			assertThat(wed.get("breaks")).isEqualTo("[]");
			assertThat(wed.get("last_orders")).isEqualTo(0);
		}
	}

	@Nested
	@DisplayName("place_photos, place_menus")
	class PhotosAndMenus {

		@Test
		@DisplayName("사진_출처가밖이면거부되고_같은출처같은순서는두번째가거부되며_출처가다르면받아들인다")
		void photos_sourceAndOrder_checked() {
			long placeId = insertPlace(naverId(), 37.5, 127.0);
			String insert = "INSERT INTO place_photos (place_id, source, sort_order, url) VALUES (?, ?, ?, 'https://p')";
			assertRejected("23514", insert, placeId, "placeReview", 0);
			app.update(insert, placeId, "business", 0);
			assertRejected("23505", insert, placeId, "business", 0);
			app.update(insert, placeId, "menuBoard", 0);
			assertRejected("23514", insert, placeId, "business", -1);
		}

		@Test
		@DisplayName("메뉴_같은순서두번과음수순서는거부되고_필수열만이면기본값이다")
		void menus_orderAndDefaults() {
			long placeId = insertPlace(naverId(), 37.5, 127.0);
			String insert = "INSERT INTO place_menus (place_id, sort_order, name) VALUES (?, ?, '메뉴')";
			app.update(insert, placeId, 0);
			assertRejected("23505", insert, placeId, 0);
			assertRejected("23514", insert, placeId, -1);

			Map<String, Object> menu = app.queryForMap("SELECT representative, cardinality(labels) AS labels,"
					+ " cardinality(photo_urls) AS photo_urls FROM place_menus WHERE place_id = ?", placeId);
			assertThat(menu.get("representative")).isEqualTo(false);
			assertThat(menu.get("labels")).isEqualTo(0);
			assertThat(menu.get("photo_urls")).isEqualTo(0);
		}
	}

	@Nested
	@DisplayName("자식 테이블과 권한")
	class ChildrenAndPrivileges {

		@Test
		@DisplayName("장소삭제_그장소의자식행만모두지워진다")
		void deletePlace_cascadesOnlyItsChildren() {
			long deleted = insertPlaceWithChildren();
			long kept = insertPlaceWithChildren();

			app.update("DELETE FROM places WHERE place_id = ?", deleted);

			for (String child : CHILDREN) {
				assertThat(childCount(child, deleted)).as(child).isZero();
				assertThat(childCount(child, kept)).as(child).isEqualTo(1);
			}
		}

		@Test
		@DisplayName("자식행_없는place_id를가리키면_거부된다")
		void insertChild_unknownPlace_rejected() {
			long missing = app.queryForObject("SELECT coalesce(max(place_id), 0) + 1000000 FROM places", Long.class);
			for (String child : CHILDREN) {
				assertRejected("23503", minimalChildInsert(child), missing);
			}
		}

		@Test
		@DisplayName("앱계정_8개테이블에_SELECT_INSERT_UPDATE_DELETE가모두된다")
		void appAccount_dmlOnAllTables() {
			long placeId = insertPlaceWithChildren();

			app.update("UPDATE places SET name = '바뀐 이름', updated_at = now() WHERE place_id = ?", placeId);
			assertThat(app.queryForObject("SELECT name FROM places WHERE place_id = ?", String.class, placeId))
					.isEqualTo("바뀐 이름");
			for (String child : CHILDREN) {
				assertThat(app.update("UPDATE " + child + " SET place_id = place_id WHERE place_id = ?", placeId))
						.as(child).isEqualTo(1);
				assertThat(childCount(child, placeId)).as(child).isEqualTo(1);
				assertThat(app.update("DELETE FROM " + child + " WHERE place_id = ?", placeId)).as(child).isEqualTo(1);
			}
			assertThat(app.update("DELETE FROM places WHERE place_id = ?", placeId)).isEqualTo(1);
		}
	}

	private static Map<String, String> columns(String... pairs) {
		Map<String, String> columns = new HashMap<>();
		for (int i = 0; i < pairs.length; i += 2) {
			columns.put(pairs[i], pairs[i + 1]);
		}
		return columns;
	}

	/** {@code places} → {@code place_id}, {@code place_bus_stops} → {@code place_bus_stop_id} */
	private static String idColumn(String table) {
		return table.substring(0, table.length() - 1) + "_id";
	}

	private static String naverId() {
		return "t-" + UUID.randomUUID();
	}

	private static String insertPlaceSql() {
		return "INSERT INTO places (naver_place_id, name, category_group, lat, lng) VALUES (?, '이름', 'CAFE', ?, ?)";
	}

	private static long insertPlace(String naverId, double lat, double lng) {
		return app.queryForObject(insertPlaceSql() + " RETURNING place_id", Long.class, naverId, lat, lng);
	}

	private static String minimalChildInsert(String child) {
		return switch (child) {
			case "place_hours" -> "INSERT INTO place_hours (place_id, day_of_week) VALUES (?, 'MON')";
			case "place_menus" -> "INSERT INTO place_menus (place_id, sort_order, name) VALUES (?, 0, '메뉴')";
			case "place_photos" ->
				"INSERT INTO place_photos (place_id, source, sort_order, url) VALUES (?, 'business', 0, 'https://p')";
			case "place_subways" -> "INSERT INTO place_subways (place_id, station) VALUES (?, '역삼')";
			case "place_bus_stops" -> "INSERT INTO place_bus_stops (place_id, name) VALUES (?, '정류장')";
			case "place_seats" -> "INSERT INTO place_seats (place_id, name) VALUES (?, '테이블석')";
			default -> "INSERT INTO place_broadcasts (place_id) VALUES (?)";
		};
	}

	private static long insertPlaceWithChildren() {
		long placeId = insertPlace(naverId(), 37.5, 127.0);
		CHILDREN.forEach(child -> app.update(minimalChildInsert(child), placeId));
		return placeId;
	}

	private static int childCount(String child, long placeId) {
		return app.queryForObject("SELECT count(*) FROM " + child + " WHERE place_id = ?", Integer.class, placeId);
	}

	/** 앱 계정으로 실행한 SQL이 기대한 SQLSTATE로 거부되는지 본다. */
	private static void assertRejected(String sqlState, String sql, Object... args) {
		DataAccessException error = catchThrowableOfType(DataAccessException.class, () -> app.update(sql, args));
		assertThat(error).as(sql).isNotNull();
		assertThat(error.getMostSpecificCause()).isInstanceOf(SQLException.class);
		assertThat(((SQLException) error.getMostSpecificCause()).getSQLState()).as(sql).isEqualTo(sqlState);
	}

}
