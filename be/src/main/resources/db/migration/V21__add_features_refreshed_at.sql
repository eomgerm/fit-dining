ALTER TABLE user_preferences ADD COLUMN features_refreshed_at timestamptz;
COMMENT ON COLUMN user_preferences.features_refreshed_at IS '04:00 배치가 features를 마지막으로 다시 계산한 실행 시작 시각. 이후에 쓰거나 지운 리뷰가 있는 회원만 다시 계산한다. null은 아직 배치가 계산하지 않음. AI 호출이 실패하면 바꾸지 않아 다음 실행에서 다시 대상이 된다';
