/*
 * build-data.js — precalcula la geometria del eclipse a un JSON estatico.
 *
 *   node tools/build-data.js
 *
 * Genera data/eclipse-2026-08-12.json con:
 *   - banda de totalidad (anillos cerrados, limites norte/sur)
 *   - linea central
 *   - curvas de ocultacion (50/80/90/95/99 %)
 *
 * Se precalcula para que el movil no tenga que hacer ~500k evaluaciones al
 * abrir la web. Las circunstancias del punto pinchado si se calculan en vivo.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const E = require('../js/besselian.js');

// Region cubierta: Atlantico norte + Europa occidental (donde el eclipse
// es visible desde tierra habitada de interes para el usuario).
const LAT0 = 25, LAT1 = 84;
const LON0 = -60, LON1 = 25;
const STEP = 0.1;

const NX = Math.round((LON1 - LON0) / STEP) + 1;
const NY = Math.round((LAT1 - LAT0) / STEP) + 1;

console.log(`Malla ${NX} x ${NY} = ${(NX * NY / 1e6).toFixed(2)}M puntos, paso ${STEP} deg`);

const lonOf = i => LON0 + i * STEP;
const latOf = j => LAT0 + j * STEP;

const margin = new Float32Array(NX * NY);   // >0 dentro de la totalidad
const obsc = new Float32Array(NX * NY);     // ocultacion 0-1 (0 si Sol bajo horizonte)
const alt = new Float32Array(NX * NY);      // altura del Sol en el maximo

const t0 = Date.now();
for (let j = 0; j < NY; j++) {
  const la = latOf(j);
  for (let i = 0; i < NX; i++) {
    const k = j * NX + i;
    const q = E.quick(la, lonOf(i));
    if (!q) { margin[k] = -1; obsc[k] = 0; alt[k] = -90; continue; }
    alt[k] = q.sunAlt;
    // margen de totalidad limitado ademas por el horizonte (limite de ocaso)
    margin[k] = Math.min(q.margin * 200, q.sunAlt);
    obsc[k] = q.sunAlt > 0 ? q.obscuration : 0;
  }
  if (j % 100 === 0) process.stdout.write(`  fila ${j}/${NY}\r`);
}
console.log(`\nCampo calculado en ${((Date.now() - t0) / 1000).toFixed(1)} s`);

/* ---------------------------------------------------------------- contornos */

// Tabla marching squares. Aristas: 0=abajo 1=derecha 2=arriba 3=izquierda
const MS = [
  [], [[3, 0]], [[0, 1]], [[3, 1]],
  [[1, 2]], [[3, 2], [0, 1]], [[0, 2]], [[3, 2]],
  [[2, 3]], [[2, 0]], [[0, 3], [2, 1]], [[2, 1]],
  [[1, 3]], [[1, 0]], [[0, 3]], []
];

/**
 * Marching squares con padding exterior, de modo que todos los contornos
 * salen cerrados. Devuelve polilineas en coordenadas [lon, lat].
 */
