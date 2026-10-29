package com.holdem.system;
import com.holdem.config.SecurityConfig;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MockMvc;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
@WebMvcTest(SystemController.class)
@Import(SecurityConfig.class)
class SystemControllerTest {
    @Autowired MockMvc mvc;
    @Test void capabilitiesAreHonest() throws Exception {
        mvc.perform(get("/api/system")).andExpect(status().isOk()).andExpect(jsonPath("$.multiplayerReady").value(true));
    }
    @Test void privateRoutesRequireSession() throws Exception { mvc.perform(get("/api/rooms")).andExpect(status().isUnauthorized()); }
    @Test void logoutRequiresCsrf() throws Exception { mvc.perform(post("/api/auth/logout")).andExpect(status().isForbidden()); }
    @Test void logoutWithCsrfWorks() throws Exception { mvc.perform(post("/api/auth/logout").with(csrf())).andExpect(status().isNoContent()); }
}
