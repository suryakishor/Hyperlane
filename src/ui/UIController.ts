import type { GamePhase } from '../core/GameState';
import { formatMetres, formatScore, toKmh } from '../utils/math';
import { SCORE, USERNAME } from '../core/GameConfig';
import { validateUsername } from '../utils/username';
import type { Settings } from '../utils/storage';

export interface UICallbacks {
  onStart(username: string): void;
  onPause(): void;
  onResume(): void;
  onRestart(): void;
  onMenu(): void;
  onSettingsChanged(settings: Settings): void;
  onResetBest(): void;
}

export interface HudData {
  score: number;
  coins: number;
  speed: number;
  progress: number;
}

export interface GameOverData {
  score: number;
  coins: number;
  distance: number;
  best: number;
  isRecord: boolean;
  username: string;
}

const HUD_INTERVAL_MS = 90;

function query<T extends HTMLElement>(root: ParentNode, id: string): T {
  const element = root.querySelector<T>(`#${id}`);
  if (!element) {
    throw new Error(`Hyperlane UI: missing required element #${id}`);
  }
  return element;
}

/**
 * Owns the DOM overlay: menus, HUD, pause, game over and settings.
 *
 * The UI never stores authoritative game data - it renders what the game hands
 * it and reports user intent back through callbacks.
 */
export class UIController {
  private readonly loadingScreen = query<HTMLElement>(document, 'screen-loading');
  private readonly menuScreen = query<HTMLElement>(document, 'screen-menu');
  private readonly pauseScreen = query<HTMLElement>(document, 'screen-pause');
  private readonly gameOverScreen = query<HTMLElement>(document, 'screen-gameover');
  private readonly settingsScreen = query<HTMLElement>(document, 'settings-panel');
  private readonly fatalScreen = query<HTMLElement>(document, 'fatal-error');
  private readonly hud = query<HTMLElement>(document, 'hud');
  private readonly countdownOverlay = query<HTMLElement>(document, 'countdown');
  private readonly countdownValue = query<HTMLElement>(document, 'countdown-value');
  private readonly countdownHint = query<HTMLElement>(document, 'countdown-hint');
  private countdownTimer = 0;

  private readonly loadingStatus = query<HTMLElement>(document, 'loading-status');
  private readonly loadingBar = query<HTMLElement>(document, 'loading-bar-fill');
  private readonly loadingBarRole = query<HTMLElement>(document, 'loading-bar');

  private readonly form = query<HTMLFormElement>(document, 'menu-form');
  private readonly usernameInput = query<HTMLInputElement>(document, 'username-input');
  private readonly usernameError = query<HTMLElement>(document, 'username-error');
  private readonly menuBest = query<HTMLElement>(document, 'menu-best-score');

  private readonly hudScore = query<HTMLElement>(document, 'hud-score');
  private readonly hudCoins = query<HTMLElement>(document, 'hud-coins');
  private readonly hudSpeed = query<HTMLElement>(document, 'hud-speed');
  private readonly hudProgress = query<HTMLElement>(document, 'hud-progress-fill');

  private readonly pauseScore = query<HTMLElement>(document, 'pause-score');
  private readonly pauseCoins = query<HTMLElement>(document, 'pause-coins');

  private readonly gameOverScore = query<HTMLElement>(document, 'gameover-score');
  private readonly gameOverCoins = query<HTMLElement>(document, 'gameover-coins');
  private readonly gameOverBest = query<HTMLElement>(document, 'gameover-best');
  private readonly gameOverUsername = query<HTMLElement>(document, 'gameover-username');
  private readonly gameOverDistance = query<HTMLElement>(document, 'gameover-distance');
  private readonly gameOverRecord = query<HTMLElement>(document, 'gameover-record');

  private readonly soundToggle = query<HTMLButtonElement>(document, 'setting-sound');
  private readonly musicToggle = query<HTMLButtonElement>(document, 'setting-music');

  private readonly announcer = query<HTMLElement>(document, 'a11y-announcer');
  private readonly pauseButton = query<HTMLButtonElement>(document, 'pause-button');

  private settings: Settings;
  private settingsReturnPhase: GamePhase['kind'] = 'menu';
  private lastHudPaint = 0;
  private lastHudKey = '';

