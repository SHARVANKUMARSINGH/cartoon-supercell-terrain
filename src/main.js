import * as THREE from 'three';
import { buildTerrain, buildGrassTufts, terrainHeight, WORLD } from './terrain.js?v=2';
import { SmokeSimulator, Lightning, buildSky, Tornado } from './smoke.js?v=2';
import { PlayerControls } from './controls.js?v=2';
import { buildPost } from './grade.js?v=2';

const loadbar = document.getElementById('loadbar');
const setProgress = p => { if (loadbar) loadbar.style.width = `${(p * 100) | 0}%`; };

/* ---------------- renderer / scene ---------------- */
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.NoToneMapping; // grade pass handles the look
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x6f7f5e, 260, 1400);

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.5, 9000);

/* ---------------- lights (toon sun + storm fill) ---------------- */
const sun = new THREE.DirectionalLight(0xfff4d6, 2.0);
sun.position.set(500, 800, 350);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xcfe8b0, 0x2a4416, 0.9));

/* ---------------- storm position (fixed over the map) ---------------- */
const stormPos = new THREE.Vector3(260, terrainHeight(260, -240) + 60, -240);

/* ---------------- terrain ---------------- */
setProgress(0.15);
const { group: terrainGroup, uniforms: terrainUniforms } = buildTerrain();
scene.add(terrainGroup);
setProgress(0.55);

const tufts = buildGrassTufts(2600);
scene.add(tufts);
setProgress(0.7);

/* ---------------- sky ---------------- */
const sky = buildSky(stormPos);
scene.add(sky.mesh);

/* ---------------- smoke simulator + supercell ---------------- */
const smoke = new SmokeSimulator({ maxParticles: 2600, stormPos });
smoke.uniforms.uPixelRatio.value = Math.min(devicePixelRatio, 2);
scene.add(smoke.points);

const lightning = new Lightning(scene, stormPos);
const tornado = new Tornado(scene, stormPos, terrainHeight, { spawnDelay: 5 });
const flashDiv = document.getElementById('flash');
let flashAlpha = 0;
lightning.onStrike = () => { flashAlpha = 0.85; };

// green core glow light under the storm (always-on sickly tint)
const coreGlow = new THREE.PointLight(0x51d14e, 14000, 1600, 1.8);
coreGlow.position.copy(stormPos).y += 90;
scene.add(coreGlow);

setProgress(0.85);

/* ---------------- post / color correction ---------------- */
const { composer, grade } = buildPost(renderer, scene, camera);

/* ---------------- controls (desktop / mobile auto) ---------------- */
const controls = new PlayerControls(camera, renderer.domElement, terrainHeight, {
  speed: 130, eyeHeight: 14,
});

/* ---------------- resize ---------------- */
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

/* ---------------- main loop ---------------- */
const clock = new THREE.Clock();
const statsEl = document.getElementById('stats');
let statTimer = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  controls.update(dt);

  // systems
  smoke.update(dt);
  lightning.update(dt, smoke.uniforms.uGreenGlow);
  tornado.update(dt);
  coreGlow.intensity = 12000 + Math.sin(t * 2.3) * 2500 + smoke.uniforms.uGreenGlow.value * 22000;

  // uniforms
  terrainUniforms.uCamPos.value.copy(camera.position);
  sky.mat.uniforms.uCamPos.value.copy(camera.position);
  sky.mat.uniforms.uTime.value = t;
  smoke.uniforms.uTime.value = t;

  // lightning screen flash decay
  flashAlpha = Math.max(0, flashAlpha - dt * 3.2);
  grade.uniforms.uFlash.value = flashAlpha * 0.55;
  if (flashDiv) flashDiv.style.opacity = flashAlpha.toFixed(3);

  composer.render();

  statTimer -= dt;
  if (statTimer <= 0 && statsEl) {
    statTimer = 0.25;
    const km = (v) => (v * WORLD.unitToMeters / 1000).toFixed(1);
    const pos = controls.pos;
    statsEl.textContent =
      `pos ${km(pos.x)} km, ${km(pos.z)} km · h ${(terrainHeight(pos.x, pos.z) * WORLD.unitToMeters / 1000).toFixed(2)} km · ` +
      `${renderer.info.render.calls} draws · ${(renderer.info.render.triangles / 1000) | 0}k tris · ` +
      `${controls.isMobile ? 'MOBILE joystick' : 'desktop'}`;
  }
}

setProgress(1);
const loading = document.getElementById('loading');
loading.style.opacity = '0';
setTimeout(() => loading.remove(), 700);
animate();
