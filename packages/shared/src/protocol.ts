/**
 * Wire protocol between browser and authoritative game server.
 *
 * Client → server traffic is limited to INPUT (3 bytes) and PONG. Anything
 * else is a protocol violation. The client can never send positions, health,
 * inventory, score, rank or "I finished" — those message types do not exist.
 */

export const PROTOCOL_VERSION = 1;

export const MSG = {
  /** C→S binary: u16 seq, u8 buttons. */
  INPUT: 1,
  /** C→S json: echo of a server PING. */
  PONG: 2,
  /** S→C binary snapshot. */
  SNAPSHOT: 10,
  /** S→C json game events (hits, pickups, laps…). */
  EVENT: 11,
  /** S→C json: { t } server time, client must echo as PONG. */
  PING: 12,
  /** S→C json: slot assignment + match parameters. */
  WELCOME: 13,
  /** S→C json: final verified results. */
  RESULTS: 14,
  /** S→C json: a request was refused (e.g. item use with no target). */
  REJECTED: 15,
} as const;

export type MessageType = (typeof MSG)[keyof typeof MSG];

/** Messages a client is allowed to send. Everything else is rejected. */
export const CLIENT_MESSAGE_TYPES: ReadonlySet<number> = new Set([MSG.INPUT, MSG.PONG]);

export const BTN = {
  ACCELERATE: 1 << 0,
  BRAKE: 1 << 1,
  STEER_LEFT: 1 << 2,
  STEER_RIGHT: 1 << 3,
  DRIFT: 1 << 4,
  USE_ITEM: 1 << 5,
  FIRE: 1 << 6,
} as const;

export const BTN_MASK = 0x7f;
export const INPUT_PACKET_BYTES = 3;

export enum ItemKind {
  None = 0,
  Rocket = 1,
  Mine = 2,
  Shield = 3,
  Turbo = 4,
  Emp = 5,
  Repair = 6,
}

export const ITEM_NAMES: Record<ItemKind, string> = {
  [ItemKind.None]: "None",
  [ItemKind.Rocket]: "Rocket",
  [ItemKind.Mine]: "Mine",
  [ItemKind.Shield]: "Shield",
  [ItemKind.Turbo]: "Turbo",
  [ItemKind.Emp]: "EMP",
  [ItemKind.Repair]: "Repair",
};

export enum ProjectileKind {
  Bolt = 1,
  Rocket = 2,
  Mine = 3,
}

export enum Phase {
  Lobby = 0,
  Countdown = 1,
  Racing = 2,
  Finished = 3,
}

export const CAR_FLAG = {
  SHIELD: 1 << 0,
  TURBO: 1 << 1,
  STUNNED: 1 << 2,
  EMP: 1 << 3,
  WRECKED: 1 << 4,
  FINISHED: 1 << 5,
  DISCONNECTED: 1 << 6,
  WRONG_WAY: 1 << 7,
  DRIFTING: 1 << 8,
  ITEM_LOCKED: 1 << 9,
  FORFEITED: 1 << 10,
  SPAWN_PROTECTED: 1 << 11,
} as const;

export interface InputPacket {
  seq: number;
  buttons: number;
}

export type DecodeResult<T> = { ok: true; value: T } | { ok: false; reason: string };

export function encodeInput(seq: number, buttons: number): Uint8Array {
  const out = new Uint8Array(INPUT_PACKET_BYTES);
  out[0] = seq & 0xff;
  out[1] = (seq >>> 8) & 0xff;
  out[2] = buttons & BTN_MASK;
  return out;
}

/** Strict decoder: wrong size, wrong type or unknown button bits are rejected. */
export function decodeInput(payload: unknown): DecodeResult<InputPacket> {
  const bytes = toBytes(payload);
  if (!bytes) return { ok: false, reason: "not_binary" };
  if (bytes.byteLength !== INPUT_PACKET_BYTES) return { ok: false, reason: "bad_length" };
  const seq = bytes[0]! | (bytes[1]! << 8);
  const buttons = bytes[2]!;
  if ((buttons & ~BTN_MASK) !== 0) return { ok: false, reason: "unknown_buttons" };
  return { ok: true, value: { seq, buttons } };
}