  constructor(
    private readonly callbacks: UICallbacks,
    initial: { settings: Settings; bestScore: number; username: string },
  ) {
    this.settings = initial.settings;
    this.form.addEventListener('submit', this.onSubmit);
    // Clear a stale validation error as soon as the player edits the field,
    // otherwise an error from a previous attempt stays on screen.
    this.usernameInput.addEventListener('input', this.onUsernameInput);
    query<HTMLButtonElement>(document, 'pause-button').addEventListener('click', this.callbacks.onPause);
    query<HTMLButtonElement>(document, 'resume-button').addEventListener('click', this.callbacks.onResume);
    query<HTMLButtonElement>(document, 'pause-restart-button').addEventListener('click', this.callbacks.onRestart);
    query<HTMLButtonElement>(document, 'pause-menu-button').addEventListener('click', this.callbacks.onMenu);
    query<HTMLButtonElement>(document, 'gameover-menu-button').addEventListener('click', this.callbacks.onMenu);
    query<HTMLButtonElement>(document, 'restart-button').addEventListener('click', this.callbacks.onRestart);
    query<HTMLButtonElement>(document, 'settings-open').addEventListener('click', this.openSettings);
    query<HTMLButtonElement>(document, 'pause-settings-button').addEventListener('click', this.openSettings);
    query<HTMLButtonElement>(document, 'settings-close').addEventListener('click', this.closeSettings);
    query<HTMLButtonElement>(document, 'settings-reset-best').addEventListener('click', this.onResetBest);
    this.soundToggle.addEventListener('click', this.onSoundToggle);
    this.musicToggle.addEventListener('click', this.onMusicToggle);

    this.usernameInput.value = initial.username;
    // A hard cap in the field itself; over-long names are still reported through
    // validation, so the cap is deliberately looser than USERNAME.maxLength.
    this.usernameInput.maxLength = USERNAME.hardMaxLength;
    this.menuBest.textContent = String(Math.floor(initial.bestScore));
    this.applySettingsToControls();
  }

  // ------------------------------------------------------------- lifecycle

  setLoadingProgress(progress: number, label?: string): void {
    const clamped = Math.max(0, Math.min(1, progress));
    this.loadingBar.style.width = `${Math.round(clamped * 100)}%`;
    this.loadingBarRole.setAttribute('aria-valuenow', String(Math.round(clamped * 100)));
    if (label) {
      this.loadingStatus.textContent = label;
    }
  }

  setPhase(phase: GamePhase): void {
    const kind = phase.kind;

    this.menuScreen.classList.toggle('is-hidden', kind !== 'menu');
    this.pauseScreen.classList.toggle('is-hidden', kind !== 'paused');
    this.gameOverScreen.classList.toggle('is-hidden', kind !== 'gameOver');
    this.loadingScreen.classList.toggle('is-hidden', kind !== 'loading');

    const inRun = kind === 'ready' || kind === 'playing' || kind === 'paused' || kind === 'gameOver';
    this.hud.classList.toggle('is-hidden', !inRun);
    this.hud.setAttribute('aria-hidden', String(!inRun));

    // The countdown only belongs to the run it was started for: leaving it up
    // over the menu, or over a pause, would read as a stuck overlay.
    if (kind !== 'ready' && kind !== 'playing') {
      this.showCountdown(null);
    }

    if (kind === 'menu' || kind === 'error') {
      this.closeSettings();
      if (kind === 'menu') {
        // Returning to the menu should let the player type straight away.
        window.setTimeout(() => this.usernameInput.focus({ preventScroll: true }), 60);
      }
    }

    if (kind === 'paused') {
      this.announce('Game paused');
    } else if (kind === 'playing') {
      this.announce('Game running');
    }
  }

  /**
   * Shows one countdown beat, or `null` to clear the overlay.
   *
   * `holdMs` auto-clears the overlay after a delay, which is what the "GO!" beat
   * wants: the run has already started, so the overlay must not linger over it.
   */
  showCountdown(text: string | null, holdMs = 0): void {
    window.clearTimeout(this.countdownTimer);
    this.countdownTimer = 0;

    if (text === null) {
      this.countdownOverlay.classList.add('is-hidden');
      this.countdownOverlay.setAttribute('aria-hidden', 'true');
      return;
    }

    this.countdownValue.textContent = text;
    this.countdownOverlay.classList.remove('is-hidden');
    this.countdownOverlay.setAttribute('aria-hidden', 'false');

    // Restart the pop: removing the class and forcing a reflow makes the browser
    // treat the re-add as a brand new animation.
    for (const node of [this.countdownValue, this.countdownHint]) {
      node.classList.remove('is-pop');
    }
    void this.countdownValue.offsetWidth;
    for (const node of [this.countdownValue, this.countdownHint]) {
      node.classList.add('is-pop');
    }

    this.announce(text);
    if (holdMs > 0) {
      this.countdownTimer = window.setTimeout(() => {
        this.countdownTimer = 0;
        this.showCountdown(null);
      }, holdMs);
    }
  }

