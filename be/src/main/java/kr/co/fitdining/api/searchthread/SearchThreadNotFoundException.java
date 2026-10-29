package kr.co.fitdining.api.searchthread;

/** 내 계정에 그 thread가 없다(404 {@code not-found}). */
class SearchThreadNotFoundException extends RuntimeException {

	SearchThreadNotFoundException() {
		super(null, null, false, false);
	}

}
