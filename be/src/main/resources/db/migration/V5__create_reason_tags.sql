CREATE TABLE reason_tags (
    code text PRIMARY KEY,
    feature_code text NOT NULL,
    sentiment text NOT NULL CONSTRAINT ck_reason_tags_sentiment CHECK (sentiment IN ('GOOD', 'BAD')),
    label varchar(30) NOT NULL,
    display_group varchar(20) NOT NULL,
    sort_order integer NOT NULL
);
CREATE TABLE reason_tag_categories (
    category text NOT NULL CONSTRAINT ck_reason_tag_categories_category CHECK (category IN ('RESTAURANT', 'CAFE', 'BAR')),
    code text NOT NULL CONSTRAINT fk_reason_tag_categories_code REFERENCES reason_tags(code),
    label varchar(30),
    PRIMARY KEY (category, code)
);
CREATE TABLE review_reason_tags (
    review_id bigint NOT NULL CONSTRAINT fk_review_reason_tags_review_id REFERENCES reviews(review_id),
    code text NOT NULL CONSTRAINT fk_review_reason_tags_code REFERENCES reason_tags(code),
    PRIMARY KEY (review_id, code)
);
