import * as THREE from 'three';
import { hazardTexture } from '../render/Textures';
import { WORLD } from '../core/GameConfig';
import type { ObstacleKind, LaneIndex } from '../world/WorldGenerator';
import { LANE_CENTERS } from '../core/GameConfig';

export interface Obstacle {
  kind: ObstacleKind;
  lane: LaneIndex;
  x: number;
  y: number;
  z: number;
  prevZ: number;
  minY: number;
  maxY: number;
  halfWidth: number;
  halfDepth: number;
  phase: number;
  active: boolean;
  view: THREE.Group;
}

interface KindSpec {
  halfWidth: number;
  halfDepth: number;
  minY: number;
  maxY: number;
}

const SPECS: Record<ObstacleKind, KindSpec> = {
  barrier: { halfWidth: 1.12, halfDepth: 0.3, minY: 0, maxY: 0.95 },
  pylon: { halfWidth: 1.05, halfDepth: 0.45, minY: 0, maxY: 2.75 },
  gate: { halfWidth: 1.12, halfDepth: 0.28, minY: 1.18, maxY: 2.7 },
  drone: { halfWidth: 0.8, halfDepth: 0.5, minY: 0.55, maxY: 1.55 },
};

const DRONE_SWING = 1.15;

/**
 * Pooled obstacle field.
 *
 * Every obstacle kind owns a fixed pool of meshes; spawning reuses a mesh and
 * passing the despawn horizon returns it. The manager never allocates during
 * gameplay.
 */
export class ObstacleManager {
  readonly group = new THREE.Group();

  readonly active: Obstacle[] = [];
  private readonly freeByKind = new Map<ObstacleKind, THREE.Group[]>();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly hazard: THREE.Texture;
  private time = 0;

  /**
   * The hazard surface is injected so the manager can be exercised in a plain
   * Node environment, where `document` does not exist.
   */
  constructor(hazard: THREE.Texture = hazardTexture()) {
    this.group.name = 'obstacles';
    this.hazard = hazard;
  }

  get count(): number {
    return this.active.length;
  }

  countOfKind(kind: ObstacleKind): number {
    let count = 0;
    for (const obstacle of this.active) {
      if (obstacle.kind === kind) {
        count += 1;
      }
    }
    return count;
  }

  spawn(kind: ObstacleKind, lane: LaneIndex, z: number): Obstacle {
    const spec = SPECS[kind];
    const view = this.acquire(kind);
    const laneX = LANE_CENTERS[lane] ?? 0;
    const obstacle: Obstacle = {
      kind,
      lane,
      x: laneX,
      y: (spec.minY + spec.maxY) / 2,
      z,
      prevZ: z,
      minY: spec.minY,
      maxY: spec.maxY,
      halfWidth: spec.halfWidth,
      halfDepth: spec.halfDepth,
      phase: (lane * 1.7 + z * 0.013) % (Math.PI * 2),
      active: true,
      view,
    };
    view.visible = true;
    view.position.set(obstacle.x, 0, z);
    view.rotation.set(0, 0, 0);
    this.active.push(obstacle);
    return obstacle;
  }

  update(delta: number, speed: number): void {
    this.time += delta;
    for (let i = this.active.length - 1; i >= 0; i -= 1) {
      const obstacle = this.active[i];
      if (!obstacle) {
        continue;
      }
      obstacle.prevZ = obstacle.z;
      obstacle.z += speed * delta;
      if (obstacle.z > WORLD.despawnDistance) {
        this.retire(i);
        continue;
      }
      if (obstacle.kind === 'drone') {
        // Hovering craft weaves inside its lane band.
        const swing = Math.sin(this.time * 1.7 + obstacle.phase) * DRONE_SWING;
        obstacle.x = (LANE_CENTERS[obstacle.lane] ?? 0) + swing;
        obstacle.view.position.x = obstacle.x;
        obstacle.view.position.y = Math.sin(this.time * 2.6 + obstacle.phase) * 0.12;
        obstacle.view.rotation.y += delta * 2.4;
      }
      obstacle.view.position.z = obstacle.z;
    }
  }

