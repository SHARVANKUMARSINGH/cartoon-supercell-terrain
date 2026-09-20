import * as THREE from 'three';
import { makeFbm2D } from './noise.js?v=2';

/**
 * Cartoon grass terrain:
 *  - Map footprint: 150 km x 120 km (1 world unit = 100 m  =>  1500 x 1200 units)
 *  - Procedural bumps: fbm hills
 *  - Procedural bends: domain-warped ridges (the "bend" pass curves the ridges)
 *  - Toon gradient shader: lime tops, deep-green valleys, dark grass blotches,
 *    matching the reference image palette.
 */

export const WORLD = {
  kmX: 150, kmZ: 120,
  unitToMeters: 100,          // 1 unit = 100 m
  get sizeX() { return this.kmX * 1000 / this.unitToMeters; }, // 1500
  get sizeZ() { return this.kmZ * 1000 / this.unitToMeters; }, // 1200
};

const fbmBumps = makeFbm2D(4201, 4, 2.1, 0.5);
const fbmBend  = makeFbm2D(9021, 3, 2.0, 0.55);
const fbmFine  = makeFbm2D(5511, 3, 2.4, 0.5);

export function terrainHeight(x, z) {
  // ---- BENDS: domain warp curves the ridge lines organically
  const wx = fbmBend(x * 0.0016 + 13.7, z * 0.0016 - 4.2);
  const wz = fbmBend(x * 0.0016 - 71.3, z * 0.0016 + 55.8);
  const px = x + wx * 260;   // bend amplitude ~26 km
  const pz = z + wz * 260;

  // ---- BUMPS: broad rolling hills (~8 km wavelength) + medium bumps
  let h = fbmBumps(px * 0.0012, pz * 0.0012) * 42;   // ±~4.2 km… scaled to cartoon proportions
  h += fbmBumps(px * 0.005 + 9.1, pz * 0.005) * 9;   // medium bumps
  h += fbmFine(x * 0.02, z * 0.02) * 1.6;            // fine detail

  // Gentle valley dish so the horizon reads like the reference "island" mound
  const dx = x / (WORLD.sizeX * 0.5), dz = z / (WORLD.sizeZ * 0.5);
  const edge = Math.min(1, Math.max(0, (Math.sqrt(dx * dx + dz * dz) - 0.55) / 0.6));
  h -= edge * edge * 26;
  return h;
}

const terrainVert = /* glsl */`
  varying vec3 vPos;
  varying vec3 vNormal;
  varying float vHeight;
  void main() {
    vPos = position;
    vHeight = position.y;
    vNormal = normalMatrix * normal;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const terrainFrag = /* glsl */`
  precision highp float;
  varying vec3 vPos;
  varying vec3 vNormal;
  varying float vHeight;

  uniform vec3 uSunDir;
  uniform vec3 uCamPos;
  uniform float uTime;

  // cheap hash noise for the mottled cartoon grass
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
               mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
  }

  void main() {
    vec3 n = normalize(vNormal);

    // --- cartoon palette from the reference image ---
    vec3 deepGreen  = vec3(0.208, 0.372, 0.075);  // valley green
    vec3 midGreen   = vec3(0.430, 0.660, 0.140);  // main grass
    vec3 limeTop    = vec3(0.640, 0.830, 0.200);  // sunlit hilltop lime
    vec3 blotchDark = vec3(0.235, 0.410, 0.085);  // dark grass tuft blotches

    float hMix = smoothstep(-18.0, 34.0, vHeight);
    vec3 col = mix(deepGreen, midGreen, smoothstep(0.0, 0.55, hMix));
    col = mix(col, limeTop, smoothstep(0.55, 1.0, hMix) * 0.85);

    // large soft blotches + fine mottle (like the painted grass in the image)
    float blotch = vnoise(vPos.xz * 0.012);
    float blotch2 = vnoise(vPos.xz * 0.035 + 40.0);
    col = mix(col, blotchDark, smoothstep(0.55, 0.8, blotch) * 0.55);
    col = mix(col, col * 1.10, smoothstep(0.5, 0.85, blotch2) * 0.35);
    float mottle = vnoise(vPos.xz * 0.35);
    col *= 0.94 + 0.12 * mottle;

    // --- toon-ish lighting: 3-band step + soft wrap ---
    float ndl = dot(n, normalize(uSunDir)) * 0.5 + 0.5;
    float band = ndl < 0.35 ? 0.62 : (ndl < 0.68 ? 0.85 : 1.08);
    col *= band;

    // storm ambient: cool the shadows slightly
    col = mix(col, col * vec3(0.82, 0.95, 0.88), (1.0 - band) * 0.35);

    // rim of freshness toward camera (fake fresnel lift)
    vec3 viewDir = normalize(uCamPos - vPos);
    float fres = pow(1.0 - max(dot(viewDir, n), 0.0), 3.0);
    col += fres * vec3(0.05, 0.09, 0.02);

    // distance haze into stormy sky
    float dist = length(uCamPos - vPos);
    float haze = smoothstep(250.0, 1100.0, dist);
    col = mix(col, vec3(0.42, 0.50, 0.38), haze * 0.85);

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function buildTerrain() {
  const group = new THREE.Group();

  const segX = 380, segZ = 304; // ~400 m grid — crisp bumps, still fast
  const geo = new THREE.PlaneGeometry(WORLD.sizeX, WORLD.sizeZ, segX, segZ);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)));
  }
  geo.computeVertexNormals();

  const uniforms = {
    uSunDir: { value: new THREE.Vector3(0.45, 0.75, 0.3) },
    uCamPos: { value: new THREE.Vector3() },
    uTime: { value: 0 },
  };

  const mat = new THREE.ShaderMaterial({
    vertexShader: terrainVert,
    fragmentShader: terrainFrag,
    uniforms,
  });

  const terrain = new THREE.Mesh(geo, mat);
  terrain.name = 'terrain';
  group.add(terrain);

  // ---- Island skirt: drop the rim like the orange-brown edge in the reference
  const skirt = buildSkirt(geo);
  group.add(skirt);

  return { group, uniforms, terrain };
}

