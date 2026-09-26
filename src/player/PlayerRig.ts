import * as THREE from 'three';
import { PLAYER } from '../core/GameConfig';
import { softGlowTexture } from '../render/Textures';
import type { Player } from './Player';
import { damp, lerp } from '../utils/math';

const COLORS = {
  // The rider is lit from behind and above by a dim key, so anything genuinely
  // dark in the palette collapses to black on screen. These are deliberately
  // mid-tone: the silhouette has to stay readable against the night skyway.
  suit: 0x3a4a7d,
  suitLight: 0x6274ad,
  accent: 0x37e6ff,
  accentWarm: 0xb06bff,
  visor: 0x9ff4ff,
  board: 0x33456f,
};

/**
 * Rig skeleton, in metres, measured from the hip (the rig's local origin).
 *
 * Proportions are pinned to `PLAYER.standHeight`: the board lifts the figure by
 * `boardTop`, the legs span `legLength`, and whatever height is left becomes the
 * hip-to-crown distance. The visual silhouette therefore fits the collision box
 * exactly, so a hazard never looks passable when it is not - or the reverse.
 *
 * Rotation signs follow the track: the player travels towards -Z, so a positive
 * X rotation tips the top of a limb backwards and a negative one forwards.
 */
const BOARD_TOP = 0.115;
const LEG_LENGTH = 0.78;

const RIG = {
  /** Top surface of the hoverboard deck - the soles rest here. */
  boardTop: BOARD_TOP,
  /** Hip to sole distance. */
  legLength: LEG_LENGTH,
  thighLength: 0.4,
  shinLength: 0.31,
  /** Hip to the top of the head. */
  crownOffset: PLAYER.standHeight - BOARD_TOP - LEG_LENGTH,
  headRadius: 0.13,
  /**
   * Head centre to the top of the helmet fin. The fin, not the helmet sphere, is
   * what tops out the silhouette, so the head is placed from `crownOffset` minus
   * this: the rig then matches `PLAYER.standHeight` instead of poking through a
   * gate the collider says it cleared.
   */
  crestHeight: 0.145,
  /** Slight forward lean while running. */
  runPitch: -0.14,
  /**
   * At full slide the rider throws themselves forward: the hip drops, the torso
   * pitches down far enough for the crown to clear a gate, and the legs trail out
   * behind with the boots just off the deck. Every number below is constrained by
   * that: the crown must stay under `PLAYER.slideHeight` and nothing may go below
   * the deck surface.
   */
  slidePitch: 1.3,
  slideDrop: 0.46,
  /**
   * Local thigh angle for the slide. The torso pitch alone already swings the legs
   * backwards, so this only has to add a little lift.
   */
  slideThigh: 0.1,
  /**
   * The knees fold backwards as the hip drops. A folded knee is what keeps the
   * boots clear of the deck: with the legs straight, the hip cannot drop at all.
   */
  slideKnee: -0.5,
  /** Vertical bob while running. */
  runBob: 0.03,
  strideSwing: 0.55,
  kneeBend: 0.7,
} as const;

const HIP_STAND = RIG.boardTop + RIG.legLength;

/** Sideways roll the rig settles into after a crash. */
const CRASH_ROLL = 1.5;

/**
 * Hip height once the rig is on its side. Lying down, the rider is only about as
 * thick as the torso, so the hip ends up far lower than the standing height.
 */
const CRASH_REST = 0.36;

interface Materials {
  suit: THREE.MeshStandardMaterial;
  suitLight: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  accentWarm: THREE.MeshStandardMaterial;
  visor: THREE.MeshStandardMaterial;
  board: THREE.MeshStandardMaterial;
}

