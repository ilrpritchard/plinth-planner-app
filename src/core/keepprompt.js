// keepprompt.js — PURE. When to offer "Keep this layout?" to someone who has not
// signed in. Once per session, at whichever comes first:
//   (a) 5 ACTIVE minutes with a real kitchen in the room (6+ cabinets, HOWEVER they
//       got there: a drafted layout drops in a dozen at once and counts at once), or
//   (b) a moment that shows they care (Start editing on a drafted layout, an idea
//       kept in the compare tray, a second re-roll) followed by 2 more active minutes.
// "Active" means interacting: gaps longer than 30s between interactions do not
// count, so a tab left open in the background never earns a prompt. Never in
// Project mode, never mid unit-design, never for a signed-in visitor, never over a
// wizard / dialog. It replaces a toast that fired every 5 minutes on the clock.

export const KEEP_RULES = { activeMs: 5 * 60e3, afterCareMs: 2 * 60e3, minCabinets: 6, idleGapMs: 30e3, rerolls: 2 };

export function createKeepTracker(now = () => Date.now()) {
  let active = 0, last = null, caredAt = null, rerolls = 0, done = false;
  return {
    /** call on any interaction (pointer, key, wheel) */
    activity() {
      const t = now();
      if (last != null) { const gap = t - last; if (gap > 0 && gap <= KEEP_RULES.idleGapMs) active += gap; }
      last = t;
    },
    /** 'start-editing' | 'kept-idea' | 'reroll' */
    signal(kind) {
      this.activity();
      if (kind === 'reroll' && ++rerolls < KEEP_RULES.rerolls) return;
      if (caredAt == null) caredAt = active;
    },
    /** ctx: { cabinets, mode, designing, signedIn, busy } */
    shouldShow(ctx) {
      if (done || !ctx) return false;
      if (ctx.mode === 'trade' || ctx.designing || ctx.signedIn || ctx.busy) return false;
      if ((ctx.cabinets || 0) < KEEP_RULES.minCabinets) return false;
      if (active >= KEEP_RULES.activeMs) return true;
      return caredAt != null && active - caredAt >= KEEP_RULES.afterCareMs;
    },
    /** shown or dismissed: that is it for this session */
    finish() { done = true; },
    get activeMs() { return active; },
    get finished() { return done; },
  };
}
