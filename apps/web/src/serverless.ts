import Peer, { DataConnection } from 'peerjs';
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
      log: this.log,
      chatLog: this.chatLog,
      history: this.history,
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

// --- P2P WebRTC (PeerJS) + BroadcastChannel Serverless Coordinator ---
type RpcRequest = { id: string; userId: string; nickname: string; path: string; body?: unknown };
type RpcResponse = { id: string; ok: boolean; data?: unknown; error?: string };

const STORAGE_TABLES_KEY = 'river:p2p:tables:v1';
const STORAGE_SNAPSHOTS_KEY = 'river:p2p:snapshots:v1';

class ServerlessCoordinator {
  private hostedTables = new Map<string, LocalPokerTable>();
  private savedSnapshots = new Map<string, { table: Table; history: Review[]; updatedAt: number }>();
  private hostPeers = new Map<string, Peer>();
  private hostPeerRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private connUsers = new Map<DataConnection, string>();
  private clientConns = new Map<string, DataConnection>();
  private clientConnPromises = new Map<string, Promise<DataConnection>>();
  private clientPeer: Peer | null = null;
  private clientPeerPromise: Promise<Peer> | null = null;
  private remoteRooms = new Set<string>();
  private pendingRpc = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private updateListeners = new Set<(table?: Table) => void>();
  private bc: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('river-club-p2p') : null;

