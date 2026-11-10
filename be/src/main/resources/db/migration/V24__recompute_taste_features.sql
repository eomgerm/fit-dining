-- 취향 세기 규칙이 바뀌었다(taste-profile spec 3·4단계): 상한 3을 없애고 오래된 근거는 뒤에 쌓인 리뷰 수로 약하게 하며,
-- 재방문 의사가 있는 리뷰를 더 무겁게 보고, 리뷰가 있는 회원은 업종별 취향을 함께 둔다.
-- 갱신 시각을 비워 리뷰를 쓴(지운 것 포함) 회원을 다음 04:00 배치에서 모두 새 규칙으로 다시 계산한다.
-- 리뷰가 없는 회원은 근거가 온보딩뿐이라 결과가 같아 대상이 되지 않는다. 다시 계산되기 전의 옛 값도 AI가 읽는다.
UPDATE user_preferences SET features_refreshed_at = NULL WHERE features_refreshed_at IS NOT NULL;
COMMENT ON COLUMN user_preferences.features IS '취향 프로필(taste-profile/v1) 계산 결과. [{code, layer, like, weight, category}]. weight는 0보다 큰 실수이고 상한이 없다(오래된 근거는 뒤에 쌓인 리뷰 수로 약해짐). category가 없거나 null이면 전체 취향, RESTAURANT·CAFE·BAR면 그 업종의 취향이고 리뷰가 있는 회원만 있다. 온보딩 때 만들고 04:00 배치가 원본과 앱 리뷰로 다시 계산한다. 온보딩 때 AI 호출이 실패하면 []로 두고 04:00 배치가 채운다';
