// Audio lab page entry (dev/test only, never imported by the game): the audio engine alone,
// no 3D scene, so offline renders in tests are not slowed down by WebGL.
//   node tools/build.mjs --entry src/audio/lab.js --out dist/dev-audio/lab --dev
// window.__audio = createAudio() (no ctx: default settings, no spatial); window.__audioLib for fallback checks.
import { installAudio, createAudio } from './audio.js';

window.__audio = createAudio(null);
window.__audioLib = { createAudio, installAudio };
const app = document.getElementById('app');
if (app) app.textContent = 'Gloomfen audio lab: window.__audio';
