-- 예약 작업 잠금(ShedLock JdbcTemplateLockProvider 기본 테이블). Blue/Green 두 색이 같은 시각에 깨어나도
-- 한 색만 돌게 한다(인프라 BE 계약 #19). 행은 작업 이름마다 하나이고 시각은 DB 기준 UTC다(usingDbTime)
CREATE TABLE shedlock (
    name varchar(64) CONSTRAINT pk_shedlock PRIMARY KEY,
    lock_until timestamp NOT NULL,
    locked_at timestamp NOT NULL,
    locked_by varchar(255) NOT NULL
);
