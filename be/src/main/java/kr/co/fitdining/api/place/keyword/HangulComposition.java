package kr.co.fitdining.api.place.keyword;

/**
 * 입력의 마지막 글자가 아직 덜 쓴 글자일 수 있다는 한글 조합 규칙(place-lookup-db D-9). 입력이 300ms 멈췄을 때
 * 서버가 받는 글자는 `쌀국` 입력 중의 `쌀구`처럼 조합 중일 수 있어서, 마지막 글자만 이어질 수 있는 글자에 맞춘다.
 */
final class HangulComposition {

	private static final int FIRST_SYLLABLE = 0xAC00;
	private static final int LAST_SYLLABLE = 0xD7A3;
	private static final int JUNG_COUNT = 21;
	private static final int JONG_COUNT = 28;

	/** 초성 인덱스 순서의 호환 자모: ㄱ ㄲ ㄴ ㄷ ㄸ ㄹ ㅁ ㅂ ㅃ ㅅ ㅆ ㅇ ㅈ ㅉ ㅊ ㅋ ㅌ ㅍ ㅎ. */
	private static final String CHOSEONG_JAMO =
			"ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌ"
					+ "ㅍㅎ";

	/** 중성 인덱스 → 복합 모음으로 이어진 중성들. ㅗ→ㅘ ㅙ ㅚ, ㅜ→ㅝ ㅞ ㅟ, ㅡ→ㅢ. */
	private static final int[][] JUNG_EXTENSIONS = new int[JUNG_COUNT][];

	/** 종성 인덱스 → {받침으로 남는 종성, 다음 글자의 초성}. 홑받침은 받침이 남지 않고(0) 통째로 넘어간다. */
	private static final int[][] JONG_SPLIT = new int[JONG_COUNT][];

	static {
		JUNG_EXTENSIONS[8] = new int[] {9, 10, 11};
		JUNG_EXTENSIONS[13] = new int[] {14, 15, 16};
		JUNG_EXTENSIONS[18] = new int[] {19};

		// {종성, 그 종성이 넘어가는 초성}
		int[][] single = {{1, 0}, {2, 1}, {4, 2}, {7, 3}, {8, 5}, {16, 6}, {17, 7}, {19, 9}, {20, 10}, {21, 11},
				{22, 12}, {23, 14}, {24, 15}, {25, 16}, {26, 17}, {27, 18}};
		for (int[] entry : single) {
			JONG_SPLIT[entry[0]] = new int[] {0, entry[1]};
		}
		// {겹받침, 남는 종성, 넘어가는 초성}
		int[][] compound = {{3, 1, 9}, {5, 4, 12}, {6, 4, 18}, {9, 8, 0}, {10, 8, 6}, {11, 8, 7}, {12, 8, 9},
				{13, 8, 16}, {14, 8, 17}, {15, 8, 18}, {18, 17, 9}};
		for (int[] entry : compound) {
			JONG_SPLIT[entry[0]] = new int[] {entry[1], entry[2]};
		}
	}

	private HangulComposition() {
	}

	/**
	 * 입력의 마지막 글자 {@code typed}가 텍스트의 {@code index} 자리 글자로 이어질 수 있는지 본다.
	 *
	 * @param typed 입력의 마지막 글자
	 * @param text 맞춰 볼 텍스트(정규화한 값)
	 * @param index 텍스트에서 맞춰 볼 자리. 0 이상, 텍스트 길이 미만이다.
	 * @return 같은 글자이거나 조합 중인 {@code typed}가 그 글자로 완성될 수 있으면 true
	 */
	static boolean canComplete(char typed, String text, int index) {
		char actual = text.charAt(index);
		if (actual == typed) {
			return true;
		}
		int choseongOfJamo = CHOSEONG_JAMO.indexOf(typed);
		if (choseongOfJamo >= 0) {
			return isSyllable(actual) && choseong(actual) == choseongOfJamo;
		}
		if (!isSyllable(typed) || !isSyllable(actual) || choseong(actual) != choseong(typed)) {
			return false;
		}
		int jung = jungseong(typed);
		int jong = jongseong(typed);
		if (jong == 0) {
			return jungseong(actual) == jung || isExtension(jung, jungseong(actual));
		}
		if (jungseong(actual) != jung) {
			return false;
		}
		int[] split = JONG_SPLIT[jong];
		boolean movedToNext = jongseong(actual) == split[0] && index + 1 < text.length()
				&& isSyllable(text.charAt(index + 1)) && choseong(text.charAt(index + 1)) == split[1];
		if (movedToNext) {
			return true;
		}
		// 홑받침이 겹받침의 첫 자음일 때(달 → 닭)
		return split[0] == 0 && isCompoundStartingWith(jong, jongseong(actual));
	}

	private static boolean isExtension(int jung, int actualJung) {
		int[] extensions = JUNG_EXTENSIONS[jung];
		if (extensions == null) {
			return false;
		}
		for (int extension : extensions) {
			if (extension == actualJung) {
				return true;
			}
		}
		return false;
	}

	private static boolean isCompoundStartingWith(int firstJong, int actualJong) {
		int[] split = JONG_SPLIT[actualJong];
		return split != null && split[0] == firstJong;
	}

	private static boolean isSyllable(char c) {
		return c >= FIRST_SYLLABLE && c <= LAST_SYLLABLE;
	}

	private static int choseong(char c) {
		return (c - FIRST_SYLLABLE) / (JUNG_COUNT * JONG_COUNT);
	}

	private static int jungseong(char c) {
		return (c - FIRST_SYLLABLE) % (JUNG_COUNT * JONG_COUNT) / JONG_COUNT;
	}

	private static int jongseong(char c) {
		return (c - FIRST_SYLLABLE) % JONG_COUNT;
	}

}
