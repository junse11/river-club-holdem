// Web Audio API synthesizer for River Club poker sound effects.
// Uses procedural audio synthesis (zero external media files, instant playback).

const STORAGE_KEY = 'river:sound';

export type SoundEvent = { type: string; at: number };

class SoundEngine {
  private ctx: AudioContext | null = null;
  private enabled: boolean;
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
    const length = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  /** Single card snap/flip on the felt. */
  cardFlip(delayMs = 0, freq = 1900): void {
    const ctx = this.context();
    if (!ctx) return;
    this.record('cardFlip');
    const t0 = ctx.currentTime + delayMs / 1000;

    // Crisp filtered noise burst (card friction/snap)
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer(ctx, 0.065);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(freq, t0);
    filter.frequency.exponentialRampToValueAtTime(freq * 0.65, t0 + 0.06);
    filter.Q.value = 2.2;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, t0);
    gain.gain.linearRampToValueAtTime(0.18, t0 + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.06);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(t0);
    noise.stop(t0 + 0.065);

    // Subtle felt thud
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(170, t0);
    osc.frequency.exponentialRampToValueAtTime(55, t0 + 0.035);
    oscGain.gain.setValueAtTime(0.08, t0);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.038);
    osc.connect(oscGain);
    oscGain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.04);
  }

  /** New hand hole card deal (4 rapid card slides). */
  dealHand(): void {
    if (!this.enabled) return;
    this.record('dealHand');
    [0, 55, 110, 165].forEach((delay, idx) => {
      this.cardFlip(delay, 1750 + idx * 140);
    });
  }

  /** Flop deal (3 staggered card flips). */
  flop(): void {
    if (!this.enabled) return;
    this.record('flop');
    this.cardFlip(0, 1800);
    this.cardFlip(85, 2000);
    this.cardFlip(170, 2200);
  }

  /** Fold / muck card slide. */
  fold(): void {
    const ctx = this.context();
    if (!ctx) return;
    this.record('fold');
    const t0 = ctx.currentTime;

    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer(ctx, 0.12);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1500, t0);
    filter.frequency.exponentialRampToValueAtTime(500, t0 + 0.11);
    filter.Q.value = 1.8;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, t0);
    gain.gain.linearRampToValueAtTime(0.12, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.115);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(t0);
    noise.stop(t0 + 0.12);
  }

  /** Double table tap for CHECK. */
  check(): void {
    const ctx = this.context();
    if (!ctx) return;
    this.record('check');
    [0, 0.105].forEach((offset, idx) => {
      const t0 = ctx.currentTime + offset;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(idx === 0 ? 150 : 165, t0);
      osc.frequency.exponentialRampToValueAtTime(48, t0 + 0.055);
      gain.gain.setValueAtTime(0.22, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.06);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.065);
    });
  }

  /** Single clay/ceramic poker chip clink. */
  private chipClink(delayMs = 0, baseFreq = 2700, volume = 0.09): void {
    const ctx = this.context();
    if (!ctx) return;
    const t0 = ctx.currentTime + delayMs / 1000;

    [baseFreq, baseFreq * 1.36, baseFreq * 1.83].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = idx === 0 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      const amp = volume / (idx + 1);
      gain.gain.setValueAtTime(0.001, t0);
      gain.gain.linearRampToValueAtTime(amp, t0 + 0.003);
      gain.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.055);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.06);
    });
  }

  /** Subtle chip click for UI preset buttons. */
  chipClick(): void {
    if (!this.enabled) return;
    this.record('chipClick');
    this.chipClink(0, 2900, 0.055);
  }

  /** Call chip sound. */
  call(): void {
    if (!this.enabled) return;
    this.record('call');
    this.chipClink(0, 2650, 0.095);
    this.chipClink(45, 2950, 0.085);
  }

  /** Bet / Raise multi-chip stack sound. */
  raise(): void {
    if (!this.enabled) return;
    this.record('raise');
    [0, 38, 76, 114].forEach((delay, idx) => {
      this.chipClink(delay, 2550 + idx * 180, 0.1);
    });
  }

  /** Dramatic All-in chip cascade + tension chord. */
  allIn(): void {
    if (!this.enabled) return;
    this.record('allIn');
    [0, 30, 62, 95, 130, 168].forEach((delay, idx) => {
      this.chipClink(delay, 2400 + idx * 170, 0.11);
    });
    const ctx = this.context();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    [196, 293.66, 392].forEach(freq => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.001, t0);
      gain.gain.linearRampToValueAtTime(0.065, t0 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.42);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.44);
    });
  }

  /** Gentle two-note chime when it becomes the user's turn. */
  myTurn(delayMs = 0): void {
    const ctx = this.context();
    if (!ctx) return;
    this.record('myTurn');
    const base = ctx.currentTime + delayMs / 1000;
    [
      { freq: 659.25, offset: 0, dur: 0.18 },
      { freq: 880, offset: 0.095, dur: 0.28 },
    ].forEach(({ freq, offset, dur }) => {
      const t0 = base + offset;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.001, t0);
      gain.gain.linearRampToValueAtTime(0.11, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.01);
    });
  }

  /** Countdown clock tick for the active player's last 10 seconds. */
  tick(urgent = false): void {
    const ctx = this.context();
    if (!ctx) return;
    this.record(urgent ? 'tick:urgent' : 'tick');
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(urgent ? 1046.5 : 740, t0);
    gain.gain.setValueAtTime(0.001, t0);
    gain.gain.linearRampToValueAtTime(urgent ? 0.085 : 0.045, t0 + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + (urgent ? 0.065 : 0.04));
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.07);
  }

  /** Hand settlement sound (warm chord + chip sweep). */
  settle(didWin: boolean, delayMs = 0): void {
    if (!this.enabled) return;
    this.record(didWin ? 'settle:win' : 'settle:lose');
    [0, 42, 85].forEach((d, idx) => this.chipClink(delayMs + d, 2700 + idx * 140, 0.075));
    const ctx = this.context();
    if (!ctx) return;
    const base = ctx.currentTime + delayMs / 1000;
    const notes = didWin ? [523.25, 659.25, 783.99, 1046.5] : [392, 523.25];
    notes.forEach((freq, idx) => {
      const t0 = base + idx * 0.065;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.001, t0);
      gain.gain.linearRampToValueAtTime(didWin ? 0.095 : 0.055, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.32);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.34);
    });
  }

  /** Knockout / Bounty awarded fanfare. */
  bounty(delayMs = 0): void {
    if (!this.enabled) return;
    this.record('bounty');
    [0, 35, 70, 105, 140].forEach((d, idx) => this.chipClink(delayMs + d, 2600 + idx * 190, 0.1));
    const ctx = this.context();
    if (!ctx) return;
    const base = ctx.currentTime + delayMs / 1000;
    [523.25, 659.25, 783.99, 987.77, 1174.66].forEach((freq, idx) => {
      const t0 = base + idx * 0.06;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.001, t0);
      gain.gain.linearRampToValueAtTime(0.11, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.38);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.4);
    });
  }

  /** Subtle pop when toggling ready or joining room. */
  ready(): void {
    const ctx = this.context();
    if (!ctx) return;
    this.record('ready');
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, t0);
    osc.frequency.exponentialRampToValueAtTime(880, t0 + 0.065);
    gain.gain.setValueAtTime(0.001, t0);
    gain.gain.linearRampToValueAtTime(0.08, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.075);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.08);
  }

  /** Soft bubble pop when a chat message arrives. */
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
    gain.gain.linearRampToValueAtTime(0.065, t0 + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.06);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.065);
  }
}

export const sound = new SoundEngine();
