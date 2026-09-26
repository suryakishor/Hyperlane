/**
 * Authoritative game states.
 *
 * A single discriminated union is used instead of a set of booleans so that
 * contradictory combinations (playing while paused, over while loading) are
 * impossible to represent.
 */
export type GamePhase =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'menu' }
  | { readonly kind: 'ready'; readonly countdown: number }
  | { readonly kind: 'playing' }
  | { readonly kind: 'paused' }
  | { readonly kind: 'gameOver' };

export type GamePhaseName = GamePhase['kind'];

/** Phases where gameplay input is accepted. */
export const PLAYABLE_PHASES: ReadonlySet<GamePhaseName> = new Set<GamePhaseName>(['ready', 'playing']);

type PhaseListener = (phase: GamePhase, previous: GamePhase) => void;

/**
 * Owns the current phase and the legal transitions between phases.
 * Transition rules live in {@link ALLOWED_TRANSITIONS}.
 */
const ALLOWED_TRANSITIONS: Record<GamePhaseName, ReadonlySet<GamePhaseName>> = {
  loading: new Set(['menu', 'error']),
  error: new Set(['menu']),
  menu: new Set(['ready']),
  ready: new Set(['playing', 'paused', 'menu']),
  playing: new Set(['paused', 'gameOver', 'menu']),
  paused: new Set(['playing', 'ready', 'menu']),
  gameOver: new Set(['ready', 'menu']),
};

export class StateMachine {
  private current: GamePhase = { kind: 'loading' };
  private readonly listeners = new Set<PhaseListener>();

  get phase(): GamePhase {
    return this.current;
  }

  get name(): GamePhaseName {
    return this.current.kind;
  }

  is(...names: GamePhaseName[]): boolean {
    return names.includes(this.current.kind);
  }

  canTransitionTo(name: GamePhaseName): boolean {
    return ALLOWED_TRANSITIONS[this.current.kind].has(name);
  }

  /**
   * Attempts a transition. Illegal transitions are ignored (and reported in
   * dev builds) rather than throwing, because gameplay code frequently requests
   * transitions from several places in the same frame.
   */
  transitionTo(phase: GamePhase): boolean {
    const next = phase.kind;
    if (next === this.current.kind) {
      this.emit(phase);
      return true;
    }
    if (!this.canTransitionTo(next)) {
      if (import.meta.env?.DEV) {
        console.warn(`[hyperlane] illegal transition ${this.current.kind} -> ${next}`);
      }
      return false;
    }
    const previous = this.current;
    this.current = phase;
    this.emit(phase, previous);
    return true;
  }

  subscribe(listener: PhaseListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(phase: GamePhase, previous: GamePhase = phase): void {
    for (const listener of this.listeners) {
      listener(phase, previous);
    }
  }
}
