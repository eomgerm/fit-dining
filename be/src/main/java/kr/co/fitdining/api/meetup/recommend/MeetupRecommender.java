package kr.co.fitdining.api.meetup.recommend;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import kr.co.fitdining.api.meetup.domain.AreaKind;
import kr.co.fitdining.api.meetup.domain.MeetupCategory;
import kr.co.fitdining.api.meetup.domain.Taste;

/**
 * 모임 추천기의 포트(D-11). 장소 Mock 모드에서는 대신 쓰는 추천기가, DB 모드에서는 AI 추천기가 돈다. 고르는 스위치는
 * 따로 두지 않고 이미 있는 장소 Mock 모드 설정을 따른다. 계산 한 번에 한 번만 부른다(AC-16).
 */
public interface MeetupRecommender {

	/**
	 * @return 장소별 점수와 추천 이유, 추천에 쓴 합친 취향, 장소가 없을 때의 원인
	 * @throws RuntimeException 추천할 수 없을 때. 계산은 실패가 된다.
	 */
	MeetupRecommendation recommend(Input input);

	/**
	 * 계산을 시작할 때의 모임과 취향(D-10).
	 *
	 * @param areaName 역은 "역"을 뺀 이름, 동은 동 이름
	 * @param category 업종. ANY면 상관없다.
	 * @param description 모임 설명. 없을 수 있다.
	 * @param members 계산에 넣은 프로필. 이름은 싣지 않는다(D-5).
	 */
	record Input(AreaKind areaKind, String areaName, MeetupCategory category, LocalDate date, LocalTime time,
			String description, List<Member> members) {
	}

	/**
	 * @param profileId 프로필 번호
	 * @param userId 회원이면 회원 id, 비회원이면 null이다.
	 * @param taste 지금 보이는 질문의 답만 담은 모임 취향
	 */
	record Member(long profileId, String userId, Taste taste) {
	}

}
