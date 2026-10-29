package kr.co.fitdining.api.searchthread;

/** 본문, 형식 규칙, thread 규칙, cursor·id 형식 위반(400 {@code invalid}). 메시지는 어긴 규칙 이름뿐이고 본문은 담지 않는다. */
class InvalidSearchThreadException extends RuntimeException {

	InvalidSearchThreadException(String rule) {
		super(rule, null, false, false);
	}

}
