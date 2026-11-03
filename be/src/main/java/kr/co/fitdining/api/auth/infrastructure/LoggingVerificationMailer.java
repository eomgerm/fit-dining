package kr.co.fitdining.api.auth.infrastructure;

import kr.co.fitdining.api.auth.ports.VerificationMailer;
import lombok.extern.slf4j.Slf4j;

/**
 * 로컬·dev·테스트용 발송기(D6). 메일을 보내지 않고 인증번호를 로그에 남긴다.
 * 인증번호가 로그에 남으므로 prod에서는 기동 검사로 막는다({@link AuthConfiguration}).
 */
@Slf4j
public class LoggingVerificationMailer implements VerificationMailer {
    @Override
    public void sendVerificationCode(String email, String code) {
        log.warn("Verification mail is not sent (logging mailer): code={}", code);
    }
}
