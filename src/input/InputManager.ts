export type GameAction = 'moveLeft' | 'moveRight' | 'jump' | 'slide' | 'pause';

const KEY_ACTIONS: Readonly<Record<string, GameAction>> = {
  ArrowLeft: 'moveLeft',
  ArrowRight: 'moveRight',
  ArrowUp: 'jump',
  Space: 'jump',
  ArrowDown: 'slide',
  Escape: 'pause',
  KeyP: 'pause',
};

const WASD_ACTIONS: Readonly<Record<string, GameAction>> = {
  KeyA: 'moveLeft',
  KeyD: 'moveRight',
  KeyW: 'jump',
  KeyS: 'slide',
};

/** Codes whose default browser behaviour (scrolling) must be suppressed. */
const PREVENT_DEFAULT_CODES = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Space',
]);

/** Minimum travel in CSS pixels before a drag is treated as a swipe. */
const SWIPE_THRESHOLD = 26;
/** The dominant axis must beat the other by this factor to avoid diagonals. */
const SWIPE_AXIS_RATIO = 1.4;
/** A pointer that never travels this far is a tap, not a swipe. */
const TAP_SLOP = 12;

export interface InputOptions {
  /** Element that receives pointer events (the whole app surface). */
  surface: HTMLElement;
  /** Gate so UI interactions (typing, menu clicks) never drive gameplay. */
  isEnabled: () => boolean;
  onAction: (action: GameAction) => void;
}

interface SwipeState {
  id: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  maxDistance: number;
  fired: boolean;
}

/**
 * Translates keyboard and pointer events into gameplay actions.
 *
 * Gameplay code only ever sees {@link GameAction}, so desktop and mobile share
 * a single movement implementation.
 */
export class InputManager {
  private swipe: SwipeState | null = null;

  constructor(private readonly options: InputOptions) {}

  attach(): void {
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    this.options.surface.addEventListener('pointerdown', this.onPointerDown, { passive: false });
    window.addEventListener('pointermove', this.onPointerMove, { passive: false });
    window.addEventListener('pointerup', this.onPointerUp, { passive: false });
    window.addEventListener('pointercancel', this.onPointerUp, { passive: false });
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    this.options.surface.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    this.swipe = null;
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.isContentEditable)) {
      return;
    }
    const action = KEY_ACTIONS[event.code] ?? WASD_ACTIONS[event.code];
    if (!action) {
      return;
    }
    if (PREVENT_DEFAULT_CODES.has(event.code)) {
      event.preventDefault();
    }
    if (this.options.isEnabled()) {
      this.options.onAction(action);
    }
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.options.isEnabled()) {
      return;
    }
    const target = event.target as HTMLElement | null;
    // Buttons and form controls handle their own interactions.
    if (target?.closest('button, input, select, a, [data-no-swipe]')) {
      return;
    }
    this.swipe = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      maxDistance: 0,
      fired: false,
    };
  };

  private onPointerMove = (event: PointerEvent): void => {
    const swipe = this.swipe;
    if (!swipe || swipe.id !== event.pointerId || swipe.fired) {
      return;
    }
    event.preventDefault();
    const dx = event.clientX - swipe.startX;
    const dy = event.clientY - swipe.startY;
    const distance = Math.hypot(dx, dy);
    swipe.lastX = event.clientX;
    swipe.lastY = event.clientY;
    if (distance > swipe.maxDistance) {
      swipe.maxDistance = distance;
    }
    if (swipe.maxDistance >= SWIPE_THRESHOLD) {
      const action = resolveSwipe(dx, dy);
      swipe.fired = true;
      if (action) {
        this.options.onAction(action);
      }
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    const swipe = this.swipe;
    if (!swipe || swipe.id !== event.pointerId) {
      return;
    }
    this.swipe = null;
    if (swipe.fired) {
      return;
    }
    if (swipe.maxDistance < TAP_SLOP) {
      return; // a tap, not a swipe
    }
    const action = resolveSwipe(event.clientX - swipe.startX, event.clientY - swipe.startY);
    if (action) {
      this.options.onAction(action);
    }
  };
}

/** Maps a swipe vector to a single dominant action, or null when ambiguous. */
function resolveSwipe(dx: number, dy: number): GameAction | null {
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (Math.max(absX, absY) < SWIPE_THRESHOLD) {
    return null;
  }
  if (absX > absY * SWIPE_AXIS_RATIO) {
    return dx > 0 ? 'moveRight' : 'moveLeft';
  }
  if (absY > absX * SWIPE_AXIS_RATIO) {
    return dy > 0 ? 'slide' : 'jump';
  }
  return null;
}
