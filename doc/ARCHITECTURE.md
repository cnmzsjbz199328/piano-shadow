# Architecture

Piano Shadow is a single Vite + React + TypeScript app with **enforced internal
module boundaries** rather than a multi-package monorepo (spec §12 explicitly
permits this: "A simpler structure is acceptable if it preserves the same module
boundaries. Do not over-engineer workspace tooling if it slows delivery.").

Boundaries are enforced two ways:

1. **One-way data flow.** Every layer only imports from the layers below it.
2. **`eslint.config.js`** encodes that direction as `no-restricted-imports` rules
   per directory, so an accidental upward import (e.g. `practice-engine`
   reaching into `components`) fails `npm run lint`, not just a code review.

```
music-model  →  midi / quantization  →  practice-engine  →  playback-engine
                                                          ↘
                                              device-adapters  →  stores/services  →  components/pages
```

## The pipeline

```
MIDI file / demo ──parseMidiFile──▶ Performance (canonical NoteEvent[])
                                            │
                        ┌───────────────────┼───────────────────┐
                        ▼                                       ▼
                 PlaybackEngine                         device adapter
              (Tone.Transport clock)                (keyboard / Web MIDI)
                        │                                       │
                  reference playhead              PerformanceRecorder
                  + note-on/off events                          │
                        │                            learner Performance
                        └──────────────┬────────────────────────┘
                                       ▼
                          evaluatePerformance(expected, actual)
                     SequenceAligner → timingAnalyzer → scoring
                                       │
                                       ▼
                          EvaluationResult (matches + ScoreBreakdown)
                                       │
                                       ▼
                      UI (ScoreCard, NoteResultList, PianoRoll overlay)
```

`NoteEvent` / `Performance` (`src/music-model`) are the only source of truth for
practice logic (spec §3). UI state, raw MIDI bytes, and DOM elements never leak
into the practice engine — every adapter, importer, and recorder ultimately
produces `NoteEvent[]`, and `evaluatePerformance` only ever consumes two
`NoteEvent[]` arrays in, one `EvaluationResult` out. It is a pure function: same
input, same output, always (spec §21.1).

## Module reference

| Module | Responsibility | Depends on |
|---|---|---|
| `music-model` | Canonical types, note-name conversion, normalization | nothing else in `src` |
| `midi` | Standard MIDI File import (`@tonejs/midi`) → `Performance`; built-in demo melodies | `music-model` |
| `quantization` | Non-destructive grid-snap for a future Teach Mode capture pipeline | `music-model` |
| `practice-engine` | `SequenceAligner` (DP alignment), `timingAnalyzer` (tempo/rhythm split), `scoring`, `evaluatePerformance`, `LiveMatcher` | `music-model` only |
| `playback-engine` | `PlaybackEngine` (Tone.js transport wrapper: play/pause/seek/tempo/metronome/count-in), `timeMapping` (pure clock math), `Metronome` (pure beat-grid math) | `music-model` |
| `device-adapters` | `NoteInputAdapter` boundary, `VirtualKeyboardAdapter`, `WebMidiAdapter`, `PerformanceRecorder` | `music-model` |
| `recognition` | `NoteRecognizer` interface only — no implementation in v0.1 (spec §15) | `music-model` |
| `services` | `persistence` — IndexedDB (songs, attempts, settings) via `idb` | `music-model`, `practice-engine` |
| `stores` | `useAppStore` (Zustand) — the only place the engines above are instantiated and wired together | everything below it |
| `components`, `pages` | React UI; all user-facing language (early/late/wrong-note/etc.) lives here, never in `practice-engine` | `stores` and below |

## Why a Sequence Aligner, not index matching

Matching reference note *i* to learner note *i* breaks the moment a note is
missed or an extra note is inserted — every later note appears "wrong" even
though it was played correctly (spec §5, §28, §31). `SequenceAligner` runs a
Needleman-Wunsch-style dynamic-programming alignment over
`(pitch equality/distance, onset distance, insertion, deletion)`, so a gap in
one sequence never shifts the classification of what comes after it. The cost
weights (`practice-engine/constants.ts`) are calibrated so pitch dominates
timing — see the worked examples in that file's comments and the acceptance-
scenario tests in `evaluatePerformance.test.ts`.

## Why timing and rhythm are computed separately

A learner who plays evenly but at a different tempo than the reference should
score well on rhythm and poorly on absolute timing (spec §8, acceptance
scenario D) — never "wrong" outright. `timingAnalyzer.fitTimeline` does a
least-squares fit of the learner's onsets onto the reference's
(`actual ≈ tempoRatio·expected + offset`) using only the matched pairs from the
aligner. **Timing** score comes from the raw onset error; **Rhythm** score comes
from the residual *after* removing that global tempo/offset. This is the
"architecture allows adding DTW later" hook from spec §8 — `fitTimeline` is the
seam a future beat-tracking/DTW implementation would replace.

## One authoritative clock

Reference playback, the UI playhead, and (during a practice attempt) the
learner's own note timestamps are all derived from a single
`Tone.Transport`-backed clock inside `PlaybackEngine` (spec §2.4). Tempo scale,
count-in, and mid-playback seeks are implemented as re-pinning a linear
`(transportSeconds, referenceSeconds, scale)` mapping (`playback-engine/timeMapping.ts`)
rather than independent timers — see that file's doc comment for the reasoning.
Learner input adapters (`VirtualKeyboardAdapter`, `WebMidiAdapter`) are
constructed with `() => engine.getCurrentTime()` as their clock, so a learner's
onset and the reference's onset are directly comparable numbers.

## State ownership

`useAppStore` (Zustand) holds serializable UI/practice state only. The
`PlaybackEngine`, the two input adapters, and the `PerformanceRecorder` are
created once as module-scoped instances in `stores/useAppStore.ts` — one
AudioContext / input pipeline for the app's lifetime, the same way any web app
owns a single audio graph — and they communicate with the store exclusively by
pushing plain-object snapshots through `setState`. Scores are never stored as
mutable state directly written by the UI; every `EvaluationResult` in the store
came from a call to `evaluatePerformance` (spec §25).

## Rendering

The Piano Roll (`components/piano-roll/PianoRoll.tsx`) is Canvas 2D: a redraw on
every relevant prop change, cheap enough at MVP note counts to hit 60fps without
a WebGL library. It is isolated behind a component boundary so it could be
swapped for PixiJS later without touching the practice engine or store.

## Persistence

IndexedDB via `idb` (`services/persistence.ts`): imported songs, practice
attempts with their full score breakdown, and settings (tempo scale, metronome,
count-in, last MIDI input, debug panel visibility). No account, no login, no
network calls.
