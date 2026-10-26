package kr.co.fitdining.api.onboarding;

import java.util.*;
import java.util.regex.Pattern;
import kr.co.fitdining.api.user.Preferences.TasteChip;
import kr.co.fitdining.api.user.Preferences.Polarity;
import org.springframework.stereotype.Component;
import org.springframework.boot.autoconfigure.condition.*;

/** Deterministic dictionary implementation, selected by configuration. */
@Component @ConditionalOnWebApplication
@ConditionalOnProperty(name = "fitdining.onboarding.taste-analyzer", havingValue = "mock", matchIfMissing = true)
public class MockTasteAnalyzer implements TasteAnalyzer {
    private static final String[][] DICTIONARY = {
        {"담백.*국물|국물.*담백", "담백한 국물"}, {"담백", "담백한 맛"}, {"국물", "국물"},
        {"매운|맵", "매운맛"}, {"달달|단맛", "달달한 맛"}, {"조용", "조용한 분위기"}, {"양\\s*많", "넉넉한 양"}
    };
    @Override public List<TasteChip> analyze(String text) {
        if (text.contains("#실패")) throw new IllegalStateException("Mock analyzer unavailable");
        Set<TasteChip> chips = new LinkedHashSet<>();
        for (String fragment : text.split("[,，.!?\\n]|하고|하지만|그런데|좋아하며|좋아해요")) {
            for (String[] item : DICTIONARY) {
                if (!Pattern.compile(item[0]).matcher(fragment).find()) continue;
                if ((item[1].equals("담백한 맛") || item[1].equals("국물"))
                        && Pattern.compile(DICTIONARY[0][0]).matcher(fragment).find()) continue;
                Polarity polarity = Pattern.compile("별로|싫|안\\s*좋|못\\s*먹").matcher(fragment).find()
                        ? Polarity.DISLIKE : Polarity.LIKE;
                chips.add(new TasteChip(polarity, item[1]));
            }
        }
        if (chips.isEmpty()) {
            String label = text.replaceAll("\\p{Cc}", " ").strip();
            if (label.isEmpty()) label = "나만의 취향";
            int end = Math.min(20, label.length());
            if (end > 0 && Character.isHighSurrogate(label.charAt(end - 1))) end--;
            chips.add(new TasteChip(Polarity.LIKE, label.substring(0, end)));
        }
        return chips.stream().limit(5).toList();
    }
}
