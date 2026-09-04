# /goal — Piano Shadow Web MVP

## 0. Mission

Build a production-quality, browser-first piano learning web application that lets a learner follow a reference performance and receive precise feedback on pitch, timing, rhythm, duration, missed notes, extra notes, and overall performance.

The first implementation MUST focus on the Web version. Do NOT optimize for ESP32 yet. ESP32 compatibility should only influence clean interface boundaries so that a future device adapter can be added without rewriting the core practice engine.

The product concept is:

> A reference performance becomes a reusable learning template. The learner follows it, the system aligns the learner's performance against the reference, and the UI explains exactly what was correct or incorrect.

The MVP MUST be independently usable, testable, and extensible.

---

# 1. Product Principles

1. Browser-first.
2. Local-first wherever practical.
3. Deterministic scoring.
4. Clear separation between:
   - input capture
   - canonical music data
   - visualization
   - practice matching
   - scoring
5. Do not tightly couple business logic to a specific UI component.
6. Do not tightly couple practice logic to MIDI-only input.
7. Avoid premature backend dependencies.
8. Avoid premature microphone complexity in MVP.
9. Prefer proven libraries over custom reimplementation.
10. Every major feature must be demonstrably testable.

---

# 2. MVP Scope

The first deliverable MUST implement all of the following:

## 2.1 Reference source

Support importing a Standard MIDI File (`.mid` / `.midi`).

The imported file becomes the reference performance.

Required extracted information:

- MIDI note number
- note name
- onset time
- duration
- velocity if available
- track/channel if available
- tempo information if available

The application MUST normalize imported MIDI into the canonical internal model defined later in this document.

---

## 2.2 Practice input

Support two learner input methods:

### A. Virtual piano keyboard

The browser UI MUST include a playable piano keyboard for deterministic testing without any hardware.

Required:
- mouse/touch note input
- computer keyboard shortcut input
- visible pressed-key state
- note-on timestamp
- note-off timestamp

### B. Web MIDI input

If the browser supports Web MIDI:
- list available MIDI devices
- allow selecting one input
- capture note-on
- capture note-off
- capture velocity
- display connection status
- fail gracefully when Web MIDI is unavailable

Do not make Web MIDI mandatory for application startup.

---

## 2.3 Piano Roll

Display the reference MIDI as a scrolling or horizontally navigable Piano Roll.

Required:
- time axis
- pitch axis
- visible note blocks
- current playhead
- piano keyboard aligned to pitch rows
- zoom or scale control
- current note highlighting
- learner note overlay or post-performance overlay

The Piano Roll should remain smooth at normal MIDI file sizes.

Prefer a performant canvas/WebGL rendering approach if needed.

---

## 2.4 Playback

Provide reference playback.

Required controls:
- play
- pause
- stop
- seek
- restart
- tempo / playback speed
- metronome toggle
- count-in optional but strongly preferred

Playback timing and UI playhead MUST derive from the same authoritative clock.

Avoid independent timers that can drift.

---

# 3. Canonical Data Model

The application MUST NOT use UI state, raw MIDI events, MusicXML, or DOM elements as the source of truth for practice logic.

Use a canonical model similar to:

```ts
export type NoteSource =
  | "midi-file"
  | "midi-device"
  | "virtual-keyboard"
  | "microphone"
  | "audio-file"
  | "esp32";

export interface NoteEvent {
  id: string;
  midi: number;
  noteName: string;
  startTime: number;     // seconds from performance start
  duration: number;      // seconds
  velocity?: number;     // 0-127
  source: NoteSource;
  confidence?: number;   // reserved for microphone recognition
  channel?: number;
  track?: number;
  hand?: "left" | "right" | "unknown";
}
```

Also define:

```ts
export interface Performance {
  id: string;
  name: string;
  notes: NoteEvent[];
  duration: number;
  tempoMap?: TempoPoint[];
  sourceType: NoteSource;
  createdAt: string;
}
```

Do not introduce hidden alternative note models without a compelling reason.

All adapters MUST ultimately emit `NoteEvent` objects.

---

# 4. Practice Engine

This is the core product logic.

The practice engine MUST compare:

- expected `NoteEvent[]`
- actual `NoteEvent[]`

and produce explicit match results.

Use a model similar to:

