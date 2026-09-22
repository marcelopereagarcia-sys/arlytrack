# Auditoría técnica — ArlyTrack

**Proyecto:** ArlyTrack (`C:\IA\test\MOTOS\mototrack`)
**Fecha:** 4 de septiembre de 2026
**Commit auditado:** `ae2cbb1` (+ cambios sin commitear en el árbol de trabajo)
**Auditor:** Claude Opus 5
**Destinatario:** agente de implementación (Antigravity)

---

## 0. Contexto para el implementador

| Dato | Valor |
|---|---|
| Stack | Expo SDK 57 · React Native 0.86.3 · React 19.2.3 · expo-router 57 · TypeScript 6.0 |
| Plataforma objetivo | **Android únicamente** (uso personal, sin publicación en tienda) |
| Perfil de usuario | Un solo usuario, rutas en moto por carretera de montaña y ciudad |
| Persistencia | AsyncStorage local, sin backend |
| Mapa | Leaflet dentro de `react-native-webview` (no se usa `react-native-maps`) |
| Build | EAS managed (`android/` está vacío, no hay prebuild) |

**Estado de partida verificado:**

```bash
npx tsc --noEmit
```

Pasa limpio, cero errores.

```bash
npx jest --ci
```

Falla: 2 suites, 0 tests ejecutados (ver A-09).

### Reglas de alcance para el implementador

- **NO** reescribir la arquitectura. La separación `services/` (sin React) + pub/sub hacia la UI es correcta y debe conservarse.
- **NO** migrar a `react-native-maps`. La decisión de usar Leaflet en WebView es deliberada y buena.
- **NO** añadir backend, cuentas ni sincronización. La app es local y así se queda.
- **NO** cambiar la paleta de `constants/Colors.ts` ni el diseño del HUD.
- Cada hallazgo lleva un **criterio de aceptación**. No lo des por cerrado sin cumplirlo.

---

## 1. Resumen ejecutivo

Arquitectura y tipado están bien. **El problema real es que las métricas que la app muestra no son correctas.** El odómetro —la métrica principal de una app de rutas— está mal a *todas* las velocidades, y por debajo de ~18 km/h se queda congelado en 0 km de forma permanente.

| Severidad | Nº | Hallazgos |
|---|---|---|
| 🔴 Crítico | 2 | A-01, A-02 |
| 🟠 Alto | 4 | A-03 … A-06 |
| 🟡 Medio | 5 | A-07 … A-11 |
| ⚪ Bajo | 5 | A-12 … A-16 |

**Orden de ejecución recomendado:** A-01 → A-02 → A-09 (tests, para poder validar lo demás) → A-05 → A-06 → A-03 → A-04 → resto.

---

## 2. Hallazgos críticos

### 🔴 A-01 — El odómetro es incorrecto a todas las velocidades y se congela por debajo de 18 km/h

**Archivo:** `services/tracker.ts:196-201`

**Código actual:**

```ts
if (segKm > 0.003 || speedKmh >= 3.0) {
  distIncrement = segKm;
  activeState.metrics.totalDistanceKm =
    Math.round((activeState.metrics.totalDistanceKm + distIncrement) * 100) / 100;
}
```

**Qué pasa:** el acumulador se **redondea a 2 decimales en cada punto GPS**, en vez de acumular a precisión completa y redondear sólo al mostrar. Con `timeInterval: 1000` llega ~1 punto por segundo, así que cada incremento es pequeño y el redondeo lo destruye o lo amplifica.

- A 15 km/h el incremento por punto es 0,0042 km. `Math.round(0.42) / 100 = 0`, así que **el total nunca sube de 0,00**.
- A 20 km/h el incremento es 0,00556 km, que redondea a 0,01 **en cada punto**: cuenta 36 km donde hay 20.

**Reproducción** (simula 1 hora a velocidad constante con la lógica actual):

```js
function simular(velocidadKmh, segundos) {
  const metrosPorSeg = velocidadKmh / 3.6;
  let total = 0, totalPreciso = 0;
  for (let s = 0; s < segundos; s++) {
    const segKm = metrosPorSeg / 1000;
    if (segKm > 0.003 || velocidadKmh >= 3.0) {
      total = Math.round((total + segKm) * 100) / 100;  // logica actual
      totalPreciso += segKm;                            // logica correcta
    }
  }
  return { mostrado: total, real: Math.round(totalPreciso * 100) / 100 };
}
[10, 15, 17, 18, 20, 30, 50, 90].forEach(v => console.log(v, simular(v, 3600)));
```

