import * as THREE from 'three';
import { COIN, LANE_CENTERS, WORLD, type QualityPreset } from '../core/GameConfig';
import { fluxTexture } from '../render/Textures';
import type { CoinPlacement } from '../world/WorldGenerator';
import { clamp01 } from '../utils/math';

export interface CoinRecord {
  x: number;
  y: number;
  z: number;
  radius: number;
  /** 0..1 position along an arcing run (1 = flat run). */
  arcT: number;
  arcHeight: number;
  phase: number;
  active: boolean;
}

const MAX_COINS = 260;
const BURST_POOL = 10;

/**
 * Collectible "flux cells".
 *
 * Coins live in a pre-allocated record array and a single InstancedMesh, so
 * collecting or recycling them never creates garbage.
 */
export class CoinManager {
  readonly group = new THREE.Group();
  readonly active: CoinRecord[] = [];

  private readonly mesh: THREE.InstancedMesh;
  private readonly coinMaterial: THREE.MeshStandardMaterial;
  private readonly coinGeometry: THREE.OctahedronGeometry;
  private readonly dummy = new THREE.Object3D();
  private readonly bursts: Burst[] = [];
  private readonly burstGeometry: THREE.SphereGeometry;
  private readonly burstMaterial: THREE.MeshBasicMaterial;

  private coinScale = 1;
  private time = 0;

  /**
   * The surface texture is injected so the manager can be exercised in a plain
   * Node environment, where `document` does not exist.
   */
  constructor(preset: QualityPreset, texture: THREE.Texture = fluxTexture()) {
    this.coinScale = 1;
    this.coinGeometry = new THREE.OctahedronGeometry(COIN.radius, Math.max(0, Math.round(preset.coinSegments / 3)));
    this.coinMaterial = new THREE.MeshStandardMaterial({
      map: texture,
      emissiveMap: texture,
      color: 0xffe9a8,
      emissive: new THREE.Color(0xffc247),
      emissiveIntensity: 1.4,
      roughness: 0.25,
      metalness: 0.7,
    });
    this.mesh = new THREE.InstancedMesh(this.coinGeometry, this.coinMaterial, MAX_COINS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.group.add(this.mesh);

    this.burstGeometry = new THREE.SphereGeometry(0.5, 8, 6);
    this.burstMaterial = new THREE.MeshBasicMaterial({
      color: 0xffe08a,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    for (let i = 0; i < BURST_POOL; i += 1) {
      const view = new THREE.Mesh(this.burstGeometry, this.burstMaterial.clone());
      view.visible = false;
      this.group.add(view);
      this.bursts.push({ view, life: 0, maxLife: 0.32 });
    }
  }

  get count(): number {
    return this.active.length;
  }

  get poolCapacity(): number {
    return MAX_COINS;
  }

  applyQuality(preset: QualityPreset): void {
    this.coinScale = preset.grain ? 1 : 0.92;
  }

  /** Spawns one coin run described by the generator. */
  spawnRun(placement: CoinPlacement, rowZ: number): void {
    const length = 4 + ((Math.abs(rowZ) | 0) % 3);
    const laneX = LANE_CENTERS[placement.lane] ?? 0;
    const arcHeight = placement.arc ? 1.35 : 0;
    for (let i = 0; i < length; i += 1) {
      if (this.active.length >= MAX_COINS) {
        return;
      }
      const t = length === 1 ? 0 : i / (length - 1);
      const record: CoinRecord = {
        x: laneX,
        y: placement.arc ? 0.85 + Math.sin(t * Math.PI) * arcHeight : placement.y,
        z: rowZ - 2.4 - i * COIN.runSpacing,
        radius: COIN.radius,
        arcT: t,
        arcHeight,
        phase: i * 0.7,
        active: true,
      };
      this.active.push(record);
    }
  }

  update(delta: number, speed: number): void {
    this.time += delta;
    for (let i = this.active.length - 1; i >= 0; i -= 1) {
      const coin = this.active[i];
      if (!coin) {
        continue;
      }
      coin.z += speed * delta;
      if (coin.z > WORLD.despawnDistance) {
        this.active.splice(i, 1);
      }
    }
    for (const burst of this.bursts) {
      if (burst.life <= 0) {
        continue;
      }
      burst.life -= delta;
      const t = 1 - clamp01(burst.life / burst.maxLife);
      const material = burst.view.material as THREE.MeshBasicMaterial;
      material.opacity = 0.7 * (1 - t);
      const scale = 0.5 + t * 1.6;
      burst.view.scale.setScalar(scale);
      if (burst.life <= 0) {
        burst.view.visible = false;
      }
    }
    this.writeInstances();
  }

  /** Removes a collected coin from the field and plays its pop effect. */
  collect(index: number): void {
    const coin = this.active[index];
    if (!coin) {
      return;
    }
    this.active.splice(index, 1);
    this.playBurst(coin.x, coin.y, coin.z);
  }

  clear(): void {
    this.active.length = 0;
    for (const burst of this.bursts) {
      burst.life = 0;
      burst.view.visible = false;
    }
    this.writeInstances();
  }

  dispose(): void {
    this.active.length = 0;
    this.coinGeometry.dispose();
    this.coinMaterial.dispose();
    this.burstGeometry.dispose();
    this.burstMaterial.dispose();
    for (const burst of this.bursts) {
      (burst.view.material as THREE.Material).dispose();
    }
    this.bursts.length = 0;
  }

  private playBurst(x: number, y: number, z: number): void {
    for (const burst of this.bursts) {
      if (burst.life > 0) {
        continue;
      }
      burst.life = burst.maxLife;
      burst.view.position.set(x, y, z);
      burst.view.scale.setScalar(0.5);
      burst.view.visible = true;
      return;
    }
  }

  private writeInstances(): void {
    const count = Math.min(this.active.length, MAX_COINS);
    for (let i = 0; i < count; i += 1) {
      const coin = this.active[i];
      if (!coin) {
        continue;
      }
      this.dummy.position.set(coin.x, coin.y + Math.sin(this.time * 2.4 + coin.phase) * 0.07, coin.z);
      this.dummy.rotation.set(0.35, this.time * 2.6 + coin.phase, 0);
      this.dummy.scale.setScalar(this.coinScale);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

interface Burst {
  view: THREE.Mesh;
  life: number;
  maxLife: number;
}
