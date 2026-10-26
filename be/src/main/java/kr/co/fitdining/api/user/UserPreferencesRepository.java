package kr.co.fitdining.api.user;

import org.springframework.data.jpa.repository.JpaRepository;

/** Account-owned onboarding answers. */
public interface UserPreferencesRepository extends JpaRepository<UserPreferences, String> {}