```ts
export type MatchType =
  | "correct"
  | "wrong-note"
  | "missed"
  | "extra";

export interface NoteMatchResult {
  expected?: NoteEvent;
  actual?: NoteEvent;

  result: MatchType;

  pitchErrorSemitones?: number;
  onsetErrorMs?: number;
  durationErrorMs?: number;

  pitchScore: number;
  timingScore: number;
  durationScore: number;
}
```

---

# 5. Matching Requirements

DO NOT match notes purely by array index.

Example:

Reference:

```text
C D E F G
```

Learner:

```text
C D   F G
```

Correct result:

```text
C -> C : correct
D -> D : correct
E -> - : missed
F -> F : correct
G -> G : correct
```

Incorrect implementation:

```text
E -> F : wrong
F -> G : wrong
G -> - : missed
```

Implement sequence alignment.

For MVP, a dynamic-programming sequence alignment approach is acceptable.

The cost function SHOULD consider:

- pitch equality / pitch distance
- onset time distance
- insertion
- deletion

The algorithm MUST be deterministic.

Keep the matching algorithm in its own module with unit tests.

Suggested module:

```text
packages/practice-engine/src/SequenceAligner.ts
```

---

# 6. Timing Model

The product MUST distinguish between:

1. pitch correctness
2. absolute timing correctness
3. relative rhythm correctness
4. note duration correctness
5. completeness

Do not collapse everything into one unexplained score.

Recommended categories:

```text
Pitch Accuracy
Timing Accuracy
Rhythm Accuracy
Duration Accuracy
Completeness
Overall Score
```

Example:

```text
Pitch        96
Timing       78
Rhythm       91
Duration     84
Completeness 100
Overall      90
```

Every score MUST be explainable from note-level results.

---

# 7. Timing Tolerances

Implement configurable timing thresholds.

Suggested initial defaults:

```text
Perfect: |error| <= 60 ms
Good:    |error| <= 120 ms
Late/Early warning: |error| <= 250 ms
Miss / severe timing error: > 250 ms
```

These values MUST be constants/configuration, not scattered magic numbers.

The UI should be able to label:

- early
- late
- on time
- missed
- wrong note
- extra note

Do not hard-code language text inside the scoring algorithm.

---

# 8. Rhythm Analysis

Do not equate slower performance with incorrect rhythm.

MVP requirement:

Normalize learner timing against reference tempo or phrase duration before computing rhythm accuracy.

Example:

Reference:

```text
0.0, 0.5, 1.0, 2.0
```

Learner:

```text
0.0, 0.7, 1.4, 2.8
```

The learner is slower, but relative rhythmic spacing is equivalent.

The system SHOULD score rhythm significantly higher than absolute timing in this case.

Advanced DTW is NOT required for MVP, but the architecture MUST allow adding it later.

---

# 9. Practice Modes

MVP MUST contain:

## 9.1 Listen

Reference plays normally.

The UI highlights current notes.

No scoring.

## 9.2 Play Along

Reference continues to play.

Learner input is recorded and evaluated.

After completion, show full analysis.

Strongly preferred:
- lightweight live feedback
- full detailed feedback after completion

## 9.3 Wait Mode

Strongly preferred for MVP.

Reference playback pauses at target note/chord until the learner plays the expected input.

At minimum, support monophonic wait points.

Do not block the entire MVP if chord-aware Wait Mode is significantly more complex.

---

# 10. Feedback UI

For each expected note, support states such as:

```text
correct
early
late
wrong note
missed
```

For learner-only notes:

```text
extra
```

Example user-facing feedback:

```text
Expected: D4
Played:   D4
Timing:   +183 ms late
Result:   Correct pitch, late timing
```

Wrong-note example:

```text
Expected: G4
Played:   F4
Pitch error: -2 semitones
```

The UI MUST make mistakes visually understandable without requiring technical knowledge.

---

# 11. Results View

At the end of a practice attempt, show:

- Overall score
- Pitch score
- Timing score
- Rhythm score
- Duration score
- Completeness
- correct count
- missed count
- wrong-note count
- extra-note count

Also show a timeline / Piano Roll overlay where:

- reference notes are visible
- learner notes are visible
- note-level result state is visible

Clicking or hovering a note SHOULD reveal exact details.

---

# 12. Architecture

Recommended monorepo:

```text
piano-shadow/
│
├── apps/
│   └── web/
│       └── src/
│           ├── components/
│           │   ├── piano/
│           │   ├── piano-roll/
│           │   ├── sheet-music/
│           │   ├── transport/
│           │   ├── feedback/
│           │   └── common/
│           │
│           ├── pages/
│           │   ├── HomePage.tsx
│           │   ├── PracticePage.tsx
│           │   ├── ResultsPage.tsx
│           │   └── ExperimentsPage.tsx
│           │
│           ├── stores/
│           └── services/
│
├── packages/
│   ├── music-model/
│   ├── midi/
│   ├── practice-engine/
│   ├── playback-engine/
│   ├── device-adapters/
│   └── quantization/
│
└── tests/
```

A simpler structure is acceptable if it preserves the same module boundaries.

Do not over-engineer workspace tooling if it slows delivery.

---

# 13. Recommended Technical Stack

Preferred:

```text
React
TypeScript
Vite
Zustand
Web Audio API
Web MIDI API
Tone.js or equivalent stable audio timing layer
PixiJS or another performant canvas renderer for Piano Roll
Vitest
Playwright
IndexedDB for local persistence
```

Using a different library is acceptable only when there is a clear technical reason.

Do not add a backend unless required for the MVP.

The MVP SHOULD be deployable as a static site.

Target:
- local development
- GitHub Pages compatible where feasible
- Cloudflare Pages compatible
- Vercel static deployment compatible

---

# 14. Open Source Reuse Policy

The implementation SHOULD learn from mature existing projects but MUST respect license boundaries.

Primary reference:

```text
bach-to-basics
```

Use as architectural/UI reference and reuse MIT-compatible code where appropriate.

Useful concepts to study:
- Piano Roll
- Piano keyboard
- transport controls
- playback synchronization
- Web MIDI
- Wait Mode
- tempo controls

Secondary reference:

```text
piano-practice
```

Study:
- Wait Mode
- Playalong Mode
- practice flow
- attempt history
- real-time note validation
- debug event logging

Microphone benchmark reference:

```text
Floopdible/piano_trainer
```

IMPORTANT:

This repository is GPL-3.0.

DO NOT copy GPL source code into the main application unless explicitly approved.

It may be used to:
- benchmark recognition approaches
- understand model behavior
- evaluate UX
- compare algorithms

Prefer implementing microphone recognition through independently licensed libraries/models.

---

# 15. Microphone Recognition

Microphone pitch recognition is NOT part of the first mandatory MVP.

However, prepare an experimental adapter interface:

```ts
export interface NoteRecognizer {
  initialize(): Promise<void>;

  process(
    audio: Float32Array,
    sampleRate: number
  ): Promise<DetectedNote[]>;
}
```

Possible future implementations:

```text
PitchyRecognizer
BasicPitchRecognizer
TranskunRecognizer
```

Do not couple PracticeEngine directly to any recognition model.

The practice engine receives `NoteEvent[]` only.

---

# 16. Future "Teach Mode"

Do NOT make this a blocking MVP requirement.

But the architecture MUST support the future workflow:

```text
Record Reference
        ↓
Teacher plays piano
        ↓
Audio Recording
        ↓
Transcription
        ↓
NoteEvent[]
        ↓
Tempo estimation
        ↓
Rhythm quantization
        ↓
Reference Performance
        ↓
Student Practice
```

Future system must preserve both:

```text
Raw performance timing
```

and:

```text
Quantized musical timing
```

Do not design the data model in a way that prevents this.

---

# 17. Device Adapter Boundary

Create a clear adapter abstraction.

Example:

```ts
export interface NoteInputAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  onNoteStart(
    callback: (note: NoteEvent) => void
  ): void;

  onNoteEnd(
    callback: (note: NoteEvent) => void
  ): void;
}
```

Initial implementations:

```text
VirtualKeyboardAdapter
WebMidiAdapter
```

Future:

```text
MicrophoneAdapter
Esp32Adapter
```

ESP32 support MUST NOT be implemented in the first MVP unless all Web acceptance criteria are already complete.

---

# 18. Persistence

Use local persistence.

At minimum persist:

- imported songs
- user settings
- practice attempts
- score summaries
- last selected MIDI input
- playback speed

IndexedDB is preferred for structured data.

Do not require login.

Do not require cloud storage.

---

# 19. Performance Requirements

The UI MUST remain responsive during:

- MIDI parsing
- playback
- note input
- scoring
- Piano Roll animation

