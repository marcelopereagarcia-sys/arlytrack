/**
 * Servicio de rastreo GPS en segundo plano y cálculo de métricas para MotoTrack.
 * Implementa expo-task-manager, expo-location con foreground service en Android,
 * cálculo de distancia con fórmula de Haversine, desnivel positivo y filtrado de ruido.
 */

import { Permission, PermissionsAndroid, Platform } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import {
  ActiveRideState,
  LiveMetrics,
  LocationPoint,
  TrackerStatus,
} from '@/types/ride';
import {
  clearActiveRideState,
  getActiveRideState,
  saveActiveRideState,
} from './storage';

export const MOTOTRACK_LOCATION_TASK = 'MOTOTRACK_BACKGROUND_LOCATION_TASK';

// Detectar si estamos ejecutando en Expo Go (donde Google Play restringe background location)
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

// Estado inicial de métricas en vivo
const INITIAL_METRICS: LiveMetrics = {
  currentSpeed: 0,
  maxSpeed: 0,
  avgSpeed: 0,
  totalDistanceKm: 0,
  totalDurationSeconds: 0,
  movingDurationSeconds: 0,
  currentAltitude: null,
  elevationGainMeters: 0,
  maxAltitudeMeters: null,
  minAltitudeMeters: null,
  isAutoPaused: false,
  isGpsSignalLost: false,
};

// Estado en memoria de la sesión activa
let activeState: ActiveRideState = {
  status: 'idle',
  startTime: null,
  pausedTime: null,
  totalPausedDuration: 0,
  lastMovingTimestamp: null,
  points: [],
  metrics: { ...INITIAL_METRICS },
};

// Suscriptores para notificar cambios en la interfaz (HUD y mapa)
type StateListener = (state: ActiveRideState) => void;
const listeners = new Set<StateListener>();

// Temporizador en primer plano para actualizar duración segundo a segundo
let durationTimer: ReturnType<typeof setInterval> | null = null;
let foregroundWatcher: Location.LocationSubscription | null = null;

// Variables internas de filtrado y control de sensores (A-03, A-05, A-06, EXT-03, EXT-04)
let lastFixTimestamp = 0;
let lastSaveAt = 0;
let lastLocationServicesCheck = 0;
let activeRestorePromise: Promise<ActiveRideState | null> | null = null;
let smoothedAltitude: number | null = null;
let elevationLocalMin: number | null = null;
let elevationLocalMax: number | null = null;
let elevationTrend: 'flat' | 'up' | 'down' = 'flat';
let elevationGainAccMeters = 0; // Acumulador continuo submétrico sin redondeo prematuro (H-01)
const ELEVATION_HYSTERESIS_THRESHOLD = 8; // Umbral de 8 m para eliminar falsos desniveles por ruido GPS

/**
 * Restablece el estado interno del filtro de altitud y acumulador de desnivel.
 */
function resetElevationFilterState() {
  smoothedAltitude = null;
  elevationLocalMin = null;
  elevationLocalMax = null;
  elevationTrend = 'flat';
  elevationGainAccMeters = 0;
}


/**
 * Notifica a todos los suscriptores activos del nuevo estado.
 */
function notifyListeners() {
  if (listeners.size === 0) return;
  const clonedState: ActiveRideState = {
    ...activeState,
    metrics: { ...activeState.metrics },
    points: [...activeState.points],
  };
  listeners.forEach((listener) => {
    try {
      listener(clonedState);
    } catch (err) {
      console.error('Error notificando suscriptor de tracker:', err);
    }
  });
}

/**
 * Suscribe un componente a las actualizaciones del estado de rastreo.
 * Devuelve función para cancelar la suscripción.
 */
export function subscribeToTracker(listener: StateListener): () => void {
  listeners.add(listener);
  // Emitir estado actual inmediatamente al suscribirse
  listener({
    ...activeState,
    metrics: { ...activeState.metrics },
    points: [...activeState.points],
  });

  return () => {
    listeners.delete(listener);
  };
}

/**
 * Obtiene el estado actual de la sesión.
 */
