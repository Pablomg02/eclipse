/*
 * weather.js — Cliente de Open-Meteo y modelo de puntuacion de observacion.
 *
 * Ideas clave:
 *  - No basta con "cloud_cover". Con el Sol a 2-12 grados sobre el horizonte lo
 *    que tapa el Sol no son las nubes que tienes ENCIMA, sino las que hay en la
 *    linea de vision hacia el oeste. Por eso se muestrea la nubosidad en el
 *    azimut solar, a la distancia a la que cada capa intercepta esa linea.
 *  - Se consultan varios modelos para tener consenso/dispersion.
 */
(function (global) {
  'use strict';

  var API = 'https://api.open-meteo.com/v1/forecast';
  var ELEV_API = 'https://api.open-meteo.com/v1/elevation';

  var MODELS = [
    { id: 'ecmwf_ifs025', name: 'ECMWF' },
    { id: 'icon_seamless', name: 'ICON' },
    { id: 'gfs_seamless', name: 'GFS' },
    { id: 'meteofrance_seamless', name: 'AROME/ARPEGE' },
    { id: 'ukmo_seamless', name: 'UKMO' }
  ];
  // Para la malla se usan menos modelos: menos carga y respuesta mas rapida.
  var GRID_MODELS = ['ecmwf_ifs025', 'icon_seamless', 'gfs_seamless'];

  var HOURLY = ['cloud_cover', 'cloud_cover_low', 'cloud_cover_mid',
                'cloud_cover_high', 'visibility', 'precipitation_probability'];
  var GRID_HOURLY = ['cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high'];

  var DAY = '2026-08-12';
  var START_HOUR = DAY + 'T15:00';
  var END_HOUR = DAY + 'T21:00';

  // Altura tipica del centro de cada capa de nubes (km) segun Open-Meteo:
  // bajas < 2 km, medias 2-6 km, altas > 6 km.
  var LAYER_H = { low: 1.2, mid: 4.0, high: 9.0 };
  // Opacidad efectiva de cada capa frente al disco solar.
  var OPACITY = { low: 0.95, mid: 0.80, high: 0.45 };

  var EARTH_R = 6371.0;

  /* ------------------------------------------------------------- utilidades */

  function qs(params) {
    return Object.keys(params)
      .map(function (k) { return k + '=' + encodeURIComponent(params[k]); })
      .join('&');
  }

  /*
   * Red, cache y cuota.
   *
   * El plan gratuito de Open-Meteo limita por IP (unas 5.000 unidades/hora,
   * 10.000/dia) y cada peticion cuesta puntos x variables x modelos. Al
   * agotarla responde 429 a TODO -- tambien a la API de elevacion -- y la web
   * entera se queda sin datos. Por eso aqui se hace tres cosas:
   *   - cachear respuestas: la prevision no cambia cada minuto,
   *   - recordar el 429 para no gastar peticiones que ya se sabe que fallan,
   *   - propagar el motivo real del error, no un "no hay conexion" generico.
   */
  var CACHE_TTL = 10 * 60 * 1000;
  // Tras un 429 se deja de pedir durante un rato. No se espera a la hora en
  // punto porque el limite no se comporta como un contador que se ponga a cero
  // ahi: si se comparte IP (CGNAT, wifi publica) puede liberarse antes o
  // despues. Cinco minutos evitan machacar la API sin dejar la web muerta.
  var QUOTA_COOLDOWN = 5 * 60 * 1000;
  var cache = new Map();
  var quotaUntil = 0;

  /** Instante en que se volvera a intentar, o 0 si la cuota no esta agotada. */
  function quotaBlockedUntil() {
    return quotaUntil > Date.now() ? quotaUntil : 0;
  }

  /** Olvida el bloqueo para permitir un reintento manual. */
  function clearQuotaBlock() { quotaUntil = 0; }

  function apiError(status, reason, url) {
    var e = new Error(reason || ('HTTP ' + status + ' en ' + url.split('?')[0]));
    e.status = status;
    e.reason = reason || null;
    return e;
  }

  function request(url) {
    return fetch(url).then(function (r) {
      if (r.ok) return r.json();
      // Open-Meteo explica el motivo en el cuerpo, incluso en los 4xx.
      return r.text().then(function (body) {
        var reason = null;
        try { reason = JSON.parse(body).reason; } catch (e) { /* cuerpo no JSON */ }
        if (r.status === 429) quotaUntil = Date.now() + QUOTA_COOLDOWN;
        throw apiError(r.status, reason, url);
      });
    });
  }

  function getJSON(url) {
    var hit = cache.get(url);
    if (hit && Date.now() - hit.t < CACHE_TTL) return hit.p;
    if (quotaBlockedUntil()) {
      return Promise.reject(apiError(429,
        'Cuota horaria de Open-Meteo agotada para esta red.', url));
    }
    var p = request(url);
    cache.set(url, { t: Date.now(), p: p });
    p.catch(function () {
      var c = cache.get(url);
      if (c && c.p === p) cache.delete(url);      // los fallos no se cachean
    });
    return p;
  }

  function chunk(arr, n) {
    var out = [];
    for (var i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  }

  /** Interpola linealmente una serie horaria en una fecha concreta. */
  function interpAt(times, values, date) {
    if (!times || !values) return null;
    var target = date.getTime();
    for (var i = 0; i < times.length - 1; i++) {
      var t0 = times[i], t1 = times[i + 1];
      if (target >= t0 && target <= t1) {
        var v0 = values[i], v1 = values[i + 1];
        if (v0 == null && v1 == null) return null;
        if (v0 == null) return v1;
        if (v1 == null) return v0;
        var f = (target - t0) / (t1 - t0);
        return v0 + (v1 - v0) * f;
      }
    }
    return null;
  }

  /** Convierte el array de horas ISO (UTC) de Open-Meteo a epoch ms. */
  function parseTimes(list) {
    return list.map(function (s) { return Date.parse(s + ':00Z'); });
  }

  /** Nombre de la clave horaria de un modelo concreto. */
  function key(base, model, nModels) {
    return nModels > 1 ? base + '_' + model : base;
  }

  /* ----------------------------------------------- geometria linea de vision */

  function destination(lat, lon, bearingDeg, km) {
    var R = Math.PI / 180;
    var d = km / EARTH_R, br = bearingDeg * R, la = lat * R, lo = lon * R;
    var sinLa = Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(br);
    var la2 = Math.asin(Math.max(-1, Math.min(1, sinLa)));
    var lo2 = lo + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(la),
                              Math.cos(d) - Math.sin(la) * sinLa);
    return { lat: la2 / R, lon: ((lo2 / R + 540) % 360) - 180 };
  }

  /**
   * Distancia horizontal a la que la linea de vision al Sol cruza una capa
   * de nubes situada a `hKm` de altura, con el Sol a `altDeg` de altura.
   */
  function layerDistance(hKm, altDeg) {
    var a = Math.max(altDeg, 0.4) * Math.PI / 180;
    var d = hKm / Math.tan(a);
    return Math.min(d, 220);           // mas alla de 220 km la prevision local ya no aplica
  }

  /** Puntos a consultar para un observador: el propio punto + la linea de vision. */
  function sightlinePoints(lat, lon, sunAlt, sunAz) {
    return {
      here: { lat: lat, lon: lon },
      low: destination(lat, lon, sunAz, layerDistance(LAYER_H.low, sunAlt)),
      mid: destination(lat, lon, sunAz, layerDistance(LAYER_H.mid, sunAlt)),
      high: destination(lat, lon, sunAz, layerDistance(LAYER_H.high, sunAlt)),
      dist: {
        low: layerDistance(LAYER_H.low, sunAlt),
        mid: layerDistance(LAYER_H.mid, sunAlt),
        high: layerDistance(LAYER_H.high, sunAlt)
      }
    };
  }

  /* ---------------------------------------------------------------- consultas */

  /**
   * Previsión multimodelo para una lista de puntos.
   * @returns {Promise<Array>} un objeto por punto: {models: {id: {times, vars}}}
   */
  function fetchForecast(points, models, vars) {
    var groups = chunk(points, 100);
    var reqs = groups.map(function (g) {
      var url = API + '?' + qs({
        latitude: g.map(function (p) { return p.lat.toFixed(4); }).join(','),
        longitude: g.map(function (p) { return p.lon.toFixed(4); }).join(','),
        hourly: vars.join(','),
        models: models.join(','),
        timezone: 'UTC',
        start_hour: START_HOUR,
        end_hour: END_HOUR
      });
      return getJSON(url).then(function (res) {
        return Array.isArray(res) ? res : [res];
      });
    });

    return Promise.all(reqs).then(function (parts) {
      var flat = [].concat.apply([], parts);
      return flat.map(function (r) {
        var out = { lat: r.latitude, lon: r.longitude, elevation: r.elevation, models: {} };
        if (!r.hourly) return out;
        var times = parseTimes(r.hourly.time);
        models.forEach(function (m) {
          var entry = { times: times };
          var any = false;
          vars.forEach(function (v) {
            var k = key(v, m, models.length);
            var series = r.hourly[k];
            if (series) { entry[v] = series; any = true; }
          });
          if (any) out.models[m] = entry;
        });
        return out;
      });
    });
  }

  /** Serie a 15 minutos (mejor modelo disponible) para el punto seleccionado. */
  function fetchMinutely15(lat, lon) {
    var url = API + '?' + qs({
      latitude: lat.toFixed(4), longitude: lon.toFixed(4),
      minutely_15: 'cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility',
      timezone: 'UTC',
      start_hour: START_HOUR,
      end_hour: END_HOUR
    });
    return getJSON(url).then(function (r) {
      if (!r.minutely_15) return null;
      return { times: parseTimes(r.minutely_15.time), v: r.minutely_15 };
    }).catch(function () { return null; });
  }

  /** Elevaciones del terreno (DEM Copernicus ~90 m) para una lista de puntos. */
  function fetchElevations(points) {
    var groups = chunk(points, 100);
    var reqs = groups.map(function (g) {
      var url = ELEV_API + '?' + qs({
        latitude: g.map(function (p) { return p.lat.toFixed(5); }).join(','),
        longitude: g.map(function (p) { return p.lon.toFixed(5); }).join(',')
      });
      return getJSON(url).then(function (r) { return r.elevation || []; });
    });
    return Promise.all(reqs).then(function (parts) {
      return [].concat.apply([], parts);
    });
  }

  /**
   * Perfil del horizonte en el azimut solar. Devuelve la altura angular
   * maxima del terreno y el punto que la provoca.
   */
  var HORIZON_D = [0.2, 0.4, 0.7, 1, 1.5, 2, 3, 4, 5, 6.5, 8, 10, 13, 16, 20, 25, 32, 40, 50, 65];
  var NEAR_KM = 1;   // por debajo de 1 km es relieve local: te apartas y ya

  function fetchHorizon(lat, lon, sunAz) {
    var pts = [{ lat: lat, lon: lon }].concat(HORIZON_D.map(function (d) {
      return destination(lat, lon, sunAz, d);
    }));
    return fetchElevations(pts).then(function (el) {
      if (!el.length || el[0] == null) return null;
      var h0 = el[0] + 1.7;                      // altura de los ojos
      var far = { angle: 0, dist: 0, elev: el[0] };
      var near = { angle: 0, dist: 0, elev: el[0] };
      for (var i = 1; i < el.length; i++) {
        var d = HORIZON_D[i - 1];
        if (el[i] == null) continue;
        var drop = (d * d) / (2 * EARTH_R * 1.13);   // curvatura + refraccion
        var ang = Math.atan2(el[i] - h0 - drop * 1000, d * 1000) * 180 / Math.PI;
        var slot = d < NEAR_KM ? near : far;
        if (ang > slot.angle) { slot.angle = ang; slot.dist = d; slot.elev = el[i]; }
      }
      return {
        observerElev: el[0],
        angle: far.angle, dist: far.dist, elev: far.elev,   // horizonte real
        near: near                                          // relieve inmediato
      };
    }).catch(function () { return null; });
  }

  /* -------------------------------------------------------------- puntuacion */

  /** Probabilidad de que las nubes tapen el disco solar (0-1). */
  function blockProbability(low, mid, high) {
    var l = Math.max(0, Math.min(100, low || 0)) / 100;
    var m = Math.max(0, Math.min(100, mid || 0)) / 100;
    var h = Math.max(0, Math.min(100, high || 0)) / 100;
    return 1 - (1 - l * OPACITY.low) * (1 - m * OPACITY.mid) * (1 - h * OPACITY.high);
  }

  /**
   * Penalizacion por Sol muy bajo: extincion atmosferica, bruma, calima y
   * mayor probabilidad de nubes lejanas en la visual. A 0 grados el Sol es un
   * disco rojo y debil; deja de penalizar a partir de ~10 grados.
   */
  function lowSunFactor(altDeg) {
    if (altDeg <= 0) return 0.30;
    return Math.max(0.30, Math.min(1, 0.40 + 0.06 * altDeg));
  }

  /**
   * Penalizacion por estar pegado al borde de la banda: unos pocos kilometros
   * de error y te quedas sin totalidad. Se mide con la duracion.
   */
  function durationFactor(seconds) {
    if (!seconds) return 1;
    return Math.max(0.72, Math.min(1, 0.72 + 0.28 * (seconds / 75)));
  }

  /** Penalizacion por relieve que tapa el Sol. */
  function horizonFactor(sunAlt, horizonAngle) {
    if (horizonAngle == null) return 1;
    var margin = sunAlt - horizonAngle;
    if (margin <= -0.25) return 0;               // el Sol se pone tras el relieve
    return Math.max(0, Math.min(1, (margin + 0.25) / 1.25));
  }

  /**
   * Puntuacion global 0-100 de "probabilidad de disfrutarlo".
   * @param circ  circunstancias del eclipse (Eclipse.circumstances o .quick)
   * @param cloud {low, mid, high} en la linea de vision
   * @param horizon resultado de fetchHorizon (o null)
   */
  function observationScore(circ, cloud, horizon) {
    var block = blockProbability(cloud.low, cloud.mid, cloud.high);
    var clear = 1 - block;
    var fLow = lowSunFactor(circ.sunAlt);
    var fHor = horizonFactor(circ.sunAlt, horizon ? horizon.angle : null);
    var fDur = circ.total ? durationFactor(circ.duration) : 1;
    var base = clear * fLow * fHor * fDur;
    // Fuera de la banda de totalidad la experiencia no es comparable.
    var fTot = circ.total ? 1
      : Math.min(0.5, 0.3 + 0.2 * Math.max(0, (circ.obscuration - 0.9) * 10));
    var score = 100 * base * fTot;
    return {
      score: Math.max(0, Math.min(100, score)),
      block: block,
      clear: clear,
      lowSun: fLow,
      horizon: fHor,
      dur: fDur,
      totality: fTot,
      stars: Math.max(0, Math.min(5, Math.round(score / 20)))
    };
  }

  /** Consenso entre modelos: 0 (dispersion alta) a 1 (todos de acuerdo). */
  function consensus(values) {
    var v = values.filter(function (x) { return x != null && isFinite(x); });
    if (v.length < 2) return { mean: v[0] != null ? v[0] : null, sd: null, level: 'bajo', n: v.length };
    var mean = v.reduce(function (a, b) { return a + b; }, 0) / v.length;
    var sd = Math.sqrt(v.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / v.length);
    var level = sd < 8 ? 'alto' : (sd < 20 ? 'medio' : 'bajo');
    return { mean: mean, sd: sd, level: level, n: v.length };
  }

  function scoreColor(s) {
    if (s == null) return '#555';
    if (s >= 80) return '#1fc16b';
    if (s >= 60) return '#7ac70c';
    if (s >= 40) return '#e8b710';
    if (s >= 20) return '#f0730a';
    return '#e0344b';
  }

  function scoreLabel(s) {
    if (s >= 80) return 'excelente';
    if (s >= 60) return 'bueno';
    if (s >= 40) return 'arriesgado';
    if (s >= 20) return 'malo';
    return 'muy malo';
  }

  global.Weather = {
    MODELS: MODELS,
    GRID_MODELS: GRID_MODELS,
    HOURLY: HOURLY,
    GRID_HOURLY: GRID_HOURLY,
    LAYER_H: LAYER_H,
    OPACITY: OPACITY,
    fetchForecast: fetchForecast,
    quotaBlockedUntil: quotaBlockedUntil,
    clearQuotaBlock: clearQuotaBlock,
    fetchMinutely15: fetchMinutely15,
    fetchElevations: fetchElevations,
    fetchHorizon: fetchHorizon,
    sightlinePoints: sightlinePoints,
    layerDistance: layerDistance,
    destination: destination,
    interpAt: interpAt,
    blockProbability: blockProbability,
    observationScore: observationScore,
    lowSunFactor: lowSunFactor,
    durationFactor: durationFactor,
    horizonFactor: horizonFactor,
    consensus: consensus,
    scoreColor: scoreColor,
    scoreLabel: scoreLabel
  };
})(typeof window !== 'undefined' ? window : globalThis);
