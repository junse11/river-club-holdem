import { describe, expect, it } from 'vitest';
import { BOUNTY_UNITS, LocalPokerTable, evaluateHand, handLabel } from './engine';
import type { InternalPlayer } from './engine';

type Spec = { id: string; stack: number; committed: number; cards: string[]; folded?: boolean };

function makePlayer(seat: number, s: Spec): InternalPlayer {
  return {
    id: s.id, nickname: s.id, seat, stack: s.stack, bet: 0, committed: s.committed,
    bountyUnits: 0, bountyLog: [], lastActedAt: -1, ready: true,
    folded: Boolean(s.folded), inHand: true, leaving: false, showdown: false,
    position: 'BTN', cards: s.cards,
  };
}

/** 리버에서 정산 직전 상태를 직접 주입한다. */
function setup(specs: Spec[], board: string[], host = specs[0].id): LocalPokerTable {
  const t = new LocalPokerTable('TESTCODE', 'test', host);
  t.players = specs.map((s, i) => makePlayer(i, s));
  t.board = board;
  t.street = 'RIVER';
  t.button = 0;
  t.hand = 1;
  t.bb = 100;
  t.sb = 50;
  return t;
}

const total = (t: LocalPokerTable) => t.players.reduce((s, p) => s + p.stack, 0);
const BOARD = ['2C', '7D', '9H', '11S', '13C'];
const byId = (t: LocalPokerTable, id: string) => t.players.find(p => p.id === id)!;

describe('운영자 즉시 초기화', () => {
  it('핸드 중 칩 초기화는 팟을 취소하고 바운티를 보존한다', () => {
    const t = setup([{ id: 'host', stack: 1200, committed: 300, cards: ['14H', '14D'] }, { id: 'guest', stack: 900, committed: 600, cards: ['13H', '13D'] }], BOARD);
    t.players[0].bountyUnits = BOUNTY_UNITS;
    t.pending.add('guest'); t.actor = 1; t.deadline = Date.now() + 30000;
    t.runoutAt = Date.now() + 1000; t.nextHandAt = Date.now() + 5000;
    t.paused = true; t.pausedDeadlineRem = 10000; t.pausedRunoutRem = 1000; t.pausedNextHandRem = 5000;
    t.pendingBb = 200; t.pendingSb = 100; t.resetPending = true;
    t.resetStacks('host');
    expect(t.street).toBe('WAITING');
    expect(t.players.every(p => p.stack === 10000 && p.bet === 0 && p.committed === 0 && p.cards.length === 0 && !p.ready && !p.inHand)).toBe(true);
    expect(t.players[0].bountyUnits).toBe(BOUNTY_UNITS);
    expect([t.deadline,t.runoutAt,t.nextHandAt,t.pausedDeadlineRem,t.pausedRunoutRem,t.pausedNextHandRem]).toEqual([0,0,0,0,0,0]);
    expect(t.pending.size).toBe(0); expect(t.actor).toBe(-1); expect(t.board).toEqual([]);
    expect(t.resetPending).toBe(false); expect(t.paused).toBe(true); expect(t.pendingBb).toBe(200);
    expect(t.tick(Date.now()+60000)).toBe(false);
    const restored = LocalPokerTable.fromJSON(t.toJSON());
    expect(restored.players[0].stack).toBe(10000);
    expect(restored.players[0].bountyUnits).toBe(BOUNTY_UNITS);
  });

  it('바운티 초기화는 현재 핸드를 유지하고 퇴장자의 점수도 지운다', () => {
    const t = setup([{ id: 'host', stack: 1200, committed: 300, cards: ['14H', '14D'] }, { id: 'guest', stack: 900, committed: 600, cards: ['13H', '13D'] }], BOARD);
    t.players[0].bountyUnits = BOUNTY_UNITS;
    t.players[0].bountyLog = [{ victimNickname: 'guest', units: BOUNTY_UNITS }];
    t.archivedPlayers = [{ ...t.players[0], id: 'old' }];
    t.deadline = 12345; t.actor = 1;
    const before = t.toJSON();
    t.resetBounties('host');
    expect([...t.players,...t.archivedPlayers].every(p => p.bountyUnits === 0 && p.bountyLog.length === 0)).toBe(true);
    expect(t.board).toEqual(before.board); expect(t.street).toBe('RIVER');
    expect(t.players[0].stack).toBe(1200); expect(t.players[0].committed).toBe(300);
    expect(t.players[0].cards).toEqual(['14H','14D']); expect(t.deadline).toBe(12345); expect(t.actor).toBe(1);
  });

  it('일반 참가자의 초기화는 상태를 바꾸지 않는다', () => {
    const t = setup([{ id: 'host', stack: 1200, committed: 300, cards: ['14H', '14D'] }, { id: 'guest', stack: 900, committed: 600, cards: ['13H', '13D'] }], BOARD);
    const before = JSON.stringify(t.toJSON());
    expect(() => t.resetStacks('guest')).toThrow('방장만');
    expect(() => t.resetBounties('guest')).toThrow('방장만');
    expect(JSON.stringify(t.toJSON())).toBe(before);
  });
});

