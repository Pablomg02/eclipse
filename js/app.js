/*
 * app.js — Interfaz del mapa.
 *
 * Flujo:
 *   1. Mapa + banda de totalidad precalculada.
 *   2. Clic en el mapa -> circunstancias del eclipse (calculo local, instantaneo)
 *      + nubosidad multimodelo + perfil del horizonte (Open-Meteo).
 *   3. "Analizar zona" -> rejilla sobre la vista actual -> capa continua y ranking.
 */
(function () {
  'use strict';

  var DATA_URL = 'data/eclipse-2026-08-12.json';
  var TZ = 'Europe/Madrid';

  var state = {
    geom: null,
    map: null,
    marker: null,
    sightLine: null,
    layer: null,          // capa continua actual
    satLayer: null,
    grid: null,           // rejilla analizada
    metric: 'score',
    offsetMin: 0,
    selected: null,
    reqId: 0
  };

  /* --------------------------------------------------------- formateo */

  var fmtTime = new Intl.DateTimeFormat('es-ES', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });
  var fmtHM = new Intl.DateTimeFormat('es-ES', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false
  });

  function hhmmss(d) { return d ? fmtTime.format(d) : '—'; }
  function hhmm(d) { return d ? fmtHM.format(d) : '—'; }

  function dur(sec) {
    if (!sec) return '—';
    var m = Math.floor(sec / 60), s = Math.round(sec % 60);
    return m > 0 ? m + ' min ' + String(s).padStart(2, '0') + ' s' : s.toFixed(0) + ' s';
  }
  function pct(v, dec) { return v == null || isNaN(v) ? '—' : v.toFixed(dec == null ? 0 : dec) + ' %'; }
  function deg(v, dec) { return v == null || isNaN(v) ? '—' : v.toFixed(dec == null ? 1 : dec) + '°'; }

  function compass(az) {
    var pts = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO',
               'O', 'ONO', 'NO', 'NNO'];
    return pts[Math.round(((az % 360) + 360) % 360 / 22.5) % 16];
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function toast(msg, ms) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.hidden = true; }, ms || 3800);
  }

  /* -------------------------------------------------------------- mapa */

  function initMap() {
    var map = L.map('map', {
      center: [43.0, -7.6],
      zoom: 7,
      zoomControl: true,
      attributionControl: true
    });
    state.map = map;

    var osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    });
    var carto = L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19, subdomains: 'abcd',
        attribution: '&copy; OpenStreetMap &copy; <a href="https://carto.com/attributions">CARTO</a>'
      });
    var topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: 17,
      attribution: 'Mapa: <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)'
    });

    carto.addTo(map);
    L.control.layers(
      { 'Oscuro': carto, 'OpenStreetMap': osm, 'Relieve': topo },
      {}, { position: 'topright', collapsed: true }
    ).addTo(map);

    map.createPane('eclipsePane');
    map.getPane('eclipsePane').style.zIndex = 450;
    map.createPane('fieldPane');
    map.getPane('fieldPane').style.zIndex = 350;

    map.on('click', function (e) { selectPoint(e.latlng.lat, e.latlng.lng); });
    return map;
  }

  function drawGeometry(g) {
    var map = state.map;

    // curvas de ocultacion (eclipse parcial)
    Object.keys(g.obscurationContours).forEach(function (lv) {
      var pctLv = Math.round(parseFloat(lv) * 100);
      g.obscurationContours[lv].forEach(function (line, idx) {
        var pl = L.polyline(line, {
          pane: 'eclipsePane',
          color: '#5c6b7d',
          weight: 1,
          opacity: 0.55,
          dashArray: '4 5',
          interactive: false
        }).addTo(map);
        if (idx === 0) {
          pl.bindTooltip(pctLv + ' %', {
            permanent: true, direction: 'center', className: 'cl-tip', opacity: 0.9
          });
        }
        (state.contourLayers = state.contourLayers || []).push(pl);
      });
    });

    // banda de totalidad
    state.totalityLayer = L.layerGroup([], { pane: 'eclipsePane' }).addTo(map);
    g.totality.forEach(function (ring) {
      L.polygon(ring, {
        pane: 'eclipsePane',
        color: '#ffd166', weight: 2, opacity: 0.95,
        fillColor: '#ffd166', fillOpacity: 0.1,
        interactive: false
      }).addTo(state.totalityLayer);
    });

    // linea central
    L.polyline(g.centerline, {
      pane: 'eclipsePane',
      color: '#ffd166', weight: 1.3, opacity: 0.7,
      dashArray: '7 6', interactive: false
    }).addTo(state.totalityLayer);

    // marcas horarias sobre la linea central
    g.centerMeta.forEach(function (m, i) {
      if (i % 4 !== 0) return;
      L.circleMarker([m.lat, m.lon], {
        pane: 'eclipsePane', radius: 2, color: '#ffd166',
        fillColor: '#ffd166', fillOpacity: 1, weight: 0, interactive: false
      }).addTo(state.totalityLayer)
        .bindTooltip(hhmm(new Date('2026-08-12T' + m.ut + 'Z')), {
          permanent: true, direction: 'top', className: 'cl-tip', opacity: 0.85
        });
    });
  }

  /* ------------------------------------------------- seleccion de punto */

  function selectPoint(lat, lon, opts) {
    opts = opts || {};
    lat = Math.round(lat * 1e5) / 1e5;
    lon = Math.round(lon * 1e5) / 1e5;
    state.selected = { lat: lat, lon: lon };
    var myReq = ++state.reqId;

    if (state.marker) state.map.removeLayer(state.marker);
    state.marker = L.marker([lat, lon], { zIndexOffset: 1000 }).addTo(state.map);

    var circ = Eclipse.circumstances(lat, lon, 0);
    renderPanel(circ, lat, lon, null, null, true);
    openPanel();

    if (!circ || !circ.visible) return;

    // linea de vision hacia el Sol en el maximo
    drawSightline(lat, lon, circ);

    var sl = Weather.sightlinePoints(lat, lon, circ.sunAlt, circ.sunAz);
    var ids = Weather.MODELS.map(function (m) { return m.id; });
    var wxErr = null;

    // Dos peticiones en vez de una: del punto del observador interesan las seis
    // variables, pero de cada punto de la linea de vision solo se usa su capa.
    // Pedir las seis en los cuatro puntos gastaba el triple de cuota por nada.
    var forecast = Promise.all([
      Weather.fetchForecast([sl.here], ids, Weather.HOURLY),
      Weather.fetchForecast([sl.low, sl.mid, sl.high], ids, Weather.GRID_HOURLY)
    ]).then(function (parts) {
      return parts[0].concat(parts[1]);       // [here, low, mid, high]
    }).catch(function (e) { console.warn(e); wxErr = e; return null; });

    Promise.all([
      forecast,
      Weather.fetchHorizon(lat, lon, circ.sunAz),
      Weather.fetchMinutely15(lat, lon)
    ]).then(function (res) {
      if (myReq !== state.reqId) return;      // hubo otro clic mientras tanto
      renderPanel(circ, lat, lon,
        res[0] ? { forecast: res[0], sl: sl, minutely: res[2] } : null,
        res[1], false, wxErr);
    });
  }

  function drawSightline(lat, lon, circ) {
    if (state.sightLine) state.map.removeLayer(state.sightLine);
    var far = Weather.destination(lat, lon, circ.sunAz, 120);
    state.sightLine = L.polyline([[lat, lon], [far.lat, far.lon]], {
      color: '#ffd166', weight: 2, opacity: 0.6, dashArray: '2 6', interactive: false
    }).addTo(state.map);
  }

  /* ------------------------------------------- extraccion de nubosidad */

  /** Valores por modelo en la fecha objetivo para un punto del forecast. */
  function modelValues(entry, date, vars) {
    var out = {};
    if (!entry) return out;
    Object.keys(entry.models).forEach(function (mid) {
      var m = entry.models[mid];
      var o = {};
      var any = false;
      vars.forEach(function (v) {
        var val = Weather.interpAt(m.times, m[v], date);
        o[v] = val;
        if (val != null) any = true;
      });
      if (any) out[mid] = o;
    });
    return out;
  }

  function meanOf(obj, vname) {
    var vals = Object.keys(obj).map(function (k) { return obj[k][vname]; })
      .filter(function (v) { return v != null && isFinite(v); });
    if (!vals.length) return null;
    return vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
  }

  /* ------------------------------------------------------------ panel */

  /**
   * Explica por que no hay prevision. El 429 de Open-Meteo (cuota agotada) es
   * el caso frecuente y no se arregla insistiendo: hay que esperar. Conviene
   * decirlo en lugar de culpar a la conexion del usuario.
   */
  function wxErrorNote(err) {
    if (Weather.quotaBlockedUntil() || (err && err.status === 429)) {
      return '<p class="note"><strong>Se ha agotado la cuota gratuita de Open-Meteo</strong> ' +
        'para esta conexión, no es un problema tuyo. Cada consulta cuesta ' +
        'puntos × variables × modelos, y “Analizar zona” gasta mucho de golpe. ' +
        'Suele liberarse en unos minutos, como muy tarde al cambiar de hora. ' +
        retryButton() + '</p>';
    }
    var extra = err && err.reason ? ': <strong>' + esc(err.reason) + '</strong>'
      : err && err.message ? ' (' + esc(err.message) + ')' : '';
    return '<p class="note">No se pudo consultar la previsión' + extra + '. ' +
      retryButton() + '</p>';
  }

  function retryButton() {
    return '<button type="button" class="retry" id="btn-retry">Reintentar</button>';
  }

  function renderPanel(circ, lat, lon, wx, horizon, loading, wxErr) {
    var body = document.getElementById('panel-body');
    var place = Places.nearest(lat, lon, 60);
    var title = place ? place.name + (place.km > 6 ? ' (a ' + place.km.toFixed(0) + ' km)' : '') : 'Punto seleccionado';

    if (!circ || !circ.visible) {
      body.innerHTML =
        '<div class="p-head"><div><h2>' + esc(title) + '</h2>' +
        '<div class="coords">' + lat.toFixed(4) + ', ' + lon.toFixed(4) + '</div></div></div>' +
        '<p class="note">Aquí el Sol ya se ha puesto cuando ocurre el eclipse, o el ' +
        'eclipse no es visible. Busca más al norte o al este.</p>';
      return;
    }

    var html = '';

    /* --- cabecera con veredicto --- */
    var sc = null, cloud = null, cons = null, perModel = null;
    if (wx) {
      var here = wx.forecast[0], pl = wx.forecast[1], pm = wx.forecast[2], ph = wx.forecast[3];
      var vLow = modelValues(pl, circ.max, ['cloud_cover_low']);
      var vMid = modelValues(pm, circ.max, ['cloud_cover_mid']);
      var vHigh = modelValues(ph, circ.max, ['cloud_cover_high']);
      var vHere = modelValues(here, circ.max, Weather.HOURLY);

      cloud = {
        low: meanOf(vLow, 'cloud_cover_low'),
        mid: meanOf(vMid, 'cloud_cover_mid'),
        high: meanOf(vHigh, 'cloud_cover_high'),
        hereTotal: meanOf(vHere, 'cloud_cover'),
        visibility: meanOf(vHere, 'visibility'),
        precip: meanOf(vHere, 'precipitation_probability')
      };
      perModel = { low: vLow, mid: vMid, high: vHigh, here: vHere };
      cons = Weather.consensus(Weather.MODELS.map(function (m) {
        var l = vLow[m.id] && vLow[m.id].cloud_cover_low;
        var d = vMid[m.id] && vMid[m.id].cloud_cover_mid;
        var h = vHigh[m.id] && vHigh[m.id].cloud_cover_high;
        if (l == null && d == null && h == null) return null;
        return 100 * Weather.blockProbability(l, d, h);
      }));
      sc = Weather.observationScore(circ, cloud, horizon);
    }

    var badge = circ.total
      ? '<span class="badge total">TOTALIDAD</span>'
      : '<span class="badge partial">Solo parcial</span>';

    html += '<div class="p-head"><div><h2>' + esc(title) + '</h2>' +
            '<div class="coords">' + lat.toFixed(4) + ', ' + lon.toFixed(4) + ' &middot; ' +
            badge + '</div></div>';
    if (sc) {
      var col = Weather.scoreColor(sc.score);
      html += '<div class="verdict">' +
        '<div class="num" style="color:' + col + '">' + Math.round(sc.score) +
        '<small>/100</small></div>' +
        '<div class="stars" style="color:' + col + '">' +
        '★'.repeat(sc.stars) + '<span style="color:#39424e">' + '★'.repeat(5 - sc.stars) + '</span></div>' +
        '<div class="lbl">' + Weather.scoreLabel(sc.score) + '</div></div>';
    }
    html += '</div>';

    /* --- bloque eclipse --- */
    html += '<section class="block"><h3>Eclipse</h3><dl class="rows">';
    if (circ.total) {
      html += row('Totalidad', hhmmss(circ.c2) + ' → ' + hhmmss(circ.c3), true);
      html += row('Duración', dur(circ.duration), true);
    } else {
      html += row('Ocultación máx.', pct(circ.obscuration * 100, 1), true);
      html += row('Magnitud', circ.magnitude.toFixed(3));
    }
    html += row('Inicio (C1)', hhmmss(circ.c1));
    html += row('Máximo', hhmmss(circ.max));
    html += row('Fin (C4)', circ.sunAltC4 != null && circ.sunAltC4 < 0
      ? 'tras el ocaso' : hhmmss(circ.c4));
    html += row('Altura del Sol', deg(circ.sunAlt) + (circ.sunAlt < 3 ? ' ⚠︎' : ''));
    html += row('Azimut del Sol', deg(circ.sunAz, 0) + ' (' + compass(circ.sunAz) + ')');
    html += '</dl>';
    if (circ.sunAlt < 5) {
      html += '<p class="note">El Sol estará <strong>muy bajo</strong> (' + deg(circ.sunAlt) +
        '). Necesitas horizonte despejado hacia el ' + compass(circ.sunAz) +
        ': mar, llanura o una loma alta.</p>';
    }
    html += '</section>';

    /* --- bloque meteo --- */
    html += '<section class="block"><h3>Nubes en la línea de visión</h3>';
    if (loading) {
      html += '<div class="loading"><span class="spinner"></span>Consultando modelos meteorológicos…</div>';
    } else if (!wx) {
      html += wxErrorNote(wxErr);
    } else {
      html += modelTable(perModel, cloud);
      html += '<p class="note">Con el Sol a ' + deg(circ.sunAlt) + ', la línea de visión no pasa por ' +
        'las nubes que tienes encima, sino por las que hay a <strong>' +
        wx.sl.dist.low.toFixed(0) + ' km</strong> (bajas), <strong>' +
        wx.sl.dist.mid.toFixed(0) + ' km</strong> (medias) y <strong>' +
        wx.sl.dist.high.toFixed(0) + ' km</strong> (altas) hacia el ' + compass(circ.sunAz) +
        '. Es ahí donde se ha consultado.</p>';
      if (cons && cons.sd != null) {
        html += '<p class="note">Consenso entre modelos: <strong>' + cons.level +
          '</strong> (dispersión ' + cons.sd.toFixed(0) + ' puntos entre ' + cons.n + ' modelos).' +
          (cons.level === 'bajo' ? ' Los modelos no se ponen de acuerdo: vuelve a mirar más tarde.' : '') +
          '</p>';
      }
      if (cloud.precip != null && cloud.precip > 25) {
        html += '<p class="note">Probabilidad de precipitación: <strong>' + pct(cloud.precip) + '</strong>.</p>';
      }
      if (wx.minutely) html += minutelyTable(wx.minutely, circ);
    }
    html += '</section>';

    /* --- bloque horizonte --- */
    html += '<section class="block"><h3>Horizonte hacia el Sol</h3>';
    if (loading) {
      html += '<div class="loading"><span class="spinner"></span>Analizando el relieve…</div>';
    } else if (!horizon) {
      html += '<p class="note">No se pudo obtener el perfil del terreno' +
        (Weather.quotaBlockedUntil() ? ' (misma cuota de Open-Meteo agotada)' : '') + '.</p>';
    } else {
      var margin = circ.sunAlt - horizon.angle;
      html += '<dl class="rows">';
      html += row('Altitud del punto', horizon.observerElev.toFixed(0) + ' m');
      html += row('Horizonte (1-65 km)', deg(horizon.angle, 2) +
        (horizon.angle > 0.05 ? ' (a ' + horizon.dist + ' km, ' + horizon.elev.toFixed(0) + ' m)' : ''));
      html += row('Margen del Sol', deg(margin, 2), margin > 0);
      html += '</dl>';
      html += '<p class="note">' + (margin <= 0
        ? '<strong style="color:#ff8a9b">El terreno tapa el Sol.</strong> Desde aquí el Sol se ' +
          'esconde tras el relieve antes de la totalidad. Busca otro sitio.'
        : margin < 1
          ? '<strong>Muy justo.</strong> El Sol pasará rozando el relieve. Gana altura o acércate a la costa.'
          : 'El horizonte no molesta: el Sol queda ' + deg(margin, 1) + ' por encima del obstáculo ' +
            'más alto en los 65 km hacia el ' + compass(circ.sunAz) + '.') + '</p>';
      if (horizon.near && horizon.near.angle > circ.sunAlt) {
        html += '<p class="note">Ojo: hay relieve <strong>a ' +
          (horizon.near.dist * 1000).toFixed(0) + ' m</strong> (' + horizon.near.elev.toFixed(0) +
          ' m de altitud) que se eleva ' + deg(horizon.near.angle, 1) +
          ' sobre ti y te taparía el Sol. Se arregla moviéndote unos cientos de metros; ' +
          'no cuenta en la nota.</p>';
      }
    }
    html += '</section>';

    /* --- desglose de la puntuacion --- */
    if (sc) {
      html += '<section class="block"><h3>De dónde sale la nota</h3><dl class="rows">';
      html += row('Cielo despejado en la visual', pct(sc.clear * 100));
      html += row('Sol bajo (' + deg(circ.sunAlt) + ')', '×' + sc.lowSun.toFixed(2));
      html += row('Relieve', '×' + sc.horizon.toFixed(2));
      if (circ.total) html += row('Margen de banda (' + dur(circ.duration) + ')', '×' + sc.dur.toFixed(2));
      else html += row('Sin totalidad', '×' + sc.totality.toFixed(2));
      html += '</dl></section>';
    }

    html += '<p class="src">Geometría: elementos besselianos de la NASA/GSFC ' +
      '(Espenak &amp; Meeus, <em>Five Millennium Canon</em>), calculados en el navegador. ' +
      'Meteorología: <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a> ' +
      '(ECMWF, ICON, GFS, AROME/ARPEGE, UKMO). Relieve: Copernicus DEM vía Open-Meteo. ' +
      'Horas en hora peninsular española.</p>';

    body.innerHTML = html;

    var retry = document.getElementById('btn-retry');
    if (retry) {
      retry.addEventListener('click', function () {
        Weather.clearQuotaBlock();
        selectPoint(lat, lon);
      });
    }
  }

  function row(label, value, hi) {
    return '<dt>' + esc(label) + '</dt><dd' + (hi ? ' class="hi"' : '') + '>' + value + '</dd>';
  }

  function modelTable(pm, cloud) {
    var ids = Weather.MODELS.filter(function (m) {
      return (pm.low[m.id] || pm.mid[m.id] || pm.high[m.id]);
    });
    var h = '<table class="models"><thead><tr><th></th>';
    ids.forEach(function (m) { h += '<th>' + esc(m.name) + '</th>'; });
    h += '<th>media</th></tr></thead><tbody>';

    var rows = [
      ['Bajas', 'low', 'cloud_cover_low', cloud.low],
      ['Medias', 'mid', 'cloud_cover_mid', cloud.mid],
      ['Altas', 'high', 'cloud_cover_high', cloud.high]
    ];
    rows.forEach(function (r) {
      h += '<tr><td>' + r[0] + '</td>';
      ids.forEach(function (m) {
        var v = pm[r[1]][m.id] ? pm[r[1]][m.id][r[2]] : null;
        h += '<td>' + (v == null ? '—' : Math.round(v)) + '</td>';
      });
      h += '<td>' + (r[3] == null ? '—' : Math.round(r[3])) + '</td></tr>';
    });

    h += '<tr class="total-row"><td>Tapa el Sol</td>';
    ids.forEach(function (m) {
      var l = pm.low[m.id] && pm.low[m.id].cloud_cover_low;
      var d = pm.mid[m.id] && pm.mid[m.id].cloud_cover_mid;
      var g = pm.high[m.id] && pm.high[m.id].cloud_cover_high;
      var p = (l == null && d == null && g == null) ? null
        : Math.round(100 * Weather.blockProbability(l, d, g));
      h += '<td style="color:' + (p == null ? '#8b97a6' : Weather.scoreColor(100 - p)) + '">' +
        (p == null ? '—' : p + '%') + '</td>';
    });
    var mp = Math.round(100 * Weather.blockProbability(cloud.low, cloud.mid, cloud.high));
    h += '<td style="color:' + Weather.scoreColor(100 - mp) + '">' + mp + '%</td></tr>';
    h += '</tbody></table>';
    return h;
  }

  function minutelyTable(mn, circ) {
    var t0 = circ.max.getTime();
    var idx = [];
    mn.times.forEach(function (t, i) {
      if (Math.abs(t - t0) <= 46 * 60000) idx.push(i);
    });
    if (idx.length < 2) return '';
    var h = '<table class="models" style="margin-top:10px"><thead><tr><th>15 min</th>';
    idx.forEach(function (i) { h += '<th>' + hhmm(new Date(mn.times[i])) + '</th>'; });
    h += '</tr></thead><tbody><tr><td>Nubes</td>';
    idx.forEach(function (i) {
      var v = mn.v.cloud_cover ? mn.v.cloud_cover[i] : null;
      h += '<td>' + (v == null ? '—' : v) + '</td>';
    });
    h += '</tr></tbody></table>';
    return h;
  }

  /* ------------------------------------------------------- panel abrir */

  function openPanel() { document.getElementById('panel').classList.remove('collapsed'); }
  function togglePanel() { document.getElementById('panel').classList.toggle('collapsed'); }

  /* ------------------------------------------------- analisis de zona */

  function buildGridSpec(bounds, maxPoints) {
    var s = bounds.getSouth(), n = bounds.getNorth();
    var w = bounds.getWest(), e = bounds.getEast();
    // margen para que la capa cubra un poco mas que la vista
    var padLat = (n - s) * 0.08, padLon = (e - w) * 0.08;
    s -= padLat; n += padLat; w -= padLon; e += padLon;
    s = Math.max(-85, s); n = Math.min(85, n);

    var latSpan = n - s, lonSpan = e - w;
    var step = Math.sqrt(latSpan * lonSpan / maxPoints);
    step = Math.max(0.08, Math.round(step * 100) / 100);

    var nx = Math.min(60, Math.max(3, Math.floor(lonSpan / step) + 1));
    var ny = Math.min(60, Math.max(3, Math.floor(latSpan / step) + 1));
    while (nx * ny > maxPoints) { step *= 1.15; nx = Math.max(3, Math.floor(lonSpan / step) + 1); ny = Math.max(3, Math.floor(latSpan / step) + 1); }

    return {
      lat0: s, lon0: w,
      dLat: latSpan / (ny - 1), dLon: lonSpan / (nx - 1),
      nx: nx, ny: ny
    };
  }

  // Cada nodo de la rejilla cuesta (variables x modelos) unidades de la cuota
  // horaria de Open-Meteo, que en el plan gratuito son unas 5.000. Con 150
  // nodos, 3 variables y 3 modelos cada analisis gasta ~1.350: se pueden hacer
  // tres o cuatro por hora. Subir esto vuelve a agotar la cuota enseguida.
  var GRID_MAX_POINTS = 150;

  function analyzeArea() {
    var btn = document.getElementById('btn-analyze');
    var spec = buildGridSpec(state.map.getBounds(), GRID_MAX_POINTS);

    var nodes = [];
    for (var j = 0; j < spec.ny; j++) {
      for (var i = 0; i < spec.nx; i++) {
        var lat = spec.lat0 + j * spec.dLat;
        var lon = spec.lon0 + i * spec.dLon;
        var q = Eclipse.quick(lat, lon);
        nodes.push({ lat: lat, lon: lon, q: q });
      }
    }

    var usable = nodes.filter(function (n) { return n.q && n.q.sunAlt > -1 && n.q.magnitude > 0.5; });
    if (usable.length < 3) {
      toast('En esta zona el eclipse no es visible. Muévete al norte de España o al Atlántico.');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Consultando ' + nodes.length + ' puntos…';

    Weather.fetchForecast(
      nodes.map(function (n) { return { lat: n.lat, lon: n.lon }; }),
      Weather.GRID_MODELS, Weather.GRID_HOURLY
    ).then(function (res) {
      nodes.forEach(function (n, i) { n.fc = res[i]; });
      state.grid = { spec: spec, nodes: nodes };
      computeGridFields();
      renderField();
      renderSpots();
      document.getElementById('time-control').hidden = false;
      btn.textContent = 'Recalcular en esta vista';
      btn.disabled = false;
      toast('Zona analizada: ' + nodes.length + ' puntos, ' +
            Weather.GRID_MODELS.length + ' modelos.');
    }).catch(function (err) {
      console.error(err);
      btn.textContent = 'Analizar nubes en esta zona';
      btn.disabled = false;
      toast(Weather.quotaBlockedUntil()
        ? 'Cuota gratuita de Open-Meteo agotada. Espera unos minutos y reintenta.'
        : 'Error consultando Open-Meteo: ' + err.message, 6000);
    });
  }

  /**
   * Calcula, para cada nodo, la nubosidad por capas en el instante del eclipse
   * (o desplazado) y despues la corrige por linea de vision muestreando la
   * propia rejilla en la direccion del Sol.
   */
  function computeGridFields() {
    var g = state.grid;
    if (!g) return;
    var spec = g.spec, nodes = g.nodes;
    var n = spec.nx * spec.ny;

    var fLow = new Float32Array(n), fMid = new Float32Array(n), fHigh = new Float32Array(n);
    var spread = new Float32Array(n);

    nodes.forEach(function (nd, k) {
      if (!nd.q || !nd.fc) { fLow[k] = fMid[k] = fHigh[k] = NaN; spread[k] = NaN; return; }
      var target = new Date(Eclipse.tToDate(nd.q.tMax).getTime() + state.offsetMin * 60000);
      var vals = modelValues(nd.fc, target, Weather.GRID_HOURLY);
      fLow[k] = pick(meanOf(vals, 'cloud_cover_low'));
      fMid[k] = pick(meanOf(vals, 'cloud_cover_mid'));
      fHigh[k] = pick(meanOf(vals, 'cloud_cover_high'));
      var per = Object.keys(vals).map(function (mid) {
        return 100 * Weather.blockProbability(vals[mid].cloud_cover_low,
          vals[mid].cloud_cover_mid, vals[mid].cloud_cover_high);
      });
      spread[k] = per.length > 1 ? Weather.consensus(per).sd : NaN;
    });

    var gLow = fieldGrid(spec, fLow), gMid = fieldGrid(spec, fMid), gHigh = fieldGrid(spec, fHigh);

    // valores corregidos por linea de vision + puntuacion
    var score = new Float32Array(n), block = new Float32Array(n);
    nodes.forEach(function (nd, k) {
      if (!nd.q || isNaN(fLow[k])) { score[k] = NaN; block[k] = NaN; return; }
      var sl = Weather.sightlinePoints(nd.lat, nd.lon, nd.q.sunAlt, nd.q.sunAz);
      var lo = orFallback(CloudLayer.sample(gLow, sl.low.lat, sl.low.lon), fLow[k]);
      var mi = orFallback(CloudLayer.sample(gMid, sl.mid.lat, sl.mid.lon), fMid[k]);
      var hi = orFallback(CloudLayer.sample(gHigh, sl.high.lat, sl.high.lon), fHigh[k]);
      var b = Weather.blockProbability(lo, mi, hi);
      block[k] = b * 100;
      var s = Weather.observationScore(nd.q, { low: lo, mid: mi, high: hi }, null);
      score[k] = s.score;
      nd.score = s.score;
      nd.dur = nd.q.duration;
      nd.block = b * 100;
      nd.cloud = { low: lo, mid: mi, high: hi };
      nd.spread = spread[k];
    });

    g.fields = {
      score: fieldGrid(spec, score),
      cloud: fieldGrid(spec, block)
    };
  }

  function pick(v) { return v == null ? NaN : v; }
  function orFallback(v, f) { return isNaN(v) ? f : v; }

  function fieldGrid(spec, values) {
    return {
      lat0: spec.lat0, lon0: spec.lon0, dLat: spec.dLat, dLon: spec.dLon,
      nx: spec.nx, ny: spec.ny, values: values
    };
  }

  function renderField() {
    if (state.layer) { state.map.removeLayer(state.layer); state.layer = null; }
    document.getElementById('legend').hidden = true;
    if (state.metric !== 'score' && state.metric !== 'cloud') return;
    if (!state.grid || !state.grid.fields) return;

    var field = state.grid.fields[state.metric];
    var isScore = state.metric === 'score';
    state.layer = CloudLayer.build(field, {
      colorFn: isScore ? CloudLayer.RAMP_SCORE : CloudLayer.RAMP_CLOUD,
      alpha: 0.5,
      pane: 'fieldPane',
      supersample: 16
    }).addTo(state.map);

    var lg = document.getElementById('legend');
    lg.hidden = false;
    lg.querySelector('.legend-title').textContent = isScore
      ? 'Calidad de observación'
      : 'Probabilidad de que las nubes tapen el Sol';
    var ramp = isScore ? CloudLayer.RAMP_SCORE : CloudLayer.RAMP_CLOUD;
    var stops = [];
    for (var i = 0; i <= 10; i++) {
      var c = ramp(i * 10);
      stops.push('rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ') ' + (i * 10) + '%');
    }
    lg.querySelector('.legend-bar').style.background = 'linear-gradient(90deg,' + stops.join(',') + ')';
    var labels = lg.querySelectorAll('.legend-labels span');
    labels[0].textContent = isScore ? '0 · malo' : '0 % · despejado';
    labels[1].textContent = isScore ? 'bueno · 100' : 'cubierto · 100 %';
  }

  function renderSpots() {
    var g = state.grid;
    if (!g) return;
    var cands = g.nodes.filter(function (n) {
      return n.q && n.q.total && n.q.sunAlt > 0 && n.score != null && !isNaN(n.score);
    }).sort(function (a, b) { return b.score - a.score; });

    var picked = [];
    cands.forEach(function (c) {
      if (picked.length >= 6) return;
      var far = picked.every(function (p) {
        return Places.distKm(p.lat, p.lon, c.lat, c.lon) > 45;
      });
      if (far) picked.push(c);
    });

    if (!picked.length) {
      toast('En esta vista no hay ningún punto dentro de la banda de totalidad.');
      return;
    }

    var html = '<section class="block"><h3>Mejores sitios de esta vista</h3><ul class="spots">';
    picked.forEach(function (p) {
      var pl = Places.nearest(p.lat, p.lon, 70);
      var nm = pl ? pl.name + (pl.km > 8 ? ' · ' + pl.km.toFixed(0) + ' km' : '') :
        p.lat.toFixed(2) + ', ' + p.lon.toFixed(2);
      html += '<li><span class="dot" style="background:' + Weather.scoreColor(p.score) + '"></span>' +
        '<span class="nm">' + esc(nm) +
        '<br><span style="font-size:11px;color:#8b97a6">' + dur(p.dur) +
        ' de totalidad · nubes ' + Math.round(p.block) + ' %</span></span>' +
        '<span class="sc" style="color:' + Weather.scoreColor(p.score) + '">' +
        Math.round(p.score) + '</span>' +
        '<button data-lat="' + p.lat + '" data-lon="' + p.lon + '">ver</button></li>';
    });
    html += '</ul><p class="note">Ordenado por nota; se descartan puntos a menos de 45 km ' +
      'entre sí. Solo aparecen puntos <strong>dentro de la banda de totalidad</strong>. ' +
      'Toca "ver" para el detalle completo del sitio.</p></section>';

    var body = document.getElementById('panel-body');
    var old = body.querySelector('.spots-block');
    if (old) old.remove();
    var empty = body.querySelector('.empty');
    if (empty) empty.remove();
    var wrap = document.createElement('div');
    wrap.className = 'spots-block';
    wrap.innerHTML = html;
    body.insertBefore(wrap, body.firstChild);
    openPanel();

    wrap.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-lat]');
      if (!b) return;
      var la = parseFloat(b.dataset.lat), lo = parseFloat(b.dataset.lon);
      state.map.setView([la, lo], Math.max(state.map.getZoom(), 9));
      selectPoint(la, lo);
    });
  }

  /* ----------------------------------------------------------- capas */

  function setMetric(metric) {
    var buttons = document.querySelectorAll('.tool');
    if (metric === 'sat') {
      toggleSatellite();
      return;
    }
    if (metric === 'totality') {
      var on = state.totalityLayer && state.map.hasLayer(state.totalityLayer);
      if (on) {
        state.map.removeLayer(state.totalityLayer);
        (state.contourLayers || []).forEach(function (l) { state.map.removeLayer(l); });
      } else {
        state.totalityLayer.addTo(state.map);
        (state.contourLayers || []).forEach(function (l) { l.addTo(state.map); });
      }
      document.querySelector('.tool[data-layer="totality"]').classList.toggle('active', !on);
      return;
    }

    state.metric = state.metric === metric ? null : metric;
    buttons.forEach(function (b) {
      if (b.dataset.layer === 'score' || b.dataset.layer === 'cloud') {
        b.classList.toggle('active', b.dataset.layer === state.metric);
      }
    });
    if (state.metric && !state.grid) {
      toast('Pulsa "Analizar nubes en esta zona" para cargar los datos.');
    }
    renderField();
  }

  function toggleSatellite() {
    var btn = document.querySelector('.tool[data-layer="sat"]');
    if (state.satLayer) {
      state.map.removeLayer(state.satLayer);
      state.satLayer = null;
      btn.classList.remove('active');
      return;
    }
    // MTG GeoColour: color real de día e infrarrojo de noche. Es la imagen
    // real de las nubes ahora mismo, no una previsión.
    // El instante se fija explícitamente: si se deja que cada tesela resuelva
    // "la última disponible" por su cuenta, el mosaico sale con costuras de
    // distintas pasadas. El ciclo de MTG es de 10 min; se pide con 20 de margen.
    var frame = new Date(Math.floor((Date.now() - 20 * 60000) / 600000) * 600000);
    state.satLayer = L.tileLayer.wms('https://view.eumetsat.int/geoserver/wms', {
      layers: 'mtg_fd:rgb_geocolour',
      format: 'image/png',
      transparent: true,
      version: '1.1.1',
      time: frame.toISOString().replace(/\.\d+Z$/, 'Z'),
      opacity: 0.7,
      pane: 'fieldPane',
      attribution: 'Satélite: <a href="https://view.eumetsat.int">EUMETSAT</a> MTG GeoColour'
    });
    state.satLayer.on('tileerror', function () {
      if (state.satErrShown) return;
      state.satErrShown = true;
      toast('Algunas imágenes de satélite no han cargado.');
    });
    state.satLayer.addTo(state.map);
    btn.classList.add('active');
    toast('Satélite EUMETSAT de las ' + hhmm(frame) + ': nubes reales, no previsión.');
  }

  /* ------------------------------------------------------------- init */

  function bindUI() {
    document.querySelectorAll('.tool').forEach(function (b) {
      b.addEventListener('click', function () { setMetric(b.dataset.layer); });
    });
    document.getElementById('btn-analyze').addEventListener('click', analyzeArea);
    document.getElementById('panel-handle').addEventListener('click', togglePanel);

    var slider = document.getElementById('time-offset');
    var label = document.getElementById('time-offset-label');
    slider.addEventListener('input', function () {
      state.offsetMin = parseInt(slider.value, 10);
      label.textContent = state.offsetMin === 0 ? 'en la totalidad'
        : (state.offsetMin > 0 ? '+' : '') + state.offsetMin + ' min';
    });
    slider.addEventListener('change', function () {
      if (!state.grid) return;
      computeGridFields();
      renderField();
      renderSpots();
    });

    document.getElementById('btn-locate').addEventListener('click', function () {
      if (!navigator.geolocation) return toast('Tu navegador no permite geolocalización.');
      toast('Buscando tu ubicación…', 2000);
      navigator.geolocation.getCurrentPosition(function (p) {
        state.map.setView([p.coords.latitude, p.coords.longitude], 9);
        selectPoint(p.coords.latitude, p.coords.longitude);
      }, function () { toast('No se pudo obtener tu ubicación.'); },
        { enableHighAccuracy: false, timeout: 8000 });
    });
  }

  function start() {
    initMap();
    bindUI();
    fetch(DATA_URL)
      .then(function (r) { return r.json(); })
      .then(function (g) {
        state.geom = g;
        drawGeometry(g);
      })
      .catch(function (e) {
        console.error(e);
        toast('No se pudo cargar la geometría del eclipse.');
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
