-- Mock 장소 id로 저장한 북마크는 적재한 장소의 같은 id에 붙으므로 모두 지운 뒤 places로 가는 FK를 건다(bookmark D-16).
-- 장소가 지워지면 그 장소의 북마크도 지운다.
DELETE FROM bookmarks;
ALTER TABLE bookmarks
    ADD CONSTRAINT fk_bookmarks_place_id FOREIGN KEY (place_id) REFERENCES places(place_id) ON DELETE CASCADE;
