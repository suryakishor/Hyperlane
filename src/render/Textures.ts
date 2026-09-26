import * as THREE from 'three';

/**
 * Runtime-generated textures.
 *
 * Hyperlane ships zero image files: every surface pattern is drawn into an
 * offscreen canvas at boot, which keeps the download tiny and guarantees the
 * art is original to this project.
 */

const cache = new Map<string, THREE.Texture>();

function canvasTexture(
  key: string,
  size: number,
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
  repeat: [number, number] = [1, 1],
): THREE.Texture {
  const existing = cache.get(key);
  if (existing) {
    return existing;
  }
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Hyperlane: 2D canvas context unavailable, cannot generate textures.');
  }
  draw(ctx, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat[0], repeat[1]);
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  cache.set(key, texture);
  return texture;
}

/** Diagonal hazard stripes for barriers and gates. */
export function hazardTexture(): THREE.Texture {
  return canvasTexture('hazard', 128, (ctx, size) => {
    ctx.fillStyle = '#1b2136';
    ctx.fillRect(0, 0, size, size);
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(-Math.PI / 4);
    ctx.translate(-size, -size);
    for (let i = 0; i < 8; i += 1) {
      ctx.fillStyle = i % 2 === 0 ? '#ffce4a' : '#101629';
      ctx.fillRect(0, i * (size / 4), size * 2, size / 4);
    }
    ctx.restore();
  });
}

/** Emissive dot pattern used on coins and pickups. */
export function fluxTexture(): THREE.Texture {
  return canvasTexture('flux', 128, (ctx, size) => {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, '#fff4c4');
    gradient.addColorStop(0.45, '#ffd35c');
    gradient.addColorStop(1, '#c07a12');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  });
}

/** Windows for the skyline towers. */
export function windowTexture(): THREE.Texture {
  return canvasTexture('windows', 128, (ctx, size) => {
    ctx.fillStyle = '#080d1d';
    ctx.fillRect(0, 0, size, size);
    const cols = 6;
    const rows = 8;
    const cell = size / cols;
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const lit = ((x * 7 + y * 13) % 5) !== 0;
        const alpha = 0.25 + (((x * 3 + y * 5) % 7) / 7) * 0.6;
        ctx.fillStyle = lit ? `rgba(140, 220, 255, ${alpha})` : 'rgba(40, 60, 100, 0.35)';
        ctx.fillRect(x * cell + cell * 0.22, y * cell + cell * 0.25, cell * 0.5, cell * 0.42);
      }
    }
  });
}

/** Soft radial sprite for the cloud sea and light bloom stand-ins. */
export function softGlowTexture(): THREE.Texture {
  return canvasTexture('glow', 128, (ctx, size) => {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
    gradient.addColorStop(0.35, 'rgba(180,215,255,0.45)');
    gradient.addColorStop(1, 'rgba(120,160,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  });
}

/**
 * Skyway deck surface.
 *
 * The texture is mapped so that U spans the full track width and V repeats
 * every few metres along the track, which lets the lane guides glow without
 * needing extra geometry. Lane guide positions match `LANE_CENTERS`.
 */
export function deckTexture(trackWidth: number, laneWidth: number): THREE.Texture {
  const key = `deck:${trackWidth.toFixed(2)}:${laneWidth.toFixed(2)}`;
  const toU = (worldX: number): number => (worldX + trackWidth / 2) / trackWidth;
  return canvasTexture(
    key,
    256,
    (ctx, size) => {
      ctx.fillStyle = '#141a2e';
      ctx.fillRect(0, 0, size, size);

      // Transverse deck seams (V axis = along the track).
      ctx.strokeStyle = 'rgba(96, 140, 200, 0.28)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 6; i += 1) {
        const p = (i * size) / 6;
        ctx.beginPath();
        ctx.moveTo(0, p);
        ctx.lineTo(size, p);
        ctx.stroke();
      }

      // Lane guides and edge rails (U axis = across the track).
      const lines: Array<[number, string, number]> = [
        [toU(0), 'rgba(120, 235, 255, 0.85)', 3],
        [toU(-laneWidth / 2), 'rgba(150, 205, 255, 0.7)', 3],
        [toU(laneWidth / 2), 'rgba(150, 205, 255, 0.7)', 3],
        [toU(-trackWidth / 2 + 0.16), 'rgba(185, 120, 255, 0.8)', 5],
        [toU(trackWidth / 2 - 0.16), 'rgba(185, 120, 255, 0.8)', 5],
      ];
      for (const [u, color, width] of lines) {
        ctx.fillStyle = color;
        ctx.fillRect(u * size - width / 2, 0, width, size);
      }

      // Wear detail so the deck is not a flat surface.
      ctx.fillStyle = 'rgba(8, 12, 24, 0.35)';
      for (let i = 0; i < 60; i += 1) {
        const x = ((i * 137) % size) + 4;
        const y = ((i * 89) % size) + 2;
        ctx.fillRect(x, y, 4, 2);
      }
    },
    [1, 10],
  );
}

export function disposeTextures(): void {
  for (const texture of cache.values()) {
    texture.dispose();
  }
  cache.clear();
}
