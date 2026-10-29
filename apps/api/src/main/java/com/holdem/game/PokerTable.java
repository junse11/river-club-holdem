package com.holdem.game;

import java.security.SecureRandom;
import java.util.*;

/** Server-only aggregate. Caller serializes all access on this table's monitor. */
public class PokerTable {
    public static final class Player {
        public final String id, nickname; public final int seat;
        public long stack, bet, committed, bountyUnits, lastActedAt=-1;
        public boolean ready, folded, inHand, leaving, showdown;
        public String position="WAIT";
        public final List<String> cards=new ArrayList<>();
        public Player(String id,String nickname,int seat,long stack) { this.id=id;this.nickname=nickname;this.seat=seat;this.stack=stack; }
    }
    public final String code, name;
    public String host;
    public final List<Player> players=new ArrayList<>();
    public final List<String> board=new ArrayList<>();
    public final List<Map<String,Object>> log=new ArrayList<>(), history=new ArrayList<>();
    private final Deque<String> deck=new ArrayDeque<>();
    private final Set<String> pending=new HashSet<>();
    private long bankroll;
    public long sb=50,bb=100,currentBet=0,lastRaise=100,version=0,hand=0,deadline=0,nextHandAt=0;
    public Long pendingSb, pendingBb;
    public int button=-1, actor=-1;
    public String street="WAITING", result="";
    // 60 exact units per knockout: ties among up to five opponents divide exactly.
    public static final long BOUNTY_UNITS = 60;
    public boolean resetPending=false;
    public List<Map<String,Object>> bountyAwards=List.of();
    public PokerTable(String code,String name,String host) { this.code=code;this.name=name;this.host=host; }
    public Player member(String id) { return players.stream().filter(p->p.id.equals(id)).findFirst().orElseThrow(()->new IllegalArgumentException("방에 참여하지 않았습니다")); }
    public boolean running() { return !street.equals("WAITING")&&!street.equals("SETTLED"); }
    public void join(String id,String nickname,long buyin) {
        if(players.stream().anyMatch(p->p.id.equals(id))) return;
        require(players.size()<6,"방이 가득 찼습니다"); require(buyin>=1&&buyin<=1_000_000,"바이인은 1~1,000,000입니다");
        int seat=0; Set<Integer> used=new HashSet<>();players.forEach(p->used.add(p.seat));while(used.contains(seat)) seat++;
        players.add(new Player(id,nickname,seat,buyin)); players.sort(Comparator.comparingInt(p->p.seat));bankroll+=buyin;version++;
    }
    public void blinds(String id,long small,long big) { require(host.equals(id),"방장만 변경할 수 있습니다");require(small>0&&big>=2*small&&big<=10_000,"BB는 최대 10,000이며 SB의 두 배 이상이어야 합니다");if(running()){pendingSb=small;pendingBb=big;}else{sb=small;bb=big;} version++; }
    public void start(String id) { require(host.equals(id),"방장만 시작할 수 있습니다");require(!running(),"이미 게임 중입니다");require(players.stream().filter(p->!p.leaving&&(p.stack>0||resetPending)).count()>=2,"두 명 이상 필요합니다");require(players.stream().filter(p->!p.leaving&&(p.stack>0||resetPending)).allMatch(p->p.ready),"모두 준비해주세요");begin(); }
    public void begin() {
        require(!running(),"이미 게임 중입니다");
        require(players.stream().filter(p->!p.leaving&&p.ready&&(p.stack>0||resetPending)).count()>=2,"두 명 이상 필요합니다");
        if(pendingSb!=null){sb=pendingSb;bb=pendingBb;pendingSb=null;pendingBb=null;}
        if(resetPending){invariant();for(Player p:players)p.stack=100*bb;bankroll=players.stream().mapToLong(p->p.stack).sum();resetPending=false;}
        List<Player> active=players.stream().filter(p->!p.leaving&&p.ready&&p.stack>0).toList();
        hand++;board.clear();log.clear();bountyAwards=List.of();result="";currentBet=0;lastRaise=bb;pending.clear();nextHandAt=0;
        for(Player p:players){p.inHand=active.contains(p);p.folded=!p.inHand;p.showdown=false;p.bet=0;p.committed=0;p.lastActedAt=-1;p.cards.clear();}
        button=nextSeat(button,p->p.inHand);assignPositions(); List<String> shuffled=new ArrayList<>();for(String suit:List.of("C","D","H","S"))for(int r=2;r<=14;r++)shuffled.add(r+suit);
        Collections.shuffle(shuffled,new SecureRandom());deck.clear();deck.addAll(shuffled);
        for(int i=0;i<2;i++)for(Player p:active)p.cards.add(deck.removeFirst());
        int small=active.size()==2?button:nextSeat(button,p->p.inHand), big=nextSeat(small,p->p.inHand);
        pay(at(small),Math.min(sb,at(small).stack));pay(at(big),Math.min(bb,at(big).stack));currentBet=bb;street="PREFLOP";
        players.stream().filter(this::canAct).forEach(p->pending.add(p.id));actor=nextSeat(big,p->pending.contains(p.id));version++;advanceIfDone();setDeadline();invariant();
    }
    private Player at(int seat){return players.stream().filter(p->p.seat==seat).findFirst().orElseThrow();}
    private int nextSeat(int seat,java.util.function.Predicate<Player> filter){ for(int i=1;i<=6;i++){int n=(seat+i)%6;for(Player p:players)if(p.seat==n&&filter.test(p))return n;}return -1; }
    private boolean canAct(Player p){return p.inHand&&!p.folded&&p.stack>0;}
    private void pay(Player p,long delta){require(delta>=0&&delta<=p.stack,"잔여 칩 부족");p.stack-=delta;p.bet+=delta;p.committed+=delta;}
    public List<String> allowed(String id){Player p=member(id);if(!running()||actor!=p.seat)return List.of();List<String>a=new ArrayList<>(List.of("FOLD"));a.add(p.bet>=currentBet?"CHECK":"CALL");boolean opponentCanAct=players.stream().filter(this::canAct).count()>1;if(p.stack>0&&(p.stack+p.bet<=currentBet||(mayRaise(p)&&opponentCanAct)))a.add("ALL_IN");if(p.stack+p.bet>currentBet&&mayRaise(p)&&opponentCanAct)a.add(currentBet==0?"BET":"RAISE");return a;}
    private boolean mayRaise(Player p){return p.lastActedAt<=0||currentBet-p.lastActedAt>=lastRaise;}
    public void action(String id,String action,Long amount,long expectedVersion,long expectedHand){
        require(version==expectedVersion&&hand==expectedHand,"상태가 변경되었습니다. 다시 시도해주세요");Player p=member(id);require(running()&&p.seat==actor,"본인 차례가 아닙니다");require(allowed(id).contains(action),"허용되지 않은 액션입니다");
        long target=p.bet;
        switch(action){
            case "FOLD" -> p.folded=true;
            case "CHECK" -> require(p.bet>=currentBet,"체크할 수 없습니다");
            case "CALL" -> target=Math.min(currentBet,p.bet+p.stack);
            case "ALL_IN" -> target=p.bet+p.stack;
            case "BET","RAISE" -> {require(amount!=null,"금액을 입력해주세요");target=amount;require(target>currentBet,"현재 베팅보다 커야 합니다");require(target>=currentBet+lastRaise,"최소 레이즈 금액 미달");}
            default -> throw new IllegalArgumentException("잘못된 액션");
        }
        require(target>=p.bet&&target<=p.bet+p.stack,"베팅 금액 범위 오류");
        if(target>currentBet){require(mayRaise(p),"레이즈가 다시 열리지 않았습니다");long raise=target-currentBet;if(raise>=lastRaise)lastRaise=raise;currentBet=target;players.stream().filter(this::canAct).filter(other->other!=p).forEach(other->pending.add(other.id));}
        pay(p,target-p.bet);p.lastActedAt=currentBet;pending.remove(id);log.add(Map.of("nickname",p.nickname,"action",action,"amountTo",target,"street",street));version++;actor=nextSeat(p.seat,q->pending.contains(q.id)&&canAct(q));advanceIfDone();setDeadline();invariant();
    }
    private void advanceIfDone(){
        List<Player> alive=players.stream().filter(p->p.inHand&&!p.folded).toList();if(alive.size()==1){settle();return;}
        pending.removeIf(id->!canAct(member(id)));
        List<Player> capable=players.stream().filter(this::canAct).toList();
        if(capable.size()==1&&capable.getFirst().bet>=currentBet)pending.clear();
        if(!pending.isEmpty()){if(actor<0||!pending.contains(at(actor).id))actor=nextSeat(button,p->pending.contains(p.id));return;}
        if(street.equals("RIVER")){settle();return;}
        for(Player p:players){p.bet=0;p.lastActedAt=-1;}currentBet=0;lastRaise=bb;
        deck.removeFirst();if(street.equals("PREFLOP")){street="FLOP";for(int i=0;i<3;i++)board.add(deck.removeFirst());}else{street=street.equals("FLOP")?"TURN":"RIVER";board.add(deck.removeFirst());}
        players.stream().filter(this::canAct).forEach(p->pending.add(p.id));actor=nextSeat(button,p->pending.contains(p.id));advanceIfDoneIfAllIn();
    }
    private void advanceIfDoneIfAllIn(){if(players.stream().filter(this::canAct).count()<=1){pending.clear();advanceIfDone();}}
    void settle(){
        if(!running())return;
        Map<String,List<Player>> lastPotWinners=new HashMap<>();
        List<Map<String,Object>> payouts=new ArrayList<>();TreeSet<Long> levels=new TreeSet<>();players.stream().filter(p->p.committed>0).forEach(p->levels.add(p.committed));long previous=0;
        for(long level:levels){final long threshold=level;List<Player> contributors=players.stream().filter(p->p.committed>=threshold).toList();long pot=(level-previous)*contributors.size();previous=level;
            List<Player> eligible=contributors.stream().filter(p->!p.folded&&p.inHand).toList();
            if(contributors.size()==1){Player p=contributors.getFirst();p.stack+=pot;payouts.add(Map.of("nickname",p.nickname,"amount",pot,"rank","Uncalled bet"));continue;}
            require(!eligible.isEmpty(),"정산 후보가 없습니다");
            long best=eligible.size()==1?0:eligible.stream().mapToLong(p->HandRank.evaluate(combined(p))).max().orElseThrow();
            List<Player> winners=new ArrayList<>(eligible.stream().filter(p->eligible.size()==1||HandRank.evaluate(combined(p))==best).toList());winners.sort(Comparator.comparingInt(p->(p.seat-button+5)%6));
            for(Player contributor:contributors)lastPotWinners.put(contributor.id,List.copyOf(winners));
            for(int i=0;i<winners.size();i++){Player p=winners.get(i);long won=pot/winners.size()+(i<pot%winners.size()?1:0);p.stack+=won;payouts.add(Map.of("nickname",p.nickname,"amount",won,"rank",eligible.size()==1?"Win":HandRank.label(best)));}
        }
        result=payouts.stream().filter(p->!p.get("rank").equals("Uncalled bet")).map(p->p.get("nickname").toString()).distinct().reduce((a,b)->a+" · "+b).map(names->names+" 승리 · 지급 내역은 핸드 리뷰에서 확인").orElse("");
        List<Map<String,Object>> awards=new ArrayList<>();
        for(Player victim:players)if(victim.inHand&&!victim.leaving&&!victim.folded&&victim.stack==0){
            List<Player> killers=lastPotWinners.getOrDefault(victim.id,List.of());
            require(!killers.isEmpty()&&!killers.contains(victim),"바운티 정산 후보 오류");
            long share=BOUNTY_UNITS/killers.size();List<Map<String,Object>> recipients=new ArrayList<>();
            for(Player killer:killers){killer.bountyUnits+=share;recipients.add(Map.of("id",killer.id,"nickname",killer.nickname,"units",share,"amount",share/(double)BOUNTY_UNITS));}
            awards.add(Map.of("victimId",victim.id,"victimNickname",victim.nickname,"recipients",List.copyOf(recipients)));
        }
        bountyAwards=List.copyOf(awards);resetPending=!awards.isEmpty();
        if(resetPending)result+=" · 바운티 획득! 다음 핸드 전원 100BB 리셋";
        Map<String,Object> record=new HashMap<>();record.put("hand",hand);record.put("board",List.copyOf(board));record.put("payouts",payouts);record.put("actions",List.copyOf(log));record.put("bounties",bountyAwards);record.put("resetToBb",resetPending?100:0);record.put("finalStacks",players.stream().map(p->Map.of("id",p.id,"stack",p.stack)).toList());history.add(record);if(history.size()>50)history.removeFirst();
        for(Player p:players){p.bet=0;p.committed=0;p.showdown=false;}street="SETTLED";actor=-1;deadline=0;nextHandAt=System.currentTimeMillis()+7000;pending.clear();invariant();
    }
    public void showdown(String id,boolean reveal){
        require(street.equals("SETTLED"),"핸드 종료 후에만 쇼다운 여부를 선택할 수 있습니다");
        Player p=member(id);require(!p.cards.isEmpty(),"공개할 홀 카드가 없습니다");
        p.showdown=reveal;
        if(reveal&&nextHandAt>0)nextHandAt=Math.max(nextHandAt,System.currentTimeMillis()+4000);
        version++;
    }
    private List<String> combined(Player p){List<String> c=new ArrayList<>(board);c.addAll(p.cards);return c;}
    public void leave(String id){Player p=member(id);if(running()&&p.inHand&&!p.folded){p.leaving=true;p.folded=true;pending.remove(id);if(actor==p.seat)actor=nextSeat(p.seat,q->pending.contains(q.id)&&canAct(q));version++;advanceIfDone();setDeadline();}else p.leaving=true;cleanup();}
    public void cleanup(){if(running())return;for(Player p:new ArrayList<>(players))if(p.leaving){bankroll-=p.stack;players.remove(p);}if(players.stream().noneMatch(p->p.id.equals(host))&&!players.isEmpty())host=players.getFirst().id;}
    public void tick(long now){if(running()&&deadline>0&&now>=deadline){Player p=at(actor);action(p.id,p.bet>=currentBet?"CHECK":"FOLD",null,version,hand);return;}if(!running()){cleanup();if(nextHandAt>0&&now>=nextHandAt){nextHandAt=0;if(players.stream().filter(p->p.ready&&(p.stack>0||resetPending)).count()>=2)begin();else{street="WAITING";version++;}}}}
    private void setDeadline(){deadline=running()?System.currentTimeMillis()+30000:0;}
    private void assignPositions(){List<Player> order=new ArrayList<>();int seat=button;do{order.add(at(seat));seat=nextSeat(seat,q->q.inHand);}while(seat!=button&&order.size()<6);String[][]names={{},{},{"BTN / SB","BB"},{"BTN","SB","BB"},{"BTN","SB","BB","CO"},{"BTN","SB","BB","UTG","CO"},{"BTN","SB","BB","UTG","HJ","CO"}};for(Player p:players)p.position=p.inHand?names[order.size()][order.indexOf(p)]:"WAIT";}
    public String position(Player p){return p.position;}
    public Map<String,Object> view(String user){member(user);Map<String,Object> v=new HashMap<>();v.put("code",code);v.put("name",name);v.put("host",host);v.put("version",version);v.put("hand",hand);v.put("street",street);v.put("board",List.copyOf(board));v.put("sb",sb);v.put("bb",bb);v.put("currentBet",currentBet);v.put("minRaiseTo",currentBet+lastRaise);v.put("pot",players.stream().mapToLong(p->p.committed).sum());v.put("actor",actor);v.put("deadline",deadline);v.put("result",result);v.put("resetPending",resetPending);v.put("resetStackBb",100);v.put("bountyAwards",bountyAwards);v.put("pendingBlinds",pendingSb==null?List.of():List.of(pendingSb,pendingBb));v.put("allowedActions",allowed(user));v.put("log",List.copyOf(log));
        v.put("players",players.stream().map(p->{Map<String,Object> m=new HashMap<>();m.put("id",p.id);m.put("nickname",p.nickname);m.put("seat",p.seat);m.put("stack",p.stack);m.put("bountyUnits",p.bountyUnits);m.put("bounty",p.bountyUnits/(double)BOUNTY_UNITS);m.put("bet",p.bet);m.put("ready",p.ready);m.put("folded",p.folded);m.put("showdown",p.showdown);m.put("position",position(p));m.put("cards",p.id.equals(user)||(street.equals("SETTLED")&&p.showdown)?List.copyOf(p.cards):List.of());m.put("cardCount",p.cards.size());return m;}).toList());return v;
    }
    public void invariant(){require(players.stream().allMatch(p->p.stack>=0&&p.bet>=0&&p.committed>=0),"음수 스택");require(players.stream().mapToLong(p->p.stack+p.committed).sum()==bankroll,"칩 보존 위반");}
    public static void require(boolean condition,String message){if(!condition)throw new IllegalArgumentException(message);}
}
