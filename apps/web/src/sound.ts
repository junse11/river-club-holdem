// Attached recordings for table sounds; synthesized fallback and UI notifications.
import { DEAL, boardTimeline } from './dealTimeline';

const STORAGE_KEY = 'river:sound';
const SAMPLE_URLS = {
  card: new URL('./audio/card.mp3', import.meta.url).href,
  allIn: new URL('./audio/all-in.mp3', import.meta.url).href,
  shuffle: new URL('./audio/shuffle.mp3', import.meta.url).href,
  nextHand: new URL('./audio/next-hand.mp3', import.meta.url).href,
  bet: new URL('./audio/bet.mp3', import.meta.url).href,
  fold: new URL('./audio/fold.mp3', import.meta.url).href,
  check: new URL('./audio/check.mp3', import.meta.url).href,
};
type SampleName = keyof typeof SAMPLE_URLS;

export type SoundEvent = { type: string; at: number };

const jitter = (value: number, pct: number): number => value * (1 + (Math.random() * 2 - 1) * pct);

class SoundEngine {
  private ctx: AudioContext | null = null;
  private enabled: boolean;
  private noiseCache = new Map<string, AudioBuffer>();
  private samples = new Map<SampleName, AudioBuffer>();
  private loadingSamples = false;
  private activeSamples = new Set<AudioBufferSourceNode>();
  readonly history: SoundEvent[] = [];

  constructor() {
    try {
      this.enabled = localStorage.getItem(STORAGE_KEY) !== '0';
    } catch {
      this.enabled = true;
    }
    if (typeof window !== 'undefined') {
      (window as unknown as { __riverSound?: SoundEngine }).__riverSound = this;
      const unlock = () => {
        // Create/resume inside the trusted gesture, before remote game updates arrive.
        this.context();
      };
      window.addEventListener('pointerdown', unlock, { passive: true });
      window.addEventListener('keydown', unlock, { passive: true });
    }
  }

