-- 임시 시드: PRD FR-10 초안. 태그가 확정되면 이 파일만 고친다(D-36).
INSERT INTO reason_tags (code, feature_code, sentiment, label, display_group, sort_order) VALUES
    ('QUIET_GOOD', 'QUIET', 'GOOD', '조용해서 좋았어요', '분위기', 1),
    ('LIVELY_GOOD', 'LIVELY', 'GOOD', '활기차서 좋았어요', '분위기', 2),
    ('COZY_GOOD', 'COZY', 'GOOD', '아늑했어요', '분위기', 3),
    ('SPACIOUS_SEATING_GOOD', 'SPACIOUS_SEATING', 'GOOD', '자리가 넉넉했어요', '공간', 4),
    ('PRETTY_SPACE_GOOD', 'PRETTY_SPACE', 'GOOD', '공간이 예뻤어요', '공간', 5),
    ('VIEW_OUTDOOR_GOOD', 'VIEW_OUTDOOR', 'GOOD', '뷰가 좋았어요', '공간', 6),
    ('SHORT_WAIT_GOOD', 'SHORT_WAIT', 'GOOD', '바로 들어갔어요', '이용', 7),
    ('VALUE_FOR_MONEY_GOOD', 'VALUE_FOR_MONEY', 'GOOD', '가격만큼 만족했어요', '이용', 8),
    ('GENEROUS_PORTION_GOOD', 'GENEROUS_PORTION', 'GOOD', '양이 넉넉했어요', '양', 9),
    ('PURPOSE_TALK_GOOD', 'PURPOSE_TALK', 'GOOD', '대화하기 좋았어요', '방문 목적', 10),
    ('PURPOSE_SOLO_GOOD', 'PURPOSE_SOLO', 'GOOD', '혼밥하기 좋았어요', '방문 목적', 11),
    ('PURPOSE_DATE_GOOD', 'PURPOSE_DATE', 'GOOD', '데이트하기 좋았어요', '방문 목적', 12),
    ('PURPOSE_GROUP_GOOD', 'PURPOSE_GROUP', 'GOOD', '모임하기 좋았어요', '방문 목적', 13),
    ('PURPOSE_WORK_GOOD', 'PURPOSE_WORK', 'GOOD', '작업·공부하기 좋았어요', '방문 목적', 14),
    ('LIVELY_BAD', 'LIVELY', 'BAD', '너무 시끄러웠어요', '분위기', 15),
    ('QUIET_BAD', 'QUIET', 'BAD', '너무 썰렁했어요', '분위기', 16),
    ('COZY_BAD', 'COZY', 'BAD', '어수선했어요', '분위기', 17),
    ('SPACIOUS_SEATING_BAD', 'SPACIOUS_SEATING', 'BAD', '자리가 좁았어요', '공간', 18),
    ('PRETTY_SPACE_BAD', 'PRETTY_SPACE', 'BAD', '공간이 기대보다 아쉬웠어요', '공간', 19),
    ('VIEW_OUTDOOR_BAD', 'VIEW_OUTDOOR', 'BAD', '뷰가 기대보다 아쉬웠어요', '공간', 20),
    ('SHORT_WAIT_BAD', 'SHORT_WAIT', 'BAD', '대기가 길었어요', '이용', 21),
    ('VALUE_FOR_MONEY_BAD', 'VALUE_FOR_MONEY', 'BAD', '가격에 비해 아쉬웠어요', '이용', 22),
    ('GENEROUS_PORTION_BAD', 'GENEROUS_PORTION', 'BAD', '양이 적었어요', '양', 23),
    ('PURPOSE_TALK_BAD', 'PURPOSE_TALK', 'BAD', '대화하기 불편했어요', '방문 목적', 24),
    ('PURPOSE_SOLO_BAD', 'PURPOSE_SOLO', 'BAD', '혼밥하기 불편했어요', '방문 목적', 25),
    ('PURPOSE_DATE_BAD', 'PURPOSE_DATE', 'BAD', '데이트하기 불편했어요', '방문 목적', 26),
    ('PURPOSE_GROUP_BAD', 'PURPOSE_GROUP', 'BAD', '모임하기 불편했어요', '방문 목적', 27),
    ('PURPOSE_WORK_BAD', 'PURPOSE_WORK', 'BAD', '작업·공부하기 불편했어요', '방문 목적', 28)
ON CONFLICT (code) DO UPDATE SET
    feature_code = EXCLUDED.feature_code,
    sentiment = EXCLUDED.sentiment,
    label = EXCLUDED.label,
    display_group = EXCLUDED.display_group,
    sort_order = EXCLUDED.sort_order;

DELETE FROM reason_tag_categories;
INSERT INTO reason_tag_categories (category, code)
SELECT e.category, t.code
FROM reason_tags t
JOIN (VALUES
    ('QUIET', 'RESTAURANT'), ('QUIET', 'CAFE'), ('QUIET', 'BAR'),
    ('LIVELY', 'RESTAURANT'), ('LIVELY', 'CAFE'), ('LIVELY', 'BAR'),
    ('COZY', 'RESTAURANT'), ('COZY', 'CAFE'), ('COZY', 'BAR'),
    ('SPACIOUS_SEATING', 'RESTAURANT'), ('SPACIOUS_SEATING', 'CAFE'), ('SPACIOUS_SEATING', 'BAR'),
    ('PRETTY_SPACE', 'RESTAURANT'), ('PRETTY_SPACE', 'CAFE'), ('PRETTY_SPACE', 'BAR'),
    ('VIEW_OUTDOOR', 'RESTAURANT'), ('VIEW_OUTDOOR', 'CAFE'),
    ('SHORT_WAIT', 'RESTAURANT'), ('SHORT_WAIT', 'CAFE'), ('SHORT_WAIT', 'BAR'),
    ('VALUE_FOR_MONEY', 'RESTAURANT'), ('VALUE_FOR_MONEY', 'CAFE'), ('VALUE_FOR_MONEY', 'BAR'),
    ('GENEROUS_PORTION', 'RESTAURANT'), ('GENEROUS_PORTION', 'BAR'),
    ('PURPOSE_TALK', 'RESTAURANT'), ('PURPOSE_TALK', 'CAFE'), ('PURPOSE_TALK', 'BAR'),
    ('PURPOSE_SOLO', 'RESTAURANT'), ('PURPOSE_SOLO', 'BAR'),
    ('PURPOSE_DATE', 'RESTAURANT'), ('PURPOSE_DATE', 'CAFE'), ('PURPOSE_DATE', 'BAR'),
    ('PURPOSE_GROUP', 'RESTAURANT'), ('PURPOSE_GROUP', 'BAR'),
    ('PURPOSE_WORK', 'CAFE')
) AS e(feature_code, category) ON e.feature_code = t.feature_code;
UPDATE reason_tag_categories SET label = '혼술하기 좋았어요' WHERE category = 'BAR' AND code = 'PURPOSE_SOLO_GOOD';
UPDATE reason_tag_categories SET label = '혼술하기 불편했어요' WHERE category = 'BAR' AND code = 'PURPOSE_SOLO_BAD';
