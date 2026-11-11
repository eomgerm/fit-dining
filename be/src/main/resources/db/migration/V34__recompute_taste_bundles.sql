-- 취향 묶음(taste-profile spec 4단계)을 기존 회원에게도 채운다. 묶음은 04:00 배치가 취향을 다시 계산할 때 만든다.
-- 배치 대상에 "한 번도 갱신하지 않은 회원"(features_refreshed_at IS NULL)을 더했으므로, 갱신 시각을 비우면 다음 04:00에
-- 리뷰가 없는 회원까지 모두 한 번 다시 계산된다(profile-storage D-15, D-22). 다시 계산되기 전에는 지금 값을 그대로 읽는다.
-- 운영에서는 회원 데이터를 한꺼번에 다시 계산하므로 배포 전에 승인을 받는다.
UPDATE user_preferences SET features_refreshed_at = NULL WHERE features_refreshed_at IS NOT NULL;
COMMENT ON COLUMN user_preferences.features IS '취향 프로필(taste-profile/v1) 계산 결과. 코드 원소 {code, layer, like, weight, category}와 취향 묶음 원소 {code: null, layer: null, like: true, weight, category, text, vector}. weight는 0보다 큰 실수이고 상한이 없다. category가 없거나 null이면 전체, RESTAURANT·CAFE·BAR면 그 업종의 값이고 리뷰가 있는 회원만 있다. 묶음은 업종마다 3개까지이고 vector는 1024차원 질의 벡터다. 온보딩 때 만들고 04:00 배치가 원본과 앱 리뷰로 다시 계산한다. 온보딩 때 AI 호출이 실패하면 []로 두고 04:00 배치가 채운다';
