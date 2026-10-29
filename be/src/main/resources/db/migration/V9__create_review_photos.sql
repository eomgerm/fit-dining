CREATE TABLE review_photos (
    review_id bigint NOT NULL CONSTRAINT fk_review_photos_review_id REFERENCES reviews(review_id),
    sort_order integer NOT NULL CONSTRAINT ck_review_photos_sort_order CHECK (sort_order BETWEEN 0 AND 4),
    photo_id uuid NOT NULL CONSTRAINT uk_review_photos_photo_id UNIQUE,
    PRIMARY KEY (review_id, sort_order)
);
