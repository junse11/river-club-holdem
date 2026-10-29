package com.holdem.room;

import java.util.Map;
import org.springframework.web.bind.annotation.*;

/** Code holders may view only room entry metadata; no player identity, stack or cards. */
@RestController
public class InvitationController {
    private final RoomService rooms;
    public InvitationController(RoomService rooms) { this.rooms=rooms; }
    @GetMapping("/api/invitations/{code}")
    public Map<String,Object> preview(@PathVariable String code) { return rooms.invitation(code); }
}
