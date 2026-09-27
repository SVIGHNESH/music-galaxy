import '@fontsource/syne/800.css';
import '@fontsource/geist-mono/400.css';
import './style.css';

import {
  ACESFilmicToneMapping,
  PerspectiveCamera,
  RenderPipeline,
  Scene,
  WebGPURenderer,
  type TextureNode,
} from 'three/webgpu';
import { pass, uniform } from 'three/tsl';
import { afterImage } from 'three/addons/tsl/display/AfterImageNode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { AudioAnalysis } from './audio/analysis';
import { AudioEngine } from './audio/AudioEngine';
import { FixedClock } from './core/clock';
import { pickQuality, QualityGovernor } from './core/tier';
import { finalPass } from './galaxy/finalPass';
import { Galaxy } from './galaxy/Galaxy';
import { Palette } from './galaxy/palette';
import { Reactor, SILENT } from './galaxy/Reactor';
import { SpectrumRing } from './galaxy/SpectrumRing';
import { DebugMeter } from './ui/debugMeter';
import { Hud } from './ui/hud';
import { SourcePicker } from './ui/sourcePicker';
import { ViewControls } from './ui/viewControls';

async function start() {
  const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
  const hud = new Hud(document.querySelector('#hud')!);

  // ?renderer=webgl forces the fallback path so it can be checked on WebGPU machines.
  const forceWebGL = new URLSearchParams(location.search).get('renderer') === 'webgl';
  const renderer = new WebGPURenderer({ canvas, antialias: false, forceWebGL });
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.setClearColor(0x04050b, 1);
  await renderer.init();

  const scene = new Scene();
  const FOV = 50;
  const camera = new PerspectiveCamera(FOV, innerWidth / innerHeight, 0.05, 400);
  camera.position.set(0, 4.2, 10.5);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.enablePan = false;
  controls.minDistance = 2.5;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.25;

  const isWebGPU = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
  const palette = new Palette();
  const quality = pickQuality(isWebGPU);
  const baseDpr = Math.min(devicePixelRatio, 2);
  renderer.setPixelRatio(baseDpr * quality.scale);
  let galaxy = new Galaxy(palette, { count: quality.stars });
  scene.add(galaxy);

  // Step down if this device can't hold the frame rate. Same seed and light
  // compensation, so the galaxy looks the same, just sparser and softer.
  const governor = new QualityGovernor(isWebGPU, quality, ({ stars, scale }) => {
    renderer.setPixelRatio(baseDpr * scale);
    if (stars !== galaxy.params.count) {
      scene.remove(galaxy);
      galaxy.dispose();
      galaxy = new Galaxy(palette, { count: stars });
      scene.add(galaxy);
    }
    hud.setInfo({ backend: isWebGPU ? 'WebGPU' : 'WebGL 2', stars });
  });

  const ring = new SpectrumRing(palette);
  scene.add(ring);

  // Post chain: trails -> bloom -> one fused pass for bloom mix, drop flash
  // and colour split.
  const fx = { trail: uniform(0), aberration: uniform(0), whiteout: uniform(0) };
  const pipeline = new RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  const trails = afterImage(scenePass.getTextureNode('output'), fx.trail);
  const trailTexture = trails.getTextureNode();
  const bloomPass = bloom(trailTexture, 0.9, 0.55, 0.05);
  // @types/three still calls this getTexture(); the runtime method is getTextureNode().
  const bloomTexture = (bloomPass as unknown as { getTextureNode(): TextureNode }).getTextureNode();
  pipeline.outputNode = finalPass(trailTexture, bloomTexture, fx.aberration, fx.whiteout);
  const reactor = new Reactor(camera, FOV, { bloom: bloomPass, ...fx }, ring);
  if (new URLSearchParams(location.search).has('debug')) {
    Object.assign(window, { galaxyDebug: { ring, reactor, fx, camera, renderer, scene, get galaxy() { return galaxy; } } });
  }
  controls.addEventListener('start', () => (reactor.interacting = true));
  controls.addEventListener('end', () => (reactor.interacting = false));

  hud.setInfo({ backend: isWebGPU ? 'WebGPU' : 'WebGL 2', stars: galaxy.params.count });

  // Same composition on every screen: back the camera off until the disc fits
  // horizontally, so portrait phones see the whole galaxy instead of a crop.
  const fitCamera = () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    const halfV = Math.tan((FOV * Math.PI) / 360);
    const fitWidth = (galaxy.params.radius * 1.05) / (halfV * camera.aspect);
    const distance = Math.max(11.3, fitWidth);
    camera.position.setLength(distance);
    controls.maxDistance = distance * 2.5;
  };
  fitCamera();

  addEventListener('resize', () => {
    fitCamera();
    renderer.setSize(innerWidth, innerHeight);
  });

  const audio = new AudioEngine();
  new SourcePicker(document.querySelector('#controls')!, audio);
  new ViewControls(document.querySelector('#view')!, palette);
  const meter = new DebugMeter(document.body);
  // Created once the AudioContext exists, since band edges depend on its sample rate.
  let analysis: AudioAnalysis | null = null;
  audio.onChange(() => {
    analysis ??= audio.analyser ? new AudioAnalysis(audio.fftSize, audio.sampleRate) : null;
  });

  // Space plays/pauses a file; otherwise it (and a click/tap) sends a test pulse.
  addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.repeat) return;
    if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLSelectElement) return;
    e.preventDefault();
    if (audio.media) audio.togglePlayback();
    else galaxy.pulse();
  });
  let down: { x: number; y: number; t: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY, t: performance.now() }));
  canvas.addEventListener('pointerup', (e) => {
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6 && performance.now() - down.t < 300) {
      galaxy.pulse();
    }
    down = null;
  });

  const clock = new FixedClock();
  renderer.setAnimationLoop(() => {
    clock.tick((t) => {
      const f = analysis ? analysis.step(audio.analyser, clock.step) : SILENT;
      meter.step(f, t);
      reactor.step(f, galaxy, clock.step);
      palette.step(clock.step);
      galaxy.simulate(renderer, t, clock.step);
    });
    controls.update();
    reactor.applyShake(clock.simTime);
    ring.orient(camera);
    pipeline.render();
    hud.frame();
    governor.frame();
  });

  hud.reveal();
}

// Offline support and installability; dev builds skip it so HMR isn't cached.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => void navigator.serviceWorker.register('/sw.js'));
}

start().catch((err) => {
  console.error(err);
  document.querySelector('#hud')!.innerHTML =
    '<p class="fatal">This browser can\'t render the galaxy. Try a recent Chrome, Edge, Firefox or Safari.</p>';
});
