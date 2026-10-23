package kr.co.fitdining.api.auth.domain;

import java.net.URI;

/** Stable ProblemDetail types distinguish account uniqueness conflicts. */
public final class SignupConflict extends AuthFailure {
    public SignupConflict(String field) {
        super("이미 사용 중인 계정 정보입니다.", 409, URI.create("urn:fitdining:auth:" + field + "-taken"));
    }
}
