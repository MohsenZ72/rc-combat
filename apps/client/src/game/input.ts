import { BTN } from "@rc/shared";

/** Default key bindings. Codes are layout-independent (physical keys). */
const KEYS: Record<string, number> = {
  KeyW: BTN.ACCELERATE,
  ArrowUp: BTN.ACCELERATE,
  KeyS: BTN.BRAKE,
  ArrowDown: BTN.BRAKE,
  KeyA: BTN.STEER_LEFT,
  ArrowLeft: BTN.STEER_LEFT,
  KeyD: BTN.STEER_RIGHT,
  ArrowRight: BTN.STEER_RIGHT,
  Space: BTN.HANDBRAKE,
  ShiftLeft: BTN.HANDBRAKE,
  ShiftRight: BTN.HANDBRAKE,
  KeyE: BTN.USE_ITEM,
  Enter: BTN.USE_ITEM,
  KeyF: BTN.FIRE,
  KeyJ: BTN.FIRE,
  KeyQ: BTN.JUMP,
};

/** Keys that only change the local view; never sent to the server. */
const LOOK_BACK_KEYS = new Set(["KeyC"]);

/**
 * Turns keyboard + gamepad state into the 8-bit button mask the server
 * accepts. This is the only thing the client ever tells the server about
 * driving.
 */
export class InputController {
  private keys = 0;
  private lookBackKey = false;
  private enabled = false;
  private readonly onDown = (e: KeyboardEvent) => this.key(e, true);
  private readonly onUp = (e: KeyboardEvent) => this.key(e, false);
  private readonly onBlur = () => {
    this.keys = 0;
    this.lookBackKey = false;
  };

  attach(): void {
    window.addEventListener("keydown", this.onDown);
    window.addEventListener("keyup", this.onUp);
    window.addEventListener("blur", this.onBlur);
    this.enabled = true;
  }

  detach(): void {
    window.removeEventListener("keydown", this.onDown);
    window.removeEventListener("keyup", this.onUp);
    window.removeEventListener("blur", this.onBlur);
    this.enabled = false;
    this.keys = 0;
  }

  sample(): number {
    if (!this.enabled) return 0;
    return this.keys | this.gamepad();
  }

  /** True while the look-back key (C) or right-stick click is held. */
  lookingBack(): boolean {
    if (!this.enabled) return false;
    const pads = typeof navigator.getGamepads === "function" ? navigator.getGamepads() : [];
    for (const pad of pads) if (pad?.mapping === "standard" && pad.buttons[11]?.pressed) return true;
    return this.lookBackKey;
  }

  private key(e: KeyboardEvent, down: boolean): void {
    if (LOOK_BACK_KEYS.has(e.code) && !(e.target instanceof HTMLInputElement)) {
      this.lookBackKey = down;
      return;
    }
    const bit = KEYS[e.code];
    if (bit === undefined) return;
    if (e.target instanceof HTMLInputElement) return;
    e.preventDefault();
    this.keys = down ? this.keys | bit : this.keys & ~bit;
  }

  /** Standard mapping: RT accelerate, LT/B brake, stick steer, A jump, RB handbrake, X item, Y/LB fire, R3 look back. */
  private gamepad(): number {
    const pads = typeof navigator.getGamepads === "function" ? navigator.getGamepads() : [];
    let mask = 0;
    for (const pad of pads) {
      if (!pad || pad.mapping !== "standard") continue;
      const b = (i: number) => pad.buttons[i]?.pressed ?? false;
      const axis = pad.axes[0] ?? 0;
      if (b(7)) mask |= BTN.ACCELERATE;
      if (b(0)) mask |= BTN.JUMP;
      if (b(6) || b(1)) mask |= BTN.BRAKE;
      if (axis < -0.3 || b(14)) mask |= BTN.STEER_LEFT;
      if (axis > 0.3 || b(15)) mask |= BTN.STEER_RIGHT;
      if (b(5)) mask |= BTN.HANDBRAKE;
      if (b(2)) mask |= BTN.USE_ITEM;
      if (b(3) || b(4)) mask |= BTN.FIRE;
    }
    return mask;
  }
}
