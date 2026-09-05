# Changelog

## v0.2.0 — UI Modernization + Microphone Lab (2026-09-05)

Implementation of [`doc/NEXT_ROUND_REQUIREMENTS.md`](doc/NEXT_ROUND_REQUIREMENTS.md),
run sequentially as specified: Phase A shipped and passed its own acceptance criteria
before Phase B started.

### Phase A — UI modernization

- **Restrained-neutral (Linear-dark) visual refresh** — a full design-token rework in
  `src/index.css`: a neutral gray surface/border/text scale (3 emphasis levels), a single
  indigo-blue accent, spacing/type/radius scales, and a border-first elevation system.
  Every existing page/component retinted onto the new tokens; the four semantic result
  colors (`--correct`/`--wrong`/`--missed`/`--extra`) keep their names and stay mutually
  distinguishable. No new dependency, no route/IA change, no change to `PianoRoll`'s
  canvas algorithm/`practice-engine`/`playback-engine` — chrome and tokens only.
  `PianoRoll.tsx`'s canvas now reads the live token values via `getComputedStyle` instead
  of duplicating them as hex literals, so it can't drift out of sync with the palette.
  Contrast verified (WCAG relative luminance): body text 17.0:1, all four semantic colors
  6.3–8.9:1 against the new background.

### Phase B — Microphone Lab (spec §15/§36 groundwork)

- **An isolated, experimental `/microphone-lab` page** — not wired into Practice or the
  `NoteInputAdapter` list (spec §25's ban on claiming microphone transcription works
  before it's benchmarked). Permission flow, live level meter via `AudioWorklet` capture
  (not the deprecated `ScriptProcessorNode`), and never-silently-swallowed
  permission/device-loss errors, matching the app's existing Web MIDI error handling.
- **Two `NoteRecognizer` implementations**: `PitchyRecognizer` (baseline, MIT-licensed
  `pitchy`, autocorrelation/MPM, monophonic) and `BasicPitchRecognizer` (Spotify's
  Apache-2.0 Basic Pitch, polyphonic-capable, dynamically imported so its TensorFlow.js
  dependency and model weights never touch the main bundle — confirmed by the production
  build's separate chunk).
- **Latency measurement, confidence visualization, and a synthetic-audio benchmark**
  (`src/recognition/benchmark.ts`) that produced this round's written findings
  deterministically, without needing a live microphone session.
- **MIDI ground-truth comparison** — reuses `practice-engine`'s existing
  `evaluatePerformance`/`SequenceAligner` to diff mic-detected notes against a real
  MIDI-recorded performance, rather than a second bespoke comparison algorithm.
- **Written findings**: [`doc/MICROPHONE_LAB_FINDINGS.md`](doc/MICROPHONE_LAB_FINDINGS.md)
  — both recognizers hit 100% accuracy on a 9-tone synthetic benchmark (a ceiling case,
  not a real-world number); Basic Pitch is ~80x slower per call (≈1.9s vs ≈23ms). A live
  microphone/real-piano session has not been run yet — that gap, and the explicit
  "do not merge into the stable practice path yet" conclusion, are documented there.
  Transkun was investigated and dropped from this round (MIT-licensed upstream, but no
  official JS package — only an unofficial ONNX export needing a hand-rolled decoder).

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
