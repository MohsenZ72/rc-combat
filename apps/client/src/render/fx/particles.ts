import { Color4, DynamicTexture, ParticleSystem, Vector3, type Scene, type Texture } from "@babylonjs/core";

/** Soft round sprite used by every particle effect (generated, no image files). */
export function flareTexture(scene: Scene): Texture {
  const t = new DynamicTexture("fx-flare", { width: 64, height: 64 }, scene, false);
  const g = t.getContext() as CanvasRenderingContext2D;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.65)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  t.hasAlpha = true;
  t.update();
  return t;
}

export type BurstKind = "fire" | "smoke" | "debris" | "sparks" | "electric" | "heal" | "splash" | "sparkle";

interface Spec {
  capacity: number;
  count: number;
  color1: string;
  color2: string;
  dead: string;
  size: [number, number];
  life: [number, number];
  power: [number, number];
  gravity: number;
  blend: number;
  spread: number;
}

const SPECS: Record<BurstKind, Spec> = {
  fire: { capacity: 160, count: 90, color1: "#ffe08a", color2: "#ff5a1a", dead: "#40100000", size: [0.8, 2.6], life: [0.2, 0.55], power: [6, 16], gravity: 2, blend: ParticleSystem.BLENDMODE_ADD, spread: 1 },
  smoke: { capacity: 120, count: 50, color1: "#55555588", color2: "#22222266", dead: "#11111100", size: [2.2, 5.5], life: [0.8, 1.8], power: [2, 6], gravity: 3, blend: ParticleSystem.BLENDMODE_STANDARD, spread: 1 },
  debris: { capacity: 60, count: 26, color1: "#2a2d31ff", color2: "#5a5048ff", dead: "#2a2d3100", size: [0.25, 0.6], life: [0.6, 1.2], power: [8, 18], gravity: -24, blend: ParticleSystem.BLENDMODE_STANDARD, spread: 1 },
  sparks: { capacity: 60, count: 30, color1: "#bff4ff", color2: "#2fd3ff", dead: "#0040ff00", size: [0.15, 0.4], life: [0.15, 0.35], power: [8, 16], gravity: -10, blend: ParticleSystem.BLENDMODE_ADD, spread: 1 },
  electric: { capacity: 80, count: 60, color1: "#e8fbff", color2: "#2fd3ff", dead: "#2fd3ff00", size: [0.2, 0.6], life: [0.2, 0.5], power: [2, 7], gravity: 0, blend: ParticleSystem.BLENDMODE_ADD, spread: 1.6 },
  heal: { capacity: 60, count: 36, color1: "#c8ffd8", color2: "#3ddc84", dead: "#3ddc8400", size: [0.3, 0.7], life: [0.6, 1.1], power: [1, 3], gravity: 4, blend: ParticleSystem.BLENDMODE_ADD, spread: 1.4 },
  splash: { capacity: 90, count: 26, color1: "#e8f6ffdd", color2: "#7fdcffaa", dead: "#7fdcff00", size: [0.25, 0.7], life: [0.35, 0.7], power: [4, 9], gravity: -22, blend: ParticleSystem.BLENDMODE_STANDARD, spread: 0.6 },
  sparkle: { capacity: 50, count: 30, color1: "#fff6c2", color2: "#ffc933", dead: "#ffc93300", size: [0.2, 0.6], life: [0.3, 0.7], power: [3, 8], gravity: -4, blend: ParticleSystem.BLENDMODE_ADD, spread: 1 },
};

/**
 * Pooled one-shot particle bursts. Each kind keeps a few systems and reuses
 * them round-robin, so explosions never allocate during a race.
 */
export class Bursts {
  private readonly pools = new Map<BurstKind, { systems: ParticleSystem[]; next: number }>();

  constructor(private readonly scene: Scene, private readonly texture: Texture) {}

  emit(kind: BurstKind, x: number, y: number, z: number, scale = 1): void {
    let pool = this.pools.get(kind);
    if (!pool) {
      pool = { systems: [], next: 0 };
      this.pools.set(kind, pool);
    }
    let ps = pool.systems[pool.next];
    if (!ps) {
      ps = this.make(kind);
      pool.systems.push(ps);
    }
    pool.next = (pool.next + 1) % 4;
    (ps.emitter as Vector3).set(x, y, z);
    const spec = SPECS[kind];
    ps.minSize = spec.size[0] * scale;
    ps.maxSize = spec.size[1] * scale;
    ps.manualEmitCount = Math.round(spec.count * Math.min(2, scale));
    if (!ps.isStarted()) ps.start();
  }

