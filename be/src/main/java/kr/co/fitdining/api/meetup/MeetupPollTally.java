package kr.co.fitdining.api.meetup;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import kr.co.fitdining.api.meetup.store.Meetup;
import kr.co.fitdining.api.meetup.store.MeetupProfile;

/**
 * 지금 남아 있는 프로필의 표를 후보별로 센다. 표는 프로필 행에 있어 프로필을 지우면 함께 빠진다(AC-42).
 *
 * @param voters 후보마다 고른 프로필. 후보 순서다.
 * @param notVoted 투표하지 않은 프로필
 */
record MeetupPollTally(Map<Long, List<Long>> voters, List<Long> notVoted) {

	static MeetupPollTally of(Meetup meetup, List<MeetupProfile> profiles) {
		Map<Long, List<Long>> voters = new LinkedHashMap<>();
		meetup.pollCandidates().forEach(placeId -> voters.put(placeId, new ArrayList<>()));
		List<Long> notVoted = new ArrayList<>();
		for (MeetupProfile profile : profiles) {
			List<Long> chosen = profile.getVotePlaceId() == null ? null : voters.get(profile.getVotePlaceId());
			if (chosen == null) {
				notVoted.add(profile.getProfileId());
			} else {
				chosen.add(profile.getProfileId());
			}
		}
		return new MeetupPollTally(voters, notVoted);
	}

	int votedCount() {
		return voters.values().stream().mapToInt(List::size).sum();
	}

	int mostVotes() {
		return voters.values().stream().mapToInt(List::size).max().orElse(0);
	}

	/** 가장 많은 표를 받은 후보. 동점이면 여럿이다. */
	List<Long> leaders() {
		int most = mostVotes();
		return voters.entrySet().stream().filter(entry -> entry.getValue().size() == most).map(Map.Entry::getKey)
				.toList();
	}

}
