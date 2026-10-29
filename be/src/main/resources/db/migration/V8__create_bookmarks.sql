-- 사용자별 장소 북마크(bookmark D-1, D-15). places로 가는 FK는 -115가 DB 장소 엔진으로 바꿀 때 더한다(D-16).
CREATE TABLE bookmarks (
    user_id    text        NOT NULL CONSTRAINT fk_bookmarks_user_id REFERENCES auth_users(id),
    place_id   bigint      NOT NULL CONSTRAINT ck_bookmarks_place_id CHECK (place_id > 0),
    created_at timestamptz NOT NULL,
    CONSTRAINT pk_bookmarks PRIMARY KEY (user_id, place_id)
);
