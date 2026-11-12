package kr.co.fitdining.api.meetup.dto;

import java.time.LocalDate;
import kr.co.fitdining.api.meetup.domain.AreaKind;

/**
 * 링크 미리보기용 모임 정보(AC-66). FE 서버가 `/m/{code}` 응답의 미리보기 메타 태그를 만든다. 질문, 모임 취향, 참여자
 * 이름은 담지 않는다.
 *
 * @param hostNickname 모임장 닉네임. 없으면 빠진다.
 * @param area 지역. 지점은 위치 이름만 있고 좌표는 싣지 않는다.
 * @param date 모임 날짜. 없으면 빠진다.
 * @param time 모임 시각("19:00"). 없으면 빠진다.
 */
public record MeetupPreview(String hostNickname, Area area, LocalDate date, String time) {

	/** @param name 역은 "역"을 뺀 이름, 동은 동 이름, 지점은 위치 이름. 없으면 빠진다. */
	public record Area(AreaKind kind, String name) {
	}

}