  constructor() {
    this.loadPersistedState();
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
    }, 300);
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
    try {
      const activeCode = (sessionStorage.getItem('river:room') || localStorage.getItem('river:room') || '').trim().toUpperCase();
      if (activeCode && this.hostedTables.has(activeCode)) {
        this.setupHostPeer(activeCode);
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
    const peer = this.hostPeers.get(norm);
    if (peer) {
      try { peer.destroy(); } catch {}
      this.hostPeers.delete(norm);
    }
    const timer = this.hostPeerRetryTimers.get(norm);
    if (timer) {
      clearTimeout(timer);
      this.hostPeerRetryTimers.delete(norm);
    }
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
    if (t) {
      t.updatedAt = Date.now();
      this.savePersistedTables();
    }
    const hostUser = this.getUser();
    let hostView: Table | undefined;
    if (t && hostUser && t.players.some(p => p.id === hostUser.id)) {
      try { hostView = t.view(hostUser.id); } catch {}
    }
    if (hostView && t) this.saveClientSnapshot(hostView, t.history);
    this.emitUpdate(hostView);
    this.bc?.postMessage({ type: 'notify', code });
    const peer = this.hostPeers.get(code);
    if (peer && t) {
      Object.values(peer.connections).flat().forEach((conn: unknown) => {
        const dc = conn as DataConnection;
        if (dc && dc.open) {
          const uid = this.connUsers.get(dc);
          let view: Table | undefined;
          if (uid && t.players.some(p => p.id === uid)) {
            try { view = t.view(uid); } catch {}
          }
          dc.send({ type: 'notify', code, table: view });
        }
      });
    }
  }

  private scheduleHostPeerRetry(code: string, delayMs = 2000): void {
    if (this.hostPeerRetryTimers.has(code) || !this.hostedTables.has(code)) return;
    const timer = setTimeout(() => {
      this.hostPeerRetryTimers.delete(code);
      if (this.hostedTables.has(code)) this.setupHostPeer(code);
    }, delayMs);
    this.hostPeerRetryTimers.set(code, timer);
  }

  private setupHostPeer(code: string): void {
    const existing = this.hostPeers.get(code);
    if (existing && !existing.destroyed) {
      if (existing.disconnected) {
        try { existing.reconnect(); } catch {}
      }
      return;
    }
    this.hostPeers.delete(code);
    try {
      const peer = new Peer(`river-club-room-${code}`);
      peer.on('disconnected', () => {
        if (!peer.destroyed) {
          try { peer.reconnect(); } catch {}
        }
      });
      peer.on('error', () => {
        if (this.hostPeers.get(code) === peer) this.hostPeers.delete(code);
        try { peer.destroy(); } catch {}
        this.scheduleHostPeerRetry(code, 2200);
      });
      peer.on('close', () => {
        if (this.hostPeers.get(code) === peer) this.hostPeers.delete(code);
        this.scheduleHostPeerRetry(code, 2200);
      });
      peer.on('connection', conn => {
        conn.on('data', raw => {
          const msg = raw as { type?: string; req?: RpcRequest };
          if (msg?.type === 'rpc-req' && msg.req) {
            if (msg.req.userId && msg.req.userId !== 'anon') {
              this.connUsers.set(conn, msg.req.userId);
            }
            const res = this.handleLocalRpc(msg.req);
            conn.send({ type: 'rpc-res', res });
          }
        });
        conn.on('close', () => {
          this.connUsers.delete(conn);
        });
      });
      this.hostPeers.set(code, peer);
    } catch {
      this.scheduleHostPeerRetry(code, 2500);
    }
  }

  private async ensureClientPeer(): Promise<Peer> {
    if (this.clientPeer && !this.clientPeer.destroyed) {
      if (this.clientPeer.disconnected) {
        try { this.clientPeer.reconnect(); } catch {}
      }
      if (this.clientPeer.open) return this.clientPeer;
    }
    if (this.clientPeerPromise) return this.clientPeerPromise;
    this.clientPeerPromise = new Promise<Peer>((resolve, reject) => {
      const p = new Peer();
      const timer = setTimeout(() => {
        this.clientPeerPromise = null;
        reject(new Error('P2P 신호 서버 연결 시간 초과'));
      }, 6000);
      p.once('open', () => {
        clearTimeout(timer);
        this.clientPeer = p;
        this.clientPeerPromise = null;
        resolve(p);
      });
      p.once('error', err => {
        clearTimeout(timer);
        this.clientPeerPromise = null;
        reject(err);
      });
    });
    return this.clientPeerPromise;
  }

  private async getClientConn(code: string): Promise<DataConnection> {
    const existing = this.clientConns.get(code);
    if (existing && existing.open) return existing;
    const inflight = this.clientConnPromises.get(code);
    if (inflight) return inflight;

    const promise = (async () => {
      let lastErr: unknown;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const peer = await this.ensureClientPeer();
          const conn = peer.connect(`river-club-room-${code}`, { reliable: true, serialization: 'json' });
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
              try { conn.close(); } catch {}
              reject(new Error('방 호스트와 연결하지 못했습니다. 잠시 후 다시 시도하거나 방을 다시 열어주세요.'));
            }, 4500);
            conn.once('open', () => { clearTimeout(timer); resolve(); });
            conn.once('error', err => { clearTimeout(timer); reject(err); });
          });
          conn.on('data', raw => {
            const msg = raw as { type?: string; table?: Table; res?: RpcResponse };
            if (msg?.type === 'notify') {
              this.emitUpdate(msg.table);
            } else if (msg?.type === 'rpc-res' && msg.res) {
              const pending = this.pendingRpc.get(msg.res.id);
              if (pending) {
                this.pendingRpc.delete(msg.res.id);
                if (msg.res.ok) pending.resolve(msg.res.data);
                else pending.reject(new Error(msg.res.error ?? '요청 실패'));
              }
            }
          });
          conn.on('close', () => {
            if (this.clientConns.get(code) === conn) this.clientConns.delete(code);
          });
          conn.on('error', () => {
            if (this.clientConns.get(code) === conn) this.clientConns.delete(code);
          });
          this.clientConns.set(code, conn);
          this.remoteRooms.add(code);
          return conn;
        } catch (err) {
          lastErr = err;
          if (attempt < 2) await new Promise(r => setTimeout(r, 1200));
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error('방 호스트와 연결하지 못했습니다');
    })();

    this.clientConnPromises.set(code, promise);
    try {
      return await promise;
    } finally {
      this.clientConnPromises.delete(code);
    }
  }

  private handleLocalRpc(req: RpcRequest): RpcResponse {
    try {
      const code = this.extractCode(req.path)!;
      const t = this.hostedTables.get(code);
      if (!t) throw new Error('방 코드를 확인해주세요');
      this.setupHostPeer(code);

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
        t.member(req.userId);
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
    this.remoteRooms.delete(code);
    this.savePersistedTables();
    this.setupHostPeer(code);
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
      this.savePersistedTables();
      this.setupHostPeer(code);
      const view = table.view(user.id);
      this.saveClientSnapshot(view, table.history);
      return view as T;
    }

    const code = this.extractCode(path);
    if (!code) throw new Error('잘못된 경로입니다');
    const user = this.getUser() ?? { id: 'anon', nickname: 'Guest' };
    const req: RpcRequest = body === undefined
      ? { id: uuid(), userId: user.id, nickname: user.nickname, path }
      : { id: uuid(), userId: user.id, nickname: user.nickname, path, body };

    // 1. Hosted in current tab
    if (this.hostedTables.has(code)) {
      const res = this.handleLocalRpc(req);
      if (!res.ok) throw new Error(res.error);
      return res.data as T;
    }

    // 2. Try same-browser BroadcastChannel first (unless already connected via remote P2P)
    if (this.bc && !this.remoteRooms.has(code)) {
      try {
        const data = await new Promise<unknown>((resolve, reject) => {
          const timer = setTimeout(() => {
            this.pendingRpc.delete(req.id);
            reject(new Error('bc-timeout'));
          }, 150);
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

    // 3. Remote P2P via PeerJS WebRTC (with automatic local snapshot fallback if host is offline)
    try {
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
      if (data && typeof data === 'object' && 'code' in (data as Record<string, unknown>) && 'players' in (data as Record<string, unknown>)) {
        this.saveClientSnapshot(data as Table);
      }
      return data as T;
    } catch (err) {
      if (this.promoteSnapshotToHosted(code, user)) {
        const res = this.handleLocalRpc(req);
        if (!res.ok) throw new Error(res.error);
        return res.data as T;
      }
      throw err;
    }
  }
}

export const serverless = new ServerlessCoordinator();
