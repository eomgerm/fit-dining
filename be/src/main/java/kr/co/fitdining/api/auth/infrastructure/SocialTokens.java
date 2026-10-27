package kr.co.fitdining.api.auth.infrastructure;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.util.Arrays;
import java.util.Base64;
import java.util.stream.Collectors;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.auth.ports.TokenCodec;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.stereotype.Component;

/** Short-lived signed cookie payloads with token types isolated from access and refresh tokens. */
@Component
@ConditionalOnWebApplication
@RequiredArgsConstructor
public class SocialTokens {
    private final TokenCodec codec;
    private final Clock clock;

    public String encode(String type, String... fields) {
        String payload = Arrays.stream(fields)
                .map(v -> Base64.getUrlEncoder().withoutPadding().encodeToString(v.getBytes(StandardCharsets.UTF_8)))
                .collect(Collectors.joining("."));
        long now = clock.instant().getEpochSecond();
        return codec.encode(new TokenCodec.Token(payload, null, type, now, now + 600));
    }

    public String[] decode(String token, String type, int count) {
        String[] fields = codec.decode(token, type).userId().split("\\.", -1);
        if (fields.length != count) throw new AuthFailure("Invalid cookie payload");
        return Arrays.stream(fields)
                .map(v -> new String(Base64.getUrlDecoder().decode(v), StandardCharsets.UTF_8))
                .toArray(String[]::new);
    }
}
