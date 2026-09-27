# Music Galaxy

A GPU particle galaxy that moves with your music.
Runs in any modern browser, on desktop and mobile, with the same look everywhere.

Created by Vighnesh Shukla.

## Requirements

- Node 20.19+ or 22.12+ (Vite 8)
- pnpm

## Develop

```sh
pnpm install
pnpm dev
```

## Sound sources

Use **+ Add sound** in the top-left corner:

- **Play a file**, or drop an audio file anywhere on the page.
- **Microphone or device** listens to the room, or to any input you pick.
On Linux, choose a *Monitor of …* device (PipeWire/PulseAudio) to react to whatever any app is playing.
- **Share a tab** (desktop Chrome/Edge) reacts to music playing in another tab.
Tick "Share tab audio" in the browser dialog.

Space plays or pauses a file.
Press `D` to show the analysis meter (bass, mid, treble, level, beats).

Each band has automatic gain, so a quiet microphone and a loud file drive the visuals equally.
Beats are detected from low-frequency spectral flux against an adaptive threshold.

## Testing flags

URL flags:

- `?renderer=webgl` forces the WebGL 2 fallback on a WebGPU-capable browser.
- `?stars=N` fixes the star count and turns off adaptive quality.

- `?debug` opens the analysis meter and keeps the stats visible on phones.

Click or tap the galaxy to send a test shockwave through the disc.

## How it looks the same everywhere

- The galaxy is generated from a fixed seed.
- The simulation runs in fixed 60Hz steps on the GPU, independent of display refresh rate.
- Star count adapts to the device: the app measures real frame rate at startup and steps down until it holds ~55fps, then remembers the result.
Per-star light scales with the budget so total brightness stays constant.
- The camera distance fits the screen aspect, so phones see the whole disc.

## Build

```sh
pnpm build
pnpm preview
```

## Roadmap

1. Static galaxy with bloom and orbit camera (done)
2. GPU compute simulation with adaptive star budget (done)
3. Audio input and analysis: file, microphone or monitor device, tab audio (done)
4. Audio to visual mapping
5. Polish: black hole, palettes, UI, PWA
6. Deploy
