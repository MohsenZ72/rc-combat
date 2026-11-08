/**
 * Screen stack: title → lobby → race HUD → results. Only the top screen is
 * visible and receives focus; "back" is a pop. Avoids boolean flag soup.
 */
export interface Screen {
  readonly el: HTMLElement;
  /** Element to focus when the screen becomes active (keyboard/gamepad users). */
  focusTarget?(): HTMLElement | null;
  onShow?(): void;
  onHide?(): void;
}

export class ScreenStack {
  private readonly stack: Screen[] = [];

  constructor(private readonly root: HTMLElement) {}

  get top(): Screen | undefined {
    return this.stack.at(-1);
  }

  push(screen: Screen): void {
    this.top?.onHide?.();
    if (this.top) this.top.el.hidden = true;
    this.stack.push(screen);
    if (!screen.el.isConnected) this.root.append(screen.el);
    this.activate(screen);
  }

  pop(): void {
    const s = this.stack.pop();
    if (s) {
      s.onHide?.();
      s.el.remove();
    }
    if (this.top) this.activate(this.top);
  }

  /** Replaces the whole stack with one screen. */
  reset(screen: Screen): void {
    while (this.stack.length) this.pop();
    this.push(screen);
  }

  private activate(screen: Screen): void {
    screen.el.hidden = false;
    screen.onShow?.();
    queueMicrotask(() => screen.focusTarget?.()?.focus());
  }
}
