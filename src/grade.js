import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * Color correction: exposure / saturation / contrast / green lift / vignette,
 * plus subtle bloom so lightning pops. Sliders in the HUD drive uniforms live.
 */
export const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uExposure: { value: 1.05 },
    uSaturation: { value: 1.25 },
    uContrast: { value: 1.08 },
    uGreenLift: { value: 0.10 },
    uVignette: { value: 0.35 },
    uFlash: { value: 0.0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform float uExposure, uSaturation, uContrast, uGreenLift, uVignette, uFlash;

    void main() {
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      col *= uExposure;

      // lift greens (cartoon grass pop + sickly supercell tint)
      col.g += uGreenLift * col.g * 1.4;
      col.r *= 1.0 - uGreenLift * 0.35;

      // saturation
      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(luma), col, uSaturation);

      // contrast around mid grey
      col = (col - 0.5) * uContrast + 0.5;

      // gentle warm-green tone curve: crush shadows a touch
      col = pow(max(col, 0.0), vec3(0.96));

      // vignette
      float d = distance(vUv, vec2(0.5));
      col *= 1.0 - smoothstep(0.42, 0.86, d) * uVignette;

      // lightning screen flash (green-white)
      col += uFlash * vec3(0.55, 0.95, 0.55) * (1.0 - smoothstep(0.3, 0.75, d) * 0.5);

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export function buildPost(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(innerWidth, innerHeight), 0.35, 0.6, 0.82
  );
  composer.addPass(bloom);

  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  composer.addPass(new OutputPass());

  // wire HUD sliders
  const bind = (id, uniform, fmt = v => v.toFixed(2)) => {
    const slider = document.getElementById('s-' + id);
    const label = document.getElementById('v-' + id);
    if (!slider) return;
    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      grade.uniforms[uniform].value = v;
      label.textContent = fmt(v);
    });
  };
  bind('exposure', 'uExposure');
  bind('saturation', 'uSaturation');
  bind('contrast', 'uContrast');
  bind('green', 'uGreenLift', v => v.toFixed(3));
  bind('vignette', 'uVignette');

  const presets = {
    'preset-cartoon': { uExposure: 1.05, uSaturation: 1.25, uContrast: 1.08, uGreenLift: 0.10, uVignette: 0.35 },
    'preset-storm':   { uExposure: 0.88, uSaturation: 0.95, uContrast: 1.22, uGreenLift: 0.16, uVignette: 0.55 },
    'preset-noir':    { uExposure: 0.95, uSaturation: 0.05, uContrast: 1.45, uGreenLift: 0.02, uVignette: 0.70 },
  };
  for (const [id, values] of Object.entries(presets)) {
    const btn = document.getElementById(id);
    if (!btn) continue;
    btn.addEventListener('click', () => {
      for (const [u, v] of Object.entries(values)) {
        grade.uniforms[u].value = v;
        const key = u.replace('u', '').toLowerCase();
        const slider = document.getElementById('s-' + key);
        const label = document.getElementById('v-' + key);
        if (slider) slider.value = v;
        if (label) label.textContent = key === 'green' ? v.toFixed(3) : v.toFixed(2);
      }
    });
  }

  return { composer, grade, bloom };
}
