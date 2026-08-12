/**
 * Shared motion vocabulary.
 *
 * The app had animation scattered ad hoc: springs on cards, 8-second infinite
 * float loops, per-index stagger that made a 12-item list finish 600 ms after
 * it started. Movement was decorating instead of explaining, and the result
 * read as slow — because it *was* slow, on purpose.
 *
 * The rule now: animate a change of state, nothing else. Short, consistent,
 * and out of the way.
 */

/** Milliseconds. Anything longer than `slow` needs a reason. */
export const DURATION = {
  /** Hover, press, colour change — should feel instant. */
  fast: 0.12,
  /** The default: something appeared, moved or left. */
  base: 0.18,
  /** Modals and panels, where a bit of travel helps locate the thing. */
  slow: 0.24,
} as const;

/** Decelerating curve: quick to start, settles softly. */
export const EASE = [0.16, 1, 0.3, 1] as const;

/** Fade + a short rise. The default entrance. */
export const enter = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: DURATION.base, ease: EASE },
};

/** Plain fade, for things that should not move. */
export const fade = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: DURATION.base, ease: EASE },
};

/** Modal panel: enters with a hint of scale so it reads as "on top". */
export const modalPanel = {
  initial: { opacity: 0, scale: 0.98, y: 8 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.98, y: 8 },
  transition: { duration: DURATION.slow, ease: EASE },
};

/**
 * Does this person want motion at all?
 *
 * Respecting `prefers-reduced-motion` is not a nicety — for people with
 * vestibular disorders, movement causes nausea. It was being ignored entirely.
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}