export function getTrackerState(): ActiveRideState {
  return {
    ...activeState,
    metrics: { ...activeState.metrics },
    points: [...activeState.points],
  };
}

/**
 * Fórmula de Haversine para calcular la distancia ortodrómica entre dos puntos GPS en km.
 */
export function calculateHaversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Radio de la Tierra en kilómetros
  const toRad = (angle: number) => (angle * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distancia en km
}

/**
 * Procesa una lista de ubicaciones GPS recibidas.
 * Aplica los filtros de ruido, actualiza distancia, velocidad y desnivel.
 */
export function processLocationUpdates(locations: Location.LocationObject[]): void {
  if (activeState.status !== 'recording' || !locations || locations.length === 0) {
    return;
  }

  let stateModified = false;
  const now = Date.now();

  for (const loc of locations) {
    const coords = loc.coords;

    // FILTRO DE RUIDO 1 (A-16, H-12): Umbral adaptativo (50 m en arranque primeros 30s, 25 m después)
    // Si coords.accuracy es null o indefinido (receptores GPS externos o ROMs sin error horizontal), no descartar ciegamente
    const elapsedSinceStart = activeState.startTime ? Math.max(0, loc.timestamp - activeState.startTime) : 0;
    const maxAllowedAccuracy = elapsedSinceStart < 30000 ? 50 : 25;
    if (coords.accuracy !== null && coords.accuracy !== undefined && coords.accuracy > maxAllowedAccuracy) {
      continue;
    }

    // Comprobar si el punto ya fue procesado por timestamp
    const lastPoint = activeState.points[activeState.points.length - 1];
    if (lastPoint && loc.timestamp <= lastPoint.timestamp) {
      continue;
    }

    // Calcular velocidad en km/h
    let speedKmh = 0;
    if (coords.speed !== null && coords.speed >= 0) {
      speedKmh = Math.round(coords.speed * 3.6 * 10) / 10; // Convertir m/s a km/h
    } else if (lastPoint) {
      // Si el sensor no proporciona velocidad, calcular con Haversine y tiempo
      const elapsedHours = (loc.timestamp - lastPoint.timestamp) / 3600000;
      if (elapsedHours > 0) {
        const segDistKm = calculateHaversineDistance(
          lastPoint.latitude,
          lastPoint.longitude,
          coords.latitude,
          coords.longitude
        );
        speedKmh = Math.round((segDistKm / elapsedHours) * 10) / 10;
      }
    }

    // Filtrar anomalías y picos espurios de aceleración y desaceleración GPS (A-08, EXT-08)
    if (lastPoint && loc.timestamp > lastPoint.timestamp) {
      const dtSec = (loc.timestamp - lastPoint.timestamp) / 1000;
      if (dtSec > 0 && dtSec <= 10) {
        const deltaV = speedKmh - (lastPoint.speed ?? 0);
        // Límite de 55 (km/h)/s (~1.55G sostenido): permite aceleraciones de motos deportivas y filtra glitches GPS bidireccionales
        // Para micro-cortes de 3 a 10s, acota el salto cinemático máximo
        const maxAllowedDeltaV = 55 * Math.min(dtSec, 4);
        if (deltaV > maxAllowedDeltaV || deltaV < -maxAllowedDeltaV) {
          speedKmh = lastPoint.speed ?? 0;
        }
      }
    }
    if (speedKmh > 300) {
      speedKmh = lastPoint ? (lastPoint.speed ?? 0) : 0;
    }

    // Registro de actividad continuo y timestamp de fix (A-06)
    lastFixTimestamp = now;
    activeState.lastMovingTimestamp = now;
    activeState.metrics.isAutoPaused = false;
    activeState.metrics.isGpsSignalLost = false;

    // Actualizar distancia acumulada con Haversine a precisión completa (A-01)
    let distIncrement = 0;
    if (lastPoint) {
      const segKm = calculateHaversineDistance(
        lastPoint.latitude,
        lastPoint.longitude,
        coords.latitude,
        coords.longitude
      );
      const timeDiffSec = loc.timestamp > lastPoint.timestamp ? (loc.timestamp - lastPoint.timestamp) / 1000 : 0;
      
      // Salida de túnel / paso inferior: validar velocidad aparente de cruce (H-08, ampliado a 600s para túneles alpinos largos EXT-03)
      const isTunnelExit = timeDiffSec > 10 && timeDiffSec <= 600 && (segKm / (timeDiffSec / 3600)) >= 3.0 && (segKm / (timeDiffSec / 3600)) <= 220.0;

      // Evitar acumular fluctuaciones por deriva GPS si estamos detenidos (H-09), garantizando simetría matemática con el tiempo
      const isMoving = (timeDiffSec <= 10 && speedKmh >= 3.0) || isTunnelExit;
      if (isMoving) {
        distIncrement = segKm;
        activeState.metrics.totalDistanceKm += distIncrement;
        if (timeDiffSec > 0) {
          activeState.metrics.movingDurationSeconds += Math.round(timeDiffSec);
        }
      }
    }

    // Actualizar altitud y desnivel positivo con algoritmo Peak-Valley e histéresis (A-05, H-01)
    const currentAlt = coords.altitude != null && !Number.isNaN(coords.altitude) ? Math.round(coords.altitude) : null;
    if (currentAlt !== null) {
      activeState.metrics.currentAltitude = currentAlt;

      // Filtro IIR paso-bajo suave (alpha = 0.1) para mitigar la dispersión aleatoria del GPS
      if (smoothedAltitude === null) {
        smoothedAltitude = currentAlt;
        elevationLocalMin = currentAlt;
        elevationLocalMax = currentAlt;
        elevationTrend = 'flat';
      } else {
        smoothedAltitude = smoothedAltitude * 0.9 + currentAlt * 0.1;
      }

      const ema = smoothedAltitude;
      if (elevationLocalMin !== null && elevationLocalMax !== null) {
        if (elevationTrend === 'flat') {
          if (ema - elevationLocalMin >= ELEVATION_HYSTERESIS_THRESHOLD) {
            elevationGainAccMeters += ema - elevationLocalMin;
            activeState.metrics.elevationGainMeters = Math.round(elevationGainAccMeters);
            elevationTrend = 'up';
            elevationLocalMax = ema;
            elevationLocalMin = ema;
          } else if (elevationLocalMax - ema >= ELEVATION_HYSTERESIS_THRESHOLD) {
            elevationTrend = 'down';
            elevationLocalMin = ema;
            elevationLocalMax = ema;
          } else {
            if (ema < elevationLocalMin) elevationLocalMin = ema;
            if (ema > elevationLocalMax) elevationLocalMax = ema;
          }
        } else if (elevationTrend === 'up') {
          if (ema > elevationLocalMax) {
            elevationGainAccMeters += ema - elevationLocalMax;
            activeState.metrics.elevationGainMeters = Math.round(elevationGainAccMeters);
            elevationLocalMax = ema;
            elevationLocalMin = ema;
          } else if (elevationLocalMax - ema >= ELEVATION_HYSTERESIS_THRESHOLD) {
            elevationTrend = 'down';
            elevationLocalMin = ema;
            elevationLocalMax = ema;
          }
        } else if (elevationTrend === 'down') {
          if (ema < elevationLocalMin) {
            elevationLocalMin = ema;
            elevationLocalMax = ema;
          } else if (ema - elevationLocalMin >= ELEVATION_HYSTERESIS_THRESHOLD) {
            elevationGainAccMeters += ema - elevationLocalMin;
            activeState.metrics.elevationGainMeters = Math.round(elevationGainAccMeters);
            elevationTrend = 'up';
            elevationLocalMax = ema;
            elevationLocalMin = ema;
          }
        }
      }

      if (
        activeState.metrics.maxAltitudeMeters === null ||
        currentAlt > activeState.metrics.maxAltitudeMeters
      ) {
        activeState.metrics.maxAltitudeMeters = currentAlt;
      }

      if (
        activeState.metrics.minAltitudeMeters === null ||
        currentAlt < activeState.metrics.minAltitudeMeters
      ) {
        activeState.metrics.minAltitudeMeters = currentAlt;
      }
    }

    // Actualizar velocidad actual y velocidad máxima
    activeState.metrics.currentSpeed = speedKmh;
    if (speedKmh > activeState.metrics.maxSpeed) {
      activeState.metrics.maxSpeed = speedKmh;
    }

    // Actualizar duración acumulada total en tiempo real (inmune a suspensiones del SO)
    if (activeState.startTime) {
      const elapsedSeconds = Math.max(
        0,
        Math.floor((now - activeState.startTime - activeState.totalPausedDuration) / 1000)
      );
      activeState.metrics.totalDurationSeconds = elapsedSeconds;
    }

    // Recalcular velocidad media (distancia / tiempo rodando)
    if (activeState.metrics.movingDurationSeconds > 0) {
      const movingHours = activeState.metrics.movingDurationSeconds / 3600;
      activeState.metrics.avgSpeed =
        Math.round((activeState.metrics.totalDistanceKm / movingHours) * 10) / 10;
    }

    // Crear punto registrado
    const newPoint: LocationPoint = {
      latitude: coords.latitude,
      longitude: coords.longitude,
      altitude: currentAlt,
      speed: speedKmh,
      accuracy: coords.accuracy != null ? Math.round(coords.accuracy) : null,
      timestamp: loc.timestamp || now,
    };

    activeState.points.push(newPoint);
    stateModified = true;
  }

  if (stateModified) {
    notifyListeners();
    // A-03: Throttle de persistencia a AsyncStorage cada 20 segundos
    if (now - lastSaveAt >= 20000) {
      lastSaveAt = now;
      saveActiveRideState(activeState);
    }
  }
}

