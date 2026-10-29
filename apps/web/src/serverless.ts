import type { BountyAward, ChatMessage, InvitationInfo, Player, Review, Table, User } from './types';

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
  bountyLog: { victimNickname: string; units: number }[];
  lastActedAt: number;
  ready: boolean;
  folded: boolean;
  inHand: boolean;
  leaving: boolean;
  showdown: boolean;
  position: string;
  cards: string[];
};

const BOUNTY_UNITS = 60;

export type SavedRoomSummary = {
  code: string;
  name: string;
  sb: number;
  bb: number;
  hand: number;
  updatedAt: number;
  players: { nickname: string; bounty: number; stack: number }[];
};

export class LocalPokerTable {
  players: InternalPlayer[] = [];
  archivedPlayers: InternalPlayer[] = [];
  board: string[] = [];
  log: { nickname: string; action: string; amountTo: number; street: string }[] = [];
  chatLog: ChatMessage[] = [];
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
  runoutAt = 0;
  pendingSb: number | null = null;
  pendingBb: number | null = null;
  button = -1;
  actor = -1;
  street = 'WAITING';
  result = '';
  resetPending = false;
  bountyAwards: BountyAward[] = [];
  password = '';
  updatedAt = Date.now();

  constructor(public code: string, public name: string, public host: string, password = '') {
    this.password = password;
  }

  toJSON(): Record<string, unknown> {
    return {
      code: this.code,
      name: this.name,
      host: this.host,
      password: this.password,
      players: this.players,
      archivedPlayers: this.archivedPlayers,
      board: this.board,
      log: this.log.slice(-40),
      chatLog: this.chatLog.slice(-30),
      history: this.history.slice(-10),
      deck: this.deck,
      pending: [...this.pending],
      sb: this.sb,
      bb: this.bb,
      currentBet: this.currentBet,
      lastRaise: this.lastRaise,
      version: this.version,
      hand: this.hand,
      deadline: this.deadline,
      nextHandAt: this.nextHandAt,
      runoutAt: this.runoutAt,
      pendingSb: this.pendingSb,
      pendingBb: this.pendingBb,
      button: this.button,
      actor: this.actor,
      street: this.street,
      result: this.result,
      resetPending: this.resetPending,
      bountyAwards: this.bountyAwards,
      updatedAt: this.updatedAt,
    };
  }

  static fromJSON(raw: Record<string, unknown>): LocalPokerTable {
    const t = new LocalPokerTable(
      String(raw.code ?? ''),
      String(raw.name ?? '포커 테이블'),
      String(raw.host ?? ''),
      String(raw.password ?? '')
    );
    t.players = Array.isArray(raw.players) ? (raw.players as InternalPlayer[]).map(p => ({
      ...p,
      bountyLog: Array.isArray(p.bountyLog) ? p.bountyLog : [],
      cards: Array.isArray(p.cards) ? p.cards : [],
    })) : [];
    t.archivedPlayers = Array.isArray(raw.archivedPlayers) ? (raw.archivedPlayers as InternalPlayer[]).map(p => ({
      ...p,
      bountyLog: Array.isArray(p.bountyLog) ? p.bountyLog : [],
      cards: [],
    })) : [];
    t.board = Array.isArray(raw.board) ? (raw.board as string[]) : [];
    t.log = Array.isArray(raw.log) ? (raw.log as { nickname: string; action: string; amountTo: number; street: string }[]) : [];
    t.chatLog = Array.isArray(raw.chatLog) ? (raw.chatLog as ChatMessage[]) : [];
    t.history = Array.isArray(raw.history) ? (raw.history as Review[]) : [];
    t.deck = Array.isArray(raw.deck) ? (raw.deck as string[]) : [];
    t.pending = new Set(Array.isArray(raw.pending) ? (raw.pending as string[]) : []);
    t.sb = Number(raw.sb ?? 50);
    t.bb = Number(raw.bb ?? 100);
    t.currentBet = Number(raw.currentBet ?? 0);
    t.lastRaise = Number(raw.lastRaise ?? t.bb);
    t.version = Number(raw.version ?? 0);
    t.hand = Number(raw.hand ?? 0);
    const now = Date.now();
    t.deadline = Number(raw.deadline ?? 0);
    if (t.deadline > 0 && t.deadline < now + 5000) t.deadline = now + 30000;
    t.nextHandAt = Number(raw.nextHandAt ?? 0);
    t.runoutAt = Number(raw.runoutAt ?? 0);
    if (t.runoutAt > 0 && t.runoutAt < now + 1000) t.runoutAt = now + 3000;
    t.pendingSb = raw.pendingSb != null ? Number(raw.pendingSb) : null;
    t.pendingBb = raw.pendingBb != null ? Number(raw.pendingBb) : null;
    t.button = Number(raw.button ?? -1);
    t.actor = Number(raw.actor ?? -1);
    t.street = String(raw.street ?? 'WAITING');
    t.result = String(raw.result ?? '');
    t.resetPending = Boolean(raw.resetPending);
    t.bountyAwards = Array.isArray(raw.bountyAwards) ? (raw.bountyAwards as BountyAward[]) : [];
    t.updatedAt = Number(raw.updatedAt ?? now);
    return t;
  }