describe('핸드 평가 (ENG-001~006)', () => {
  it('9개 족보가 오름차순으로 평가된다', () => {
    const hands = [
      ['14H', '12D', '9S', '7C', '4D', '3H', '2C'], // high card
      ['14H', '14D', '9S', '7C', '4D', '3H', '2C'], // pair
      ['14H', '14D', '9S', '9C', '4D', '3H', '2C'], // two pair
      ['14H', '14D', '14S', '7C', '4D', '3H', '2C'], // trips
      ['6H', '5D', '4S', '3C', '2D', '13H', '11C'], // straight
      ['14H', '12H', '9H', '7H', '4H', '3D', '2C'], // flush
      ['14H', '14D', '14S', '9C', '9D', '3H', '2C'], // full house
      ['14H', '14D', '14S', '14C', '9D', '3H', '2C'], // quads
      ['9H', '8H', '7H', '6H', '5H', '3D', '2C'], // straight flush
    ].map(h => evaluateHand(h));
    for (let i = 1; i < hands.length; i++) expect(hands[i]).toBeGreaterThan(hands[i - 1]);
    expect(handLabel(hands[8])).toBe('Straight Flush');
  });

  it('A-2-3-4-5 휠은 5-high 스트레이트이며 6-high보다 약하다', () => {
    const wheel = evaluateHand(['14H', '2D', '3S', '4C', '5D', '9H', '11C']);
    const six = evaluateHand(['6H', '2D', '3S', '4C', '5D', '9H', '11C']);
    expect(handLabel(wheel)).toBe('Straight');
    expect(six).toBeGreaterThan(wheel);
  });

  it('키커로 승자가 갈린다', () => {
    const a = evaluateHand(['14H', '14D', '13S', '7C', '4D', '3H', '2C']);
    const b = evaluateHand(['14S', '14C', '12S', '7D', '4C', '3D', '2D']);
    expect(a).toBeGreaterThan(b);
  });

  it('보드 플레이면 동점이다', () => {
    const board = ['10H', '11H', '12H', '13H', '14H'];
    expect(evaluateHand([...board, '2C', '3D'])).toBe(evaluateHand([...board, '4C', '5D']));
  });
});

