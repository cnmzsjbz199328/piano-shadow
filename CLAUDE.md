# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

This is a **greenfield repository**. The only content today is the product spec at
`doc/PIANO_SHADOW_GOAL.md`. There is no code, build system, package manager, or test
runner yet, and the directory is not a git repository.

`doc/PIANO_SHADOW_GOAL.md` is the authoritative specification. **Read it in full before
writing code** — it contains binding `MUST` / `MUST NOT` requirements, five acceptance
scenarios (A–E) that define the correctness bar, and a phased implementation order
(§34). This file summarizes the parts that are easy to get wrong; the spec wins on any
conflict.

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

## Commands (target — not yet wired up)

The spec (§23) requires the project to run with a small, documented command set. Once
scaffolded, expect:

```bash
npm install       # or: pnpm install
npm run dev        # local dev server
npm run test       # unit + integration tests (Vitest)
npm run build       # production build — must pass with no TypeScript errors
```

When you create the project, update this section with the real commands, including how to
run a single test file and how to run the Playwright E2E suite.

## Definition of done

Before claiming any milestone complete: run all tests, run the production build, and
manually verify acceptance scenarios A–E in `doc/PIANO_SHADOW_GOAL.md` (§27–§31). The
full done-checklist is spec §33.
