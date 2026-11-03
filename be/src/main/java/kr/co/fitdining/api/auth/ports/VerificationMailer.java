package kr.co.fitdining.api.auth.ports;

/** 인증번호 메일 발송 포트. 업체는 설정으로 바꾸고, 비밀번호 찾기 메일도 같은 포트를 쓸 수 있다. */
public interface VerificationMailer {
    /**
     * 인증번호 메일을 보낸다. 트랜잭션 밖에서 부른다.
     * @param email 정규화한 받는 사람 주소
     * @param code 6자리 인증번호. 본문에는 이 번호 외의 개인정보를 넣지 않는다
     * @throws MailUnavailable 메일 서버 연결·인증·발송이 실패했을 때
     */
    void sendVerificationCode(String email, String code);

    /** 발송 실패. 원인 메시지는 서버 로그에만 남긴다. */
    final class MailUnavailable extends RuntimeException {
        /** @param cause 메일 라이브러리 예외 */
        public MailUnavailable(Throwable cause) { super("Verification mail delivery failed", cause); }
    }
}
