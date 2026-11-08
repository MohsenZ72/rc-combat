import type RAPIER_NS from "@dimforge/rapier2d-compat";
import type { Track } from "./track.js";

export type Rapier = typeof RAPIER_NS;

let rapierPromise: Promise<Rapier> | null = null;

/** Loads and initialises the Rapier WASM module once per process/page. */
export function loadRapier(): Promise<Rapier> {
  if (!rapierPromise) {
    rapierPromise = import("@dimforge/rapier2d-compat").then(async (mod) => {
      const R = (mod as unknown as { default?: Rapier }).default ?? (mod as unknown as Rapier);
      await R.init();
      return R;
    });
  }
  return rapierPromise;
}

export interface MoveResult {
  x: number;
  y: number;
  hitWall: boolean;
  /** Outward normal of the wall that was hit (pointing back into the track). */
  nx: number;
  ny: number;
}

export interface RayHit {
  distance: number;
  nx: number;
  ny: number;
}

/**
 * Rapier world containing the track walls and one collider per car.
 * Cars are moved with a kinematic character controller: it sweeps the car's
 * shape against the walls, so no speed can tunnel through them.
 */
export class PhysicsWorld {
  private readonly R: Rapier;
  private readonly world: RAPIER_NS.World;
  private readonly controller: RAPIER_NS.KinematicCharacterController;
  private readonly wallHandles = new Set<number>();
  private readonly cars = new Map<number, RAPIER_NS.Collider>();
  private readonly ray: RAPIER_NS.Ray;
  private readonly isWall = (collider: RAPIER_NS.Collider) => this.wallHandles.has(collider.handle);

  constructor(R: Rapier, track: Track, private readonly carRadius: number) {
    this.R = R;
    this.world = new R.World({ x: 0, y: 0 });
    const body = this.world.createRigidBody(R.RigidBodyDesc.fixed());
    for (const side of [1, -1] as const) {
      const pts = track.boundary(side);
      const verts = new Float32Array(pts.length * 2);
      pts.forEach((p, i) => {
        verts[i * 2] = p.x;
        verts[i * 2 + 1] = p.y;
      });
      const collider = this.world.createCollider(R.ColliderDesc.polyline(verts), body);
      this.wallHandles.add(collider.handle);
    }
    this.controller = this.world.createCharacterController(0.02);
    this.controller.setSlideEnabled(true);
    this.controller.disableAutostep();
    this.controller.disableSnapToGround();
    this.controller.setApplyImpulsesToDynamicBodies(false);
    this.ray = new R.Ray({ x: 0, y: 0 }, { x: 1, y: 0 });
    // Populate the broad-phase with the static walls.
    this.world.step();
  }

  addCar(slot: number, x: number, y: number): void {
    const desc = this.R.ColliderDesc.ball(this.carRadius).setTranslation(x, y).setSensor(true);
    this.cars.set(slot, this.world.createCollider(desc));
  }

  setCarPosition(slot: number, x: number, y: number): void {
    this.cars.get(slot)?.setTranslation({ x, y });
  }

  /** Moves a car by (dx, dy), stopping/sliding along walls. */
  moveCar(slot: number, x: number, y: number, dx: number, dy: number): MoveResult {
    const collider = this.cars.get(slot);
    if (!collider) throw new Error(`unknown car ${slot}`);
    collider.setTranslation({ x, y });
    this.controller.computeColliderMovement(collider, { x: dx, y: dy }, undefined, undefined, this.isWall);
    const moved = this.controller.computedMovement();
    let hitWall = false;
    let nx = 0;
    let ny = 0;
    const n = this.controller.numComputedCollisions();
    for (let i = 0; i < n; i++) {
      const hit = this.controller.computedCollision(i);
      if (!hit || !hit.collider || !this.wallHandles.has(hit.collider.handle)) continue;
      hitWall = true;
      nx += hit.normal1.x;
      ny += hit.normal1.y;
    }
    if (hitWall) {
      const len = Math.hypot(nx, ny) || 1;
      nx /= len;
      ny /= len;
    }
    const nxPos = x + moved.x;
    const nyPos = y + moved.y;
    collider.setTranslation({ x: nxPos, y: nyPos });
    return { x: nxPos, y: nyPos, hitWall, nx, ny };
  }

  /** First wall hit along a ray, or null. */
  raycastWall(x: number, y: number, dirX: number, dirY: number, maxDistance: number): RayHit | null {
    const len = Math.hypot(dirX, dirY);
    if (len === 0) return null;
    this.ray.origin = { x, y };
    this.ray.dir = { x: dirX / len, y: dirY / len };
    const hit = this.world.castRayAndGetNormal(this.ray, maxDistance, true, undefined, undefined, undefined, undefined, this.isWall);
    if (!hit) return null;
    return { distance: hit.timeOfImpact, nx: hit.normal.x, ny: hit.normal.y };
  }

  lineOfSight(ax: number, ay: number, bx: number, by: number): boolean {
    const d = Math.hypot(bx - ax, by - ay);
    return this.raycastWall(ax, ay, bx - ax, by - ay, d) === null;
  }

  dispose(): void {
    this.controller.free();
    this.world.free();
  }
}
