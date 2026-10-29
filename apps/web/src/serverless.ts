import Peer, { DataConnection } from 'peerjs';
import type { BountyAward, InvitationInfo, Player, Review, Table, User } from './types';

function uuid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// --- Pure 7-Card Hand Evaluator (Port of HandRank.java) ---
function scoreFive(category: number, ranks: number[]): number {
  let result = category;
  for (let i = 0; i < 5; i++) result = result * 15 + (i < ranks.length ? ranks[i] : 0);
  return result;
}

function evalFive(cards: string[]): number {
  const counts = new Map<number, number>();
  for (const c of cards) {
    const r = Number.parseInt(c.slice(0, -1), 10);
    counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  const ranks = [...counts.keys()].sort((a, b) => b - a);
  const flush = new Set(cards.map(c => c.slice(-1))).size === 1;
  let straight = 0;
  if (ranks.length === 5) {
    if (ranks[0] - ranks[4] === 4) straight = ranks[0];
    else if (ranks[0] === 14 && ranks[1] === 5 && ranks[2] === 4 && ranks[3] === 3 && ranks[4] === 2) straight = 5;
  }
  if (flush && straight > 0) return scoreFive(8, [straight]);
  const grouped = [...ranks].sort((a, b) => (counts.get(b)! - counts.get(a)!) || (b - a));
  const first = counts.get(grouped[0])!;
  if (first === 4) return scoreFive(7, grouped);
  if (first === 3 && counts.get(grouped[1]) === 2) return scoreFive(6, grouped);
  if (flush) return scoreFive(5, ranks);
  if (straight > 0) return scoreFive(4, [straight]);
  if (first === 3) return scoreFive(3, grouped);
  if (first === 2 && counts.get(grouped[1]) === 2) return scoreFive(2, grouped);
  if (first === 2) return scoreFive(1, grouped);
  return scoreFive(0, ranks);
}

export function evaluateHand(cards: string[]): number {
  let best = 0;
  for (let a = 0; a < cards.length - 4; a++)
    for (let b = a + 1; b < cards.length - 3; b++)
      for (let c = b + 1; c < cards.length - 2; c++)
        for (let d = c + 1; d < cards.length - 1; d++)
          for (let e = d + 1; e < cards.length; e++)
            best = Math.max(best, evalFive([cards[a], cards[b], cards[c], cards[d], cards[e]]));
  return best;
}

export function handLabel(rank: number): string {
  const labels = ['High Card', 'One Pair', 'Two Pair', 'Three of a Kind', 'Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush'];
  return labels[Math.floor(rank / 759375)] ?? 'High Card';
}

// --- Serverless PokerTable Engine (Port of PokerTable.java) ---
type InternalPlayer = {
  id: string;
  nickname: string;
  seat: number;
  stack: number;
  bet: number;
  committed: number;
  bountyUnits: number;
  lastActedAt: number;
  ready: boolean;
  folded: boolean;
  inHand: boolean;
  leaving: boolean;
  showdown: boolean;
  isBot?: boolean;
  position: string;
  cards: string[];
};

const BOUNTY_UNITS = 60;

export class LocalPokerTable {
  players: InternalPlayer[] = [];
  board: string[] = [];
  log: { nickname: string; action: string; amountTo: number; street: string }[] = [];
  history: Review[] = [];
  deck: string[] = [];
  pending = new Set<string>();
  sb = 50;
  bb = 100;
  currentBet = 0;
  lastRaise = 100;
  version = 0;
  hand = 0;
  deadline = 0;
  nextHandAt = 0;
  pendingSb: number | null = null;
  pendingBb: number | null = null;
  button = -1;
  actor = -1;
  street = 'WAITING';
  result = '';
  resetPending = false;
  bountyAwards: BountyAward[] = [];
  password = '';

  constructor(public code: string, public name: string, public host: string, password = '') {
    this.password = password;
  }

  private req(cond: boolean, msg: string): void {
    if (!cond) throw new Error(msg);
  }

  running(): boolean {
    return this.street !== 'WAITING' && this.street !== 'SETTLED';
  }

  member(id: string): InternalPlayer {
    const p = this.players.find(x => x.id === id);
    if (!p) throw new Error('방에 참여하지 않았습니다');
    return p;
  }

  join(id: string, nickname: string, buyin: number, isBot = false): void {
    if (this.players.some(p => p.id === id)) return;
    this.req(this.players.length < 6, '방이 가득 찼습니다');
    let seat = 0;
    const used = new Set(this.players.map(p => p.seat));
    while (used.has(seat)) seat++;
    this.players.push({
      id, nickname, seat, stack: buyin, bet: 0, committed: 0, bountyUnits: 0,
      lastActedAt: -1, ready: isBot, folded: false, inHand: false, leaving: false,
      showdown: false, isBot, position: 'WAIT', cards: [],
    });
    this.players.sort((a, b) => a.seat - b.seat);
    this.version++;
  }

  blinds(id: string, small: number, big: number): void {
    this.req(this.host === id, '방장만 변경할 수 있습니다');
    this.req(small > 0 && big >= 2 * small && big <= 10000, 'BB는 최대 10,000이며 SB의 두 배 이상이어야 합니다');
    if (this.running()) {
      this.pendingSb = small;
      this.pendingBb = big;
    } else {
      this.sb = small;
      this.bb = big;
    }
    this.version++;
  }

  start(id: string): void {
    this.req(this.host === id, '방장만 시작할 수 있습니다');
    this.req(!this.running(), '이미 게임 중입니다');
    const eligible = this.players.filter(p => !p.leaving && (p.stack > 0 || this.resetPending));
    this.req(eligible.length >= 2, '두 명 이상 필요합니다');
    this.req(eligible.every(p => p.ready), '모두 준비해주세요');
    this.begin();
  }

  begin(): void {
    this.req(!this.running(), '이미 게임 중입니다');
    if (this.pendingSb !== null && this.pendingBb !== null) {
      this.sb = this.pendingSb;
      this.bb = this.pendingBb;
      this.pendingSb = null;
      this.pendingBb = null;
    }
    if (this.resetPending) {
      for (const p of this.players) p.stack = 100 * this.bb;
      this.resetPending = false;
    }
    const active = this.players.filter(p => !p.leaving && p.ready && p.stack > 0);
    this.req(active.length >= 2, '두 명 이상 필요합니다');
    this.hand++;
    this.board = [];
    this.log = [];
    this.bountyAwards = [];
    this.result = '';
    this.currentBet = 0;
    this.lastRaise = this.bb;
    this.pending.clear();
    this.nextHandAt = 0;
    for (const p of this.players) {
      p.inHand = active.includes(p);
      p.folded = !p.inHand;
      p.showdown = false;
      p.bet = 0;
      p.committed = 0;
      p.lastActedAt = -1;
      p.cards = [];
    }
    this.button = this.nextSeat(this.button, p => p.inHand);
    this.assignPositions();
    const shuffled: string[] = [];
    for (const suit of ['C', 'D', 'H', 'S']) for (let r = 2; r <= 14; r++) shuffled.push(`${r}${suit}`);
    for (let i = shuffled.length - 1; i > 0; i--) {
      const rand = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
      [shuffled[i], shuffled[rand]] = [shuffled[rand], shuffled[i]];
    }
    this.deck = shuffled;
    for (let i = 0; i < 2; i++) for (const p of active) p.cards.push(this.deck.shift()!);
    const small = active.length === 2 ? this.button : this.nextSeat(this.button, p => p.inHand);
    const big = this.nextSeat(small, p => p.inHand);
    this.pay(this.at(small), Math.min(this.sb, this.at(small).stack));
    this.pay(this.at(big), Math.min(this.bb, this.at(big).stack));
    this.currentBet = this.bb;
    this.street = 'PREFLOP';
    this.players.filter(p => this.canAct(p)).forEach(p => this.pending.add(p.id));
    this.actor = this.nextSeat(big, p => this.pending.has(p.id));
    this.version++;
    this.advanceIfDone();
    this.setDeadline();
  }

  private at(seat: number): InternalPlayer {
    return this.players.find(p => p.seat === seat)!;
  }

  private nextSeat(seat: number, filter: (p: InternalPlayer) => boolean): number {
    for (let i = 1; i <= 6; i++) {
      const n = (seat + i) % 6;
      for (const p of this.players) if (p.seat === n && filter(p)) return n;
    }
    return -1;
  }

  private canAct(p: InternalPlayer): boolean {
    return p.inHand && !p.folded && p.stack > 0;
  }

  private pay(p: InternalPlayer, delta: number): void {
    p.stack -= delta;
    p.bet += delta;
    p.committed += delta;
  }

  private mayRaise(p: InternalPlayer): boolean {
    return p.lastActedAt <= 0 || this.currentBet - p.lastActedAt >= this.lastRaise;
  }

  allowed(id: string): string[] {
    const p = this.member(id);
    if (!this.running() || this.actor !== p.seat) return [];
    const a = ['FOLD', p.bet >= this.currentBet ? 'CHECK' : 'CALL'];
    const opponentCanAct = this.players.filter(q => this.canAct(q)).length > 1;
    if (p.stack > 0 && (p.stack + p.bet <= this.currentBet || (this.mayRaise(p) && opponentCanAct))) a.push('ALL_IN');
    if (p.stack + p.bet > this.currentBet && this.mayRaise(p) && opponentCanAct) a.push(this.currentBet === 0 ? 'BET' : 'RAISE');
    return a;
  }

  action(id: string, act: string, amount: number | undefined, expectedVersion: number, expectedHand: number): void {
    this.req(this.version === expectedVersion && this.hand === expectedHand, '상태가 변경되었습니다. 다시 시도해주세요');
    const p = this.member(id);
    this.req(this.running() && p.seat === this.actor, '본인 차례가 아닙니다');
    this.req(this.allowed(id).includes(act), '허용되지 않은 액션입니다');
    let target = p.bet;
    if (act === 'FOLD') p.folded = true;
    else if (act === 'CHECK') this.req(p.bet >= this.currentBet, '체크할 수 없습니다');
    else if (act === 'CALL') target = Math.min(this.currentBet, p.bet + p.stack);
    else if (act === 'ALL_IN') target = p.bet + p.stack;
    else if (act === 'BET' || act === 'RAISE') {
      this.req(amount !== undefined, '금액을 입력해주세요');
      target = amount!;
      this.req(target > this.currentBet && target >= this.currentBet + this.lastRaise, '최소 레이즈 금액 미달');
    }
    this.req(target >= p.bet && target <= p.bet + p.stack, '베팅 금액 범위 오류');
    if (target > this.currentBet) {
      const raise = target - this.currentBet;
      if (raise >= this.lastRaise) this.lastRaise = raise;
      this.currentBet = target;
      this.players.filter(q => this.canAct(q) && q !== p).forEach(q => this.pending.add(q.id));
    }
    this.pay(p, target - p.bet);
    p.lastActedAt = this.currentBet;
    this.pending.delete(id);
    this.log.push({ nickname: p.nickname, action: act, amountTo: target, street: this.street });
    this.version++;
    this.actor = this.nextSeat(p.seat, q => this.pending.has(q.id) && this.canAct(q));
    this.advanceIfDone();
    this.setDeadline();
  }

  private advanceIfDone(): void {
    const alive = this.players.filter(p => p.inHand && !p.folded);
    if (alive.length === 1) {
      this.settle();
      return;
    }
    for (const id of [...this.pending]) if (!this.canAct(this.member(id))) this.pending.delete(id);
    const capable = this.players.filter(p => this.canAct(p));
    if (capable.length === 1 && capable[0].bet >= this.currentBet) this.pending.clear();
    if (this.pending.size > 0) {
      if (this.actor < 0 || !this.pending.has(this.at(this.actor).id)) {
        this.actor = this.nextSeat(this.button, p => this.pending.has(p.id));
      }
      return;
    }
    if (this.street === 'RIVER') {
      this.settle();
      return;
    }
    for (const p of this.players) {
      p.bet = 0;
      p.lastActedAt = -1;
    }
    this.currentBet = 0;
    this.lastRaise = this.bb;
    this.deck.shift();
    if (this.street === 'PREFLOP') {
      this.street = 'FLOP';
      for (let i = 0; i < 3; i++) this.board.push(this.deck.shift()!);
    } else {
      this.street = this.street === 'FLOP' ? 'TURN' : 'RIVER';
      this.board.push(this.deck.shift()!);
    }
    this.players.filter(p => this.canAct(p)).forEach(p => this.pending.add(p.id));
    this.actor = this.nextSeat(this.button, p => this.pending.has(p.id));
    if (this.players.filter(p => this.canAct(p)).length <= 1) {
      this.pending.clear();
      this.advanceIfDone();
    }
  }

  settle(): void {
    if (!this.running()) return;
    const lastPotWinners = new Map<string, InternalPlayer[]>();
    const payouts: { nickname: string; amount: number; rank: string }[] = [];
    const levels = [...new Set(this.players.filter(p => p.committed > 0).map(p => p.committed))].sort((a, b) => a - b);
    let previous = 0;
    for (const level of levels) {
      const contributors = this.players.filter(p => p.committed >= level);
      const pot = (level - previous) * contributors.length;
      previous = level;
      const eligible = contributors.filter(p => !p.folded && p.inHand);
      if (contributors.length === 1) {
        const p = contributors[0];
        p.stack += pot;
        payouts.push({ nickname: p.nickname, amount: pot, rank: 'Uncalled bet' });
        continue;
      }
      const best = eligible.length === 1 ? 0 : Math.max(...eligible.map(p => evaluateHand([...this.board, ...p.cards])));
      const winners = eligible
        .filter(p => eligible.length === 1 || evaluateHand([...this.board, ...p.cards]) === best)
        .sort((a, b) => ((a.seat - this.button + 5) % 6) - ((b.seat - this.button + 5) % 6));
      for (const c of contributors) lastPotWinners.set(c.id, winners);
      winners.forEach((p, i) => {
        const won = Math.floor(pot / winners.length) + (i < pot % winners.length ? 1 : 0);
        p.stack += won;
        payouts.push({ nickname: p.nickname, amount: won, rank: eligible.length === 1 ? 'Win' : handLabel(best) });
      });
    }
    const winnerNames = [...new Set(payouts.filter(p => p.rank !== 'Uncalled bet').map(p => p.nickname))];
    this.result = winnerNames.length ? `${winnerNames.join(' · ')} 승리 · 지급 내역은 핸드 리뷰에서 확인` : '';
    const awards: BountyAward[] = [];
    for (const victim of this.players) {
      if (victim.inHand && !victim.leaving && !victim.folded && victim.stack === 0) {
        const killers = lastPotWinners.get(victim.id) ?? [];
        if (killers.length > 0 && !killers.includes(victim)) {
          const share = Math.floor(BOUNTY_UNITS / killers.length);
          const recipients = killers.map(k => {
            k.bountyUnits += share;
            return { id: k.id, nickname: k.nickname, units: share, amount: share / BOUNTY_UNITS };
          });
          awards.push({ victimId: victim.id, victimNickname: victim.nickname, recipients });
        }
      }
    }
    this.bountyAwards = awards;
    this.resetPending = awards.length > 0;
    if (this.resetPending) this.result += ' · 바운티 획득! 다음 핸드 전원 100BB 리셋';
    this.history.push({
      hand: this.hand,
      board: [...this.board],
      payouts,
      bounties: this.bountyAwards,
      resetToBb: this.resetPending ? 100 : 0,
    });
    if (this.history.length > 50) this.history.shift();
    for (const p of this.players) {
      p.bet = 0;
      p.committed = 0;
      p.showdown = Boolean(p.isBot && !p.folded && this.board.length === 5);
    }
    this.street = 'SETTLED';
    this.actor = -1;
    this.deadline = 0;
    this.nextHandAt = Date.now() + 7000;
    this.pending.clear();
  }

  showdown(id: string, reveal: boolean): void {
    this.req(this.street === 'SETTLED', '핸드 종료 후에만 쇼다운 여부를 선택할 수 있습니다');
    const p = this.member(id);
    this.req(p.cards.length > 0, '공개할 홀 카드가 없습니다');
    p.showdown = reveal;
    if (reveal && this.nextHandAt > 0) this.nextHandAt = Math.max(this.nextHandAt, Date.now() + 4000);
    this.version++;
  }

  leave(id: string): void {
    const p = this.member(id);
    if (this.running() && p.inHand && !p.folded) {
      p.leaving = true;
      p.folded = true;
      this.pending.delete(id);
      if (this.actor === p.seat) this.actor = this.nextSeat(p.seat, q => this.pending.has(q.id) && this.canAct(q));
      this.version++;
      this.advanceIfDone();
      this.setDeadline();
    } else {
      p.leaving = true;
    }
    this.cleanup();
  }

  cleanup(): void {
    if (this.running()) return;
    this.players = this.players.filter(p => !p.leaving);
    if (!this.players.some(p => p.id === this.host) && this.players.length > 0) {
      this.host = this.players[0].id;
    }
  }

  tick(now: number): boolean {
    const before = this.version;
    if (this.running()) {
      const currentActor = this.players.find(p => p.seat === this.actor);
      if (currentActor?.isBot) {
        const acts = this.allowed(currentActor.id);
        const choice = acts.includes('CHECK') ? 'CHECK' : acts.includes('CALL') ? 'CALL' : 'FOLD';
        this.action(currentActor.id, choice, undefined, this.version, this.hand);
        return true;
      }
      if (this.deadline > 0 && now >= this.deadline && currentActor) {
        this.action(currentActor.id, currentActor.bet >= this.currentBet ? 'CHECK' : 'FOLD', undefined, this.version, this.hand);
        return true;
      }
    } else {
      this.cleanup();
      if (this.nextHandAt > 0 && now >= this.nextHandAt) {
        this.nextHandAt = 0;
        if (this.players.filter(p => p.ready && (p.stack > 0 || this.resetPending)).length >= 2) {
          this.begin();
        } else {
          this.street = 'WAITING';
          this.version++;
        }
      }
    }
    return this.version !== before;
  }

  private setDeadline(): void {
    this.deadline = this.running() ? Date.now() + 30000 : 0;
  }

  private assignPositions(): void {
    const order: InternalPlayer[] = [];
    let seat = this.button;
    do {
      order.push(this.at(seat));
      seat = this.nextSeat(seat, q => q.inHand);
    } while (seat !== this.button && order.length < 6);
    const names: string[][] = [[], [], ['BTN / SB', 'BB'], ['BTN', 'SB', 'BB'], ['BTN', 'SB', 'BB', 'CO'], ['BTN', 'SB', 'BB', 'UTG', 'CO'], ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO']];
    for (const p of this.players) {
      p.position = p.inHand ? names[order.length][order.indexOf(p)] : 'WAIT';
    }
  }

  view(userId: string): Table {
    this.member(userId);
    return {
      code: this.code,
      name: this.name,
      host: this.host,
      version: this.version,
      hand: this.hand,
      street: this.street,
      board: [...this.board],
      sb: this.sb,
      bb: this.bb,
      currentBet: this.currentBet,
      minRaiseTo: this.currentBet + this.lastRaise,
      pot: this.players.reduce((s, p) => s + p.committed, 0),
      actor: this.actor,
      deadline: this.deadline,
      result: this.result,
      resetPending: this.resetPending,
      bountyAwards: this.bountyAwards,
      pendingBlinds: this.pendingSb === null ? [] : [this.pendingSb, this.pendingBb!],
      allowedActions: this.allowed(userId),
      log: [...this.log],
      players: this.players.map((p): Player => ({
        id: p.id,
        nickname: p.nickname,
        seat: p.seat,
        stack: p.stack,
        bountyUnits: p.bountyUnits,
        bounty: p.bountyUnits / BOUNTY_UNITS,
        bet: p.bet,
        ready: p.ready,
        folded: p.folded,
        showdown: p.showdown,
        position: p.position,
        cards: p.id === userId || (this.street === 'SETTLED' && p.showdown) ? [...p.cards] : [],
        cardCount: p.cards.length,
      })),
    };
  }
}

// --- P2P WebRTC (PeerJS) + BroadcastChannel Serverless Coordinator ---
type RpcRequest = { id: string; userId: string; nickname: string; path: string; body?: unknown };
type RpcResponse = { id: string; ok: boolean; data?: unknown; error?: string };

class ServerlessCoordinator {
  private hostedTables = new Map<string, LocalPokerTable>();
  private hostPeers = new Map<string, Peer>();
  private clientConns = new Map<string, DataConnection>();
  private clientPeer: Peer | null = null;
  private pendingRpc = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private updateListeners = new Set<() => void>();
  private bc: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('river-club-p2p') : null;

  constructor() {
    if (this.bc) {
      this.bc.onmessage = ev => {
        const msg = ev.data;
        if (msg?.type === 'notify') {
          this.emitUpdate();
        } else if (msg?.type === 'rpc-req') {
          const req = msg.req as RpcRequest;
          const code = this.extractCode(req.path);
          if (code && this.hostedTables.has(code)) {
            const res = this.handleLocalRpc(req);
            this.bc?.postMessage({ type: 'rpc-res', res });
          }
        } else if (msg?.type === 'rpc-res') {
          const res = msg.res as RpcResponse;
          const pending = this.pendingRpc.get(res.id);
          if (pending) {
            this.pendingRpc.delete(res.id);
            if (res.ok) pending.resolve(res.data);
            else pending.reject(new Error(res.error ?? '요청 실패'));
          }
        }
      };
    }
    setInterval(() => {
      const now = Date.now();
      for (const t of this.hostedTables.values()) {
        if (t.tick(now)) this.broadcastTableUpdate(t.code);
      }
    }, 900);
  }

  onUpdate(fn: () => void): () => void {
    this.updateListeners.add(fn);
    return () => this.updateListeners.delete(fn);
  }

  private emitUpdate(): void {
    this.updateListeners.forEach(fn => fn());
  }

  private getUser(): User | null {
    try {
      const raw = sessionStorage.getItem('river:p2p:user') ?? localStorage.getItem('river:p2p:user');
      return raw ? (JSON.parse(raw) as User) : null;
    } catch {
      return null;
    }
  }

  private setUser(u: User | null): void {
    try {
      if (!u) {
        sessionStorage.removeItem('river:p2p:user');
        localStorage.removeItem('river:p2p:user');
      } else {
        const str = JSON.stringify(u);
        sessionStorage.setItem('river:p2p:user', str);
        localStorage.setItem('river:p2p:user', str);
      }
    } catch {}
  }

  private extractCode(path: string): string | null {
    const m = path.match(/^\/api\/(?:rooms|invitations)\/([A-Z0-9]{8})/i);
    return m ? m[1].toUpperCase() : null;
  }

  private broadcastTableUpdate(code: string): void {
    this.emitUpdate();
    this.bc?.postMessage({ type: 'notify', code });
    const peer = this.hostPeers.get(code);
    if (peer) {
      Object.values(peer.connections).flat().forEach((conn: unknown) => {
        const dc = conn as DataConnection;
        if (dc.open) dc.send({ type: 'notify', code });
      });
    }
  }

  private setupHostPeer(code: string): void {
    if (this.hostPeers.has(code)) return;
    try {
      const peer = new Peer(`river-club-room-${code}`);
      peer.on('connection', conn => {
        conn.on('data', raw => {
          const msg = raw as { type?: string; req?: RpcRequest };
          if (msg?.type === 'rpc-req' && msg.req) {
            const res = this.handleLocalRpc(msg.req);
            conn.send({ type: 'rpc-res', res });
          }
        });
      });
      this.hostPeers.set(code, peer);
    } catch {}
  }

  private async getClientConn(code: string): Promise<DataConnection> {
    const existing = this.clientConns.get(code);
    if (existing && existing.open) return existing;
    if (!this.clientPeer || this.clientPeer.destroyed) {
      this.clientPeer = new Peer();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('P2P 신호 서버 연결 시간 초과')), 7000);
        this.clientPeer!.once('open', () => { clearTimeout(timer); resolve(); });
        this.clientPeer!.once('error', err => { clearTimeout(timer); reject(err); });
      });
    }
    const conn = this.clientPeer.connect(`river-club-room-${code}`, { reliable: true });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('방 호스트와 연결하지 못했습니다. 코드를 확인해주세요.')), 7000);
      conn.once('open', () => { clearTimeout(timer); resolve(); });
      conn.once('error', err => { clearTimeout(timer); reject(err); });
    });
    conn.on('data', raw => {
      const msg = raw as { type?: string; res?: RpcResponse };
      if (msg?.type === 'notify') {
        this.emitUpdate();
      } else if (msg?.type === 'rpc-res' && msg.res) {
        const pending = this.pendingRpc.get(msg.res.id);
        if (pending) {
          this.pendingRpc.delete(msg.res.id);
          if (msg.res.ok) pending.resolve(msg.res.data);
          else pending.reject(new Error(msg.res.error ?? '요청 실패'));
        }
      }
    });
    this.clientConns.set(code, conn);
    return conn;
  }

  private handleLocalRpc(req: RpcRequest): RpcResponse {
    try {
      const code = this.extractCode(req.path)!;
      const t = this.hostedTables.get(code);
      if (!t) throw new Error('방 코드를 확인해주세요');

      if (req.path.startsWith('/api/invitations/')) {
        const info: InvitationInfo = {
          code: t.code,
          name: t.name,
          playerCount: t.players.length,
          capacity: 6,
          sb: t.sb,
          bb: t.bb,
          passwordRequired: Boolean(t.password),
          running: t.running(),
        };
        return { id: req.id, ok: true, data: info };
      }

      const sub = req.path.replace(`/api/rooms/${code}`, '');
      const body = (req.body ?? {}) as Record<string, unknown>;

      if (sub === '' && req.body === undefined) {
        return { id: req.id, ok: true, data: t.view(req.userId) };
      }
      if (sub === '/join') {
        if (!t.players.some(p => p.id === req.userId) && t.password) {
          if (String(body.password ?? '') !== t.password) throw new Error('방 코드 또는 비밀번호를 확인해주세요');
        }
        const nick = String(body.nickname ?? req.nickname).trim();
        t.join(req.userId, nick, 100 * t.bb);
        this.broadcastTableUpdate(code);
        return { id: req.id, ok: true, data: t.view(req.userId) };
      }
      if (sub === '/bot') {
        const botNum = t.players.filter(p => p.isBot).length + 1;
        t.join(`bot-${uuid().slice(0, 8)}`, `AI 봇 ${botNum}`, 100 * t.bb, true);
        this.broadcastTableUpdate(code);
        return { id: req.id, ok: true, data: t.view(req.userId) };
      }
      if (sub === '/ready') {
        if (t.running()) throw new Error('핸드 중에는 준비를 변경할 수 없습니다');
        t.member(req.userId).ready = Boolean(body.ready);
        t.version++;
        this.broadcastTableUpdate(code);
        return { id: req.id, ok: true, data: t.view(req.userId) };
      }
      if (sub === '/start') {
        t.start(req.userId);
        this.broadcastTableUpdate(code);
        return { id: req.id, ok: true, data: t.view(req.userId) };
      }
      if (sub === '/blinds') {
        t.blinds(req.userId, Number(body.sb), Number(body.bb));
        this.broadcastTableUpdate(code);
        return { id: req.id, ok: true, data: t.view(req.userId) };
      }
      if (sub === '/actions') {
        t.action(
          req.userId,
          String(body.action),
          body.amountTo !== undefined && body.amountTo !== null ? Number(body.amountTo) : undefined,
          Number(body.version),
          Number(body.hand)
        );
        this.broadcastTableUpdate(code);
        return { id: req.id, ok: true, data: t.view(req.userId) };
      }
      if (sub === '/showdown') {
        t.showdown(req.userId, Boolean(body.showdown));
        this.broadcastTableUpdate(code);
        return { id: req.id, ok: true, data: t.view(req.userId) };
      }
      if (sub === '/leave') {
        t.leave(req.userId);
        this.broadcastTableUpdate(code);
        return { id: req.id, ok: true, data: null };
      }
      if (sub === '/history') {
        t.member(req.userId);
        return { id: req.id, ok: true, data: [...t.history] };
      }
      throw new Error('지원하지 않는 요청입니다');
    } catch (e) {
      return { id: req.id, ok: false, error: e instanceof Error ? e.message : '요청 실패' };
    }
  }

  async request<T>(path: string, body?: unknown): Promise<T> {
    if (path === '/api/auth/csrf') {
      return { headerName: 'X-CSRF-TOKEN', token: 'serverless' } as T;
    }
    if (path === '/api/auth/me') {
      const u = this.getUser();
      if (!u) {
        const err = new Error('로그인이 필요합니다') as Error & { status?: number };
        err.status = 401;
        throw err;
      }
      return u as T;
    }
    if (path === '/api/auth/guest') {
      const nick = String((body as Record<string, unknown>)?.nickname ?? '').trim();
      if (nick.length < 2 || nick.length > 20) throw new Error('닉네임은 2~20자입니다');
      const existing = this.getUser();
      const user: User = { id: existing?.id ?? uuid(), nickname: nick };
      this.setUser(user);
      return user as T;
    }
    if (path === '/api/auth/logout') {
      this.setUser(null);
      return undefined as T;
    }
    if (path === '/api/rooms' && body !== undefined) {
      const user = this.getUser();
      if (!user) throw new Error('로그인이 필요합니다');
      const b = body as Record<string, unknown>;
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let code = '';
      for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
      const table = new LocalPokerTable(code, String(b.name ?? `${user.nickname}의 테이블`), user.id, String(b.password ?? ''));
      table.join(user.id, user.nickname, 100 * table.bb);
      this.hostedTables.set(code, table);
      this.setupHostPeer(code);
      return table.view(user.id) as T;
    }

    const code = this.extractCode(path);
    if (!code) throw new Error('잘못된 경로입니다');
    const user = this.getUser() ?? { id: 'anon', nickname: 'Guest' };
    const req: RpcRequest = { id: uuid(), userId: user.id, nickname: user.nickname, path, body };

    // 1. Hosted in current tab
    if (this.hostedTables.has(code)) {
      const res = this.handleLocalRpc(req);
      if (!res.ok) throw new Error(res.error);
      return res.data as T;
    }

    // 2. Try same-browser BroadcastChannel first (fast 150ms probe), then WebRTC PeerJS
    if (this.bc) {
      try {
        const data = await new Promise<unknown>((resolve, reject) => {
          const timer = setTimeout(() => {
            this.pendingRpc.delete(req.id);
            reject(new Error('bc-timeout'));
          }, 180);
          this.pendingRpc.set(req.id, {
            resolve: val => { clearTimeout(timer); resolve(val); },
            reject: err => { clearTimeout(timer); reject(err); },
          });
          this.bc!.postMessage({ type: 'rpc-req', req });
        });
        return data as T;
      } catch (e) {
        if (e instanceof Error && e.message !== 'bc-timeout') throw e;
      }
    }

    // 3. Remote P2P via PeerJS WebRTC
    const conn = await this.getClientConn(code);
    const data = await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRpc.delete(req.id);
        reject(new Error('호스트 응답 시간 초과'));
      }, 6000);
      this.pendingRpc.set(req.id, {
        resolve: val => { clearTimeout(timer); resolve(val); },
        reject: err => { clearTimeout(timer); reject(err); },
      });
      conn.send({ type: 'rpc-req', req });
    });
    return data as T;
  }
}

export const serverless = new ServerlessCoordinator();