/**
 * Registro de la tarea en segundo plano con TaskManager.
 * Debe definirse a nivel global fuera de cualquier componente React.
 */
TaskManager.defineTask(
  MOTOTRACK_LOCATION_TASK,
  async ({ data, error }: TaskManager.TaskManagerTaskBody<object>) => {
    if (error) {
      console.error('Error en tarea en segundo plano de MotoTrack:', error.message);
      return;
    }

    // H-02: Si Android mató la Activity por memoria, rehidratar la sesión activa desde disco
    if (activeState.status === 'idle') {
      await restoreActiveSession();
    }

    if (data && 'locations' in data) {
      const { locations } = data as { locations: Location.LocationObject[] };
      processLocationUpdates(locations);
    }
  }
);

/**
 * Temporizador que actualiza la duración total y la duración en movimiento cada segundo.
 */
function startDurationTimer() {
  stopDurationTimer();
  durationTimer = setInterval(() => {
    if (activeState.status === 'recording') {
      const now = Date.now();
      if (activeState.startTime) {
        const elapsedSeconds = Math.max(
          0,
          Math.floor((now - activeState.startTime - activeState.totalPausedDuration) / 1000)
        );
        activeState.metrics.totalDurationSeconds = elapsedSeconds;
      }

      // A-06 & EXT-03: Si han pasado más de 3 segundos sin recibir fixes, la velocidad cae a 0 y se marca pérdida de señal/túnel
      if (lastFixTimestamp > 0 && now - lastFixTimestamp > 3000) {
        activeState.metrics.currentSpeed = 0;
        activeState.metrics.isGpsSignalLost = true;
      }

      // EXT-04: Verificar periódicamente (cada 5s) si el servicio de ubicación sigue habilitado a nivel de SO
      if (now - lastLocationServicesCheck > 5000) {
        lastLocationServicesCheck = now;
        Location.hasServicesEnabledAsync()
          .then((enabled) => {
            if (!enabled && activeState.status === 'recording') {
              activeState.metrics.isGpsSignalLost = true;
              activeState.metrics.currentSpeed = 0;
              notifyListeners();
            }
          })
          .catch(() => {
            // Ignorar errores transitorios de llamada nativa
          });
      }

      // Actualizar velocidad promedio
      if (activeState.metrics.movingDurationSeconds > 0) {
        const movingHours = activeState.metrics.movingDurationSeconds / 3600;
        activeState.metrics.avgSpeed =
          Math.round((activeState.metrics.totalDistanceKm / movingHours) * 10) / 10;
      }

      notifyListeners();
    }
  }, 1000);
}

