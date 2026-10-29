package kr.co.fitdining.api.place.keyword;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * 키워드 매칭 규칙(place-lookup-db D-6 ~ D-10)을 구현한 순수 함수 모음. 단어 단위 AND, 단어마다 이름, 메뉴, 업종, 위치 중
 * 하나에 부분 문자열로 있어야 통과하고, 마지막 단어의 마지막 글자만 한글 조합을 완화한다.
 */
final class KeywordMatcher {

	private static final Pattern WHITESPACE = Pattern.compile("\\s+", Pattern.UNICODE_CHARACTER_CLASS);

	private KeywordMatcher() {
	}

	static String normalize(String value) {
		return Normalizer.normalize(value, Normalizer.Form.NFC).toLowerCase(Locale.ROOT);
	}

	/** 입력의 단어. relaxLast가 참이면 마지막 글자를 조합 중인 글자로 본다. */
	private record Term(String text, boolean relaxLast) {
	}

	private record Ranked(IndexedDocument document, int rank, String matchedMenu) {
	}

	static List<PlaceKeywordHit> search(List<IndexedDocument> documents, String query, int offset, int limit) {
		// 공백을 먼저 접고 나서 자른다. strip()만으로는 NBSP나 U+3000이 남아 빈 단어가 생긴다.
		String phrase = WHITESPACE.matcher(normalize(query)).replaceAll(" ").strip();
		if (phrase.isEmpty()) {
			return List.of();
		}
		List<Term> terms = terms(phrase);
		List<Ranked> ranked = new ArrayList<>();
		for (IndexedDocument document : documents) {
			Ranked result = rank(document, terms, phrase);
			if (result != null) {
				ranked.add(result);
			}
		}
		ranked.sort(Comparator.comparingInt(Ranked::rank).thenComparingLong(item -> item.document().id()));
		return ranked.stream()
				.skip(offset)
				.limit(limit)
				.map(item -> new PlaceKeywordHit(item.document().source().place(), item.matchedMenu(),
						item.rank() == 0))
				.toList();
	}

	/** 중복을 뺀 단어 목록. 입력의 마지막 단어와 같은 단어만 조합 완화를 받는다. */
	private static List<Term> terms(String phrase) {
		String lastWord = phrase.substring(phrase.lastIndexOf(' ') + 1);
		return new ArrayList<>(new LinkedHashSet<>(Arrays.asList(phrase.split(" ")))).stream()
				.map(word -> new Term(word, word.equals(lastWord)))
				.toList();
	}

	/** 모든 단어가 통과하면 순위와 matchedMenu를 담아 돌려주고, 하나라도 통과하지 못하면 null이다. */
	private static Ranked rank(IndexedDocument document, List<Term> terms, String phrase) {
		int inName = 0;
		boolean viaMenuOrCategory = false;
		List<Term> menuOnly = new ArrayList<>();
		for (Term term : terms) {
			boolean name = contains(document.name(), term);
			boolean menu = anyContains(document.menus(), term);
			boolean category = anyContains(document.categories(), term);
			boolean location = anyContains(document.locations(), term);
			if (!(name || menu || category || location)) {
				return null;
			}
			if (name) {
				inName++;
			}
			if (menu || category) {
				viaMenuOrCategory = true;
			}
			if (!name && !category && !location) {
				menuOnly.add(term);
			}
		}
		int rank;
		if (startsWith(document.name(), phrase)) {
			rank = 0;
		} else if (inName == terms.size()) {
			rank = 1;
		} else if (inName > 0) {
			rank = 2;
		} else if (viaMenuOrCategory) {
			rank = 3;
		} else {
			rank = 4;
		}
		return new Ranked(document, rank, menuOnly.isEmpty() ? null : bestMenu(document, menuOnly));
	}

	/** 이름, 업종, 위치로 채워지지 않은 단어를 가장 많이 담은 메뉴(동점이면 원본 순서가 앞선 메뉴)의 원본 이름. */
	private static String bestMenu(IndexedDocument document, List<Term> terms) {
		int bestIndex = -1;
		int bestCount = 0;
		for (int i = 0; i < document.menus().size(); i++) {
			int count = 0;
			for (Term term : terms) {
				if (contains(document.menus().get(i), term)) {
					count++;
				}
			}
			if (count > bestCount) {
				bestCount = count;
				bestIndex = i;
			}
		}
		return bestIndex < 0 ? null : document.source().menuNames().get(bestIndex);
	}

	/** 텍스트가 입력 전체(마지막 글자는 조합 완화)로 시작하는지. */
	private static boolean startsWith(String text, String phrase) {
		if (text.length() < phrase.length()) {
			return false;
		}
		String prefix = phrase.substring(0, phrase.length() - 1);
		return text.startsWith(prefix)
				&& HangulComposition.canComplete(phrase.charAt(phrase.length() - 1), text, prefix.length());
	}

	private static boolean anyContains(List<String> texts, Term term) {
		for (String text : texts) {
			if (contains(text, term)) {
				return true;
			}
		}
		return false;
	}

	private static boolean contains(String text, Term term) {
		if (!term.relaxLast()) {
			return text.contains(term.text());
		}
		String prefix = term.text().substring(0, term.text().length() - 1);
		char last = term.text().charAt(term.text().length() - 1);
		// from + prefix.length()가 텍스트 안에 있는 동안만 본다. 접두어가 비어 있어도 끝난다.
		for (int from = text.indexOf(prefix); from >= 0 && from + prefix.length() < text.length();
				from = text.indexOf(prefix, from + 1)) {
			if (HangulComposition.canComplete(last, text, from + prefix.length())) {
				return true;
			}
		}
		return false;
	}

}
