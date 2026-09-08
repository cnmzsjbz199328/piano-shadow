# Next Round Requirements: UI Modernization + Microphone Lab

## 0. Status and relationship to the spec

This document elaborates the next round of work agreed with the user on 2026-09-05. It
does **not** replace [`PIANO_SHADOW_GOAL.md`](PIANO_SHADOW_GOAL.md), which remains the
authoritative spec: where that document states something explicitly (interfaces,
prohibitions, acceptance scenarios A–E, timing constants), it wins on any conflict. This
document is the detailed, concrete elaboration of that spec's terse §36 ("Next Milestone
After v0.1: v0.2 Microphone Lab"), plus a UI modernization initiative the spec does not
cover at all.

Two independent phases, run **sequentially, not interleaved**:

- **Phase A — UI Modernization** (visual refresh only). Ships and is verified complete
  first.
- **Phase B — Microphone Lab** (spec §15/§36 groundwork). Starts only after Phase A is
  done.

Do not start Phase B work — including exploratory spikes — before Phase A's acceptance
criteria (§A.4 below) all pass. Do not fold Phase B scope into Phase A's PRs/commits.

---

## Phase A — UI Modernization

### A.1 Goal

Redesign the visual language to **restrained/neutral** (Linear/Notion-style): generous
whitespace, a low-saturation neutral gray scale, a single accent color, thin borders
rather than drop shadows to separate panels, low information density, a calm/professional
tone. The app is currently **dark-only** (`color-scheme: dark` forced in
`src/index.css`) — Linear's own dark theme (not Notion's light-first one) is the closer
reference anchor for what "restrained neutral" looks like against a dark background.
Stay dark-only in this round (see Non-goals).

### A.2 In scope

- A reworked design-token system in `src/index.css`: neutral gray scale (background /
  elevated surfaces / borders / text at 2–3 levels of emphasis), a single accent color,
  spacing scale, type scale, radius scale, and a border-first (not shadow-first)
  elevation system.
- Visual (not structural) rework of every existing component/page using those tokens:
  `app-shell`/nav, page headers, panels/cards, buttons, form controls, `ScoreCard`,
  `NoteResultList`, `LiveFeedback`, `TransportControls`, `MidiDevicePanel`,
  `PianoKeyboard`, the **chrome** around `PianoRoll` (legend, zoom controls, axis
  labels — not its canvas-drawing algorithm), `DebugPanel`, `EmptyState`, `ErrorBanner`,
  `FileDropZone`, and `ExperimentsPage`.
- Keep and carry forward, unchanged in *meaning*, the four semantic result colors
  (`--correct` / `--wrong` / `--missed` / `--extra`) that `ScoreCard`, `NoteResultList`,
  and the `PianoRoll` overlay depend on to encode match results. Their hex values may
  change to fit the new neutral palette, but the four MUST remain mutually
  distinguishable from each other and from the accent color, and the same CSS-variable
  names MUST be reused everywhere they currently appear (no ad hoc hard-coded colors
  introduced as a side effect).
- A quick manual contrast check (body text vs. background ≥ 4.5:1) as part of Phase A's
  own review, since "clean" must not mean "low contrast."

### A.3 Non-goals (explicit — do not do these in Phase A)

- No new runtime dependency (no Tailwind, no component library, no CSS-in-JS). Stay on
  plain CSS + custom properties.
- No page/route restructuring, no new pages, no renamed routes, no navigation
  reorganization (e.g. do not move `ExperimentsPage` behind a new "Settings" section).
- No change to `PianoRoll`'s canvas rendering algorithm, `practice-engine`, or
  `playback-engine` — chrome/styling only.
