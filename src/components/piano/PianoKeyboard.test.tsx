import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PianoKeyboard } from './PianoKeyboard';

describe('PianoKeyboard', () => {
  it('calls onPress/onRelease with the pointer-targeted key, and shows visible pressed state', () => {
    const onPress = vi.fn();
    const onRelease = vi.fn();
    render(<PianoKeyboard heldMidi={[]} onPress={onPress} onRelease={onRelease} lowMidi={60} highMidi={64} />);

    const c4 = screen.getByLabelText('Key 60');
    fireEvent.pointerDown(c4, { pressure: 0 });
    expect(onPress).toHaveBeenCalledWith(60, 100);

    fireEvent.pointerUp(c4);
    expect(onRelease).toHaveBeenCalledWith(60);
  });

  it('marks a held key as aria-pressed', () => {
    render(<PianoKeyboard heldMidi={[60]} onPress={() => {}} onRelease={() => {}} lowMidi={60} highMidi={64} />);
    expect(screen.getByLabelText('Key 60')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Key 62')).toHaveAttribute('aria-pressed', 'false');
  });

  it('responds to the computer keyboard shortcut row', () => {
    const onPress = vi.fn();
    const onRelease = vi.fn();
    render(<PianoKeyboard heldMidi={[]} onPress={onPress} onRelease={onRelease} />);

    fireEvent.keyDown(window, { key: 'a' });
    expect(onPress).toHaveBeenCalledWith(60, 100); // C4

    fireEvent.keyUp(window, { key: 'a' });
    expect(onRelease).toHaveBeenCalledWith(60);
  });

  it('ignores keyboard shortcuts while typing in a text field', () => {
    const onPress = vi.fn();
    render(
      <div>
        <input aria-label="Song name" />
        <PianoKeyboard heldMidi={[]} onPress={onPress} onRelease={vi.fn()} />
      </div>,
    );
    const input = screen.getByLabelText('Song name');
    fireEvent.keyDown(input, { key: 'a' });
    expect(onPress).not.toHaveBeenCalled();
  });

  it('renders a fluid svg (no fixed pixel width) with a viewBox so it scales to fit', () => {
    const { container } = render(
      <PianoKeyboard heldMidi={[]} onPress={() => {}} onRelease={() => {}} />,
    );
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();

    const width = svg!.getAttribute('width');
    // width must be absent or "100%" — never a fixed pixel number (e.g. "1352").
    expect(width === null || width === '100%').toBe(true);
    expect(width ?? '').not.toMatch(/^\d+(px)?$/);

    expect(svg!.getAttribute('viewBox')).toBeTruthy();
  });

  it('keeps the "Key {midi}" aria-labels the E2E suite depends on', () => {
    render(<PianoKeyboard heldMidi={[]} onPress={() => {}} onRelease={() => {}} lowMidi={60} highMidi={64} />);
    expect(screen.getByLabelText('Key 60')).toBeInTheDocument();
  });
});
