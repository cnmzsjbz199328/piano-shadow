# Changelog

## v0.9.0 — Score / Library flip workspace (2026-09-10)

UI/interaction round from [`doc/UI_OPTIMIZATION_PLAN.md`](doc/UI_OPTIMIZATION_PLAN.md).
The Practice page becomes one continuous workspace. No change to the note model,
sequence aligner, playback clock, or scoring — only information architecture and
interaction.

- **Shared workspace stage.** `src/components/practice/PracticeWorkspace.tsx` is a
  fixed-size container with two mutually exclusive faces — **Score** and
  **Library** — that turn over like a card (`rotateY`, 420 ms `ease-in-out`).
  Repeat triggers are locked out mid-flip; the inactive (and still-turning) face
  is `inert` + `aria-hidden`, so a screen reader never reads across both lists;
  focus moves to the newly shown face's heading once the flip settles. Degrades
  to an instant swap under `prefers-reduced-motion`, on a phone-width viewport,
  or with no 3D transforms (`data-instant`, mirrored in JS and CSS).
- **Score is the default surface, not a collapsed toggle.**
  `src/components/sheet-music/ScoreSurface.tsx` gives `ScoreView` a light toolbar
  and its own `overflow-y: auto` viewport — a long piece scrolls its staves, not
  the page frame or the keyboard dock. Scroll position survives a flip (the
  element is never unmounted); a new song resets to the top. `MAX_MEASURES`
  raised 16 → 64 now that height is scrollable, not squeezed.
- **Library shares the stage.** `SongLibrary` re-housed as the flip's back face:
  one header (count + Import + "Back to score"), a self-scrolling list, current
  song marked with a left accent + "Current" badge, empty state with a prominent
  drop zone and built-in demos, and the import-failure banner reported next to
  the Import control (the surface in view never changes on failure).
- **Keyboard dock is outside the stage.** It never moves or scales when the
  workspace flips or the score scrolls (D-04) — asserted in E2E by comparing its
  bounding box across a full Score→Library→Score cycle.
- **Top toolbar** carries the high-frequency actions: current song, Play / Pause
  / Stop / Restart, progress, tempo, and the Score / Library switch. MIDI,
  debug, and low-frequency settings stay in the secondary `Practice settings`
  disclosure.
- Store: `practiceSurface` (`'score' | 'library'`, in-memory, UI-only) follows
  the loaded song — import stays on Library, choosing / demo-loading a song
  flips to Score, clearing falls back to Library.
- Removed the dead `PracticeEmptyState` (folded into the two surfaces).
- Tests: `PracticeWorkspace` (flip, inert, focus, reduced-motion),
  `SongLibrary` (header, current row, demos, back-to-score, import error),
  `useAppStore` surface routing, updated `ScoreView` measure cap, and an E2E
  for the Score↔Library flip + dock stability.

## v0.8.1 — Recognition no longer echoes or fights playback (2026-09-10)

Live-testing fix. On the deployed v0.8.0, hitting **Listen** (microphone
recognition) voiced every detected note through the sampled piano — the app
"played along" with the take instead of only capturing it — and recognition
shared audio voices, timers, and adapter callbacks with reference playback with
no arbitration.

- **Recognition is capture-only.** `noteStarted` / `noteEndedForRecognition` no
  longer self-voice, and `handleLearnerNoteOn` suppresses input audio while a
  microphone session is initializing or listening, so microphone **Listen**
  produces no sound at all. Note-offs are still always delivered (spec §25).
  MIDI-source **Listen** still monitors input audibly (a MIDI controller has no
  sound of its own) and rides the shared learner-input path, timestamped on the
  recognition session clock, not the stopped playback clock.
- **Recognition and reference playback are mutually exclusive.** Starting
  recognition stops playback and finishes any running attempt through the normal
  persist path; Play / Restart / Start practice / mode tabs are disabled while a
  session is initializing or listening; the wait-mode auto-resume is gated too.
- **Async races guarded.** A slow `getUserMedia` / model init, or a `Tone.start()`
  that resolves after Stop, can no longer revive a dead session
  (`connectionGeneration` in `MicrophoneAdapter`, `playRequestId` in
  `PlaybackEngine`, `recognitionSessionId` in the store). Reference-playback
  voices get their own ownership group, so stopping playback never cuts a note
  the learner is still holding.
