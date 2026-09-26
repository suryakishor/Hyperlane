import * as THREE from 'three';
import { LANE_WIDTH, WORLD, type QualityPreset } from '../core/GameConfig';
import { deckTexture, windowTexture } from '../render/Textures';
import { hashToUnit } from '../utils/random';

const TOWER_SLOTS_PER_SEGMENT = 4;
const SEGMENT_COUNT = 9;
const SIDES = [-1, 1] as const;

/** Deterministic scenery slot inside a segment band. */
interface TowerSlot {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
}

/**
 * A recycled slice of the skyway.
 *
 * Segments own their slice of the skyline. When a segment falls behind the
 * player it is moved to the far end of the track and its scenery is re-derived
 * from the run seed, so the world stays bounded and deterministic.
 */
export class TrackSegment {
  z = 0;
  active = false;
  readonly slots: TowerSlot[] = [];

  constructor(
    readonly index: number,
    private sceneryDensity: number,
  ) {
    for (let i = 0; i < TOWER_SLOTS_PER_SEGMENT; i += 1) {
      this.slots.push({ x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1 });
    }
  }

  get instanceStart(): number {
    return this.index * TOWER_SLOTS_PER_SEGMENT;
  }

  setSceneryDensity(density: number): void {
    this.sceneryDensity = density;
  }

  /** Positions the segment band and re-derives its scenery from the seed. */
  place(startZ: number, seed: number): void {
    this.z = startZ;
    this.active = true;
    for (let i = 0; i < TOWER_SLOTS_PER_SEGMENT; i += 1) {
      const slot = this.slots[i];
      if (!slot) {
        continue;
      }
      const h = hashToUnit(seed, this.index * 97 + i * 7);
      const h2 = hashToUnit(seed, this.index * 97 + i * 7 + 3);
      const h3 = hashToUnit(seed, this.index * 97 + i * 7 + 11);
      const side = SIDES[i % 2] ?? 1;
      slot.x = side * (WORLD.trackHalfWidth + 2.4 + h2 * 44);
      slot.z = startZ - h * WORLD.segmentLength;
      slot.width = 2.4 + h3 * 4.5;
      slot.depth = 2.4 + h * 3.4;
      slot.height = 9 + h2 * 46;
      slot.y = -8 - h3 * 26;
    }
  }

  retire(): void {
    this.active = false;
  }

  /** Writes this segment's towers into the shared instanced mesh. */
  writeInstances(mesh: THREE.InstancedMesh, matrix: THREE.Matrix4, scratch: THREE.Object3D): void {
    const visible = Math.max(1, Math.round(TOWER_SLOTS_PER_SEGMENT * this.sceneryDensity));
    for (let i = 0; i < visible; i += 1) {
      const slot = this.slots[i];
      if (!slot) {
        continue;
      }
      scratch.position.set(slot.x, slot.y, slot.z);
      scratch.scale.set(slot.width, slot.height, slot.depth);
      scratch.rotation.set(0, 0, 0);
      scratch.updateMatrix();
      matrix.copy(scratch.matrix);
      mesh.setMatrixAt(this.instanceStart + i, matrix);
    }
  }
}

/**
 * The endless skyway: one long deck that scrolls like a treadmill, plus
 * recycled {@link TrackSegment} bands that supply the skyline.
 *
 * Scrolling in whole segment lengths keeps the pattern seamless while using a
 * single draw call for a several-hundred-metre track.
 */
export class Track {
  readonly group = new THREE.Group();
  readonly segments: TrackSegment[] = [];

  private readonly deck: THREE.Mesh;
  private readonly understructure: THREE.Mesh;
  private readonly rails: THREE.Mesh;
  private readonly towers: THREE.InstancedMesh;
  private readonly deckMaterial: THREE.MeshStandardMaterial;
  private readonly railMaterial: THREE.MeshStandardMaterial;
  private readonly towerMaterial: THREE.MeshStandardMaterial;
  private readonly understructureMaterial: THREE.MeshStandardMaterial;
  private readonly scratch = new THREE.Object3D();
  private readonly matrix = new THREE.Matrix4();

  private scroll = 0;
  private seed = 1;

