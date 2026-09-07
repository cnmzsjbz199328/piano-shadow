# Round 3 Requirements: Practice Workspace Redesign + Monophonic Microphone Input

## 0. Status and relationship to the other specs

This document defines the third round of work, agreed with the user on 2026-09-07. It is
the successor to [`NEXT_ROUND_REQUIREMENTS.md`](NEXT_ROUND_REQUIREMENTS.md) (which scoped
Round 2 — Phase A UI retint + Phase B Microphone Lab, both now implemented on the
`phase-b-microphone-lab` branch).

Authority order, highest first:

1. [`PIANO_SHADOW_GOAL.md`](PIANO_SHADOW_GOAL.md) — the binding spec. Its `MUST` / `MUST
   NOT` clauses, the acceptance scenarios A–E (§27–§31), the `NoteInputAdapter` interface
   (§17), the timing constants (§7), and the §25 prohibitions win on any conflict.
2. [`CLAUDE.md`](../CLAUDE.md) — the architecture-boundary summary.
3. This document — the concrete elaboration for Round 3.

Round 3 has **two phases, run sequentially, not interleaved**:

- **Phase C — UI Optimization.** Ships and is verified complete first.
- **Phase D — Monophonic Microphone Input.** Starts only after Phase C's acceptance
  criteria (§C.5) all pass. Its gate task **D0** (a live-microphone validation session,
  §D.1) *may* run in parallel with Phase C, because it needs a human and no code changes.

Do not fold Phase D scope into Phase C's PRs/commits, and vice versa. One phase, one (or a
short stack of) PR(s).

Version target for the completed round: **v0.3.0**.

---

## 1. Prerequisite (before either phase starts)

Round 2's work (Phase A `d275369`, Phase B `f664aaf`) is committed on
`phase-b-microphone-lab` but **not merged, pushed, or PR'd** — `origin/main` is still at
`7514996` and the live site has none of it.

1. Push `phase-b-microphone-lab`, open a PR to `main` ("v0.2.0: Phase A UI + Phase B
   Microphone Lab", keeping the two commits distinct), let CI go green, merge, confirm the
   Cloudflare Pages deploy, tag `v0.2.0`.
2. Correct the `CHANGELOG.md` v0.2.0 date to the actual release date.
3. Delete the stale `phase-a-ui-modernization` branch.
4. Branch Phase C from the updated `main`.

Rationale: Phase C rewrites Practice-page layout and a large amount of `src/index.css`.
Stacking that on unmerged branches makes review progressively harder.

---

## Phase C — UI Optimization

### C.1 Goal

Implement [`doc/ui-references/UI_REVIEW.md`](ui-references/UI_REVIEW.md) (dated 2026-09-07)
and its three reference images. This round goes **further than Phase A**: Phase A was a
visual-only token retint with an explicit no-IA-change, no-route-change rule. Phase C is
allowed to restructure page layout, navigation, and information architecture — but only
the *presentation* layer. The data pipeline
(`input adapter → NoteEvent[] → practice engine → NoteMatchResult[] → scores → feedback`),
the single authoritative clock, and scoring-outside-React are **not** touched (§C.3).

The three reference images and their intent:

- [`practice-workspace.png`](ui-references/practice-workspace.png) — the primary target. A
  continuous practice workspace: Piano Roll as the page body, a compact single-row header
  (song name · mode selector · transport), a collapsible status/feedback strip, and a
  full-width 88-key keyboard docked at the bottom.
- [`home-page.png`](ui-references/home-page.png) — one primary "Import a MIDI file" action;
  demos and recent practice are secondary.
- [`results-page.png`](ui-references/results-page.png) — score summary, reference-vs-your-
  performance comparison, one clear next action.

### C.2 In scope

**C.2.1 Navigation / IA**

- Collapse the top nav to three items: `Practice · Results · Lab` (centred), matching the
  reference images. `src/App.tsx`'s `NAV_LINKS`.
- Add a gear / overflow menu (top-right) holding: Experiments, the Debug-panel toggle, and
  room for future settings. `ExperimentsPage` and `DebugPanel` stay reachable, just
  demoted out of the primary nav.
- Rename "Microphone Lab" → "Lab" in nav copy. Keep the `/microphone-lab` route working
  (add `/lab` as an alias if convenient); do not break existing deep links.
- Brand logo click → Practice.

**C.2.2 Home / Practice consolidation (decision, then implement)**

The reference nav has no standalone "Home". Decision to make and record in the PR:
recommended — fold Home's hero + MIDI import + demo list + recent-practice into
`PracticePage`'s empty state (`PracticePage.tsx` already renders `<EmptyState>` when no
song is loaded), and point `/` at Practice. `HomePage.tsx` either becomes that empty
state or is retired. If Home is kept as a separate route, it must still be demoted from
the primary nav.

