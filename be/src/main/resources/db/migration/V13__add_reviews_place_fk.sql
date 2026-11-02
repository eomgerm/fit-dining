-- Mock 장소 id로 쓴 리뷰는 적재한 장소의 같은 id에 붙으므로 모두 지운 뒤 places로 가는 FK를 건다(review D-49).
DELETE FROM review_reports;
DELETE FROM review_photos;
DELETE FROM review_reason_tags;
DELETE FROM reviews;
ALTER TABLE reviews
    ADD CONSTRAINT fk_reviews_place_id FOREIGN KEY (place_id) REFERENCES places(place_id);
