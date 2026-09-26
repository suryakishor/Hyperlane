import './ui/styles.css';
import { Game } from './core/Game';
import { installDiagnostics, uninstallDiagnostics } from './core/Diagnostics';

/** Replaces the page content with a readable explanation of a fatal failure. */
function showFatalError(root: HTMLElement, title: string, detail: string): void {
  const panel = document.createElement('main');
  panel.className = 'fatal';

  const heading = document.createElement('h1');
  heading.className = 'fatal__title';
  heading.textContent = title;

  const body = document.createElement('p');
  body.className = 'fatal__detail';
  body.textContent = detail;

  panel.append(heading, body);
  root.replaceChildren(panel);
}

/**
 * Entry point: boots the game and exposes the read-only diagnostics API.
 * Any boot failure is surfaced in the UI rather than left as a blank canvas.
 */
async function bootstrap(): Promise<void> {
  const app = document.getElementById('app');
  const canvas = document.getElementById('game-canvas');

  if (!(app instanceof HTMLElement) || !(canvas instanceof HTMLCanvasElement)) {
    showFatalError(
      document.body,
      'Hyperlane could not start',
      'The page markup is incomplete. Please reload the page.',
    );
    return;
  }

  let game: Game;
  try {
    game = new Game(canvas, app);
  } catch (error) {
    console.error('[hyperlane] boot failed', error);
    showFatalError(
      app,
      'Hyperlane could not start',
      'WebGL is unavailable or the scene failed to build. Try a different browser, or enable hardware acceleration.',
    );
    return;
  }

  installDiagnostics(game);

  try {
    await game.start();
  } catch (error) {
    console.error('[hyperlane] start failed', error);
    showFatalError(
      app,
      'Hyperlane could not start',
      'The game failed while loading its assets. Please reload the page.',
    );
    return;
  }

  window.addEventListener('pagehide', () => {
    game.dispose();
    uninstallDiagnostics();
  });
}

void bootstrap();
