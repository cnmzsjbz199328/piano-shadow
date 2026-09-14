import { test, expect } from '@playwright/test';
import MidiPackage from '@tonejs/midi';

const Midi = (MidiPackage as unknown as { Midi: typeof import('@tonejs/midi').Midi }).Midi;

function denseMidiFixture(): Buffer {
  // Format 0, 96 ticks/beat: sixteenth/eighth notes plus a bass chord.
  const bytes = [
    0x4d,0x54,0x68,0x64,0,0,0,6,0,0,0,1,0,96,
    0x4d,0x54,0x72,0x6b,0,0,0,80,0,0xc0,0,
    0,0x90,60,100, 24,0x90,64,100, 24,0x80,60,64, 24,0x80,64,64,
    0,0x90,62,100, 24,0x90,65,100, 24,0x80,62,64, 24,0x80,65,64,
    0,0x90,64,100, 24,0x90,67,100, 24,0x80,64,64, 24,0x80,67,64,
    0,0x90,65,100, 48,0x80,65,64,
    0,0x90,48,90, 0,0x90,55,90, 0x81,0x40,0x80,48,64, 0,0x80,55,64,
    0,0xff,0x2f,0,
  ];
  return Buffer.from(bytes);
}

function multiRowExtremeFixture(): Buffer {
  const midi = new Midi();
  midi.header.setTempo(120);
  const track = midi.addTrack();
  for (let index = 0; index < 32; index += 1) {
    const time = index * 0.5;
    track.addNote({ midi: 84 + (index % 5), time, duration: 0.25, velocity: 0.8 });
    track.addNote({ midi: 36 + (index % 3), time, duration: 0.25, velocity: 0.7 });
  }
  return Buffer.from(midi.toArray());
}

test('NCL staff rendering keeps flags and voices separated', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({
    name: 'NCL dense beams.mid', mimeType: 'audio/midi', buffer: denseMidiFixture(),
  });
  await page.getByRole('button', { name: 'Practice', exact: true }).click();
  const score = page.getByRole('region', { name: /sheet music/i });
  await expect(score).toBeVisible();
  await expect(score.locator('.score-note').first()).toBeVisible();
  expect(await score.locator('svg').count()).toBe(1);
  expect(await score.locator('.score-note').count()).toBeGreaterThan(4);

  const first = score.locator('.score-note').first();
  await first.click();
  await expect(score.getByRole('status')).toHaveCount(0);
  await page.screenshot({ path: 'doc/screenshots/ncl-score-waiting.png', fullPage: false });
  await score.locator('.score-note').nth(1).click();
  await expect(score.getByRole('status')).toHaveCount(0);
  await expect(score.locator('.score-note--loop-start')).toHaveCount(1);
  await expect(score.locator('.score-note--loop-end')).toHaveCount(1);
  await expect(score.locator('.score-loop-marker')).toHaveCount(2);
  await page.screenshot({ path: 'doc/screenshots/ncl-score-real.png', fullPage: false });
});

test('NCL expands vertical system spacing for extreme registers', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({
    name: 'NCL multi-row.mid', mimeType: 'audio/midi', buffer: multiRowExtremeFixture(),
  });
  await page.getByRole('button', { name: 'Practice', exact: true }).click();
  const score = page.getByRole('region', { name: /sheet music/i });
  await expect(score).toBeVisible();
  await expect(score.locator('.score-note').first()).toBeVisible();
  await page.screenshot({ path: 'doc/screenshots/ncl-score-multi-row.png', fullPage: false });
  const svgHeight = await score.locator('svg').getAttribute('height');
  expect(Number(svgHeight)).toBeGreaterThan(700);
});
