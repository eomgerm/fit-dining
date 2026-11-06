-- places.station: 장소에서 가장 가까운 역 코드(BE PlaceSummary.Station).
-- 서울 강남권 후보 7,326곳의 가장 가까운 역 15개 중 아직 없던 12개(신논현, 논현, 언주, 한티, 삼성중앙, 교대, 선정릉, 삼성,
-- 학동, 사평, 도곡, 봉은사)를 더해 34개가 된다. 서울의 나머지 역은 나중에 더한다.
-- 이미 적재된 행은 건드리지 않는다(허용 코드만 늘어난다).
ALTER TABLE places DROP CONSTRAINT ck_places_station;
ALTER TABLE places ADD CONSTRAINT ck_places_station CHECK (station IN (
    'GANGNAM', 'YEOKSAM', 'SEOLLEUNG',
    'SINNONHYEON', 'NONHYEON', 'EONJU', 'HANTI', 'SAMSEONG_JUNGANG', 'GYODAE', 'SEONJEONGNEUNG',
    'SAMSEONG', 'HAKDONG', 'SAPYEONG', 'DOGOK', 'BONGEUNSA',
    'YUSEONG_ONCHEON', 'GUAM', 'NOEUN', 'BANSEOK', 'DAEJEON_WORLDCUP_STADIUM', 'JIJOK', 'GAPCHEON',
    'HYEONCHUNGWON', 'WOLPYEONG',
    'GUMI', 'SAGOK',
    'JEONPO', 'SEOMYEON', 'GEUMNYEONSAN', 'SASANG', 'HADAN', 'GWANGAN', 'NAMPO', 'DONGNAE'));