describe('팟 분배 (ENG-007~012)', () => {
  it('2인 올인: 승자가 팟 전액을 가져간다', () => {
    const t = setup([
      { id: 'A', stack: 0, committed: 100, cards: ['14H', '14S'] },
      { id: 'B', stack: 0, committed: 100, cards: ['12H', '12S'] },
    ], BOARD);
    t.settle();
    expect(byId(t, 'A').stack).toBe(200);
    expect(byId(t, 'B').stack).toBe(0);
  });

  it('3인 올인: 메인팟/사이드팟/콜 안 받은 베팅을 정확히 분배한다', () => {
    const t = setup([
      { id: 'A', stack: 0, committed: 100, cards: ['14H', '14S'] },
      { id: 'B', stack: 0, committed: 200, cards: ['12H', '12S'] },
      { id: 'C', stack: 0, committed: 300, cards: ['3H', '4S'] },
    ], BOARD);
    t.settle();
    expect(byId(t, 'A').stack).toBe(300); // 메인팟
    expect(byId(t, 'B').stack).toBe(200); // 사이드팟
    expect(byId(t, 'C').stack).toBe(100); // uncalled bet 반환
  });

  it('홀수 칩 분할 시 총합이 보존된다', () => {
    const t = setup([
      { id: 'A', stack: 0, committed: 51, cards: ['14H', '14S'] },
      { id: 'B', stack: 0, committed: 50, cards: ['14D', '14C'] },
      { id: 'C', stack: 0, committed: 50, cards: ['3H', '4S'] },
    ], ['2C', '7D', '9H', '11S', '13C']);
    const before = total(t) + t.players.reduce((s, p) => s + p.committed, 0);
    t.settle();
    expect(total(t)).toBe(before);
  });

  it('불변식: 랜덤 200핸드에서 칩이 생성/소멸하지 않는다', () => {
    for (let iter = 0; iter < 200; iter++) {
      const deck: string[] = [];
      for (const s of ['C', 'D', 'H', 'S']) for (let r = 2; r <= 14; r++) deck.push(`${r}${s}`);
      for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }
      const n = 2 + Math.floor(Math.random() * 5);
      const specs: Spec[] = Array.from({ length: n }, (_, i) => ({
        id: `P${i}`,
        stack: Math.random() < 0.5 ? 0 : Math.floor(Math.random() * 500),
        committed: 20 + Math.floor(Math.random() * 400),
        cards: [deck.pop()!, deck.pop()!],
        folded: false,
      }));
      specs[0].folded = n > 2 && Math.random() < 0.3;
      const t = setup(specs, [deck.pop()!, deck.pop()!, deck.pop()!, deck.pop()!, deck.pop()!]);
      const before = total(t) + t.players.reduce((s, p) => s + p.committed, 0);
      t.settle();
      expect(total(t)).toBe(before);
    }
  });
});

describe('바운티 규칙: 쇼다운 1등만 획득 (BNT)', () => {
  it('BNT-001: 2인 올인, 승자가 패자의 바운티를 획득한다', () => {
    const t = setup([
      { id: 'A', stack: 0, committed: 100, cards: ['14H', '14S'] },
      { id: 'B', stack: 0, committed: 100, cards: ['12H', '12S'] },
    ], BOARD);
    t.settle();
    expect(byId(t, 'A').bountyUnits).toBe(BOUNTY_UNITS);
    expect(byId(t, 'B').bountyUnits).toBe(0);
    expect(t.bountyAwards).toHaveLength(1);
    expect(t.bountyAwards[0].victimId).toBe('B');
  });

  it('BNT-002: 3인 올인, 1등만 두 탈락자의 바운티를 가져간다 (2등은 못 가져감)', () => {
    const t = setup([
      { id: 'A', stack: 0, committed: 300, cards: ['14H', '14S'] },
      { id: 'B', stack: 0, committed: 300, cards: ['12H', '12S'] },
      { id: 'C', stack: 0, committed: 300, cards: ['3H', '4S'] },
    ], BOARD);
    t.settle();
    expect(byId(t, 'A').bountyUnits).toBe(BOUNTY_UNITS * 2);
    expect(byId(t, 'B').bountyUnits).toBe(0);
    expect(byId(t, 'C').bountyUnits).toBe(0);
    expect(t.bountyAwards).toHaveLength(2);
  });

  it('BNT-003: 1등이 숏스택이고 사이드팟은 2등이 이겨도, 탈락자 바운티는 전체 1등이 획득한다', () => {
    const t = setup([
      { id: 'A', stack: 0, committed: 100, cards: ['14H', '14S'] }, // 최강, 숏스택
      { id: 'B', stack: 0, committed: 300, cards: ['12H', '12S'] }, // 사이드팟 승자
      { id: 'C', stack: 0, committed: 300, cards: ['3H', '4S'] }, // 탈락
    ], BOARD);
    t.settle();
    expect(byId(t, 'B').stack).toBeGreaterThan(0);
    expect(byId(t, 'C').stack).toBe(0);
    expect(byId(t, 'A').bountyUnits).toBe(BOUNTY_UNITS);
    expect(byId(t, 'B').bountyUnits).toBe(0);
  });

  it('BNT-004: 1등 동점이면 바운티를 균등 분배한다', () => {
    const t = setup([
      { id: 'A', stack: 0, committed: 100, cards: ['14H', '14S'] },
      { id: 'B', stack: 0, committed: 100, cards: ['14D', '14C'] },
      { id: 'C', stack: 0, committed: 100, cards: ['3H', '4S'] },
    ], ['3C', '8D', '9H', '11S', '13C']);
    t.settle();
    expect(byId(t, 'A').bountyUnits).toBe(BOUNTY_UNITS / 2);
    expect(byId(t, 'B').bountyUnits).toBe(BOUNTY_UNITS / 2);
  });

  it('BNT-005: 올인했지만 이긴 플레이어는 바운티 대상이 아니다', () => {
    const t = setup([
      { id: 'A', stack: 0, committed: 100, cards: ['14H', '14S'] },
      { id: 'B', stack: 0, committed: 100, cards: ['12H', '12S'] },
    ], BOARD);
    t.settle();
    expect(t.bountyAwards.some(a => a.victimId === 'A')).toBe(false);
  });

  it('BNT-006: 폴드로 1명만 남으면 바운티도 쇼다운도 없다', () => {
    const t = setup([
      { id: 'A', stack: 0, committed: 100, cards: ['14H', '14S'] },
      { id: 'B', stack: 50, committed: 50, cards: ['12H', '12S'], folded: true },
    ], BOARD);
    t.settle();
    expect(t.bountyAwards).toHaveLength(0);
    expect(t.players.some(p => p.showdown)).toBe(false);
  });

  it('BNT-008: 같은 피해자 바운티는 bountyLog에 누적된다', () => {
    const t = setup([
      { id: 'A', stack: 0, committed: 100, cards: ['14H', '14S'] },
      { id: 'B', stack: 0, committed: 100, cards: ['12H', '12S'] },
    ], BOARD);
    t.settle();
    t.street = 'RIVER';
    t.players.forEach(p => { p.stack = 0; p.committed = 100; p.folded = false; p.inHand = true; });
    t.settle();
    const log = byId(t, 'A').bountyLog.filter(b => b.victimNickname === 'B');
    expect(log).toHaveLength(1);
    expect(log[0].units).toBe(BOUNTY_UNITS * 2);
  });
});

