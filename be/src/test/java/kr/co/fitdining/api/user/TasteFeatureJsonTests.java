package kr.co.fitdining.api.user;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class TasteFeatureJsonTests {
    // 앱 설정(non_null)을 거치지 않는 매퍼로도 코드 취향은 묶음 칸 없이 저장된다(04:00 배치 테스트가 이렇게 쓴다)
    private final JsonMapper plain = JsonMapper.builder().build();

    @Test
    void codeFeature_plainMapper_omitsBundleFields() {
        var json = plain.writeValueAsString(new TasteFeature("QUIET", "axis", true, 4.319, "CAFE"));

        assertEquals("{\"code\":\"QUIET\",\"layer\":\"axis\",\"like\":true,\"weight\":4.319,\"category\":\"CAFE\"}", json);
    }

    @Test
    void bundle_plainMapper_keepsTextAndVector() {
        var json = plain.readTree(plain.writeValueAsString(
                new TasteFeature(null, null, true, 2.5, "CAFE", "창가 자리", new float[] {0.5f})));

        assertEquals("창가 자리", json.get("text").asString());
        assertEquals(1, json.get("vector").size());
        assertTrue(json.get("code").isNull());
    }
}
