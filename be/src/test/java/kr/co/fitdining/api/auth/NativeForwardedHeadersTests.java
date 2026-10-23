package kr.co.fitdining.api.auth;

import static org.junit.jupiter.api.Assertions.*;

import java.util.concurrent.atomic.AtomicReference;
import org.apache.catalina.connector.Connector;
import org.apache.catalina.connector.Request;
import org.apache.catalina.connector.Response;
import org.apache.catalina.valves.RemoteIpValve;
import org.apache.catalina.valves.ValveBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.web.WebProperties;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.boot.tomcat.autoconfigure.TomcatServerProperties;
import org.springframework.boot.tomcat.autoconfigure.TomcatWebServerFactoryCustomizer;
import org.springframework.boot.tomcat.servlet.TomcatServletWebServerFactory;
import org.springframework.boot.web.server.autoconfigure.ServerProperties;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.core.io.ClassPathResource;

/** Exercises the native valve configured by application.yml without starting a server. */
class NativeForwardedHeadersTests {
    private static TomcatServletWebServerFactory configuredFactory(int port) throws Exception {
        var environment = new StandardEnvironment();
        for (var source : new YamlPropertySourceLoader().load("application", new ClassPathResource("application.yml"))) {
            environment.getPropertySources().addLast(source);
        }
        var server = Binder.get(environment).bind("server", ServerProperties.class).get();
        assertEquals(ServerProperties.ForwardHeadersStrategy.NATIVE, server.getForwardHeadersStrategy());
        var tomcat = new TomcatServerProperties();
        // No internal-proxies override: use the defaults of the installed Boot/Tomcat version.
        assertNull(environment.getProperty("server.tomcat.remoteip.internal-proxies"));
        var factory = new TomcatServletWebServerFactory(port);
        new TomcatWebServerFactoryCustomizer(environment, server, tomcat, new WebProperties()).customize(factory);
        assertEquals(port, factory.getPort());
        return factory;
    }

    static ForwardedRequest resolve(String peer, String forwardedFor, String proto, int port) throws Exception {
        var factory = configuredFactory(port);
        var valve = factory.getEngineValves().stream().filter(RemoteIpValve.class::isInstance)
                .map(RemoteIpValve.class::cast).findFirst().orElseThrow();
        var result = new AtomicReference<ForwardedRequest>();
        valve.setNext(new ValveBase() {
            @Override public void invoke(Request request, Response response) {
                result.set(new ForwardedRequest(request.getRemoteAddr(), request.isSecure(), request.getScheme(),
                        request.getServerPort(), request.getLocalPort()));
            }
        });
        var coyote = new org.apache.coyote.Request();
        coyote.scheme().setString("http");
        coyote.serverName().setString("localhost");
        coyote.setServerPort(port);
        coyote.method().setString("POST");
        coyote.requestURI().setString("/api/auth/login");
        if (forwardedFor != null) coyote.getMimeHeaders().setValue("X-Forwarded-For").setString(forwardedFor);
        if (proto != null) coyote.getMimeHeaders().setValue("X-Forwarded-Proto").setString(proto);
        var request = new Request(new Connector(), coyote);
        request.setRemoteAddr(peer);
        request.setRemoteHost(peer);
        request.setLocalPort(port);
        valve.invoke(request, new Response(new org.apache.coyote.Response()));
        return result.get();
    }

    @Test @DisplayName("전달 헤더_신뢰 대역 프록시_사용자 주소와 HTTPS 적용")
    void forwarding_internalProxy_usesClientAddressAndProtocol() throws Exception {
        var result = resolve("172.18.0.5", "203.0.113.10", "https", 8080);
        assertEquals("203.0.113.10", result.address());
        assertTrue(result.secure());
        assertEquals("https", result.scheme());
        assertEquals(443, result.serverPort());
        assertEquals(8080, result.localPort());
    }

    @Test @DisplayName("전달 헤더_비신뢰 연결_위조 주소와 프로토콜 무시")
    void forwarding_externalPeer_ignoresSpoofedHeaders() throws Exception {
        var result = resolve("198.51.100.7", "203.0.113.10", "https", 8080);
        assertEquals("198.51.100.7", result.address());
        assertFalse(result.secure());
        assertEquals("http", result.scheme());
        assertEquals(8080, result.serverPort());
    }

    @Test @DisplayName("전달 헤더_관리 포트 직접 요청_8081과 기존 연결 정보 유지")
    void forwarding_directManagementRequest_preservesPortAndPeer() throws Exception {
        var result = resolve("127.0.0.1", null, null, 8081);
        assertEquals("127.0.0.1", result.address());
        assertFalse(result.secure());
        assertEquals("http", result.scheme());
        assertEquals(8081, result.serverPort());
        assertEquals(8081, result.localPort());
    }

    /**
     * @param address controller-visible remote address
     * @param secure controller-visible secure flag
     * @param scheme controller-visible scheme
     * @param serverPort forwarded logical port
     * @param localPort unchanged connector port
     */
    record ForwardedRequest(String address, boolean secure, String scheme, int serverPort, int localPort) {}
}