**C.2.3 Practice continuous workspace (P0 — the core of Phase C)**

Per `practice-workspace.png`:

- **Header row:** song name (left) · `Listen / Play Along / Wait` segmented control
  (centre) · compact transport toolbar `Play / ⏮ / ⏭ / loop / Tempo ±` (right) — one row.
- **Body:** `PianoRoll` is the dominant element, not one card among many. Keep its
  left-edge pitch ruler (C3 / C4 / C5).
- **Status strip:** a single collapsible bar between roll and keyboard — "MIDI connected ●"
  + "Live feedback ●●●●●" + an expand affordance. Collapsed by default; takes no vertical
  space when collapsed.
- **Keyboard dock:** the 88-key keyboard (C.2.4) docked at the bottom, spanning the main
  content width.
- **`MidiDevicePanel`, detailed live-feedback, debug info:** moved into a
  default-collapsed side panel / drawer.
- The `Wait Mode` banner, count-in indicator, and any existing E2E-visible affordances
  must remain present and reachable.

**C.2.4 Full-size 88-key keyboard (P0)**

- `PianoKeyboard.tsx` default range → `lowMidi = 21`, `highMidi = 108` (A0–C8). Currently
  `48` / `84` (C3–C6, 37 keys).
- ~1352px wide at the current 26px white-key width. Desktop: show in full or scroll
  horizontally inside its own container. Small screens: horizontal scroll, black/white key
  proportions preserved. The page body must never scroll horizontally as a whole.
- Initial horizontal scroll position centred on C4. The octave containing the active
  reference/learner note scrolls into view.
- Add `A0` / `C4` / `C8` key-name labels and a current-range / octave indicator.
- Preserve all existing behaviour: key highlighting, mouse/touch input, QWERTY
  computer-keyboard input. The QWERTY mapping stays ~17 notes + Z/X octave shift — that is
  an input-mapping concern, explicitly **out of scope** here (UI_REVIEW §"虚拟键盘范围").
- Verify highlight/scroll performance with 88 DOM keys (up from 37).

**C.2.5 Control system**

- Three explicit button tiers: `primary` (Start practice / Practice again), `secondary`,
  `quiet` (icon buttons, minor links). Apply consistently.
- Unify spacing / type / radius / control-height tokens; remove scattered inline styles.
- Reduce the contrast *between* the elevated dark surfaces (`--bg`, `--bg-elevated`,
  `--bg-elevated-2`, `--bg-elevated-3`) — UI_REVIEW flags the layering as too busy.
- Keep the four semantic result colours (`--correct` / `--wrong` / `--missed` /
  `--extra`): same variable names, used only in feedback contexts, still mutually
  distinguishable and distinguishable from the accent.

**C.2.6 Home & Results polish**

- Home / Practice empty state (`home-page.png`): single prominent import dropzone; three
  demo chips and recent-practice as secondary rows.
- Results (`results-page.png`): large Overall score; six dimension tiles
  (Overall / Pitch / Timing / Rhythm / Duration / Completeness) in one row with mini
  progress bars; reference-vs-your-performance overlay with playhead; legend table with
  per-category counts; `Practice again` (primary) + `Back home` (secondary) bottom-right.
