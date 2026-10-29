package com.holdem.room;

import com.holdem.game.PokerTable;
import java.security.SecureRandom;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;

@Service
public class RoomService {
    private final Map<String,PokerTable> tables=new ConcurrentHashMap<>();
    private final Map<String,String> passwords=new ConcurrentHashMap<>();
    private final Map<String,String> membership=new ConcurrentHashMap<>();
    private final Map<String,Long> lastSeen=new ConcurrentHashMap<>();
    public void touch(String id){lastSeen.put(id,System.currentTimeMillis());}
    private final BCryptPasswordEncoder encoder=new BCryptPasswordEncoder();
    private final SecureRandom random=new SecureRandom();
    private final SimpMessagingTemplate events;
    public RoomService(SimpMessagingTemplate events){this.events=events;}
    public synchronized PokerTable create(String user,String nickname,String name,String password){
        PokerTable.require(!membership.containsKey(user),"기존 방에서 먼저 나가주세요");String code;do{StringBuilder s=new StringBuilder();for(int i=0;i<8;i++)s.append("ABCDEFGHJKLMNPQRSTUVWXYZ23456789".charAt(random.nextInt(32)));code=s.toString();}while(tables.containsKey(code));
        if(password!=null)PokerTable.require(password.getBytes(java.nio.charset.StandardCharsets.UTF_8).length<=72,"비밀번호는 UTF-8 72바이트 이하여야 합니다");
        PokerTable table=new PokerTable(code,name,user);table.join(user,nickname,100*table.bb);tables.put(code,table);if(password!=null&&!password.isEmpty())passwords.put(code,encoder.encode(password));membership.put(user,code);touch(user);return table;
    }
    public PokerTable get(String code){PokerTable t=tables.get(code.toUpperCase(Locale.ROOT));if(t==null)throw new IllegalArgumentException("방 코드를 확인해주세요");return t;}
    public Map<String,Object> invitation(String code){PokerTable t=get(code);synchronized(t){return Map.of("code",t.code,"name",t.name,"playerCount",t.players.size(),"capacity",6,"sb",t.sb,"bb",t.bb,"passwordRequired",passwords.containsKey(t.code),"running",t.running());}}
    public synchronized PokerTable join(String code,String id,String nickname,String password){PokerTable t=get(code);PokerTable.require(!membership.containsKey(id)||membership.get(id).equals(t.code),"기존 방에서 먼저 나가주세요");synchronized(t){if(t.players.stream().noneMatch(p->p.id.equals(id))&&passwords.containsKey(t.code))PokerTable.require(encoder.matches(password==null?"":password,passwords.get(t.code)),"방 코드 또는 비밀번호를 확인해주세요");t.join(id,nickname,100*t.bb);membership.put(id,t.code);touch(id);notify(t);return t;}}
    public void notify(PokerTable table){for(PokerTable.Player p:table.players)events.convertAndSendToUser(p.id,"/queue/updates",Map.of("code",table.code,"version",table.version));}
    public synchronized void leave(PokerTable t,String id){synchronized(t){t.leave(id);if(t.players.stream().noneMatch(p->p.id.equals(id)))membership.remove(id,t.code);notify(t);}}
    @Scheduled(fixedDelay=1000)
    public void tick(){for(PokerTable t:tables.values())synchronized(t){long before=t.version;long now=System.currentTimeMillis();for(var p:new ArrayList<>(t.players))if(!p.leaving&&now-lastSeen.getOrDefault(p.id,now)>90000){t.leave(p.id);t.version++;}t.tick(now);membership.entrySet().removeIf(e->e.getValue().equals(t.code)&&t.players.stream().noneMatch(p->p.id.equals(e.getKey())));if(before!=t.version)notify(t);if(t.players.isEmpty()){tables.remove(t.code,t);passwords.remove(t.code);}}}
}
