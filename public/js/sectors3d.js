import * as THREE from 'three';
import { toWorld, FT } from './projection.js';

const DISPLAY_CEILING_FL = 460;

/** Translucent 3D volumes for control sectors; the active one glows. */
export class SectorLayer {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'sectors';
    scene.add(this.group);
    this.items = new Map();
    this.active = null;
  }

  build(sectors) {
    for (const s of sectors) {
      const g = new THREE.Group();
      const top = Math.min(s.fl_max, DISPLAY_CEILING_FL) * 100 * FT;
      const bottom = s.fl_min * 100 * FT;
      const ring = [...s.poly, s.poly[0]];
      const lo = ring.map(([lat, lon]) => toWorld(lat, lon, bottom));
      const hi = ring.map(([lat, lon]) => toWorld(lat, lon, top));
      const ground = ring.map(([lat, lon]) => toWorld(lat, lon, 0).setY(0.2));

      // walls
      const pos = [], vUv = [];
      for (let i = 0; i < ring.length - 1; i++) {
        const a = lo[i], b = lo[i + 1], c = hi[i], d = hi[i + 1];
        pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, c.x, c.y, c.z, b.x, b.y, b.z, d.x, d.y, d.z);
        vUv.push(0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1);
      }
      const wallGeo = new THREE.BufferGeometry();
      wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      wallGeo.setAttribute('uv', new THREE.Float32BufferAttribute(vUv, 2));
      const wallMat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        uniforms: { color: { value: new THREE.Color('#38b6ff') }, strength: { value: 0 } },
        vertexShader: `varying vec2 vUv;
          #include <common>
          #include <logdepthbuf_pars_vertex>
          void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
          #include <logdepthbuf_vertex>
          }`,
        fragmentShader: `uniform vec3 color; uniform float strength; varying vec2 vUv;
          #include <logdepthbuf_pars_fragment>
          void main(){
            #include <logdepthbuf_fragment>
            float edge = pow(1.0 - vUv.y, 2.0) * 0.5 + pow(vUv.y, 6.0) * 0.6;
            float bands = step(0.96, fract(vUv.y * 8.0)) * 0.25;
            gl_FragColor = vec4(color * (0.08 + edge + bands) * strength, 1.0);
          }`,
      });
      const walls = new THREE.Mesh(wallGeo, wallMat);
      walls.renderOrder = 5;
      g.add(walls);

      // outlines: floor, ceiling, ground footprint, vertical edges
      const linePos = [];
      const pushLoop = (pts) => { for (let i = 0; i < pts.length - 1; i++) linePos.push(pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z); };
      pushLoop(lo); pushLoop(hi);
      for (let i = 0; i < ring.length - 1; i++) linePos.push(lo[i].x, lo[i].y, lo[i].z, hi[i].x, hi[i].y, hi[i].z);
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3));
      const lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({
        color: '#5cc8ff', transparent: true, opacity: 0.9, depthWrite: false,
      }));
      g.add(lines);

      const footGeo = new THREE.BufferGeometry().setFromPoints(ground);
      const foot = new THREE.Line(footGeo, new THREE.LineDashedMaterial({
        color: '#5f7b99', dashSize: 6, gapSize: 4, transparent: true, opacity: 0.8,
      }));
      foot.computeLineDistances();
      g.add(foot);

      this.group.add(g);
      this.items.set(s.id, { group: g, walls, lines, foot, sector: s });
    }
    this.setActive(null);
  }

  setActive(id) {
    this.active = id;
    for (const [sid, it] of this.items) {
      const on = sid === id;
      it.walls.visible = on;
      it.lines.visible = on;
      it.walls.material.uniforms.strength.value = on ? 1 : 0;
      it.foot.material.opacity = on ? 0 : 0.7;
    }
  }

  /** Rebuild after a vertical-exaggeration change. */
  rebuild(sectors) {
    for (const it of this.items.values()) {
      this.group.remove(it.group);
      it.group.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
    }
    this.items.clear();
    this.build(sectors);
    this.setActive(this.active);
  }
}
