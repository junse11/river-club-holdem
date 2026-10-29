package com.holdem.room;

import com.holdem.game.PokerTable;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.security.Principal;
import java.util.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/rooms")
public class RoomController {
    private final RoomService rooms;
    // Bounded command receipts per room, protected by that room's monitor.
    private final Map<String,LinkedHashMap<String,String>> receipts=new java.util.concurrent.ConcurrentHashMap<>();
    public RoomController(RoomService rooms){this.rooms=rooms;}
    public record Create(@NotBlank @Size(max=40) String name,@Size(max=60) String password){}
    public record Join(@Size(max=60) String password,@Size(min=2,max=20) String nickname){}
    public record Ready(boolean ready){}
    public record Showdown(boolean showdown){}
    public record Chat(@NotBlank @Size(max=120) String text){}
    public record Blinds(@Min(1) @Max(5000) long sb,@Min(2) @Max(10000) long bb){}
    public record Action(@NotNull UUID commandId,long hand,long version,@NotBlank String action,Long amountTo){}
    @PostMapping public Map<String,Object> create(@Valid @RequestBody Create input,Principal p,HttpServletRequest request){PokerTable t=rooms.create(p.getName(),nickname(request),input.name(),input.password());synchronized(t){return t.view(p.getName());}}
    @PostMapping("/{code}/join") public Map<String,Object> join(@PathVariable String code,@Valid @RequestBody Join input,Principal p,HttpServletRequest request){String chosen=input.nickname()==null?nickname(request):input.nickname().strip();PokerTable.require(chosen.length()>=2&&chosen.length()<=20,"닉네임은 2~20자입니다");PokerTable t=rooms.join(code,p.getName(),chosen,input.password());synchronized(t){return t.view(p.getName());}}
    @GetMapping("/{code}") public Map<String,Object> view(@PathVariable String code,Principal p){PokerTable t=rooms.get(code);synchronized(t){t.member(p.getName());rooms.touch(p.getName());return t.view(p.getName());}}
    @PostMapping("/{code}/ready") public Map<String,Object> ready(@PathVariable String code,@RequestBody Ready input,Principal p){PokerTable t=rooms.get(code);synchronized(t){PokerTable.require(!t.running(),"핸드 중에는 준비를 변경할 수 없습니다");t.member(p.getName()).ready=input.ready();t.version++;rooms.notify(t);return t.view(p.getName());}}
    @PostMapping("/{code}/showdown") public Map<String,Object> showdown(@PathVariable String code,@RequestBody Showdown input,Principal p){PokerTable t=rooms.get(code);synchronized(t){t.showdown(p.getName(),input.showdown());rooms.notify(t);return t.view(p.getName());}}
    @PostMapping("/{code}/chat") public Map<String,Object> chat(@PathVariable String code,@Valid @RequestBody Chat input,Principal p){PokerTable t=rooms.get(code);synchronized(t){t.chat(p.getName(),input.text());rooms.notify(t);return t.view(p.getName());}}
    @PostMapping("/{code}/start") public Map<String,Object> start(@PathVariable String code,Principal p){PokerTable t=rooms.get(code);synchronized(t){t.start(p.getName());rooms.notify(t);return t.view(p.getName());}}
    @PostMapping("/{code}/blinds") public Map<String,Object> blinds(@PathVariable String code,@Valid @RequestBody Blinds input,Principal p){PokerTable t=rooms.get(code);synchronized(t){t.blinds(p.getName(),input.sb(),input.bb());rooms.notify(t);return t.view(p.getName());}}
    @PostMapping("/{code}/actions") public Map<String,Object> action(@PathVariable String code,@Valid @RequestBody Action input,Principal p){PokerTable t=rooms.get(code);synchronized(t){t.member(p.getName());var seen=receipts.computeIfAbsent(t.code,k->new LinkedHashMap<>());String key=p.getName()+input.commandId(),payload=input.toString();if(seen.containsKey(key)){PokerTable.require(seen.get(key).equals(payload),"중복 명령 ID의 내용이 다릅니다");return t.view(p.getName());}t.action(p.getName(),input.action(),input.amountTo(),input.version(),input.hand());seen.put(key,payload);if(seen.size()>1000)seen.remove(seen.keySet().iterator().next());rooms.notify(t);return t.view(p.getName());}}
    @PostMapping("/{code}/leave") public void leave(@PathVariable String code,Principal p){rooms.leave(rooms.get(code),p.getName());}
    @GetMapping("/{code}/history") public Object history(@PathVariable String code,Principal p){PokerTable t=rooms.get(code);synchronized(t){t.member(p.getName());return List.copyOf(t.history);}}
    private String nickname(HttpServletRequest request){return String.valueOf(request.getSession().getAttribute("nickname"));}
}
