import * as THREE from 'three';
import {
  AREA, tileBoundsMerc, mxToWorld, myToWorld, latFromMercY, heightToWorld,
  lonToTileX, latToTileY,
} from './projection.js';

// Quadtree level-of-detail terrain: elevation from AWS Terrain Tiles (Terrarium encoding),
// imagery from a slippy-map provider. Tiles are only generated inside the European area.

export const STYLES = {
  radar: {
    name: 'Radar',
    url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/${z}/${y}/${x}`,
    attribution: 'Basemap © Esri, HERE, Garmin, © OpenStreetMap contributors',
    tint: new THREE.Color(0.95, 1.08, 1.3),
  },
  satellite: {
    name: 'Satellite',
    url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
    attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    tint: new THREE.Color(1, 1, 1),
  },
};

const TERRAIN_URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const ROOT_Z = 4;
const MAX_Z = 13;
const TERRAIN_MAX_Z = 11;
const SEGMENTS = 32;
const SPLIT_FACTOR = 1.7;
const MAX_CONCURRENT = 8;
const MAX_TILES = 420;

// ---------------------------------------------------------------- elevation cache
const terrainCache = new Map(); // key -> Promise<Float32Array(256*256)>
const decodeCanvas = document.createElement('canvas');
decodeCanvas.width = decodeCanvas.height = 256;
const decodeCtx = decodeCanvas.getContext('2d', { willReadFrequently: true });

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('failed ' + url));
    img.src = url;
  });
}

function loadElevation(z, x, y) {
  const key = `${z}/${x}/${y}`;
  let p = terrainCache.get(key);
  if (!p) {
    p = loadImage(TERRAIN_URL(z, x, y)).then((img) => {
      decodeCtx.drawImage(img, 0, 0, 256, 256);
      const d = decodeCtx.getImageData(0, 0, 256, 256).data;
      const out = new Float32Array(256 * 256);
      for (let i = 0; i < out.length; i++) {
        const h = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
        out[i] = h > 0 ? h : 0; // sea level floor
      }
      return out;
    }).catch(() => null);
    terrainCache.set(key, p);
    if (terrainCache.size > 600) terrainCache.delete(terrainCache.keys().next().value);
  }
  return p;
}

function sample(elev, u, v) {
  // u,v in [0,1] across the elevation tile, bilinear
  const fx = Math.min(255, Math.max(0, u * 255));
  const fy = Math.min(255, Math.max(0, v * 255));
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(255, x0 + 1), y1 = Math.min(255, y0 + 1);
  const tx = fx - x0, ty = fy - y0;
  const a = elev[y0 * 256 + x0], b = elev[y0 * 256 + x1];
  const c = elev[y1 * 256 + x0], d = elev[y1 * 256 + x1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

// ---------------------------------------------------------------- tile
class Tile {
  constructor(z, x, y, parent) {
    this.z = z; this.x = x; this.y = y; this.parent = parent;
    this.key = `${z}/${x}/${y}`;
    this.state = 'new';
    this.children = null;
    this.mesh = null;
    this.lastUsed = 0;
    const b = tileBoundsMerc(z, x, y);
    this.merc = b;
    this.x0 = mxToWorld(b.minX); this.x1 = mxToWorld(b.maxX);
    this.z0 = myToWorld(b.maxY); this.z1 = myToWorld(b.minY);
    this.size = this.x1 - this.x0;
    this.box = new THREE.Box3(new THREE.Vector3(this.x0, 0, this.z0), new THREE.Vector3(this.x1, 25, this.z1));
  }

  getChildren() {
    if (!this.children) {
      this.children = [];
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const c = new Tile(this.z + 1, this.x * 2 + dx, this.y * 2 + dy, this);
          if (intersectsArea(c)) this.children.push(c);
        }
      }
    }
    return this.children;
  }
}

function intersectsArea(t) {
  const lat0 = latFromMercY(t.merc.minY), lat1 = latFromMercY(t.merc.maxY);
  const lon0 = (t.merc.minX / 6378137) * 180 / Math.PI, lon1 = (t.merc.maxX / 6378137) * 180 / Math.PI;
  return lat1 > AREA.latMin && lat0 < AREA.latMax && lon1 > AREA.lonMin && lon0 < AREA.lonMax;
}

// ---------------------------------------------------------------- manager
export class TileManager {
  constructor(scene, renderer, styleKey = 'radar') {
    this.scene = scene;
    this.renderer = renderer;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    scene.add(this.group);
    this.loader = new THREE.TextureLoader();
    this.loader.setCrossOrigin('anonymous');
    this.frustum = new THREE.Frustum();
    this.projScreen = new THREE.Matrix4();
    this.inflight = 0;
    this.queue = [];
    this.frame = 0;
    this.setStyle(styleKey);
  }

  setStyle(styleKey) {
    this.styleKey = styleKey;
    this.style = STYLES[styleKey];
    this.rebuild();
  }

  /** Drop every tile (after a style or exaggeration change). Elevation data stays cached. */
  rebuild() {
    for (const t of this.all ?? []) this.disposeTile(t);
    this.all = new Set();
    this.roots = [];
    const x0 = lonToTileX(AREA.lonMin, ROOT_Z), x1 = lonToTileX(AREA.lonMax, ROOT_Z);
    const y0 = latToTileY(AREA.latMax, ROOT_Z), y1 = latToTileY(AREA.latMin, ROOT_Z);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.roots.push(new Tile(ROOT_Z, x, y, null));
    this.queue = [];
    this.generation = (this.generation || 0) + 1;
  }

  disposeTile(t) {
    if (t.mesh) {
      this.group.remove(t.mesh);
      t.mesh.geometry.dispose();
      t.mesh.material.map?.dispose();
      t.mesh.material.dispose();
      t.mesh = null;
    }
    t.state = 'new';
    this.all?.delete(t);
  }

  request(t, priority) {
    if (t.state !== 'new') return;
    t.state = 'queued';
    t.priority = priority;
    t.lastUsed = this.frame;
    this.queue.push(t);
  }

  async load(t) {
    const gen = this.generation;
    t.state = 'loading';
    this.inflight++;
    try {
      const tz = Math.min(t.z, TERRAIN_MAX_Z);
      const shift = t.z - tz;
      const tx = t.x >> shift, ty = t.y >> shift;
      const [elev, tex] = await Promise.all([
        loadElevation(tz, tx, ty),
        new Promise((res) => this.loader.load(this.style.url(t.z, t.x, t.y), res, undefined, () => res(null))),
      ]);
      if (gen !== this.generation) { tex?.dispose(); return; }
      const n = 2 ** shift;
      const sub = { elev, u0: (t.x - tx * n) / n, v0: (t.y - ty * n) / n, span: 1 / n };
      t.mesh = this.buildMesh(t, sub, tex);
      this.group.add(t.mesh);
      t.mesh.visible = false;
      t.state = 'ready';
      this.all.add(t);
    } catch (e) {
      t.state = 'failed';
    } finally {
      this.inflight--;
    }
  }

  buildMesh(t, sub, tex) {
    const N = SEGMENTS;
    const verts = (N + 1) * (N + 1);
    const skirt = 4 * (N + 1);
    const pos = new Float32Array((verts + skirt) * 3);
    const uv = new Float32Array((verts + skirt) * 2);
    const { minX, maxY, size } = t.merc;
    let maxH = 0;
    for (let j = 0; j <= N; j++) {
      const my = maxY - (j / N) * size;
      const lat = latFromMercY(my);
      for (let i = 0; i <= N; i++) {
        const k = j * (N + 1) + i;
        const h = sub.elev ? sample(sub.elev, sub.u0 + (i / N) * sub.span, sub.v0 + (j / N) * sub.span) : 0;
        const y = heightToWorld(h, lat);
        if (y > maxH) maxH = y;
        pos[k * 3] = mxToWorld(minX + (i / N) * size);
        pos[k * 3 + 1] = y;
        pos[k * 3 + 2] = myToWorld(my);
        uv[k * 2] = i / N;
        uv[k * 2 + 1] = 1 - j / N;
      }
    }
    const index = [];
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
        index.push(a, c, b, b, c, d);
      }
    }
    // skirts hide cracks between neighbouring tiles of different detail
    const edges = [
      [...Array(N + 1).keys()].map((i) => i),
      [...Array(N + 1).keys()].map((i) => N * (N + 1) + i),
      [...Array(N + 1).keys()].map((j) => j * (N + 1)),
      [...Array(N + 1).keys()].map((j) => j * (N + 1) + N),
    ];
    let s = verts;
    const drop = t.size * 0.02 + 0.3;
    edges.forEach((edge, e) => {
      edge.forEach((k, m) => {
        pos[s * 3] = pos[k * 3]; pos[s * 3 + 1] = pos[k * 3 + 1] - drop; pos[s * 3 + 2] = pos[k * 3 + 2];
        uv[s * 2] = uv[k * 2]; uv[s * 2 + 1] = uv[k * 2 + 1];
        if (m > 0) {
          const k0 = edge[m - 1], s0 = s - 1;
          if (e === 0 || e === 3) index.push(k0, k, s0, s0, k, s);
          else index.push(k0, s0, k, s0, s, k);
        }
        s++;
      });
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(index);
    geo.computeVertexNormals();
    t.box.max.y = maxH + 0.1;
    if (tex) {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      tex.generateMipmaps = true;
    }
    const mat = new THREE.MeshLambertMaterial({
      map: tex, color: tex ? this.style.tint : 0x1a2433, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.matrixAutoUpdate = false;
    mesh.receiveShadow = false;
    return mesh;
  }

  update(camera) {
    this.frame++;
    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    const cam = camera.position;
    const visible = [];
    const closest = new THREE.Vector3();

    const visit = (t) => {
      if (!this.frustum.intersectsBox(t.box)) return;
      t.lastUsed = this.frame;
      t.box.clampPoint(cam, closest);
      const d = closest.distanceTo(cam);
      if (t.z < MAX_Z && d < t.size * SPLIT_FACTOR) {
        const kids = t.getChildren();
        let ready = kids.length > 0;
        for (const c of kids) {
          if (c.state === 'new') this.request(c, d);
          if (c.state !== 'ready' && c.state !== 'failed') ready = false;
        }
        if (ready) { kids.forEach(visit); return; }
      }
      if (t.state === 'ready') visible.push(t);
      else if (t.state === 'new') this.request(t, d);
    };
    this.roots.forEach(visit);

    for (const t of this.all) t.mesh.visible = false;
    for (const t of visible) t.mesh.visible = true;

    // start queued loads, nearest first; forget requests for tiles no longer wanted
    if (this.queue.length) {
      const keep = [];
      for (const t of this.queue) {
        if (t.state !== 'queued') continue;
        if (this.frame - t.lastUsed < 30) keep.push(t);
        else t.state = 'new';
      }
      keep.sort((a, b) => a.priority - b.priority);
      while (this.inflight < MAX_CONCURRENT && keep.length) this.load(keep.shift());
      this.queue = keep;
    }
    // evict least-recently used, never the roots
    if (this.all.size > MAX_TILES) {
      const cands = [...this.all].filter((t) => !t.mesh.visible && t.z > ROOT_Z)
        .sort((a, b) => a.lastUsed - b.lastUsed);
      for (const t of cands.slice(0, this.all.size - MAX_TILES)) {
        this.disposeTile(t);
      }
    }
  }
}