  /** Removes every live obstacle (used when a run restarts). */
  clear(): void {
    for (let i = this.active.length - 1; i >= 0; i -= 1) {
      this.retire(i);
    }
  }

  dispose(): void {
    this.clear();
    for (const pool of this.freeByKind.values()) {
      for (const view of pool) {
        this.group.remove(view);
      }
    }
    this.freeByKind.clear();
    for (const geometry of this.geometries) {
      geometry.dispose();
    }
    for (const material of this.materials) {
      material.dispose();
    }
    this.geometries.length = 0;
    this.materials.length = 0;
  }

  /** Returns the free list for a kind, creating it on first use. */
  private poolFor(kind: ObstacleKind): THREE.Group[] {
    const existing = this.freeByKind.get(kind);
    if (existing) {
      return existing;
    }
    const pool: THREE.Group[] = [];
    this.freeByKind.set(kind, pool);
    return pool;
  }

  private retire(index: number): void {
    const obstacle = this.active[index];
    if (!obstacle) {
      return;
    }
    this.active.splice(index, 1);
    obstacle.active = false;
    obstacle.view.visible = false;
    this.poolFor(obstacle.kind).push(obstacle.view);
  }

  private acquire(kind: ObstacleKind): THREE.Group {
    const reused = this.poolFor(kind).pop();
    if (reused) {
      reused.visible = true;
      return reused;
    }
    const view = this.buildView(kind);
    this.group.add(view);
    return view;
  }

  private buildView(kind: ObstacleKind): THREE.Group {
    switch (kind) {
      case 'barrier':
        return this.buildBarrier();
      case 'pylon':
        return this.buildPylon();
      case 'gate':
        return this.buildGate();
      case 'drone':
        return this.buildDrone();
    }
  }

