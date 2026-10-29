package com.holdem.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.*;
import org.springframework.messaging.simp.config.*;
import org.springframework.messaging.simp.stomp.*;
import org.springframework.messaging.support.*;
import org.springframework.web.socket.config.annotation.*;

@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {
    public void registerStompEndpoints(StompEndpointRegistry registry){registry.addEndpoint("/ws").setAllowedOriginPatterns("*");}
    public void configureMessageBroker(MessageBrokerRegistry registry){registry.enableSimpleBroker("/queue");registry.setUserDestinationPrefix("/user");}
    public void configureClientInboundChannel(ChannelRegistration registration){registration.interceptors(new ChannelInterceptor(){
        @Override public Message<?> preSend(Message<?> message,MessageChannel channel){
            var h=MessageHeaderAccessor.getAccessor(message,StompHeaderAccessor.class);
            if(h!=null){if(h.getUser()==null)throw new IllegalArgumentException("로그인이 필요합니다");if(h.getCommand()==StompCommand.SEND)throw new IllegalArgumentException("액션은 CSRF 보호 API를 사용해주세요");if(h.getCommand()==StompCommand.SUBSCRIBE&&!"/user/queue/updates".equals(h.getDestination()))throw new IllegalArgumentException("허용되지 않은 구독");}
            return message;
        }
    });}
}