function createMaterials(): Materials {
  return {
    suit: new THREE.MeshStandardMaterial({ color: COLORS.suit, roughness: 0.55, metalness: 0.25 }),
    suitLight: new THREE.MeshStandardMaterial({ color: COLORS.suitLight, roughness: 0.4, metalness: 0.35 }),
    accent: new THREE.MeshStandardMaterial({
      color: 0x0a1b26,
      emissive: new THREE.Color(COLORS.accent),
      emissiveIntensity: 1.5,
      roughness: 0.3,
    }),
    accentWarm: new THREE.MeshStandardMaterial({
      color: 0x1a0f26,
      emissive: new THREE.Color(COLORS.accentWarm),
      emissiveIntensity: 1.4,
      roughness: 0.3,
    }),
    visor: new THREE.MeshStandardMaterial({
      color: 0x061018,
      emissive: new THREE.Color(COLORS.visor),
      emissiveIntensity: 2.2,
      roughness: 0.2,
      metalness: 0.6,
    }),
    board: new THREE.MeshStandardMaterial({ color: COLORS.board, roughness: 0.42, metalness: 0.22 }),
  };
}

/**
 * The player character: an original "hyper courier" assembled from primitives
 * and animated by a hand-written rig. No external model, texture or clip is
 * involved, so the character costs one draw call batch and nothing to load.
 */
export class PlayerRig {
  readonly group = new THREE.Group();

  private readonly materials: Materials;
  private readonly geometries: Map<string, THREE.BufferGeometry> = new Map();
  private readonly body = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly legLeft = new THREE.Group();
  private readonly legRight = new THREE.Group();
  private readonly kneeLeft = new THREE.Group();
  private readonly kneeRight = new THREE.Group();
  private readonly armLeft = new THREE.Group();
  private readonly armRight = new THREE.Group();
  private readonly elbowLeft = new THREE.Group();
  private readonly elbowRight = new THREE.Group();
  private readonly board = new THREE.Group();
  private readonly scarf: THREE.Group[] = [];
  private readonly shadow: THREE.Mesh;
  private readonly shadowMaterial: THREE.MeshBasicMaterial;

  private phase = 0;
  private smoothedSlide = 0;
  private smoothedAir = 0;