function buildSkirt(terrainGeo) {
  // Build a ribbon around the outer border of the plane, dropping down.
  const src = terrainGeo.attributes.position;
  const segX = 380, segZ = 304;
  const cols = segX + 1;
  const rows = segZ + 1;
  const border = [];
  const at = (r, c) => r * cols + c;

  for (let c = 0; c < cols; c++) border.push(at(0, c));              // front
  for (let r = 1; r < rows; r++) border.push(at(r, cols - 1));       // right
  for (let c = cols - 2; c >= 0; c--) border.push(at(rows - 1, c));  // back
  for (let r = rows - 2; r >= 1; r--) border.push(at(r, 0));         // left

  const drop = 55;
  const verts = [], idx = [];
  const ringCount = border.length;
  for (let i = 0; i < ringCount; i++) {
    const vi = border[i] * 3;
    const x = src.array[vi], y = src.array[vi + 1], z = src.array[vi + 2];
    // push skirt slightly outward so it flares like the cartoon rim
    const ox = x === 0 ? -3 : (Math.abs(x - WORLD.sizeX / 2) < 0.01 ? Math.sign(x) * 3 : Math.sign(x) * 2);
    const oz = z === 0 ? -3 : (Math.abs(z - WORLD.sizeZ / 2) < 0.01 ? Math.sign(z) * 3 : Math.sign(z) * 2);
    verts.push(x + ox, y + 0.4, z + oz);
    verts.push(x + ox * 2.2, y - drop, z + oz * 2.2);
  }
  for (let i = 0; i < ringCount; i++) {
    const a = i * 2, b = i * 2 + 1;
    const c = ((i + 1) % ringCount) * 2, d = ((i + 1) % ringCount) * 2 + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  g.computeVertexNormals();

  const m = new THREE.MeshStandardMaterial({
    color: 0xb06a2a, roughness: 0.95, metalness: 0,
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(g, m);
}

/** Instanced cartoon grass tufts (dark green clumps like the reference image). */
export function buildGrassTufts(count = 2600) {
  // one tuft = 5 crossed blades
  const blade = new THREE.PlaneGeometry(0.9, 2.4, 1, 2);
  blade.translate(0, 1.2, 0);
  const bp = blade.attributes.position;
  for (let i = 0; i < bp.count; i++) {
    const y = bp.getY(i);
    bp.setX(i, bp.getX(i) * (1 - y / 3.2));          // taper
    bp.setZ(i, bp.getZ(i) + Math.sin(y * 2.2) * 0.12); // slight bend
  }

  const geos = [];
  for (let b = 0; b < 5; b++) {
    const g = blade.clone();
    g.rotateY((b / 5) * Math.PI);
    g.rotateZ((Math.random() - 0.5) * 0.35);
    geos.push(g);
  }
  const tuftGeo = mergeGeos(geos);

  const mat = new THREE.MeshLambertMaterial({ color: 0x2f5c14, side: THREE.DoubleSide });
  const inst = new THREE.InstancedMesh(tuftGeo, mat, count);
  const dummy = new THREE.Object3D();

  for (let i = 0; i < count; i++) {
    const x = (Math.random() - 0.5) * WORLD.sizeX * 0.94;
    const z = (Math.random() - 0.5) * WORLD.sizeZ * 0.94;
    const y = terrainHeight(x, z);
    dummy.position.set(x, y - 0.05, z);
    dummy.rotation.y = Math.random() * Math.PI * 2;
    const s = 0.8 + Math.random() * 1.5;
    dummy.scale.set(s, s * (0.8 + Math.random() * 0.6), s);
    dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);
  }
  inst.instanceMatrix.needsUpdate = true;
  return inst;
}

function mergeGeos(geos) {
  let vCount = 0, iCount = 0;
  geos.forEach(g => { vCount += g.attributes.position.count; iCount += g.index.count; });
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const idx = new Uint16Array(iCount);
  let vo = 0, io = 0;
  geos.forEach(g => {
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    uv.set(g.attributes.uv.array, vo * 2);
    const gi = g.index.array;
    for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
    vo += g.attributes.position.count;
    io += gi.length;
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}
