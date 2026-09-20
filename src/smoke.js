import * as THREE from 'three';
import { makeFbm2D } from './noise.js';

/**
 * Real-time smoke simulator → supercell thunderstorm.
 *
 * A pooled particle system advects "smoke puffs" with:
 *  - buoyant updraft (strong in the mesocyclone core, weak outside)
 *  - rotation around the mesocyclone axis (supercell spin)
 *  - curl-ish turbulence from fbm
 *  - entrainment: puffs converge toward the rotating wall-cloud base
 * Particles are rendered as soft, noise-eroded billboard sprites with a
 * green-hued hail-core tint — the classic green supercell look.
 * A lightning controller spawns jagged bolt meshes + light flashes.
 */

const curl = makeFbm2D(777, 3, 2.2, 0.5);

/* ------------------------------------------------------------------ */
/*  Smoke particle pool (Points + custom shader)                        */
/* ------------------------------------------------------------------ */
export class SmokeSimulator {
  constructor({ maxParticles = 2200, stormPos = new THREE.Vector3() } = {}) {
    this.max = maxParticles;
    this.stormPos = stormPos.clone();

    // particle state (SoA)
    this.pos = new Float32Array(this.max * 3);
    this.vel = new Float32Array(this.max * 3);
    this.life = new Float32Array(this.max);      // seconds remaining
    this.maxLife = new Float32Array(this.max);
    this.size = new Float32Array(this.max);
    this.shade = new Float32Array(this.max);     // 0..1 brightness seed
    this.alive = new Uint8Array(this.max);
    this.head = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aShade', new THREE.BufferAttribute(this.shade, 1));
    geo.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uGreenGlow: { value: 0.0 },   // raised when lightning charges the core
        uPixelRatio: { value: 1 },
      },
      vertexShader: /* glsl */`
        attribute float aSize;
        attribute float aShade;
        attribute float aLife;
        varying float vShade;
        varying float vFade;
        varying float vGreen;
        uniform float uPixelRatio;
        void main() {
          vShade = aShade;
          // fade in fast, fade out at end of life
          float t = aLife; // remaining seconds passed from CPU (encoded)
          vFade = clamp(aLife, 0.0, 1.0);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uPixelRatio * (620.0 / -mv.z);
          gl_PointSize = min(gl_PointSize, 420.0);
          gl_Position = projectionMatrix * mv;
          // green tint strongest low in the cloud (hail core)
          vGreen = clamp(1.2 - (position.y - ${'0.0'}) * 0.004, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        precision highp float;
        varying float vShade;
        varying float vFade;
        varying float vGreen;
        uniform float uTime;
        uniform float uGreenGlow;

        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float vnoise(vec2 p){
          vec2 i = floor(p), f = fract(p);
          f = f*f*(3.0-2.0*f);
          return mix(mix(hash(i), hash(i+vec2(1,0)), f.x),
                     mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
        }

        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float r = length(uv);
          if (r > 0.5) discard;

          // erode the disc with animated noise => puffy smoke edge
          float n = vnoise(gl_PointCoord * 5.0 + vShade * 37.0 + uTime * 0.12);
          float edge = smoothstep(0.5, 0.12, r + (n - 0.5) * 0.28);

          // base cloud colors: dark storm grey -> green hail core
          vec3 greyDark  = vec3(0.16, 0.17, 0.18);
          vec3 greyLight = vec3(0.52, 0.55, 0.56);
          vec3 greenCore = vec3(0.29, 0.66, 0.30);

          vec3 col = mix(greyDark, greyLight, vShade);
          // sickly green tint low in the storm, boosted by lightning charge
          float g = clamp(vGreen * (0.55 + uGreenGlow * 1.6), 0.0, 1.0);
          col = mix(col, greenCore, g * (0.35 + 0.45 * n));

          float a = edge * vFade * 0.62;
          gl_FragColor = vec4(col, a);
        }
      `,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.uniforms = mat.uniforms;

