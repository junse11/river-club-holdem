import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DEAL, boardTimeline } from './dealTimeline';

const param = () => ({
  value: 0,
  setValueAtTime() {},
  linearRampToValueAtTime() {},
  exponentialRampToValueAtTime() {},
});
const node = () => ({ connect() {}, start() {}, stop() {}, frequency: param(), gain: param(), Q: param(), type: '' });

class FakeAudioContext {
  static samples: { at: number; duration?: number }[] = [];
  static created = 0;
  constructor() { FakeAudioContext.created++; }
  currentTime = 0;
  sampleRate = 8000;
  state = 'running';
  destination = {};
  resume() { return Promise.resolve(); }
  createBuffer(_c: number, length: number) { return { getChannelData: () => new Float32Array(length) }; }
  createBufferSource() { return { ...node(), buffer: null as unknown, start(at:number,_offset?:number,duration?:number) { if(this.buffer && (this.buffer as {sample?:boolean}).sample) FakeAudioContext.samples.push({at,duration}); } }; }
  decodeAudioData() { return Promise.resolve({sample:true,duration:2}); }
  createBiquadFilter() { return node(); }
  createGain() { return node(); }
  createOscillator() { return node(); }
}

type SoundApi = typeof import('./sound')['sound'];
let sound: SoundApi;
const gestures = new Map<string, () => void>();
const last = () => sound.history.map(e => e.type);

beforeAll(async () => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
  vi.stubGlobal('fetch', vi.fn(async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(8)})));
  vi.stubGlobal('window', { AudioContext: FakeAudioContext, addEventListener(name: string, callback: () => void) { gestures.set(name, callback); } });
  sound = (await import('./sound')).sound;
});

describe('액션 사운드 이벤트 (AUD-001)', () => {
  it('첫 터치에서 오디오를 준비하고 이후 입력으로 컨텍스트를 중복 생성하지 않는다', () => {
    expect(FakeAudioContext.created).toBe(0);
    gestures.get('pointerdown')!();
    expect(FakeAudioContext.created).toBe(1);
    gestures.get('keydown')!();
    expect(FakeAudioContext.created).toBe(1);
  });
  it('액션별로 포커에 맞는 사운드가 재생된다', () => {
    sound.history.length = 0;
    sound.check();
    sound.fold();
    sound.call();
    sound.raise();
    sound.allIn();
    expect(last()).toEqual(['knock', 'muck', 'chipDrop', 'chipStack', 'chipPush']);
  });
});

describe('보드 딜 타임라인 (AUD-002/003)', () => {
  it('플랍·턴·리버 각각 카드 소리가 나고 칩 소리는 섞이지 않는다', () => {
    for (const [from,to,event] of [[0,3,'flop'],[3,4,'turn'],[4,5,'river']] as const) {
      sound.history.length=0;
      sound.dealBoard(from,to);
      expect(last()[0]).toBe(event);
      expect(last().filter(t=>t==='deal')).toHaveLength(to-from);
      expect(last().filter(t=>t==='flip')).toHaveLength(to-from);
      expect(last().some(t=>t.startsWith('chip'))).toBe(false);
    }
  });
  it('플랍: 슬라이드 3회가 먼저, 이후 플립이 순차로 이어진다', () => {
    const steps = boardTimeline(0, 3);
    expect(steps).toHaveLength(3);
    expect(steps.map(s => s.slideAt)).toEqual([0, DEAL.slideGap, DEAL.slideGap * 2]);
    expect(steps.map(s => s.flipAt)).toEqual([DEAL.flopFlipStart, DEAL.flopFlipStart + DEAL.flipGap, DEAL.flopFlipStart + DEAL.flipGap * 2]);
    expect(steps[0].flipAt).toBeGreaterThan(steps[2].slideAt);
  });

  it('턴/리버는 한 장씩, 리버가 조금 더 늦게 뒤집힌다', () => {
    expect(boardTimeline(3, 4)).toEqual([{ index: 3, slideAt: 0, flipAt: DEAL.turnFlip }]);
    expect(boardTimeline(4, 5)).toEqual([{ index: 4, slideAt: 0, flipAt: DEAL.riverFlip }]);
  });

  it('올인 런아웃 3초 간격 안에 한 스트리트 연출이 끝난다', () => {
    const flop = boardTimeline(0, 3);
    const end = Math.max(...flop.map(s => s.flipAt)) + 460;
    expect(end).toBeLessThan(3000);
  });

  it('dealBoard가 슬라이드/플립 사운드를 같은 수만큼 기록한다', () => {
    sound.history.length = 0;
    sound.dealBoard(0, 3);
    const types = last();
    expect(types.filter(t => t === 'deal')).toHaveLength(3);
    expect(types.filter(t => t === 'flip')).toHaveLength(3);
    sound.history.length = 0;
    sound.dealBoard(3, 4);
    expect(last().filter(t => t === 'flip')).toHaveLength(1);
  });
});

describe('효과음 끄기 (AUD-005)', () => {
  it('첨부 음원 7개를 미리 읽고 베팅별 샘플을 재생한다', async () => {
    await vi.waitFor(()=>expect(vi.mocked(fetch)).toHaveBeenCalledTimes(7));
    await new Promise(resolve=>setTimeout(resolve,0));
    FakeAudioContext.samples=[];
    sound.call(); sound.raise(); sound.allIn(); sound.dealHand();
    expect(FakeAudioContext.samples.length).toBeGreaterThanOrEqual(7);
    sound.setEnabled(false);
    const count=FakeAudioContext.samples.length;
    sound.call(); sound.dealHand(); sound.dealBoard(0,3);
    expect(FakeAudioContext.samples).toHaveLength(count);
    sound.setEnabled(true);
  });
  it('폴드 샘플은 한 번, 체크 샘플은 100ms 간격으로 두 번 재생한다', async () => {
    await vi.waitFor(()=>expect(vi.mocked(fetch)).toHaveBeenCalledTimes(7));
    FakeAudioContext.samples=[];
    sound.fold();
    expect(FakeAudioContext.samples).toHaveLength(1);
    FakeAudioContext.samples=[];
    sound.check();
    expect(FakeAudioContext.samples).toHaveLength(2);
    expect(FakeAudioContext.samples[1].at-FakeAudioContext.samples[0].at).toBeCloseTo(0.1);
  });
  it('OFF면 어떤 이벤트도 기록/재생되지 않는다', () => {
    sound.setEnabled(false);
    sound.history.length = 0;
    sound.check();
    sound.raise();
    sound.dealBoard(0, 3);
    expect(sound.history).toHaveLength(0);
    sound.setEnabled(true);
  });
});