**Resultado medido:**

| Velocidad | km mostrados | km reales | Error |
|---|---|---|---|
| 10 km/h | 0 | 10 | **−100 %** |
| 15 km/h | 0 | 15 | **−100 %** |
| 17 km/h | 0 | 17 | **−100 %** |
| 18 km/h | 0,03 | 18 | −99,8 % |
| 20 km/h | 36 | 20 | **+80 %** |
| 30 km/h | 36 | 30 | +20 % |
| 50 km/h | 36 | 50 | −28 % |
| 90 km/h | 104,09 | 90 | +15,7 % |

> El escenario es a velocidad constante con un fix por segundo, que es lo configurado (`timeInterval: 1000`, `distanceInterval: 2`). Con GPS real la magnitud varía, pero el sesgo estructural no desaparece: **nunca da la distancia correcta.**

**Por qué importa:** invalida la distancia, y en cascada la velocidad media (que se calcula a partir de ella) y el consumo/coste de combustible de `components/FinishRideModal.tsx:80-83`. Es toda la telemetría de la app.

**Fix:** mantener el acumulador en precisión completa y redondear sólo en la capa de presentación.

```ts
// Acumular sin redondear
activeState.metrics.totalDistanceKm += distIncrement;
```

Redondear con `.toFixed(2)` en el render (`app/(tabs)/index.tsx` ya lo hace) y en `FinishRideModal` al construir el `RideSession`. Aplicar el mismo criterio a `avgSpeed` (`services/tracker.ts:250-253` y `services/tracker.ts:314-318`): acumular en crudo, redondear al mostrar.

**Criterio de aceptación:** con el script de arriba adaptado al código corregido, el error a 10/15/20/50/90 km/h debe ser menor del 0,5 % en todos los casos. Añadir un test unitario que lo cubra.

---

### 🔴 A-02 — Al restaurar una sesión interrumpida, el GPS no se reactiva

**Archivo:** `services/tracker.ts:525-537`

**Código actual:**

```ts
export async function restoreActiveSession(): Promise<ActiveRideState | null> {
  const savedState = await getActiveRideState();
  if (savedState && (savedState.status === 'recording' || savedState.status === 'paused')) {
    activeState = savedState;
    if (activeState.status === 'recording') {
      startDurationTimer();          // <-- solo arranca el reloj
    }
    notifyListeners();
    return activeState;
  }
  return null;
}
```

**Qué pasa:** restaura el estado y arranca el cronómetro, pero **nunca vuelve a llamar a `Location.watchPositionAsync`** ni comprueba `Location.hasStartedLocationUpdatesAsync(MOTOTRACK_LOCATION_TASK)`. La variable de módulo `foregroundWatcher` vale `null` tras un reinicio del proceso.

**Reproducción:** iniciar una ruta, matar la app desde el gestor de tareas (o dejar que Android la mate por memoria), reabrirla. El cronómetro sigue corriendo y la ruta aparece "grabando", pero **la distancia y la traza se quedan congeladas indefinidamente**.

**Por qué importa:** en Android es un escenario habitual, no un caso límite — el sistema mata apps en segundo plano con normalidad, y más aún con las capas de Xiaomi / Samsung / Huawei. Resultado: rutas largas que se pierden sin que el usuario se entere hasta el final.

**Fix:** extraer el arranque de sensores de `startTracking()` a una función reutilizable (por ejemplo `attachLocationSources()`) que registre el watcher de primer plano y, si procede, la tarea de segundo plano; llamarla desde `startTracking()`, `resumeTracking()` y `restoreActiveSession()`. Atención a la idempotencia: no duplicar el watcher si ya existe.

**Criterio de aceptación:** matar la app a mitad de ruta y reabrirla; la distancia debe seguir aumentando al moverse y la polilínea debe continuar desde donde estaba.

---

## 3. Hallazgos altos

### 🟠 A-03 — Se escribe el array completo de puntos en disco una vez por segundo

**Archivo:** `services/tracker.ts:273` (dentro de `processLocationUpdates`)

