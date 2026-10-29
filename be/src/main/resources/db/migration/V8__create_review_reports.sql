CREATE TABLE review_reports (
    review_report_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    review_id bigint NOT NULL CONSTRAINT fk_review_reports_review_id REFERENCES reviews(review_id),
    reporter_id text NOT NULL CONSTRAINT fk_review_reports_reporter_id REFERENCES auth_users(id),
    reason text NOT NULL CONSTRAINT ck_review_reports_reason CHECK (reason IN ('AD_SPAM', 'ABUSE', 'UNRELATED', 'OTHER')),
    detail varchar(100),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_review_reports_detail CHECK (detail IS NULL OR reason = 'OTHER'),
    CONSTRAINT uk_review_reports_review_id_reporter_id UNIQUE (review_id, reporter_id)
);