function stopDurationTimer() {
  if (durationTimer) {
    clearInterval(durationTimer);
    durationTimer = null;
  }
}

/**
 * Vincula los receptores de GPS de primer y segundo plano con máxima precisión (A-02).
 * Idempotente: seguro de invocar en startTracking, resumeTracking y restoreActiveSession.
 */
export async function attachLocationSources(): Promise<void> {
  // 1. Iniciar/actualizar servicio en segundo plano con notificación permanente en Android
  if (!isExpoGo) {
    try {
      await Location.startLocationUpdatesAsync(MOTOTRACK_LOCATION_TASK, {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 1000, // Cada 1 segundo
        distanceInterval: 3, // Cada 3 metros
        deferredUpdatesInterval: 1000,
        deferredUpdatesDistance: 3,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: 'ArlyTrack en marcha',
          notificationBody: 'ArlyTrack está grabando tu telemetría en segundo plano...',
          notificationColor: '#00F0FF',
          killServiceOnDestroy: false,
        },
        pausesUpdatesAutomatically: false,
        activityType: Location.ActivityType.AutomotiveNavigation,
      });
    } catch (taskErr) {
      console.warn('Aviso: Rastreo en segundo plano no disponible en esta sesión:', taskErr);
    }
  }

  // 2. Iniciar observador en primer plano para máxima fluidez en mapa y HUD si no está activo
  if (!foregroundWatcher) {
    foregroundWatcher = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 1000,
        distanceInterval: 2,
      },
      (loc) => {
        processLocationUpdates([loc]);
      }
    );
  }
}

