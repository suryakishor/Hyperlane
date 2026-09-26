import { AUDIO } from '../core/GameConfig';

export type SfxName = 'jump' | 'slide' | 'coin' | 'hit' | 'uiClick' | 'countdown' | 'start' | 'gameOver';

const NOTE = {
  bass: [55, 55, 65.41, 65.41, 73.42, 73.42, 49, 49],
  lead: [220, 261.63, 329.63, 392, 329.63, 261.63, 196, 261.63],
};

/**
 * All audio is synthesised at runtime with the Web Audio API, so Hyperlane
 * ships without any licensed sound files and works fully offline.
 *
 * Every entry point is defensive: if audio is unavailable (or blocked by the
 * browser) the game keeps running silently.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private schedulerId: number | null = null;
  private nextStepTime = 0;
  private step = 0;
  private musicPlaying = false;

  private soundEnabled = true;
  private musicEnabled = true;
  private failed = false;

  /** Must be called from a user gesture to satisfy autoplay policies. */
  async unlock(): Promise<void> {
    if (this.failed) {
      return;
    }
    try {
      this.ensureContext();
      const ctx = this.ctx;
      if (ctx && ctx.state === 'suspended') {
        await ctx.resume();
      }
    } catch {
      this.failed = true;
    }
  }

  setSoundEnabled(enabled: boolean): void {
    this.soundEnabled = enabled;
  }

  setMusicEnabled(enabled: boolean): void {
    this.musicEnabled = enabled;
    if (enabled) {
      this.startMusic();
    } else {
      this.stopMusic();
    }
  }

  play(name: SfxName): void {
    if (!this.soundEnabled || this.failed) {
      return;
    }
    const ctx = this.ctx;
    const bus = this.sfxBus;
    if (!ctx || !bus || ctx.state !== 'running') {
      return;
    }
    try {
      switch (name) {
        case 'jump':
          this.tone({ from: 300, to: 720, duration: 0.16, type: 'triangle', gain: 0.5 });
          break;
        case 'slide':
          this.noise({ duration: 0.26, gain: 0.28, filter: 1400, sweepTo: 380 });
          break;
        case 'coin':
          this.tone({ from: 988, to: 988, duration: 0.06, type: 'square', gain: 0.3 });
          this.tone({ from: 1319, to: 1319, duration: 0.12, type: 'square', gain: 0.26, delay: 0.055 });
          break;
        case 'hit':
          this.tone({ from: 220, to: 48, duration: 0.42, type: 'sawtooth', gain: 0.55 });
          this.noise({ duration: 0.34, gain: 0.4, filter: 900, sweepTo: 120 });
          break;
        case 'uiClick':
          this.tone({ from: 620, to: 880, duration: 0.05, type: 'square', gain: 0.18 });
          break;
        case 'countdown':
          this.tone({ from: 520, to: 520, duration: 0.1, type: 'sine', gain: 0.34 });
          break;
        case 'start':
          this.tone({ from: 392, to: 784, duration: 0.2, type: 'triangle', gain: 0.32 });
          break;
        case 'gameOver':
          this.sequence([392, 329.63, 261.63, 196], 0.16, 'triangle', 0.3);
          break;
      }
    } catch {
      this.failed = true;
    }
  }

  startMusic(): void {
    if (!this.musicEnabled || this.musicPlaying || this.failed) {
      return;
    }
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') {
      return;
    }
    this.musicPlaying = true;
    this.step = 0;
    this.nextStepTime = ctx.currentTime + 0.08;
    this.schedulerId = window.setInterval(() => this.scheduleMusic(), 40);
  }

  /**
   * Resumes the audio context (autoplay policies require a gesture) and then
   * starts the loop, so callers never have to sequence the two by hand.
   */
  async startMusicWhenReady(): Promise<void> {
    if (!this.musicEnabled) {
      return;
    }
    await this.unlock();
    this.startMusic();
  }

  stopMusic(): void {
    this.musicPlaying = false;
    if (this.schedulerId !== null) {
      window.clearInterval(this.schedulerId);
      this.schedulerId = null;
    }
  }

  /** Duck the music while paused so the menu feels quiet. */
  setMusicIntensity(level: number): void {
    if (!this.musicBus || !this.ctx) {
      return;
    }
    const target = Math.max(0, Math.min(1, level));
    this.musicBus.gain.setTargetAtTime(target, this.ctx.currentTime, 0.15);
  }

  dispose(): void {
    this.stopMusic();
    this.soundEnabled = false;
    this.musicEnabled = false;
    try {
      this.sfxBus?.disconnect();
      this.musicBus?.disconnect();
      this.master?.disconnect();
      void this.ctx?.close();
    } catch {
      /* already closed */
    }
    this.ctx = null;
    this.master = null;
    this.sfxBus = null;
    this.musicBus = null;
    this.noiseBuffer = null;
  }

  // ------------------------------------------------------------- internals

  private ensureContext(): void {
    if (this.ctx || this.failed) {
      return;
    }
    const Ctor: typeof AudioContext | undefined =
      typeof window !== 'undefined'
        ? window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        : undefined;
    if (!Ctor) {
      this.failed = true;
      return;
    }
    const ctx = new Ctor();
    const master = ctx.createGain();
    master.gain.value = AUDIO.masterVolume;
    master.connect(ctx.destination);

    const sfxBus = ctx.createGain();
    sfxBus.gain.value = AUDIO.sfxVolume;
    sfxBus.connect(master);

    const musicBus = ctx.createGain();
    musicBus.gain.value = AUDIO.musicVolume;
    musicBus.connect(master);

    this.ctx = ctx;
    this.master = master;
    this.sfxBus = sfxBus;
    this.musicBus = musicBus;
    this.noiseBuffer = this.createNoiseBuffer(ctx);
  }

  private createNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * 0.5);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      // Slightly smoothed white noise.
      data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 0.5;
    }
    return buffer;
  }

  private tone(options: {
    from: number;
    to: number;
    duration: number;
    type: OscillatorType;
    gain: number;
    delay?: number;
  }): void {
    const ctx = this.ctx;
    const bus = this.sfxBus;
    if (!ctx || !bus) {
      return;
    }
    const start = ctx.currentTime + (options.delay ?? 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = options.type;
    osc.frequency.setValueAtTime(Math.max(20, options.from), start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, options.to), start + options.duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(options.gain, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + options.duration);
    osc.connect(gain);
    gain.connect(bus);
    osc.start(start);
    osc.stop(start + options.duration + 0.02);
  }

  private noise(options: { duration: number; gain: number; filter: number; sweepTo?: number; delay?: number }): void {
    const ctx = this.ctx;
    const bus = this.sfxBus;
    if (!ctx || !bus || !this.noiseBuffer) {
      return;
    }
    const start = ctx.currentTime + (options.delay ?? 0);
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(options.filter, start);
    if (options.sweepTo) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(60, options.sweepTo), start + options.duration);
    }
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(options.gain, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + options.duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(bus);
    source.start(start);
    source.stop(start + options.duration + 0.02);
  }

  private sequence(freqs: readonly number[], spacing: number, type: OscillatorType, gain: number): void {
    freqs.forEach((freq, index) => {
      this.tone({ from: freq, to: freq, duration: spacing * 0.95, type, gain, delay: index * spacing });
    });
  }

  private scheduleMusic(): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicPlaying || ctx.state !== 'running') {
      return;
    }
    const stepDuration = AUDIO.stepDuration;
    try {
      while (this.nextStepTime < ctx.currentTime + AUDIO.scheduleAhead) {
        this.playStep(this.step, this.nextStepTime, stepDuration);
        this.step = (this.step + 1) % AUDIO.stepCount;
        this.nextStepTime += stepDuration;
      }
    } catch {
      this.stopMusic();
    }
  }

  private playStep(step: number, time: number, duration: number): void {
    const ctx = this.ctx;
    const bus = this.musicBus;
    if (!ctx || !bus) {
      return;
    }
    const bar = Math.floor(step / 8) % 4;
    const inBar = step % 8;

    if (inBar === 0 || inBar === 4) {
      this.musicVoice(NOTE.bass[bar] ?? 55, time, duration * 2.4, 'sawtooth', 0.22, 420);
    }
    if (step % 2 === 0) {
      const note = NOTE.lead[(Math.floor(step / 2) + bar) % NOTE.lead.length] ?? 220;
      this.musicVoice(note, time, duration * 1.6, 'square', 0.08, 2400);
    }
    if (step % 4 === 0) {
      this.musicKick(time);
    }
    if (step % 8 === 4) {
      this.musicHat(time, 0.05);
    }
  }

  private musicVoice(
    freq: number,
    time: number,
    duration: number,
    type: OscillatorType,
    gainValue: number,
    cutoff: number,
  ): void {
    const ctx = this.ctx;
    const bus = this.musicBus;
    if (!ctx || !bus) {
      return;
    }
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, time);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(gainValue, time + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(bus);
    osc.start(time);
    osc.stop(time + duration + 0.02);
  }

  private musicKick(time: number): void {
    const ctx = this.ctx;
    const bus = this.musicBus;
    if (!ctx || !bus) {
      return;
    }
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, time);
    osc.frequency.exponentialRampToValueAtTime(40, time + 0.12);
    gain.gain.setValueAtTime(0.5, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);
    osc.connect(gain);
    gain.connect(bus);
    osc.start(time);
    osc.stop(time + 0.2);
  }

  private musicHat(time: number, gainValue: number): void {
    const ctx = this.ctx;
    const bus = this.musicBus;
    if (!ctx || !bus || !this.noiseBuffer) {
      return;
    }
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 7000;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(bus);
    source.start(time);
    source.stop(time + 0.08);
  }
}