- Consistent whitespace, hierarchy, and interaction states across all three page types.

### C.3 Non-goals (explicit — do not do these in Phase C)

- No new runtime dependency (no Tailwind, no component library, no CSS-in-JS). Plain CSS +
  custom properties, as today.
- No change to `PianoRoll`'s canvas-rendering algorithm — chrome and layout around it
  only. No change to `practice-engine`, `playback-engine`, the scoring code, or the
  single-clock design.
- No change to the QWERTY input mapping (keep ~17 keys + Z/X octave).
- No light-mode toggle. Stay `color-scheme: dark`, forced.
- No new webfont requiring a network fetch (keep the system-font stack).
- No microphone work — that is Phase D.
- Route *labels* and nav weight may change; route *behaviour* (Practice / Results / Lab
  all still function, deep links still resolve) must not regress.

### C.4 Files likely touched

`src/App.tsx`, `src/index.css`, `src/pages/PracticePage.tsx`, `src/pages/HomePage.tsx`,
`src/pages/ResultsPage.tsx`, `src/components/piano/PianoKeyboard.tsx`,
`src/components/transport/TransportControls.tsx`,
`src/components/piano-roll/PianoRoll.tsx` (chrome only),
`src/components/debug/DebugPanel.tsx`, `src/components/midi/MidiDevicePanel.tsx`,
and possibly `tests/e2e/practice.spec.ts` (selector updates only — see C.5).

### C.5 Acceptance criteria

- Home / Practice (incl. keyboard, Piano Roll, transport, mode selector, Wait Mode banner,
  live feedback), Results, and Lab all render on the restructured layout; no component
  left on Phase-A-era spacing/hard-coded colours.
- The three pages visually correspond to `practice-workspace.png` / `home-page.png` /
  `results-page.png` (layout and hierarchy; pixel-identity not required).
- The virtual keyboard shows 88 keys (A0–C8), scrolls horizontally on a narrow viewport,
  and keeps highlight / mouse / touch / QWERTY behaviour.
- `npm run test`, `npm run typecheck`, `npm run lint`, `npm run test:e2e`, `npm run build`
  all pass. E2E may need selector/class updates where structure moved — **assertion logic
  must not change**; if an assertion genuinely no longer applies, that is a scope
  discussion, not a silent edit.
- No new entries in `package.json` dependencies / devDependencies.
- Manual contrast check documented in the PR: body text ≥ 4.5:1 against the background,
  and each of the four semantic result colours still mutually distinguishable.
- Acceptance scenarios A–E (`PIANO_SHADOW_GOAL.md` §27–§31) still pass on a manual
  walkthrough — a layout change must not regress correctness.
- `doc/ui-references/` screenshots (or `doc/` screenshots) refreshed to the new UI;
  `README.md` and `CHANGELOG.md` updated for Phase C.

---

## Phase D — Monophonic Microphone Input

### D.0 Goal

