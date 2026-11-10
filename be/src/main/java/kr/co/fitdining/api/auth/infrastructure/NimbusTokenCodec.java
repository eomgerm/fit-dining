package kr.co.fitdining.api.auth.infrastructure;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import javax.crypto.spec.SecretKeySpec;
import com.nimbusds.jose.jwk.source.ImmutableSecret;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.JwtIssuerValidator;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.JwsHeader;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.auth.ports.TokenCodec.Token;
import kr.co.fitdining.api.auth.ports.TokenCodec;

public final class NimbusTokenCodec implements TokenCodec {
    private static final String ISSUER = "fitdining-auth";
    private static final String AUDIENCE = "fitdining-api";
    private final JwtEncoder encoder;
    private final NimbusJwtDecoder decoder;
    private final Clock clock;
    public NimbusTokenCodec(byte[] secret, Clock clock) {
        if (secret.length < 32) throw new IllegalArgumentException("JWT_SECRET needs at least 32 decoded bytes");
        this.clock = clock;
        var key = new SecretKeySpec(secret, "HmacSHA256");
        encoder = new NimbusJwtEncoder(new ImmutableSecret<>(key));
        decoder = NimbusJwtDecoder.withSecretKey(key).macAlgorithm(MacAlgorithm.HS256).build();
        // Signature/issuer/audience are validated here; strict timestamps below distinguish expiry from other failures.
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(new JwtIssuerValidator(ISSUER),
                jwt -> jwt.getAudience().contains(AUDIENCE) ? OAuth2TokenValidatorResult.success()
                    : OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token"))));
    }
    @Override public String encode(Token token) {
        if (!List.of("oauth_state", "social_signup").contains(token.type())) throw invalid();
        var claims = JwtClaimsSet.builder().issuer(ISSUER).audience(List.of(AUDIENCE))
                .subject(token.userId())
                .claim("token_type", token.type()).issuedAt(Instant.ofEpochSecond(token.createdAt()))
                .expiresAt(Instant.ofEpochSecond(token.expiresAt()));
        return encoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims.build())).getTokenValue();
    }
    @Override public Claims decode(String value, String expectedType) {
        if (!List.of("oauth_state", "social_signup").contains(expectedType)) throw invalid();
        if (value == null || value.isBlank() || value.length() > 8192) throw invalid();
        try {
            Jwt jwt = decoder.decode(value);
            String type = jwt.getClaimAsString("token_type");
            long now = clock.instant().getEpochSecond();
            if (!expectedType.equals(type) || blank(jwt.getSubject())
                    || jwt.getIssuedAt() == null || jwt.getExpiresAt() == null
                    || jwt.getIssuedAt().getEpochSecond() > now
                    || !jwt.getExpiresAt().isAfter(jwt.getIssuedAt())
                    || (jwt.getNotBefore() != null && jwt.getNotBefore().getEpochSecond() > now)) throw invalid();
            if (jwt.getExpiresAt().getEpochSecond() <= now)
                throw new AuthFailure("토큰이 만료되었습니다.");
            return new Claims(jwt.getSubject(), type, jwt.getExpiresAt().getEpochSecond());
        } catch (AuthFailure e) { throw e; }
        catch (RuntimeException e) { throw invalid(); }
    }
    private boolean blank(String value) { return value == null || value.isBlank(); }
    private AuthFailure invalid() { return new AuthFailure("유효하지 않은 토큰입니다."); }
}
