/**
 * Hyperlane diagnostics.
 *
 * A small, documented, read-only window API, so QA and support can inspect real
 * game state from the console instead of guessing from screenshots. It never
 * mutates the game and exposes no debug shortcuts.
 */
import type { Game } from './Game';

export const HYPERLANE_VERSION = '1.0.0';

export interface HyperlaneDiagnostics {
  version: string;
  /** Current authoritative phase, mirrored on `<body data-phase>`. */
  telemetry(): ReturnType<Game['telemetry']>;
}

declare global {
  interface Window {
    hyperlane?: HyperlaneDiagnostics;
  }
}

export function installDiagnostics(game: Game): HyperlaneDiagnostics {
  const api: HyperlaneDiagnostics = {
    version: HYPERLANE_VERSION,
    telemetry: () => game.telemetry(),
  };
  window.hyperlane = api;
  return api;
}

export function uninstallDiagnostics(): void {
  delete window.hyperlane;
}
