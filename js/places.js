/*
 * places.js — Localidades de referencia dentro y alrededor de la banda de
 * totalidad, para poner nombre a los puntos del mapa. Coordenadas aproximadas
 * (precision ~1 km), suficientes para etiquetar.
 */
(function (global) {
  'use strict';

  var P = [
    // --- Galicia
    ['A Coruña', 43.37, -8.40], ['Ferrol', 43.48, -8.23], ['Betanzos', 43.28, -8.21],
    ['Carballo', 43.21, -8.69], ['Malpica', 43.32, -8.81], ['Laxe', 43.22, -9.00],
    ['Camariñas', 43.13, -9.18], ['Muxía', 43.10, -9.22], ['Fisterra', 42.91, -9.26],
    ['Cee', 42.95, -9.19], ['Vimianzo', 43.11, -9.03], ['Ponteceso', 43.24, -8.90],
    ['Cedeira', 43.66, -8.06], ['Ortigueira', 43.68, -7.85], ['Viveiro', 43.66, -7.59],
    ['Burela', 43.66, -7.36], ['Foz', 43.57, -7.25], ['Ribadeo', 43.54, -7.04],
    ['Mondoñedo', 43.43, -7.36], ['As Pontes', 43.45, -7.85], ['Lugo', 43.01, -7.56],
    ['A Fonsagrada', 43.12, -7.07], ['Sarria', 42.78, -7.41], ['Monforte de Lemos', 42.52, -7.51],
    ['Santiago de Compostela', 42.88, -8.54], ['Ordes', 43.08, -8.41], ['Arzúa', 42.93, -8.16],
    ['Melide', 42.91, -8.01], ['Curtis', 43.13, -8.15], ['Padrón', 42.74, -8.66],
    ['Noia', 42.79, -8.89], ['Muros', 42.78, -9.06], ['Ribeira', 42.55, -8.99],
    ['A Estrada', 42.69, -8.49], ['Lalín', 42.66, -8.11], ['Vilagarcía de Arousa', 42.60, -8.77],
    ['Pontevedra', 42.43, -8.65], ['Vigo', 42.24, -8.72], ['Ourense', 42.34, -7.86],
    ['O Barco de Valdeorras', 42.41, -6.98], ['Verín', 41.94, -7.44],

    // --- Asturias
    ['Oviedo', 43.36, -5.84], ['Gijón', 43.54, -5.66], ['Avilés', 43.56, -5.92],
    ['Cudillero', 43.56, -6.15], ['Luarca', 43.54, -6.53], ['Navia', 43.54, -6.72],
    ['Tapia de Casariego', 43.57, -6.94], ['Cangas del Narcea', 43.18, -6.55],
    ['Mieres', 43.25, -5.77], ['Villaviciosa', 43.48, -5.44], ['Ribadesella', 43.46, -5.06],
    ['Llanes', 43.42, -4.75], ['Cangas de Onís', 43.35, -5.13], ['Covadonga', 43.31, -5.06],

    // --- Cantabria y País Vasco
    ['San Vicente de la Barquera', 43.39, -4.40], ['Torrelavega', 43.35, -4.05],
    ['Santander', 43.46, -3.81], ['Laredo', 43.41, -3.41], ['Castro Urdiales', 43.38, -3.22],
    ['Reinosa', 43.00, -4.14], ['Potes', 43.15, -4.62], ['Bilbao', 43.26, -2.93],
    ['Getxo', 43.35, -3.01], ['Zarautz', 43.28, -2.17], ['Donostia / San Sebastián', 43.32, -1.98],
    ['Vitoria-Gasteiz', 42.85, -2.67],

    // --- Castilla y León
    ['León', 42.60, -5.57], ['Ponferrada', 42.55, -6.60], ['Astorga', 42.46, -6.05],
    ['Villablino', 42.94, -6.32], ['Sahagún', 42.37, -5.03], ['Palencia', 42.01, -4.53],
    ['Burgos', 42.34, -3.70], ['Miranda de Ebro', 42.69, -2.94], ['Aranda de Duero', 41.67, -3.69],
    ['Soria', 41.76, -2.47], ['Valladolid', 41.65, -4.72],

    // --- Meseta sur y sistema Ibérico (la banda pasa por aquí)
    ['Benavente', 42.00, -5.68], ['Zamora', 41.50, -5.75], ['Toro', 41.52, -5.39],
    ['Tordesillas', 41.50, -5.00], ['Medina del Campo', 41.31, -4.91],
    ['Arévalo', 41.06, -4.72], ['Ávila', 40.66, -4.70], ['Cuéllar', 41.40, -4.31],
    ['Peñafiel', 41.60, -4.12], ['Segovia', 40.95, -4.12], ['Sepúlveda', 41.30, -3.75],
    ['Riaza', 41.28, -3.47], ['Ayllón', 41.41, -3.37], ['El Burgo de Osma', 41.59, -3.07],
    ['Almazán', 41.49, -2.53], ['Medinaceli', 41.17, -2.43], ['Ágreda', 41.86, -1.94],
    ['Buitrago del Lozoya', 41.00, -3.63], ['Torrelaguna', 40.83, -3.53],
    ['Guadalajara', 40.63, -3.16], ['Sigüenza', 41.07, -2.64],
    ['Molina de Aragón', 40.84, -1.89], ['Alcalá de Henares', 40.48, -3.36],
    ['Aranjuez', 40.03, -3.60], ['Tarancón', 40.01, -3.00], ['Sacedón', 40.48, -2.73],
    ['Huete', 40.14, -2.69], ['Priego', 40.44, -2.30], ['Cuenca', 40.07, -2.13],
    ['Villalba de la Sierra', 40.19, -2.09], ['Cañete', 40.05, -1.65],
    ['Motilla del Palancar', 39.56, -1.89], ['Utiel', 39.57, -1.20],

    // --- La Rioja y Navarra
    ['Logroño', 42.47, -2.45], ['Haro', 42.58, -2.85], ['Calahorra', 42.30, -1.96],
    ['Pamplona / Iruña', 42.81, -1.64], ['Estella', 42.67, -2.03], ['Tudela', 42.06, -1.61],

    // --- Aragón
    ['Zaragoza', 41.65, -0.89], ['Huesca', 42.13, -0.41], ['Jaca', 42.57, -0.55],
    ['Barbastro', 42.04, 0.13], ['Ejea de los Caballeros', 42.13, -1.14],
    ['Calatayud', 41.35, -1.64], ['Daroca', 41.11, -1.41], ['Alcañiz', 41.05, -0.13],
    ['Teruel', 40.34, -1.11],

    // --- Cataluña
    ['Lleida', 41.62, 0.62], ['Reus', 41.15, 1.11], ['Tarragona', 41.12, 1.25],
    ['Tortosa', 40.81, 0.52], ['Barcelona', 41.39, 2.17],

    // --- Comunidad Valenciana
    ['Vinaròs', 40.47, 0.47], ['Peñíscola', 40.36, 0.40], ['Castelló de la Plana', 39.99, -0.04],
    ['Sagunt', 39.68, -0.27], ['València', 39.47, -0.38], ['Requena', 39.49, -1.10],
    ['Cullera', 39.16, -0.25], ['Gandia', 38.97, -0.18], ['Xàtiva', 38.99, -0.52],
    ['Dénia', 38.84, 0.11],

    // --- Illes Balears
    ['Sóller', 39.77, 2.71], ['Pollença', 39.87, 3.02], ['Alcúdia', 39.85, 3.12],
    ['Palma', 39.57, 2.65], ['Manacor', 39.57, 3.21], ['Cala Millor', 39.60, 3.38],
    ['Eivissa / Ibiza', 38.91, 1.43], ['Sant Antoni', 38.98, 1.30], ['Formentera', 38.70, 1.43],
    ['Maó', 39.89, 4.27],

    // --- Fuera de la banda (referencia)
    ['Madrid', 40.42, -3.70], ['Porto', 41.15, -8.61], ['Braga', 41.55, -8.42],
    ['Viana do Castelo', 41.69, -8.83], ['Bragança', 41.81, -6.76]
  ];

  var LIST = P.map(function (p) { return { name: p[0], lat: p[1], lon: p[2] }; });

  function distKm(a, b, c, d) {
    var R = Math.PI / 180;
    var dLat = (c - a) * 111.32;
    var dLon = (d - b) * 111.32 * Math.cos((a + c) / 2 * R);
    return Math.sqrt(dLat * dLat + dLon * dLon);
  }

  /** Localidad mas cercana; devuelve null si esta a mas de maxKm. */
  function nearest(lat, lon, maxKm) {
    var best = null, bd = Infinity;
    for (var i = 0; i < LIST.length; i++) {
      var d = distKm(lat, lon, LIST[i].lat, LIST[i].lon);
      if (d < bd) { bd = d; best = LIST[i]; }
    }
    if (maxKm && bd > maxKm) return null;
    return best ? { name: best.name, km: bd } : null;
  }

  global.Places = { list: LIST, nearest: nearest, distKm: distKm };
})(typeof window !== 'undefined' ? window : globalThis);
