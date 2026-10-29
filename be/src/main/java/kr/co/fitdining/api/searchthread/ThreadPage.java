package kr.co.fitdining.api.searchthread;

import java.util.List;

/**
 * 최근 검색 목록의 한 페이지(D-3).
 *
 * @param items 최대 20개. 마지막 요청 시각 최신순, 같으면 thread id 역순
 * @param nextCursor 다음 페이지가 실제로 있을 때만. 없으면 응답에서 빠진다
 */
public record ThreadPage(List<Item> items, String nextCursor) {

	/**
	 * @param id thread id
	 * @param title thread를 시작한 질문
	 * @param lastAt 서버 순서가 가장 늦은 turn의 기기 시각(밀리초)
	 */
	public record Item(String id, String title, long lastAt) {
	}

}