/**
 * Inicia una nueva ruta de rastreo GPS.
 */
export async function startTracking(): Promise<{ success: boolean; error?: string }> {
  try {
    // 1. Permiso de notificaciones en Android 13+ (A-10)
    if (Platform.OS === 'android' && typeof Platform.Version === 'number' && Platform.Version >= 33) {
      try {
        const notifPermission = 'android.permission.POST_NOTIFICATIONS' as Permission;
        const hasNotif = await PermissionsAndroid.check(notifPermission);
        if (!hasNotif) {
          await PermissionsAndroid.request(notifPermission);
        }
      } catch (notifErr) {
        console.warn('Aviso: No se pudo solicitar permiso de notificaciones:', notifErr);
      }
    }

    // 2. Solicitar permisos de ubicación en primer plano
    const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
    if (fgStatus !== 'granted') {
      return {
        success: false,
        error: 'Permiso de ubicación denegado. Es necesario para registrar tus rutas en moto.',
      };
    }

    // 3. Solicitar permisos en segundo plano (protegido contra rechazo o ausencia en manifest)
    try {
      const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
      if (bgStatus !== 'granted') {
        console.warn('Permiso en segundo plano no concedido. El rastreo funcionará en primer plano.');
      }
    } catch (bgErr) {
      console.warn('Aviso: No se pudo solicitar permiso de segundo plano en el dispositivo:', bgErr);
    }

    // 4. Obtener posición inicial para centrar rápido
    const initialPos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    const now = Date.now();
    resetElevationFilterState();
    activeState = {
      status: 'recording',
      startTime: now,
      pausedTime: null,
      totalPausedDuration: 0,
      lastMovingTimestamp: now,
      points: [],
      metrics: {
        ...INITIAL_METRICS,
        currentAltitude: initialPos.coords.altitude != null && !Number.isNaN(initialPos.coords.altitude) ? Math.round(initialPos.coords.altitude) : null,
      },
    };

    // Procesar punto inicial
    processLocationUpdates([initialPos]);

    // 5. Vincular receptores de ubicación (primer y segundo plano) (A-02)
    await attachLocationSources();

    // 6. Iniciar cronómetro de duración
    startDurationTimer();
    saveActiveRideState(activeState);
    notifyListeners();

    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Error desconocido al iniciar el GPS.';
    console.error('Error al iniciar el rastreo GPS:', err);
    return { success: false, error: errorMsg };
  }
}

