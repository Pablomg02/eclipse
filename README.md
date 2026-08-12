# ¿Desde dónde veo el eclipse?

> ⚠️ **Léeme antes de fiarte de nada de esto.**
>
> Esta aplicación **la ha escrito Claude** (el modelo de IA de Anthropic), de
> principio a fin, **en unos 30 minutos**. Nadie ha revisado el código a fondo,
> nadie ha contrastado los resultados con una fuente independiente y no hay
> tests más allá de un puñado de comprobaciones que la propia IA se hizo a sí
> misma. Es decir: **está sin verificar**.
>
> Los números que verás (horas de contacto, duración de la totalidad,
> porcentajes de ocultación, alturas del Sol, puntuaciones) **pueden estar mal**,
> y estarlo de forma silenciosa y convincente. Un error de signo, un desfase
> horario o una interpolación mal hecha no se notan a simple vista: salen como
> un número perfectamente creíble.
>
> **Nadie en su sano juicio debería planificar un viaje —ni mucho menos decidir
> dónde ponerse el día del eclipse— basándose solo en lo que dice esta web.**
> Úsala como juguete, como punto de partida o como curiosidad técnica, y
> **contrasta siempre** con fuentes serias antes de tomar cualquier decisión:
>
> - [NASA / GSFC — Eclipse del 12 ago 2026](https://eclipse.gsfc.nasa.gov/SEsearch/SEsearchmap.php?Ecl=20260812)
> - [timeanddate.com](https://www.timeanddate.com/eclipse/solar/2026-august-12)
> - [Xavier Jubier — Interactive Google Map](http://xjubier.free.fr/en/site_pages/solar_eclipses/TSE_2026_GoogleMapFull.html)
> - AEMET u otro servicio meteorológico oficial para la predicción de nubes
>
> Y lo único que **no** es negociable: **nunca mires al Sol sin filtro
> homologado ISO 12312-2**, diga lo que diga cualquier mapa.

Mapa para decidir **a qué sitio ir** a ver el eclipse total de Sol del
**12 de agosto de 2026** en el norte de España.

Responde a la pregunta que importa: *¿va a estar el Sol tapado justo aquí a las
20:28?* — no solo "¿qué porcentaje de nubosidad hay?".

Web estática, sin backend ni claves de API. Se despliega tal cual en GitHub Pages.

## Qué hace

**Geometría del eclipse** — calculada en el navegador a partir de los elementos
besselianos oficiales de la NASA/GSFC (Espenak & Meeus, *Five Millennium Canon*),
no dibujada a ojo. Al tocar cualquier punto del mapa:

- totalidad o solo parcial, y porcentaje de ocultación
- contactos C1/C2/C3/C4, hora del máximo y duración de la totalidad
- altura y azimut del Sol en el momento clave

Comparado —por la propia IA que lo escribió, sin revisión externa— contra unas
pocas filas de la tabla oficial de la trayectoria de la NASA: línea central con
error de ~100 m, γ = 0.8978, anchuras de banda 319/315/306 km frente a
319/315/304 km, y duraciones parecidas a las publicadas (Oviedo 1 m 48 s,
Zaragoza 1 m 24 s, Palma 1 m 36 s, A Coruña ~1 m 16 s). Que coincidan cuatro
ciudades **no demuestra** que el resto del mapa esté bien.

**Nubes en la línea de visión** — el detalle que cambia todo en este eclipse.
Con el Sol a 2-12° sobre el horizonte, lo que te tapa el Sol **no son las nubes
que tienes encima**, sino las que hay hacia el oeste. La app calcula a qué
distancia cruza la visual cada capa de nubes (`h / tan(altura)`) y consulta ahí:

| capa | altura típica | Sol a 12° | Sol a 4° |
|------|---------------|-----------|----------|
| bajas | 1,2 km | ~6 km | ~17 km |
| medias | 4 km | ~19 km | ~57 km |
| altas | 9 km | ~42 km | ~129 km |

**Consenso multimodelo** — ECMWF, ICON, GFS, AROME/ARPEGE y UKMO por separado,
con su dispersión. Si un modelo dice 6 % y otro 97 %, la app lo dice en vez de
promediar y fingir seguridad.

**Horizonte real** — perfil del terreno con el DEM de Copernicus a lo largo del
azimut solar hasta 65 km, con corrección de curvatura y refracción. Distingue el
horizonte lejano (que sí penaliza la nota) del relieve inmediato a menos de 1 km
(que se arregla moviéndose 300 m, y por eso solo avisa).

**Puntuación 0-100** que combina cielo despejado en la visual × penalización por
Sol bajo × penalización por relieve × margen de banda. Un punto pegado al borde
de la banda con 26 s de totalidad no puntúa como uno con 1 m 48 s.

**Capa continua + ranking** — "Analizar nubes en esta zona" monta una rejilla
sobre la vista actual (~300 puntos en 3 peticiones), interpola una capa
semitransparente y lista los mejores sitios con nombre de localidad.

**Satélite** — imagen real de EUMETSAT (MTG GeoColour), no previsión. Para las
horas previas al eclipse es la señal más fiable de dónde están las nubes.

## Estructura

```
index.html
assets/style.css
js/besselian.js    motor del eclipse (elementos besselianos, circunstancias locales)
js/weather.js      cliente Open-Meteo + modelo de puntuación
js/cloudlayer.js   capa continua interpolada (en espacio Mercator)
js/places.js       localidades para poner nombre a los puntos
js/app.js          interfaz
data/*.json        geometría precalculada (banda, línea central, curvas de ocultación)
tools/build-data.js generador de esa geometría
tools/serve.js     servidor local para pruebas
```

La geometría se precalcula (marching squares sobre una malla de 0,5 M de puntos,
con los vértices del contorno refinados por bisección) para que el móvil no tenga
que hacer ese trabajo al abrir la página. Las circunstancias del punto que tocas
sí se calculan en vivo, y son instantáneas.

## Probar en local

```bash
node tools/serve.js      # http://localhost:8080
```

Regenerar la geometría (solo si tocas `js/besselian.js` o los parámetros de malla):

```bash
node tools/build-data.js
```

## Desplegar en GitHub Pages

```bash
git init
git add .
git commit -m "Mapa del eclipse del 12 de agosto de 2026"
git branch -M main
git remote add origin git@github.com:USUARIO/REPO.git
git push -u origin main
```

Luego en **Settings → Pages → Build and deployment**: *Deploy from a branch*,
rama `main`, carpeta `/ (root)`. No hace falta build ni workflow: son ficheros
estáticos. El fichero `.nojekyll` evita que Jekyll se meta por medio.

## Fuentes y límites

- Elementos besselianos: [NASA/GSFC](https://eclipse.gsfc.nasa.gov/SEbeselm/SEbeselm2001/SE2026Aug12Tbeselm.html) · ΔT = 71,4 s
- Meteorología y DEM: [Open-Meteo](https://open-meteo.com) (sin clave, CORS abierto)
- Satélite: [EUMETSAT View](https://view.eumetsat.int)
- Mapa base: OpenStreetMap, CARTO, OpenTopoMap

Advertencias honestas:

- **Código generado por IA en ~30 minutos y sin verificar por nadie.** No hay
  tests, no hay revisión humana del motor de cálculo y no se ha contrastado con
  una implementación independiente. Asume que puede haber errores.
- La geometría precalculada cubre el Atlántico norte y Europa occidental
  (lat 25-84 N, lon 60 O - 25 E). El cálculo por punto funciona en toda la zona
  de visibilidad.
- Las alturas del Sol son geométricas; la refracción lo sube ~0,5° cerca del
  horizonte, a tu favor.
- Los modelos meteorológicos a esta resolución no resuelven nubes de convección
  local. Con el Sol tan bajo, mira también el satélite y, si puedes, ten un
  plan B a una hora de coche.
- **Nunca mires al Sol sin filtro homologado ISO 12312-2.** Solo durante la
  totalidad —y solo si estás dentro de la banda— se puede mirar a simple vista.