function contour(field, level) {
  // valor en la malla ampliada con un borde "exterior"
  const OUT = -1e9;
  const val = (i, j) => {
    if (i < 0 || j < 0 || i >= NX || j >= NY) return OUT;
    return field[j * NX + i];
  };
  const px = (i, j) => [lonOf(i), latOf(j)];

  const hCache = new Map(); // aristas horizontales (i,j)-(i+1,j)
  const vCache = new Map(); // aristas verticales   (i,j)-(i,j+1)

  function hCross(i, j) {
    const key = i + ',' + j;
    let p = hCache.get(key);
    if (!p) {
      const a = val(i, j), b = val(i + 1, j);
      let f = (level - a) / (b - a);
      if (!isFinite(f)) f = 0.5;
      f = Math.max(0, Math.min(1, f));
      p = { id: 'h' + key, xy: [lonOf(i) + f * STEP, latOf(j)], i, j, f, dir: 'h' };
      hCache.set(key, p);
    }
    return p;
  }
  function vCross(i, j) {
    const key = i + ',' + j;
    let p = vCache.get(key);
    if (!p) {
      const a = val(i, j), b = val(i, j + 1);
      let f = (level - a) / (b - a);
      if (!isFinite(f)) f = 0.5;
      f = Math.max(0, Math.min(1, f));
      p = { id: 'v' + key, xy: [lonOf(i), latOf(j) + f * STEP], i, j, f, dir: 'v' };
      vCache.set(key, p);
    }
    return p;
  }

  const segs = [];
  for (let j = -1; j < NY; j++) {
    for (let i = -1; i < NX; i++) {
      const c00 = val(i, j) >= level ? 1 : 0;
      const c10 = val(i + 1, j) >= level ? 2 : 0;
      const c11 = val(i + 1, j + 1) >= level ? 4 : 0;
      const c01 = val(i, j + 1) >= level ? 8 : 0;
      const idx = c00 | c10 | c11 | c01;
      if (idx === 0 || idx === 15) continue;
      const edge = e => {
        if (e === 0) return hCross(i, j);
        if (e === 1) return vCross(i + 1, j);
        if (e === 2) return hCross(i, j + 1);
        return vCross(i, j);
      };
      for (const [a, b] of MS[idx]) segs.push([edge(a), edge(b)]);
    }
  }
  return chain(segs);
}

/** Encadena segmentos que comparten vertices exactos en polilineas. */
function chain(segs) {
  const byId = new Map();
  segs.forEach((s, n) => {
    for (const p of s) {
      if (!byId.has(p.id)) byId.set(p.id, []);
      byId.get(p.id).push(n);
    }
  });
  const used = new Array(segs.length).fill(false);
  const lines = [];

  function walk(startSeg, startPoint) {
    const pts = [startPoint];
    let segN = startSeg, cur = startPoint;
    while (segN !== undefined && !used[segN]) {
      used[segN] = true;
      const s = segs[segN];
      const next = s[0].id === cur.id ? s[1] : s[0];
      pts.push(next);
      cur = next;
      segN = (byId.get(cur.id) || []).find(n => !used[n]);
    }
    return pts;
  }

  // primero los contornos abiertos (extremos con una sola conexion)
  for (const [, list] of byId) {
    if (list.length !== 1) continue;
    const n = list[0];
    if (used[n]) continue;
    const s = segs[n];
    const start = (byId.get(s[0].id) || []).length === 1 ? s[0] : s[1];
    lines.push(walk(n, start));
  }
  // luego los cerrados
  for (let n = 0; n < segs.length; n++) {
    if (used[n]) continue;
    lines.push(walk(n, segs[n][0]));
  }
  return lines.filter(l => l.length > 2);
}

/** Refina un vertice del contorno de totalidad por biseccion sobre la arista. */
function refineTotality(p) {
  const A = p.dir === 'h' ? [latOf(p.j), lonOf(p.i)] : [latOf(p.j), lonOf(p.i)];
  const B = p.dir === 'h' ? [latOf(p.j), lonOf(p.i + 1)] : [latOf(p.j + 1), lonOf(p.i)];
  const f = ll => {
    const q = E.quick(ll[0], ll[1]);
    return q ? Math.min(q.margin * 200, q.sunAlt) : -1e9;
  };
  let a = A, b = B, fa = f(A);
  if ((fa >= 0) === (f(B) >= 0)) return p.xy;   // sin cambio de signo: dejar
  for (let k = 0; k < 18; k++) {
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if ((f(m) >= 0) === (fa >= 0)) a = m; else b = m;
  }
  return [(a[1] + b[1]) / 2, (a[0] + b[0]) / 2];
}

