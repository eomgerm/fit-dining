package kr.co.fitdining.api.onboarding;

import java.time.Clock;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import jakarta.annotation.PreDestroy;
import kr.co.fitdining.api.user.Preferences.TasteChip;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.stereotype.Service;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Bounded analyzer execution and per-peer fixed-window throttling; no taste content is retained. */
@Service @ConditionalOnWebApplication
public class TasteAnalysisService {
    private final TasteAnalyzer analyzer;
    private final Clock clock;
    private final long timeoutMs;
    private final Map<String, Window> windows = new HashMap<>();
    private final ExecutorService executor = new ThreadPoolExecutor(4, 4, 0, TimeUnit.MILLISECONDS,
            new ArrayBlockingQueue<>(16), runnable -> {
                Thread thread = new Thread(runnable, "taste-analyzer"); thread.setDaemon(true); return thread;
            });
    public TasteAnalysisService(TasteAnalyzer analyzer, Clock clock,
            @Value("${fitdining.onboarding.timeout-ms:3000}") long timeoutMs) {
        if (timeoutMs < 1) throw new IllegalArgumentException("Positive analyzer timeout required");
        this.analyzer = analyzer; this.clock = clock; this.timeoutMs = timeoutMs;
    }
    public List<TasteChip> analyze(String text, String address) {
        recordAttempt(address);
        Future<List<TasteChip>> task;
        try { task = executor.submit(() -> analyzer.analyze(text)); }
        catch (RejectedExecutionException rejected) { throw unavailable(); }
        try { return task.get(timeoutMs, TimeUnit.MILLISECONDS); }
        catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt(); throw unavailable();
        } catch (ExecutionException | TimeoutException failure) { throw unavailable(); }
        finally { task.cancel(true); }
    }
    private synchronized void recordAttempt(String address) {
        Instant now = clock.instant();
        windows.values().removeIf(window -> !window.start().plusSeconds(900).isAfter(now));
        Window window = windows.get(address);
        if (window == null) {
            if (windows.size() >= 10000) throw limited();
            windows.put(address, new Window(now, 1));
        } else {
            if (window.count() >= 30) throw limited();
            windows.put(address, new Window(window.start(), window.count() + 1));
        }
    }
    private static ResponseStatusException limited() {
        return new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "잠시 후 다시 시도해주세요.");
    }
    private static ResponseStatusException unavailable() {
        return new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "취향 분석을 사용할 수 없습니다.");
    }
    @PreDestroy public void close() { executor.shutdownNow(); }
    private record Window(Instant start, int count) {}
}
