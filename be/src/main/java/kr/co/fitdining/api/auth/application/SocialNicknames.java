package kr.co.fitdining.api.auth.application;

import java.util.List;
import java.util.concurrent.ThreadLocalRandom;
import java.util.function.Supplier;
import java.util.random.RandomGenerator;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/** Random public names; attempts five through nine add a four-digit suffix. */
@Component
public class SocialNicknames {
    static final List<String> ACTIONS = List.of("산책", "소풍", "탐험", "여행", "구경", "시식", "혼밥", "먹방", "미식", "야식", "간식", "외식", "포장", "주문", "리필", "요리", "수다", "낮잠", "독서", "기록", "발견", "맛집탐방", "메뉴고민", "맛집기록");
    static final List<String> CHARACTERS = List.of("만두", "김밥", "떡볶이", "호떡", "붕어빵", "찐빵", "호빵", "감자", "고구마", "옥수수", "두부", "주먹밥", "계란말이", "마카롱", "크루아상", "베이글", "도넛", "와플", "푸딩", "젤리", "쿠키", "머핀", "라떼", "모찌", "송편", "경단", "버섯", "당근", "토마토", "복숭아", "브로콜리", "아보카도");
    private final Supplier<RandomGenerator> randomSource;

    @Autowired
    public SocialNicknames() { this.randomSource = ThreadLocalRandom::current; }

    public SocialNicknames(RandomGenerator random) { this.randomSource = () -> random; }

    public String next(int attempt) {
        RandomGenerator random = randomSource.get();
        String name = ACTIONS.get(random.nextInt(ACTIONS.size())) + "하는 "
            + CHARACTERS.get(random.nextInt(CHARACTERS.size()));
        return attempt < 5 ? name : name + random.nextInt(1000, 10000);
    }
}
