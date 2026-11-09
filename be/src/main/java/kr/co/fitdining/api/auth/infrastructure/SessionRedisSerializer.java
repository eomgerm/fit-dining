package kr.co.fitdining.api.auth.infrastructure;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.Map;
import org.springframework.data.redis.serializer.JacksonJsonRedisSerializer;
import org.springframework.data.redis.serializer.RedisSerializer;
import org.springframework.data.redis.serializer.SerializationException;
import tools.jackson.databind.json.JsonMapper;

/** JSON values shared by all instances reading the same session namespace. */
final class SessionRedisSerializer implements RedisSerializer<Object> {
    private final JsonMapper mapper;
    private final RedisSerializer<Object> delegate;

    SessionRedisSerializer(JsonMapper mapper) {
        this.mapper = mapper;
        this.delegate = new JacksonJsonRedisSerializer<>(mapper, Object.class);
    }

    @Override
    public byte[] serialize(Object value) {
        // Preserve numeric types explicitly: Security default typing loses small Long values.
        // This also preserves Spring Session metadata (Long creation/last-access times and
        // Integer maxInactiveInterval), rather than coercing every JSON number into Long.
        // The envelope is a closed numeric type list, never an arbitrary class-name loader.
        if (value instanceof Number number) {
            String type = number.getClass().getSimpleName();
            decodeNumber(type, number.toString()); // Reject unsupported Number implementations.
            return mapper.writeValueAsBytes(Map.of("fitdiningNumberType", type, "value", number.toString()));
        }
        return delegate.serialize(value);
    }

    @Override
    public Object deserialize(byte[] bytes) {
        if (bytes == null || bytes.length == 0) return null;
        var json = mapper.readTree(bytes);
        if (json.isObject() && json.has("fitdiningNumberType")) {
            return decodeNumber(json.get("fitdiningNumberType").asText(), json.get("value").asText());
        }
        return delegate.deserialize(bytes);
    }

    private static Number decodeNumber(String type, String value) {
        return switch (type) {
            case "Long" -> Long.valueOf(value);
            case "Integer" -> Integer.valueOf(value);
            case "Short" -> Short.valueOf(value);
            case "Byte" -> Byte.valueOf(value);
            case "Double" -> Double.valueOf(value);
            case "Float" -> Float.valueOf(value);
            case "BigInteger" -> new BigInteger(value);
            case "BigDecimal" -> new BigDecimal(value);
            default -> throw new SerializationException("Unsupported session number type: " + type);
        };
    }
}
