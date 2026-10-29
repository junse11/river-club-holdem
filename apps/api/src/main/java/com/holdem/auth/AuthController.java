package com.holdem.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.security.Principal;
import java.util.*;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    public record Guest(@NotBlank @Size(min=2,max=20) String nickname) {}
    @PostMapping("/guest")
    public Map<String,String> guest(@Valid @RequestBody Guest input,HttpServletRequest request,HttpServletResponse response) {
        String nickname=input.nickname().strip();
        if(nickname.length()<2||nickname.length()>20)throw new IllegalArgumentException("닉네임은 공백을 제외하고 2~20자입니다");
        if(request.getUserPrincipal()!=null) return me(request.getUserPrincipal(),request);
        String id=UUID.randomUUID().toString();request.getSession();request.changeSessionId();
        var auth=new UsernamePasswordAuthenticationToken(id,null,List.of(new SimpleGrantedAuthority("ROLE_PLAYER")));
        var context=SecurityContextHolder.createEmptyContext();context.setAuthentication(auth);SecurityContextHolder.setContext(context);
        new HttpSessionSecurityContextRepository().saveContext(context,request,response);
        request.getSession().setAttribute("nickname",nickname);
        return Map.of("id",id,"nickname",nickname);
    }
    @GetMapping("/me")
    public Map<String,String> me(Principal principal,HttpServletRequest request) {
        return Map.of("id",principal.getName(),"nickname",String.valueOf(request.getSession().getAttribute("nickname")));
    }
}