  constructor(preset: QualityPreset, seed: number) {
    this.seed = seed;

    const trackWidth = WORLD.trackHalfWidth * 2;
    const length = WORLD.segmentCount * WORLD.segmentLength;
    const centreZ = -WORLD.segmentLength;

    const deckMap = deckTexture(trackWidth, LANE_WIDTH);
    this.deckMaterial = new THREE.MeshStandardMaterial({
      map: deckMap,
      emissiveMap: deckMap,
      emissive: new THREE.Color(0x6f9fe0),
      emissiveIntensity: 0.6,
      color: 0xb4c0e0,
      roughness: 0.72,
      metalness: 0.15,
    });
    this.deck = new THREE.Mesh(new THREE.BoxGeometry(trackWidth, 0.4, length), this.deckMaterial);
    this.deck.position.set(0, -0.2, centreZ);
    this.deck.receiveShadow = preset.shadows;
    this.group.add(this.deck);

    this.railMaterial = new THREE.MeshStandardMaterial({
      color: 0x1a2340,
      emissive: new THREE.Color(0xb06bff),
      emissiveIntensity: 0.85,
      roughness: 0.4,
      metalness: 0.4,
    });
    this.rails = new THREE.Mesh(new THREE.BoxGeometry(trackWidth + 0.34, 0.46, length), this.railMaterial);
    this.rails.position.set(0, -0.06, centreZ);
    this.group.add(this.rails);

    this.understructureMaterial = new THREE.MeshStandardMaterial({
      color: 0x0b1020,
      roughness: 0.92,
      metalness: 0.08,
    });
    this.understructure = new THREE.Mesh(buildUnderstructure(length), this.understructureMaterial);
    this.understructure.position.set(0, 0, centreZ);
    this.group.add(this.understructure);

    const windowMap = windowTexture();
    this.towerMaterial = new THREE.MeshStandardMaterial({
      color: 0x101a34,
      map: windowMap,
      emissiveMap: windowMap,
      emissive: new THREE.Color(0x88bbff),
      emissiveIntensity: 0.85,
      roughness: 0.85,
      metalness: 0.05,
    });
    this.towers = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      this.towerMaterial,
      SEGMENT_COUNT * TOWER_SLOTS_PER_SEGMENT,
    );
    this.towers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.towers.frustumCulled = false;
    this.group.add(this.towers);

    for (let i = 0; i < SEGMENT_COUNT; i += 1) {
      this.segments.push(new TrackSegment(i, preset.sceneryDensity));
    }
    this.reset(seed);
  }

  get segmentCount(): number {
    return SEGMENT_COUNT;
  }

  get activeSegmentCount(): number {
    let count = 0;
    for (const segment of this.segments) {
      if (segment.active) {
        count += 1;
      }
    }
    return count;
  }

  applyQuality(preset: QualityPreset): void {
    this.deck.receiveShadow = preset.shadows;
    for (const segment of this.segments) {
      segment.setSceneryDensity(preset.sceneryDensity);
    }
  }

  reset(seed: number): void {
    this.seed = seed;
    this.scroll = 0;
    for (const segment of this.segments) {
      segment.place(segment.index * -WORLD.segmentLength, seed);
    }
    this.updateTowers();
  }

  update(delta: number, speed: number): void {
    const travel = speed * delta;
    this.scroll += travel;
    // Wrap in whole segment lengths so the repeating pattern stays seamless.
    const wrapped = this.scroll % WORLD.segmentLength;
    this.deck.position.z = -WORLD.segmentLength + wrapped;
    this.understructure.position.z = -WORLD.segmentLength + wrapped;

    const recycleBehind = WORLD.segmentLength * 1.2;
    const span = SEGMENT_COUNT * WORLD.segmentLength;
    for (const segment of this.segments) {
      segment.z += travel;
      if (segment.z > recycleBehind) {
        segment.z -= span;
        segment.place(segment.z, this.seed);
      }
    }
    this.updateTowers();
  }

  dispose(): void {
    this.deck.geometry.dispose();
    this.deckMaterial.dispose();
    this.rails.geometry.dispose();
    this.railMaterial.dispose();
    this.understructure.geometry.dispose();
    this.understructureMaterial.dispose();
    this.towers.geometry.dispose();
    this.towerMaterial.dispose();
  }

  private updateTowers(): void {
    for (const segment of this.segments) {
      segment.writeInstances(this.towers, this.matrix, this.scratch);
    }
    this.towers.instanceMatrix.needsUpdate = true;
  }
}

/** Merged support pylons that hang below the skyway. */
function buildUnderstructure(length: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const count = Math.floor(length / WORLD.segmentLength);
  for (let i = 0; i < count; i += 1) {
    const z = (i + 0.5) * WORLD.segmentLength - length / 2;
    for (const x of [-WORLD.trackHalfWidth * 0.72, WORLD.trackHalfWidth * 0.72]) {
      const pylon = new THREE.BoxGeometry(0.7, 26, 0.7);
      pylon.translate(x, -13, z);
      parts.push(pylon);
    }
    const spine = new THREE.BoxGeometry(1.2, 0.5, 2.2);
    spine.translate(0, -1.5, z);
    parts.push(spine);
  }
  const merged = mergeBoxGeometries(parts);
  for (const part of parts) {
    part.dispose();
  }
  return merged ?? new THREE.BoxGeometry(1, 1, 1);
}

/**
 * Concatenates box geometries that share an attribute layout.
 * Hand-rolled so the game does not need the BufferGeometryUtils addon.
 */
function mergeBoxGeometries(geometries: readonly THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  const first = geometries[0];
  if (!first) {
    return null;
  }
  const merged = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv'] as const) {
    const size = first.getAttribute(name).itemSize;
    const total = geometries.reduce((sum, geometry) => sum + geometry.getAttribute(name).count, 0);
    const array = new Float32Array(total * size);
    let offset = 0;
    for (const geometry of geometries) {
      const attribute = geometry.getAttribute(name);
      array.set(attribute.array as Float32Array, offset);
      offset += attribute.array.length;
    }
    merged.setAttribute(name, new THREE.BufferAttribute(array, size));
  }
  merged.computeBoundingSphere();
  return merged;
}
