package com.holdem.system;
import java.util.Map;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
@RestController
public class SystemController {
    @GetMapping("/api/system")
    public Map<String, Object> system() {
        return Map.of("name", "Holdem", "phase", "friends-mvp", "multiplayerReady", true, "bountyMode", true, "stateStorage", "in-memory-single-process");
    }
    @GetMapping("/api/auth/csrf")
    public Map<String, String> csrf(CsrfToken token) {
        return Map.of("headerName", token.getHeaderName(), "token", token.getToken());
    }
}
