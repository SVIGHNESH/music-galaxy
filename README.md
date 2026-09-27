# Music Galaxy

A GPU particle galaxy that moves with your music.
Runs in any modern browser, on desktop and mobile, with the same look everywhere.

## Requirements

- Node 20.19+ or 22.12+ (Vite 8)
- pnpm

## Develop

```sh
pnpm install
pnpm dev
```

Append `?renderer=webgl` to the URL to force the WebGL 2 fallback on a WebGPU-capable browser.

## Build

```sh
pnpm build
pnpm preview
```

## Roadmap

1. Static galaxy with bloom and orbit camera (done)
2. GPU compute simulation, 500k particles
3. Audio input: file, microphone or monitor device, tab or screen audio
4. Audio to visual mapping
5. Polish: black hole, palettes, UI, PWA
6. Deploy
