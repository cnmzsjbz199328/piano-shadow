# Microphone Lab — Findings

Status: **experimental**. Nothing described here is wired into Practice. Per spec §36 and
`doc/NEXT_ROUND_REQUIREMENTS.md` B.3, this document is the explicit gate before any future
round considers building a real `MicrophoneAdapter` — the numbers below say "not yet."

## What was benchmarked

Two `NoteRecognizer` implementations (`src/recognition/`):

- **Pitchy (baseline)** — `PitchyRecognizer`, wrapping the `pitchy` npm package (MIT), an
  autocorrelation-based (McLeod Pitch Method) monophonic pitch detector. Strictly one note
  at a time by design.
- **Basic Pitch** — `BasicPitchRecognizer`, wrapping Spotify's `@spotify/basic-pitch`
  (Apache-2.0), a small convolutional neural network run via TensorFlow.js. Polyphonic-
  capable (can in principle detect chords), lazy-loaded so its ~1.8MB (TF.js + model) never
  touches the main app bundle — confirmed by `npm run build`'s chunk output, which puts it
  in its own chunk separate from the ~516KB main bundle.

A third candidate, **Transkun**, was investigated and dropped from this round (see
[Transkun](#transkun-dropped-from-this-round) below).

## Methodology

Two complementary measurements, both driven directly through the Lab UI's actual code path
(`/microphone-lab`) — not a separate mock:

1. **Synthetic-audio benchmark** (`src/recognition/benchmark.ts`, run via the Lab's
   "Run synthetic benchmark" button): nine known sine-wave tones (C3, G3, C4, E4, G4, A4,
   C5, E5, A5 — MIDI 48–81, 0.5s each, clean/noise-free, one at a time) are fed straight to
   each recognizer's `process(audio, sampleRate)`. This is deterministic and repeatable —
   unlike a live microphone, it doesn't depend on room noise, a physical piano's timbre, or
   my (the implementing agent's) inability to physically play a keyboard into a real
   microphone. It measures a **ceiling**: the easiest possible case (pure fundamental,
   no harmonics, no overlap, no noise).
2. **MIDI ground-truth comparison** (Lab section 3): built and functional — play a demo
   melody on a MIDI keyboard while the mic listens, then diff the mic-detected notes
   against the real key-press timestamps via `practice-engine`'s existing
   `evaluatePerformance`. This path could not be exercised with a real microphone/piano in
   this round (no physical audio input available to the implementing agent) — a real
   session is left for a human tester; see [Open gap](#open-gap-no-live-mic-session-yet).

Environment note: Basic Pitch needs `OfflineAudioContext` (for resampling to its required
22050Hz) and a real TensorFlow.js backend, neither available under Vitest/jsdom — its
numbers below come from running the benchmark in an actual Chromium tab, not the headless
unit-test run. `PitchyRecognizer` has no such dependency and is covered by both a
headless Vitest suite (`PitchyRecognizer.test.ts`, `benchmark.test.ts`) and the same
in-browser run, for cross-checking.

## Results (synthetic benchmark, 9 tones, one run)

| Recognizer | Accuracy | Mean latency (per 0.5s tone) |
|---|---|---|
| Pitchy (baseline) | 100% (9/9) | 23.2ms |
| Basic Pitch | 100% (9/9) | 1856.8ms |

Per-tone detail for Pitchy (from the headless Vitest run, `benchmark.test.ts`):

| Tone | Expected MIDI | Detected MIDI | Confidence | Processing time |
|---|---|---|---|---|
| C3 | 48 | 48 ✓ | 1.000 | 28.4ms (cold start) |
| G3 | 55 | 55 ✓ | 0.998 | 7.5ms |
| C4 | 60 | 60 ✓ | 0.999 | 7.5ms |
| E4 | 64 | 64 ✓ | 0.999 | 11.2ms |
| G4 | 67 | 67 ✓ | 0.999 | 7.6ms |
| A4 | 69 | 69 ✓ | 0.999 | 7.6ms |
| C5 | 72 | 72 ✓ | 0.999 | 7.5ms |
| E5 | 76 | 76 ✓ | 0.999 | 7.5ms |
| A5 | 81 | 81 ✓ | 1.000 | 7.3ms |

## Interpretation

- **Both recognizers are perfect on this ceiling case.** That's expected and not very
  informative on its own — a clean, monophonic, harmonic-free sine tone is the easiest
  input either algorithm will ever see. A real piano note has a fundamental plus many
  overtones, string/hammer noise, and (via a real microphone) room noise and reverb; a
  real player's notes overlap at phrase boundaries. None of that is exercised here. Treat
  100%/100% as "neither recognizer is fundamentally broken," not as "either is
  production-accurate."
- **Latency is the clear differentiator.** Pitchy processes a half-second clip in ~7-30ms
  (single-digit-ms after JIT warmup) — comfortably fast enough for a "live" feel. Basic
  Pitch takes ~1.9 **seconds** per clip — roughly 80x slower — because it runs a full
  neural network forward pass (STFT + CNN) rather than one autocorrelation. That rules out
  Basic Pitch for anything latency-sensitive as currently integrated; it would need
  batching/streaming optimization or a smaller model to be viable live, independent of its
  accuracy.
- **Polyphony is Basic Pitch's real advantage, untested here.** Pitchy is monophonic by
  construction — it cannot detect a chord, only ever the most prominent pitch. All nine
  benchmark tones were single notes, so this synthetic benchmark cannot show that
  difference. (Round 3 added a chord/interval benchmark — see the
  [2026-09-07 addendum](#addendum--2026-09-07-round-3-phase-d-gate): Pitchy resolves 0 of
  the chord tones.)
- **Onset-latency and MIDI-ground-truth numbers are not included above** — those need a
  real captured take (mic or MIDI+mic together) and could not be produced without a human
  physically playing a keyboard into a microphone in this round. The code paths for both
  (`detectOnsetTime`, Lab sections 1 and 3) are implemented, unit-tested
  (`onsetDetector.test.ts`), and were exercised end-to-end in a live browser tab up to the
  point of requesting microphone permission — see the open gap below.

## Transkun (dropped from this round)

Investigated as a third candidate per `doc/NEXT_ROUND_REQUIREMENTS.md` B.5. Its upstream
repository (`Yujia-Yan/Transkun`) is MIT-licensed — not a license blocker. However, there
is no official JS/npm package: only a community ONNX export
(`TuesdayCrowd/transkun-onnx` on Hugging Face) exists, and Transkun's own architecture
notes that its FFT front-end and semi-CRF Viterbi decode are **not** directly
ONNX-exportable — using it in-browser would mean hand-rolling that decode logic against an
unofficial, unversioned model export fetched from a third party, for a comparison that
`doc/NEXT_ROUND_REQUIREMENTS.md` B.2 doesn't actually require (only the baseline + Basic
Pitch are required deliverables). Per B.3's explicit escape hatch ("if it turns out ...
otherwise incompatible with this MIT-licensed app, drop it from this round's scope
entirely"), Transkun is out of scope for this round. A future round could reconsider it if
someone publishes an official, versioned JS-consumable build.

## Open gap: no live-mic session yet

I (the implementing agent) have no way to physically play a piano note into a real
microphone — every number above comes from synthetic audio or, for the MIDI-ground-truth
path, was verified for correctness (builds, typechecks, renders, and the code path was
driven up to the getUserMedia permission prompt in a real browser tab) but not exercised
with real captured audio. Before this round's findings can be considered complete for
real-world accuracy (as opposed to code-correctness), **a human needs to**:

1. Open `/microphone-lab`, grant microphone permission, and try "Free capture" with an
   actual piano (or voice/whistle) note — confirm the level meter responds and both
   recognizers return a sensible note.
2. Run the MIDI ground-truth comparison (section 3) with a real MIDI keyboard: play one of
   the three demo melodies, and check the resulting Pitch/Completeness scores are
   reasonable. Note that the ground-truth and mic timelines are only approximately
   synced (zeroed when mic capture becomes active) — a few hundred ms of constant
   setup-latency offset can show up as Timing-dimension error even when Pitch/Completeness
   are accurate; this is a known limitation of the sync approach, not a recognizer defect.
3. Record the real accuracy/latency numbers from that session as an addendum to this
   document.

## Conclusion

Per spec §36's explicit gate: **do not merge microphone input into the stable practice
path yet.** The infrastructure (permission flow, `AudioWorklet` capture, both recognizers,
latency measurement, confidence visualization, MIDI-ground-truth diffing via the existing
`practice-engine`) is built, tested, and demonstrated working end-to-end on synthetic
audio. What's missing before a `MicrophoneAdapter` becomes a real proposal is a live-mic
accuracy number against actual piano audio — the open gap above — plus, if that goes well,
a solution to Basic Pitch's ~1.9s latency (batching, a smaller model, or accepting Pitchy's
monophonic-only baseline for a first version).

---

## Addendum — 2026-09-07 (Round 3, Phase D gate)

`doc/ROUND_3_REQUIREMENTS.md` Phase D would promote Pitchy's monophonic baseline into a
real, experimental, opt-in `MicrophoneAdapter`. It is gated by **D0** (§D.1): a live
human microphone/real-piano validation session, plus one agent-side task that needs no
microphone. This addendum covers the agent-side task; the human session is still
outstanding (see [Open gap](#open-gap-no-live-mic-session-yet) — unchanged).

### Agent task done: chord/interval synthetic benchmark (§D.1.1)

`src/recognition/benchmark.ts` gained `benchmarkPolyphony()` +
`DEFAULT_BENCHMARK_CHORDS` — additive sine-wave chords (equal-amplitude, peak-normalised),
same deterministic/headless rigour as `PitchyRecognizer.test.ts`, covered by
`benchmark.test.ts` and surfaced in the Lab's "Run synthetic benchmark" section next to
the single-note table. Cases: `M3 (C4+E4)`, `P5 (C4+G4)`, `C major (C4+E4+G4)`,
`A minor (A3+C4+E4)`, `G7 (G3+B3+D4+F4)`.

**Pitchy (baseline) — headless run, deterministic:**

| Chord | Expected MIDIs | Pitchy detected | Chord tones resolved |
|---|---|---|---|
| M3 (C4+E4) | 60, 64 | 36 | 0 |
| P5 (C4+G4) | 60, 67 | 48 | 0 |
| C major (C4+E4+G4) | 60, 64, 67 | 36 | 0 |
| A minor (A3+C4+E4) | 57, 60, 64 | 26 | 0 |
| G7 (G3+B3+D4+F4) | 55, 59, 62, 65 | 31 | 0 |

Mean chord recall **0%**, max voices resolved **0**, `monophonicOnly = true`, mean
processing ~14ms. On a summed multi-pitch waveform the McLeod Pitch Method locks onto a
single spurious low "fundamental" (the periodicity of the beating envelope, an octave or
more below any real chord tone) — it never returns two of the chord's notes, and here
returned *none* of them. This is the expected monophonic failure mode, now measured:
**microphone chord / polyphonic practice stays out of scope** (`ROUND_3_REQUIREMENTS`
"Out of scope"). Basic Pitch's polyphonic numbers come from running the same benchmark in
a Chromium tab (it needs `OfflineAudioContext`); it is the polyphony-capable path, but its
~1.9s/clip latency (unchanged from the v0.2 findings) keeps it out of a live adapter.

### Still outstanding: the human D0 session (§D.1.2–4)

Not runnable by the agent — needs a person with a microphone and a MIDI keyboard to,
in `/lab`: grant mic permission, "Free capture" a real single piano note (confirm the
level meter responds and `PitchyRecognizer` returns a sensible note name), then run the
MIDI ground-truth comparison against a built-in demo melody, recording Pitchy's
pitch-accuracy rate, onset latency (ms), and missed/wrong-note rate on real piano audio.

**Decision checkpoint (§D.1.4):** proceed to Phase D.2 only if, on a clean single-note
melody, pitch-correct rate ≥ ~90% **and** onset latency < ~80ms. Otherwise Phase D is
deferred and Round 3 ships Phase C plus these findings.

### Round 3 outcome for Phase D

**Deferred.** The human D0 session has not been run, so the decision checkpoint cannot be
evaluated and no `MicrophoneAdapter` is built this round. `NoteInputAdapter` still has
only `VirtualKeyboardAdapter` and `WebMidiAdapter`; `practice-engine` still cannot import
`recognition/`. When someone runs the D0 session, append its numbers here and — if the
checkpoint passes — pick up Phase D.2 from `ROUND_3_REQUIREMENTS.md`.
