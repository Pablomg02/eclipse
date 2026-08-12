/*
 * cloudlayer.js — Capa continua semitransparente a partir de una rejilla.
 *
 * La imagen se genera en el espacio de Mercator (no en lat/lon lineal) para
 * que encaje exactamente con el mapa, y se interpola bilinealmente para que
 * no se vean los cuadraditos de la rejilla de consulta.
 */
(function (global) {
  'use strict';

  var R = Math.PI / 180;

  function mercY(lat) {
    var l = Math.max(-85, Math.min(85, lat));
    return Math.log(Math.tan(Math.PI / 4 + l * R / 2));
  }
  function invMercY(y) {
    return (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / R;
  }

  /**
   * Muestreo bilineal de la rejilla. Devuelve NaN si no hay datos alrededor.
   * grid: {lat0, lon0, dLat, dLon, nx, ny, values:Float32Array}
   */
  function sample(grid, lat, lon) {
    var fx = (lon - grid.lon0) / grid.dLon;
    var fy = (lat - grid.lat0) / grid.dLat;
    if (fx < -0.5 || fy < -0.5 || fx > grid.nx - 0.5 || fy > grid.ny - 0.5) return NaN;
    fx = Math.max(0, Math.min(grid.nx - 1, fx));
    fy = Math.max(0, Math.min(grid.ny - 1, fy));
    var i0 = Math.floor(fx), j0 = Math.floor(fy);
    var i1 = Math.min(grid.nx - 1, i0 + 1), j1 = Math.min(grid.ny - 1, j0 + 1);
    var tx = fx - i0, ty = fy - j0;

    var v00 = grid.values[j0 * grid.nx + i0];
    var v10 = grid.values[j0 * grid.nx + i1];
    var v01 = grid.values[j1 * grid.nx + i0];
    var v11 = grid.values[j1 * grid.nx + i1];

    var sum = 0, wsum = 0;
    var add = function (v, w) { if (!isNaN(v)) { sum += v * w; wsum += w; } };
    add(v00, (1 - tx) * (1 - ty));
    add(v10, tx * (1 - ty));
    add(v01, (1 - tx) * ty);
    add(v11, tx * ty);
    return wsum > 0.25 ? sum / wsum : NaN;
  }

  /**
   * Genera una L.ImageOverlay con el campo interpolado.
   * @param grid   rejilla de valores
   * @param opts   {colorFn(value)->[r,g,b], alpha, supersample}
   */
  function build(grid, opts) {
    opts = opts || {};
    var S = opts.supersample || 14;
    var alpha = opts.alpha == null ? 0.55 : opts.alpha;
    var colorFn = opts.colorFn;

    var W = Math.max(2, grid.nx * S);
    var H = Math.max(2, grid.ny * S);

    var latMin = grid.lat0 - grid.dLat / 2;
    var latMax = grid.lat0 + (grid.ny - 1) * grid.dLat + grid.dLat / 2;
    var lonMin = grid.lon0 - grid.dLon / 2;
    var lonMax = grid.lon0 + (grid.nx - 1) * grid.dLon + grid.dLon / 2;

    var yTop = mercY(latMax), yBot = mercY(latMin);

    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d');
    var img = ctx.createImageData(W, H);
    var px = img.data;

    for (var r = 0; r < H; r++) {
      var y = yTop + (r + 0.5) / H * (yBot - yTop);
      var lat = invMercY(y);
      for (var c = 0; c < W; c++) {
        var lon = lonMin + (c + 0.5) / W * (lonMax - lonMin);
        var v = sample(grid, lat, lon);
        var o = (r * W + c) * 4;
        if (isNaN(v)) { px[o + 3] = 0; continue; }
        var rgb = colorFn(v);
        px[o] = rgb[0]; px[o + 1] = rgb[1]; px[o + 2] = rgb[2];
        px[o + 3] = Math.round(255 * alpha);
      }
    }
    ctx.putImageData(img, 0, 0);

    return L.imageOverlay(cv.toDataURL(), [[latMin, lonMin], [latMax, lonMax]], {
      opacity: 1,
      interactive: false,
      className: 'cloud-overlay',
      pane: opts.pane || 'overlayPane'
    });
  }

  /** Interpolacion de color sobre una rampa de paradas [{v, c:[r,g,b]}]. */
  function ramp(stops) {
    return function (v) {
      if (v <= stops[0].v) return stops[0].c;
      for (var i = 1; i < stops.length; i++) {
        if (v <= stops[i].v) {
          var a = stops[i - 1], b = stops[i];
          var f = (v - a.v) / (b.v - a.v);
          return [
            Math.round(a.c[0] + (b.c[0] - a.c[0]) * f),
            Math.round(a.c[1] + (b.c[1] - a.c[1]) * f),
            Math.round(a.c[2] + (b.c[2] - a.c[2]) * f)
          ];
        }
      }
      return stops[stops.length - 1].c;
    };
  }

  // Rampas: verde = bien, rojo = mal.
  var RAMP_SCORE = ramp([
    { v: 0, c: [176, 30, 55] },
    { v: 25, c: [226, 92, 34] },
    { v: 45, c: [232, 176, 20] },
    { v: 65, c: [138, 196, 24] },
    { v: 85, c: [26, 175, 100] },
    { v: 100, c: [12, 140, 80] }
  ]);

  var RAMP_CLOUD = ramp([
    { v: 0, c: [30, 150, 95] },
    { v: 20, c: [140, 196, 30] },
    { v: 40, c: [232, 180, 20] },
    { v: 65, c: [226, 96, 32] },
    { v: 85, c: [176, 32, 56] },
    { v: 100, c: [120, 20, 45] }
  ]);

  global.CloudLayer = {
    build: build,
    sample: sample,
    ramp: ramp,
    RAMP_SCORE: RAMP_SCORE,
    RAMP_CLOUD: RAMP_CLOUD
  };
})(typeof window !== 'undefined' ? window : globalThis);
