/**
 * Reusable microphone permission + audio capture for the recognition surface.
 * The adapter layer owns how these samples become NoteInputAdapter events.
 *
 * Captures via `AudioWorkletNode` (not the deprecated `ScriptProcessorNode`). The
 * worklet's processor is loaded from a Blob URL built from an inline source string
 * rather than a separate asset file — this avoids needing Vite worklet-asset config
 * or new ESLint globals for `registerProcessor`/`AudioWorkletProcessor`, which the
 * project's plain-`.js` lint block doesn't otherwise grant.
 *
 * Permission denial and device-loss are never silently swallowed (spec §25, same
 * rule the app already applies to Web MIDI): both surface as a status change plus an
 * error the caller can display.
 */

export type CaptureStatus = 'idle' | 'requesting-permission' | 'capturing' | 'stopped' | 'error';

export class MicrophoneCaptureError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'MicrophoneCaptureError';
  }
}

const PROCESSOR_NAME = 'pcm-capture-processor';

const WORKLET_SOURCE = `
class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length > 0) {
      this.port.postMessage(channel.slice());
    }
    return true;
  }
}
registerProcessor(${JSON.stringify(PROCESSOR_NAME)}, PcmCaptureProcessor);
`;

export interface MicrophoneCaptureOptions {
  /** Called on every captured frame (~every 128 samples) with its RMS level, 0-1ish, for a live meter. */
  onLevel?: (rms: number) => void;
  /** Called when capture status changes, in particular a device-loss 'error' mid-capture. */
  onStatusChange?: (status: CaptureStatus, error?: MicrophoneCaptureError) => void;
  /** Rolling buffer cap in seconds; oldest audio is dropped beyond this. Default 10s. */
  maxBufferSeconds?: number;
}

export class MicrophoneCapture {
  status: CaptureStatus = 'idle';

  private readonly onLevel?: (rms: number) => void;
  private readonly onStatusChange?: (status: CaptureStatus, error?: MicrophoneCaptureError) => void;
  private readonly maxBufferSeconds: number;

  private audioContext: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private chunks: Float32Array[] = [];
  private totalSamples = 0;

  constructor(options: MicrophoneCaptureOptions = {}) {
    this.onLevel = options.onLevel;
    this.onStatusChange = options.onStatusChange;
    this.maxBufferSeconds = options.maxBufferSeconds ?? 10;
  }

  private setStatus(status: CaptureStatus, error?: MicrophoneCaptureError): void {
    this.status = status;
    this.onStatusChange?.(status, error);
  }

  get sampleRate(): number {
    if (!this.audioContext) throw new Error('MicrophoneCapture.sampleRate read before start()');
    return this.audioContext.sampleRate;
  }

  /** Requests mic permission and starts capturing. Throws MicrophoneCaptureError on denial/failure. */
  async start(): Promise<void> {
    this.setStatus('requesting-permission');

    if (!navigator.mediaDevices?.getUserMedia) {
      const error = new MicrophoneCaptureError('This browser does not support microphone capture (getUserMedia unavailable).');
      this.setStatus('error', error);
      throw error;
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const error = new MicrophoneCaptureError('Microphone permission was denied, or no microphone is available.', { cause: err });
      this.setStatus('error', error);
      throw error;
    }

    try {
      this.audioContext = new AudioContext();
      const workletUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
      try {
        await this.audioContext.audioWorklet.addModule(workletUrl);
      } finally {
        URL.revokeObjectURL(workletUrl);
      }

      this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
      this.workletNode = new AudioWorkletNode(this.audioContext, PROCESSOR_NAME);
      this.workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => this.appendFrame(event.data);
      this.sourceNode.connect(this.workletNode);
      // Intentionally not connected to `destination` -- we only capture, never echo mic audio back out.

      for (const track of this.stream.getAudioTracks()) {
        track.addEventListener('ended', () => {
          const error = new MicrophoneCaptureError('The microphone was disconnected or lost during capture.');
          this.setStatus('error', error);
        });
      }

      this.chunks = [];
      this.totalSamples = 0;
      this.setStatus('capturing');
    } catch (err) {
      const error = new MicrophoneCaptureError('Failed to start audio capture.', { cause: err });
      this.setStatus('error', error);
      throw error;
    }
  }

  private appendFrame(frame: Float32Array): void {
    let sumSquares = 0;
    for (let i = 0; i < frame.length; i++) sumSquares += frame[i]! * frame[i]!;
    this.onLevel?.(Math.sqrt(sumSquares / frame.length));

    this.chunks.push(frame);
    this.totalSamples += frame.length;

    const maxSamples = this.maxBufferSeconds * (this.audioContext?.sampleRate ?? 44100);
    while (this.totalSamples > maxSamples && this.chunks.length > 1) {
      const dropped = this.chunks.shift()!;
      this.totalSamples -= dropped.length;
    }
  }

  /** The captured audio so far, flattened into one buffer, and the sample rate it was captured at. */
  getBuffer(): { audio: Float32Array; sampleRate: number } {
    const audio = new Float32Array(this.totalSamples);
    let offset = 0;
    for (const chunk of this.chunks) {
      audio.set(chunk, offset);
      offset += chunk.length;
    }
    return { audio, sampleRate: this.audioContext?.sampleRate ?? 44100 };
  }

  /** Clears the rolling buffer without stopping capture (e.g. before a fresh take). */
  clearBuffer(): void {
    this.chunks = [];
    this.totalSamples = 0;
  }

  async stop(): Promise<void> {
    this.workletNode?.disconnect();
    this.sourceNode?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    await this.audioContext?.close();
    this.audioContext = null;
    this.stream = null;
    this.sourceNode = null;
    this.workletNode = null;
    this.setStatus('stopped');
  }
}
