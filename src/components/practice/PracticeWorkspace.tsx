import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type { PracticeSurface } from '@/stores/useAppStore';

/**
 * The shared Practice stage (doc/UI_OPTIMIZATION_PLAN.md §4, §5.2). Score and
 * Library are two mutually exclusive faces of ONE fixed-size container: the
 * surface switch turns the stage over like a card. The keyboard dock lives
 * *outside* this component, so neither the flip nor the Score viewport's own
 * scrolling ever moves it (D-04).
 *
 * A pure presentation shell — it owns no music state. It only:
 *   - animates a 3D flip when the controlled `surface` prop changes,
 *   - locks out repeat triggers while a flip is in flight (`onFlipStateChange`),
 *   - keeps the inactive face out of the tab order / a11y tree (`inert`),
 *   - moves focus to the newly shown face's heading once the flip settles,
 *   - degrades to an instant swap under `prefers-reduced-motion`, on a narrow
 *     viewport, or when the browser has no usable 3D transforms.
 */

/** Flip length, inside the 350–450 ms band from §5.2. Exposed to CSS as `--flip-ms`. */
const FLIP_MS = 420;

interface PracticeWorkspaceProps {
  /** Which face is operable. Controlled by the caller (store-backed). */
  surface: PracticeSurface;
  /** Score-face content — the staff-notation viewport. */
  score: ReactNode;
  /** Library-face content — the song list. */
  library: ReactNode;
  /** Fired with `true` when a flip starts and `false` when it settles. */
  onFlipStateChange?: (isFlipping: boolean) => void;
}

function mq(query: string): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query)
    : null;
}

function supports3dTransforms(): boolean {
  return (
    typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    CSS.supports('transform-style', 'preserve-3d')
  );
}

function computeInstant(): boolean {
  return (
    mq('(prefers-reduced-motion: reduce)')?.matches === true ||
    mq('(max-width: 640px)')?.matches === true ||
    !supports3dTransforms()
  );
}

export function PracticeWorkspace({
  surface,
  score,
  library,
  onFlipStateChange,
}: PracticeWorkspaceProps) {
  const flipperRef = useRef<HTMLDivElement>(null);
  const scoreFaceRef = useRef<HTMLDivElement>(null);
  const libraryFaceRef = useRef<HTMLDivElement>(null);
  const renderedSurface = useRef<PracticeSurface>(surface);
  const [isFlipping, setIsFlipping] = useState(false);
  const [instant, setInstant] = useState<boolean>(() => computeInstant());
  const instantRef = useRef(instant);
  instantRef.current = instant;

  // Track the conditions that force an instant swap so both the animation path
  // and the CSS (`data-instant`) stay in agreement as the viewport changes.
  useEffect(() => {
    const update = () => setInstant(computeInstant());
    update();
    const lists = [mq('(prefers-reduced-motion: reduce)'), mq('(max-width: 640px)')];
    for (const list of lists) list?.addEventListener?.('change', update);
    return () => {
      for (const list of lists) list?.removeEventListener?.('change', update);
    };
  }, []);

  useEffect(() => {
    onFlipStateChange?.(isFlipping);
  }, [isFlipping, onFlipStateChange]);

  // Animate (or instantly swap) whenever the controlled surface changes.
  useEffect(() => {
    if (renderedSurface.current === surface) return;
    renderedSurface.current = surface;

    setIsFlipping(true);

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      setIsFlipping(false);
      // Focus lands only once both faces have stopped moving, so a screen
      // reader never reads across two lists mid-turn (§5.2, §8).
      const activeFace = surface === 'score' ? scoreFaceRef.current : libraryFaceRef.current;
      // The keyboard dock is a sticky sibling below the stage. Moving focus
      // must not make the browser scroll the page and visually detach that
      // dock from the guidance layer after a surface flip.
      activeFace?.querySelector<HTMLElement>('[data-workspace-heading]')?.focus({ preventScroll: true });
    };

    if (instantRef.current) {
      const raf = requestAnimationFrame(finish);
      return () => cancelAnimationFrame(raf);
    }

    const flipper = flipperRef.current;
    const onEnd = (event: TransitionEvent) => {
      if (event.target === flipper && event.propertyName === 'transform') finish();
    };
    flipper?.addEventListener('transitionend', onEnd);
    // Safety net: a flip interrupted by a hidden tab never fires transitionend.
    const timer = window.setTimeout(finish, FLIP_MS + 90);
    return () => {
      flipper?.removeEventListener('transitionend', onEnd);
      window.clearTimeout(timer);
    };
  }, [surface]);

  // The inactive face is always inert; the incoming face stays inert until the
  // flip settles (§5.2 — "禁用重复触发", "翻页结束后再更新…焦点").
  useEffect(() => {
    const faces: Array<[HTMLDivElement | null, PracticeSurface]> = [
      [scoreFaceRef.current, 'score'],
      [libraryFaceRef.current, 'library'],
    ];
    for (const [el, face] of faces) {
      if (el) el.inert = face !== surface || isFlipping;
    }
  }, [surface, isFlipping]);

  // Only a fully settled face is exposed to assistive tech.
  const exposed: PracticeSurface | null = isFlipping ? null : surface;

  return (
    <div
      className="practice-workspace"
      data-surface={surface}
      data-flipping={isFlipping ? 'true' : undefined}
      data-instant={instant ? 'true' : undefined}
    >
      <div className="practice-workspace__viewport">
        <div
          className="practice-workspace__flipper"
          ref={flipperRef}
          style={{ '--flip-ms': `${FLIP_MS}ms` } as CSSProperties}
        >
          <div
            className="practice-workspace__face practice-workspace__face--score"
            ref={scoreFaceRef}
            aria-hidden={exposed !== 'score' || undefined}
          >
            {score}
          </div>
          <div
            className="practice-workspace__face practice-workspace__face--library"
            ref={libraryFaceRef}
            aria-hidden={exposed !== 'library' || undefined}
          >
            {library}
          </div>
        </div>
      </div>
    </div>
  );
}