`saveActiveRideState(activeState)` serializa el objeto entero —incluido `points`— en cada fix GPS. Una ruta de 3 h a 1 Hz son unos 10.000 puntos: `JSON.stringify` de varios MB, una vez por segundo, sobre AsyncStorage.

**Impacto:** consumo de batería y bloqueos del hilo de JS que se notan justo cuando la ruta se alarga. En una app cuyo propósito es grabar rutas largas, es un problema que crece con el uso.

**Fix:** throttle a 15–30 s (con guardado inmediato en `pause` y `stop`), o persistir sólo el delta de puntos nuevos. Lo más simple: una variable de módulo `lastSaveAt` y `if (now - lastSaveAt > 15000)`.

**Criterio de aceptación:** durante una grabación de 30 min, el número de escrituras a AsyncStorage debe ser 150 o menos (hoy son unas 1.800).

---

### 🟠 A-04 — El mapa reinyecta todos los puntos en cada actualización

**Archivo:** `components/MotorcycleMap.tsx:277-286` y `295-302`

```ts
const pointsData = JSON.stringify(
  points.map((p) => ({ latitude: p.latitude, longitude: p.longitude }))
);
webViewRef.current?.injectJavaScript(
  `if (window.updateRoute) { window.updateRoute('${pointsData}'); } true;`
);
```

Cada punto nuevo dispara el `useEffect` y vuelve a serializar **la traza entera** para cruzar el puente hacia el WebView. Coste O(n) por punto, O(n²) por ruta.

**Fix:** añadir `window.appendPoint(lat, lon)` al HTML de Leaflet, que haga `polyline.addLatLng(...)`, y usarlo para el caso incremental. Reservar `updateRoute` para la carga inicial y para el historial. Mantener `fitBoundsOnLoad` como está.

**Mejora adicional:** para rutas de más de 5.000 puntos, simplificar la polilínea con Douglas-Peucker **sólo para el render**, nunca para los datos guardados.

**Criterio de aceptación:** el tamaño del string inyectado por punto nuevo debe ser constante, no proporcional a `points.length`.

---

### 🟠 A-05 — El desnivel positivo se infla con el ruido del GPS

**Archivo:** `services/tracker.ts:211-216`

```ts
if (altDiff >= 1) {
  activeState.metrics.elevationGainMeters += Math.round(altDiff);
}
```

Umbral de **1 metro entre muestras consecutivas a 1 Hz**, cuando el error típico de altitud GPS es de ±10 m y fluctúa constantemente. Parado en un semáforo, la altitud oscila y cada oscilación positiva de 1 m o más se suma al desnivel.

**Fix:** aplicar un umbral **acumulado** con histéresis, no por muestra. Patrón habitual: mantener una `altitudReferencia`; sólo cuando la altitud actual la supera en 5–8 m, sumar la diferencia y actualizar la referencia; si baja más de ese umbral, mover la referencia hacia abajo sin sumar nada. Opcionalmente, suavizar la altitud con una media móvil de 5–10 muestras antes de comparar.

**Criterio de aceptación:** test con una serie sintética de altitud constante más ruido gaussiano de ±10 m durante 600 muestras. `elevationGainMeters` debe quedar por debajo de 20 m (hoy daría cientos).

---

### 🟠 A-06 — El velocímetro se queda congelado en el último valor al detenerse

**Archivo:** `services/tracker.ts:234`

`currentSpeed` sólo se asigna al procesar un fix nuevo (línea 234) y al pausar manualmente (línea 437). No hay nada que lo lleve a 0 cuando dejan de llegar actualizaciones. Con `distanceInterval: 2`, al pararse la moto los fixes se espacian o cesan, y **el HUD sigue mostrando la última velocidad registrada** (por ejemplo "47 km/h" con la moto parada en un semáforo).

**Fix:** en el `durationTimer` (`services/tracker.ts:298`, que ya corre cada segundo), si han pasado más de unos 3 s desde el último punto registrado, forzar `currentSpeed = 0`. Guardar el timestamp del último fix en el estado del módulo.

**Criterio de aceptación:** parar el movimiento durante 5 s con la ruta grabando. El HUD debe mostrar 0 km/h.

---

## 4. Hallazgos medios

### 🟡 A-07 — "Tiempo Rodando" no mide tiempo rodando

