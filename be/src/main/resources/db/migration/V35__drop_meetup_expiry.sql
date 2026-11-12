-- 모임은 시간이 지나도 지우지 않는다(meetup spec D-36). 모임을 지울 시각과 그 색인을 지운다.
DROP INDEX IF EXISTS idx_meetups_expires_at;
ALTER TABLE meetups DROP COLUMN IF EXISTS expires_at;