  private track<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry);
    return geometry;
  }

  private material<T extends THREE.Material>(material: T): T {
    this.materials.push(material);
    return material;
  }

  // ------------------------------------------------------------ mesh builders

  private buildBarrier(): THREE.Group {
    const group = new THREE.Group();
    const hazard = this.hazard;
    const body = this.material(
      new THREE.MeshStandardMaterial({
        map: hazard,
        emissiveMap: hazard,
        emissive: new THREE.Color(0xff9c3a),
        emissiveIntensity: 0.5,
        color: 0xd8d8d8,
        roughness: 0.6,
        metalness: 0.2,
      }),
    );
    const frame = this.material(new THREE.MeshStandardMaterial({ color: 0x1b2338, roughness: 0.5, metalness: 0.5 }));
    const strip = this.material(
      new THREE.MeshStandardMaterial({
        color: 0x0b2030,
        emissive: new THREE.Color(0x37e6ff),
        emissiveIntensity: 2,
      }),
    );

    const panel = new THREE.Mesh(this.track(new THREE.BoxGeometry(2.2, 0.72, 0.4)), body);
    panel.position.y = 0.5;
    group.add(panel);

    const base = new THREE.Mesh(this.track(new THREE.BoxGeometry(2.3, 0.16, 0.62)), frame);
    base.position.y = 0.08;
    group.add(base);

    for (const x of [-0.95, 0, 0.95]) {
      const foot = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.16, 0.9, 0.2)), frame);
      foot.position.set(x, 0.5, -0.22);
      group.add(foot);
    }

    const light = new THREE.Mesh(this.track(new THREE.BoxGeometry(1.7, 0.08, 0.5)), strip);
    light.position.y = 0.9;
    group.add(light);
    return group;
  }

  /**
   * A lane-blocking pylon.
   *
   * It cannot be jumped, so it has to be read from far away and dodged sideways.
   * The hull is deliberately light and the warning bands are tall, emissive and
   * slightly proud of the body: a dark block that only resolves at 5 m is
   * indistinguishable from a rendering artefact.
   */
  private buildPylon(): THREE.Group {
    const group = new THREE.Group();
    const shell = this.material(
      new THREE.MeshStandardMaterial({ color: 0x9fb2d8, roughness: 0.45, metalness: 0.25 }),
    );
    const trim = this.material(
      new THREE.MeshStandardMaterial({
        color: 0x2a1020,
        emissive: new THREE.Color(0xff4f7d),
        emissiveIntensity: 2.6,
      }),
    );
    const cap = this.material(
      new THREE.MeshStandardMaterial({
        color: 0x1a0c18,
        emissive: new THREE.Color(0xffd166),
        emissiveIntensity: 2.2,
      }),
    );

    const body = new THREE.Mesh(this.track(new THREE.BoxGeometry(2.0, 2.6, 0.8)), shell);
    body.position.y = 1.3;
    group.add(body);

    const capBand = new THREE.Mesh(this.track(new THREE.BoxGeometry(2.3, 0.22, 1.0)), cap);
    capBand.position.y = 2.62;
    group.add(capBand);

    // Warning bands, proud of the hull but flush with the collider width
    // (SPECS.pylon.halfWidth), so the read never disagrees with the hitbox.
    for (const y of [0.55, 1.3, 2.05]) {
      const band = new THREE.Mesh(this.track(new THREE.BoxGeometry(2.1, 0.26, 0.9)), trim);
      band.position.y = y;
      group.add(band);
    }

    const beacon = new THREE.Mesh(this.track(new THREE.SphereGeometry(0.22, 12, 10)), cap);
    beacon.position.y = 2.95;
    group.add(beacon);
    return group;
  }

  private buildGate(): THREE.Group {
    const group = new THREE.Group();
    const hazard = this.hazard;
    const frame = this.material(new THREE.MeshStandardMaterial({ color: 0x1c2440, roughness: 0.5, metalness: 0.5 }));
    const beam = this.material(
      new THREE.MeshStandardMaterial({
        map: hazard,
        emissiveMap: hazard,
        emissive: new THREE.Color(0x37e6ff),
        emissiveIntensity: 0.45,
        color: 0xc8d4f0,
        roughness: 0.55,
        metalness: 0.3,
      }),
    );

    for (const x of [-1.05, 1.05]) {
      const post = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.28, 2.7, 0.6)), frame);
      post.position.set(x, 1.35, 0);
      group.add(post);
    }
    const header = new THREE.Mesh(this.track(new THREE.BoxGeometry(2.1, 0.85, 0.5)), beam);
    header.position.y = 1.95;
    group.add(header);

    const lip = new THREE.Mesh(this.track(new THREE.BoxGeometry(2.2, 0.16, 0.62)), frame);
    lip.position.y = 1.5;
    group.add(lip);

    const signal = this.material(
      new THREE.MeshStandardMaterial({
        color: 0x061a22,
        emissive: new THREE.Color(0x5cffb1),
        emissiveIntensity: 1.8,
      }),
    );
    const strip = new THREE.Mesh(this.track(new THREE.BoxGeometry(1.9, 0.08, 0.56)), signal);
    strip.position.y = 1.42;
    group.add(strip);
    return group;
  }

  private buildDrone(): THREE.Group {
    const group = new THREE.Group();
    const shell = this.material(new THREE.MeshStandardMaterial({ color: 0x2a1f45, roughness: 0.4, metalness: 0.6 }));
    const core = this.material(
      new THREE.MeshStandardMaterial({
        color: 0x160a24,
        emissive: new THREE.Color(0xb06bff),
        emissiveIntensity: 2.4,
      }),
    );

    const hull = new THREE.Mesh(this.track(new THREE.OctahedronGeometry(0.55, 0)), shell);
    hull.position.y = 1.05;
    group.add(hull);

    const eye = new THREE.Mesh(this.track(new THREE.SphereGeometry(0.24, 10, 8)), core);
    eye.position.set(0, 1.05, -0.42);
    group.add(eye);

    const ring = new THREE.Mesh(this.track(new THREE.TorusGeometry(0.72, 0.07, 6, 16)), core);
    ring.position.y = 1.05;
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    for (const x of [-0.6, 0.6]) {
      const fin = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.5, 0.07, 0.24)), shell);
      fin.position.set(x, 1.05, 0.1);
      group.add(fin);
    }
    return group;
  }
}