describe('쇼다운 / 일시정지 / 권한', () => {
  it('마지막 올인 콜 직후 폴드한 사람을 제외하고 보드가 깔리기 전에 패를 공개한다', () => {
    const t = setup([
      { id: 'A', stack: 100, committed: 0, cards: ['14H', '14S'] },
      { id: 'B', stack: 0, committed: 100, cards: ['12H', '12S'] },
      { id: 'C', stack: 900, committed: 100, cards: ['6H', '6S'], folded: true },
    ], []);
    t.street = 'PREFLOP'; t.actor = 0; t.currentBet = 100; t.players[1].bet = 100;
    t.pending.add('A');
    t.deck = ['3C','2C','7D','9H','4D','11S','5D','13C'];
    t.action('A', 'CALL', undefined, t.version, t.hand);
    expect(t.board).toEqual([]); expect(t.actor).toBe(-1); expect(t.runoutAt).toBeGreaterThan(0);
    expect(t.view('C').players.find(p=>p.id==='A')?.cards).toEqual(['14H','14S']);
    expect(t.view('A').players.find(p=>p.id==='B')?.cards).toEqual(['12H','12S']);
    expect(t.view('A').players.find(p=>p.id==='C')?.cards).toEqual([]);
    const restored = LocalPokerTable.fromJSON(t.toJSON());
    expect(restored.view('A').players.find(p=>p.id==='B')?.cards).toEqual(['12H','12S']);
    for (let i=0;i<4;i++) t.tick(t.runoutAt+1);
    expect(t.street).toBe('SETTLED'); expect(t.board).toHaveLength(5);
    expect(t.view('A').players.find(p=>p.id==='B')?.cards).toEqual(['12H','12S']);
    expect(() => t.showdown('B',false)).toThrow();
  });

  it('콜 또는 폴드할 플레이어가 남아 있으면 올인 패를 미리 공개하지 않는다', () => {
    const t = setup([
      { id: 'A', stack: 100, committed: 0, cards: ['14H','14S'] },
      { id: 'B', stack: 0, committed: 100, cards: ['12H','12S'] },
      { id: 'C', stack: 900, committed: 0, cards: ['6H','6S'] },
    ], []);
    t.street='PREFLOP'; t.actor=0; t.currentBet=100; t.players[1].bet=100;
    t.pending.add('A'); t.pending.add('C');
    t.action('A','CALL',undefined,t.version,t.hand);
    expect(t.runoutAt).toBe(0);
    expect(t.view('C').players.find(p=>p.id==='A')?.cards).toEqual([]);
    expect(t.view('C').players.find(p=>p.id==='B')?.cards).toEqual([]);
  });

  it('SHD-001: 2인 이상 베팅 종료 시 이긴 사람이 강제 쇼다운된다', () => {
    const t = setup([
      { id: 'A', stack: 0, committed: 100, cards: ['14H', '14S'] },
      { id: 'B', stack: 0, committed: 100, cards: ['12H', '12S'] },
    ], BOARD);
    t.settle();
    expect(byId(t, 'A').showdown).toBe(true);
    expect(t.street).toBe('SETTLED');
  });

  it('ROOM-006/007: 방장만 일시정지할 수 있고, 일시정지 중에는 액션/타이머가 멈춘다', () => {
    const t = setup([
      { id: 'A', stack: 900, committed: 100, cards: ['14H', '14S'] },
      { id: 'B', stack: 900, committed: 100, cards: ['12H', '12S'] },
    ], [], 'A');
    t.street = 'PREFLOP';
    t.actor = 0;
    t.currentBet = 100;
    t.deadline = Date.now() - 1000;
    expect(() => t.pause('B')).toThrow();
    t.pause('A');
    expect(t.paused).toBe(true);
    expect(t.allowed('A')).toEqual([]);
    expect(t.tick(Date.now() + 60000)).toBe(false);
    t.pause('A');
    expect(t.paused).toBe(false);
  });

  it('ROOM-006: 방장이 아니면 강퇴할 수 없다', () => {
    const t = setup([
      { id: 'A', stack: 900, committed: 0, cards: [] },
      { id: 'B', stack: 900, committed: 0, cards: [] },
    ], [], 'A');
    t.street = 'WAITING';
    expect(() => t.kick('B', 'A')).toThrow();
    t.kick('A', 'B');
    expect(t.players.map(p => p.id)).toEqual(['A']);
    expect(t.kickedIds.has('B')).toBe(true);
  });

  it('TMR-001: 시간 초과 시 체크 불가면 폴드된다', () => {
    const t = setup([
      { id: 'A', stack: 900, committed: 100, cards: ['14H', '14S'] },
      { id: 'B', stack: 900, committed: 100, cards: ['12H', '12S'] },
    ], []);
    t.street = 'PREFLOP';
    t.actor = 0;
    t.currentBet = 100;
    byId(t, 'A').bet = 0;
    t.pending = new Set(['A', 'B']);
    t.deadline = Date.now() - 1000;
    expect(t.tick(Date.now())).toBe(true);
    expect(byId(t, 'A').folded).toBe(true);
  });
});

