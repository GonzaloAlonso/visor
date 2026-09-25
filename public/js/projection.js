import * as THREE from 'three';

// World space: Web Mercator, 1 unit = 1 km (of Mercator distance), y up, north = -z.
// Heights are scaled by the local Mercator factor so vertical proportions stay true at every
// latitude, then multiplied by the vertical exaggeration.
export const R = 6378137;
export const WORLD_M = 2 * Math.PI * R;
const DEG = Math.PI / 180;

export const AREA = { latMin: 34, latMax: 72, lonMin: -25, lonMax: 45 };
const ORIGIN = { lat: 50, lon: 10 };

export const view = { vexag: 3 };

export function mercX(lon) { return R * lon * DEG; }
export function mercY(lat) { return R * Math.log(Math.tan(Math.PI / 4 + (lat * DEG) / 2)); }
export function latFromMercY(y) { return (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) / DEG; }
export function lonFromMercX(x) { return x / R / DEG; }

const X0 = mercX(ORIGIN.lon);
const Y0 = mercY(ORIGIN.lat);

/** Mercator metres -> world x/z. */
export function mxToWorld(mx) { return (mx - X0) / 1000; }
export function myToWorld(my) { return -(my - Y0) / 1000; }

export function heightToWorld(altM, lat) {
  return (altM * view.vexag) / Math.cos(lat * DEG) / 1000;
}

export function toWorld(lat, lon, altM = 0, out = new THREE.Vector3()) {
  return out.set(mxToWorld(mercX(lon)), heightToWorld(altM, lat), myToWorld(mercY(lat)));
}

export function worldToLatLon(x, z) {
  return { lat: latFromMercY(-z * 1000 + Y0), lon: lonFromMercX(x * 1000 + X0) };
}

/** World units per nautical mile at a latitude (horizontal). */
export function worldPerNm(lat) { return 1.852 / Math.cos(lat * DEG); }

export const FT = 0.3048;

// Area bounds in world space (for camera clamping)
export const AREA_WORLD = {
  xMin: mxToWorld(mercX(AREA.lonMin)), xMax: mxToWorld(mercX(AREA.lonMax)),
  zMin: myToWorld(mercY(AREA.latMax)), zMax: myToWorld(mercY(AREA.latMin)),
};

// ---- slippy-map tiles
export function tileBoundsMerc(z, x, y) {
  const size = WORLD_M / 2 ** z;
  const minX = -WORLD_M / 2 + x * size;
  const maxY = WORLD_M / 2 - y * size;
  return { minX, maxX: minX + size, minY: maxY - size, maxY, size };
}

export function lonToTileX(lon, z) { return Math.floor(((lon + 180) / 360) * 2 ** z); }
export function latToTileY(lat, z) {
  const r = lat * DEG;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}