- Tests: reference-voice ownership (`instrument` + new `PlaybackEngine.test.ts`),
  recognition/playback exclusion + session-clock timestamps (`useAppStore`),
  init-cancel race (`MicrophoneAdapter`), and an E2E for the Listen→Stop cancel
  path.

**Known, not addressed here:** the Pitchy (McLeod Pitch Method) recogniser still
drops a sustained note an octave (sometimes a fifth) onto a subharmonic — a
documented recogniser limitation ([`doc/MICROPHONE_LAB_FINDINGS.md`](doc/MICROPHONE_LAB_FINDINGS.md)),
left for the recognition round.

## v0.8.0 — Staff-notation view (2026-09-10)

Wave 3 · Track F. Scope signed off in advance (`doc/ARCHITECTURE.md` →
"Staff-notation view — scope"): spec §35 forbids *automatic sheet music
generation*, so this renders **only imported-MIDI `Performance`s** (which already
carry authored note durations), display-only, no export.

- **`src/components/sheet-music/ScoreView.tsx`** + a pure
  `secondsToNoteValue.ts` mapper. Behind a default-collapsed **"Show notation"**
  `<details>` on `PracticePage`, below the keyboard (still the primary visual).
- Seconds → beats via `song.tempoMap` (first marking); onsets/durations snapped
  to a 1/16 grid by **reusing** `quantization/quantize.ts`, then bucketed on a
  log-2 scale to the nearest of 1/1…1/16. Grand staff, split at middle C, first
  16 bars, with an in-UI caption disclosing the approximation.
- **Recorded / recognised takes are refused** with *"Notation needs a quantised
  rhythm — not available for recorded takes yet."* — no audio→notation, no OMR.
- **Display-only:** reads `song` from the store, never writes back; no editing,
  no drag, no MIDI/MusicXML/PDF export.
- `vexflow@^5` is **dynamically imported** inside the render effect, so it lands
  in its own lazy chunk (`vexflow-*.js`) and never enters the initial bundle —
  it loads only when the panel is first expanded.
- **Known approximation (stated in-UI and in code, not claimed as transcription):**
  one nearest note value per note, no dotted values / ties / tuplets, sharps-only
  spelling, only the first tempo + time signature honoured.
- Tests: 9 mapper cases on a 4/4 fixture + 6 component gate/smoke cases.

## v0.7.0 — Per-hand practice + input-latency compensation (2026-09-10)

Wave 3 · Tracks E and G2, merged together.

### Per-hand / per-track practice (Track E)

- **`src/music-model/hands.ts` — `inferHands(notes)`** (pure, deterministic):
  when a Standard MIDI File supplies ≥2 note tracks, assign `hand` by track
  (tracks ranked by pitch centroid, lowest → left); otherwise a fixed middle-C
  (MIDI 60) pitch split. `parseMidiFile` runs it so every imported song's notes
  carry `hand`.
- **Both / Left / Right** segmented control in "Practice settings"
  (`TransportControls`). Selecting a hand re-loads the engine with a **filtered
  clone** of the reference and rewinds; the same filtered subset feeds the
  `LiveMatcher` and `evaluatePerformance` in a finished attempt. The filter runs
  entirely *before* the practice engine — `SequenceAligner` / `evaluatePerformance`
  stay pure and untouched, and the five score dimensions are unaffected for the
  notes that remain. Songs with no `hand` data (older imports, recognised takes)
  fall back to the whole song — the reference is never empty.
- **Library Export** (`writeMidiFile`) now writes one MIDI track per `hand`
  group (→ `track` group → single track), so an exported two-hand arrangement
  re-imports with its hands intact.
- Tests: `hands.test.ts` (track-split, pitch-split fallback, determinism),
  `writeMidiFile` multi-track round-trip, a store test that `practiceVoice:'left'`
  scores only the left-hand reference.

### Input-latency compensation (Track G2)

- **"Input latency compensation (ms)"** on the Experiments page: a fixed scalar
  (clamped −200…500 ms) subtracted from every recorded learner onset at the one
  boundary where learner input enters the canonical model — the shared learner
  clock the input adapters timestamp against (`() => engine.getCurrentTime() -
  inputLatencyMs / 1000`). It cancels device/OS/audio-scan delay so an on-time
  performance is graded on-time. Not a new timer; `evaluatePerformance` /
  `SequenceAligner` untouched.
