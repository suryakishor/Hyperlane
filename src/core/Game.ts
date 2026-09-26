import * as THREE from 'three';
import { GameLoop } from './GameLoop';
import { StateMachine, PLAYABLE_PHASES, type GamePhase } from './GameState';
import { DifficultyTracker, type DifficultyProfile } from './Difficulty';
import { DIFFICULTY, QUALITY_PRESETS, SPEED } from './GameConfig';
import { ScoreManager } from '../scoring/ScoreManager';
import { Player } from '../player/Player';
import { PlayerRig } from '../player/PlayerRig';
import { Track } from '../world/Track';
import { WorldGenerator, type GeneratedRow } from '../world/WorldGenerator';
import { ObstacleManager } from '../obstacles/ObstacleManager';
import { CoinManager } from '../collectibles/CoinManager';
import { CollisionManager } from '../collision/CollisionManager';
import { GameCamera } from '../camera/GameCamera';
import { InputManager, type GameAction } from '../input/InputManager';
import { AudioManager } from '../audio/AudioManager';
import { UIController } from '../ui/UIController';
import { createEnvironment } from '../render/SceneEnvironment';
import { disposeTextures } from '../render/Textures';
import { storage, type PlayerProfile, type Settings } from '../utils/storage';
import { normaliseUsername } from '../utils/username';
import { Rng, randomSeed } from '../utils/random';
import { clamp01 } from '../utils/math';

const COUNTDOWN_STEP = 1;
const COUNTDOWN_STEPS = 3;
/** How long the "GO!" beat stays up before the overlay clears itself. */
const COUNTDOWN_GO_MS = 620;
/** Seconds of tumble animation between the crash and the game over screen. */
const CRASH_TO_OVER = 0.85;
/** Backdrop drift speed while sitting on the main menu. */
const MENU_DRIFT_SPEED = 4;

export interface GameTelemetry {
  state: string;
  username: string;
  score: number;
  coins: number;
  distance: number;
  speed: number;
  difficulty: number;
  seed: number;
  lane: number;
  playerX: number;
  playerY: number;
  isJumping: boolean;
  isSliding: boolean;
  isCrashed: boolean;
  quality: 'high';
  world: {
    segments: number;
    activeSegments: number;
    obstacles: number;
    obstacleKinds: Record<string, number>;
    coins: number;
    coinCapacity: number;
    rowsGenerated: number;
  };
  drawCalls: number;
}

/** The single rendering preset Hyperlane runs at. */
const QUALITY = QUALITY_PRESETS.high;

/**
 * Top level orchestrator.
 *
 * Owns the render loop and the authoritative state machine, and wires the
 * subsystems together. Gameplay rules live in the individual systems - this
 * class only decides what runs, and when.
 */
export class Game {
  private readonly stateMachine = new StateMachine();
  private readonly loop: GameLoop;
  private readonly app: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera = new GameCamera();
  private readonly environment = createEnvironment();
  private readonly player = new Player();
  private readonly rig = new PlayerRig();
  private readonly score = new ScoreManager();
  private readonly difficulty = new DifficultyTracker();
  private readonly collisions = new CollisionManager();
  private readonly audio = new AudioManager();
  private readonly input: InputManager;
  private readonly ui: UIController;

  private readonly obstacles = new ObstacleManager();
  private readonly coins: CoinManager;
  private track: Track | null = null;
  private generator: WorldGenerator | null = null;

  private rng = new Rng(randomSeed());
  private seed = this.rng.seed;
  private profile: PlayerProfile;
  private settings: Settings;