  private make(kind: BurstKind): ParticleSystem {
    const s = SPECS[kind];
    const ps = new ParticleSystem(`fx-${kind}`, s.capacity, this.scene);
    ps.particleTexture = this.texture;
    ps.emitter = new Vector3();
    ps.manualEmitCount = 0;
    ps.minEmitBox = new Vector3(-0.3, 0, -0.3);
    ps.maxEmitBox = new Vector3(0.3, 0.3, 0.3);
    ps.direction1 = new Vector3(-s.spread, 0.6, -s.spread);
    ps.direction2 = new Vector3(s.spread, 1.4, s.spread);
    ps.color1 = Color4.FromHexString(s.color1.length === 7 ? `${s.color1}ff` : s.color1);
    ps.color2 = Color4.FromHexString(s.color2.length === 7 ? `${s.color2}ff` : s.color2);
    ps.colorDead = Color4.FromHexString(s.dead);
    ps.minLifeTime = s.life[0];
    ps.maxLifeTime = s.life[1];
    ps.minEmitPower = s.power[0];
    ps.maxEmitPower = s.power[1];
    ps.gravity = new Vector3(0, s.gravity, 0);
    ps.blendMode = s.blend;
    ps.minAngularSpeed = -2;
    ps.maxAngularSpeed = 2;
    ps.updateSpeed = 0.016;
    return ps;
  }

  dispose(): void {
    for (const p of this.pools.values()) for (const s of p.systems) s.dispose();
    this.pools.clear();
  }
}

/** A continuous emitter that follows something (rocket trail, drift smoke, fuse spark). */
export function trail(scene: Scene, texture: Texture, kind: "rocket" | "drift" | "fuse" | "spray"): ParticleSystem {
  const ps = new ParticleSystem(`trail-${kind}`, kind === "drift" ? 120 : 180, scene);
  ps.particleTexture = texture;
  ps.emitter = new Vector3();
  ps.minEmitBox = new Vector3(-0.1, 0, -0.1);
  ps.maxEmitBox = new Vector3(0.1, 0, 0.1);
  ps.updateSpeed = 0.016;
  switch (kind) {
    case "rocket":
      ps.color1 = new Color4(1, 0.85, 0.5, 1);
      ps.color2 = new Color4(0.75, 0.75, 0.78, 0.75);
      ps.colorDead = new Color4(0.4, 0.4, 0.42, 0);
      ps.minSize = 0.5;
      ps.maxSize = 1.6;
      ps.minLifeTime = 0.35;
      ps.maxLifeTime = 0.9;
      ps.emitRate = 120;
      ps.minEmitPower = 0.2;
      ps.maxEmitPower = 1;
      ps.gravity = new Vector3(0, 1.5, 0);
      break;
    case "drift":
      ps.color1 = new Color4(0.9, 0.9, 0.9, 0.55);
      ps.color2 = new Color4(0.75, 0.75, 0.75, 0.4);
      ps.colorDead = new Color4(0.7, 0.7, 0.7, 0);
      ps.minSize = 0.6;
      ps.maxSize = 1.8;
      ps.minLifeTime = 0.5;
      ps.maxLifeTime = 1.1;
      ps.emitRate = 0;
      ps.minEmitPower = 0.3;
      ps.maxEmitPower = 1.2;
      ps.gravity = new Vector3(0, 1, 0);
      break;
    case "spray":
      ps.color1 = new Color4(0.9, 0.97, 1, 0.8);
      ps.color2 = new Color4(0.5, 0.85, 1, 0.6);
      ps.colorDead = new Color4(0.5, 0.85, 1, 0);
      ps.minSize = 0.2;
      ps.maxSize = 0.6;
      ps.minLifeTime = 0.3;
      ps.maxLifeTime = 0.6;
      ps.emitRate = 0;
      ps.minEmitPower = 3;
      ps.maxEmitPower = 7;
      ps.direction1 = new Vector3(-0.6, 1, -0.6);
      ps.direction2 = new Vector3(0.6, 1.6, 0.6);
      ps.gravity = new Vector3(0, -20, 0);
      break;
    case "fuse":
      ps.color1 = new Color4(1, 0.9, 0.5, 1);
      ps.color2 = new Color4(1, 0.4, 0.1, 1);
      ps.colorDead = new Color4(0.3, 0.1, 0, 0);
      ps.minSize = 0.08;
      ps.maxSize = 0.22;
      ps.minLifeTime = 0.1;
      ps.maxLifeTime = 0.3;
      ps.emitRate = 60;
      ps.minEmitPower = 1;
      ps.maxEmitPower = 3;
      ps.direction1 = new Vector3(-1, 1, -1);
      ps.direction2 = new Vector3(1, 2, 1);
      ps.blendMode = ParticleSystem.BLENDMODE_ADD;
      break;
  }
  if (kind === "rocket") ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  return ps;
}
