# Changelog

## v0.1.0 — Web Practice MVP (2026-09-04)

Initial implementation of [`doc/PIANO_SHADOW_GOAL.md`](doc/PIANO_SHADOW_GOAL.md).

### Implemented

- **Reference import** — Standard MIDI File (`.mid`/`.midi`) parsed into the
  canonical `Performance`/`NoteEvent[]` model, including tempo and time-signature
  maps. Three built-in demo melodies (a spec-reference five-finger pattern, a
  mixed-rhythm study, and the opening of "Twinkle, Twinkle") so the app is usable
  immediately with no user-supplied file.
- **Practice input** — an on-screen piano keyboard (mouse/touch and QWERTY
  computer-keyboard shortcuts) and a Web MIDI device adapter, behind a common
  `NoteInputAdapter` interface. Web MIDI is feature-detected and optional; the
  app never depends on a connected device.
- **Piano Roll** — Canvas 2D renderer: time/pitch axes, a pitch-aligned keyboard
  gutter, zoom, current playhead, and (on the Results page) reference-vs-learner
  overlay colored by match result, with hover tooltips.
- **Playback** — play/pause/stop/seek/restart, tempo scale (25%–200%),
  metronome, and count-in, all driven from one `Tone.Transport`-backed clock so
  the UI playhead can never drift from the audio.
- **Practice engine (core)** — deterministic dynamic-programming sequence
  alignment (never index-based), a timing analyzer that separates absolute
  timing from tempo-normalized rhythm, piecewise-linear scoring against named
  configuration constants, and an orchestrating `evaluatePerformance`. Covered
  by unit tests for every case in spec §21.1 and all five acceptance scenarios
  (§27–§31).
- **Practice modes** — Listen (highlight only, no scoring), Play Along (record
  + evaluate on finish, with lightweight live feedback), and Wait Mode
  (playback pauses at the next reference note/chord until the learner echoes
  it; monophonic and simultaneous-onset chords).
- **Results** — category scores (Pitch/Timing/Rhythm/Duration/Completeness/
  Overall), note-level result table, and the Piano Roll overlay.
- **Persistence** — IndexedDB (imported songs, practice attempts with full score
  breakdowns, settings) via `idb`. No login, no cloud.
- **Debug panel** — hidden by default; playhead, active reference/learner notes,
  last MIDI event, selected input, recent matching decisions, last score.
- **Testing** — 97 Vitest unit/integration tests (engine, model, MIDI import,
  adapters, persistence, key components) plus a 4-scenario Playwright E2E suite
  exercising the real app in a real browser against a production build.
- **Deployment** — static build, Cloudflare Pages config (`wrangler.toml`,
  `public/_redirects`), a GitHub Pages 404-fallback copy step, GitHub Actions CI
  (typecheck/lint/test/build + E2E) and a Cloudflare Pages deploy workflow.

### Known limitations

See [README.md § Known limitations](README.md#known-limitations) and
[`doc/ARCHITECTURE.md`](doc/ARCHITECTURE.md) for the full list; in short:
the metronome/count-in follow only the reference file's first tempo marking,
Wait Mode chord matching does not enforce voicing order, and — per spec — no
microphone input, teacher-recording transcription, or ESP32 adapter is
implemented (interfaces only, spec §15/§16/§17).

### Out of scope for v0.1 (per spec §35)

Polyphonic microphone transcription, automatic teacher-audio transcription,
automatic sheet-music generation, optical music recognition, accounts, cloud
sync, social features, ESP32 firmware, mobile native app, AI lesson
recommendations.
