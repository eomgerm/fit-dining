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
        var claims = JwtClaimsSet.builder().issuer(ISSUER).audience(List.of(AUDIENCE))
                .subject(token.userId()).id(token.jti()).claim("sid", token.sessionId())
                .claim("username", token.username()).claim("family_exp", token.sessionExpiresAt())
                .claim("token_type", token.type()).issuedAt(Instant.ofEpochSecond(token.createdAt()))
                .expiresAt(Instant.ofEpochSecond(token.expiresAt())).build();
        return encoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims)).getTokenValue();
    }
    @Override public Claims decode(String value, String expectedType) {
        if (value == null || value.isBlank() || value.length() > 8192) throw invalid();
        try {
            Jwt jwt = decoder.decode(value);
            String sid = jwt.getClaimAsString("sid");
            String type = jwt.getClaimAsString("token_type");
            String username = jwt.getClaimAsString("username");
            Number familyExpiry = jwt.getClaim("family_exp");
            long now = clock.instant().getEpochSecond();
            if (blank(username) || familyExpiry == null || !expectedType.equals(type) || blank(jwt.getSubject()) || blank(jwt.getId()) || blank(sid)
                    || jwt.getIssuedAt() == null || jwt.getExpiresAt() == null
                    || jwt.getIssuedAt().getEpochSecond() > now
                    || !jwt.getExpiresAt().isAfter(jwt.getIssuedAt())
                    || familyExpiry.longValue() < jwt.getExpiresAt().getEpochSecond()
                    || (jwt.getNotBefore() != null && jwt.getNotBefore().getEpochSecond() > now)) throw invalid();
            if (jwt.getExpiresAt().getEpochSecond() <= now)
                throw expectedType.equals("access") ? AuthFailure.accessExpired() : new AuthFailure("토큰이 만료되었습니다.");
            return new Claims(jwt.getSubject(), username, sid, jwt.getId(), type,
                    jwt.getExpiresAt().getEpochSecond(), familyExpiry.longValue());
        } catch (AuthFailure e) { throw e; }
        catch (RuntimeException e) { throw invalid(); }
    }
    private boolean blank(String value) { return value == null || value.isBlank(); }
    private AuthFailure invalid() { return new AuthFailure("유효하지 않은 토큰입니다."); }
}
