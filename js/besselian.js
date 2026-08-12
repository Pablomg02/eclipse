/*
 * besselian.js — Geometria del eclipse total de Sol del 12 de agosto de 2026.
 *
 * Calcula circunstancias locales (contactos, magnitud, ocultacion, altura y
 * azimut del Sol) a partir de los elementos besselianos publicados por la NASA
 * (Five Millennium Canon of Solar Eclipses, Espenak & Meeus).
 *
 * Fuente de los elementos:
 *   https://eclipse.gsfc.nasa.gov/SEbeselm/SEbeselm2001/SE2026Aug12Tbeselm.html
 *
 * Convenios: longitud ESTE positiva, t en horas desde t0 en escala TDT.
 */
(function (global) {
  'use strict';

  var DEG = Math.PI / 180;
  var FLAT = 1 / 298.257223563;          // achatamiento WGS84
  var ONE_F = 1 - FLAT;                  // 0.99664719
  var CFLAT = 1 / (ONE_F * ONE_F);       // 1.0067395
  var EARTH_R = 6378.137;                // km, radio ecuatorial

  var E = {
    label: 'Eclipse total de Sol — 12 de agosto de 2026',
    t0: 18.0,                            // hora TDT de referencia
    deltaT: 71.4,                        // segundos (TDT - UT)
    baseUTC: Date.UTC(2026, 7, 12, 0, 0, 0),
    // coeficientes polinomicos a0 + a1*t + a2*t^2 + a3*t^3
    x:  [0.475593, 0.5189288, -0.0000773, -0.0000088],
    y:  [0.771161, -0.2301664, -0.0001245, 0.0000037],
    d:  [14.79667, -0.012065, -0.000003],
    l1: [0.537954, 0.0000940, -0.0000121],
    l2: [-0.008142, 0.0000935, -0.0000121],
    mu: [88.74776, 15.003093, 0.0],
    tanF1: 0.0046141,
    tanF2: 0.0045911,
    // validez de los polinomios: 15h - 21h TDT
    tMin: -3,
    tMax: 3
  };

  // 1.002738 * 15 / 3600 -> grados de rotacion terrestre por segundo de deltaT
  var DT_ROT = 0.00417807 * E.deltaT;

  function poly(c, t) {
    var v = 0;
    for (var i = c.length - 1; i >= 0; i--) v = v * t + c[i];
    return v;
  }

  function dpoly(c, t) {
    var v = 0;
    for (var i = c.length - 1; i >= 1; i--) v = v * t + i * c[i];
    return v;
  }

  /** Elementos besselianos y sus derivadas (por hora) en el instante t. */
  function elements(t) {
    return {
      t: t,
      x: poly(E.x, t), y: poly(E.y, t), d: poly(E.d, t),
      l1: poly(E.l1, t), l2: poly(E.l2, t), mu: poly(E.mu, t),
      xd: dpoly(E.x, t), yd: dpoly(E.y, t), dd: dpoly(E.d, t),
      mud: dpoly(E.mu, t)
    };
  }

  /** Coordenadas geocentricas rho*sin(phi'), rho*cos(phi') del observador. */
  function observer(lat, elevM) {
    var latR = lat * DEG;
    var u1 = Math.atan(ONE_F * Math.tan(latR));
    var h = (elevM || 0) / 6378140;
    return {
      lat: lat,
      rsp: ONE_F * Math.sin(u1) + h * Math.sin(latR),
      rcp: Math.cos(u1) + h * Math.cos(latR)
    };
  }

  /** Estado del eclipse (coordenadas u,v en el plano fundamental) en t. */
  function state(t, obs, lon) {
    var e = elements(t);
    var d = e.d * DEG;
    var H = (e.mu + lon - DT_ROT) * DEG;   // angulo horario local
    var sinH = Math.sin(H), cosH = Math.cos(H);
    var sind = Math.sin(d), cosd = Math.cos(d);

    var xi = obs.rcp * sinH;
    var eta = obs.rsp * cosd - obs.rcp * cosH * sind;
    var zeta = obs.rsp * sind + obs.rcp * cosH * cosd;

    var mudR = e.mud * DEG, ddR = e.dd * DEG;
    var xid = mudR * obs.rcp * cosH;
    var etad = mudR * xi * sind - zeta * ddR;

    var u = e.x - xi, v = e.y - eta;
    var ud = e.xd - xid, vd = e.yd - etad;
    var n2 = ud * ud + vd * vd;

    return {
      t: t, e: e, H: H, zeta: zeta,
      u: u, v: v, ud: ud, vd: vd,
      n2: n2, n: Math.sqrt(n2),
      m: Math.sqrt(u * u + v * v),
      L1: e.l1 - zeta * E.tanF1,
      L2: e.l2 - zeta * E.tanF2
    };
  }

  /** Altura y azimut (desde el norte, hacia el este) del Sol. */
  function sunPosition(s, lat) {
    var d = s.e.d * DEG, phi = lat * DEG;
    var sinAlt = Math.sin(phi) * Math.sin(d) +
                 Math.cos(phi) * Math.cos(d) * Math.cos(s.H);
    sinAlt = Math.max(-1, Math.min(1, sinAlt));
    var alt = Math.asin(sinAlt) / DEG;
    var az = Math.atan2(
      -Math.cos(d) * Math.sin(s.H),
      Math.sin(d) * Math.cos(phi) - Math.cos(d) * Math.sin(phi) * Math.cos(s.H)
    ) / DEG;
    return { alt: alt, az: (az + 360) % 360 };
  }

  /** Fraccion del AREA solar cubierta (0-1) para separacion m. */
  function obscuration(m, L1, L2) {
    var rs = (L1 + L2) / 2;              // radio aparente del Sol
    var rm = (L1 - L2) / 2;              // radio aparente de la Luna
    if (rs <= 0) return 0;
    if (m >= rs + rm) return 0;
    if (m <= Math.abs(rm - rs)) return rm >= rs ? 1 : (rm * rm) / (rs * rs);
    var a1 = rs * rs * Math.acos((m * m + rs * rs - rm * rm) / (2 * m * rs));
    var a2 = rm * rm * Math.acos((m * m + rm * rm - rs * rs) / (2 * m * rm));
    var a3 = 0.5 * Math.sqrt(
      (-m + rs + rm) * (m + rs - rm) * (m - rs + rm) * (m + rs + rm)
    );
    return (a1 + a2 - a3) / (Math.PI * rs * rs);
  }

  /** Instante de maximo eclipse (t en horas TDT desde t0). */
  function maximumTime(obs, lon) {
    var t = -0.25;
    for (var i = 0; i < 12; i++) {
      var s = state(t, obs, lon);
      var tau = -(s.u * s.ud + s.v * s.vd) / s.n2;
      t += tau;
      if (Math.abs(tau) < 1e-9) break;
      if (t < E.tMin || t > E.tMax) return null;
    }
    return t;
  }

  /**
   * Instante de contacto. which: 1 = penumbra (L1), 2 = umbra (L2).
   * dir: -1 = contacto de entrada, +1 = contacto de salida.
   */
  function contactTime(obs, lon, tMax, which, dir) {
    var t = tMax;
    for (var i = 0; i < 14; i++) {
      var s = state(t, obs, lon);
      var L = Math.abs(which === 1 ? s.L1 : s.L2);
      var delta = (s.u * s.vd - s.v * s.ud) / s.n;
      var disc = L * L - delta * delta;
      if (disc < 0) return null;
      var tau = -(s.u * s.ud + s.v * s.vd) / s.n2 + dir * Math.sqrt(disc) / s.n;
      var tn = t + tau;
      if (!isFinite(tn)) return null;
      var conv = Math.abs(tn - t) < 1e-9;
      t = tn;
      if (conv) break;
    }
    if (t < E.tMin || t > E.tMax) return null;
    return t;
  }

  /** Convierte t (horas TDT desde t0) a Date UTC. */
  function tToDate(t) {
    var utHours = E.t0 + t - E.deltaT / 3600;
    return new Date(E.baseUTC + utHours * 3600000);
  }

  /**
   * Circunstancias locales completas para un punto.
   * @returns {Object|null} null si el eclipse no es visible en ese punto.
   */
  function circumstances(lat, lon, elevM) {
    var obs = observer(lat, elevM);
    var tMax = maximumTime(obs, lon);
    if (tMax === null) return null;

    var s = state(tMax, obs, lon);
    var sun = sunPosition(s, lat);
    var mag = (s.L1 - s.m) / (s.L1 + s.L2);
    if (mag <= 0) return null;                       // sin eclipse

    var obsc = obscuration(s.m, s.L1, s.L2);
    var isTotal = s.L2 < 0 && s.m < Math.abs(s.L2);
    var isAnnular = s.L2 > 0 && s.m < s.L2;

    var res = {
      lat: lat, lon: lon, elev: elevM || 0,
      tMax: tMax,
      max: tToDate(tMax),
      magnitude: mag,
      obscuration: obsc,
      total: isTotal,
      annular: isAnnular,
      sunAlt: sun.alt,
      sunAz: sun.az,
      visible: sun.alt > -0.85,          // > -0.85 deg: disco aun asomando
      c1: null, c2: null, c3: null, c4: null,
      duration: 0,
      sunAltC2: null
    };

    var t1 = contactTime(obs, lon, tMax, 1, -1);
    var t4 = contactTime(obs, lon, tMax, 1, +1);
    if (t1 !== null) res.c1 = tToDate(t1);
    if (t4 !== null) res.c4 = tToDate(t4);

    if (isTotal || isAnnular) {
      var t2 = contactTime(obs, lon, tMax, 2, -1);
      var t3 = contactTime(obs, lon, tMax, 2, +1);
      if (t2 !== null && t3 !== null) {
        res.c2 = tToDate(t2);
        res.c3 = tToDate(t3);
        res.duration = (t3 - t2) * 3600;             // segundos
        var s2 = state(t2, obs, lon);
        res.sunAltC2 = sunPosition(s2, lat).alt;
      }
    }
    // altura del Sol en los contactos exteriores (util al atardecer)
    if (t1 !== null) res.sunAltC1 = sunPosition(state(t1, obs, lon), lat).alt;
    if (t4 !== null) res.sunAltC4 = sunPosition(state(t4, obs, lon), lat).alt;

    return res;
  }

  /**
   * Version rapida (sin contactos) para mallas y contornos.
   * margin > 0 dentro de la banda de totalidad.
   */
  function quick(lat, lon) {
    var obs = observer(lat, 0);
    var tMax = maximumTime(obs, lon);
    if (tMax === null) return null;
    var s = state(tMax, obs, lon);
    var sun = sunPosition(s, lat);
    // En el maximo el vector (u,v) es perpendicular a la velocidad, asi que
    // la duracion sale directa sin iterar los contactos (error < 1 %).
    var d2 = s.L2 * s.L2 - s.m * s.m;
    var approxDur = (s.L2 < 0 && d2 > 0) ? 2 * Math.sqrt(d2) / s.n * 3600 : 0;
    return {
      tMax: tMax,
      duration: approxDur,
      margin: Math.abs(s.L2) - s.m,
      magnitude: (s.L1 - s.m) / (s.L1 + s.L2),
      obscuration: obscuration(s.m, s.L1, s.L2),
      sunAlt: sun.alt,
      sunAz: sun.az,
      total: s.L2 < 0 && s.m < Math.abs(s.L2)
    };
  }

  /** Test rapido: ¿hay totalidad con el Sol sobre el horizonte? */
  function isTotalAt(lat, lon) {
    var q = quick(lat, lon);
    return !!q && q.total && q.sunAlt > 0;
  }

  /**
   * Punto donde el eje de la sombra corta la superficie terrestre en t.
   * Resuelve analiticamente la interseccion del eje (xi=x, eta=y) con el
   * elipsoide: A^2 + B^2 + C^2/(1-f)^2 = 1.
   */
  function centralPoint(t) {
    var e = elements(t);
    var d = e.d * DEG;
    var cd = Math.cos(d), sd = Math.sin(d);
    var P = cd * cd + CFLAT * sd * sd;
    var Q = (CFLAT - 1) * sd * cd;
    var R = sd * sd + CFLAT * cd * cd;
    var xi = e.x, eta = e.y;

    var a = P, b = 2 * Q * eta, c = R * eta * eta + xi * xi - 1;
    var disc = b * b - 4 * a * c;
    if (disc < 0) return null;                       // el eje no toca la Tierra
    var zeta = (-b + Math.sqrt(disc)) / (2 * a);
    if (zeta <= 0) return null;                      // cara oculta

    var A = zeta * cd - eta * sd;
    var B = xi;
    var C = zeta * sd + eta * cd;

    var rcp = Math.sqrt(A * A + B * B);
    var H = Math.atan2(B, A) / DEG;
    var latGeo = Math.atan2(C, rcp) / DEG;
    var lat = Math.atan(Math.tan(latGeo * DEG) * CFLAT) / DEG;
    var lon = normLon(H - e.mu + DT_ROT);
    return { lat: lat, lon: lon, t: t, date: tToDate(t) };
  }

  function normLon(lon) {
    return ((lon + 180) % 360 + 360) % 360 - 180;
  }

  /** Punto a distancia km y rumbo bearing (grados) desde lat/lon. */
  function destination(lat, lon, bearing, km) {
    var d = km / EARTH_R;
    var br = bearing * DEG, la = lat * DEG, lo = lon * DEG;
    var sinLa = Math.sin(la) * Math.cos(d) +
                Math.cos(la) * Math.sin(d) * Math.cos(br);
    var la2 = Math.asin(Math.max(-1, Math.min(1, sinLa)));
    var lo2 = lo + Math.atan2(
      Math.sin(br) * Math.sin(d) * Math.cos(la),
      Math.cos(d) - Math.sin(la) * sinLa
    );
    return { lat: la2 / DEG, lon: normLon(lo2 / DEG) };
  }

  function bearingBetween(a, b) {
    var la1 = a.lat * DEG, la2 = b.lat * DEG;
    var dl = (b.lon - a.lon) * DEG;
    var y = Math.sin(dl) * Math.cos(la2);
    var x = Math.cos(la1) * Math.sin(la2) -
            Math.sin(la1) * Math.cos(la2) * Math.cos(dl);
    return (Math.atan2(y, x) / DEG + 360) % 360;
  }

  /**
   * Busca el limite de la banda de totalidad partiendo del punto central
   * y avanzando con rumbo `bearing`. Devuelve el punto limite o null.
   */
  function findLimit(center, bearing, maxKm) {
    var step = 20, lastIn = 0, firstOut = null;
    for (var km = step; km <= maxKm; km += step) {
      var p = destination(center.lat, center.lon, bearing, km);
      if (isTotalAt(p.lat, p.lon)) {
        lastIn = km;
      } else {
        firstOut = km;
        break;
      }
    }
    if (firstOut === null) return null;              // no se cerro la banda
    for (var i = 0; i < 14; i++) {                   // biseccion
      var mid = (lastIn + firstOut) / 2;
      var q = destination(center.lat, center.lon, bearing, mid);
      if (isTotalAt(q.lat, q.lon)) lastIn = mid; else firstOut = mid;
    }
    var out = destination(center.lat, center.lon, bearing, (lastIn + firstOut) / 2);
    out.width = lastIn;
    return out;
  }

  /**
   * Construye la banda de totalidad: linea central y limites norte/sur.
   * @param {Object} opts {stepMin, maxKm}
   */
  function buildPath(opts) {
    opts = opts || {};
    var stepMin = opts.stepMin || 1;
    var maxKm = opts.maxKm || 500;
    var dt = stepMin / 60;

    var centers = [];
    for (var t = E.tMin; t <= E.tMax + 1e-9; t += dt) {
      var p = centralPoint(t);
      if (p && isTotalAt(p.lat, p.lon)) centers.push(p);
    }
    if (!centers.length) return null;

    var north = [], south = [], center = [], durations = [];
    for (var i = 0; i < centers.length; i++) {
      var c = centers[i];
      var prev = centers[Math.max(0, i - 1)];
      var next = centers[Math.min(centers.length - 1, i + 1)];
      var course = (prev === next) ? 90 : bearingBetween(prev, next);

      var nLim = findLimit(c, (course - 90 + 360) % 360, maxKm);
      var sLim = findLimit(c, (course + 90) % 360, maxKm);
      if (!nLim || !sLim) continue;

      center.push([c.lat, c.lon]);
      north.push([nLim.lat, nLim.lon]);
      south.push([sLim.lat, sLim.lon]);
      durations.push({
        lat: c.lat, lon: c.lon, date: c.date,
        widthKm: nLim.width + sLim.width
      });
    }

    return {
      center: center,
      north: north,
      south: south,
      meta: durations,
      polygon: north.concat(south.slice().reverse())
    };
  }

  global.Eclipse = {
    E: E,
    elements: elements,
    circumstances: circumstances,
    quick: quick,
    isTotalAt: isTotalAt,
    centralPoint: centralPoint,
    buildPath: buildPath,
    destination: destination,
    bearingBetween: bearingBetween,
    tToDate: tToDate,
    obscuration: obscuration
  };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.Eclipse;
}
