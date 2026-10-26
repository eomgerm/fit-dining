CREATE TABLE reviews (
    review_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    place_id bigint NOT NULL CONSTRAINT ck_reviews_place_id CHECK (place_id > 0),
    user_id text NOT NULL CONSTRAINT fk_reviews_user_id REFERENCES auth_users(id),
    visit_date date NOT NULL,
    description varchar(500),
    revisit_intent boolean NOT NULL DEFAULT false,
    spent_per_person integer CONSTRAINT ck_reviews_spent_per_person CHECK (spent_per_person BETWEEN 0 AND 1000000),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);
CREATE INDEX idx_reviews_place_id_created_at_review_id
    ON reviews(place_id, created_at DESC, review_id DESC) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uk_reviews_user_id_place_id_visit_date
    ON reviews(user_id, place_id, visit_date) WHERE deleted_at IS NULL;
