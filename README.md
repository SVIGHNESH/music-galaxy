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

URL flags for testing:

- `?renderer=webgl` forces the WebGL 2 fallback on a WebGPU-capable browser.
- `?stars=N` fixes the star count and turns off adaptive quality.

Click, tap or press Space to send a test shockwave through the disc.

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
3. Audio input: file, microphone or monitor device, tab or screen audio
4. Audio to visual mapping
5. Polish: black hole, palettes, UI, PWA
6. Deploy
