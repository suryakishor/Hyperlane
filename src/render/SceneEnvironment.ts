import * as THREE from 'three';
import { softGlowTexture } from './Textures';
import type { QualityPreset } from '../core/GameConfig';
import { WORLD } from '../core/GameConfig';

const SKY_VERTEX = /* glsl */ `
varying vec3 vWorldPosition;
void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const SKY_FRAGMENT = /* glsl */ `
uniform vec3 topColor;
uniform vec3 horizonColor;
uniform vec3 glowColor;
uniform float horizonGlow;
varying vec3 vWorldPosition;
void main() {
  vec3 dir = normalize(vWorldPosition);
  float h = dir.y;
  // Two sided gradient: deep space above, neon haze at the horizon.
  float upper = smoothstep(0.0, 0.55, h);
  float lower = smoothstep(-0.25, 0.02, h);
  vec3 color = mix(horizonColor, topColor, upper);
  color = mix(color, glowColor, (1.0 - lower) * 0.35 * horizonGlow);
  float band = exp(-abs(h) * 14.0) * horizonGlow;
  color += glowColor * band * 0.55;
  gl_FragColor = vec4(color, 1.0);
}
`;

export interface EnvironmentHandles {
  scene: THREE.Scene;
  setQuality(preset: QualityPreset): void;
  update(delta: number, speed: number): void;
  dispose(): void;
}

/**
 * Owns the static look of the world: sky dome, fog, lighting and the cloud
 * sea far below the skyway. Gameplay objects are added by the World system.
 */
export function createEnvironment(): EnvironmentHandles {
  const scene = new THREE.Scene();
  const horizonColor = new THREE.Color(0x1a2a58);
  scene.fog = new THREE.Fog(0x121d40, 55, 235);

  const skyMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x05070f) },
      horizonColor: { value: horizonColor.clone() },
      glowColor: { value: new THREE.Color(0x3c6ad6) },
      horizonGlow: { value: 1 },
    },
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 24, 16), skyMaterial);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  scene.add(sky);

  // Cloud sea: sells the altitude without needing a large ground plane.
  const cloudTexture = softGlowTexture();
  const cloudMaterial = new THREE.MeshBasicMaterial({
    map: cloudTexture,
    color: 0x35508f,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    fog: false,
  });
  const cloudSea = new THREE.Mesh(new THREE.CircleGeometry(560, 32), cloudMaterial);
  cloudSea.rotation.x = -Math.PI / 2;
  cloudSea.position.y = -46;
  cloudSea.renderOrder = -1;
  scene.add(cloudSea);

  const hemisphere = new THREE.HemisphereLight(0x7fa6ff, 0x1a1030, 0.7);
  scene.add(hemisphere);

  const key = new THREE.DirectionalLight(0xdcecff, 1.15);
  key.position.set(5.5, 14, 6);
  key.target.position.set(0, 0, -12);
  scene.add(key, key.target);

  const rim = new THREE.DirectionalLight(0xb06bff, 0.5);
  rim.position.set(-7, 5, -10);
  scene.add(rim);

  const fill = new THREE.PointLight(0x37e6ff, 26, 34, 2);
  fill.position.set(0, 3.4, 5.5);
  scene.add(fill);

  const streakGroup = createSpeedStreaks();
  scene.add(streakGroup.points);

  let quality: QualityPreset | null = null;

  const setQuality = (preset: QualityPreset): void => {
    if (quality === preset) {
      return;
    }
    quality = preset;
    key.castShadow = preset.shadows;
    fill.visible = preset.extraLights;
    rim.visible = preset.extraLights;
    hemisphere.intensity = preset.extraLights ? 0.7 : 0.9;
    streakGroup.points.visible = preset.extraLights || preset.antialias;
    streakGroup.setCount(preset.grain ? 220 : 120);
  };

  const update = (delta: number, speed: number): void => {
    // Parallax: the cloud sea drifts slower than the track to add depth.
    cloudTexture.offset.x = (cloudTexture.offset.x + delta * 0.006) % 1;
    cloudTexture.offset.y = (cloudTexture.offset.y + delta * speed * 0.00004) % 1;
    streakGroup.update(delta, speed);
  };

  const dispose = (): void => {
    scene.remove(sky, cloudSea, hemisphere, key, key.target, rim, fill, streakGroup.points);
    sky.geometry.dispose();
    skyMaterial.dispose();
    cloudSea.geometry.dispose();
    cloudMaterial.dispose();
    streakGroup.dispose();
  };

  return { scene, setQuality, update, dispose };
}

interface SpeedStreaks {
  points: THREE.Points;
  update(delta: number, speed: number): void;
  setCount(count: number): void;
  dispose(): void;
}

const STREAK_MAX = 260;

/** Additive particle streaks that rush past the camera to convey speed. */
function createSpeedStreaks(): SpeedStreaks {
  const positions = new Float32Array(STREAK_MAX * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: 0x8fd8ff,
    size: 0.14,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;

  let active = 120;
  const speeds = new Float32Array(STREAK_MAX);
  const respawn = (index: number, initial: boolean): void => {
    const i = index * 3;
    positions[i] = (Math.random() - 0.5) * 16;
    positions[i + 1] = Math.random() * 7 - 0.4;
    positions[i + 2] = initial ? -Math.random() * WORLD.spawnDistance : -Math.random() * 120 - 6;
    speeds[index] = 1.15 + Math.random() * 0.5;
  };
  for (let i = 0; i < STREAK_MAX; i += 1) {
    respawn(i, true);
  }

  return {
    points,
    setCount(count: number): void {
      active = Math.max(0, Math.min(STREAK_MAX, Math.floor(count)));
      geometry.setDrawRange(0, active);
    },
    update(delta: number, speed: number): void {
      const factor = speed / 16;
      for (let i = 0; i < active; i += 1) {
        const p = i * 3 + 2;
        positions[p] = (positions[p] ?? 0) + delta * speed * speeds[i]! * factor;
        if ((positions[p] ?? 0) > 10) {
          respawn(i, false);
        }
      }
      geometry.attributes['position']!.needsUpdate = true;
    },
    dispose(): void {
      geometry.dispose();
      material.dispose();
    },
  };
}
