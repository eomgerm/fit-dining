package kr.co.fitdining.api.auth.presentation;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import java.lang.annotation.ElementType;
import java.nio.charset.StandardCharsets;

/** Normalized signup field rules, also used by demo configuration. */
@Target({ElementType.FIELD, ElementType.PARAMETER, ElementType.RECORD_COMPONENT})
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = SignupValue.Validator.class)
public @interface SignupValue {
    String value();
    String message() default "입력 형식을 확인해 주세요.";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};

    final class Validator implements ConstraintValidator<SignupValue, String> {
        private String field;
        @Override public void initialize(SignupValue rule) { field = rule.value(); }
        @Override public boolean isValid(String value, ConstraintValidatorContext context) {
            return valid(field, value);
        }
        public static boolean valid(String field, String value) {
            if (value == null) return false;
            return switch (field) {
                case "email" -> value.length() <= 254 && value.matches("(?U)[^\\s@]+@[^\\s@.]+(?:\\.[^\\s@.]+)+");
                case "password" -> value.codePointCount(0, value.length()) >= 8
                        && value.getBytes(StandardCharsets.UTF_8).length <= 72
                        && value.matches("(?s).*[a-zA-Z].*") && value.matches("(?s).*[0-9].*");
                case "nickname" -> value.codePointCount(0, value.length()) >= 2
                        && value.codePointCount(0, value.length()) <= 15
                        && value.codePoints().noneMatch(Character::isISOControl);
                default -> false;
            };
        }
    }
}