/**
 * Pausa la grabación de la ruta actual.
 * Degrada el consumo de GPS en segundo plano a modo equilibrado sin matar el Foreground Service (A-18).
 */
export async function pauseTracking(): Promise<void> {
  if (activeState.status !== 'recording') return;

  activeState.status = 'paused';
  activeState.pausedTime = Date.now();
  activeState.metrics.currentSpeed = 0;

  stopDurationTimer();
  if (foregroundWatcher) {
    foregroundWatcher.remove();
    foregroundWatcher = null;
  }

  // A-18: Degradar tarea en segundo plano a bajo consumo para proteger el proceso en descansos
  if (!isExpoGo) {
    try {
      const isTaskRunning = await Location.hasStartedLocationUpdatesAsync(MOTOTRACK_LOCATION_TASK);
      if (isTaskRunning) {
        await Location.startLocationUpdatesAsync(MOTOTRACK_LOCATION_TASK, {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 30000,
          distanceInterval: 50,
          deferredUpdatesInterval: 30000,
          deferredUpdatesDistance: 50,
          showsBackgroundLocationIndicator: true,
          foregroundService: {
            notificationTitle: 'ArlyTrack en pausa',
            notificationBody: 'Ruta pausada (modo descanso). Pulsa para volver a la app.',
            notificationColor: '#FF7A00',
            killServiceOnDestroy: false,
          },
          pausesUpdatesAutomatically: false,
          activityType: Location.ActivityType.AutomotiveNavigation,
        });
      }
    } catch (err) {
      console.warn('Advertencia al ajustar tarea en segundo plano para pausa:', err);
    }
  }

  await saveActiveRideState(activeState);
  notifyListeners();
}

/**
 * Reanuda la grabación de la ruta en pausa.
 */
export async function resumeTracking(): Promise<void> {
  if (activeState.status !== 'paused') return;

  const now = Date.now();
  if (activeState.pausedTime) {
    activeState.totalPausedDuration += now - activeState.pausedTime;
    activeState.pausedTime = null;
  }
  activeState.lastMovingTimestamp = now;
  activeState.status = 'recording';

  // Reactivar observadores con máxima precisión (A-02, A-18)
  await attachLocationSources();

  startDurationTimer();
  await saveActiveRideState(activeState);
  notifyListeners();
}

/**
 * Detiene el rastreo y marca el estado como 'finished', conservándolo en almacenamiento (A-17).
 * NO borra la sesión activa de AsyncStorage para que una muerte de app en el modal de guardado
 * no cause pérdida irreversible de datos.
 */
export async function stopTracking(): Promise<ActiveRideState> {
  // H-07: Si la ruta estaba en pausa, consolidar el tiempo transcurrido en pausa
  const now = Date.now();
  if (activeState.status === 'paused' && activeState.pausedTime) {
    activeState.totalPausedDuration += now - activeState.pausedTime;
    activeState.pausedTime = null;
  }

  // Detener segundo plano si estaba activo
  if (!isExpoGo) {
    try {
      const isTaskRunning = await Location.hasStartedLocationUpdatesAsync(MOTOTRACK_LOCATION_TASK);
      if (isTaskRunning) {
        await Location.stopLocationUpdatesAsync(MOTOTRACK_LOCATION_TASK);
      }
    } catch (err) {
      console.warn('Advertencia al detener tarea en segundo plano:', err);
    }
  }

  // Detener observadores y temporizadores
  stopDurationTimer();
  if (foregroundWatcher) {
    foregroundWatcher.remove();
    foregroundWatcher = null;
  }

  activeState.status = 'finished';
  activeState.metrics.currentSpeed = 0;

  await saveActiveRideState(activeState);
  notifyListeners();

  return { ...activeState };
}

