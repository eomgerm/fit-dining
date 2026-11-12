package kr.co.fitdining.api.meetup.recommend;

import kr.co.fitdining.api.meetup.domain.MeetupInterpretation;
import kr.co.fitdining.api.meetup.store.MeetupRepository;
import kr.co.fitdining.api.place.catalog.ConditionalOnCatalogMode;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * 계산 중에 다시 해석한 설명을 저장한다(AC-48). 작업 스레드에서 새 트랜잭션으로 모임 행을 잡고, 해석하는 동안 설명이
 * 바뀌지 않았을 때만 바꾼다(D-4).
 */
@Component
@ConditionalOnCatalogMode
class MeetupInterpretations {

	private final MeetupRepository meetups;

	MeetupInterpretations(MeetupRepository meetups) {
		this.meetups = meetups;
	}

	/**
	 * @param description 해석한 설명
	 * @param interpretation 해석 결과. null이면 저장한 해석을 지운다.
	 */
	@Transactional(propagation = Propagation.REQUIRES_NEW)
	public void store(long meetupId, String description, MeetupInterpretation interpretation) {
		meetups.findLockedByMeetupId(meetupId).ifPresent(meetup -> meetup.interpreted(description, interpretation));
	}

}