**Archivo:** `services/tracker.ts:243-247` y `308-312`; etiqueta en `app/(tabs)/index.tsx:349`

```ts
activeState.metrics.totalDurationSeconds = elapsedSeconds;
activeState.metrics.movingDurationSeconds = elapsedSeconds;   // identicos
```

`movingDurationSeconds` es igual al tiempo total menos las pausas **manuales**. El contrato del tipo (`types/ride.ts:24`) dice `// Duración en movimiento (velocidad >= 3 km/h)`, pero ese filtro nunca se aplica. Consecuencia: los semáforos cuentan como tiempo rodando, y la "velocidad media" es media total, no media en marcha.

**Decisión requerida:** o (a) implementar el filtro real, acumulando segundos sólo cuando `currentSpeed >= 3`, o (b) renombrar la etiqueta del HUD a "Tiempo total" y corregir el comentario del tipo. **Recomendación: (a)** — la diferencia entre media total y media rodando es justo lo interesante en una ruta de montaña. Si se elige (a), depende de que A-06 esté resuelto antes.

---

### 🟡 A-08 — La velocidad máxima es vulnerable a un único pico de GPS

**Archivo:** `services/tracker.ts:180-182`

El único filtro es `if (speedKmh > 300)`. Un glitch de 150–200 km/h (habitual al salir de un túnel o bajo un puente) pasa el filtro y queda grabado para siempre como máxima de la ruta, además de aparecer en la tarjeta para compartir.

**Fix:** descartar el punto si la aceleración implícita no es física, por ejemplo si hay más de 30 km/h de diferencia respecto al punto anterior en menos de 1 s. Mantener también el techo de 300.

---

### 🟡 A-09 — La suite de tests no ejecuta ni un solo test

```
FAIL components/__tests__/StyledText-test.js
  Could not locate module react-native/setup-env
Test Suites: 2 failed, 2 total
Tests: 0 total
```

Incompatibilidad entre `jest-expo@~57.0.5` y `react-native@0.86.3` en el resolver de `@react-native/jest-preset`. Los dos tests de Haversine que hay escritos **nunca se han ejecutado**.

**Por qué importa aquí:** es bloqueante para validar A-01, A-05 y A-08, que son exactamente los hallazgos que necesitan verificación numérica. **Resolver esto antes que esos tres.**

**Fix:** alinear versiones de `jest-expo` y `@react-native/jest-preset` con RN 0.86, o añadir un `moduleNameMapper` explícito en la configuración de Jest de `package.json`.

**Criterio de aceptación:** `npx jest --ci` ejecuta y pasa 2 tests o más.

---

### 🟡 A-10 — `POST_NOTIFICATIONS` se declara pero no se pide en runtime (Android 13+)

`app.json:39` declara el permiso, pero no hay ninguna solicitud en tiempo de ejecución en todo el código (`expo-notifications` ni siquiera está en `package.json`). Desde Android 13 el permiso es de runtime: sin concederlo, la notificación persistente del foreground service no se muestra.

**Impacto:** el usuario no ve el indicador de que la app está grabando, y algunas capas de fabricante son más agresivas matando servicios sin notificación visible. Dado que el target es Android exclusivamente y el uso es en segundo plano con el móvil en el bolsillo, conviene resolverlo.

**Fix:** solicitar el permiso de notificaciones antes de arrancar el foreground service en `startTracking()`.

---

### 🟡 A-11 — No hay tiles offline (hueco de producto)

`components/MotorcycleMap.tsx:114-122` carga tiles de OSM, ArcGIS y CartoDB por red, sin caché. **El caso de uso declarado son puertos de montaña, que es exactamente donde no hay cobertura.** La ruta demo del propio código es "Puerto de la Cruz Verde – El Escorial".

La grabación GPS sí funciona sin red (el GPS no necesita datos), así que **la ruta no se pierde**. Pero el mapa se ve gris mientras se conduce.

**Fix (opcional, es mejora y no corrección):** cachear tiles con `localStorage` del WebView o con `expo-file-system` para una zona y unos niveles de zoom acotados. Es la funcionalidad que más valor aportaría al uso real, pero **no abordarla hasta cerrar los críticos y altos.**

---

## 5. Hallazgos bajos