- **Persistence schema v2:** `inputLatencyMs` added to `SettingsRecord` /
  `DEFAULT_SETTINGS` (0); `DB_VERSION` 1→2 with an `upgrade` migration that
  back-fills the field on an existing settings record without disturbing the
  others; `loadSettings` also spreads onto `DEFAULT_SETTINGS` as defence in depth.
- Tests: persistence migration test; a scoring test that a uniform +80 ms shift
  with `inputLatencyMs = 80` restores an on-time Timing score (and is measurably
  worse at 0); clamp test.

## v0.6.0 — Falling-notes guidance layer (2026-09-10)

Wave 2 · Track D of the `fizzy-honking-heron` plan. A "Synthesia"-style visual guide,
added without touching the engine, the store logic, or the one authoritative clock.

- **`src/components/piano-roll/FallingNotes.tsx`** — a Canvas 2D layer mounted directly
  above the on-screen keyboard on `PracticePage`. Each upcoming reference note falls as
  a column toward the key it belongs to over a fixed 2.5 s look-ahead; the
  currently-sounding note is highlighted. Column x-positions and widths come from the
  same `src/components/piano/keyLayout.ts` geometry as the keyboard (Track C), so the
  columns line up exactly with the keys below and scale fluidly with them on small
  screens. Colours are read live from the design tokens (`getComputedStyle`), so the
  layer tracks light/dark like `PianoRoll`.
- **Clock-safe:** the component only *reads* `currentTime` from the store — no timer, no
  seek, no engine call. Its single `requestAnimationFrame` is a paint scheduler that
  coalesces store ticks into one draw; its timestamp is never used as a time source.
- **Reduced motion:** with `prefers-reduced-motion: reduce`, the layer shows a static
  stack of the next several upcoming-note markers (updated only as notes are consumed)
  instead of the falling animation.
- Shown only while the transport is `playing` / `counting-in` or an attempt is
  recording; nothing renders on the idle page.
- Tests: 8 unit cases (renders a canvas, no throw with `song=null` / 0 notes / notes
  present) + 1 E2E (layer appears on ▶, clears when practice ends).

## v0.5.0 — Sampled piano audio + audible input (2026-09-10)

Wave 2 · Track B of the `fizzy-honking-heron` plan.

- **New `src/audio-engine/` module** (peer of `playback-engine`, may only reach
  `music-model`; enforced by a new `eslint.config.js` boundary). It owns one
  module-scoped `SampledInstrument` singleton — `attack(midi, velocity, when?)`,
  `release(midi, when?)`, `dispose()` — built on **`smplr`**'s velocity-layered
  `SplendidGrandPiano`. The instrument renders into the existing Tone `AudioContext`
  (`Tone.getContext().rawContext`), so a `time` from a `Tone.Transport` schedule
  callback is already in its clock domain: a second *sound source* on the one
  schedule, not a second timer. The single authoritative clock is unchanged.
- **Reference playback** (`PlaybackEngine.scheduleNoteEvent`) now sounds through the
  shared instrument instead of `Tone.PolySynth(Tone.Synth)`. The separate metronome
  `clickSynth` and the v0.4.1 duration clamps (`MAX_VOICE_SECONDS`,
  `min(noteDuration, pieceDuration)`) are kept — reference voices are still self-
  releasing and bounded, so playback still auto-stops.
- **Audible input:** the on-screen keyboard, live Web MIDI, and recognised notes all
  sound, wired through one gated store helper in `pressVirtualKey`/`releaseVirtualKey`,
  `handleLearnerNoteOn`/`Off`, and `noteStarted`/`noteEndedForRecognition`. A new
  in-memory `soundEnabled` store flag (default on, `setSoundEnabled`) gates and
  instantly silences all of it (`releaseAll()` on mute). Persisting this preference is
  left to the later input-latency/settings track.
- **Graceful degradation, never silence:** the `Tone.PolySynth` voicing is built first
  and used while samples stream; if `smplr` can't fetch its samples (offline / CDN /
  CSP) the instrument transparently stays on that synth. `attack`/`release` are wrapped
  and never throw; headless (no Web Audio) → inert. Samples load lazily and never block
  playback or the first gesture.
