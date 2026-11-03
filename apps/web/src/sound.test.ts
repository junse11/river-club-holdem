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
  currentTime = 0;
  sampleRate = 8000;
  state = 'running';
  destination = {};
  resume() { return Promise.resolve(); }
  createBuffer(_c: number, length: number) { return { getChannelData: () => new Float32Array(length) }; }
  createBufferSource() { return { ...node(), buffer: null }; }
  createBiquadFilter() { return node(); }
  createGain() { return node(); }
  createOscillator() { return node(); }
}

type SoundApi = typeof import('./sound')['sound'];
let sound: SoundApi;
const last = () => sound.history.map(e => e.type);

beforeAll(async () => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
  vi.stubGlobal('window', { AudioContext: FakeAudioContext, addEventListener() {} });
  sound = (await import('./sound')).sound;
});

describe('액션 사운드 이벤트 (AUD-001)', () => {
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