/**
 * Limpia y restablece definitivamente la sesión activa tras guardarla o descartarla (A-17).
 */
export async function discardOrFinalizeActiveRide(): Promise<void> {
  stopDurationTimer();
  if (foregroundWatcher) {
    foregroundWatcher.remove();
    foregroundWatcher = null;
  }

  if (!isExpoGo) {
    try {
      const isTaskRunning = await Location.hasStartedLocationUpdatesAsync(MOTOTRACK_LOCATION_TASK);
      if (isTaskRunning) {
        await Location.stopLocationUpdatesAsync(MOTOTRACK_LOCATION_TASK);
      }
    } catch (err) {
      // Ignorar si no estaba en ejecución
    }
  }

  activeState = {
    status: 'idle',
    startTime: null,
    pausedTime: null,
    totalPausedDuration: 0,
    lastMovingTimestamp: null,
    points: [],
    metrics: { ...INITIAL_METRICS },
  };

  resetElevationFilterState();
  await clearActiveRideState();
  notifyListeners();
}

/**
 * Intenta restaurar una sesión activa previa si la app fue cerrada mientras grababa o en estado de guardado (A-02, A-17).
 */
export async function restoreActiveSession(): Promise<ActiveRideState | null> {
  if (activeRestorePromise) {
    return activeRestorePromise;
  }

  activeRestorePromise = (async () => {
    try {
      const savedState = await getActiveRideState();
      if (
        savedState &&
        (savedState.status === 'recording' || savedState.status === 'paused' || savedState.status === 'finished')
      ) {
        activeState = savedState;
        // H-01: Restaurar acumulador métrico de desnivel para no resetear lo ganado antes de la suspensión/reinicio
        elevationGainAccMeters = activeState.metrics.elevationGainMeters || 0;
        smoothedAltitude = activeState.metrics.currentAltitude ?? null;
        elevationLocalMin = smoothedAltitude;
        elevationLocalMax = smoothedAltitude;
        elevationTrend = 'flat';

        // Solo rearmar temporizador y GPS si la ruta seguía activamente grabando
        if (activeState.status === 'recording') {
          // EXT-09: En Android 14+ verificar permisos antes de rearmar para evitar SecurityException fatal
          const { status: permStatus } = await Location.getForegroundPermissionsAsync();
          if (permStatus === 'granted') {
            startDurationTimer();
            await attachLocationSources();
          } else {
            // Si el usuario revocó permisos en Ajustes con la app cerrada, pausar de forma segura sin crashear
            activeState.status = 'paused';
            activeState.pausedTime = Date.now();
            await saveActiveRideState(activeState);
          }
        }
        notifyListeners();
        return activeState;
      }
      return null;
    } finally {
      activeRestorePromise = null;
    }
  })();

  return activeRestorePromise;
}

/**
 * Utilidades exclusivas para pruebas unitarias automatizadas.
 * Se exportan porque manipulan el estado privado del módulo, pero quedan inertes fuera
 * de desarrollo y pruebas para que una llamada accidental no corrompa una ruta real.
 */
export function _resetTrackerForTesting(): void {
  if (!__DEV__) return;
  stopDurationTimer();
  if (foregroundWatcher) {
    foregroundWatcher.remove();
    foregroundWatcher = null;
  }
  resetElevationFilterState();
  lastFixTimestamp = 0;
  lastSaveAt = 0;
  activeRestorePromise = null;
  activeState = {
    status: 'idle',
    startTime: null,
    pausedTime: null,
    totalPausedDuration: 0,
    lastMovingTimestamp: null,
    points: [],
    metrics: { ...INITIAL_METRICS },
  };
}

export function _setActiveStateForTesting(state: Partial<ActiveRideState>): void {
  if (!__DEV__) return;
  activeState = {
    ...activeState,
    ...state,
    metrics: {
      ...activeState.metrics,
      ...(state.metrics || {}),
    },
  };
  if (state.status === 'recording' && !activeState.startTime) {
    activeState.startTime = Date.now();
  }
}

