package kr.co.fitdining.api.meetup.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.Set;
import kr.co.fitdining.api.meetup.domain.MeetupCategory;
import kr.co.fitdining.api.meetup.domain.MeetupLimits;
import kr.co.fitdining.api.meetup.exception.InvalidMeetupException;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * 모임 정보 수정 요청(AC-22). 만들기 요청과 같은 속성을 모두 선택으로 받는다. 빠진 속성은 그대로 두고 null인 속성은
 * 비우므로, 값과 함께 본문에 있던 속성 이름을 든다.
 *
 * @param fields 본문에 있던 속성 이름
 */
public record MeetupUpdateRequest(
		@Valid MeetupCreateRequest.Area area,
		MeetupCategory category,
		LocalDate date,
		LocalTime time,
		@Min(MeetupLimits.HEADCOUNT_MIN) @Max(MeetupLimits.HEADCOUNT_MAX) Integer headcount,
		String description,
		Set<String> fields
) {

	record Values(MeetupCreateRequest.Area area, MeetupCategory category, LocalDate date, LocalTime time,
			Integer headcount, String description) {
	}

	/**
	 * @throws InvalidMeetupException 본문이 객체가 아니거나, 모르는 속성이 있거나, 값의 모양이 틀렸을 때
	 */
	public static MeetupUpdateRequest from(JsonNode body, JsonMapper mapper) {
		if (body == null || !body.isObject()) {
			throw new InvalidMeetupException();
		}
		try {
			Values values = mapper.treeToValue(body, Values.class);
			return new MeetupUpdateRequest(values.area(), values.category(), values.date(), values.time(),
					values.headcount(), values.description(), Set.copyOf(body.propertyNames()));
		} catch (JacksonException e) {
			throw new InvalidMeetupException();
		}
	}

	public boolean has(String field) {
		return fields.contains(field);
	}

}
