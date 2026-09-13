import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { HeaderSettings } from './HeaderSettings';
import { useAppStore } from '@/stores/useAppStore';

const originalMatchMedia = window.matchMedia;

function setMatchMedia(phone = false): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes('1099px') || (phone && query.includes('699px')),
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

function renderHeader(withDefaultContent = false): void {
  render(
    <MemoryRouter initialEntries={['/']}>
      <HeaderSettings defaultContent={withDefaultContent ? <span>Default practice controls</span> : undefined} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  setMatchMedia();
  useAppStore.setState({
    song: null,
    mode: 'listen',
    practiceVoice: 'both',
    isAttemptRunning: false,
    recognitionState: 'idle',
    showDebugPanel: false,
  });
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('HeaderSettings', () => {
  it('opens one shared category at a time and restores focus on Escape', async () => {
    const user = userEvent.setup();
    renderHeader();

    const mode = screen.getByRole('button', { name: 'Mode' });
    const hands = screen.getByRole('button', { name: 'Hands' });
    await user.click(mode);
    expect(screen.getByRole('region', { name: 'Mode settings' })).toBeVisible();
    expect(mode).toHaveAttribute('aria-expanded', 'true');

    await user.click(hands);
    expect(screen.getByRole('region', { name: 'Hands settings' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Mode settings' })).toBeNull();
    expect(mode).toHaveAttribute('aria-expanded', 'false');

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Hands settings' })).toBeNull());
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Advanced' })).toBeNull();
    expect(hands).toHaveFocus();
  });

  it('keeps song-dependent controls disabled while More and Input remain reachable', async () => {
    const user = userEvent.setup();
    renderHeader();

    await user.click(screen.getByRole('button', { name: 'Mode' }));
    expect(screen.getByRole('button', { name: /Play along:/i })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('button', { name: 'Advanced' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Input' }));
    expect(screen.getByText(/Web MIDI unavailable|unsupported/i)).toBeVisible();
  });

  it('provides visible Tempo pages on a phone-width header', async () => {
    setMatchMedia(true);
    const user = userEvent.setup();
    renderHeader();

    await user.click(screen.getByRole('button', { name: 'Tempo' }));
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();
    expect(screen.getByText('1/3')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByRole('button', { name: /Count-in On/i })).toBeDisabled();
    expect(screen.getByText('2/3')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByRole('button', { name: /Metronome Off/i })).toBeDisabled();
    expect(screen.getByText('3/3')).toBeVisible();
  });

  it('switches back to the default controls after ten seconds of unprotected idle time', () => {
    vi.useFakeTimers();
    renderHeader(true);

    fireEvent.click(screen.getByRole('button', { name: 'Mode' }));
    expect(screen.getByRole('region', { name: 'Mode settings' })).toBeVisible();
    act(() => { vi.advanceTimersByTime(9_999); });
    expect(screen.getByRole('region', { name: 'Mode settings' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Mode' }));
    expect(screen.getByText('Default practice controls')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(screen.getByText('Default practice controls')).toBeVisible();
    expect(screen.queryByRole('region', { name: 'More settings' })).toBeNull();
  });

  it('pauses the idle timeout while keyboard focus remains in the settings panel', () => {
    vi.useFakeTimers();
    renderHeader(true);

    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    act(() => { screen.getByRole('button', { name: 'Advanced' }).focus(); });
    expect(screen.getByRole('button', { name: 'Advanced' })).toHaveFocus();
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(screen.getByRole('region', { name: 'More settings' })).toBeVisible();
  });
});
