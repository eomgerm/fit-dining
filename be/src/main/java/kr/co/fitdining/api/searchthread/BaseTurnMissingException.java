package kr.co.fitdining.api.searchthread;

/** followUp, region의 기준 turn이 같은 thread에 아직 저장되지 않았다(409 {@code base-missing}). */
class BaseTurnMissingException extends RuntimeException {

	BaseTurnMissingException() {
		super(null, null, false, false);
	}

}