| ID | Hallazgo | Archivo | Acción |
|---|---|---|---|
| ⚪ **A-12** | `AGENTS.md` ordena leer los docs de **Expo v51** estando el proyecto en **Expo 57**. Ese fichero se carga en cada sesión de agente y dirige a documentación equivocada. | `AGENTS.md` | Actualizar a `https://docs.expo.dev/versions/v57.0.0/` |
| ⚪ **A-13** | `react-native-maps` y `expo-linking` están en `package.json` con **cero usos** en el código. `react-native-maps` arrastra el SDK de Google Maps al build nativo. | `package.json` | Desinstalar ambas |
| ⚪ **A-14** | `getRides()` **escribe** la ruta demo en AsyncStorage en la primera lectura, así que pasa a ser una ruta real que el usuario debe borrar a mano. | `services/storage.ts:80-84` | Devolver la demo sin persistirla |
| ⚪ **A-15** | Las URIs de `ImagePicker` se guardan tal cual; no se usa `expo-file-system` en ningún sitio. En Android el directorio de caché puede vaciarse por presión de almacenamiento y las fotos de perfil y de ruta se romperían. | `components/RiderProfileModal.tsx:81-85`, `services/storage.ts` | Copiar a `documentDirectory` al seleccionar |
| ⚪ **A-16** | Filtro de precisión fijo en 25 m. En arranque en frío los primeros fixes suelen tener 30–50 m de precisión y se descartan todos, retrasando el inicio de la traza. | `services/tracker.ts:151` | Umbral adaptativo: permisivo (50 m) los primeros 30 s, luego 25 m |

**Nota menor sin acción:** los `timestamp` de la ruta demo son `1..12` (época 1970). Verificado que ni `RouteReplayModal` ni `RideDetailModal` usan ese campo, así que hoy es inocuo. Tenerlo presente si se añade análisis temporal del trazado.

---

## 6. Lo que está bien y no hay que tocar

Para que el implementador no "arregle" lo que ya funciona:

- **Separación de capas.** `services/tracker.ts` y `services/storage.ts` no importan React. El pub/sub con `Set<StateListener>` y el clonado defensivo del estado en `notifyListeners()` está bien resuelto.
- **Tipado estricto real.** Cero `any`, `tsc --noEmit` limpio. Mantener el listón.
- **Leaflet en WebView en lugar de `react-native-maps`.** Evita la API key de Google, la facturación y la configuración nativa, y da el modo satélite gratis. Decisión correcta.
- **Detección de Expo Go** (`services/tracker.ts:22`) para no intentar background location donde no está disponible. Buen detalle.
- **Diseño del HUD:** botones de 68 px para guantes, alto contraste, modo descanso con cronómetro. Está pensado para usarse con casco.
- **Fallback de velocidad por Haversine** cuando el sensor no proporciona `speed` (`services/tracker.ts:170-179`). Correcto.

---

## 7. Checklist de entrega

```
[ ] A-09  Tests ejecutan (prerequisito de validacion)
[ ] A-01  Odometro con acumulador de precision completa + test de error < 0,5%
[ ] A-02  restoreActiveSession reengancha los sensores GPS
[ ] A-05  Desnivel con umbral acumulado + test con ruido sintetico
[ ] A-06  currentSpeed cae a 0 tras 3 s sin fix
[ ] A-03  Persistencia throttled a <= 1 escritura / 15 s
[ ] A-04  appendPoint incremental en el WebView
[ ] A-07  Decision tomada: filtrar tiempo en movimiento o renombrar etiqueta
[ ] A-08  Filtro de aceleracion en velocidad maxima
[ ] A-10  Permiso de notificaciones solicitado en runtime
[ ] A-12  AGENTS.md apunta a los docs de Expo 57
[ ] A-13  react-native-maps y expo-linking desinstaladas
[ ] A-14  Ruta demo no se persiste
[ ] A-15  Fotos copiadas a documentDirectory
[ ] A-16  Umbral de precision adaptativo en arranque
[ ] A-11  (Opcional, ultimo) Tiles offline
```

**Verificación final:** `npx tsc --noEmit` limpio y `npx jest --ci` en verde. Después, prueba de campo: una ruta real de 20 min o más que incluya tramo urbano lento (por debajo de 20 km/h) y tramo de carretera, contrastando la distancia mostrada contra el cuentakilómetros de la moto o contra Google Maps.
