import { test, expect } from '@playwright/test';

/**
 * End-to-end practice flow (spec §21.3):
 *   1. Open app
 *   2. Load sample MIDI
 *   3. Start practice
 *   4. Simulate note input
 *   5. Finish attempt
 *   6. Confirm results screen
 *   7. Confirm score and error breakdown appear
 *
 * Runs against a real Chromium instance with real Web Audio (Tone.js) and real
 * keyboard events — no test-only hooks in the app itself.
 */

test.describe('Piano Shadow — practice flow', () => {
  test('load demo, play along, finish attempt, see score breakdown', async ({ page }) => {
    // 1. Open app
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /turn a performance into a practice template/i })).toBeVisible();

    // 2. Load sample MIDI (built-in demo)
    await page.getByRole('button', { name: /C Major Five-Finger/i }).click();
    await expect(page).toHaveURL(/\/practice$/);
    await expect(page.getByRole('heading', { name: 'C Major Five-Finger (C D E F G)' })).toBeVisible();

    // 3. Start practice: Play Along, no count-in so note timing is predictable
    await page.getByRole('tab', { name: 'Play Along' }).click();
    await page.getByLabel('Count-in').uncheck();
    await page.getByRole('button', { name: /start attempt/i }).click();
    await page.getByRole('button', { name: /^.?\s*play$/i }).click();
    await expect(page.getByText('Recording')).toBeVisible();

    // 4. Simulate note input: echo the reference melody C D E F G on the keyboard shortcuts
    for (const key of ['a', 's', 'd', 'f', 'g']) {
      await page.keyboard.down(key);
      await page.waitForTimeout(150);
      await page.keyboard.up(key);
      await page.waitForTimeout(350);
    }

    // 5. Finish attempt
    await page.getByRole('button', { name: /finish attempt/i }).click();

    // 6. Confirm results screen
    await expect(page).toHaveURL(/\/results$/);
    await expect(page.getByRole('heading', { name: /^Score \d+$/ })).toBeVisible();

    // 7. Confirm score and error breakdown appear
    for (const label of ['Overall', 'Pitch', 'Timing', 'Rhythm', 'Duration', 'Completeness']) {
      await expect(page.locator('.score-tile__label', { hasText: label })).toBeVisible();
    }
    const countRow = page.locator('.count-row');
    await expect(countRow).toContainText(/correct/i);
    await expect(countRow).toContainText(/wrong note/i);
    await expect(countRow).toContainText(/missed/i);
    await expect(countRow).toContainText(/extra/i);
    await expect(page.locator('.result-table')).toBeVisible();
    await expect(page.locator('.result-table tbody tr').first()).toBeVisible();
  });

  test('virtual keyboard is clickable without any MIDI device connected', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Rhythm Study/i }).click();
    await expect(page).toHaveURL(/\/practice$/);

    const middleC = page.getByLabel('Key 60');
    await expect(middleC).toBeVisible();
    await middleC.click();
    // The app must never depend on a connected MIDI device (spec §25).
    await expect(page.getByText('disconnected')).toBeVisible();
  });

  test('Practice and Results show a clear empty state with no song loaded', async ({ page }) => {
    await page.goto('/practice');
    await expect(page.getByText(/no song loaded/i)).toBeVisible();
    await page.getByRole('link', { name: /choose a song/i }).click();
    await expect(page).toHaveURL('/');

    await page.goto('/results');
    await expect(page.getByText(/no results yet/i)).toBeVisible();
  });

  test('Listen mode plays the reference with a synchronized playhead and no scoring UI', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /C Major Five-Finger/i }).click();
    await expect(page).toHaveURL(/\/practice$/);

    await expect(page.getByRole('tab', { name: 'Listen', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: /start attempt/i })).toHaveCount(0);

    await page.getByRole('button', { name: /^.?\s*play$/i }).click();
    await page.waitForTimeout(600);
    await expect(page.getByRole('button', { name: /^.?\s*pause$/i })).toBeVisible();

    const timeLabel = page.locator('.transport__time');
    await expect(timeLabel).not.toHaveText('0:00 / 0:02');

    // Regression: playback must stop itself at the end of the song and reset
    // the playhead, not run past the reference's duration indefinitely.
    await expect(page.getByRole('button', { name: /^.?\s*play$/i })).toBeVisible({ timeout: 5000 });
    await expect(timeLabel).toHaveText('0:00 / 0:02');
  });
});
