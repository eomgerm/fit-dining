package kr.co.fitdining.api;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Import;
import kr.co.fitdining.api.auth.infrastructure.SecurityConfiguration;

@SpringBootApplication
// Explicit imports also apply to MVC slices, which filter out ordinary configurations.
@Import(SecurityConfiguration.class)
public class ApiApplication {

	public static void main(String[] args) {
		SpringApplication.run(ApiApplication.class, args);
	}

}
