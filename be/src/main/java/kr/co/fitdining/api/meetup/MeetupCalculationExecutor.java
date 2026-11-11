package kr.co.fitdining.api.meetup;

import jakarta.annotation.PreDestroy;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import kr.co.fitdining.api.meetup.domain.MeetupLimits;
import org.springframework.stereotype.Component;

/** 추천 계산의 작업 스레드(D-10). 취향 분석과 같은 방식으로 직접 만든 스레드 풀이다. */
@Component
class MeetupCalculationExecutor {

	private final ThreadPoolExecutor executor = new ThreadPoolExecutor(MeetupLimits.CALCULATION_THREADS,
			MeetupLimits.CALCULATION_THREADS, 0, TimeUnit.MILLISECONDS,
			new ArrayBlockingQueue<>(MeetupLimits.CALCULATION_QUEUE), runnable -> {
				Thread thread = new Thread(runnable, "meetup-calculation");
				thread.setDaemon(true);
				return thread;
			});

	/** @throws RejectedExecutionException 대기열이 찼을 때 */
	void execute(Runnable task) {
		executor.execute(task);
	}

	@PreDestroy
	void close() {
		executor.shutdownNow();
	}

}