function toBytes(payload: unknown): Uint8Array | null {
  if (payload instanceof Uint8Array) return payload;
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
  if (ArrayBuffer.isView(payload)) return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
  return null;
}

/** Wrap-aware "a is newer than b" for 16-bit sequence numbers. */
export function seqNewer(a: number, b: number): boolean {
  const diff = (a - b) & 0xffff;
  return diff !== 0 && diff < 0x8000;
}

// ---------------------------------------------------------------- snapshots

export interface CarSnapshot {
  slot: number;
  x: number;
  y: number;
  heading: number;
  vx: number;
  vy: number;
  hp: number;
  flags: number;
  item: ItemKind;
  ammo: number;
  lap: number;
  nextGate: number;
  rank: number;
  turboTicks: number;
  stunTicks: number;
  empTicks: number;
  shieldTicks: number;
}

export interface ProjectileSnapshot {
  id: number;
  kind: ProjectileKind;
  owner: number;
  x: number;
  y: number;
  heading: number;
}

export interface Snapshot {
  phase: Phase;
  tick: number;
  /** Ticks since the race started; negative during countdown. */
  raceTick: number;
  /** Last input sequence the server applied for the receiving player. */
  ack: number;
  cars: CarSnapshot[];
  projectiles: ProjectileSnapshot[];
  /** One bit per item box: 1 = available. */
  boxes: boolean[];
}

const HEADER_BYTES = 1 + 1 + 4 + 4 + 2 + 1 + 1 + 1;
const CAR_BYTES = 1 + 4 * 5 + 1 + 2 + 1 + 1 + 1 + 1 + 1 + 4;
const PROJECTILE_BYTES = 2 + 1 + 1 + 4 * 3;

const clampU8 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

export function encodeSnapshot(s: Snapshot): Uint8Array {
  const boxBytes = Math.ceil(s.boxes.length / 8);
  const size = HEADER_BYTES + boxBytes + s.cars.length * CAR_BYTES + s.projectiles.length * PROJECTILE_BYTES;
  const buf = new ArrayBuffer(size);
  const v = new DataView(buf);
  let o = 0;
  v.setUint8(o, PROTOCOL_VERSION); o += 1;
  v.setUint8(o, s.phase); o += 1;
  v.setUint32(o, s.tick, true); o += 4;
  v.setInt32(o, s.raceTick, true); o += 4;
  v.setUint16(o, s.ack & 0xffff, true); o += 2;
  v.setUint8(o, s.cars.length); o += 1;
  v.setUint8(o, s.projectiles.length); o += 1;
  v.setUint8(o, s.boxes.length); o += 1;
  for (let i = 0; i < boxBytes; i++) {
    let byte = 0;
    for (let b = 0; b < 8; b++) if (s.boxes[i * 8 + b]) byte |= 1 << b;
    v.setUint8(o, byte); o += 1;
  }
  for (const c of s.cars) {
    v.setUint8(o, c.slot); o += 1;
    v.setFloat32(o, c.x, true); o += 4;
    v.setFloat32(o, c.y, true); o += 4;
    v.setFloat32(o, c.heading, true); o += 4;
    v.setFloat32(o, c.vx, true); o += 4;
    v.setFloat32(o, c.vy, true); o += 4;
    v.setUint8(o, clampU8(c.hp)); o += 1;
    v.setUint16(o, c.flags, true); o += 2;
    v.setUint8(o, c.item); o += 1;
    v.setUint8(o, clampU8(c.ammo)); o += 1;
    v.setUint8(o, clampU8(c.lap)); o += 1;
    v.setUint8(o, clampU8(c.nextGate)); o += 1;
    v.setUint8(o, clampU8(c.rank)); o += 1;
    v.setUint8(o, clampU8(c.turboTicks)); o += 1;
    v.setUint8(o, clampU8(c.stunTicks)); o += 1;
    v.setUint8(o, clampU8(c.empTicks)); o += 1;
    v.setUint8(o, clampU8(c.shieldTicks)); o += 1;
  }
  for (const p of s.projectiles) {
    v.setUint16(o, p.id & 0xffff, true); o += 2;
    v.setUint8(o, p.kind); o += 1;
    v.setUint8(o, p.owner); o += 1;
    v.setFloat32(o, p.x, true); o += 4;
    v.setFloat32(o, p.y, true); o += 4;
    v.setFloat32(o, p.heading, true); o += 4;
  }
  return new Uint8Array(buf);
}