- New dependency: `smplr@^1.0.0` (zero transitive npm deps; streams its own samples
  from a static host — no new CDN `<link>`/CSS). `doc/ARCHITECTURE.md` updated.
- Tests: 7 instrument cases (mocked `smplr`/`tone`, including the load-failure
  fallback) + 4 store cases (press/release calls `attack`/`release`; `soundEnabled`
  false suppresses it).

## v0.4.1 — Live-bug fixes: recognition clock & responsive keyboard (2026-09-10)

Wave 1 of [`doc/` plan `fizzy-honking-heron`](doc/PIANO_SHADOW_GOAL.md) — the two
defects that surfaced in live testing of the v0.4.0 build, plus the E2E coverage gap
noted in the v0.4.0 entry. Three independent tracks, disjoint files, merged together.

### Fixed — recognised notes rang forever on playback (Track A)

- `MicrophoneAdapter` timestamped note **onsets** on a buffer-relative value but note
  **offsets** on the absolute page clock (`performance.now()`), and the store injected
  no clock — so every recognised note's `duration` was inflated by hundreds to
  thousands of seconds. On playback the reference synth voice was held almost
  indefinitely (worst on the final note) and the song's computed length ballooned so
  playback never auto-stopped.
- Every note boundary now derives from **one monotonic session clock**: the store
  injects `() => recognitionTime()` into the adapter, and `poll()` anchors both the
  onset and every `endActive(...)` on that clock. Recognition sessions longer than
  ~20 s now get correct onset spacing (the old buffer-relative anchor saturated at the
  ~20 s rolling-buffer cap).
- Defense in depth, three independent ceilings: a recognised note's stored duration is
  clamped to `min(rawSpan, sessionElapsed, 12 s)`; `PlaybackEngine` clamps any
  scheduled voice to `min(noteDuration, pieceDuration)` and a hard 30 s.
- New `src/device-adapters/MicrophoneAdapter.test.ts` — fake injected clock + stubbed
  capture/recognizer; asserts a note still active at `disconnect()` and a note followed
  by silence both get bounded durations, and onsets stay clock-aligned past the ~20 s
  horizon.

### Fixed — page scrolled horizontally on small screens (Track C)

- The 88-key keyboard was a fixed ~1352 px SVG with no `overflow-x` clamp on
  `html/body/#root`, so phones scrolled sideways. The keyboard now **scales to fit the
  viewport** (not a reduced key range): fluid SVG (`width="100%"`,
  `preserveAspectRatio="none"`), responsive height `clamp(72px, 14vw, 130px)`, capped
  at its natural 1352 px width on desktop so large screens are visually unchanged.
- Key geometry (`buildKeyLayout`, `centreXForMidi`, the width/height constants)
  extracted to a new pure, React-free `src/components/piano/keyLayout.ts` — no
  behaviour change; upcoming visual layers can align to the same key x-positions.
- Safety net: `html, body { overflow-x: clip }` (`clip`, not `hidden`, so
  `.keyboard-dock` keeps `position: sticky`); `flex-wrap` on the keyboard-dock and
  recognition toplines; a 2-column score grid under 480 px. The keyboard's internal
  scroll affordances are retained (a no-op at fit scale; still work if a future caller
  passes a key range too wide to fit).

### Restored — three route-based E2E regressions (Track G1)

Lost in the v0.4.0 single-page rewrite, re-added to `tests/e2e/practice.spec.ts`
adapted to the single page: an attempt auto-finishes when the reference reaches its end
(inline Score card, no "Finish practice" click); Stop rewinds the transport playhead to
`0:00`; the on-screen keyboard reflects pressed state (`aria-pressed`) with no MIDI
device connected.

### Engineering

- `.claude` added to the ESLint ignore list so agent worktree build artifacts under
  `.claude/worktrees/` are never linted.
- `npm run test` (114), `npm run typecheck`, `npm run lint`, `npm run build`,
  `npm run test:e2e` (6) all green on the integrated result.

## v0.4.0 — Single-page recognition & practice (2026-09-08)

