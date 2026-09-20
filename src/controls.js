import * as THREE from 'three';

/**
 * Unified controls:
 *  - Desktop: WASD/arrows + pointer-lock mouse look
 *  - Mobile (auto-detected via touch): virtual joystick + drag-look zone
 */
export class PlayerControls {
  constructor(camera, dom, terrainHeightFn, opts = {}) {
    this.camera = camera;
    this.dom = dom;
    this.getGroundY = terrainHeightFn;
    this.pos = new THREE.Vector3(0, 0, 180);
    this.yaw = Math.PI;          // face the storm
    this.pitch = -0.04;
    this.speed = opts.speed ?? 120;      // units/s (≈ 12 km/h real scale... cartoon-fast)
    this.eyeHeight = opts.eyeHeight ?? 14;
    this.keys = {};
    this.joy = { x: 0, y: 0, active: false };
    this.isMobile = ('ontouchstart' in window) && matchMedia('(pointer: coarse)').matches;

    if (this.isMobile) {
      document.body.classList.add('mobile');
      this.initJoystick();
      this.initLookZone();
    } else {
      this.initKeyboard();
      this.initPointerLock();
    }
    this.syncCamera(0);
  }

  initKeyboard() {
    addEventListener('keydown', e => { this.keys[e.code] = true; });
    addEventListener('keyup', e => { this.keys[e.code] = false; });
  }

  initPointerLock() {
    this.dom.addEventListener('click', () => {
      if (document.pointerLockElement !== this.dom) this.dom.requestPointerLock();
    });
    addEventListener('mousemove', e => {
      if (document.pointerLockElement !== this.dom) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch -= e.movementY * 0.0022;
      this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch));
    });
  }

  initJoystick() {
    const joy = document.getElementById('joystick');
    const stick = document.getElementById('stick');
    let touchId = null;
    const R = 44;

    const handle = (t) => {
      const rect = joy.getBoundingClientRect();
      const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      let dx = t.clientX - cx, dy = t.clientY - cy;
      const len = Math.hypot(dx, dy);
      if (len > R) { dx = dx / len * R; dy = dy / len * R; }
      stick.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      this.joy.x = dx / R; this.joy.y = dy / R; this.joy.active = true;
    };

    joy.addEventListener('touchstart', e => {
      e.preventDefault();
      touchId = e.changedTouches[0].identifier;
      handle(e.changedTouches[0]);
    }, { passive: false });
    joy.addEventListener('touchmove', e => {
      e.preventDefault();
      for (const t of e.changedTouches) if (t.identifier === touchId) handle(t);
    }, { passive: false });
    const end = e => {
      for (const t of e.changedTouches) if (t.identifier === touchId) {
        touchId = null; this.joy.x = this.joy.y = 0; this.joy.active = false;
        stick.style.transform = 'translate(-50%, -50%)';
      }
    };
    joy.addEventListener('touchend', end);
    joy.addEventListener('touchcancel', end);
  }

  initLookZone() {
    const zone = document.getElementById('lookzone');
    let last = null;
    zone.addEventListener('touchstart', e => {
      const t = e.changedTouches[0];
      last = { id: t.identifier, x: t.clientX, y: t.clientY };
    }, { passive: true });
    zone.addEventListener('touchmove', e => {
      if (!last) return;
      for (const t of e.changedTouches) if (t.identifier === last.id) {
        this.yaw -= (t.clientX - last.x) * 0.005;
        this.pitch -= (t.clientY - last.y) * 0.005;
        this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch));
        last.x = t.clientX; last.y = t.clientY;
      }
    }, { passive: true });
    zone.addEventListener('touchend', () => { last = null; });
  }

  update(dt) {
    // input vector in local space
    let ix = 0, iz = 0;
    if (this.keys['KeyW'] || this.keys['ArrowUp']) iz -= 1;
    if (this.keys['KeyS'] || this.keys['ArrowDown']) iz += 1;
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) ix -= 1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) ix += 1;
    if (this.isMobile) { ix = this.joy.x; iz = this.joy.y; }

    const len = Math.hypot(ix, iz);
    if (len > 1e-3) {
      ix /= Math.max(1, len); iz /= Math.max(1, len);
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      const wx = (ix * cos - iz * sin);
      const wz = (ix * sin + iz * cos);
      this.pos.x += wx * this.speed * dt;
      this.pos.z += wz * this.speed * dt;
    }

    // clamp to map bounds (150 x 120 km)
    this.pos.x = Math.max(-735, Math.min(735, this.pos.x));
    this.pos.z = Math.max(-585, Math.min(585, this.pos.z));

    // smooth ground follow
    const gy = this.getGroundY(this.pos.x, this.pos.z) + this.eyeHeight;
    this.pos.y += (gy - this.pos.y) * Math.min(1, dt * 6);
    if (Math.abs(this.pos.y - gy) > 200) this.pos.y = gy; // teleport fix

    this.syncCamera(dt);
  }

  syncCamera() {
    this.camera.position.copy(this.pos);
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw);
    this.camera.rotateX(this.pitch);
  }
}
