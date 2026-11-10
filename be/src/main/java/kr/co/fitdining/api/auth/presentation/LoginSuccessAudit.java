package kr.co.fitdining.api.auth.presentation;

import lombok.extern.slf4j.Slf4j;

/** A completed session login remains successful if its audit write fails. */
@Slf4j
final class LoginSuccessAudit {
    private LoginSuccessAudit() {}

    static void record(Runnable audit) {
        try { audit.run(); }
        catch (RuntimeException failure) {
            // Exception messages and stack traces can contain credentials or session identifiers.
            log.warn("Login success audit failed: reason={}", failure.getClass().getSimpleName());
        }
    }
}