export function decodeSnapshot(payload: unknown): DecodeResult<Snapshot> {
  const bytes = toBytes(payload);
  if (!bytes || bytes.byteLength < HEADER_BYTES) return { ok: false, reason: "short" };
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 0;
  const version = v.getUint8(o); o += 1;
  if (version !== PROTOCOL_VERSION) return { ok: false, reason: "version" };
  const phase = v.getUint8(o) as Phase; o += 1;
  const tick = v.getUint32(o, true); o += 4;
  const raceTick = v.getInt32(o, true); o += 4;
  const ack = v.getUint16(o, true); o += 2;
  const carCount = v.getUint8(o); o += 1;
  const projectileCount = v.getUint8(o); o += 1;
  const boxCount = v.getUint8(o); o += 1;
  const boxBytes = Math.ceil(boxCount / 8);
  const expected = HEADER_BYTES + boxBytes + carCount * CAR_BYTES + projectileCount * PROJECTILE_BYTES;
  if (bytes.byteLength !== expected) return { ok: false, reason: "length" };
  const boxes: boolean[] = [];
  for (let i = 0; i < boxBytes; i++) {
    const byte = v.getUint8(o); o += 1;
    for (let b = 0; b < 8 && boxes.length < boxCount; b++) boxes.push((byte & (1 << b)) !== 0);
  }
  const cars: CarSnapshot[] = [];
  for (let i = 0; i < carCount; i++) {
    const slot = v.getUint8(o); o += 1;
    const x = v.getFloat32(o, true); o += 4;
    const y = v.getFloat32(o, true); o += 4;
    const heading = v.getFloat32(o, true); o += 4;
    const vx = v.getFloat32(o, true); o += 4;
    const vy = v.getFloat32(o, true); o += 4;
    const hp = v.getUint8(o); o += 1;
    const flags = v.getUint16(o, true); o += 2;
    const item = v.getUint8(o) as ItemKind; o += 1;
    const ammo = v.getUint8(o); o += 1;
    const lap = v.getUint8(o); o += 1;
    const nextGate = v.getUint8(o); o += 1;
    const rank = v.getUint8(o); o += 1;
    const turboTicks = v.getUint8(o); o += 1;
    const stunTicks = v.getUint8(o); o += 1;
    const empTicks = v.getUint8(o); o += 1;
    const shieldTicks = v.getUint8(o); o += 1;
    cars.push({ slot, x, y, heading, vx, vy, hp, flags, item, ammo, lap, nextGate, rank, turboTicks, stunTicks, empTicks, shieldTicks });
  }
  const projectiles: ProjectileSnapshot[] = [];
  for (let i = 0; i < projectileCount; i++) {
    const id = v.getUint16(o, true); o += 2;
    const kind = v.getUint8(o) as ProjectileKind; o += 1;
    const owner = v.getUint8(o); o += 1;
    const x = v.getFloat32(o, true); o += 4;
    const y = v.getFloat32(o, true); o += 4;
    const heading = v.getFloat32(o, true); o += 4;
    projectiles.push({ id, kind, owner, x, y, heading });
  }
  return { ok: true, value: { phase, tick, raceTick, ack, cars, projectiles, boxes } };
}

/** Byte offset of the u16 ack field inside an encoded snapshot. */
export const SNAPSHOT_ACK_OFFSET = 10;

/**
 * Copies an encoded snapshot with a per-recipient ack. Lets the server encode
 * a tick once and only patch two bytes per client.
 */
export function withSnapshotAck(encoded: Uint8Array, ack: number): Uint8Array {
  const copy = new Uint8Array(encoded);
  copy[SNAPSHOT_ACK_OFFSET] = ack & 0xff;
  copy[SNAPSHOT_ACK_OFFSET + 1] = (ack >>> 8) & 0xff;
  return copy;
}