describe('보안 / 공정성 (SEC)', () => {
  it('SEC-002: view()는 본인 홀카드만 노출한다', () => {
    const t = setup([
      { id: 'A', stack: 900, committed: 100, cards: ['14H', '14S'] },
      { id: 'B', stack: 900, committed: 100, cards: ['12H', '12S'] },
    ], BOARD);
    const view = t.view('A');
    expect(view.players.find(p => p.id === 'A')!.cards).toEqual(['14H', '14S']);
    expect(view.players.find(p => p.id === 'B')!.cards).toEqual([]);
  });

  // 알려진 취약점(R1): toJSON()이 모든 홀카드/덱을 공개 MQTT 토픽으로 내보낸다. Phase 2에서 해결하면 it.fails → it 으로 전환.
  it.fails('SEC-001: 공개 직렬화에는 타인의 홀카드/덱이 포함되면 안 된다', () => {
    const t = setup([
      { id: 'A', stack: 900, committed: 100, cards: ['14H', '14S'] },
      { id: 'B', stack: 900, committed: 100, cards: ['12H', '12S'] },
    ], BOARD);
    t.deck = ['5C', '6D'];
    const json = JSON.stringify(t.toJSON());
    expect(json).not.toContain('12S');
    expect(json).not.toContain('5C');
  });
});
