package kr.co.fitdining.api.auth.infrastructure;

import jakarta.mail.internet.InternetAddress;
import java.nio.charset.StandardCharsets;
import kr.co.fitdining.api.auth.ports.VerificationMailer;
import org.springframework.mail.MailException;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;

/** SMTP(기본 Gmail)로 인증번호 메일을 보낸다. 연결값은 spring.mail.*에서 온다. */
public class SmtpVerificationMailer implements VerificationMailer {
    static final String SUBJECT = "[핏다이닝] 이메일 인증번호";
    private final JavaMailSender sender;
    private final String from;
    private final String fromName;

    /**
     * @param sender Spring이 만든 SMTP 발송기
     * @param from 보내는 주소(auth.mail.from)
     * @param fromName 보내는 사람 표시 이름
     */
    public SmtpVerificationMailer(JavaMailSender sender, String from, String fromName) {
        this.sender = sender;
        this.from = from;
        this.fromName = fromName;
    }

    @Override
    public void sendVerificationCode(String email, String code) {
        try {
            var message = sender.createMimeMessage();
            var helper = new MimeMessageHelper(message, true, StandardCharsets.UTF_8.name());
            helper.setFrom(new InternetAddress(from, fromName, StandardCharsets.UTF_8.name()));
            helper.setTo(email);
            helper.setSubject(SUBJECT);
            helper.setText(text(code), html(code));
            sender.send(message);
        } catch (MailException | jakarta.mail.MessagingException | java.io.UnsupportedEncodingException failure) {
            throw new MailUnavailable(failure);
        }
    }

    static String text(String code) {
        return """
                핏다이닝 이메일 인증번호는 %s 입니다.
                인증 화면에 10분 안에 입력해 주세요.
                요청하지 않았다면 이 메일을 무시해 주세요.
                """.formatted(code);
    }

    static String html(String code) {
        return """
                <p>핏다이닝 이메일 인증번호입니다.</p>
                <p style="font-size:24px;font-weight:bold;letter-spacing:4px">%s</p>
                <p>인증 화면에 10분 안에 입력해 주세요.<br>요청하지 않았다면 이 메일을 무시해 주세요.</p>
                """.formatted(code);
    }
}
