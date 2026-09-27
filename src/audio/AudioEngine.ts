export type SourceKind = 'file' | 'device' | 'tab';

export interface SourceInfo {
  kind: SourceKind;
  label: string;
  deviceId?: string;
}

type Listener = (source: SourceInfo | null) => void;

/**
 * Owns the AudioContext and whichever single input is live. Every source ends
 * in the same AnalyserNode, so analysis never knows where sound came from.
 */
export class AudioEngine {
  readonly fftSize = 2048;
  private ctx: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private stopCurrent: (() => void) | null = null;
  private listeners = new Set<Listener>();

  source: SourceInfo | null = null;
  /** Present only while a file is the source. */
  media: HTMLAudioElement | null = null;

  get analyser() {
    return this.analyserNode;
  }

  get sampleRate() {
    return this.ctx?.sampleRate ?? 48_000;
  }

  static get canShareTab() {
    return typeof navigator.mediaDevices?.getDisplayMedia === 'function' && !matchMedia('(pointer: coarse)').matches;
  }

  onChange(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Must run inside a user gesture the first time, or browsers keep audio suspended. */
  private async context() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.analyserNode = this.ctx.createAnalyser();
      this.analyserNode.fftSize = this.fftSize;
      // Analysis does its own smoothing at a fixed rate; keep raw frames here.
      this.analyserNode.smoothingTimeConstant = 0;
      this.analyserNode.minDecibels = -100;
      this.analyserNode.maxDecibels = -10;
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    return { ctx: this.ctx, analyser: this.analyserNode! };
  }

  async playFile(file: File) {
    const { ctx, analyser } = await this.context();
    this.stop();

    const url = URL.createObjectURL(file);
    const el = new Audio(url);
    el.crossOrigin = 'anonymous';
    const node = ctx.createMediaElementSource(el);
    node.connect(analyser);
    // Files are heard through the page, unlike mic/tab audio which is already audible.
    analyser.connect(ctx.destination);
    await el.play();

    this.media = el;
    const onEnded = () => this.emit();
    el.addEventListener('ended', onEnded);
    el.addEventListener('pause', onEnded);
    el.addEventListener('play', onEnded);

    this.stopCurrent = () => {
      el.pause();
      node.disconnect();
      analyser.disconnect();
      URL.revokeObjectURL(url);
      this.media = null;
    };
    this.setSource({ kind: 'file', label: file.name.replace(/\.[^.]+$/, '') });
  }

  async useDevice(deviceId?: string) {
    const { ctx, analyser } = await this.context();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        // Voice processing mangles music: it ducks, gates and re-levels the signal.
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    this.stop();
    const track = stream.getAudioTracks()[0];
    this.attachStream(ctx, analyser, stream);
    this.setSource({
      kind: 'device',
      label: track?.label || 'Microphone',
      deviceId: track?.getSettings().deviceId ?? deviceId,
    });
  }

  async shareTab() {
    const { ctx, analyser } = await this.context();
    // Chrome requires a video track to offer audio; it is dropped right away.
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    stream.getVideoTracks().forEach((t) => t.stop());
    if (stream.getAudioTracks().length === 0) {
      throw new Error('No audio was shared. Pick a tab and turn on "Share tab audio".');
    }
    this.stop();
    this.attachStream(ctx, analyser, stream);
    this.setSource({ kind: 'tab', label: stream.getAudioTracks()[0].label || 'Shared tab' });
  }

  private attachStream(ctx: AudioContext, analyser: AnalyserNode, stream: MediaStream) {
    const node = ctx.createMediaStreamSource(stream);
    // Not connected to the speakers: the sound is already playing elsewhere,
    // and routing a mic back out would feed back.
    node.connect(analyser);
    const tracks = stream.getAudioTracks();
    // The user can end sharing from browser UI; reflect that here.
    tracks.forEach((t) => t.addEventListener('ended', () => this.stop()));
    this.stopCurrent = () => {
      node.disconnect();
      stream.getTracks().forEach((t) => t.stop());
    };
  }

  async listDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'audioinput' && d.deviceId);
  }

  togglePlayback() {
    if (!this.media) return;
    if (this.media.paused) {
      if (this.media.ended) this.media.currentTime = 0;
      void this.ctx?.resume();
      void this.media.play();
    } else {
      this.media.pause();
    }
  }

  stop() {
    if (!this.stopCurrent) return;
    this.stopCurrent();
    this.stopCurrent = null;
    this.setSource(null);
  }

  private setSource(source: SourceInfo | null) {
    this.source = source;
    this.emit();
  }

  private emit() {
    this.listeners.forEach((fn) => fn(this.source));
  }
}
