package kr.co.fitdining.api.searchthread;

/** 같은 turn id가 다른 내용으로 이미 저장돼 있다(409 {@code conflict}). */
class TurnConflictException extends RuntimeException {

	TurnConflictException() {
		super(null, null, false, false);
	}

}