Target:
- 60 FPS rendering where practical
- no visible note input lag
- playback/UI drift should remain visually negligible during normal songs

Heavy parsing SHOULD use a Worker if it causes main-thread blocking.

---

# 20. Accessibility / UX Quality

Required:

- keyboard-operable main controls
- visible focus states
- clear empty states
- actionable error messages
- responsive layout
- usable desktop experience first
- tablet layout strongly preferred

Do not use placeholder buttons that do nothing.

Do not ship dead navigation.

Do not ship unexplained debug-only controls in the production UI.

---

# 21. Testing Requirements

Testing is mandatory.

## 21.1 Unit tests

Must cover:

### Sequence alignment

Cases:

```text
exact match
one missed note
one extra note
one wrong note
multiple consecutive misses
repeated notes
same pitch with different timing
```

### Timing

Cases:

```text
on-time
early
late
global slower tempo
global faster tempo
```

### Scoring

Scores MUST be deterministic.

The same inputs MUST always produce the same result.

---

## 21.2 Integration tests

Test:

```text
MIDI import
→ canonical NoteEvent[]
→ playback
→ simulated learner input
→ matching
→ score
```

---

## 21.3 End-to-end tests

Using Playwright or equivalent:

1. Open app
2. Load sample MIDI
3. Start practice
4. Simulate note input
5. Finish attempt
6. Confirm results screen
7. Confirm score and error breakdown appear

---

# 22. Built-in Demo Assets

Include at least one public-domain or programmatically generated demo melody.

Recommended:

```text
C4 D4 E4 F4 G4
```

and a slightly rhythmic example.

Do not include copyrighted commercial song files without confirmed permission.

The app MUST be testable immediately after install without requiring the user to find their own MIDI file.

---

# 23. Developer Experience

The project MUST run with a small number of commands.

Expected:

```bash
npm install
npm run dev
npm run test
npm run build
```

If using pnpm:

```bash
pnpm install
pnpm dev
pnpm test
pnpm build
```

Document the exact commands.

There MUST be no undocumented manual setup step for the mandatory MVP.

---

# 24. README Requirements

README MUST contain:

- product description
- screenshot or GIF if practical
- implemented features
- architecture overview
- installation
- development
- build
- testing
- browser compatibility
- Web MIDI limitations
- project structure
- license
- future roadmap

---

# 25. Quality Rules

Do NOT:

- implement note matching by simple array index
- hide scoring logic inside React components
- mix raw MIDI parsing with visual rendering logic
- use global mutable singleton state for performance data
- scatter timing constants throughout the codebase
- silently ignore note-off events
- silently swallow MIDI permission/device errors
- make the app depend on a connected MIDI keyboard
- introduce a backend for features that work locally
- copy GPL-3.0 code into the main codebase
- optimize for ESP32 before Web MVP completion
- claim microphone transcription works before it is actually benchmarked
- mark placeholder or mocked functionality as complete

---

# 26. Required Diagnostic Mode

Implement an optional developer/debug panel.

It SHOULD expose:

```text
current playhead time
active reference notes
last MIDI event
learner active notes
selected input device
matching decisions
timing delta
score changes
```

This is important for debugging timing problems.

The debug panel MUST be hidden by default in the normal product UI.

---

# 27. Acceptance Scenario A — Perfect Performance

Reference:

```text
C4 @ 0.0s
D4 @ 0.5s
E4 @ 1.0s
G4 @ 2.0s
```

Learner reproduces all notes within perfect timing tolerance.

Expected:

```text
Pitch score near 100
Timing score near 100
Rhythm score near 100
Completeness 100
No missed notes
No wrong notes
No extra notes
```

---

# 28. Acceptance Scenario B — Missing Note

Reference:

```text
C D E F G
```

Learner:

```text
C D F G
```

Expected:

```text
E = missed
F matches F
G matches G
```

The implementation FAILS acceptance if later notes become incorrectly shifted.

---

# 29. Acceptance Scenario C — Wrong Note

Reference:

```text
C4 D4 E4
```

Learner:

```text
C4 D4 F4
```

Expected:

```text
C4 correct
D4 correct
E4 expected / F4 played
wrong-note
pitch error = +1 semitone
```

---

# 30. Acceptance Scenario D — Slower but Rhythmically Correct

Reference onset:

```text
0.0
0.5
1.0
2.0
```

Learner onset:

