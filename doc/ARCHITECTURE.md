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
                                                          ↘   ↗ audio-engine
                                              device-adapters  →  stores/services  →  components/pages
```

`audio-engine` is a peer of `playback-engine` (both may only reach `music-model`);
`playback-engine` and `stores` import it, nothing else does.

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
| `music-model` | Canonical types, note-name conversion, normalization, `inferHands` (pure left/right hand assignment) | nothing else in `src` |
| `midi` | Standard MIDI File import (`@tonejs/midi`) → `Performance`, tagging every note with an inferred `hand`; `writeMidiFile` (`Performance` → SMF, one track per `hand`/`track` group) for library Export; built-in demo melodies | `music-model` |
| `quantization` | Non-destructive grid-snap for a future Teach Mode capture pipeline | `music-model` |
| `practice-engine` | `SequenceAligner` (DP alignment), `timingAnalyzer` (tempo/rhythm split), `scoring`, `evaluatePerformance`, `LiveMatcher` | `music-model` only |
| `playback-engine` | `PlaybackEngine` (Tone.js transport wrapper: play/pause/seek/tempo/metronome/count-in), `timeMapping` (pure clock math), `Metronome` (pure beat-grid math) | `music-model`, `audio-engine` |
| `audio-engine` | `SampledInstrument` — one shared sampled-piano voice bank (`smplr` `SplendidGrandPiano`, streamed samples) for reference playback **and** audible learner input (keyboard / live MIDI / recognised notes); transparent `Tone.PolySynth(Tone.Synth)` fallback if samples can't load. Its own module, a peer of `playback-engine`, so sound generation stays out of React (spec §25) and rides the existing Tone schedule rather than adding a timer. Called only from `playback-engine` and `stores`. | `music-model` |
| `device-adapters` | `NoteInputAdapter` boundary, `VirtualKeyboardAdapter`, `WebMidiAdapter`, `MicrophoneAdapter` (composes `recognition/`; monophonic Pitchy, experimental — see below), `PerformanceRecorder` | `music-model`, `recognition` |
| `recognition` | `NoteRecognizer` interface + `PitchyRecognizer` / `BasicPitchRecognizer` / `MicrophoneCapture` / `benchmark` (used by `MicrophoneAdapter` and the `/lab` diagnostics page) | `music-model` |
| `services` | `persistence` — IndexedDB (songs, attempts, settings) via `idb` | `music-model`, `practice-engine` |
| `stores` | `useAppStore` (Zustand) — the only place the engines above are instantiated and wired together | everything below it |
| `components`, `pages` | React UI; all user-facing language (early/late/wrong-note/etc.) lives here, never in `practice-engine` | `stores` and below |
| `components/sheet-music` | `ScoreView` — read-only staff notation for an imported-MIDI `Performance` via `vexflow` (dynamic import); `ScoreSurface` wraps it in the score face's toolbar + independent scroll viewport; `secondsToNoteValue` maps quantised seconds → plain note values. Refuses recorded takes. See "Staff-notation view — scope" below. | `music-model`, `quantization`, `stores` |
| `components/practice` | `PracticeWorkspace` — the shared Score/Library flip stage (pure presentation shell: 3D flip on a controlled `surface` prop, `inert` + focus management, `data-instant` reduced-motion/no-3D/phone fallback); `SongLibrary` — the library face. Surface state is `stores.practiceSurface` (UI-only). Microphone recognition is intentionally not rendered by Practice; its experimental UI lives at `/lab`. | `stores` and below |

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

`audio-engine`'s `SampledInstrument` renders into `Tone.getContext().rawContext`
— the *same* AudioContext Tone schedules against — so a `time` handed to it from
inside a `Tone.getTransport().scheduleOnce((time) => …)` callback is already in
its clock domain. It is a second *sound source* on the one schedule, not a
second clock: `PlaybackEngine` still owns all timing; the instrument only turns
note numbers into sound.

`MicrophoneAdapter` (v0.4.0) is used for **recognition only** — capturing playing
into a fresh `Performance` — not yet as a practice-attempt input. Its onsets run
on a `performance.now()` clock local to the recognition session and feed a
standalone song, so they are never compared against the reference clock. Wiring
the microphone in as a practice input (with the latency-offset compensation
`ROUND_3_REQUIREMENTS §D.2.4` calls for) is still gated on the §D.1 validation
session.

## Per-hand practice is a pre-engine filter

`inferHands` (`music-model/hands.ts`, added v0.7.0) tags every imported note with
`hand: 'left' | 'right'`: by SMF track when the file has ≥2 note tracks (tracks
ranked by pitch centroid — lowest → left, next → right, any further tracks split
at middle C), otherwise by a fixed middle-C pitch split. It is pure and
deterministic; `parseMidiFile` runs it so imported songs carry `hand` alongside
the `track` they already had.

`useAppStore.practiceVoice` (`'both' | 'left' | 'right'`, default `'both'`)
selects which hand(s) to practise. The filter is applied to a **clone** of
`song.notes` in the store — `voiceFilteredNotes(song, voice)` — *before* the
notes reach `engine.load`, `new LiveMatcher(...)`, or
`evaluatePerformance(reference, learner)`. `SequenceAligner` / `evaluatePerformance`
never see the removed notes, so nothing is index-matched around a gap and the
engine stays a pure `NoteEvent[]` consumer (spec §5, §25). A song with no `hand`
data (recognised takes, pre-v0.7 imports) has nothing matching a single hand, so
the filter falls back to the full song. `writeMidiFile` emits one SMF track per
`hand` group (falling back to `track`, then a single track), so an exported
two-hand file round-trips its structure.

## State ownership

`useAppStore` (Zustand) holds serializable UI/practice state only. The
`PlaybackEngine`, the two input adapters, and the `PerformanceRecorder` are
created once as module-scoped instances in `stores/useAppStore.ts` — one
AudioContext / input pipeline for the app's lifetime, the same way any web app
owns a single audio graph — and they communicate with the store exclusively by
pushing plain-object snapshots through `setState`. `audio-engine`'s
`instrument` singleton is owned the same way (module scope, app lifetime); the
store calls its `attack` / `release` from the keyboard / MIDI / recognition
paths, gated by an in-memory `soundEnabled` flag. Scores are never stored as
mutable state directly written by the UI; every `EvaluationResult` in the store
came from a call to `evaluatePerformance` (spec §25).

## Rendering

The Piano Roll (`components/piano-roll/PianoRoll.tsx`) is Canvas 2D: a redraw on
every relevant prop change, cheap enough at MVP note counts to hit 60fps without
a WebGL library. It is isolated behind a component boundary so it could be
swapped for PixiJS later without touching the practice engine or store.

Current/next-note guidance (added v0.6.0 as a separate falling-notes Canvas
layer; folded directly into the keyboard in a later revision) is drawn as
SVG `<text>` labels inside `components/piano/PianoKeyboard.tsx`'s own `<svg>`,
in a reserved strip above the keys (`LABEL_ROW_HEIGHT` in `keyLayout.ts`). It
derives its target notes from `practice-engine/referenceNotes.ts`'s
`currentOnsetGroup` / `nextOnsetGroup` (pure functions over `NoteEvent[]` and
`currentTime` — no timer of its own, so the single clock is preserved) and
positions each label from the same key x-coordinates the keys themselves use,
so a label always sits directly over the key it names, black keys included.
The current target is also announced through a visually-hidden
`aria-live="polite"` status for screen-reader users, since the labels
themselves are `aria-hidden`.

## Persistence

IndexedDB via `idb` (`services/persistence.ts`): imported songs, practice
attempts with their full score breakdown, and settings (tempo scale, metronome,
count-in, last MIDI input, debug panel visibility). No account, no login, no
network calls.

## Staff-notation view — scope (v0.8.0, signed off 2026-09-10)

`components/sheet-music/ScoreView.tsx` renders standard staff notation with
`vexflow`. Spec §35 forbids **"automatic sheet music generation"**; spec §12's
own module tree nonetheless lists `components/sheet-music/`. This is the agreed
boundary that keeps both true:

- **Input is an imported-MIDI `Performance` only.** Those carry real, authored
  note durations and a `tempoMap` / `timeSignatureMap`. The view maps
  seconds → beats via the `tempoMap` and snaps to note values by **reusing**
  `quantization/quantize.ts` (`gridSecondsFor`, `quantizeNotes`), then buckets
  each note to the nearest 1/1…1/16. It is a *display transform of data the user
  already supplied*, not transcription.
- **Recorded / recognised takes are refused.** A microphone- or device-recorded
  `Performance` has no quantised rhythm, so `ScoreView` shows
  *"notation needs a quantised rhythm — not available for recorded takes yet"*
  rather than guessing. No audio → notation, no OMR, no AI.
- **Display-only.** No note editing, no drag, no MIDI/MusicXML/PDF export from
  this view. It never writes back to the `Performance` or the store.
- **Promoted to the default surface (v0.9.0, UI_OPTIMIZATION_PLAN.md).** It was
  behind a collapsed *"Show notation"* toggle; it is now the front face of the
  shared `PracticeWorkspace`, wrapped by `ScoreSurface` in its own
  `overflow-y: auto` viewport. The `vexflow` import is still dynamic (its own
  chunk) but now triggers when a song loads rather than on toggle-open;
  `MAX_MEASURES` is 64 (was 16) since the viewport scrolls. The on-screen
  keyboard is still the primary practice visual — it sits in a dock *outside*
  the flip stage. `practice-engine` / `playback-engine` / scoring are untouched;
  the view only reads `song.notes`.
