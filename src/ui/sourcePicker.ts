import { AudioEngine, type SourceInfo, type SourceKind } from '../audio/AudioEngine';

const STORAGE_KEY = 'music-galaxy:source';

const icons = {
  file: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8 14.5V4.8l8-1.8v9.7" /><circle cx="5.8" cy="14.5" r="2.2" /><circle cx="13.8" cy="12.7" r="2.2" /></svg>',
  device:
    '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="7" y="2.5" width="6" height="10" rx="3" /><path d="M4.5 10a5.5 5.5 0 0 0 11 0M10 15.5v2" /></svg>',
  tab: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="4" width="15" height="12" rx="2" /><path d="M2.5 7.5h15M7 4v3.5" /></svg>',
  play: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6.5 4.5v11l9-5.5z" class="fill" /></svg>',
  pause: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 4.5h2.6v11H6zM11.4 4.5H14v11h-2.6z" class="fill" /></svg>',
  close: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9" /></svg>',
};

function loadLast(): { kind: SourceKind; deviceId?: string } | null {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
  } catch {
    return null;
  }
}

function saveLast(source: SourceInfo) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ kind: source.kind, deviceId: source.deviceId }));
  } catch {
    // Remembering the choice is a convenience only.
  }
}

function describeError(err: unknown) {
  const e = err as { name?: string; message?: string };
  if (e?.name === 'NotAllowedError') return 'Permission was blocked. Allow it from the address bar and try again.';
  if (e?.name === 'NotFoundError') return 'No audio input was found on this device.';
  if (e?.name === 'NotReadableError') return 'That input is busy in another app.';
  return e?.message || 'Could not start that audio source.';
}

/** Top-left control: pick where sound comes from, then show what's live. */
export class SourcePicker {
  private root: HTMLElement;
  private panel: HTMLElement;
  private live: HTMLElement;
  private error: HTMLElement;
  private deviceSelect: HTMLSelectElement;
  private fileInput: HTMLInputElement;
  private dropZone: HTMLElement;
  private last = loadLast();

  constructor(
    host: HTMLElement,
    private engine: AudioEngine,
  ) {
    const isLinux = /linux/i.test(navigator.userAgent) && !/android/i.test(navigator.userAgent);
    host.innerHTML = `
      <div class="audio" data-state="idle">
        <button class="pill audio-trigger" type="button" aria-expanded="false" aria-controls="audio-panel">
          <span class="plus" aria-hidden="true">+</span> Add sound
        </button>

        <div class="pill audio-live" hidden>
          <span class="live-dot" aria-hidden="true"></span>
          <button class="live-name" type="button" aria-label="Change audio source"></button>
          <button class="icon-btn live-toggle" type="button" aria-label="Pause" hidden></button>
          <button class="icon-btn live-stop" type="button" aria-label="Stop audio">${icons.close}</button>
        </div>

        <div class="audio-panel" id="audio-panel" role="group" aria-label="Audio source" hidden>
          <button class="option" type="button" data-kind="file">
            ${icons.file}<span><b>Play a file</b><small>or drop one anywhere</small></span>
          </button>
          <button class="option" type="button" data-kind="device">
            ${icons.device}<span><b>Microphone or device</b><small>the room, or any input device</small></span>
          </button>
          <label class="device-row" hidden>
            <span class="sr-only">Input device</span>
            <select class="device-select"></select>
          </label>
          ${
            AudioEngine.canShareTab
              ? `<button class="option" type="button" data-kind="tab">
                  ${icons.tab}<span><b>Share a tab</b><small>music playing in another tab</small></span>
                </button>`
              : ''
          }
          ${isLinux ? '<p class="tip">On Linux, choose a <em>Monitor of …</em> device to react to any app\'s sound.</p>' : ''}
          <p class="audio-error" role="alert" hidden></p>
        </div>

        <input class="file-input" type="file" accept="audio/*" hidden />
      </div>
      <div class="drop-zone" hidden><p>Drop to play</p></div>`;

    this.root = host.querySelector('.audio')!;
    this.panel = host.querySelector('.audio-panel')!;
    this.live = host.querySelector('.audio-live')!;
    this.error = host.querySelector('.audio-error')!;
    this.deviceSelect = host.querySelector('.device-select')!;
    this.fileInput = host.querySelector('.file-input')!;
    this.dropZone = host.querySelector('.drop-zone')!;

    this.markLastUsed();
    this.bind();
    engine.onChange((s) => this.render(s));
  }