  private distance = 0;
  private countdown = 0;
  private countdownStep = 0;
  private crashTimer = 0;
  private runLevel = 0;
  private elapsed = 0;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, app: HTMLElement) {
    this.app = app;

    const stored = storage.loadSettings();
    this.profile = storage.loadProfile();
    this.settings = stored;
    this.coins = new CoinManager(QUALITY);

    this.ui = new UIController(
      {
        onStart: (username) => {
          void this.audio.unlock();
          this.audio.play('uiClick');
          this.startRun(username);
        },
        onPause: () => this.pause(),
        onResume: () => this.resume(),
        onRestart: () => {
          this.audio.play('uiClick');
          this.startRun(this.profile.username);
        },
        onMenu: () => {
          this.audio.play('uiClick');
          this.returnToMenu();
        },
        onSettingsChanged: (settings) => this.applySettings(settings),
        onResetBest: () => {
          this.profile = storage.clearBestScore();
          this.ui.setBestScore(0);
        },
      },
      {
        settings: this.settings,
        bestScore: this.profile.bestScore,
        username: this.profile.username,
      },
    );

    this.renderer = this.createRenderer(canvas);
    this.input = new InputManager({
      surface: app,
      isEnabled: () => this.stateMachine.is('playing') && !this.player.isCrashed,
      onAction: (action) => this.handleAction(action),
    });

    this.loop = new GameLoop((delta) => this.frame(delta));
    this.applyQuality();

    this.stateMachine.subscribe((phase) => {
      document.body.setAttribute('data-phase', phase.kind);
      this.ui.setPhase(phase);
    });
  }

  // ------------------------------------------------------------------- boot

  async start(): Promise<void> {
    this.stateMachine.transitionTo({ kind: 'loading' });
    this.ui.setPhase({ kind: 'loading' });
    this.ui.setLoadingProgress(0.1, 'Preparing renderer');
    await nextFrame();

    this.scene.add(this.obstacles.group);
    this.scene.add(this.coins.group);
    this.scene.add(this.rig.group);
    this.buildWorld();
    this.ui.setLoadingProgress(0.4, 'Building the skyway');
    await nextFrame();

    this.input.attach();
    window.addEventListener('resize', this.handleResize);
    window.addEventListener('orientationchange', this.handleResize);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.ui.setLoadingProgress(0.75, 'Calibrating input');
    await nextFrame();

    this.loop.start();
    this.ui.setLoadingProgress(1, 'Ready');
    this.stateMachine.transitionTo({ kind: 'menu' });
  }

  private get scene(): THREE.Scene {
    return this.environment.scene;
  }

  private createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
    const preset = QUALITY;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: preset.antialias,
        alpha: false,
        powerPreference: 'high-performance',
      });
    } catch (error) {
      this.reportFatal(error);
      throw error;
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x05070f, 1);
    this.resizeRenderer(renderer);
    return renderer;
  }

  private buildWorld(): void {
    this.seed = this.requestedSeed();
    this.rng = new Rng(this.seed);
    this.track?.dispose();
    this.track = new Track(QUALITY, this.seed);
    this.scene.add(this.track.group);
    this.obstacles.clear();
    this.coins.clear();
    this.generator = new WorldGenerator(this.rng);
    this.resetRunState();
    this.camera.reset();
  }

  private resetRunState(): void {
    this.player.reset();
    this.rig.reset();
    this.score.reset();
    this.distance = 0;
    this.crashTimer = 0;
    this.difficulty.update(0, this.runLevel);
  }

  /** `?seed=123` makes any run reproducible for QA and bug reports. */
  private requestedSeed(): number {
    const search = globalThis.location?.search ?? '';
    const fromUrl = new URLSearchParams(search).get('seed');
    if (fromUrl !== null) {
      const parsed = Number.parseInt(fromUrl, 10);
      if (Number.isFinite(parsed)) {
        return parsed >>> 0;
      }
    }
    return randomSeed();
  }

  // ----------------------------------------------------------------- states

  private startRun(username: string): void {
    const name = normaliseUsername(username) ?? 'Runner';
    this.profile = { ...this.profile, username: name };
    storage.saveProfile(this.profile);
    this.ui.clearUsernameError();

    this.seed = this.requestedSeed();
    this.rng = new Rng(this.seed);
    this.track?.reset(this.seed);
    this.obstacles.clear();
    this.coins.clear();
    // The generator has to be rebuilt against the fresh stream: reusing it
    // would keep drawing from the previous run's RNG, so the same seed would
    // no longer reproduce the same world.
    this.generator = new WorldGenerator(this.rng);
    this.resetRunState();
    this.camera.reset();

    // One step, then COUNTDOWN_STEPS of them. Seeding this with the full
    // COUNTDOWN_STEP * COUNTDOWN_STEPS as well pre-drained an extra
    // COUNTDOWN_STEPS before the first tick, so the run sat frozen for 2.5s.
    this.countdown = COUNTDOWN_STEP;
    this.countdownStep = COUNTDOWN_STEPS;
    this.audio.setSoundEnabled(this.settings.sound);
    if (this.settings.music) {
      void this.audio.startMusicWhenReady();
    }
    this.stateMachine.transitionTo({ kind: 'ready', countdown: this.countdown });
    // The first beat is shown up front, otherwise the run would open on a full
    // second of silence and only ever count 2, 1, GO.
    this.ui.showCountdown(String(COUNTDOWN_STEPS));
  }

  private pause(): void {
    if (!this.stateMachine.transitionTo({ kind: 'paused' })) {
      return;
    }
    this.ui.setPauseStats(this.score.score, this.score.coinCount);
    this.audio.setMusicIntensity(0.12);
  }

  private resume(): void {
    if (!this.stateMachine.transitionTo({ kind: 'playing' })) {
      return;
    }
    this.audio.setMusicIntensity(1);
    void this.audio.unlock();
  }

  private returnToMenu(): void {
    this.stateMachine.transitionTo({ kind: 'menu' });
    this.audio.stopMusic();
  }

  private endRun(): void {
    const score = this.score.score;
    const isRecord = score > this.profile.bestScore;
    this.profile = {
      ...this.profile,
      bestScore: isRecord ? score : this.profile.bestScore,
      bestDistance: Math.max(this.profile.bestDistance, this.distance),
    };
    storage.saveProfile(this.profile);
    // Later runs in the same session start slightly harder.
    this.runLevel = Math.min(1, this.runLevel + 0.12);

    this.stateMachine.transitionTo({ kind: 'gameOver' });
    this.audio.play('gameOver');
    this.audio.setMusicIntensity(0.25);
    this.ui.showGameOver({
      score,
      coins: this.score.coinCount,
      distance: this.distance,
      best: this.profile.bestScore,
      isRecord,
      username: this.profile.username,
    });
    this.ui.setBestScore(this.profile.bestScore);
  }

  // ------------------------------------------------------------------- loop

  private frame(delta: number): void {
    if (this.disposed) {
      return;
    }
    this.elapsed += delta;
    const phase = this.stateMachine.name;

    switch (phase) {
      case 'playing':
        this.simulate(delta);
        break;
      case 'ready':
        this.updateCountdown(delta);
        // Populate the lane during the countdown, without moving anything. The
        // player can see and read the opening rows while the clock ticks, instead
        // of watching an empty deck that fills with hazards the moment it ends.
        this.generateAhead(this.difficulty.update(this.distance, this.runLevel), 0);
        this.rig.sync(this.player, delta, 0);
        break;
      case 'gameOver':
        this.driftAfterCrash(delta);
        break;
      case 'menu':
        this.track?.update(delta, MENU_DRIFT_SPEED);
        break;
      case 'paused':
      case 'loading':
      case 'error':
        break;
    }

    if (phase === 'playing' || phase === 'ready' || phase === 'gameOver' || phase === 'menu') {
      const speed = phase === 'menu' ? MENU_DRIFT_SPEED : this.currentSpeed;
      this.environment.update(delta, speed);
      this.camera.follow(this.player, delta, speed, this.crashFactor());
    }

    this.ui.updateHud(
      {
        score: this.score.score,
        coins: this.score.coinCount,
        speed: this.currentSpeed,
        progress: this.distance / DIFFICULTY.maxDifficultyDistance,
      },
      this.elapsed * 1000,
    );

    this.renderer.render(this.scene, this.camera.camera);
  }

  private get currentSpeed(): number {
    if (this.stateMachine.is('gameOver')) {
      return SPEED.base * SPEED.gameOverFactor;
    }
    return this.difficulty.speed;
  }

  private crashFactor(): number {
    return this.stateMachine.is('gameOver') ? clamp01(this.crashTimer / 0.4) : 0;
  }

  private simulate(delta: number): void {
    const speed = this.currentSpeed;
    const travel = speed * delta;
    const difficulty = this.difficulty.update(this.distance, this.runLevel);
    this.distance += travel;
    this.score.update(this.distance);

    this.track?.update(delta, speed);
    this.obstacles.update(delta, speed);
    this.coins.update(delta, speed);

    this.generateAhead(difficulty, travel);

    this.player.update(delta);
    this.rig.sync(this.player, delta, speed);

    if (this.player.isCrashed) {
      this.crashTimer += delta;
      this.rig.updateCrash(delta, this.player);
      if (this.crashTimer >= CRASH_TO_OVER) {
        this.endRun();
      }
      return;
    }

    const result = this.collisions.check(this.player.collider, this.obstacles.active, this.coins.active);
    if (result.collected > 0) {
      // Indices are descending, so removing in order keeps them valid.
      for (const index of result.collectedIndices) {
        this.coins.collect(index);
      }
      this.score.addCoin();
      this.audio.play('coin');
    }
    if (result.hit) {
      this.player.crash();
      this.crashTimer = 0;
      this.camera.addShake(0.42, 0.45);
      this.audio.play('hit');
    }
  }

  /** The skyway keeps drifting behind the game over panel. */
  private driftAfterCrash(delta: number): void {
    const drift = this.currentSpeed;
    this.track?.update(delta, drift);
    this.obstacles.update(delta, drift);
    this.coins.update(delta, drift);
    this.crashTimer += delta;
    this.rig.updateCrash(delta, this.player);
  }

  private updateCountdown(delta: number): void {
    this.countdown -= delta;
    if (this.countdown > 0) {
      return;
    }
    this.countdownStep -= 1;
    this.countdown = COUNTDOWN_STEP;
    this.audio.play('countdown');
    if (this.countdownStep <= 0) {
      this.ui.showCountdown('GO!', COUNTDOWN_GO_MS);
      this.stateMachine.transitionTo({ kind: 'playing' });
      return;
    }
    this.ui.showCountdown(String(this.countdownStep));
  }

  /**
   * Emits every row that has come due within the generation horizon.
   *
   * `travel` is the distance covered this frame; passing 0 fills the horizon
   * without advancing the world, which is what the countdown phase wants.
   */
  private generateAhead(profile: DifficultyProfile, travel: number): void {
    if (!this.generator) {
      return;
    }
    for (const row of this.generator.update(profile, this.currentSpeed, travel)) {
      this.spawnRow(row);
    }
  }

  private spawnRow(row: GeneratedRow): void {
    for (const obstacle of row.obstacles) {
      this.obstacles.spawn(obstacle.kind, obstacle.lane, row.z);
    }
    for (const placement of row.coins) {
      this.coins.spawnRun(placement, row.z);
    }
  }

  // ------------------------------------------------------------------ input

  private handleAction(action: GameAction): void {
    if (action === 'pause') {
      if (this.stateMachine.is('playing')) {
        this.pause();
      } else if (this.stateMachine.is('paused')) {
        this.resume();
      }
      return;
    }
    if (!PLAYABLE_PHASES.has(this.stateMachine.name) || this.player.isCrashed) {
      return;
    }
    switch (action) {
      case 'moveLeft':
        if (this.player.moveLane(-1)) {
          this.audio.play('uiClick');
        }
        break;
      case 'moveRight':
        if (this.player.moveLane(1)) {
          this.audio.play('uiClick');
        }
        break;
      case 'jump':
        if (this.player.jump()) {
          this.audio.play('jump');
        }
        break;
      case 'slide':
        if (this.player.slide()) {
          this.audio.play('slide');
        }
        break;
    }
  }

  private readonly onVisibilityChange = (): void => {
    if (document.hidden && this.stateMachine.is('playing')) {
      this.pause();
    }
  };

  // --------------------------------------------------------------- settings

  private applySettings(settings: Settings): void {
    this.settings = settings;
    storage.saveSettings(settings);
    this.audio.setSoundEnabled(settings.sound);
    this.audio.setMusicEnabled(settings.music);
  }

  private applyQuality(): void {
    const preset = QUALITY;
    this.renderer.shadowMap.enabled = preset.shadows;
    this.environment.setQuality(preset);
    this.track?.applyQuality(preset);
    this.coins.applyQuality(preset);
    this.handleResize();
  }

  // ---------------------------------------------------------------- teardown

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.loop.stop();
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('orientationchange', this.handleResize);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.input.dispose();
    this.audio.dispose();
    this.obstacles.dispose();
    this.coins.dispose();
    this.rig.dispose();
    this.track?.dispose();
    this.environment.dispose();
    this.camera.dispose();
    disposeTextures();
    this.renderer.dispose();
  }

  // ------------------------------------------------------------- diagnostics

  get phase(): GamePhase {
    return this.stateMachine.phase;
  }

  /**
   * Read-only snapshot behind the diagnostics API. It exposes behaviour, never
   * renderer internals.
   */
  telemetry(): GameTelemetry {
    const obstacleKinds: Record<string, number> = {};
    for (const kind of ['barrier', 'pylon', 'gate', 'drone'] as const) {
      obstacleKinds[kind] = this.obstacles.countOfKind(kind);
    }
    return {
      state: this.stateMachine.name,
      username: this.profile.username,
      score: this.score.score,
      coins: this.score.coinCount,
      distance: Math.round(this.distance),
      speed: Number(this.currentSpeed.toFixed(2)),
      difficulty: Number(this.difficulty.level.toFixed(3)),
      seed: this.seed,
      lane: this.player.lane,
      playerX: Number(this.player.x.toFixed(3)),
      playerY: Number(this.player.y.toFixed(3)),
      isJumping: this.player.isJumping,
      isSliding: this.player.isSliding,
      isCrashed: this.player.isCrashed,
      quality: 'high',
      world: {
        segments: this.track?.segmentCount ?? 0,
        activeSegments: this.track?.activeSegmentCount ?? 0,
        obstacles: this.obstacles.count,
        obstacleKinds,
        coins: this.coins.count,
        coinCapacity: this.coins.poolCapacity,
        rowsGenerated: this.generator?.rowsGenerated ?? 0,
      },
      drawCalls: this.renderer.info.render.calls,
    };
  }

  // --------------------------------------------------------------- resizing

  private readonly handleResize = (): void => {
    this.resizeRenderer(this.renderer);
  };

  private resizeRenderer(renderer: THREE.WebGLRenderer): void {
    const width = this.app.clientWidth || globalThis.innerWidth || 1;
    const height = this.app.clientHeight || globalThis.innerHeight || 1;
    renderer.setPixelRatio(
      Math.min(globalThis.devicePixelRatio || 1, QUALITY.pixelRatioCap),
    );
    renderer.setSize(width, height, false);
    this.camera.setViewport(width, height);
  }

  private reportFatal(error: unknown): void {
    const message =
      'This browser or device cannot run the 3D version of the game. Please try a modern browser with hardware acceleration enabled.';
    console.error('[hyperlane] fatal initialisation error', error);
    this.stateMachine.transitionTo({ kind: 'error', message });
    this.ui.showFatalError(message);
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}
