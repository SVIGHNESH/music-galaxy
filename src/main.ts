import '@fontsource/syne/800.css';
import '@fontsource/geist-mono/400.css';
import './style.css';

import { ACESFilmicToneMapping, PerspectiveCamera, RenderPipeline, Scene, WebGPURenderer } from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { AudioAnalysis } from './audio/analysis';
import { AudioEngine } from './audio/AudioEngine';
import { FixedClock } from './core/clock';
import { pickStarCount, QualityGovernor } from './core/tier';
import { Galaxy } from './galaxy/Galaxy';
import { DebugMeter } from './ui/debugMeter';
import { Hud } from './ui/hud';
import { SourcePicker } from './ui/sourcePicker';

async function start() {
  const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
  const hud = new Hud(document.querySelector('#hud')!);

  // ?renderer=webgl forces the fallback path so it can be checked on WebGPU machines.
  const forceWebGL = new URLSearchParams(location.search).get('renderer') === 'webgl';
  const renderer = new WebGPURenderer({ canvas, antialias: false, forceWebGL });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.setClearColor(0x04050b, 1);
  await renderer.init();

  const scene = new Scene();
  const camera = new PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 400);
  camera.position.set(0, 4.2, 10.5);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.enablePan = false;
  controls.minDistance = 2.5;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.25;

  const isWebGPU = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
  let galaxy = new Galaxy({ count: pickStarCount(isWebGPU) });
  scene.add(galaxy);

  // Rebuild at a smaller budget if this device can't hold the frame rate.
  // Same seed and light compensation, so the galaxy looks the same, just sparser.
  const governor = new QualityGovernor(isWebGPU, galaxy.params.count, (count) => {
    scene.remove(galaxy);
    galaxy.dispose();
    galaxy = new Galaxy({ count });
    scene.add(galaxy);
    hud.setInfo({ backend: isWebGPU ? 'WebGPU' : 'WebGL 2', stars: count });
  });

  const pipeline = new RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  const color = scenePass.getTextureNode('output');
  pipeline.outputNode = color.add(bloom(color, 0.9, 0.55, 0.05));

  hud.setInfo({ backend: isWebGPU ? 'WebGPU' : 'WebGL 2', stars: galaxy.params.count });

  // Same composition on every screen: back the camera off until the disc fits
  // horizontally, so portrait phones see the whole galaxy instead of a crop.
  const fitCamera = () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    const halfV = Math.tan((camera.fov * Math.PI) / 360);
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
      if (analysis) {
        const f = analysis.step(audio.analyser, clock.step);
        meter.step(f, t);
        // Placeholder mapping to prove the chain end to end; milestone 4 replaces it.
        if (f.beat) galaxy.pulse(8 + 16 * f.beatStrength);
      }
      galaxy.simulate(renderer, t, clock.step);
    });
    controls.update();
    pipeline.render();
    hud.frame();
    governor.frame();
  });

  hud.reveal();
}

start().catch((err) => {
  console.error(err);
  document.querySelector('#hud')!.innerHTML =
    '<p class="fatal">This browser can\'t render the galaxy. Try a recent Chrome, Edge, Firefox or Safari.</p>';
});
