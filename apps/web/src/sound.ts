// Web Audio API synthesizer for River Club poker sound effects.
// 외부 음원 파일 없이 노이즈 + 필터 + 짧은 공명으로 카지노 테이블 소리를 합성한다.
import { DEAL, boardTimeline } from './dealTimeline';

const STORAGE_KEY = 'river:sound';

export type SoundEvent = { type: string; at: number };

const jitter = (value: number, pct: number): number => value * (1 + (Math.random() * 2 - 1) * pct);

class SoundEngine {
  private ctx: AudioContext | null = null;
  private enabled: boolean;
  private noiseCache = new Map<string, AudioBuffer>();
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
        if (this.ctx && this.ctx.state === 'suspended') {
          void this.ctx.resume();
        }
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
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
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
    const base = jitter(3100, 0.1);
    this.noise(ctx, t0, 0.03, 'highpass', 4200, 4200, 0.7, volume * 1.1, 0.0015);
    [base, base * 1.51, base * 2.17].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.0008, t0);
      gain.gain.linearRampToValueAtTime((volume * 0.55) / (idx + 1), t0 + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.05 + (idx === 0 ? 0.02 : 0));
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.09);
    });
    this.thump(ctx, t0, jitter(240, 0.1), 120, 0.03, volume * 0.5);
  }

  /** 카드 한 장이 펠트 위로 미끄러지는 소리. */
  private cardSlide(ctx: AudioContext, t0: number, volume = 0.13): void {
    this.noise(ctx, t0, 0.095, 'bandpass', jitter(3600, 0.08), 1500, 1.3, volume, 0.012);
    this.noise(ctx, t0 + 0.07, 0.03, 'lowpass', 700, 400, 0.8, volume * 0.55, 0.002);
  }

  /** 카드 들어 올려 뒤집어 놓는 소리("슥" → "탁"). */
  private cardTurn(ctx: AudioContext, t0: number, volume = 0.16): void {
    this.noise(ctx, t0, 0.07, 'bandpass', 1600, 3600, 1.6, volume * 0.75, 0.02);
    this.noise(ctx, t0 + 0.065, 0.028, 'bandpass', jitter(2500, 0.1), 1200, 1.4, volume, 0.001);
    this.thump(ctx, t0 + 0.065, jitter(330, 0.1), 150, 0.03, volume * 0.5);
  }

  /** 새 핸드 홀카드 배분용 단일 카드 슬라이드. */
  deal(delayMs = 0): void {
    const ctx = this.context();
    if (!ctx) return;
    this.record('deal');
    this.cardSlide(ctx, ctx.currentTime + delayMs / 1000);
  }

  /** 단일 카드 플립(공개) 소리. */
  cardFlip(delayMs = 0, _freq?: number): void {
    const ctx = this.context();
    if (!ctx) return;
    this.record('flip');
    this.cardTurn(ctx, ctx.currentTime + delayMs / 1000);
  }

  /** 새 핸드 홀카드 배분(4장 연속 슬라이드). */
  dealHand(): void {
    if (!this.enabled) return;
    this.record('dealHand');
    [0, 85, 170, 255].forEach(delay => this.deal(delay));
  }

  /** 보드 딜: 화면 연출과 같은 타임라인으로 슬라이드 → 플립 소리를 낸다. */
  dealBoard(prevLen: number, nextLen: number, baseDelayMs = 0): void {
    if (!this.enabled) return;
    const steps = boardTimeline(prevLen, nextLen);
    if (steps.length === 0) return;
    this.record(steps.length >= 3 ? 'flop' : 'board');
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
    const t0 = ctx.currentTime;
    this.noise(ctx, t0, 0.14, 'bandpass', 2800, 900, 1.1, 0.13, 0.01);
    this.noise(ctx, t0 + 0.12, 0.04, 'lowpass', 900, 500, 0.8, 0.07, 0.003);
  }

  /** 체크: 손가락 관절로 테이블 두 번 노크. */
  check(): void {
    const ctx = this.context();
    if (!ctx) return;
    this.record('knock');
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
    const t0 = ctx.currentTime;
    this.chipHit(ctx, t0, 0.1);
    this.chipHit(ctx, t0 + 0.055 + Math.random() * 0.02, 0.08);
  }

  /** 베트/레이즈: 칩 여러 개를 쌓아 밀어 넣는 소리. */
  raise(): void {
    const ctx = this.context();
    if (!ctx) return;
    this.record('chipStack');
    const t0 = ctx.currentTime;
    let offset = 0;
    for (let i = 0; i < 6; i++) {
      this.chipHit(ctx, t0 + offset, 0.075 + Math.random() * 0.035);
      offset += 0.035 + Math.random() * 0.03;
    }
  }

  /** 올인: 칩 전체를 앞으로 밀어내는 러스틀 + 연속 칩 소리(화음 없음). */
  allIn(): void {
    const ctx = this.context();
    if (!ctx) return;
    this.record('chipPush');
    const t0 = ctx.currentTime;
    this.noise(ctx, t0, 0.5, 'bandpass', 2400, 1800, 0.9, 0.07, 0.04);
    let offset = 0;
    for (let i = 0; i < 12; i++) {
      this.chipHit(ctx, t0 + offset, 0.07 + Math.random() * 0.05);
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