Implementation of [`doc/SINGLE_PAGE_RECOGNITION_PLAN.md`](doc/SINGLE_PAGE_RECOGNITION_PLAN.md).
This is a product-direction change: Piano Shadow is no longer a multi-page MIDI practice
workbench but a single-page piano recognition and play-along tool. It **supersedes the
"Phase D deferred" position** stated in the v0.3.0 entry — see the microphone note below
for exactly what that means and what is still ungated.

### Single-page shell

- **Navigation collapsed to one page.** The `Practice · Results · Lab` nav is gone; the
  header is just the brand and a `Settings` menu. `/results` and `/lab` stay as
  compatibility routes, reachable from Settings ("Recognition diagnostics" → `/lab`,
  "Browser and advanced settings" → `/experiments`); `/microphone-lab` still redirects to
  `/lab`. No demo songs anywhere in the product surface.
- `PracticePage` is now a single stateful container: recognition controls on top, the
  88-key keyboard as the primary visual, the shared song library below, and — after a
  practice attempt — an inline result card on the same page (no route change to
  `/results`). `PianoRoll` and `StatusStrip` are no longer on the practice surface.

### Listen → recognise → save

- **`Listen` is the one primary action.** It starts recognition from the microphone by
  default; on microphone failure the UI states the reason and offers "Use MIDI instead".
  Recognised notes drive the keyboard in real time; `Stop` segments the stream into a
  `Performance`, saves it via the existing `persistence` layer, and it appears at the top
  of the library. A recognition run that detects zero notes is surfaced as a failure, not
  saved as an empty song.
- New `src/device-adapters/MicrophoneAdapter.ts` — a `NoteInputAdapter` that composes
  `MicrophoneCapture` + `PitchyRecognizer` from `recognition/` and emits the same
  note-on/off contract as MIDI. `practice-engine` still cannot import `recognition/` and
  has no knowledge of a microphone (lint boundary unchanged).
- New `src/midi/writeMidiFile.ts` — serialises a `Performance` back to a Standard MIDI
  File for the library's **Export** action.
- Shared library (`SongLibrary`): recorded and imported MIDI in one list, each row with
  **Practice / Export / Delete** (delete confirmed). `Import MIDI` is a secondary action
  on the library, not a landing-page hero.
- Practice mode names are now learner-facing: `跟拍 · Play Along`, `跟随 · Wait for me`,
  `Listen only`, tucked into a "Practice settings" disclosure with tempo / count-in /
  metronome and the MIDI device + live-feedback detail.

### Microphone status — honest about the open gate

Microphone recognition is now in the practice path **ahead of** the live real-piano
validation session required by `PIANO_SHADOW_GOAL.md` §36 and `ROUND_3_REQUIREMENTS.md`
§D.1 (D0). That session has **not** been run. Accordingly:

- Recognition is **Pitchy monophonic only**. Chords / polyphony are not supported from
  the microphone and the UI says so; use MIDI or MIDI import for those.
- Every microphone surface carries a permanent "Experimental — real-piano pitch accuracy
  and onset latency have not been measured yet" note. No microphone output is presented
  as production-ready (spec §25).
- Still outstanding from `ROUND_3_REQUIREMENTS.md` §D: the live D0 session and its
  decision checkpoint, latency-offset calibration (§D.2.4), a feature flag / opt-in, and
  `MicrophoneAdapter` unit tests with synthetic audio (§D.4). Tracked in
  [`doc/MICROPHONE_LAB_FINDINGS.md`](doc/MICROPHONE_LAB_FINDINGS.md) and README Roadmap.

### Tests

- `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:e2e`
  all pass. The E2E suite is rewritten for the single-page flow (open → import → practice
  on one page; microphone-failure fallback). The playback-engine's own unit tests still
  cover end-of-song stop/reset; the three deleted route-based E2E regressions
  (auto-finish at end, playhead reset, keyboard-without-MIDI) are noted here as a
  coverage gap to restore.

## v0.3.0 — Practice Workspace Redesign (2026-09-07)

Implementation of [`doc/ROUND_3_REQUIREMENTS.md`](doc/ROUND_3_REQUIREMENTS.md), run
sequentially as specified. **Phase C shipped**; **Phase D (monophonic microphone input)
is deferred** — it is gated on a live human validation session (`§D.1` D0) that has not
been run, so per the requirements Round 3 lands at the end of Phase C plus the written
findings. See the Roadmap in `README.md`.

