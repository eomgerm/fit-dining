-- places.station: 장소에서 가장 가까운 역 코드(BE PlaceSummary.Station).
-- 서울 수집 지역 역 3개에 대전(9), 구미(2), 부산(8) 역을 더한다. 서울의 나머지 역은 나중에 더한다.
-- 네이버가 가까운 역을 알려 주는 범위(약 1km) 밖이거나 근처에 역이 없는 장소(광주 하남산단 전부 등)를 위해 NULL을 허용한다.
-- 이미 적재된 행(GANGNAM·YEOKSAM·SEOLLEUNG)은 건드리지 않는다.
ALTER TABLE places DROP CONSTRAINT ck_places_station;
ALTER TABLE places ALTER COLUMN station DROP NOT NULL;
ALTER TABLE places ADD CONSTRAINT ck_places_station CHECK (station IN (
    'GANGNAM', 'YEOKSAM', 'SEOLLEUNG',
    'YUSEONG_ONCHEON', 'GUAM', 'NOEUN', 'BANSEOK', 'DAEJEON_WORLDCUP_STADIUM', 'JIJOK', 'GAPCHEON',
    'HYEONCHUNGWON', 'WOLPYEONG',
    'GUMI', 'SAGOK',
    'JEONPO', 'SEOMYEON', 'GEUMNYEONSAN', 'SASANG', 'HADAN', 'GWANGAN', 'NAMPO', 'DONGNAE'));
COMMENT ON COLUMN places.station IS '장소에서 가장 가까운 역 코드(PlaceSummary.Station). 가까운 역이 없으면 NULL';
