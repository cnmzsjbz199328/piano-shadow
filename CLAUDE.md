# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

v0.1 (the Web Practice MVP) is implemented — see [`CHANGELOG.md`](CHANGELOG.md) for what
shipped and [`README.md`](README.md#known-limitations) for known limitations. Single Vite +
React + TypeScript app with the module layout described below, enforced by
`eslint.config.js`'s `no-restricted-imports` boundary rules.

`doc/PIANO_SHADOW_GOAL.md` is the authoritative specification for any further work.
**Read it before making architectural changes** — it contains binding `MUST` / `MUST NOT`
requirements, five acceptance scenarios (A–E) that define the correctness bar (covered by
`src/practice-engine/evaluatePerformance.test.ts`), and a phased implementation order
(§34; v0.1 completed Phases 1–5, §34's "Phase 6 — Optional" and v0.2 in §36 are not yet
started). This file summarizes the parts that are easy to get wrong; the spec wins on any
conflict. [`doc/ARCHITECTURE.md`](doc/ARCHITECTURE.md) has the as-built module map and the
reasoning behind the sequence aligner, the timing/rhythm split, and the single-clock
playback design.

## What is being built

A browser-first piano practice web app. A reference performance (imported Standard MIDI
File) becomes a reusable template; the learner plays along via a virtual keyboard or Web
MIDI; the app aligns learner input against the reference and explains pitch, timing,
rhythm, duration, missed-note, and extra-note errors.

Scope for v0.1 is Web only. Microphone transcription (v0.2) and ESP32 are explicitly out
of scope — they influence *interface boundaries* only, never implementation.

## Architecture boundaries (protect these)

The data flow is a one-way pipeline with a single source of truth:

```
input adapter → NoteEvent[] → practice engine → NoteMatchResult[] → scores → feedback UI
```

- **Canonical model is the only source of truth.** All practice logic operates on
  `NoteEvent` / `Performance` objects (defined in spec §3). UI state, raw MIDI events,
  MusicXML, and DOM elements must never be the source of truth.
- **Every input adapter emits `NoteEvent[]`** and nothing else. The practice engine
  *consumes* `NoteEvent[]` only — it must not know about MIDI, audio, or any device.
  Adapters implement the `NoteInputAdapter` interface (spec §17); initial ones are
  `VirtualKeyboardAdapter` and `WebMidiAdapter`.
- **Keep the layers separate:** input capture, canonical music data, visualization,
  practice matching, scoring. Suggested modules (a flatter layout is fine if the
  boundaries hold): `music-model`, `midi`, `practice-engine`, `playback-engine`,
  `device-adapters`, `quantization`.
- **Scoring logic lives outside React components**, in its own module with unit tests.
- **One authoritative clock.** Playback timing and the UI playhead derive from the same
  clock — no independent timers that can drift.

## Core logic rules

- **Sequence alignment, never index matching.** Match reference vs. learner notes with a
  deterministic dynamic-programming alignment (cost = pitch distance + onset distance +
  insert/delete). A missed or extra note must NOT shift the classification of later
  notes. This lives in its own module (e.g. `practice-engine/src/SequenceAligner.ts`)
  with the unit-test cases listed in spec §21.1.
- **Five independent score dimensions:** Pitch, Timing, Rhythm, Duration, Completeness,
  plus Overall. Never collapse into one unexplained number; every score must be
  derivable from note-level `NoteMatchResult`s.
- **Rhythm ≠ absolute timing.** Normalize learner timing against reference tempo / phrase
  duration before scoring rhythm. A globally slower-but-even performance must score high
  on Rhythm and lower on Timing (acceptance scenario D).
- **Timing tolerances are named config constants** (spec §7 defaults: 60 / 120 / 250 ms),
  never magic numbers scattered in code.
- **No hard-coded user-facing language inside scoring algorithms.** The engine emits
  typed results (`correct` / `wrong-note` / `missed` / `extra`, error magnitudes); the UI
  maps those to text and labels (early/late/on-time/etc.).
- Never silently swallow note-off events or Web MIDI permission/device errors. The app
  must start and run without any MIDI device connected.

## Explicit prohibitions (from spec §25)

Do not: match notes by array index; put scoring logic in React components; mix MIDI
parsing with rendering; use global mutable singletons for performance data; scatter
timing constants; depend on a connected MIDI keyboard; add a backend for anything that
works locally; copy GPL-3.0 code (the `Floopdible/piano_trainer` reference is GPL — study
only, do not copy); optimize for ESP32 before the Web MVP is complete; mark
placeholder/mocked functionality as done.

## Recommended stack

React + TypeScript + Vite, Zustand for state, Web Audio + Web MIDI APIs, Tone.js (or
equivalent stable audio-timing layer), PixiJS (or another performant canvas renderer) for
the Piano Roll, Vitest for unit/integration tests, Playwright for E2E, IndexedDB for
local persistence (imported songs, settings, attempts, score summaries, last MIDI input,
playback speed). Deviate only with a clear technical reason. No backend; deployable as a
static site (GitHub Pages / Cloudflare Pages / Vercel).

## Commands

```bash
npm install
npm run dev              # Vite dev server, http://localhost:5173
npm run test               # unit + integration tests (Vitest)
npm run typecheck           # tsc --noEmit
npm run lint                 # ESLint, including the architectural boundary rules
npm run build                 # typecheck + vite build -> dist/ (+ dist/404.html for GH Pages)
npm run test:e2e:install       # one-time: install the Playwright Chromium browser
npm run test:e2e                # Playwright E2E — builds + serves a production build first
npm run deploy                   # build + wrangler pages deploy dist --project-name piano-shadow
```

Single test file: `npx vitest run src/practice-engine/SequenceAligner.test.ts`.
Single Playwright test: `npx playwright test -g "load demo, play along"`.

## Definition of done

Before claiming any milestone complete: run all tests, run the production build, and
manually verify acceptance scenarios A–E in `doc/PIANO_SHADOW_GOAL.md` (§27–§31). The
full done-checklist is spec §33.