/** Douglas-Peucker sobre [lon,lat]. */
function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const sqd = (p, a, b) => {
    let x = a[0], y = a[1], dx = b[0] - x, dy = b[1] - y;
    if (dx || dy) {
      const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) { x = b[0]; y = b[1]; }
      else if (t > 0) { x += dx * t; y += dy * t; }
    }
    dx = p[0] - x; dy = p[1] - y;
    return dx * dx + dy * dy;
  };
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  const e2 = eps * eps;
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = 0, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = sqd(pts[i], pts[s], pts[e]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > e2 && idx > 0) {
      keep[idx] = true;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

const round = (pts, n) => pts.map(p => [+p[1].toFixed(n), +p[0].toFixed(n)]); // -> [lat,lon]

/* ------------------------------------------------------------- totalidad */

console.log('Contorno de totalidad...');
let rings = contour(margin, 0)
  .map(line => line.map(refineTotality))
  .map(line => simplify(line, 0.002))
  .filter(line => line.length > 8);
rings.sort((a, b) => b.length - a.length);
console.log(`  ${rings.length} anillo(s), vertices: ${rings.map(r => r.length).join(', ')}`);

/* ----------------------------------------------------------- linea central */

console.log('Linea central...');
const centerline = [];
const centerMeta = [];
for (let t = -3; t <= 3; t += 1 / 240) {
  const p = E.centralPoint(t);
  if (!p) continue;
  if (p.lat < LAT0 || p.lat > LAT1 || p.lon < LON0 || p.lon > LON1) continue;
  const q = E.quick(p.lat, p.lon);
  if (!q || !q.total || q.sunAlt <= 0) continue;
  centerline.push([+p.lat.toFixed(4), +p.lon.toFixed(4)]);
}
// puntos etiquetables cada ~2 minutos con duracion de la totalidad
for (let t = -3; t <= 3; t += 1 / 30) {
  const p = E.centralPoint(t);
  if (!p) continue;
  if (p.lat < LAT0 || p.lat > LAT1 || p.lon < LON0 || p.lon > LON1) continue;
  const c = E.circumstances(p.lat, p.lon, 0);
  if (!c || !c.total || c.sunAlt <= 0) continue;
  centerMeta.push({
    lat: +p.lat.toFixed(3), lon: +p.lon.toFixed(3),
    ut: c.max.toISOString().substr(11, 8),
    dur: +c.duration.toFixed(1),
    alt: +c.sunAlt.toFixed(1)
  });
}
console.log(`  ${centerline.length} vertices, ${centerMeta.length} marcas`);

/* --------------------------------------------------------- ocultacion */

console.log('Curvas de ocultacion...');
const levels = [0.5, 0.8, 0.9, 0.95, 0.99];
const contours = {};
for (const lv of levels) {
  const lines = contour(obsc, lv)
    .map(line => line.map(p => p.xy))
    .map(line => simplify(line, 0.05))
    .filter(line => line.length > 4);
  // cortar los tramos que discurren pegados al terminador (Sol bajo el horizonte)
  const out = [];
  for (const line of lines) {
    let run = [];
    for (const p of line) {
      const q = E.quick(p[1], p[0]);
      if (q && q.sunAlt > 0.75) run.push(p);
      else { if (run.length > 4) out.push(run); run = []; }
    }
    if (run.length > 4) out.push(run);
  }
  contours[String(lv)] = out.map(l => round(l, 3));
  console.log(`  ${(lv * 100).toFixed(0)}%: ${out.length} tramo(s), ${out.reduce((s, l) => s + l.length, 0)} vertices`);
}

/* --------------------------------------------------------------- salida */

const data = {
  eclipse: E.E.label,
  generated: new Date().toISOString(),
  source: 'Elementos besselianos NASA/GSFC (Espenak & Meeus), Five Millennium Canon',
  bbox: [LAT0, LON0, LAT1, LON1],
  totality: rings.map(r => round(r, 4)),
  centerline: centerline,
  centerMeta: centerMeta,
  obscurationContours: contours
};

const outPath = path.join(__dirname, '..', 'data', 'eclipse-2026-08-12.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(data));
console.log(`\nEscrito ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(0)} KB)`);
