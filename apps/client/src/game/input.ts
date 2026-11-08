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
  ShiftLeft: BTN.DRIFT,
  ShiftRight: BTN.DRIFT,
  KeyE: BTN.USE_ITEM,
  Enter: BTN.USE_ITEM,
  Space: BTN.FIRE,
};

/**
 * Turns keyboard + gamepad state into the 7-bit button mask the server
 * accepts. This is the only thing the client ever tells the server about
 * driving.
 */
export class InputController {
  private keys = 0;
  private enabled = false;
  private readonly onDown = (e: KeyboardEvent) => this.key(e, true);
  private readonly onUp = (e: KeyboardEvent) => this.key(e, false);
  private readonly onBlur = () => {
    this.keys = 0;
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

  private key(e: KeyboardEvent, down: boolean): void {
    const bit = KEYS[e.code];
    if (bit === undefined) return;
    if (e.target instanceof HTMLInputElement) return;
    e.preventDefault();
    this.keys = down ? this.keys | bit : this.keys & ~bit;
  }

  /** Standard mapping: RT/A accelerate, LT/B brake, stick steer, RB drift, X item, Y/LB fire. */
  private gamepad(): number {
    const pads = typeof navigator.getGamepads === "function" ? navigator.getGamepads() : [];
    let mask = 0;
    for (const pad of pads) {
      if (!pad || pad.mapping !== "standard") continue;
      const b = (i: number) => pad.buttons[i]?.pressed ?? false;
      const axis = pad.axes[0] ?? 0;
      if (b(7) || b(0)) mask |= BTN.ACCELERATE;
      if (b(6) || b(1)) mask |= BTN.BRAKE;
      if (axis < -0.3 || b(14)) mask |= BTN.STEER_LEFT;
      if (axis > 0.3 || b(15)) mask |= BTN.STEER_RIGHT;
      if (b(5)) mask |= BTN.DRIFT;
      if (b(2)) mask |= BTN.USE_ITEM;
      if (b(3) || b(4)) mask |= BTN.FIRE;
    }
    return mask;
  }
}