    this.spawnDebt = 0;
    this.time = 0;
  }

  /** spawn a puff: ring inflow near base, or updraft core, or anvil outflow */
  spawn() {
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    this.alive[i] = 1;

    const S = this.stormPos;
    const roll = Math.random();
    const ang = Math.random() * Math.PI * 2;
    let x, y, z, vx, vy, vz, life, size;

    if (roll < 0.62) {
      // rotating wall-cloud inflow band (low, converging)
      const R = 120 + Math.random() * 160;
      x = S.x + Math.cos(ang) * R;
      z = S.z + Math.sin(ang) * R;
      y = S.y + 18 + Math.random() * 45;
      vx = -Math.cos(ang) * 9; vz = -Math.sin(ang) * 9;
      vy = 5 + Math.random() * 8;
      life = 14 + Math.random() * 10;
      size = 30 + Math.random() * 36;
    } else if (roll < 0.9) {
      // mesocyclone updraft core
      const R = Math.random() * 80;
      x = S.x + Math.cos(ang) * R;
      z = S.z + Math.sin(ang) * R;
      y = S.y + 30 + Math.random() * 140;
      vx = 0; vy = 26 + Math.random() * 20; vz = 0;
      life = 12 + Math.random() * 8;
      size = 34 + Math.random() * 44;
    } else {
      // anvil outflow at the top — spreads downwind
      const R = 60 + Math.random() * 240;
      x = S.x + Math.cos(ang) * R;
      z = S.z + Math.sin(ang) * R;
      y = S.y + 300 + Math.random() * 90;
      vx = 24 + Math.random() * 14; vy = 1.5; vz = 6;
      life = 20 + Math.random() * 14;
      size = 55 + Math.random() * 60;
    }

    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.life[i] = 1;                    // shader fade uses 0..1
    this.maxLife[i] = life;
    this._lifeRem = this._lifeRem || new Float32Array(this.max);
    this._lifeRem[i] = life;
    this.size[i] = size;
    this.shade[i] = Math.random();
  }

  update(dt) {
    this.time += dt;
    const S = this.stormPos;
    const t = this.time;

    // spawn rate scaled to dt (≈ 170 spawns/sec -> ~2200 alive with lifetimes)
    this.spawnDebt += dt * 170;
    while (this.spawnDebt >= 1) { this.spawn(); this.spawnDebt -= 1; }

    const omega = 0.42; // mesocyclone angular velocity (rad/s, stylized)
    for (let i = 0; i < this.max; i++) {
      if (!this.alive[i]) { this.life[i] = 0; continue; }
      const i3 = i * 3;
      let x = this.pos[i3], y = this.pos[i3 + 1], z = this.pos[i3 + 2];
      let vx = this.vel[i3], vy = this.vel[i3 + 1], vz = this.vel[i3 + 2];

      // rotation about storm axis (tangential velocity ~ omega x r, damped high up)
      const rx = x - S.x, rz = z - S.z;
      const r = Math.sqrt(rx * rx + rz * rz) + 1e-3;
      const heightDamp = 1 / (1 + Math.max(0, y - S.y - 150) / 220);
      const vTan = omega * Math.min(r, 220) * heightDamp;
      vx += ((-rz / r) * vTan - vx) * Math.min(1, dt * 1.6);
      vz += ((rx / r) * vTan - vz) * Math.min(1, dt * 1.6);

      // buoyancy: strong inside core radius, slight sink outside
      const inCore = Math.max(0, 1 - r / 260);
      const buoy = (inCore * 26 - 3.5) * (1 - Math.max(0, y - S.y - 330) / 160);
      vy += buoy * dt;

      // turbulence
      const n1 = curl(x * 0.004 + t * 0.05, z * 0.004);
      const n2 = curl(z * 0.004 - t * 0.04, y * 0.004 + 7.7);
      vx += n1 * 10 * dt; vz += n2 * 10 * dt; vy += (n1 + n2) * 4 * dt;

      // drag + integrate
      const drag = Math.max(0, 1 - dt * 0.55);
      vx *= drag; vy *= drag; vz *= drag;
      x += vx * dt; y += vy * dt; z += vz * dt;

      // kill if too old, too high dissipated, or too far downwind
      this._lifeRem[i] -= dt;
      if (this._lifeRem[i] <= 0 || y > S.y + 480 || r > 900) {
        this.alive[i] = 0; this.life[i] = 0;
        this.pos[i3 + 1] = -9999;
        continue;
      }

      this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
      this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
      const lr = this._lifeRem[i] / this.maxLife[i];
      this.life[i] = Math.min(1, lr * 4) * Math.min(1, (1 - lr) * 6 + 0.15);
      // puffs inflate as they age
      this.size[i] += dt * 2.2;
    }

    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.aLife.needsUpdate = true;
    this.points.geometry.attributes.aSize.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ */
/*  Lightning — jagged bolts + green flash lights                       */
/* ------------------------------------------------------------------ */
export class Lightning {
  constructor(scene, stormPos) {
    this.scene = scene;
    this.stormPos = stormPos.clone();
    this.bolts = [];
    this.nextStrike = 2.0;
    this.flashLight = new THREE.PointLight(0x9fff8a, 0, 2600, 1.4);
    this.flashLight.position.copy(stormPos).y += 120;
    scene.add(this.flashLight);
    this.hemi = new THREE.HemisphereLight(0xbfff9e, 0x1c2b12, 0);
    scene.add(this.hemi);
    this.onStrike = null; // callback for screen flash
  }

  strike() {
    const S = this.stormPos;
    const group = new THREE.Group();
    const ang = Math.random() * Math.PI * 2;
    const R = Math.random() * 200;
    const sx = S.x + Math.cos(ang) * R;
    const sz = S.z + Math.sin(ang) * R;
    const top = S.y + 120 + Math.random() * 140;

    const mat = new THREE.MeshBasicMaterial({
      color: 0xd8ffc8, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });

    // main channel + 2 branches
    group.add(this.boltMesh(sx, top, sz, 0, mat));
    group.add(this.boltMesh(sx, top * 0.92, sz, 2.1, mat));
    group.add(this.boltMesh(sx, top * 0.8, sz, 4.4, mat));

    this.scene.add(group);
    this.bolts.push({ group, mat, age: 0, ttl: 0.28 + Math.random() * 0.2 });
    this.flashLight.intensity = 90000;
    this.hemi.intensity = 1.4;
    if (this.onStrike) this.onStrike();
  }

  boltMesh(x, yTop, z, seed, mat) {
    const pts = [];
    let px = x, py = yTop, pz = z;
    const segs = 14;
    const drop = (yTop - -40) / segs;
    for (let i = 0; i <= segs; i++) {
      pts.push(new THREE.Vector3(px, py, pz));
      px += (Math.random() - 0.5) * 26 + Math.sin(seed + i * 1.7) * 10;
      pz += (Math.random() - 0.5) * 26 + Math.cos(seed + i * 2.3) * 10;
      py -= drop * (0.7 + Math.random() * 0.6);
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const geo = new THREE.TubeGeometry(curve, 40, 1.4, 5, false);
    return new THREE.Mesh(geo, mat);
  }

  update(dt, greenGlowUniform) {
    this.nextStrike -= dt;
    if (this.nextStrike <= 0) {
      this.strike();
      // supercells flicker — sometimes double tap
      this.nextStrike = Math.random() < 0.3 ? 0.18 : 1.2 + Math.random() * 4.5;
    }
    // decay flash
    this.flashLight.intensity = Math.max(0, this.flashLight.intensity - dt * 600000);
    this.hemi.intensity = Math.max(0, this.hemi.intensity - dt * 6);
    if (greenGlowUniform) {
      greenGlowUniform.value = Math.max(0, greenGlowUniform.value - dt * 1.2);
      if (this.flashLight.intensity > 20000) greenGlowUniform.value = 1.0;
    }
    // age bolts
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.age += dt;
      b.mat.opacity = Math.max(0, 1 - b.age / b.ttl);
      if (b.age >= b.ttl) {
        this.scene.remove(b.group);
        b.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
        this.bolts.splice(i, 1);
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Storm sky dome (dark swirling gradient)                             */
/* ------------------------------------------------------------------ */
export function buildSky(stormPos) {
  const geo = new THREE.SphereGeometry(4200, 32, 20);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uStormPos: { value: stormPos.clone() },
      uCamPos: { value: new THREE.Vector3() },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww; // pin to far plane
      }
    `,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec3 vDir;
      uniform vec3 uStormPos;
      uniform vec3 uCamPos;
      uniform float uTime;

      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float vnoise(vec2 p){
        vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),
                   mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
      }

      void main() {
        vec3 dir = normalize(vDir);
        float up = clamp(dir.y, -0.1, 1.0);

        // clear-ish horizon away from storm, bruised dark near it
        vec3 horizon = vec3(0.72, 0.80, 0.62);
        vec3 zenith  = vec3(0.34, 0.48, 0.42);

        vec2 toStorm = normalize(uStormPos.xz - uCamPos.xz);
        float stormSide = pow(max(dot(normalize(dir.xz + 1e-5), toStorm), 0.0), 1.6);
        float dark = stormSide * (1.0 - up * 0.55);

        horizon = mix(horizon, vec3(0.24, 0.29, 0.22), dark);
        zenith  = mix(zenith,  vec3(0.10, 0.13, 0.11), dark * 0.9);

        // green tinge right at the storm base — hail core glow
        float greenBand = stormSide * smoothstep(0.35, 0.02, abs(dir.y - 0.06));
        horizon = mix(horizon, vec3(0.35, 0.62, 0.30), greenBand * 0.55);

        // slow swirling murk
        float swirl = vnoise(dir.xz * 4.0 / max(0.12, up + 0.2) + uTime * 0.015);
        zenith *= 0.85 + swirl * 0.3;

        vec3 col = mix(horizon, zenith, pow(clamp(up, 0.0, 1.0), 0.55));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return { mesh, mat };
}
