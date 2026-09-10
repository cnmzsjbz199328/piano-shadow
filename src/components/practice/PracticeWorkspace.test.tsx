import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { PracticeWorkspace } from './PracticeWorkspace';

/**
 * `PracticeWorkspace` is a pure presentation shell — it imports only a *type*
 * from the store, so no mock is needed.
 */

function setMatchMedia(matcher: (query: string) => boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: matcher(query),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

function Face({ id, label }: { id: string; label: string }) {
  return (
    <section>
      <h2 data-workspace-heading tabIndex={-1} id={`${id}-heading`}>
        {label}
      </h2>
      <button type="button">{label} action</button>
    </section>
  );
}

const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  // Default: nothing forces an instant swap (but jsdom has no real 3D
  // transforms, so the component still runs its fast path — tests below pin the
  // behaviour they need explicitly).
  setMatchMedia(() => false);
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  vi.restoreAllMocks();
});

describe('PracticeWorkspace — shared flip stage', () => {
  it('renders both faces and keeps the inactive one out of the a11y tree', () => {
    render(
      <PracticeWorkspace
        surface="score"
        score={<Face id="score" label="Score face" />}
        library={<Face id="library" label="Library face" />}
      />,
    );

    const scoreFace = document.querySelector('.practice-workspace__face--score') as HTMLElement;
    const libraryFace = document.querySelector('.practice-workspace__face--library') as HTMLElement;

    expect(scoreFace).not.toHaveAttribute('aria-hidden');
    expect(libraryFace).toHaveAttribute('aria-hidden', 'true');
    expect(libraryFace.inert).toBe(true);
    expect(scoreFace.inert).toBe(false);
  });

  it('flips when the controlled surface changes, reports the transient state, and moves focus', async () => {
    setMatchMedia((q) => q.includes('reduced-motion'));
    const onFlipStateChange = vi.fn();

    const { rerender } = render(
      <PracticeWorkspace
        surface="score"
        onFlipStateChange={onFlipStateChange}
        score={<Face id="score" label="Score face" />}
        library={<Face id="library" label="Library face" />}
      />,
    );
    onFlipStateChange.mockClear();

    rerender(
      <PracticeWorkspace
        surface="library"
        onFlipStateChange={onFlipStateChange}
        score={<Face id="score" label="Score face" />}
        library={<Face id="library" label="Library face" />}
      />,
    );

    // Enters the flipping state immediately…
    expect(onFlipStateChange).toHaveBeenCalledWith(true);

    // …and settles: library exposed, score hidden, focus on the library heading.
    await waitFor(() => expect(onFlipStateChange).toHaveBeenLastCalledWith(false));

    const scoreFace = document.querySelector('.practice-workspace__face--score') as HTMLElement;
    const libraryFace = document.querySelector('.practice-workspace__face--library') as HTMLElement;
    expect(libraryFace).not.toHaveAttribute('aria-hidden');
    expect(scoreFace).toHaveAttribute('aria-hidden', 'true');
    expect(libraryFace.inert).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Library face' }));
  });

  it('marks data-instant under prefers-reduced-motion', () => {
    setMatchMedia((q) => q.includes('reduced-motion'));
    render(
      <PracticeWorkspace
        surface="score"
        score={<Face id="score" label="Score face" />}
        library={<Face id="library" label="Library face" />}
      />,
    );
    expect(document.querySelector('.practice-workspace')).toHaveAttribute('data-instant', 'true');
  });

  it('does not flip or steal focus on first render', () => {
    const onFlipStateChange = vi.fn();
    render(
      <PracticeWorkspace
        surface="library"
        onFlipStateChange={onFlipStateChange}
        score={<Face id="score" label="Score face" />}
        library={<Face id="library" label="Library face" />}
      />,
    );
    expect(onFlipStateChange).not.toHaveBeenCalledWith(true);
    expect(document.activeElement).toBe(document.body);
  });
});
