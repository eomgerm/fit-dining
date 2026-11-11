package kr.co.fitdining.api.meetup.recommend;

import kr.co.fitdining.api.place.catalog.ConditionalOnCatalogMode;
import org.springframework.stereotype.Component;

/**
 * DB 모드의 추천기. AI의 모임 전용 주소를 부르는 일은 추천 연동 단계에서 채우고, 그 전에는 계산이 늘 실패한다(D-11,
 * D-16).
 */
@Component
@ConditionalOnCatalogMode
class AiMeetupRecommender implements MeetupRecommender {

	@Override
	public MeetupRecommendation recommend(Input input) {
		throw new MeetupRecommenderUnavailableException();
	}

}
