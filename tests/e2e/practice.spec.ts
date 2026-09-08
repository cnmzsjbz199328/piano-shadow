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

test.describe('Piano Shadow — single-page recognition and practice', () => {
  test('opens with Listen, the 88-key feedback surface, and an empty library', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: /listen/i })).toBeVisible();
    await expect(page.getByLabel('Key 60')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'My MIDI songs' })).toBeVisible();
    await expect(page.getByText(/will appear here/i)).toBeVisible();
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
    await expect(page).toHaveURL(/\/practice$/);
    await expect(page.getByRole('heading', { name: /^Score \d+$/ })).toBeVisible();
    await expect(page.locator('.count-row')).toBeVisible();
  });

  test('microphone failure gives a reason and offers MIDI as an alternative', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /listen/i }).click();
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole('button', { name: /use midi instead/i })).toBeVisible();
  });
});