- No new webfont requiring a network fetch; keep the existing system-font-stack
  approach (`--font-sans` already resolves to system fonts if `Inter` isn't present) or
  swap for another system-available stack — do not add a Google Fonts `<link>` or similar.
- No light-mode toggle. Stay `color-scheme: dark`, forced, as today.
- No change to keyboard shortcuts, tab order, or ARIA roles — visual only.

### A.4 Acceptance criteria

- Home, Practice (incl. keyboard, Piano Roll, transport, Wait Mode banner, live
  feedback), Results, and Experiments all render fully on the new token set — no
  component left on old hard-coded colors/spacing.
- `npm run test`, `npm run typecheck`, `npm run lint`, and `npm run test:e2e` all still
  pass unmodified in assertions (component tests may need class-name/snapshot updates
  only if they assert exact class names, not new test logic).
- No new entries added to `package.json` dependencies/devDependencies.
- Manual contrast check documented (even informally, e.g. one line in the PR/commit
  description) for body text and for each of the four semantic result colors against
  the new background.

---

## Phase B — Microphone Lab (spec §15 / §36 groundwork)

### B.1 Goal

Implement spec §36's "v0.2 Microphone Lab" goals concretely, as an **isolated,
experimental page** — not as a new practice input. This satisfies spec §25's
prohibition on claiming microphone transcription works before it is benchmarked, and
§36's explicit instruction: "Do not merge experimental microphone code into the stable
practice path until accuracy and latency are measured."

### B.2 In scope

1. **Permission flow** — a mic-permission UI (extend `ExperimentsPage` or add a new
   `MicrophoneLabPage`/route) that requests `getUserMedia({ audio: true })`, shows
   current permission/device state, and surfaces denial or hardware errors in the UI
   (never silently swallowed — same rule CLAUDE.md already states for MIDI).
2. **Audio capture** — `AudioContext` + `AudioWorkletNode` (not the deprecated
   `ScriptProcessorNode`) capturing mic input at the context's native sample rate, with
   start/stop controls and a live level meter (peak or RMS) so the user can confirm the
   mic is live before trusting any pitch output.
3. **Single-note pitch-detection baseline** — one lightweight monophonic recognizer
   implemented against the existing `NoteRecognizer` interface
   (`src/recognition/NoteRecognizer.ts`): `initialize()` / `process(audio, sampleRate)`
   returning `DetectedNote[]`. Use an autocorrelation/YIN approach — the `pitchy` npm
   package (MIT) is the likely implementation choice unless investigation during Phase B
   finds a reason to hand-roll it instead. Name it per spec's own naming
   (`PitchyRecognizer`, or `YinRecognizer` if hand-rolled).
4. **Basic Pitch benchmark** — a second recognizer path using Spotify's Basic Pitch
   (Apache-2.0 — independently licensed, satisfies spec §14's "prefer independently
   licensed libraries/models") run against the same captured audio, to compare a
   polyphonic-capable model against the monophonic baseline. Lazy-load this model only
   on the Lab page so it never adds weight to the main app bundle.
5. **Latency measurement** — for a controlled test (e.g. a single played note against a
   metronome click, or a clap), measure and display time-from-audio-onset to
   detected-note-event, in ms, for both recognizers.
6. **Confidence visualization** — render `DetectedNote.confidence` (0–1) visibly (color
   or opacity scale, or a numeric readout).
7. **Compare against MIDI ground truth** — a benchmark mode: play one of the three
   built-in demo melodies on a MIDI keyboard (or replay its reference `NoteEvent[]`)
   while the mic listens to the same performance, then diff the two `NoteEvent[]`
   arrays. **Reuse `practice-engine`'s existing `SequenceAligner`/`evaluatePerformance`
   for this diff** (it is format-agnostic on `NoteEvent[]`) rather than writing a second
   comparison algorithm — but only by *calling into* `practice-engine` from the Lab page;
   `practice-engine` itself must not gain any knowledge of microphones or audio.

### B.3 Hard constraints (carried over from spec — must hold)

- `practice-engine` MUST NOT import from `recognition/`, and MUST NOT know a microphone
  exists. All Lab code lives in a new page/module, not wired into `PracticePage` or the
  practice-input adapter list.
- `MicrophoneAdapter` (a `NoteInputAdapter` implementation) is explicitly **out of
  scope** for this round — do not add microphone as a selectable input source in
  Practice modes yet, regardless of how well the baseline performs. That is a decision
  for a future round, made only after this round's findings are written up.
- Never silently swallow `getUserMedia` permission errors or device-loss events.
- Never mark this feature as "microphone recognition works" or production-ready in any
  UI copy, README, or CHANGELOG entry — every surface must show it as experimental, with
  the actual measured accuracy/latency numbers next to it, not a bare checkmark (spec
  §25).
- No GPL code copied (`Floopdible/piano_trainer` is study-only). Verify Transkun's
  license before considering it; if it turns out to be GPL or otherwise incompatible
  with this MIT-licensed app, drop it from this round's scope entirely rather than
  vendoring/adapting its code.

### B.4 Acceptance criteria

- A working Lab experience: grant mic permission → see a live level meter → play a
  single note or short phrase → see detected notes (pitch name + confidence) from the
  baseline recognizer → trigger a Basic Pitch comparison run on the same captured audio
  → see a latency number for each recognizer → see a MIDI-ground-truth comparison
  reusing `practice-engine`'s existing result shape (at minimum Pitch and Completeness
  dimensions) for at least one built-in demo melody.
- New unit tests for the baseline recognizer's math: synthetic sine-wave input at known
  frequencies (e.g. 440 Hz → A4) asserting the detected MIDI note number and a
  reasonable confidence value — same rigor as `SequenceAligner.test.ts`.
- Written findings (a new `doc/MICROPHONE_LAB_FINDINGS.md`, or a section in
  `CHANGELOG.md`): measured latency (ms) and accuracy (error rate over some number of
  test notes) for both recognizers. This is the explicit gate spec §36 requires before
  any future round considers merging microphone input into the stable practice path.
- Zero changes to `practice-engine`'s public API, `playback-engine`, or `PracticePage`'s
  input-adapter list.
- `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build` all still pass.

### B.5 Left open for implementation time (not scope questions — technical calls to make when coding)

- `pitchy` npm package vs. a hand-rolled YIN implementation for the baseline recognizer.
- Exact Basic Pitch package/runtime (e.g. `@spotify/basic-pitch` + TensorFlow.js) and
  whether in-browser inference latency is acceptable for a useful benchmark, or whether
  the Lab should instead run it on a short pre-recorded buffer rather than live audio.
- Whether Transkun is usable at all once its license is checked (see B.3).

---

## Definition of done for this round

Both phases pass their own acceptance criteria (§A.4, §B.4) independently, in the order
A then B. Before declaring the round complete: run all tests, run the production build,
and manually verify Phase A's pages still satisfy acceptance scenarios A–E from
`PIANO_SHADOW_GOAL.md` §27–§31 (a visual refresh must not regress correctness), plus
Phase B's own Lab walkthrough above. Update `README.md` (Known limitations / Roadmap)
and `CHANGELOG.md` for both phases, same as the v0.1 release.
