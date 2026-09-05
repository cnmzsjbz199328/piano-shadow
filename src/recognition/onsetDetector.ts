/**
 * A minimal RMS-threshold onset detector used only to establish a ground-truth
 * onset time for the Lab's latency measurement (spec §36 "latency measurements").
 * Comparing a recognizer's own reported note onset against this gives the
 * recognizer's algorithmic latency, independent of human reaction time.
 */
export function detectOnsetTime(
  audio: Float32Array,
  sampleRate: number,
  thresholdRms = 0.02,
  windowSize = 512,
): number | null {
  for (let start = 0; start < audio.length; start += windowSize) {
    const end = Math.min(start + windowSize, audio.length);
    let sumSquares = 0;
    for (let i = start; i < end; i++) sumSquares += audio[i]! * audio[i]!;
    const rms = Math.sqrt(sumSquares / (end - start));
    if (rms >= thresholdRms) return start / sampleRate;
  }
  return null;
}
