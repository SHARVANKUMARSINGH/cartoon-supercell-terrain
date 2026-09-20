# 🌪 Cartoon Supercell Terrain — Three.js

A cartoon-style procedural grass terrain with a real-time **smoke-simulator supercell
thunderstorm** (green hail-core, lightning), built with Three.js.

Inspired by the classic cartoon floating-island grass look: lime-green tops,
deep-green valleys, dark grass tuft blotches, and an orange-brown rim skirt.

![Tech](https://img.shields.io/badge/three.js-0.160-black) ![Size](https://img.shields.io/badge/map-150%20x%20120%20km-7ec850)

## Features

- **Procedural terrain — 150 × 120 km** (1 unit = 100 m)
  - **Bumps**: layered simplex-fbm rolling hills + fine detail
  - **Bends**: domain-warped ridges — the ridge lines curve organically (~26 km warp amplitude)
  - Toon gradient shader: lime tops / deep valleys / dark blotches / mottling
  - Orange-brown "island skirt" rim, matching the reference art
  - ~2,600 instanced cartoon grass tufts (tapered, bent blades)
- **Smoke simulator → supercell**
  - Pooled particle advection: buoyant mesocyclone updraft, rotating inflow band,
    anvil outflow, fbm turbulence, drag
  - Soft noise-eroded billboard puffs, dark storm grey → **sickly green hail core**
  - Green glow intensifies when lightning charges the storm
- **Lightning**: procedural jagged tube bolts (main channel + branches), additive
  bloom, green flash lights + screen flash
- **Color correction (post shader)**: exposure, saturation, contrast, green lift,
  vignette + presets (Cartoon / Storm / Noir) + subtle UnrealBloom
- **Controls**
  - Desktop: WASD/arrows + pointer-lock mouse
  - **Mobile auto-detect**: virtual joystick (left) + drag-look zone (right)

## Run

Any static server works (ES modules + CDN import map):

```bash
cd cartoon-supercell-terrain
python3 -m http.server 8080
# open http://localhost:8080
```

No build step. Three.js r160 is loaded from jsDelivr via an import map.

## Structure

```
index.html        HUD, joystick DOM, import map
src/main.js       boot, render loop, system wiring
src/terrain.js    heightfield (bumps+bends), toon shader, skirt, grass tufts
src/smoke.js      smoke simulator, supercell, lightning, storm sky dome
src/controls.js   desktop pointer-lock + mobile joystick/look
src/grade.js      EffectComposer: bloom + color-correction shader + presets
src/noise.js      seedable simplex noise + fbm
```

## Tuning

| Knob | Where | Notes |
|---|---|---|
| Map size | `WORLD` in `src/terrain.js` | kmX / kmZ |
| Bump scale | `terrainHeight()` | fbm frequencies & amplitudes |
| Bend amount | `terrainHeight()` | warp amplitude (260 units ≈ 26 km) |
| Storm particles | `main.js` → `SmokeSimulator` ctor | 2200 default |
| Lightning rate | `smoke.js` → `Lightning.update` | strike cooldown |
| Grade | HUD sliders / `GradeShader` | live uniforms |
