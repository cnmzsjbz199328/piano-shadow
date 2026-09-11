import { test, expect } from '@playwright/test';
function midiFixture(): Buffer {
  // Format 0, 96 ticks/beat: C4, D4, E4.
  return Buffer.from([
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96,
    0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 31,
    0, 0xc0, 0,
    0, 0x90, 60, 100, 0x60, 0x80, 60, 64,
    0, 0x90, 62, 100, 0x60, 0x80, 62, 64,
    0, 0x90, 64, 100, 0x60, 0x80, 64, 64,
    0, 0xff, 0x2f, 0,
  ]);
}

test.describe('Piano Shadow — focused practice workspace', () => {
  test('opens with the 88-key feedback surface and an empty library', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByLabel('Key 60')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'My MIDI songs' })).toBeVisible();
    await expect(page.getByText(/will appear here/i)).toBeVisible();
    await expect(page.getByText('Single-page recognition')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Listen to my playing' })).toHaveCount(0);
    await expect(page.getByText('Ready to listen')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /piano shadow/i })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Results' })).toHaveCount(0);
  });

  test('imports one MIDI into the shared library and practices it on the same page', async ({ page }) => {
    await page.goto('/');
    await page.locator('input[type=file]').setInputFiles({ name: 'Single page test.mid', mimeType: 'audio/midi', buffer: midiFixture() });
    await expect(page.getByRole('heading', { name: 'Single page test' })).toBeVisible();

    await page.getByRole('button', { name: 'Practice', exact: true }).click();
    await expect(page.getByRole('button', { name: /start practice/i })).toBeVisible();
    await page.getByRole('button', { name: /start practice/i }).click();
    await page.getByRole('button', { name: /play$/i }).click();
    await expect(page.getByText('Recording')).toBeVisible();
    for (const key of ['a', 's', 'd']) {
      await page.keyboard.down(key);
      await page.waitForTimeout(80);
      await page.keyboard.up(key);
      await page.waitForTimeout(120);
    }
    await page.getByRole('button', { name: /finish practice/i }).click();
    // Import / practice never leave the single page — the URL stays put ("/").
    await expect(page).toHaveURL(/\/(practice)?$/);
    await expect(page.getByRole('heading', { name: /^Score \d+$/ })).toBeVisible();
    await expect(page.locator('.count-row')).toBeVisible();
  });

  test('the Score/Library flip keeps one operable surface and never moves the keyboard dock', async ({ page }) => {
    await page.goto('/');
    await page.locator('input[type=file]').setInputFiles({ name: 'Flip stage.mid', mimeType: 'audio/midi', buffer: midiFixture() });
    await expect(page.getByRole('heading', { name: 'Flip stage' })).toBeVisible();

    // After import the library face is in view with the new song listed.
    await expect(page.getByRole('heading', { name: 'My MIDI songs' })).toBeVisible();
    const roundBox = (b: { x: number; y: number; width: number; height: number } | null) =>
      b && { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
    const dockBefore = roundBox(await page.locator('.keyboard-dock').boundingBox());

    // Choose the song -> the stage flips to the score face.
    await page.getByRole('button', { name: 'Practice', exact: true }).click();
    await expect(page.getByRole('region', { name: /sheet music/i })).toBeVisible();
    // The library list is now behind an inert face — not operable.
    await expect(page.getByRole('button', { name: 'Practice', exact: true })).toHaveCount(0);

    // Flip back with the header switch; the library face returns.
    await page.getByRole('button', { name: 'Open the song library' }).click();
    await expect(page.getByRole('heading', { name: 'My MIDI songs' })).toBeVisible();
    await expect(page.getByRole('region', { name: /sheet music/i })).toHaveCount(0);

    // And "Back to score" on the library face flips forward again.
    await page.getByRole('button', { name: 'Back to the score' }).click();
    await expect(page.getByRole('region', { name: /sheet music/i })).toBeVisible();

    // The keyboard dock never shifted while the stage turned (D-04).
    const dockAfter = roundBox(await page.locator('.keyboard-dock').boundingBox());
    expect(dockAfter).toEqual(dockBefore);
  });

  test('keeps microphone recognition out of the practice page', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/single-note .* recognition via Pitchy/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /listen/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /piano shadow/i })).toBeVisible();
  });

  // --- Restored route-based regressions, adapted to the single page (plan Track G1) ---

  test('an attempt auto-finishes when the reference reaches its end, with no "Finish practice" click', async ({ page }) => {
    await page.goto('/');
    await page.locator('input[type=file]').setInputFiles({ name: 'Auto finish.mid', mimeType: 'audio/midi', buffer: midiFixture() });
    await expect(page.getByRole('heading', { name: 'Auto finish' })).toBeVisible();

    await page.getByRole('button', { name: 'Practice', exact: true }).click();
    await page.getByRole('button', { name: /start practice/i }).click();
    await page.getByRole('button', { name: /play$/i }).click();
    await expect(page.getByText('Recording')).toBeVisible();

    // The fixture is C4/D4/E4, one beat each at 120 bpm (~1.5s of reference) after
    // a 4-beat count-in. Let it run to the end and never press "Finish practice":
    // the attempt must finish itself and surface the inline Score card.
    await expect(page.getByRole('heading', { name: /^Score \d+$/ })).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.count-row')).toBeVisible();
    await expect(page.getByRole('button', { name: /finish practice/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /start practice/i })).toBeVisible();
  });

  test('Stop rewinds the transport playhead to 0:00', async ({ page }) => {
    await page.goto('/');
    await page.locator('input[type=file]').setInputFiles({ name: 'Playhead reset.mid', mimeType: 'audio/midi', buffer: midiFixture() });
    await expect(page.getByRole('heading', { name: 'Playhead reset' })).toBeVisible();

    const timeLabel = page.locator('.transport__time');
    await expect(timeLabel).toHaveText(/^0:00 \//);

    // Move the playhead into the song with the seek slider, then Stop: the shared
    // clock (transport time display + playhead) must snap back to 0:00.
    const seek = page.getByLabel('Seek');
    for (let i = 0; i < 15; i += 1) {
      await seek.press('PageUp');
      if (/^0:0[1-9]/.test(((await timeLabel.textContent()) ?? '').trim())) break;
    }
    await expect(timeLabel).toHaveText(/^0:01 \//);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(timeLabel).toHaveText(/^0:00 \//);

    // And after real playback: Stop from a running transport returns it to the
    // idle Play state with the playhead reset.
    await page.getByRole('button', { name: /play$/i }).click();
    await expect(page.getByRole('button', { name: /pause$/i })).toBeVisible();
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(page.getByRole('button', { name: /play$/i })).toBeVisible();
    await expect(timeLabel).toHaveText(/^0:00 \//);
  });

  test('the on-screen keyboard reflects pressed state with no MIDI device connected', async ({ page }) => {
    await page.goto('/');
    // The test browser has no MIDI device; the app must be fully usable anyway (spec §25).
    await expect(page.getByRole('heading', { name: 'My MIDI songs' })).toBeVisible();

    const middleC = page.getByLabel('Key 60');
    await expect(middleC).toBeVisible();
    await expect(middleC).toHaveAttribute('aria-pressed', 'false');

    // aria-pressed is held only while the pointer is down (onPointerUp releases it),
    // so assert between a dispatched pointerdown and pointerup rather than on click.
    await middleC.dispatchEvent('pointerdown');
    await expect(middleC).toHaveAttribute('aria-pressed', 'true');
    await middleC.dispatchEvent('pointerup');
    await expect(middleC).toHaveAttribute('aria-pressed', 'false');
  });

  // --- Falling-notes guidance layer (plan Track D) ---

  test('the falling-notes guidance layer appears on Play and clears when practice ends', async ({ page }) => {
    await page.goto('/');
    await page.locator('input[type=file]').setInputFiles({ name: 'Falling notes.mid', mimeType: 'audio/midi', buffer: midiFixture() });
    await expect(page.getByRole('heading', { name: 'Falling notes' })).toBeVisible();

    // The score face previews the first target before a session is running;
    // the library face keeps the guidance surface out of view.
    await expect(page.locator('.falling-notes')).toHaveCount(0);

    await page.getByRole('button', { name: 'Practice', exact: true }).click();
    await page.getByText('Practice settings', { exact: false }).click();
    await expect(page.getByRole('button', { name: 'Guidance', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Off', exact: true }).click();
    await expect(page.locator('.falling-notes')).toHaveCount(0);
    await page.getByRole('button', { name: 'Guidance', exact: true }).click();
    await expect(page.locator('.falling-notes')).toBeVisible();
    await page.getByRole('button', { name: /start practice/i }).click();
    await page.getByRole('button', { name: /play$/i }).click();

    // The guidance canvas is mounted directly above the keyboard dock while the transport runs.
    await expect(page.locator('.falling-notes__canvas')).toBeVisible();

    // The fixture auto-finishes at the reference end; the layer returns to its
    // frozen preview rather than retaining an old success/target state.
    await expect(page.getByRole('heading', { name: /^Score \d+$/ })).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.falling-notes')).toBeVisible();
    await expect(page.getByText(/Current target|Next/)).toBeVisible();
  });
});
