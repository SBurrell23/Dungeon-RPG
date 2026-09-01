
/**
 * Keyboard + mouse capture. Produces a compact per-frame "intent" object that
 * is both fed to the local simulation and shipped over the network, so the
 * host and the client agree on exactly what a player asked for.
 */
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressedThisFrame = new Set();
    this.mouse = { x: 0, y: 0, down: false, rightDown: false, wheel: 0 };
    this.enabled = true;
    this.bindings = {
      up: ['KeyW', 'ArrowUp'],
      down: ['KeyS', 'ArrowDown'],
      left: ['KeyA', 'ArrowLeft'],
      right: ['KeyD', 'ArrowRight'],
      dash: ['ShiftLeft', 'ShiftRight'],
      interact: ['KeyE'],
      slot1: ['Digit1'], slot2: ['Digit2'], slot3: ['Digit3'], slot4: ['Digit4'],
      potionHp: ['KeyQ'], potionMp: ['KeyR'],
      inventory: ['KeyI', 'Tab'],
      character: ['KeyC'],
      map: ['KeyM'],
      spectateNext: ['Space'],
    };
    this._install();
  }

  _install() {
    window.addEventListener('keydown', (e) => {
      // Let the browser have the keyboard while the user is typing.
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.code === 'Tab') e.preventDefault();
      if (!this.keys.has(e.code)) this.pressedThisFrame.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.down = false; });

    const c = this.canvas;
    c.addEventListener('mousemove', (e) => {
      const r = c.getBoundingClientRect();
      this.mouse.x = (e.clientX - r.left) * (c.width / r.width);
      this.mouse.y = (e.clientY - r.top) * (c.height / r.height);
    });
    c.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouse.down = true;
      if (e.button === 2) this.mouse.rightDown = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.down = false;
      if (e.button === 2) this.mouse.rightDown = false;
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
  }

  isDown(action) {
    if (!this.enabled) return false;
    return this.bindings[action].some((k) => this.keys.has(k));
  }

  /** True only on the frame the key went down. */
  pressed(action) {
    if (!this.enabled) return false;
    return this.bindings[action].some((k) => this.pressedThisFrame.has(k));
  }

  /**
   * @param {{x:number,y:number}} aimWorld  cursor position in world space
   * @param {{x:number,y:number}} originWorld player position in world space
   */
  sample(aimWorld, originWorld) {
    let mx = 0, my = 0;
    if (this.isDown('left')) mx -= 1;
    if (this.isDown('right')) mx += 1;
    if (this.isDown('up')) my -= 1;
    if (this.isDown('down')) my += 1;
    const len = Math.hypot(mx, my);
    if (len > 0) { mx /= len; my /= len; }
    return {
      mx, my,
      aim: Math.atan2(aimWorld.y - originWorld.y, aimWorld.x - originWorld.x),
      attack: this.enabled && this.mouse.down,
      dash: this.isDown('dash'),
      // Edge-triggered actions are queued rather than sampled so a fast click
      // between network ticks is never dropped.
      slots: [this.pressed('slot1'), this.pressed('slot2'), this.pressed('slot3'), this.pressed('slot4')],
      useHp: this.pressed('potionHp'),
      useMp: this.pressed('potionMp'),
      interact: this.pressed('interact'),
    };
  }

  endFrame() {
    this.pressedThisFrame.clear();
    this.mouse.wheel = 0;
  }
}

/**
 * Client-side accumulator: fold this frame's sample into what we will ship next.
 *
 * The client samples at 60 Hz and sends at 30, so one-shot flags are OR-ed to
 * make sure a quick tap between sends is not swallowed. Held inputs - including
 * the aim point, which used to be dropped here and left remote players' aimed
 * abilities firing at a stale target - take the latest value.
 */
export function mergeIntents(acc, next) {
  if (!acc) return next;
  return {
    mx: next.mx, my: next.my, aim: next.aim, aimX: next.aimX, aimY: next.aimY,
    attack: acc.attack || next.attack,
    dash: acc.dash || next.dash,
    slots: acc.slots.map((v, i) => v || next.slots[i]),
    useHp: acc.useHp || next.useHp,
    useMp: acc.useMp || next.useMp,
    interact: acc.interact || next.interact,
  };
}

export const EMPTY_INTENT = {
  mx: 0, my: 0, aim: 0, aimX: 0, aimY: 0, attack: false, dash: false,
  slots: [false, false, false, false], useHp: false, useMp: false, interact: false,
};