  updateHud(data: HudData, now: number): void {
    if (now - this.lastHudPaint < HUD_INTERVAL_MS) {
      return;
    }
    this.lastHudPaint = now;
    const key = `${data.score}|${data.coins}|${Math.round(data.speed)}|${Math.round(data.progress * 40)}`;
    if (key === this.lastHudKey) {
      return;
    }
    this.lastHudKey = key;
    this.hudScore.textContent = formatScore(data.score, SCORE.hudDigits);
    this.hudCoins.textContent = String(data.coins);
    this.hudSpeed.textContent = String(toKmh(data.speed));
    this.hudProgress.style.width = `${Math.round(Math.max(0, Math.min(1, data.progress)) * 100)}%`;
  }

  setPauseStats(score: number, coins: number): void {
    this.pauseScore.textContent = String(Math.floor(score));
    this.pauseCoins.textContent = String(coins);
  }

  showGameOver(data: GameOverData): void {
    this.gameOverScore.textContent = String(Math.floor(data.score));
    this.gameOverCoins.textContent = String(data.coins);
    this.gameOverBest.textContent = String(Math.floor(data.best));
    this.gameOverDistance.textContent = formatMetres(data.distance);
    // textContent assignment keeps user input out of the HTML parser.
    this.gameOverUsername.textContent = data.username || USERNAME.defaultName;
    this.gameOverRecord.classList.toggle('is-hidden', !data.isRecord);
    this.lastHudKey = '';
    this.announce(`Run over. Score ${Math.floor(data.score)}. Best ${Math.floor(data.best)}.`);
  }

  setBestScore(best: number): void {
    this.menuBest.textContent = String(Math.floor(best));
  }

  showFatalError(message: string): void {
    this.fatalScreen.classList.remove('is-hidden');
    this.loadingScreen.classList.add('is-hidden');
    this.menuScreen.classList.add('is-hidden');
    this.hud.classList.add('is-hidden');
    const text = query<HTMLElement>(document, 'fatal-error-message');
    text.textContent = message;
    this.announce('Graphics unavailable. ' + message);
  }

  announce(message: string): void {
    this.announcer.textContent = message;
  }

  focusUsername(): void {
    this.usernameInput.focus({ preventScroll: true });
  }

  // --------------------------------------------------------------- settings

  get currentSettings(): Settings {
    return this.settings;
  }

  private readonly openSettings = (): void => {
    this.settingsReturnPhase = this.menuScreen.classList.contains('is-hidden') ? 'paused' : 'menu';
    this.settingsScreen.classList.remove('is-hidden');
    this.settingsScreen.setAttribute('aria-hidden', 'false');
    this.soundToggle.focus({ preventScroll: true });
  };

  private readonly closeSettings = (): void => {
    this.settingsScreen.classList.add('is-hidden');
    this.settingsScreen.setAttribute('aria-hidden', 'true');
    if (this.settingsReturnPhase === 'paused') {
      this.pauseButton.focus({ preventScroll: true });
    } else {
      this.usernameInput.focus({ preventScroll: true });
    }
  };

  private readonly onResetBest = (): void => {
    this.callbacks.onResetBest();
    this.setBestScore(0);
    this.announce('Best score reset');
  };

  private readonly onSoundToggle = (): void => {
    this.commitSettings({ ...this.settings, sound: !this.settings.sound });
  };

  private readonly onMusicToggle = (): void => {
    this.commitSettings({ ...this.settings, music: !this.settings.music });
  };

  private commitSettings(next: Settings): void {
    this.settings = next;
    this.applySettingsToControls();
    this.callbacks.onSettingsChanged(next);
  }

  private applySettingsToControls(): void {
    this.soundToggle.setAttribute('aria-checked', String(this.settings.sound));
    this.musicToggle.setAttribute('aria-checked', String(this.settings.music));
    const soundText = this.soundToggle.querySelector('.toggle__text');
    const musicText = this.musicToggle.querySelector('.toggle__text');
    if (soundText) {
      soundText.textContent = this.settings.sound ? 'On' : 'Off';
    }
    if (musicText) {
      musicText.textContent = this.settings.music ? 'On' : 'Off';
    }
  }

  // -------------------------------------------------------------- username

  private readonly onSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    const result = validateUsername(this.usernameInput.value);
    if (!result.ok) {
      this.showUsernameError(result.message);
      return;
    }
    this.clearUsernameError();
    this.callbacks.onStart(result.value);
  };

  private readonly onUsernameInput = (): void => {
    if (!this.usernameError.hidden) {
      this.clearUsernameError();
    }
  };

  private showUsernameError(message: string): void {
    this.usernameError.textContent = message;
    this.usernameError.hidden = false;
    this.usernameInput.setAttribute('aria-invalid', 'true');
    this.usernameInput.focus({ preventScroll: true });
  }

  clearUsernameError(): void {
    this.usernameError.hidden = true;
    this.usernameError.textContent = '';
    this.usernameInput.removeAttribute('aria-invalid');
  }
}
