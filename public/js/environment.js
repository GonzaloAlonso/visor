import * as THREE from 'three';
import { AREA_WORLD } from './projection.js';

const THEMES = {
  radar: {
    zenith: new THREE.Color('#02060d'), horizon: new THREE.Color('#0f2238'), glow: new THREE.Color('#1d4d7a'),
    fog: new THREE.Color('#0a1728'), underlay: new THREE.Color('#070d16'),
    sun: 1.6, hemi: [new THREE.Color('#9cc4ff'), new THREE.Color('#0b1320'), 1.2],
  },
  satellite: {
    zenith: new THREE.Color('#1d4f96'), horizon: new THREE.Color('#a9c8e8'), glow: new THREE.Color('#fff2d6'),
    fog: new THREE.Color('#9fb9d4'), underlay: new THREE.Color('#1b2a3a'),
    sun: 2.4, hemi: [new THREE.Color('#dbe9ff'), new THREE.Color('#3b3a30'), 1.0],
  },
};

export class Environment {
  constructor(scene) {
    this.scene = scene;

    // Sky dome that follows the camera (drawn first, no depth).
    this.skyUniforms = {
      zenith: { value: new THREE.Color() }, horizon: { value: new THREE.Color() },
      glow: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(-0.5, 0.35, 0.6).normalize() },
    };
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
        uniforms: this.skyUniforms,
        vertexShader: /* glsl */`
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_Position = p.xyww;
          }`,
        fragmentShader: /* glsl */`
          uniform vec3 zenith; uniform vec3 horizon; uniform vec3 glow; uniform vec3 sunDir;
          varying vec3 vDir;
          void main() {
            float h = clamp(vDir.y, -0.2, 1.0);
            vec3 c = mix(horizon, zenith, pow(max(h, 0.0), 0.45));
            float s = max(dot(normalize(vDir), sunDir), 0.0);
            c += glow * (pow(s, 64.0) * 0.8 + pow(s, 6.0) * 0.18) * smoothstep(-0.1, 0.2, h);
            gl_FragColor = vec4(c, 1.0);
          }`,
      }),
    );
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    this.sun = new THREE.DirectionalLight(0xffffff, 2);
    this.sun.position.set(-600, 900, 700);
    scene.add(this.sun);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
    scene.add(this.hemi);

    scene.fog = new THREE.Fog(0x000000, 1000, 8000);

    // Dark plane under/around the tiled area hides gaps and the edge of the map.
    const pad = 6000;
    const w = AREA_WORLD.xMax - AREA_WORLD.xMin + pad * 2;
    const d = AREA_WORLD.zMax - AREA_WORLD.zMin + pad * 2;
    this.underlay = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x000000 }),
    );
    this.underlay.position.set((AREA_WORLD.xMin + AREA_WORLD.xMax) / 2, -1.5, (AREA_WORLD.zMin + AREA_WORLD.zMax) / 2);
    scene.add(this.underlay);
  }

  setTheme(key) {
    const t = THEMES[key];
    this.skyUniforms.zenith.value.copy(t.zenith);
    this.skyUniforms.horizon.value.copy(t.horizon);
    this.skyUniforms.glow.value.copy(t.glow);
    this.scene.fog.color.copy(t.fog);
    this.underlay.material.color.copy(t.underlay);
    this.sun.intensity = t.sun;
    this.hemi.color.copy(t.hemi[0]);
    this.hemi.groundColor.copy(t.hemi[1]);
    this.hemi.intensity = t.hemi[2];
  }

  update(camera, distance) {
    this.sky.position.copy(camera.position);
    this.sky.scale.setScalar(camera.far * 0.9);
    // fog only matters when looking towards the horizon
    this.scene.fog.near = distance * 1.6;
    this.scene.fog.far = distance * 7 + 400;
  }
}