```text
0.0
0.7
1.4
2.8
```

Expected:

- Timing score lower than perfect
- Rhythm score remains high
- Pitch unaffected

The implementation FAILS acceptance if rhythm is scored as completely wrong solely because the learner played at a slower global tempo.

---

# 31. Acceptance Scenario E — Extra Note

Reference:

```text
C D E
```

Learner:

```text
C D D# E
```

Expected:

```text
D# = extra
E still matches E
```

---

# 32. Deliverables

The Agent MUST deliver:

1. Working source code
2. `README.md`
3. architecture documentation
4. tests
5. built-in demo MIDI
6. successful production build
7. no TypeScript compile errors
8. no failing mandatory tests
9. concise changelog / implementation summary
10. clear list of known limitations

Strongly preferred:

11. screenshot(s)
12. short demo GIF/video
13. deployment config
14. hosted preview URL if the environment permits deployment

---

# 33. Definition of Done

The MVP is DONE only when all of these are true:

- app launches successfully
- sample MIDI loads
- Piano Roll renders correctly
- reference playback works
- playhead remains synchronized
- virtual keyboard works
- Web MIDI works where supported
- user attempt is recorded
- sequence alignment works
- missed notes do not shift the remaining sequence
- extra notes do not shift the remaining sequence
- wrong notes are explicitly identified
- early/late timing is shown
- rhythm and absolute timing are evaluated separately
- results page shows category scores
- results overlay shows reference vs learner performance
- local practice result persistence works
- tests pass
- production build passes
- README is complete

If any item above is missing, do not declare the goal complete.

---

# 34. Implementation Order

Follow this sequence unless there is a strong technical reason not to:

## Phase 1 — Foundation

- initialize project
- canonical music model
- MIDI parser
- sample MIDI
- Piano Roll
- playback engine

## Phase 2 — Input

- virtual keyboard
- Web MIDI adapter
- performance recorder

## Phase 3 — Practice Engine

- sequence alignment
- timing analyzer
- scoring engine
- unit tests

## Phase 4 — Practice UX

- Listen mode
- Play Along mode
- feedback
- Results view

## Phase 5 — Quality

- persistence
- debug panel
- E2E tests
- browser fallback behavior
- performance cleanup
- README

## Phase 6 — Optional

Only after all mandatory acceptance criteria pass:

- Wait Mode
- A/B loop
- metronome
- count-in
- richer Piano Roll overlays
- microphone experiment page

---

# 35. First Release Boundary

Version target:

```text
v0.1 Web Practice MVP
```

Must NOT attempt to solve all future features.

Explicitly out of scope for v0.1:

- production-grade polyphonic microphone transcription
- automatic teacher audio transcription
- automatic sheet music generation
- optical music recognition
- account system
- cloud sync
- social features
- ESP32 firmware
- BLE/Wi-Fi ESP32 integration
- mobile native app
- AI lesson recommendations

These belong to later milestones.

---

# 36. Next Milestone After v0.1

After v0.1 passes all acceptance criteria:

```text
v0.2 Microphone Lab
```

Goals:

- microphone permission flow
- audio capture
- single-note pitch detection baseline
- Basic Pitch benchmark
- latency measurements
- confidence visualization
- compare microphone output against MIDI ground truth

Do not merge experimental microphone code into the stable practice path until accuracy and latency are measured.

---

# 37. Product Direction

The long-term differentiator is NOT simply:

> "display MIDI notes."

It is:

> "Turn a reference performance into a reusable practice template, then explain exactly how the learner differs from that reference."

Future flow:

```text
Teacher performance
       ↓
Capture / transcription
       ↓
Reference Performance
       ↓
Student performance
       ↓
Alignment
       ↓
Pitch + Rhythm + Timing + Duration analysis
       ↓
Actionable feedback
```

Protect this architecture throughout implementation.

---

# 38. Final Agent Instruction

Act as a senior frontend/audio application engineer.

Do not optimize only for a visually impressive demo.

Prioritize:

1. correctness
2. deterministic timing behavior
3. robust note matching
4. clean architecture
5. testability
6. maintainability
7. usable UX
8. visual polish

When forced to choose between a flashy feature and a correctly tested core practice engine, choose the core practice engine.

Before declaring completion:

- run all tests
- run the production build
- manually verify the acceptance scenarios
- document known limitations
- verify no mandatory feature is mocked or placeholder-only
