package com.holdem.auth;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.mock.web.MockHttpSession;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.assertj.core.api.Assertions.*;
import com.fasterxml.jackson.databind.ObjectMapper;
@SpringBootTest @AutoConfigureMockMvc @ActiveProfiles("local")
class FriendsIntegrationTest {
    @Autowired MockMvc mvc; @Autowired ObjectMapper json;
    MockHttpSession login(String name)throws Exception{return (MockHttpSession)mvc.perform(post("/api/auth/guest").with(csrf()).contentType("application/json").content("{\"nickname\":\""+name+"\"}")).andExpect(status().isOk()).andReturn().getRequest().getSession();}
    @Test void invitationPreviewIsAnonymousAndContainsOnlyEntryMetadata()throws Exception{
        var host=login("PrivateHost");
        var created=json.readTree(mvc.perform(post("/api/rooms").session(host).with(csrf()).contentType("application/json").content("{\"name\":\"Invite room\",\"password\":\"hidden-password\"}")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        String code=created.get("code").asText();
        String preview=mvc.perform(get("/api/invitations/"+code)).andExpect(status().isOk()).andExpect(jsonPath("$.name").value("Invite room")).andExpect(jsonPath("$.playerCount").value(1)).andExpect(jsonPath("$.passwordRequired").value(true)).andExpect(jsonPath("$.players").doesNotExist()).andExpect(jsonPath("$.cards").doesNotExist()).andReturn().getResponse().getContentAsString();
        assertThat(json.readTree(preview).size()).isEqualTo(8);assertThat(preview).doesNotContain("PrivateHost","hidden-password",created.get("host").asText());
        mvc.perform(get("/api/rooms/"+code)).andExpect(status().isUnauthorized());
    }
    @Test void invitedMemberChoosesRoomNicknameWithoutChangingIdentity()throws Exception{
        var host=login("Host");var guest=login("Session nickname");
        String code=json.readTree(mvc.perform(post("/api/rooms").session(host).with(csrf()).contentType("application/json").content("{\"name\":\"Nickname test\"}")).andReturn().getResponse().getContentAsString()).get("code").asText();
        String identity=json.readTree(mvc.perform(get("/api/auth/me").session(guest)).andReturn().getResponse().getContentAsString()).get("id").asText();
        mvc.perform(post("/api/rooms/"+code+"/join").session(guest).with(csrf()).contentType("application/json").content("{\"nickname\":\"  \"}")).andExpect(status().isBadRequest());
        mvc.perform(post("/api/rooms/"+code+"/join").session(guest).with(csrf()).contentType("application/json").content("{\"nickname\":\"Room nickname\",\"id\":\"fake-user\"}")).andExpect(status().isOk()).andExpect(jsonPath("$.players[1].nickname").value("Room nickname")).andExpect(jsonPath("$.players[1].id").value(identity)).andExpect(jsonPath("$.players[1].stack").value(10000));
    }
    @Test void twoSessionsPlayAndReconnect()throws Exception{
        var a=login("Alice");var b=login("Bob");String body=mvc.perform(post("/api/rooms").session(a).with(csrf()).contentType("application/json").content("{\"name\":\"Friends\",\"buyin\":1000,\"password\":\"secret\"}")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();String code=json.readTree(body).get("code").asText();
        mvc.perform(post("/api/rooms/"+code+"/join").session(b).with(csrf()).contentType("application/json").content("{\"buyin\":1000,\"password\":\"wrong\"}")).andExpect(status().isBadRequest());
        mvc.perform(post("/api/rooms/"+code+"/join").session(b).with(csrf()).contentType("application/json").content("{\"buyin\":1000,\"password\":\"secret\"}")).andExpect(status().isOk());
        for(var s:new MockHttpSession[]{a,b})mvc.perform(post("/api/rooms/"+code+"/ready").session(s).with(csrf()).contentType("application/json").content("{\"ready\":true}")).andExpect(status().isOk());
        mvc.perform(post("/api/rooms/"+code+"/start").session(b).with(csrf())).andExpect(status().isBadRequest());
        var state=json.readTree(mvc.perform(post("/api/rooms/"+code+"/start").session(a).with(csrf())).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        assertThat(state.get("players").get(1).get("cards").size()).isZero();
        String command="{\"commandId\":\""+java.util.UUID.randomUUID()+"\",\"hand\":"+state.get("hand")+",\"version\":"+state.get("version")+",\"action\":\"FOLD\"}";
        for(int i=0;i<2;i++)mvc.perform(post("/api/rooms/"+code+"/actions").session(a).with(csrf()).contentType("application/json").content(command)).andExpect(status().isOk()).andExpect(jsonPath("$.street").value("SETTLED"));
        mvc.perform(get("/api/rooms/"+code).session(b)).andExpect(status().isOk()).andExpect(jsonPath("$.players[1].stack").value(10050));
        mvc.perform(get("/api/rooms/"+code)).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/auth/logout").session(a).with(csrf())).andExpect(status().isNoContent());assertThat(a.isInvalid()).isTrue();
    }
    @Test void loginRequiresCsrfAndRotatesSession()throws Exception{mvc.perform(post("/api/auth/guest").contentType("application/json").content("{\"nickname\":\"Alice\"}")).andExpect(status().isForbidden());var session=new MockHttpSession();String before=session.getId();mvc.perform(post("/api/auth/guest").session(session).with(csrf()).contentType("application/json").content("{\"nickname\":\"Alice\"}")).andExpect(status().isOk());assertThat(session.getId()).isNotEqualTo(before);}
}