  static fromTableSnapshot(snap: Table, history: Review[] = []): LocalPokerTable {
    const t = new LocalPokerTable(snap.code, snap.name, snap.host, '');
    t.sb = snap.sb;
    t.bb = snap.bb;
    t.hand = snap.hand;
    t.version = snap.version + 1;
    t.street = 'WAITING';
    t.board = [];
    t.result = '이전 방 기록을 불러왔습니다 · 모두 준비하면 이어서 시작합니다';
    t.resetPending = snap.resetPending;
    t.bountyAwards = snap.bountyAwards ?? [];
    t.chatLog = snap.chat ? [...snap.chat] : [];
    t.history = [...history];
    t.players = snap.players.map(p => ({
      id: p.id,
      nickname: p.nickname,
      seat: p.seat,
      stack: p.stack > 0 ? p.stack + (p.bet ?? 0) : 100 * snap.bb,
      bet: 0,
      committed: 0,
      bountyUnits: p.bountyUnits ?? Math.round((p.bounty ?? 0) * BOUNTY_UNITS),
      bountyLog: (p.bountyVictims ?? []).map(v => ({
        victimNickname: v.nickname,
        units: Math.round(v.amount * BOUNTY_UNITS),
      })),
      lastActedAt: -1,
      ready: false,
      folded: false,
      inHand: false,
      leaving: false,
      showdown: false,
      position: p.position || 'BTN',
      cards: [],
    }));
    t.assignPreviewPositions();
    return t;
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

  join(id: string, nickname: string, buyin: number): void {
    if (!this.running()) this.cleanup();
    const normNick = nickname.trim().toLowerCase();
    const existing = this.players.find(p => p.id === id || (normNick.length > 0 && p.nickname.trim().toLowerCase() === normNick));
    if (existing) {
      const oldId = existing.id;
      if (oldId !== id) {
        existing.id = id;
        if (this.host === oldId) this.host = id;
        if (this.pending.has(oldId)) {
          this.pending.delete(oldId);
          this.pending.add(id);
        }
      }
      if (nickname) existing.nickname = nickname.trim();
      existing.leaving = false;
      if (!this.running()) this.assignPreviewPositions();
      this.version++;
      return;
    }
    this.req(this.players.length < 6, '방이 가득 찼습니다');
    const archivedIdx = this.archivedPlayers.findIndex(
      p => p.id === id || (normNick.length > 0 && p.nickname.trim().toLowerCase() === normNick)
    );
    const archived = archivedIdx >= 0 ? this.archivedPlayers.splice(archivedIdx, 1)[0] : undefined;
    const used = new Set(this.players.map(p => p.seat));
    let seat = archived && !used.has(archived.seat) ? archived.seat : 0;
    while (used.has(seat)) seat++;
    this.players.push({
      id,
      nickname: nickname.trim(),
      seat,
      stack: archived && archived.stack > 0 ? archived.stack : buyin,
      bet: 0,
      committed: 0,
      bountyUnits: archived ? archived.bountyUnits : 0,
      bountyLog: archived ? archived.bountyLog : [],
      lastActedAt: -1,
      ready: false,
      folded: false,
      inHand: false,
      leaving: false,
      showdown: false,
      position: 'BTN',
      cards: [],
    });
    this.players.sort((a, b) => a.seat - b.seat);
    if (!this.running()) this.assignPreviewPositions();
    this.version++;
    this.updatedAt = Date.now();
  }

  chat(id: string, text: string): void {
    const p = this.member(id);
    const trimmed = text.trim();
    this.req(trimmed.length >= 1 && trimmed.length <= 120, '채팅 메시지는 1~120자입니다');
    this.chatLog.push({ id: uuid(), userId: p.id, nickname: p.nickname, text: trimmed, time: Date.now() });
    if (this.chatLog.length > 60) this.chatLog.shift();
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
    this.runoutAt = 0;
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

  private dealNextStreet(): void {
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
  }

  private advanceIfDone(): void {
    const alive = this.players.filter(p => p.inHand && !p.folded);
    if (alive.length === 1) {
      this.runoutAt = 0;
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
    if (capable.length <= 1) {
      if (this.street === 'RIVER') {
        this.settle();
        return;
      }
      for (const p of this.players) {
        p.bet = 0;
        p.lastActedAt = -1;
      }
      this.currentBet = 0;
      this.actor = -1;
      this.deadline = 0;
      this.runoutAt = Date.now() + 3000;
      return;
    }
    if (this.street === 'RIVER') {
      this.settle();
      return;
    }
    this.dealNextStreet();
    this.players.filter(p => this.canAct(p)).forEach(p => this.pending.add(p.id));
    this.actor = this.nextSeat(this.button, p => this.pending.has(p.id));
  }

  settle(): void {
    if (!this.running()) return;
    this.runoutAt = 0;
    const aliveAtEnd = this.players.filter(p => p.inHand && !p.folded);
    const isForcedShowdown = aliveAtEnd.length >= 2;
    const showdownWinners = new Set<string>();
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
      if (isForcedShowdown && eligible.length >= 2) {
        for (const w of winners) showdownWinners.add(w.id);
      }
      for (const c of contributors) lastPotWinners.set(c.id, winners);
      winners.forEach((p, i) => {
        const won = Math.floor(pot / winners.length) + (i < pot % winners.length ? 1 : 0);
        p.stack += won;
        payouts.push({ nickname: p.nickname, amount: won, rank: eligible.length === 1 ? 'Win' : handLabel(best) });
      });
    }
    const winnerNames = [...new Set(payouts.filter(p => p.rank !== 'Uncalled bet').map(p => p.nickname))];
    this.result = winnerNames.length
      ? `${winnerNames.join(' · ')} 승리${isForcedShowdown ? ' (승자 핸드 강제 쇼다운)' : ' (폴드 승리 · 쇼다운 없음)'}`
      : '';
    const awards: BountyAward[] = [];
    for (const victim of this.players) {
      if (victim.inHand && !victim.leaving && !victim.folded && victim.stack === 0) {
        const killers = lastPotWinners.get(victim.id) ?? [];
        if (killers.length > 0 && !killers.includes(victim)) {
          const share = Math.floor(BOUNTY_UNITS / killers.length);
          const recipients = killers.map(k => {
            k.bountyUnits += share;
            const existingBounty = k.bountyLog.find(b => b.victimNickname === victim.nickname);
            if (existingBounty) existingBounty.units += share;
            else k.bountyLog.push({ victimNickname: victim.nickname, units: share });
            return { id: k.id, nickname: k.nickname, units: share, amount: share / BOUNTY_UNITS };
          });
          awards.push({ victimId: victim.id, victimNickname: victim.nickname, recipients });
        }
      }
    }
    this.bountyAwards = awards;
    this.resetPending = awards.length > 0;
    if (this.resetPending) {
      const awardSummary = awards
        .map(a => `🎯 ${a.victimNickname}의 바운티 칩 → ${a.recipients.map(r => r.nickname).join(', ')} 획득`)
        .join(' · ');
      this.result += ` · ${awardSummary} · 다음 핸드 전원 100BB 리셋`;
    }
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
      p.showdown = isForcedShowdown && showdownWinners.has(p.id);
    }
    this.street = 'SETTLED';
    this.actor = -1;
    this.deadline = 0;
    this.nextHandAt = Date.now() + 4000;
    this.pending.clear();
  }

  showdown(id: string, reveal: boolean): void {
    this.req(this.street === 'SETTLED', '핸드 종료 후에만 쇼다운 여부를 선택할 수 있습니다');
    const p = this.member(id);
    this.req(p.cards.length > 0, '공개할 홀 카드가 없습니다');
    p.showdown = reveal;
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
    for (const p of this.players) {
      if (p.leaving) {
        const norm = p.nickname.trim().toLowerCase();
        this.archivedPlayers = this.archivedPlayers.filter(
          a => a.id !== p.id && a.nickname.trim().toLowerCase() !== norm
        );
        this.archivedPlayers.push({ ...p, leaving: false, ready: false, inHand: false, folded: false, bet: 0, committed: 0, cards: [] });
      }
    }
    this.players = this.players.filter(p => !p.leaving);
    if (!this.players.some(p => p.id === this.host) && this.players.length > 0) {
      this.host = this.players[0].id;
    }
    this.assignPreviewPositions();
  }

  tick(now: number): boolean {
    const before = this.version;
    if (this.running()) {
      if (this.runoutAt > 0 && now >= this.runoutAt) {
        this.runoutAt = 0;
        if (this.street === 'RIVER') {
          this.settle();
        } else {
          this.dealNextStreet();
          this.actor = -1;
          this.deadline = 0;
          this.runoutAt = now + 3000;
        }
        this.version++;
        return true;
      }
      const currentActor = this.players.find(p => p.seat === this.actor);
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
    this.deadline = this.running() && this.actor >= 0 ? Date.now() + 30000 : 0;
  }

  private assignPositions(): void {
    const order: InternalPlayer[] = [];
    let seat = this.button;
    do {
      order.push(this.at(seat));
      seat = this.nextSeat(seat, q => q.inHand);
    } while (seat !== this.button && order.length < 6);
    const names: string[][] = [[], ['BTN'], ['BTN / SB', 'BB'], ['BTN', 'SB', 'BB'], ['BTN', 'SB', 'BB', 'CO'], ['BTN', 'SB', 'BB', 'UTG', 'CO'], ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO']];
    for (const p of this.players) {
      p.position = p.inHand ? names[order.length][order.indexOf(p)] : 'WAIT';
    }
  }

  private assignPreviewPositions(): void {
    const active = this.players.filter(p => !p.leaving);
    if (active.length === 0) return;
    const names: string[][] = [[], ['BTN'], ['BTN / SB', 'BB'], ['BTN', 'SB', 'BB'], ['BTN', 'SB', 'BB', 'CO'], ['BTN', 'SB', 'BB', 'UTG', 'CO'], ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO']];
    const startSeat = this.button >= 0 && active.some(p => p.seat === this.button) ? this.button : active[0].seat;
    const order: InternalPlayer[] = [];
    let seat = startSeat;
    do {
      const found = active.find(p => p.seat === seat);
      if (found) order.push(found);
      seat = this.nextSeat(seat, q => !q.leaving);
    } while (seat !== startSeat && seat >= 0 && order.length < active.length);
    for (const p of active) {
      const idx = order.indexOf(p);
      p.position = idx >= 0 ? names[order.length][idx] : 'WAIT';
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
      deadline: this.deadline > 0 ? this.deadline : this.runoutAt,
      result: this.result,
      resetPending: this.resetPending,
      bountyAwards: this.bountyAwards,
      pendingBlinds: this.pendingSb === null ? [] : [this.pendingSb, this.pendingBb!],
      allowedActions: this.allowed(userId),
      log: [...this.log],
      chat: [...this.chatLog],
      players: this.players.map((p): Player => ({
        id: p.id,
        nickname: p.nickname,
        seat: p.seat,
        stack: p.stack,
        bountyUnits: p.bountyUnits,
        bounty: p.bountyUnits / BOUNTY_UNITS,
        bountyVictims: p.bountyLog.map(b => ({ nickname: b.victimNickname, amount: b.units / BOUNTY_UNITS })),
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

// --- Cloud MQTT-over-WSS + BroadcastChannel Serverless Coordinator ---
type RpcRequest = { id: string; userId: string; nickname: string; path: string; body?: unknown };
type RpcResponse = { id: string; ok: boolean; data?: unknown; error?: string };

const STORAGE_TABLES_KEY = 'river:p2p:tables:v1';
const STORAGE_SNAPSHOTS_KEY = 'river:p2p:snapshots:v1';
const MQTT_BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
];

function encodeVarLength(len: number): Uint8Array {
  const out: number[] = [];
  do {
    let digit = len % 128;
    len = Math.floor(len / 128);
    if (len > 0) digit |= 128;
    out.push(digit);
  } while (len > 0);
  return new Uint8Array(out);
}

function encodeUtf8(str: string): Uint8Array {
  const bytes = new TextEncoder().encode(str);
  const out = new Uint8Array(2 + bytes.length);
  out[0] = (bytes.length >> 8) & 0xff;
  out[1] = bytes.length & 0xff;
  out.set(bytes, 2);
  return out;
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

class MqttSocketConn {
  private ws: WebSocket | null = null;
  private rxBuffer: Uint8Array = new Uint8Array(0);
  private connected = false;
  private subscribedTopics = new Set<string>();
  private pendingPublishes = new Map<string, { payloadStr: string; retain: boolean }>();
  private pktId = 1;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private url: string,
    private clientId: string,
    private onMessage: (topic: string, payload: string) => void
  ) {
    this.connect();
  }

  connect(): void {
    if (typeof WebSocket === 'undefined') return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    try {
      const ws = new WebSocket(this.url, 'mqtt');
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      ws.onopen = () => {
        this.rxBuffer = new Uint8Array(0);
        const proto = encodeUtf8('MQTT');
        const flagsAndKeepalive = new Uint8Array([4, 2, 0, 45]);
        const cid = encodeUtf8(this.clientId);
        const body = concatBytes(proto, flagsAndKeepalive, cid);
        this.sendRaw(concatBytes(new Uint8Array([0x10]), encodeVarLength(body.length), body));
        if (this.pingTimer) clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => {
          if (this.connected) this.sendRaw(new Uint8Array([0xc0, 0x00]));
        }, 25000);
      };
      ws.onmessage = ev => {
        if (!(ev.data instanceof ArrayBuffer)) return;
        this.rxBuffer = concatBytes(this.rxBuffer, new Uint8Array(ev.data));
        this.parsePackets();
      };
      ws.onclose = () => {
        this.connected = false;
        this.scheduleReconnect();
      };
      ws.onerror = () => {
        this.connected = false;
        try { ws.close(); } catch {}
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 1500);
  }

  private sendRaw(pkt: Uint8Array): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try { this.ws.send(pkt); } catch {}
    }
  }

  private sendSubscribe(topic: string): void {
    const pid = (this.pktId++ & 0x7fff) || 1;
    const pidBytes = new Uint8Array([(pid >> 8) & 0xff, pid & 0xff]);
    const tBytes = encodeUtf8(topic);
    const body = concatBytes(pidBytes, tBytes, new Uint8Array([0x00]));
    this.sendRaw(concatBytes(new Uint8Array([0x82]), encodeVarLength(body.length), body));
  }

  private sendPublishNow(topic: string, payloadStr: string, retain: boolean): void {
    const tBytes = encodeUtf8(topic);
    const pBytes = new TextEncoder().encode(payloadStr);
    const rem = encodeVarLength(tBytes.length + pBytes.length);
    const header = new Uint8Array([retain ? 0x31 : 0x30]);
    this.sendRaw(concatBytes(header, rem, tBytes, pBytes));
  }

  subscribe(topic: string): void {
    this.subscribedTopics.add(topic);
    if (this.connected) {
      this.sendSubscribe(topic);
    } else {
      this.connect();
    }
  }

  publish(topic: string, payloadStr: string, retain = true): void {
    if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendPublishNow(topic, payloadStr, retain);
    } else {
      this.pendingPublishes.set(topic, { payloadStr, retain });
      this.connect();
    }
  }

  private parsePackets(): void {
    let offset = 0;
    while (offset + 2 <= this.rxBuffer.length) {
      const first = this.rxBuffer[offset];
      const type = first >> 4;
      const flags = first & 0x0f;
      let multiplier = 1;
      let value = 0;
      let idx = offset + 1;
      let complete = false;
      while (idx < this.rxBuffer.length) {
        const encodedByte = this.rxBuffer[idx++];
        value += (encodedByte & 127) * multiplier;
        if ((encodedByte & 128) === 0) {
          complete = true;
          break;
        }
        multiplier *= 128;
      }
      if (!complete || idx + value > this.rxBuffer.length) break;
      const pkt = this.rxBuffer.subarray(idx, idx + value);
      offset = idx + value;
      if (type === 2) {
        // CONNACK received
        this.connected = true;
        for (const t of this.subscribedTopics) {
          this.sendSubscribe(t);
        }
        for (const [topic, item] of this.pendingPublishes.entries()) {
          this.sendPublishNow(topic, item.payloadStr, item.retain);
        }
        this.pendingPublishes.clear();
      } else if (type === 3 && pkt.length >= 2) {
        const topicLen = (pkt[0] << 8) | pkt[1];
        if (2 + topicLen <= pkt.length) {
          const topic = new TextDecoder().decode(pkt.subarray(2, 2 + topicLen));
          const qos = (flags >> 1) & 0x03;
          const payloadStart = 2 + topicLen + (qos > 0 ? 2 : 0);
          if (payloadStart <= pkt.length) {
            const payload = new TextDecoder().decode(pkt.subarray(payloadStart));
            this.onMessage(topic, payload);
          }
        }
      }
    }
    if (offset > 0) {
      this.rxBuffer = this.rxBuffer.subarray(offset);
    }
  }
}

class ServerlessCoordinator {
  private hostedTables = new Map<string, LocalPokerTable>();
  private savedSnapshots = new Map<string, { table: Table; history: Review[]; updatedAt: number }>();
  private mqttConns: MqttSocketConn[] = [];
  private instanceId = `rc-${uuid().slice(0, 8)}`;
  private subscribedRooms = new Set<string>();
  private roomLoadWaiters = new Map<string, Set<() => void>>();
  private updateListeners = new Set<(table?: Table) => void>();
  private bc: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('river-club-p2p') : null;

  constructor() {
    this.loadPersistedState();
    for (let i = 0; i < MQTT_BROKERS.length; i++) {
      this.mqttConns.push(
        new MqttSocketConn(MQTT_BROKERS[i], `${this.instanceId}-${i}`, (topic, payload) => {
          this.handleMqttMessage(topic, payload);
        })
      );
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          this.mqttConns.forEach(c => c.connect());
          for (const code of this.subscribedRooms) {
            this.subscribeRoomCloud(code);
          }
        }
      });
      window.addEventListener('online', () => {
        this.mqttConns.forEach(c => c.connect());
      });
    }
    if (this.bc) {
      this.bc.onmessage = ev => {
        const msg = ev.data;
        if (msg?.type === 'state' && msg.code && msg.raw) {
          this.mergeIncomingTableState(String(msg.code).toUpperCase(), msg.raw as Record<string, unknown>);
        }
      };
    }
    try {
      const activeCode = (sessionStorage.getItem('river:room') || localStorage.getItem('river:room') || '').trim().toUpperCase();
      if (activeCode) {
        this.subscribeRoomCloud(activeCode);
      }
    } catch {}
    setInterval(() => {
      const now = Date.now();
      const me = this.getUser();
      for (const t of this.hostedTables.values()) {
        // Host ticks immediately; if host is offline/delayed by >1.5s, any seated player ticks so the game never stalls
        const isHost = me && t.host === me.id;
        const timerTarget = t.runoutAt || t.nextHandAt || t.deadline;
        const isBackupTicker = me && !isHost && timerTarget > 0 && now >= timerTarget + 1500 && t.players.some(p => p.id === me.id);
        if ((isHost || isBackupTicker) && t.tick(now)) {
          this.broadcastTableUpdate(t.code);
        }
      }
    }, 300);
  }

  private stateTopic(code: string): string {
    return `river-club/v3/room/${code.toUpperCase()}/state`;
  }

  private subscribeRoomCloud(code: string): void {
    const norm = code.trim().toUpperCase();
    if (!norm) return;
    this.subscribedRooms.add(norm);
    const topic = this.stateTopic(norm);
    this.mqttConns.forEach(c => c.subscribe(topic));
  }

  private publishRoomCloud(t: LocalPokerTable): void {
    const topic = this.stateTopic(t.code);
    const payload = JSON.stringify({
      sender: this.instanceId,
      ts: Date.now(),
      table: t.toJSON(),
    });
    this.mqttConns.forEach(c => c.publish(topic, payload, true));
  }

  private handleMqttMessage(topic: string, payload: string): void {
    const m = topic.match(/^river-club\/v3\/room\/([A-Z0-9]{8})\/state$/i);
    if (!m) return;
    const code = m[1].toUpperCase();
    try {
      const parsed = JSON.parse(payload) as { sender?: string; table?: Record<string, unknown> };
      if (parsed?.sender === this.instanceId && this.hostedTables.has(code)) {
        const waiters = this.roomLoadWaiters.get(code);
        if (waiters) {
          this.roomLoadWaiters.delete(code);
          waiters.forEach(resolve => resolve());
        }
        return;
      }
      const rawTable = parsed?.table ?? (parsed as Record<string, unknown>);
      if (!rawTable || typeof rawTable !== 'object' || !rawTable.code) return;
      this.mergeIncomingTableState(code, rawTable);
    } catch {}
  }

  private mergeIncomingTableState(code: string, rawTable: Record<string, unknown>): void {
    const incoming = LocalPokerTable.fromJSON(rawTable);
    const current = this.hostedTables.get(code);
    let shouldPublishMerged = false;

    if (current) {
      if (incoming.hand < current.hand) return;
      if (incoming.hand === current.hand && incoming.version < current.version) {
        if (!current.running() && !incoming.running()) {
          let currentUpdated = false;
          for (const ip of incoming.players) {
            const normNick = ip.nickname.trim().toLowerCase();
            const existsInCurrent = current.players.some(
              cp => cp.id === ip.id || cp.nickname.trim().toLowerCase() === normNick
            );
            if (!existsInCurrent && !ip.leaving && current.players.length < 6) {
              current.join(ip.id, ip.nickname, ip.stack > 0 ? ip.stack : 100 * current.bb);
              currentUpdated = true;
            }
          }
          const curChatIds = new Set(current.chatLog.map(c => c.id));
          for (const c of incoming.chatLog) {
            if (!curChatIds.has(c.id)) {
              current.chatLog.push(c);
              currentUpdated = true;
            }
          }
          if (currentUpdated) {
            current.chatLog.sort((a, b) => a.time - b.time);
            current.version = Math.max(current.version, incoming.version) + 1;
            this.broadcastTableUpdate(code);
          }
        }
        return;
      }

      // Merge any chat messages not yet in incoming
      const chatIds = new Set(incoming.chatLog.map(c => c.id));
      for (const c of current.chatLog) {
        if (!chatIds.has(c.id)) {
          incoming.chatLog.push(c);
          shouldPublishMerged = true;
        }
      }
      incoming.chatLog.sort((a, b) => a.time - b.time);

      // If waiting/settled, preserve any recently joined local player who wasn't in incoming yet
      if (!incoming.running()) {
        for (const p of current.players) {
          const normNick = p.nickname.trim().toLowerCase();
          const existsInIncoming = incoming.players.some(
            ip => ip.id === p.id || ip.nickname.trim().toLowerCase() === normNick
          );
          if (!existsInIncoming && !p.leaving && incoming.players.length < 6) {
            incoming.join(p.id, p.nickname, p.stack > 0 ? p.stack : 100 * incoming.bb);
            shouldPublishMerged = true;
          }
        }
      }
    }

    this.hostedTables.set(code, incoming);
    this.savePersistedTables();

    const waiters = this.roomLoadWaiters.get(code);
    if (waiters) {
      this.roomLoadWaiters.delete(code);
      waiters.forEach(resolve => resolve());
    }

    const me = this.getUser();
    let myView: Table | undefined;
    if (me && incoming.players.some(p => p.id === me.id)) {
      try { myView = incoming.view(me.id); } catch {}
    }
    if (myView) this.saveClientSnapshot(myView, incoming.history);
    this.emitUpdate(myView);

    if (shouldPublishMerged) {
      this.publishRoomCloud(incoming);
    }
  }

  private async ensureRoomLoaded(code: string, currentUser: User): Promise<LocalPokerTable> {
    const norm = code.trim().toUpperCase();
    this.subscribeRoomCloud(norm);

    if (this.hostedTables.has(norm)) {
      return this.hostedTables.get(norm)!;
    }

    // Wait up to 1100ms for cloud retained state to arrive from EMQX / HiveMQ
    await new Promise<void>(resolve => {
      let set = this.roomLoadWaiters.get(norm);
      if (!set) {
        set = new Set();
        this.roomLoadWaiters.set(norm, set);
      }
      const done = () => {
        clearTimeout(timer);
        set?.delete(done);
        resolve();
      };
      const timer = setTimeout(done, 1100);
      set.add(done);
    });

    if (this.hostedTables.has(norm)) {
      return this.hostedTables.get(norm)!;
    }

    // Fallback 1: Restore from local snapshot if available
    if (this.promoteSnapshotToHosted(norm, currentUser)) {
      const t = this.hostedTables.get(norm)!;
      this.publishRoomCloud(t);
      return t;
    }

    // Fallback 2: Automatically initialize the room on the cloud broker so old room codes/links always work!
    const hostId = currentUser.id !== 'anon' ? currentUser.id : uuid();
    const hostNick = currentUser.nickname && currentUser.nickname !== 'Guest' ? currentUser.nickname : '포커';
    const created = new LocalPokerTable(norm, `${hostNick}의 테이블`, hostId, '');
    if (currentUser.id !== 'anon') {
      created.join(currentUser.id, currentUser.nickname, 100 * created.bb);
    }
    this.hostedTables.set(norm, created);
    this.savePersistedTables();
    this.publishRoomCloud(created);
    return created;
  }

  private loadPersistedState(): void {
    try {
      const rawTables = localStorage.getItem(STORAGE_TABLES_KEY);
      if (rawTables) {
        const parsed = JSON.parse(rawTables) as Record<string, Record<string, unknown>>;
        for (const [code, data] of Object.entries(parsed)) {
          const table = LocalPokerTable.fromJSON(data);
          this.hostedTables.set(code.toUpperCase(), table);
        }
      }
    } catch {}
    try {
      const rawSnaps = localStorage.getItem(STORAGE_SNAPSHOTS_KEY);
      if (rawSnaps) {
        const parsed = JSON.parse(rawSnaps) as Record<string, { table: Table; history: Review[]; updatedAt: number }>;
        for (const [code, snap] of Object.entries(parsed)) {
          if (snap?.table) this.savedSnapshots.set(code.toUpperCase(), snap);
        }
      }
    } catch {}
  }

  private savePersistedTables(): void {
    try {
      const entries = [...this.hostedTables.entries()]
        .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
        .slice(0, 15);
      const obj: Record<string, unknown> = {};
      for (const [code, t] of entries) {
        obj[code] = t.toJSON();
      }
      localStorage.setItem(STORAGE_TABLES_KEY, JSON.stringify(obj));
    } catch {}
  }

  private saveClientSnapshot(table: Table, history?: Review[]): void {
    try {
      const code = table.code.toUpperCase();
      const existing = this.savedSnapshots.get(code);
      this.savedSnapshots.set(code, {
        table,
        history: history ?? existing?.history ?? [],
        updatedAt: Date.now(),
      });
      const entries = [...this.savedSnapshots.entries()]
        .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
        .slice(0, 15);
      const obj: Record<string, unknown> = {};
      for (const [c, snap] of entries) obj[c] = snap;
      localStorage.setItem(STORAGE_SNAPSHOTS_KEY, JSON.stringify(obj));
    } catch {}
  }

  getSavedRooms(): SavedRoomSummary[] {
    const map = new Map<string, SavedRoomSummary>();
    for (const [code, snap] of this.savedSnapshots.entries()) {
      const tbl = snap.table;
      map.set(code, {
        code,
        name: tbl.name,
        sb: tbl.sb,
        bb: tbl.bb,
        hand: tbl.hand,
        updatedAt: snap.updatedAt,
        players: tbl.players.map(p => ({ nickname: p.nickname, bounty: p.bounty, stack: p.stack })),
      });
    }
    for (const [code, t] of this.hostedTables.entries()) {
      const allPlayers = [...t.players, ...t.archivedPlayers];
      map.set(code, {
        code,
        name: t.name,
        sb: t.sb,
        bb: t.bb,
        hand: t.hand,
        updatedAt: t.updatedAt,
        players: allPlayers.map(p => ({ nickname: p.nickname, bounty: p.bountyUnits / BOUNTY_UNITS, stack: p.stack })),
      });
    }
    return [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  removeSavedRoom(code: string): void {
    const norm = code.trim().toUpperCase();
    this.hostedTables.delete(norm);
    this.savedSnapshots.delete(norm);
    this.savePersistedTables();
    try {
      const obj: Record<string, unknown> = {};
      for (const [c, snap] of this.savedSnapshots.entries()) obj[c] = snap;
      localStorage.setItem(STORAGE_SNAPSHOTS_KEY, JSON.stringify(obj));
    } catch {}
  }

  onUpdate(fn: (table?: Table) => void): () => void {
    this.updateListeners.add(fn);
    return () => this.updateListeners.delete(fn);
  }

  private emitUpdate(table?: Table): void {
    if (table) this.saveClientSnapshot(table);
    this.updateListeners.forEach(fn => fn(table));
  }

  private getUser(): User | null {
    try {
      const raw = localStorage.getItem('river:p2p:user') ?? sessionStorage.getItem('river:p2p:user');
      if (!raw) return null;
      const parsed = JSON.parse(raw) as User;
      sessionStorage.setItem('river:p2p:user', raw);
      localStorage.setItem('river:p2p:user', raw);
      return parsed;
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
    const t = this.hostedTables.get(code);
    if (!t) return;
    t.updatedAt = Date.now();
    this.savePersistedTables();
    this.publishRoomCloud(t);
    this.bc?.postMessage({ type: 'state', code, raw: t.toJSON() });

    const hostUser = this.getUser();
    let hostView: Table | undefined;
    if (hostUser && t.players.some(p => p.id === hostUser.id)) {
      try { hostView = t.view(hostUser.id); } catch {}
    }
    if (hostView) this.saveClientSnapshot(hostView, t.history);
    this.emitUpdate(hostView);
  }

  private handleLocalRpc(req: RpcRequest): RpcResponse {
    try {
      const code = this.extractCode(req.path)!;
      const t = this.hostedTables.get(code);
      if (!t) throw new Error('방 코드를 확인해주세요');
      this.subscribeRoomCloud(code);

      if (req.path.startsWith('/api/invitations/')) {
        const info: InvitationInfo = {
          code: t.code,
          name: t.name,
          playerCount: t.players.length,
          capacity: 6,
          sb: t.sb,
          bb: t.bb,
          passwordRequired: false,
          running: t.running(),
        };
        return { id: req.id, ok: true, data: info };
      }

      const sub = req.path.replace(new RegExp(`^/api/rooms/${code}`, 'i'), '');
      const body = (req.body ?? {}) as Record<string, unknown>;

      if (sub === '') {
        if (req.userId && req.userId !== 'anon' && !t.players.some(p => p.id === req.userId)) {
          t.join(req.userId, req.nickname || 'Player', 100 * t.bb);
          this.broadcastTableUpdate(code);
        }
        const view = t.view(req.userId);
        this.savePersistedTables();
        return { id: req.id, ok: true, data: view };
      }
      if (sub === '/join') {
        const nick = String(body.nickname ?? req.nickname).trim();
        t.join(req.userId, nick, 100 * t.bb);
        this.broadcastTableUpdate(code);
        return { id: req.id, ok: true, data: t.view(req.userId) };
      }
      if (sub === '/chat') {
        t.chat(req.userId, String(body.text ?? ''));
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
        if (req.userId && req.userId !== 'anon' && !t.players.some(p => p.id === req.userId)) {
          return { id: req.id, ok: true, data: [...t.history] };
        }
        return { id: req.id, ok: true, data: [...t.history] };
      }
      throw new Error('지원하지 않는 요청입니다');
    } catch (e) {
      return { id: req.id, ok: false, error: e instanceof Error ? e.message : '요청 실패' };
    }
  }

  private promoteSnapshotToHosted(code: string, currentUser: User): boolean {
    if (this.hostedTables.has(code)) return true;
    const snap = this.savedSnapshots.get(code);
    if (!snap?.table) return false;
    const restored = LocalPokerTable.fromTableSnapshot(snap.table, snap.history);
    if (currentUser.id !== 'anon') {
      restored.host = currentUser.id;
      restored.join(currentUser.id, currentUser.nickname, 100 * restored.bb);
    }
    this.hostedTables.set(code, restored);
    this.savePersistedTables();
    return true;
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
      this.subscribeRoomCloud(code);
      this.broadcastTableUpdate(code);
      const view = table.view(user.id);
      return view as T;
    }

    const code = this.extractCode(path);
    if (!code) throw new Error('잘못된 경로입니다');
    const user = this.getUser() ?? { id: 'anon', nickname: 'Guest' };
    const req: RpcRequest = body === undefined
      ? { id: uuid(), userId: user.id, nickname: user.nickname, path }
      : { id: uuid(), userId: user.id, nickname: user.nickname, path, body };

    await this.ensureRoomLoaded(code, user);
    const res = this.handleLocalRpc(req);
    if (!res.ok) throw new Error(res.error);
    return res.data as T;
  }
}

export const serverless = new ServerlessCoordinator();