  private record(type: string): void {
    this.history.push({ type, at: Date.now() });
    if (this.history.length > 100) {
      this.history.shift();
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(value: boolean): void {
    this.enabled = value;
    if (!value) {
      for (const source of this.activeSamples) { try { source.stop(); } catch {} }
      this.activeSamples.clear();
    }
    try {
      localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
    } catch {
      // Ignore storage errors in restricted contexts.
    }
    if (value) {
      this.ready();
    }
  }

  private context(): AudioContext | null {
    if (!this.enabled || typeof window === 'undefined') return null;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.ctx) {
      this.ctx = new AudioCtx();
    }
    if (!this.loadingSamples) {
      this.loadingSamples = true;
      const ctx = this.ctx;
      for (const name of Object.keys(SAMPLE_URLS) as SampleName[]) {
        void fetch(SAMPLE_URLS[name]).then(response => {
          if (!response.ok) throw new Error('Audio sample unavailable');
          return response.arrayBuffer();
        }).then(bytes => ctx.decodeAudioData(bytes)).then(buffer => {
          this.samples.set(name, buffer);
        }).catch(() => { /* Keep synthesized fallback when offline. */ });
      }
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private sample(name: SampleName, delayMs = 0, volume = 0.65, maxDuration?: number): boolean {
    const ctx = this.context();
    const buffer = this.samples.get(name);
    if (!ctx || !buffer) return false;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    const start = ctx.currentTime + delayMs / 1000;
    const duration = Math.min(buffer.duration, maxDuration ?? buffer.duration);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.setValueAtTime(volume, start + Math.max(0, duration - 0.015));
    gain.gain.linearRampToValueAtTime(0, start + duration);
    source.connect(gain); gain.connect(ctx.destination);
    this.activeSamples.add(source);
    source.onended = () => { this.activeSamples.delete(source); source.disconnect(); gain.disconnect(); };
    source.start(start, 0, duration);
    return true;
  }

  private noiseBuffer(ctx: AudioContext, durationSec: number): AudioBuffer {
    const key = durationSec.toFixed(3);
    const cached = this.noiseCache.get(key);
    if (cached) return cached;
    const length = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    this.noiseCache.set(key, buffer);
    return buffer;
  }

  /** 필터링된 노이즈 한 번(카드 마찰, 노크 클릭, 칩 러스틀 등). */
  private noise(
    ctx: AudioContext,
    t0: number,
    dur: number,
    type: BiquadFilterType,
    f0: number,
    f1: number,
    q: number,
    peak: number,
    attack = 0.004,
  ): void {
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx, dur + 0.02);
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) filter.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t0 + dur);
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0008, t0);
    gain.gain.linearRampToValueAtTime(peak, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  /** 짧은 저역 공명(테이블/펠트가 울리는 소리). */
  private thump(ctx: AudioContext, t0: number, f0: number, f1: number, dur: number, peak: number): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t0 + dur);
    gain.gain.setValueAtTime(peak, t0);
    gain.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.01);
  }

  /** 세라믹 칩 한 번 부딪히는 소리(클릭 + 비조화 배음). */
  private chipHit(ctx: AudioContext, t0: number, volume = 0.1): void {
    const base = jitter(1900, 0.08);
    this.noise(ctx, t0, 0.022, 'bandpass', 3800, 2400, 0.8, volume * 1.4, 0.001);
    [base, base * 1.47, base * 2.09].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.0008, t0);
      gain.gain.linearRampToValueAtTime((volume * 0.55) / (idx + 1), t0 + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.028 + (idx === 0 ? 0.016 : 0));
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.09);
    });
    this.thump(ctx, t0, jitter(240, 0.1), 120, 0.03, volume * 0.5);
  }

  /** 카드 한 장이 펠트 위로 미끄러지는 소리. */
  private cardSlide(ctx: AudioContext, t0: number, volume = 0.13): void {
    this.noise(ctx, t0, 0.16, 'bandpass', jitter(4200, 0.08), 1800, 0.8, volume * 1.35, 0.012);
    this.noise(ctx, t0 + 0.11, 0.045, 'lowpass', 1100, 500, 0.8, volume * 0.8, 0.002);
  }

  /** 카드 들어 올려 뒤집어 놓는 소리("슥" → "탁"). */
  private cardTurn(ctx: AudioContext, t0: number, volume = 0.16): void {
    this.noise(ctx, t0, 0.09, 'bandpass', 1800, 4500, 0.85, volume, 0.012);
    this.noise(ctx, t0 + 0.085, 0.035, 'bandpass', jitter(3000, 0.1), 1200, 0.8, volume * 1.25, 0.001);
    this.thump(ctx, t0 + 0.065, jitter(330, 0.1), 150, 0.03, volume * 0.5);
  }

  /** 새 핸드 홀카드 배분용 단일 카드 슬라이드. */
  deal(delayMs = 0): void {
    const ctx = this.context();
    if (!ctx) return;
    this.record('deal');
    if (this.sample('card', delayMs, 0.65, 0.24)) return;
    this.cardSlide(ctx, ctx.currentTime + delayMs / 1000);
  }

  /** 단일 카드 플립(공개) 소리. */
  cardFlip(delayMs = 0, _freq?: number): void {
    const ctx = this.context();
    if (!ctx) return;
    this.record('flip');
    if (this.sample('card', delayMs, 0.75, 0.24)) return;
    this.cardTurn(ctx, ctx.currentTime + delayMs / 1000);
  }

  /** 새 핸드 홀카드 배분(4장 연속 슬라이드). */
  dealHand(): void {
    if (!this.enabled) return;
    this.record('dealHand');
    this.sample('nextHand', 0, 0.7, 0.6);
    this.sample('shuffle', 200, 0.55, 0.6);
    [700, 850, 1000, 1150].forEach(delay => this.deal(delay));
  }

  /** 보드 딜: 화면 연출과 같은 타임라인으로 슬라이드 → 플립 소리를 낸다. */
  dealBoard(prevLen: number, nextLen: number, baseDelayMs = 0): void {
    if (!this.enabled) return;
    const steps = boardTimeline(prevLen, nextLen);
    if (steps.length === 0) return;
    this.record(steps.length >= 3 ? 'flop' : nextLen === 4 ? 'turn' : 'river');
    steps.forEach(step => {
      this.deal(baseDelayMs + step.slideAt);
      this.cardFlip(baseDelayMs + step.flipAt);
    });
  }

  /** 하위 호환: 플랍 딜 소리. */
  flop(): void {
    this.dealBoard(0, 3);
  }

  /** 폴드: 카드를 딜러 쪽으로 던져 머크. */
  fold(): void {
    const ctx = this.context();
    if (!ctx) return;
    this.record('muck');
    if (this.sample('fold', 0, 0.8)) return;
    const t0 = ctx.currentTime;
    this.noise(ctx, t0, 0.14, 'bandpass', 2800, 900, 1.1, 0.13, 0.01);
    this.noise(ctx, t0 + 0.12, 0.04, 'lowpass', 900, 500, 0.8, 0.07, 0.003);
  }

  /** 체크: 손가락 관절로 테이블 두 번 노크. */
  check(): void {
    const ctx = this.context();
    if (!ctx) return;
    this.record('knock');
    if (this.samples.has('check')) {
      this.sample('check', 0, 0.65);
      this.sample('check', 100, 0.55);
      return;
    }
    [0, 0.12].forEach((offset, idx) => {
      const t0 = ctx.currentTime + offset;
      const level = idx === 0 ? 1 : 0.82;
      this.noise(ctx, t0, 0.028, 'lowpass', jitter(1800, 0.1), 700, 0.9, 0.2 * level, 0.001);
      this.thump(ctx, t0, jitter(150, 0.08), 70, 0.07, 0.22 * level);
    });
  }

  /** UI 프리셋 버튼용 아주 약한 칩 소리. */
  chipClick(): void {
    const ctx = this.context();
    if (!ctx) return;
    this.record('chipClick');
    this.chipHit(ctx, ctx.currentTime, 0.05);
  }

  /** 콜: 칩 한두 개를 베팅 라인에 내려놓는 소리. */
  call(): void {
    const ctx = this.context();
    if (!ctx) return;
    this.record('chipDrop');
    if (this.sample('bet', 0, 0.65, 0.45)) return;
    const t0 = ctx.currentTime;
    this.chipHit(ctx, t0, 0.14);
    this.chipHit(ctx, t0 + 0.055 + Math.random() * 0.02, 0.11);
  }

  /** 베트/레이즈: 칩 여러 개를 쌓아 밀어 넣는 소리. */
  raise(): void {
    const ctx = this.context();
    if (!ctx) return;
    this.record('chipStack');
    if (this.samples.has('bet')) {
      this.sample('bet', 0, 0.7, 0.35);
      this.sample('bet', 110, 0.6, 0.35);
      return;
    }
    const t0 = ctx.currentTime;
    let offset = 0;
    for (let i = 0; i < 6; i++) {
      this.chipHit(ctx, t0 + offset, 0.10 + Math.random() * 0.035);
      offset += 0.035 + Math.random() * 0.03;
    }
  }

  /** 올인: 칩 전체를 앞으로 밀어내는 러스틀 + 연속 칩 소리(화음 없음). */
  allIn(): void {
    const ctx = this.context();
    if (!ctx) return;
    this.record('chipPush');
    if (this.sample('allIn', 0, 0.8)) return;
    const t0 = ctx.currentTime;
    this.noise(ctx, t0, 0.5, 'bandpass', 2400, 1800, 0.9, 0.07, 0.04);
    let offset = 0;
    for (let i = 0; i < 12; i++) {
      this.chipHit(ctx, t0 + offset, 0.09 + Math.random() * 0.05);
      offset += 0.022 + Math.random() * 0.032;
    }
    this.thump(ctx, t0 + 0.05, 110, 55, 0.18, 0.12);
  }

  /** 내 차례 알림(부드러운 두 음, UI 용도). */
  myTurn(delayMs = 0): void {
    const ctx = this.context();
    if (!ctx) return;
    this.record('myTurn');
    const base = ctx.currentTime + delayMs / 1000;
    [
      { freq: 659.25, offset: 0, dur: 0.18 },
      { freq: 880, offset: 0.095, dur: 0.26 },
    ].forEach(({ freq, offset, dur }) => {
      const t0 = base + offset;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.001, t0);
      gain.gain.linearRampToValueAtTime(0.075, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.01);
    });
  }

  /** 카운트다운 시계 틱(마지막 10초). */
  tick(urgent = false): void {
    const ctx = this.context();
    if (!ctx) return;
    this.record(urgent ? 'tick:urgent' : 'tick');
    const t0 = ctx.currentTime;
    this.noise(ctx, t0, 0.04, 'bandpass', urgent ? 2600 : 1900, urgent ? 2200 : 1600, 3, urgent ? 0.1 : 0.06, 0.001);
  }

  /** 정산: 팟을 쓸어 담는 칩 소리. 승리 시 칩 스택 한 번 더. */
  settle(didWin: boolean, delayMs = 0): void {
    const ctx = this.context();
    if (!ctx) return;
    this.record(didWin ? 'settle:win' : 'settle:lose');
    const t0 = ctx.currentTime + delayMs / 1000;
    this.noise(ctx, t0, 0.32, 'bandpass', 2200, 1500, 0.8, didWin ? 0.07 : 0.045, 0.03);
    const hits = didWin ? 7 : 3;
    let offset = 0.02;
    for (let i = 0; i < hits; i++) {
      this.chipHit(ctx, t0 + offset, (didWin ? 0.085 : 0.06) + Math.random() * 0.02);
      offset += 0.04 + Math.random() * 0.03;
    }
  }

  /** 바운티 획득: 칩이 쏟아지는 소리 + 은은한 벨 한 번. */
  bounty(delayMs = 0): void {
    const ctx = this.context();
    if (!ctx) return;
    this.record('bounty');
    const t0 = ctx.currentTime + delayMs / 1000;
    let offset = 0;
    for (let i = 0; i < 9; i++) {
      this.chipHit(ctx, t0 + offset, 0.09 + Math.random() * 0.04);
      offset += 0.03 + Math.random() * 0.03;
    }
    const bellAt = t0 + 0.2;
    [1174.66, 1174.66 * 2.76].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, bellAt);
      gain.gain.setValueAtTime(0.001, bellAt);
      gain.gain.linearRampToValueAtTime(idx === 0 ? 0.07 : 0.025, bellAt + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.001, bellAt + 0.9);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(bellAt);
      osc.stop(bellAt + 0.95);
    });
  }

  /** 준비/입장 알림. */
  ready(): void {
    const ctx = this.context();
    if (!ctx) return;
    this.record('ready');
    const t0 = ctx.currentTime;
    this.chipHit(ctx, t0, 0.06);
  }

  /** 채팅 도착 알림. */
  chat(): void {
    const ctx = this.context();
    if (!ctx) return;
    this.record('chat');
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, t0);
    osc.frequency.exponentialRampToValueAtTime(760, t0 + 0.05);
    gain.gain.setValueAtTime(0.001, t0);
    gain.gain.linearRampToValueAtTime(0.05, t0 + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.06);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.065);
  }
}

export const sound = new SoundEngine();
export { DEAL };