  constructor() {
    this.materials = createMaterials();
    this.group.add(this.body);

    this.buildBoard();
    this.buildTorso();
    this.buildArms();
    this.buildLegs();
    this.buildScarf();
    this.body.position.y = HIP_STAND;

    const shadowGeometry = new THREE.PlaneGeometry(1.7, 1.7);
    this.shadowMaterial = new THREE.MeshBasicMaterial({
      map: softGlowTexture(),
      color: 0x000000,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    this.shadow = new THREE.Mesh(shadowGeometry, this.shadowMaterial);
    this.shadow.name = 'shadow';
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.03;
    this.group.add(this.shadow);
  }

  reset(): void {
    this.phase = 0;
    this.smoothedSlide = 0;
    this.smoothedAir = 0;
    this.group.rotation.set(0, 0, 0);
    this.group.position.set(0, 0, 0);
    this.body.position.y = HIP_STAND;
  }

  sync(player: Player, delta: number, speed: number): void {
    // Stride frequency tracks forward speed so the feet keep pace with the deck.
    this.phase += delta * (2.2 + speed * 0.42);

    this.smoothedSlide = damp(this.smoothedSlide, player.isSliding ? 1 : 0, 18, delta);
    this.smoothedAir = damp(this.smoothedAir, player.isJumping ? 1 : 0, 14, delta);

    this.group.position.x = player.x;
    this.group.position.y = player.y;

    const air = this.smoothedAir * (1 - this.smoothedSlide);
    const slide = this.smoothedSlide;
    const bob = Math.abs(Math.sin(this.phase)) * RIG.runBob * (1 - slide) * (1 - air);

    // While crashed, `updateCrash` owns the body transform: tipping the rig over is
    // its own animation and `sync` must not drag the hip back up every frame.
    if (!player.isCrashed) {
      // The hip is the last thing to move in a slide. It cannot drop until the torso
      // has pitched and the knees have folded, otherwise the straight legs are left
      // hanging below a hip that is too low and the boots sweep through the deck.
      this.body.position.y = HIP_STAND - RIG.slideDrop * slide * slide + bob;
      this.body.rotation.x = lerp(RIG.runPitch, -RIG.slidePitch, slide);
      this.body.rotation.z = -player.lean * (1 - slide);
    }

    this.board.position.y = 0.07 + Math.sin(this.phase * 0.7) * 0.02 * (1 - slide);
    // Only a slight nose-down attitude while sliding: the deck is what contacts
    // the track, so a steep pitch would bury the nose in the surface.
    this.board.rotation.x = lerp(-0.05, -0.12, slide);

    this.poseRun(player.lean, air, slide);
    this.poseScarf(delta, speed, slide);
    this.updateShadow(player, slide);
  }

  /**
   * Tips the rig over sideways after an impact, then lets it settle onto the deck.
   *
   * The hip drops as the roll completes: a rig lying on its side is about as thick
   * as the torso, so it has to come down close to the deck to look like it landed.
   */
  updateCrash(delta: number, player: Player): void {
    if (!player.isCrashed) {
      return;
    }
    this.body.rotation.z = damp(this.body.rotation.z, CRASH_ROLL, 6, delta);
    this.body.position.y = damp(this.body.position.y, CRASH_REST, 5, delta);
    this.scarf.forEach((piece, index) => {
      piece.rotation.x = damp(piece.rotation.x, -0.4 - index * 0.3, 6, delta);
    });
  }

  dispose(): void {
    for (const geometry of this.geometries.values()) {
      geometry.dispose();
    }
    this.geometries.clear();
    for (const material of Object.values(this.materials)) {
      material.dispose();
    }
    this.shadow.geometry.dispose();
    this.shadowMaterial.dispose();
  }

  // --------------------------------------------------------------- building

  /**
   * Box geometries are shared between identical parts (both thighs, both
   * forearms, ...) and disposed exactly once.
   */
  private box(width: number, height: number, depth: number): THREE.BufferGeometry {
    return this.shared(`box-${width}-${height}-${depth}`, () => new THREE.BoxGeometry(width, height, depth));
  }

  private sphere(radius: number, widthSegments: number, heightSegments: number): THREE.BufferGeometry {
    return this.shared(
      `sphere-${radius}-${widthSegments}-${heightSegments}`,
      () => new THREE.SphereGeometry(radius, widthSegments, heightSegments),
    );
  }

  private shared(key: string, create: () => THREE.BufferGeometry): THREE.BufferGeometry {
    const cached = this.geometries.get(key);
    if (cached) {
      return cached;
    }
    const geometry = create();
    this.geometries.set(key, geometry);
    return geometry;
  }

  private mesh(geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    parent.add(mesh);
    return mesh;
  }

  private buildBoard(): void {
    this.board.position.y = 0.07;
    // Named so the board can be excluded when auditing what the rider's body is
    // doing: the deck is meant to sit on the track surface.
    this.board.name = 'board';
    this.group.add(this.board);
    const deck = this.mesh(this.box(0.92, 0.09, 1.55), this.materials.board, this.board);
    deck.position.y = 0;
    const glow = this.mesh(this.box(0.8, 0.05, 1.2), this.materials.accent, this.board);
    glow.position.y = -0.03;
    // The chase camera looks down on the deck, so the underside glow alone left
    // the rider standing on what read as a black slab. This panel is the surface
    // actually seen from behind, and it is what makes the board read as a
    // hoverboard rather than a hole in the track.
    const topGlow = this.mesh(this.box(0.78, 0.022, 1.3), this.materials.accent, this.board);
    topGlow.position.y = 0.056;
    const nose = this.mesh(this.box(0.5, 0.12, 0.2), this.materials.accentWarm, this.board);
    nose.position.set(0, 0.01, -0.72);
  }

  private buildTorso(): void {
    this.torso.position.y = 0;
    this.body.add(this.torso);

    const hips = this.mesh(this.box(0.58, 0.14, 0.36), this.materials.suitLight, this.torso);
    hips.position.y = 0.03;
    const chest = this.mesh(this.box(0.56, 0.52, 0.33), this.materials.suit, this.torso);
    chest.position.y = 0.35;
    const core = this.mesh(this.box(0.26, 0.26, 0.09), this.materials.accent, this.torso);
    core.position.set(0, 0.38, -0.18);

    this.head.position.y = RIG.crownOffset - RIG.crestHeight;
    this.torso.add(this.head);
    this.mesh(this.sphere(RIG.headRadius, 14, 12), this.materials.suitLight, this.head);
    const visor = this.mesh(this.box(0.28, 0.1, 0.1), this.materials.visor, this.head);
    visor.position.set(0, 0.005, -0.1);
    const crest = this.mesh(this.box(0.045, 0.06, 0.2), this.materials.accent, this.head);
    crest.position.set(0, 0.1, 0.01);
  }

  private buildArms(): void {
    for (const [side, shoulder, elbow] of [
      [-1, this.armLeft, this.elbowLeft],
      [1, this.armRight, this.elbowRight],
    ] as const) {
      shoulder.position.set(0.32 * side, 0.52, 0);
      this.torso.add(shoulder);
      this.mesh(this.box(0.145, 0.3, 0.145), this.materials.suit, shoulder).position.y = -0.15;
      elbow.position.y = -0.3;
      shoulder.add(elbow);
      this.mesh(this.box(0.125, 0.28, 0.125), this.materials.suitLight, elbow).position.y = -0.14;
      this.mesh(this.box(0.145, 0.06, 0.145), this.materials.accent, elbow).position.y = -0.25;
    }
  }

  private buildLegs(): void {
    for (const [offset, leg, knee] of [
      [-0.165, this.legLeft, this.kneeLeft],
      [0.165, this.legRight, this.kneeRight],
    ] as const) {
      leg.position.set(offset, 0, 0);
      this.body.add(leg);
      this.mesh(this.box(0.19, RIG.thighLength, 0.2), this.materials.suit, leg).position.y =
        -RIG.thighLength / 2;
      knee.position.y = -RIG.thighLength;
      leg.add(knee);
      this.mesh(this.box(0.165, RIG.shinLength, 0.185), this.materials.suitLight, knee).position.y =
        -RIG.shinLength / 2;
      const boot = this.mesh(this.box(0.185, 0.1, 0.3), this.materials.accent, knee);
      boot.position.set(0, -RIG.shinLength - 0.01, -0.04);
    }
  }

  private buildScarf(): void {
    let parent: THREE.Object3D = this.torso;
    for (let i = 0; i < 3; i += 1) {
      const piece = new THREE.Group();
      // Each link is short and only slightly angled, because the rotations stack:
      // a long or steep chain would swing the tip of the scarf above the rider's
      // head, which is the tallest part of the silhouette.
      piece.position.set(0, i === 0 ? 0.56 : 0.005, i === 0 ? 0.15 : 0.145);
      const mesh = this.mesh(this.box(0.19 - i * 0.035, 0.07, 0.16), this.materials.accentWarm, piece);
      mesh.position.z = 0.06;
      parent.add(piece);
      this.scarf.push(piece);
      parent = piece;
    }
  }

  // ---------------------------------------------------------------- posing

  private poseRun(lean: number, air: number, slide: number): void {
    const stride = Math.sin(this.phase);
    const thigh = stride * RIG.strideSwing;
    // The knee folds through the back half of the stride, which tucks the sole
    // up behind instead of dragging it through the deck.
    const bendL = Math.max(0, -Math.sin(this.phase + 0.8)) * RIG.kneeBend;
    const bendR = Math.max(0, -Math.sin(this.phase + Math.PI + 0.8)) * RIG.kneeBend;

    // Airborne: knees tucked. Sliding: legs trailing, one arm reaching forward.
    const airThighL = 0.95;
    const airThighR = 0.3;
    const airKnee = -1.3;

    // The legs lead the slide: they have to be trailing and the knees folded
    // before the hip starts dropping, otherwise the boots sweep through the deck
    // during the transition.
    const legs = Math.min(1, slide * 1.8);

    this.legLeft.rotation.x = lerp(lerp(thigh, airThighL, air), RIG.slideThigh, legs);
    this.legRight.rotation.x = lerp(lerp(-thigh, airThighR, air), RIG.slideThigh * 1.15, legs);
    this.kneeLeft.rotation.x = lerp(lerp(-bendL, airKnee, air), RIG.slideKnee, legs);
    this.kneeRight.rotation.x = lerp(lerp(-bendR, airKnee * 0.75, air), RIG.slideKnee * 0.8, legs);

    const swing = stride * 0.7;
    // `armLeft` sits at -x, so an outward splay is a *negative* Z rotation on the
    // left and a positive one on the right. Getting these the wrong way round
    // folds both arms across the chest, which is what pinned the hands to the
    // torso mid-jump.
    const runSplay = 0.16;
    // Airborne: arms out for balance and tipped a little forward. The old pose
    // swung them 109 degrees up and behind, which read as flailing.
    const airSplay = 1.15;
    const airForward = 0.35;
    this.armLeft.rotation.x = lerp(lerp(-swing, airForward, air), 0.7, slide);
    this.armRight.rotation.x = lerp(lerp(swing, airForward, air), 0.35, slide);
    this.armLeft.rotation.z = lerp(lerp(-runSplay, -airSplay, air), -0.55, slide);
    this.armRight.rotation.z = lerp(lerp(runSplay, airSplay, air), 0.3, slide);
    // Elbows straighten as the arms come up: a deep bend on a raised arm swings
    // the forearm back over the rider's head.
    this.elbowLeft.rotation.x = lerp(lerp(-0.5, -0.3, air), -0.3, slide);
    this.elbowRight.rotation.x = lerp(lerp(-0.5, -0.3, air), -0.2, slide);

    // Steering leans the shoulders into the turn; the hips follow less.
    this.torso.rotation.y = -lean * 0.8 * (1 - slide);
    // The head stays level, so the rider keeps watching the track while sliding.
    this.head.rotation.x = lerp(-0.12, RIG.slidePitch - 0.25, slide);
  }

  /**
   * Streams the scarf backwards.
   *
   * The scarf hangs off the back of the torso, so the faster the rider goes the
   * more it lifts. Negative X rotation trails it up and back. While sliding, the
   * torso pitches forward, which would otherwise swing the scarf straight through
   * the deck, so most of that pitch is cancelled out again.
   */
  private poseScarf(delta: number, speed: number, slide: number): void {
    const wind = Math.min(1, Math.max(0, speed / 30));
    this.scarf.forEach((piece, index) => {
      // Kept close to horizontal: the rotations stack along the chain, so a steep
      // per-link angle would lift the tip above the crown.
      const trail = -(0.04 + wind * 0.09) + Math.sin(this.phase * 1.6 + index) * 0.05;
      const target = trail + index * 0.04 - slide * RIG.slidePitch * 0.92;
      piece.rotation.x = damp(piece.rotation.x, target, 9, delta);
      piece.rotation.y = damp(piece.rotation.y, Math.sin(this.phase * 1.1 + index * 0.8) * 0.25, 8, delta);
    });
  }

  private updateShadow(player: Player, slide: number): void {
    const lift = Math.min(1, Math.max(0, player.y / 2.4));
    const scale = (1.15 - lift * 0.45) * (1 - slide * 0.2);
    this.shadow.scale.setScalar(scale);
    this.shadow.position.y = 0.03 - player.y;
    this.shadowMaterial.opacity = (0.42 - lift * 0.26) * (player.isCrashed ? 0.6 : 1);
  }
}