  private bind() {
    const trigger = this.root.querySelector<HTMLButtonElement>('.audio-trigger')!;
    trigger.addEventListener('click', () => this.setOpen(!this.root.classList.contains('is-open')));
    this.root.querySelector('.live-name')!.addEventListener('click', () => this.setOpen(!this.root.classList.contains('is-open')));
    this.root.querySelector('.live-stop')!.addEventListener('click', () => this.engine.stop());
    this.root.querySelector('.live-toggle')!.addEventListener('click', () => this.engine.togglePlayback());

    this.panel.addEventListener('click', (e) => {
      const kind = (e.target as HTMLElement).closest<HTMLElement>('.option')?.dataset.kind as SourceKind | undefined;
      if (kind === 'file') this.fileInput.click();
      if (kind === 'device') void this.run(() => this.engine.useDevice(this.last?.kind === 'device' ? this.last.deviceId : undefined));
      if (kind === 'tab') void this.run(() => this.engine.shareTab());
    });

    this.deviceSelect.addEventListener('change', () => {
      void this.run(() => this.engine.useDevice(this.deviceSelect.value));
    });

    this.fileInput.addEventListener('change', () => {
      const file = this.fileInput.files?.[0];
      if (file) void this.run(() => this.engine.playFile(file));
      this.fileInput.value = '';
    });

    document.addEventListener('pointerdown', (e) => {
      if (this.root.classList.contains('is-open') && !this.root.contains(e.target as Node)) this.setOpen(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.setOpen(false);
    });

    // Whole-window drop target; a counter handles dragenter/leave on children.
    let depth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files');
    addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return;
      depth++;
      this.dropZone.hidden = false;
    });
    addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) this.dropZone.hidden = true;
    });
    addEventListener('dragover', (e) => {
      if (hasFiles(e)) e.preventDefault();
    });
    addEventListener('drop', (e) => {
      e.preventDefault();
      depth = 0;
      this.dropZone.hidden = true;
      const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('audio/') || /\.(mp3|wav|ogg|flac|m4a|aac|opus|webm)$/i.test(f.name));
      if (file) void this.run(() => this.engine.playFile(file));
      else {
        this.showError('That file is not audio.');
        this.setOpen(true);
      }
    });
  }

  private async run(start: () => Promise<void>) {
    this.showError(null);
    this.root.dataset.state = 'busy';
    try {
      await start();
      this.setOpen(false);
      await this.refreshDevices();
    } catch (err) {
      this.showError(describeError(err));
      this.setOpen(true);
    } finally {
      this.root.dataset.state = this.engine.source ? 'live' : 'idle';
    }
  }

  /** Device labels are only exposed after permission, so the list fills in lazily. */
  private async refreshDevices() {
    if (this.engine.source?.kind !== 'device') return;
    const devices = await this.engine.listDevices();
    const row = this.deviceSelect.parentElement!;
    row.hidden = devices.length < 2;
    this.deviceSelect.innerHTML = devices
      .map((d, i) => `<option value="${d.deviceId}">${escapeHtml(d.label || `Input ${i + 1}`)}</option>`)
      .join('');
    if (this.engine.source.deviceId) this.deviceSelect.value = this.engine.source.deviceId;
  }

  private render(source: SourceInfo | null) {
    const trigger = this.root.querySelector<HTMLElement>('.audio-trigger')!;
    trigger.hidden = !!source;
    this.live.hidden = !source;
    this.root.dataset.state = source ? 'live' : 'idle';
    if (!source) {
      this.deviceSelect.parentElement!.hidden = true;
      return;
    }

    saveLast(source);
    this.last = { kind: source.kind, deviceId: source.deviceId };
    this.markLastUsed();

    this.live.dataset.kind = source.kind;
    const name = this.live.querySelector<HTMLElement>('.live-name')!;
    name.innerHTML = `${icons[source.kind]}<span>${escapeHtml(source.label)}</span>`;
    name.title = source.label;

    const toggle = this.live.querySelector<HTMLButtonElement>('.live-toggle')!;
    const media = this.engine.media;
    toggle.hidden = !media;
    if (media) {
      toggle.innerHTML = media.paused ? icons.play : icons.pause;
      toggle.setAttribute('aria-label', media.paused ? 'Play' : 'Pause');
      this.live.classList.toggle('is-paused', media.paused);
    } else {
      this.live.classList.remove('is-paused');
    }
  }

  private markLastUsed() {
    this.panel.querySelectorAll<HTMLElement>('.option').forEach((el) => {
      el.classList.toggle('is-last', el.dataset.kind === this.last?.kind);
    });
  }

  private setOpen(open: boolean) {
    this.panel.hidden = !open;
    this.root.querySelector('.audio-trigger')!.setAttribute('aria-expanded', String(open));
    this.root.classList.toggle('is-open', open);
  }

  private showError(message: string | null) {
    this.error.hidden = !message;
    this.error.textContent = message ?? '';
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