Promote the Phase B Microphone Lab's monophonic baseline (`PitchyRecognizer`) from an
isolated benchmark into a real, **experimental, opt-in** practice input source — a
`MicrophoneAdapter` implementing the existing `NoteInputAdapter` interface (spec §17).
This is the first step of spec §37's product direction (student performance captured
without a MIDI keyboard) and is explicitly gated by spec §36 ("Do not merge experimental
microphone code into the stable practice path until accuracy and latency are measured").

Scope is **monophonic only** — one note at a time. Polyphonic / chord recognition via
microphone (Basic Pitch) stays out of scope this round (§ "Out of scope").

### D.1 D0 — the validation gate (needs a human; may run during Phase C)

Nothing in D.2 onwards may start until D0's decision checkpoint passes.

1. **(Agent, no mic needed)** Add chord/interval synthetic cases to
   `src/recognition/benchmark.ts` so the benchmark also exercises Basic Pitch's
   polyphonic capability and documents Pitchy's monophonic-only failure mode on chords —
   deterministic, headless, same rigour as `PitchyRecognizer.test.ts`.
2. **(Human)** In `/lab` (a.k.a. `/microphone-lab`): grant microphone permission → "Free
   capture" a real piano (or voice/whistle) single note; confirm the level meter responds
   and `PitchyRecognizer` returns a sensible note name → run the MIDI ground-truth
   comparison (section 3) with a real MIDI keyboard playing one built-in demo melody.
   Record: Pitchy's pitch-accuracy rate, onset latency (ms), and missed/wrong-note rate on
   real piano audio.
3. **(Agent)** Write the numbers up as a dated addendum to
   [`doc/MICROPHONE_LAB_FINDINGS.md`](MICROPHONE_LAB_FINDINGS.md).
4. **Decision checkpoint.** Proceed to D.2 only if, on a clean single-note melody:
   pitch-correct rate ≥ ~90% **and** onset latency < ~80 ms. Otherwise Phase D is
   deferred: Round 3 ships Phase C plus the written findings, and a future round decides
   whether a different algorithm, a voice-only input, or a better model is worth it.

### D.2 In scope (only if D0 passes)

**D.2.1 `MicrophoneAdapter`**

- New file `src/device-adapters/MicrophoneAdapter.ts` — **not** in `recognition/`. It
  implements `NoteInputAdapter` and emits `NoteEvent[]` (spec §3) and nothing else.
- Internally composes `MicrophoneCapture` + `PitchyRecognizer` from `recognition/`.
  `device-adapters` → `recognition` is already permitted by `eslint.config.js` (line 65
  does not forbid it, and `recognition` only depends downward on `music-model`);
  `practice-engine` → `recognition` stays forbidden (line 61). Confirm both on `npm run
  lint`.
- `practice-engine` gains zero knowledge of microphones — no import, no interface change.
- `getUserMedia` permission denial and device-loss events are surfaced in the UI, never
  swallowed (the rule already applied to Web MIDI in `WebMidiAdapter`).

**D.2.2 Streaming detection loop**

- Replace the Lab's one-shot `process(audio, sampleRate)` call with a rolling-window loop:
  run detection on roughly a ~100 ms window every ~30–50 ms.
- Segment the continuous pitch stream into discrete note events: onset debounce, minimum
  note duration, a confidence threshold, pitch-change → note-off for the previous note,
  silence → note-off.
- All of these thresholds are named constants (the "no magic numbers" rule — spec §7 style,
  as in `practice-engine/constants.ts`), in a `device-adapters` or `recognition` constants
  module.

**D.2.3 Practice integration**

- Add "Microphone (experimental)" to the input-source selector in the Phase-C-restructured
  Practice side panel. Behind a feature flag (off by default).
- Every microphone surface permanently shows "experimental — measured pitch accuracy X%,
  latency Y ms" (the real numbers from D0), never a bare checkmark (spec §25).
- Microphone input is offered only for monophonic use: `Listen`, `Play Along`, and
  monophonic `Wait Mode`. Chord / polyphonic practice via microphone is not supported and
  the UI says so.
- Live confidence visualisation reuses the Lab's existing confidence bar.

**D.2.4 Latency calibration**

- `MICROPHONE_LAB_FINDINGS.md` notes a roughly-constant few-hundred-ms setup-latency
  offset between the mic timeline and the reference clock, which shows up as
  Timing-dimension error even when pitch is right. Add a tunable constant offset
  compensation, calibrated from the D0 session data.

### D.3 Hard constraints (carried over from the spec — must hold)

- `practice-engine` MUST NOT import from `recognition/` and MUST NOT know a microphone
  exists.
- `MicrophoneAdapter` is a `NoteInputAdapter` like any other; it must not become a special
  case inside the practice engine or the scoring code.
- No second comparison / alignment algorithm — the Lab's MIDI-ground-truth path already
  reuses `evaluatePerformance` / `SequenceAligner`.
- Never mark microphone recognition as "working" or production-ready in any UI copy,
  `README.md`, or `CHANGELOG.md` entry. Experimental, with measured numbers, everywhere.
- No GPL code (`Floopdible/piano_trainer` is study-only). `pitchy` (MIT) and
  `@spotify/basic-pitch` (Apache-2.0) only.
- No `MicrophoneAdapter` as a *default* or non-experimental input this round.

### D.4 Tests & docs

- `MicrophoneAdapter` unit tests with synthetic audio, same rigour as
  `PitchyRecognizer.test.ts`: note-on/note-off segmentation, pitch-change handling,
  silence handling, confidence gating, and error propagation (permission denied, device
  loss).
- One Playwright E2E smoke test using `--use-fake-device-for-media-stream`: select the
  microphone input, run one `Play Along` attempt end to end.
- `README.md` (Known limitations / Roadmap), `CHANGELOG.md`, and the
  `MICROPHONE_LAB_FINDINGS.md` addendum updated.
- `doc/ARCHITECTURE.md` module map gains `MicrophoneAdapter` under `device-adapters` —
  with the `practice-engine ⊥ recognition` edge still absent.

### D.5 Acceptance criteria

- With the flag on, "Microphone (experimental)" is selectable in Practice; playing a
  monophonic demo melody into a real microphone produces Pitch / Timing / Completeness
  scores within the range D0 established.
- Every microphone surface shows the experimental label + real measured numbers.
- `practice-engine`'s public API, `playback-engine`, and the existing E2E assertions are
  unchanged.
- `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build` all pass; the
  architectural boundary (`practice-engine` cannot import `recognition`) still enforced.

### D.6 Left open for implementation time (technical calls, not scope questions)

- Exact rolling-window size and hop, and the onset-debounce / min-duration / confidence
  constants — tune against the D0 recording.
- Whether the streaming loop runs on the audio thread (AudioWorklet) or the main thread
  with a rolling buffer.
- Whether the feature flag is a build-time env var or a runtime setting in the gear menu.

---

## Out of scope for Round 3 (say so explicitly if asked)

- Polyphonic / chord microphone recognition (Basic Pitch's ~1.9 s/clip latency is
  unsolved) — a later round.
- Microphone as a default (non-experimental) practice input.
- Remapping the QWERTY computer-keyboard input to the full 88 keys.
- Light-mode toggle.
- Swapping `PianoRoll`'s Canvas 2D renderer for PixiJS / WebGL.
- ESP32 adapter, teacher-recording transcription pipeline (interfaces only, per spec
  §15 / §16 / §17).
- Wait Mode chord voicing order, A/B practice loop, per-tempo-map metronome (still tracked
  for a later round — spec §34 Phase 6).

---

## Risks

- **Real-piano monophonic accuracy may simply not be good enough** → Phase D defers. The
  plan tolerates this: Round 3 still delivers Phase C and the validation findings.
- **The Practice-page restructure is broad** (page structure + a lot of layout CSS) →
  keep it strictly chrome/layout, no engine changes; protect the single-clock playhead,
  the Wait Mode banner, live feedback, and E2E selectors.
- **88 DOM keys** (up from 37) → measure highlight/scroll performance; scroll the active
  octave into view rather than re-rendering.
- **Branch hygiene** → land Round 2 (Phase A/B) on `main` before branching Phase C.

---

## Definition of done for Round 3

Both phases pass their own acceptance criteria (§C.5, §D.5) independently, in order C then
D. Before declaring the round complete: run all tests, run the production build, and
manually verify acceptance scenarios A–E from `PIANO_SHADOW_GOAL.md` §27–§31 (a redesign
must not regress correctness), plus Phase C's three-page walkthrough and — if D0 passed —
Phase D's microphone Play Along walkthrough. Update `README.md` (Known limitations /
Roadmap) and `CHANGELOG.md` for both phases, and refresh the `doc/` screenshots. Tag
`v0.3.0`.

If D0 does not pass its decision checkpoint, Round 3 is done at the end of Phase C plus
the written `MICROPHONE_LAB_FINDINGS.md` addendum; note the deferral in `CHANGELOG.md` and
the Roadmap.