### Phase D gate — chord/interval synthetic benchmark (§D.1.1)

- `src/recognition/benchmark.ts` gains `benchmarkPolyphony()` + `DEFAULT_BENCHMARK_CHORDS`
  — additive sine-wave intervals/triads/7ths, deterministic and headless, same rigour as
  `PitchyRecognizer.test.ts`; also shown in the Lab's synthetic-benchmark section. It
  documents Pitchy's monophonic-only failure mode: on a summed chord the McLeod Pitch
  Method locks to a single spurious low pitch and resolves **0** of the actual chord
  tones (`monophonicOnly = true`). Microphone chord / polyphonic practice stays out of
  scope. Written up as a dated addendum in
  [`doc/MICROPHONE_LAB_FINDINGS.md`](doc/MICROPHONE_LAB_FINDINGS.md).
- The rest of D0 — the live human microphone/real-piano session and its decision
  checkpoint (§D.1.2–4) — is still outstanding, so no `MicrophoneAdapter` is added.
  `NoteInputAdapter` still has only the virtual keyboard and Web MIDI;
  `practice-engine` still cannot import `recognition/`.

### Phase C — UI optimization

- **Continuous practice workspace.** `PracticePage` is restructured to match
  [`doc/ui-references/practice-workspace.png`](doc/ui-references/practice-workspace.png):
  a single-row header (song name · `Listen / Play Along / Wait` segmented control ·
  compact transport with tempo steppers), the Piano Roll as the page body, a
  default-collapsed status strip (MIDI connection + live-feedback summary; expands to the
  full MIDI device picker and rolling live-feedback list), and a full-width **88-key
  keyboard (A0–C8)** docked at the bottom. The keyboard scrolls horizontally inside its
  own container, starts centred on middle C, and scrolls the sounding octave into view;
  it keeps every existing behaviour (highlight, mouse/touch, QWERTY + Z/X octave shift —
  the QWERTY *mapping* is unchanged).
- **Navigation collapsed to three items** — `Practice · Results · Lab`. Experiments and
  the debug-panel toggle move into a top-right gear menu. "Microphone Lab" → "Lab"
  (`/microphone-lab` still resolves, redirecting to `/lab`). Home is folded into
  Practice's empty state; `/` renders `PracticePage`. `HomePage.tsx` is retired.
- **Results page** rebuilt to
  [`results-page.png`](doc/ui-references/results-page.png): large Overall score, six
  dimension tiles in one row with mini progress bars, the reference-vs-your-performance
  overlay, a per-category legend with counts, and `Practice again` / `Back home` bottom-right.
- **Visual system.** Elevation tokens (`--bg-elevated` / `-2` / `-3`) pulled close
  together so stacked surfaces read as one calm ground; a single control height; three
  explicit button tiers (`primary` / secondary / `quiet`); scattered inline styles
  removed. The four semantic result colours (`--correct` / `--wrong` / `--missed` /
  `--extra`) keep their names and values, are used only in feedback contexts, and stay
  mutually distinguishable and distinct from the accent.
- No new dependency, no light-mode toggle, no webfont. **No change** to the data
  pipeline, the single authoritative clock, `practice-engine` / `playback-engine`, the
  scoring code, or `PianoRoll`'s canvas-rendering algorithm — presentation only.
- Contrast (WCAG relative luminance, against `--bg #0c0d10`, unchanged): body text
  17.0:1; `--text-dim` 7.2:1; `--correct` 8.8:1, `--wrong` 6.3:1, `--missed` 8.9:1,
  `--extra` 6.5:1 — all clear 4.5:1. `--text-faint` (micro-labels only, never body copy)
  3.9:1, unchanged from Phase A.
- Verified: `npm run test` (107), `npm run typecheck`, `npm run lint`, `npm run test:e2e`
  (5), `npm run build` all green; acceptance scenarios A–E re-checked on a manual
  walkthrough. E2E selectors updated only where structure moved (hero heading; the
  Practice/Home empty-state assertions) — assertion logic unchanged.

## v0.2.0 — UI Modernization + Microphone Lab (2026-09-07)

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
