/**
 * Pruebas unitarias para las funciones de cálculo matemático y filtros de MotoTrack.
 */

// Mock de AsyncStorage para el entorno de pruebas de Jest
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// Mock de expo-task-manager y expo-location
jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn().mockResolvedValue(false),
}));

jest.mock('expo-location', () => ({
  Accuracy: {
    BestForNavigation: 6,
    High: 4,
    Balanced: 3,
  },
  ActivityType: {
    AutomotiveNavigation: 2,
  },
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  requestBackgroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getCurrentPositionAsync: jest.fn().mockResolvedValue({
    coords: {
      latitude: 40.4168,
      longitude: -3.7038,
      altitude: 650,
      speed: 0,
      accuracy: 5,
    },
    timestamp: Date.now(),
  }),
  startLocationUpdatesAsync: jest.fn().mockResolvedValue(undefined),
  stopLocationUpdatesAsync: jest.fn().mockResolvedValue(undefined),
  hasStartedLocationUpdatesAsync: jest.fn().mockResolvedValue(false),
  hasServicesEnabledAsync: jest.fn().mockResolvedValue(true),
  watchPositionAsync: jest.fn().mockResolvedValue({ remove: jest.fn() }),
}));

import {
  calculateHaversineDistance,
  processLocationUpdates,
  getTrackerState,
  startTracking,
  stopTracking,
  pauseTracking,
  resumeTracking,
  restoreActiveSession,
  discardOrFinalizeActiveRide,
  _resetTrackerForTesting,
  _setActiveStateForTesting,
} from '../tracker';
import { getActiveRideState, saveActiveRideState, getRides } from '../storage';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

describe('Cálculos Geodésicos y Haversine', () => {
  test('La distancia entre dos puntos idénticos debe ser 0 km', () => {
    const dist = calculateHaversineDistance(40.4168, -3.7038, 40.4168, -3.7038);
    expect(dist).toBe(0);
  });

  test('Calcula correctamente la distancia entre Madrid y El Escorial (~42-46 km)', () => {
    // Madrid (Puerta del Sol): 40.4168, -3.7038
    // San Lorenzo de El Escorial: 40.5898, -4.1293
    const dist = calculateHaversineDistance(40.4168, -3.7038, 40.5898, -4.1293);
    expect(dist).toBeGreaterThan(40);
    expect(dist).toBeLessThan(50);
  });
});

describe('FASE 1: Precisión del Odómetro a Todas las Velocidades (A-01)', () => {
  beforeEach(() => {
    _resetTrackerForTesting();
  });

  test('A 20 km/h constante durante 1h completa (3600 fixes), el error del odómetro debe ser < 0.5%', () => {
    const startTime = 1700000000000;
    _setActiveStateForTesting({
      status: 'recording',
      startTime,
    });

    const velocidadKmh = 20;
    const distPorSegundoKm = velocidadKmh / 3600;
    const latStep = distPorSegundoKm / (6371 * (Math.PI / 180));

    let currentLat = 40.0;
    const initialLon = -3.5;

    for (let s = 0; s <= 3600; s++) {
      const loc: Location.LocationObject = {
        coords: {
          latitude: currentLat,
          longitude: initialLon,
          altitude: 600,
          accuracy: 4,
          altitudeAccuracy: 3,
          heading: 0,
          speed: velocidadKmh / 3.6,
        },
        timestamp: startTime + s * 1000,
      };
      processLocationUpdates([loc]);
      currentLat += latStep;
    }

    const state = getTrackerState();
    const distanciaRegistrada = state.metrics.totalDistanceKm;
    const distanciaReal = 20;
    const errorAbsoluto = Math.abs(distanciaRegistrada - distanciaReal);
    const porcentajeError = (errorAbsoluto / distanciaReal) * 100;

    expect(distanciaRegistrada).toBeGreaterThan(0);
    expect(porcentajeError).toBeLessThan(0.5);
  });

  const velocidadesTest = [10, 15, 17, 18, 30, 50, 90];
  velocidadesTest.forEach((velocidadKmh) => {
    test(`A ${velocidadKmh} km/h constante durante 300s, el error del odómetro debe ser < 0.5%`, () => {
      const startTime = 1700000000000;
      _setActiveStateForTesting({
        status: 'recording',
        startTime,
      });

      const distPorSegundoKm = velocidadKmh / 3600;
      const latStep = distPorSegundoKm / (6371 * (Math.PI / 180));

      let currentLat = 40.0;
      const initialLon = -3.5;

      for (let s = 0; s <= 300; s++) {
        const loc: Location.LocationObject = {
          coords: {
            latitude: currentLat,
            longitude: initialLon,
            altitude: 600,
            accuracy: 4,
            altitudeAccuracy: 3,
            heading: 0,
            speed: velocidadKmh / 3.6,
          },
          timestamp: startTime + s * 1000,
        };
        processLocationUpdates([loc]);
        currentLat += latStep;
      }

      const state = getTrackerState();
      const distanciaRegistrada = state.metrics.totalDistanceKm;
      const distanciaReal = (velocidadKmh / 3600) * 300;

      const errorAbsoluto = Math.abs(distanciaRegistrada - distanciaReal);
      const porcentajeError = (errorAbsoluto / distanciaReal) * 100;

      expect(distanciaRegistrada).toBeGreaterThan(0);
      expect(porcentajeError).toBeLessThan(0.5);
    });
  });
});

describe('FASE 1: Filtro de Desnivel Positivo con Histéresis Anti-Ruido (A-05)', () => {
  beforeEach(() => {
    _resetTrackerForTesting();
  });

  test('Con altitud constante y ruido vertical de ±10m durante 600 muestras, el desnivel no debe inflarse (< 20m)', () => {
    const startTime = 1700000000000;
    _setActiveStateForTesting({
      status: 'recording',
      startTime,
    });

    const altitudBase = 650;
    // Ruido sintético pseudoaleatorio determinista dentro de ±10 metros
    for (let s = 0; s < 600; s++) {
      // Simular oscilaciones típicas de altitud GPS (senos y cosenos combinados)
      const ruido =
        Math.sin(s * 0.2) * 5 + Math.cos(s * 0.45) * 4 + Math.sin(s * 0.8) * 1;
      const altitudSimulada = altitudBase + ruido;

      const loc: Location.LocationObject = {
        coords: {
          latitude: 40.4168 + s * 0.00001,
          longitude: -3.7038,
          altitude: altitudSimulada,
          accuracy: 5,
          altitudeAccuracy: 5,
          heading: 0,
          speed: 10,
        },
        timestamp: startTime + s * 1000,
      };
      processLocationUpdates([loc]);
    }

    const state = getTrackerState();
    expect(state.metrics.elevationGainMeters).toBeLessThan(20);
  });

  test('Subida continua de puerto de montaña (40 km/h al 4% durante 15 min): acumula íntegramente el desnivel (+400m)', () => {
    const startTime = 1700000000000;
    _setActiveStateForTesting({
      status: 'recording',
      startTime,
    });

    const startAlt = 600;
    // Subida a 40 km/h (11.11 m/s) al 4%: ~0.444 m de ascenso vertical por segundo
    // En 900 segundos (15 min): 400 metros de desnivel real ganado
    for (let s = 0; s <= 900; s++) {
      const altitud = startAlt + s * 0.444;
      const loc: Location.LocationObject = {
        coords: {
          latitude: 40.0 + s * 0.0001,
          longitude: -3.0,
          altitude: altitud,
          accuracy: 4,
          altitudeAccuracy: 4,
          heading: 0,
          speed: 40 / 3.6,
        },
        timestamp: startTime + s * 1000,
      };
      processLocationUpdates([loc]);
    }

    const state = getTrackerState();
    expect(state.metrics.elevationGainMeters).toBeGreaterThanOrEqual(385);
    expect(state.metrics.elevationGainMeters).toBeLessThanOrEqual(415);
  });

  test('La fluctuación de GPS en reposo (velocidad < 3 km/h con saltos de 3.5m) no acumula distancia fantasma', () => {
    const startTime = 1700000000000;
    _setActiveStateForTesting({
      status: 'recording',
      startTime,
    });

    // Moto detenida en semáforo durante 60 segundos con deriva GPS de 3.8 metros
    for (let s = 0; s <= 60; s++) {
      const jitterLat = s % 2 === 0 ? 0.000035 : 0;
      const loc: Location.LocationObject = {
        coords: {
          latitude: 40.0 + jitterLat,
          longitude: -3.0,
          altitude: 600,
          accuracy: 4,
          altitudeAccuracy: null,
          heading: 0,
          speed: 0.2, // 0.2 m/s = 0.72 km/h (< 3 km/h)
        },
        timestamp: startTime + s * 1000,
      };
      processLocationUpdates([loc]);
    }

    const state = getTrackerState();
    expect(state.metrics.totalDistanceKm).toBe(0);
  });

  test('Al finalizar ruta desde el estado paused, consolida el tiempo de descanso transcurrido', async () => {
    const startTime = Date.now() - 3600000;
    const pauseTime = Date.now() - 900000;

    _setActiveStateForTesting({
      status: 'paused',
      startTime,
      pausedTime: pauseTime,
      totalPausedDuration: 0,
    });

    const finalState = await stopTracking();
    expect(finalState.status).toBe('finished');
    expect(finalState.totalPausedDuration).toBeGreaterThanOrEqual(890000);
    expect(finalState.pausedTime).toBeNull();
  });
});

describe('FASE 1: Filtro de Aceleración Física en Velocidad Máxima (A-08)', () => {
  beforeEach(() => {
    _resetTrackerForTesting();
  });

  test('Un pico aislado e irreal de GPS (salto de 50 a 190 km/h en 1s) debe ser descartado como velocidad máxima', () => {
    const startTime = 1700000000000;
    _setActiveStateForTesting({
      status: 'recording',
      startTime,
    });

    // Punto 1: 50 km/h
    processLocationUpdates([
      {
        coords: {
          latitude: 40.0,
          longitude: -3.0,
          altitude: 600,
          accuracy: 5,
          altitudeAccuracy: null,
          heading: null,
          speed: 50 / 3.6,
        },
        timestamp: startTime,
      },
    ]);

    // Punto 2 (glitch): salto de 50 a 190 km/h en 1 segundo (aceleración de 140 km/h/s)
    processLocationUpdates([
      {
        coords: {
          latitude: 40.0001,
          longitude: -3.0,
          altitude: 600,
          accuracy: 5,
          altitudeAccuracy: null,
          heading: null,
          speed: 190 / 3.6,
        },
        timestamp: startTime + 1000,
      },
    ]);

    let state = getTrackerState();
    // Debe haber descartado el salto de 190 y conservado el valor previo
    expect(state.metrics.maxSpeed).toBeLessThan(100);

    // Punto 3: aceleración física realista a 65 km/h (+15 km/h en 1s)
    processLocationUpdates([
      {
        coords: {
          latitude: 40.0002,
          longitude: -3.0,
          altitude: 600,
          accuracy: 5,
          altitudeAccuracy: null,
          heading: null,
          speed: 65 / 3.6,
        },
        timestamp: startTime + 2000,
      },
    ]);

    state = getTrackerState();
    expect(state.metrics.maxSpeed).toBe(65);
  });
});

describe('FASE 1: Medición Real de Tiempo Rodando (A-07)', () => {
  beforeEach(() => {
    _resetTrackerForTesting();
  });

  test('movingDurationSeconds solo debe acumular tiempo cuando la velocidad es >= 3.0 km/h', () => {
    const startTime = 1700000000000;
    _setActiveStateForTesting({
      status: 'recording',
      startTime,
    });

    // 5 segundos en marcha a 40 km/h
    for (let s = 0; s < 5; s++) {
      processLocationUpdates([
        {
          coords: {
            latitude: 40.0 + s * 0.0001,
            longitude: -3.0,
            altitude: 500,
            accuracy: 4,
            altitudeAccuracy: null,
            heading: null,
            speed: 40 / 3.6,
          },
          timestamp: startTime + s * 1000,
        },
      ]);
    }

    let state = getTrackerState();
    const tiempoRodandoInicial = state.metrics.movingDurationSeconds;
    expect(tiempoRodandoInicial).toBeGreaterThanOrEqual(4);

    // 10 segundos detenido en un semáforo (v = 0 km/h)
    for (let s = 5; s < 15; s++) {
      processLocationUpdates([
        {
          coords: {
            latitude: 40.0004,
            longitude: -3.0,
            altitude: 500,
            accuracy: 4,
            altitudeAccuracy: null,
            heading: null,
            speed: 0,
          },
          timestamp: startTime + s * 1000,
        },
      ]);
    }

    state = getTrackerState();
    // El tiempo rodando no debe haber aumentado durante los 10 segundos parados
    expect(state.metrics.movingDurationSeconds).toBe(tiempoRodandoInicial);
  });
});

describe('FASE 1: Timeout de Velocidad a 0 km/h al Detenerse (A-06)', () => {
  beforeEach(() => {
    _resetTrackerForTesting();
  });

  afterEach(async () => {
    await stopTracking();
    jest.useRealTimers();
  });

  test('Si transcurren más de 3 segundos sin fix GPS, currentSpeed cae a 0', async () => {
    jest.useFakeTimers();
    await startTracking();

    const lastPt = getTrackerState().points[getTrackerState().points.length - 1];
    const fixTime = (lastPt ? lastPt.timestamp : Date.now()) + 1000;

    // Enviar primer fix a 30 km/h (aceleración física realista <= 35 km/h/s)
    processLocationUpdates([
      {
        coords: {
          latitude: 40.0,
          longitude: -3.0,
          altitude: 500,
          accuracy: 5,
          altitudeAccuracy: null,
          heading: null,
          speed: 30 / 3.6,
        },
        timestamp: fixTime,
      },
    ]);

    expect(getTrackerState().metrics.currentSpeed).toBe(30);

    // Avanzar el reloj 4 segundos sin nuevos fixes
    jest.advanceTimersByTime(4000);

    expect(getTrackerState().metrics.currentSpeed).toBe(0);
  });
});

describe('FASE 2: Ciclo de Vida y Resiliencia de Datos (A-17, A-02, A-18)', () => {
  beforeEach(async () => {
    _resetTrackerForTesting();
    await discardOrFinalizeActiveRide();
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await discardOrFinalizeActiveRide();
    jest.useRealTimers();
  });

  test('A-17: stopTracking deja la ruta en estado "finished" y la mantiene en almacenamiento', async () => {
    await startTracking();
    const finalState = await stopTracking();

    expect(finalState.status).toBe('finished');
    expect(getTrackerState().status).toBe('finished');

    // La sesión activa DEBE conservarse en almacenamiento para prevenir pérdida de datos
    const savedState = await getActiveRideState();
    expect(savedState).not.toBeNull();
    expect(savedState?.status).toBe('finished');

    // discardOrFinalizeActiveRide debe limpiar definitivamente el estado
    await discardOrFinalizeActiveRide();
    expect(getTrackerState().status).toBe('idle');
    const clearedState = await getActiveRideState();
    expect(clearedState).toBeNull();
  });

  test('A-02: restoreActiveSession reengancha sensores si estaba "recording", pero NO si estaba "finished"', async () => {
    // 1. Caso 'recording': debe reenganchar GPS
    await saveActiveRideState({
      status: 'recording',
      startTime: Date.now() - 10000,
      pausedTime: null,
      totalPausedDuration: 0,
      lastMovingTimestamp: Date.now(),
      points: [],
      metrics: { ...getTrackerState().metrics },
    });

    const restoredRecording = await restoreActiveSession();
    expect(restoredRecording?.status).toBe('recording');
    expect(Location.watchPositionAsync).toHaveBeenCalled();

    // 2. Caso 'finished': NO debe rearmar GPS
    jest.clearAllMocks();
    _resetTrackerForTesting();
    await saveActiveRideState({
      status: 'finished',
      startTime: Date.now() - 10000,
      pausedTime: null,
      totalPausedDuration: 0,
      lastMovingTimestamp: Date.now(),
      points: [],
      metrics: { ...getTrackerState().metrics },
    });

    const restoredFinished = await restoreActiveSession();
    expect(restoredFinished?.status).toBe('finished');
    expect(Location.watchPositionAsync).not.toHaveBeenCalled();
  });

  test('A-18: pauseTracking degrada la precisión de segundo plano a modo equilibrado y resumeTracking la restablece', async () => {
    (Location.hasStartedLocationUpdatesAsync as jest.Mock).mockResolvedValue(true);

    await startTracking();
    jest.clearAllMocks();

    await pauseTracking();
    expect(Location.startLocationUpdatesAsync).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 30000,
        distanceInterval: 50,
      })
    );

    jest.clearAllMocks();
    await resumeTracking();
    expect(Location.startLocationUpdatesAsync).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 1000,
        distanceInterval: 3,
      })
    );
  });
});

describe('FASE 4: Calidad y Almacenamiento (A-14, A-16)', () => {
  beforeEach(async () => {
    _resetTrackerForTesting();
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await discardOrFinalizeActiveRide();
    jest.useRealTimers();
  });

  test('A-16: Umbral adaptativo de precisión GPS (50m en arranque <= 30s, 25m después)', () => {
    const startTime = 1700000000000;
    _setActiveStateForTesting({
      status: 'recording',
      startTime,
      points: [],
    });

    // 1. A los 10 segundos, un fix con 40m de precisión DEBE ser aceptado (umbral = 50m)
    processLocationUpdates([
      {
        coords: {
          latitude: 40.0,
          longitude: -3.0,
          altitude: 500,
          accuracy: 40,
          altitudeAccuracy: null,
          heading: null,
          speed: 10,
        },
        timestamp: startTime + 10000,
      },
    ]);
    expect(getTrackerState().points.length).toBe(1);

    // 2. A los 35 segundos, un fix con 40m de precisión DEBE ser descartado (umbral = 25m)
    processLocationUpdates([
      {
        coords: {
          latitude: 40.001,
          longitude: -3.001,
          altitude: 500,
          accuracy: 40,
          altitudeAccuracy: null,
          heading: null,
          speed: 10,
        },
        timestamp: startTime + 35000,
      },
    ]);
    expect(getTrackerState().points.length).toBe(1);

    // 3. A los 36 segundos, un fix con 20m de precisión DEBE ser aceptado (20 <= 25m)
    processLocationUpdates([
      {
        coords: {
          latitude: 40.001,
          longitude: -3.001,
          altitude: 500,
          accuracy: 20,
          altitudeAccuracy: null,
          heading: null,
          speed: 10,
        },
        timestamp: startTime + 36000,
      },
    ]);
    expect(getTrackerState().points.length).toBe(2);
  });

  test('A-14: getRides() no persiste la ruta demo en AsyncStorage', async () => {
    const rides = await getRides(true);
    expect(rides.length).toBeGreaterThan(0);
    expect(rides[0].id).toBe('demo-sierra-norte-01');

    // AsyncStorage NO debe haber guardado la clave para no ensuciar la base de datos
    const rawStored = await AsyncStorage.getItem('@mototrack_rides');
    expect(rawStored).toBeNull();
  });

  test('H-01: restoreActiveSession preserva y acumula elevationGainMeters sin reiniciarlo a 0', async () => {
    _resetTrackerForTesting();
    // Simular sesión previa restaurada con 1200m de desnivel positivo acumulado
    await saveActiveRideState({
      status: 'recording',
      startTime: 100000,
      pausedTime: null,
      totalPausedDuration: 0,
      lastMovingTimestamp: 100000,
      points: [
        {
          latitude: 40.4000,
          longitude: -3.7000,
          altitude: 1000,
          timestamp: 100000,
          speed: 20,
          accuracy: 5,
        },
      ],
      metrics: {
        totalDistanceKm: 45.0,
        currentSpeed: 50,
        maxSpeed: 110,
        avgSpeed: 55,
        movingDurationSeconds: 3000,
        totalDurationSeconds: 3600,
        currentAltitude: 1000,
        elevationGainMeters: 1200,
        maxAltitudeMeters: 1000,
        minAltitudeMeters: 1000,
        isAutoPaused: false,
      },
    });

    const restored = await restoreActiveSession();
    expect(restored).not.toBeNull();
    expect(restored?.metrics.elevationGainMeters).toBe(1200);

    // Subida posterior en carretera de montaña de 1000m a 1030m
    for (let i = 1; i <= 15; i++) {
      processLocationUpdates([
        {
          coords: {
            latitude: 40.4000 + i * 0.001,
            longitude: -3.7000 + i * 0.001,
            altitude: 1000 + i * 2, // Sube progresivamente hasta 1030m (+30m)
            accuracy: 5,
            altitudeAccuracy: 2,
            heading: 0,
            speed: 15,
          },
          timestamp: 100000 + i * 1000,
        },
      ]);
    }

    // El desnivel total debe ser mayor que 1200m (sumando sobre lo anterior, NO reseteado a 15-20m)
    const finalState = getTrackerState();
    expect(finalState.metrics.elevationGainMeters).toBeGreaterThanOrEqual(1210);
  });

  test('H-08: Salida de túnel sincroniza simultáneamente distancia recorrida y tiempo en movimiento', () => {
    _resetTrackerForTesting();
    const startTime = 100000;
    _setActiveStateForTesting({
      status: 'recording',
      startTime,
      pausedTime: null,
      totalPausedDuration: 0,
      lastMovingTimestamp: startTime,
      points: [
        {
          latitude: 40.0000,
          longitude: -3.0000,
          altitude: 600,
          timestamp: startTime,
          speed: 60,
          accuracy: 5,
        },
      ],
      metrics: {
        totalDistanceKm: 10.0,
        currentSpeed: 60,
        maxSpeed: 60,
        avgSpeed: 60,
        movingDurationSeconds: 600,
        totalDurationSeconds: 600,
        currentAltitude: 600,
        elevationGainMeters: 0,
        maxAltitudeMeters: 600,
        minAltitudeMeters: 600,
        isAutoPaused: false,
      },
    });

    // Salida de túnel tras 60 segundos con 1 km recorrido (aparente 60 km/h),
    // pero con fix instantáneo de velocidad baja (ej. frenada de peaje a 2.0 km/h)
    processLocationUpdates([
      {
        coords: {
          latitude: 40.0090, // ~1.0 km al norte
          longitude: -3.0000,
          altitude: 600,
          accuracy: 10,
          altitudeAccuracy: null,
          heading: 0,
          speed: 0.5, // 1.8 km/h (< 3.0 km/h)
        },
        timestamp: startTime + 60000,
      },
    ]);

    const state = getTrackerState();
    // Debe haber acreditado el tiempo en movimiento del túnel
    expect(state.metrics.movingDurationSeconds).toBe(660);
    // Y simultáneamente DEBE haber acreditado la distancia del túnel (~1.0 km)
    expect(state.metrics.totalDistanceKm).toBeGreaterThan(10.8);
  });

  test('H-12: Fixes GPS con coords.accuracy null o indefinido no se descartan', () => {
    _resetTrackerForTesting();
    const startTime = 200000;
    _setActiveStateForTesting({
      status: 'recording',
      startTime,
      pausedTime: null,
      totalPausedDuration: 0,
      lastMovingTimestamp: startTime,
      points: [
        {
          latitude: 40.0000,
          longitude: -3.0000,
          altitude: 500,
          timestamp: startTime,
          speed: 10,
          accuracy: 5,
        },
      ],
      metrics: {
        totalDistanceKm: 0,
        currentSpeed: 36,
        maxSpeed: 36,
        avgSpeed: 36,
        movingDurationSeconds: 0,
        totalDurationSeconds: 0,
        currentAltitude: 500,
        elevationGainMeters: 0,
        maxAltitudeMeters: 500,
        minAltitudeMeters: 500,
        isAutoPaused: false,
      },
    });

    // Enviar fix con coords.accuracy = null (como en ciertos receptores GPS Bluetooth externos)
    processLocationUpdates([
      {
        coords: {
          latitude: 40.0010,
          longitude: -3.0000,
          altitude: 500,
          accuracy: null as any,
          altitudeAccuracy: null,
          heading: 0,
          speed: 10,
        },
        timestamp: startTime + 1000,
      },
    ]);

    const state = getTrackerState();
    expect(state.points.length).toBe(2);
    expect(state.metrics.totalDistanceKm).toBeGreaterThan(0.05);
  });

  test('H-13: Aceleración de moto deportiva de hasta 55 (km/h)/s es aceptada', () => {
    _resetTrackerForTesting();
    const startTime = 300000;
    _setActiveStateForTesting({
      status: 'recording',
      startTime,
      pausedTime: null,
      totalPausedDuration: 0,
      lastMovingTimestamp: startTime,
      points: [
        {
          latitude: 40.0000,
          longitude: -3.0000,
          altitude: 500,
          timestamp: startTime,
          speed: 10, // 10 km/h
          accuracy: 5,
        },
      ],
      metrics: {
        totalDistanceKm: 0,
        currentSpeed: 10,
        maxSpeed: 10,
        avgSpeed: 10,
        movingDurationSeconds: 0,
        totalDurationSeconds: 0,
        currentAltitude: 500,
        elevationGainMeters: 0,
        maxAltitudeMeters: 500,
        minAltitudeMeters: 500,
        isAutoPaused: false,
      },
    });

    // En 1 segundo acelera de 10 km/h a 55 km/h (delta = 45 (km/h)/s, aceleración deportiva realista)
    processLocationUpdates([
      {
        coords: {
          latitude: 40.0002,
          longitude: -3.0000,
          altitude: 500,
          accuracy: 5,
          altitudeAccuracy: null,
          heading: 0,
          speed: 55 / 3.6, // 55 km/h
        },
        timestamp: startTime + 1000,
      },
    ]);

    const state = getTrackerState();
    expect(state.points.length).toBe(2);
    expect(state.metrics.currentSpeed).toBe(55);
  });

  test('H-01 (Auditor 1): coords.accuracy undefined genera null y no NaN en el punto registrado', () => {
    _resetTrackerForTesting();
    const startTime = 400000;
    _setActiveStateForTesting({
      status: 'recording',
      startTime,
      pausedTime: null,
      totalPausedDuration: 0,
      lastMovingTimestamp: startTime,
      points: [
        {
          latitude: 40.0000,
          longitude: -3.0000,
          altitude: 500,
          timestamp: startTime,
          speed: 10,
          accuracy: 5,
        },
      ],
      metrics: {
        totalDistanceKm: 0,
        currentSpeed: 10,
        maxSpeed: 10,
        avgSpeed: 10,
        movingDurationSeconds: 0,
        totalDurationSeconds: 0,
        currentAltitude: 500,
        elevationGainMeters: 0,
        maxAltitudeMeters: 500,
        minAltitudeMeters: 500,
        isAutoPaused: false,
      },
    });

    processLocationUpdates([
      {
        coords: {
          latitude: 40.0001,
          longitude: -3.0000,
          altitude: 500,
          accuracy: undefined as any,
          altitudeAccuracy: null,
          heading: 0,
          speed: 10,
        },
        timestamp: startTime + 1000,
      },
    ]);

    const state = getTrackerState();
    expect(state.points.length).toBe(2);
    const lastPoint = state.points[1];
    expect(lastPoint.accuracy).toBeNull();
    expect(Number.isNaN(lastPoint.accuracy)).toBe(false);
  });

  test('H-02 (Auditor 1): Salto temporal de GPS >10s sin velocidad aparente de túnel no suma distancia sin sumar tiempo', () => {
    _resetTrackerForTesting();
    const startTime = 500000;
    _setActiveStateForTesting({
      status: 'recording',
      startTime,
      pausedTime: null,
      totalPausedDuration: 0,
      lastMovingTimestamp: startTime,
      points: [
        {
          latitude: 40.0000,
          longitude: -3.0000,
          altitude: 500,
          timestamp: startTime,
          speed: 20,
          accuracy: 5,
        },
      ],
      metrics: {
        totalDistanceKm: 5.0,
        currentSpeed: 20,
        maxSpeed: 20,
        avgSpeed: 20,
        movingDurationSeconds: 200,
        totalDurationSeconds: 200,
        currentAltitude: 500,
        elevationGainMeters: 0,
        maxAltitudeMeters: 500,
        minAltitudeMeters: 500,
        isAutoPaused: false,
      },
    });

    // Salto de 25s (timeDiffSec = 25 > 10) con una distancia de 2 km (velocidad aparente = 288 km/h > 220 km/h)
    // El punto entrante reporta velocidad instantánea de 50 km/h (speedKmh >= 3.0)
    processLocationUpdates([
      {
        coords: {
          latitude: 40.0180, // ~2.0 km
          longitude: -3.0000,
          altitude: 500,
          accuracy: 5,
          altitudeAccuracy: null,
          heading: 0,
          speed: 50 / 3.6,
        },
        timestamp: startTime + 25000,
      },
    ]);

    const state = getTrackerState();
    // Como no es túnel válido (aparente 288 km/h > 220 km/h) y timeDiffSec > 10,
    // NO debe sumarse distancia si no se suma tiempo de movimiento
    expect(state.metrics.movingDurationSeconds).toBe(200);
    expect(state.metrics.totalDistanceKm).toBe(5.0);
  });

  test('Ronda 3: Avance a baja velocidad (5 km/h, segKm < 0.002) acumula simétricamente distancia y tiempo', () => {
    const startTime = 1700000000000;
    _setActiveStateForTesting({
      status: 'recording',
      startTime,
      pausedTime: null,
      totalPausedDuration: 0,
      lastMovingTimestamp: startTime,
      points: [
        {
          latitude: 40.0000,
          longitude: -3.0000,
          altitude: 500,
          timestamp: startTime,
          speed: 5,
          accuracy: 4,
        },
      ],
      metrics: {
        totalDistanceKm: 0,
        currentSpeed: 5,
        maxSpeed: 5,
        avgSpeed: 0,
        movingDurationSeconds: 0,
        totalDurationSeconds: 0,
        currentAltitude: 500,
        elevationGainMeters: 0,
        maxAltitudeMeters: 500,
        minAltitudeMeters: 500,
        isAutoPaused: false,
      },
    });

    // 10 segundos avanzando a 5 km/h (1.389 m por segundo ~ 0.0000125 latitud)
    // Cada paso es de ~1.39 metros (< 2 metros)
    for (let s = 1; s <= 10; s++) {
      processLocationUpdates([
        {
          coords: {
            latitude: 40.0000 + s * 0.0000125,
            longitude: -3.0000,
            altitude: 500,
            accuracy: 4,
            altitudeAccuracy: null,
            heading: 0,
            speed: 5 / 3.6,
          },
          timestamp: startTime + s * 1000,
        },
      ]);
    }

    const state = getTrackerState();
    // Debe haber sumado 10 segundos y ~13.9 metros (0.0139 km)
    expect(state.metrics.movingDurationSeconds).toBe(10);
    expect(state.metrics.totalDistanceKm).toBeGreaterThan(0.01);
    expect(state.metrics.avgSpeed).toBeCloseTo(5.0, 0);
  });

  test('Ronda 3: Fixes GPS con altitude undefined no envenenan smoothedAltitude con NaN', () => {
    _resetTrackerForTesting();
    const startTime = 1700000000000;
    _setActiveStateForTesting({
      status: 'recording',
      startTime,
      pausedTime: null,
      totalPausedDuration: 0,
      lastMovingTimestamp: startTime,
      points: [
        {
          latitude: 40.0000,
          longitude: -3.0000,
          altitude: 500,
          timestamp: startTime,
          speed: 30,
          accuracy: 4,
        },
      ],
      metrics: {
        totalDistanceKm: 0,
        currentSpeed: 30,
        maxSpeed: 30,
        avgSpeed: 0,
        movingDurationSeconds: 0,
        totalDurationSeconds: 0,
        currentAltitude: 500,
        elevationGainMeters: 0,
        maxAltitudeMeters: 500,
        minAltitudeMeters: 500,
        isAutoPaused: false,
      },
    });

    // Fix 2D sin altitud (coords.altitude undefined como en NMEA o emuladores)
    const locUndefinedAlt: any = {
      coords: {
        latitude: 40.0010,
        longitude: -3.0000,
        altitude: undefined,
        accuracy: 4,
        altitudeAccuracy: null,
        heading: 0,
        speed: 30 / 3.6,
      },
      timestamp: startTime + 1000,
    };
    processLocationUpdates([locUndefinedAlt]);

    const state1 = getTrackerState();
    expect(Number.isNaN(state1.metrics.currentAltitude)).toBe(false);
    expect(Number.isNaN(state1.metrics.elevationGainMeters)).toBe(false);

    // Luego recupera señal 3D con altitud ascendente (+30 metros durante 25 segundos)
    for (let s = 2; s <= 25; s++) {
      processLocationUpdates([
        {
          coords: {
            latitude: 40.0010 + s * 0.0005,
            longitude: -3.0000,
            altitude: 500 + s * 2, // Sube progresivamente
            accuracy: 4,
            altitudeAccuracy: null,
            heading: 0,
            speed: 30 / 3.6,
          },
          timestamp: startTime + s * 1000,
        },
      ]);
    }

    const state2 = getTrackerState();
    expect(Number.isNaN(state2.metrics.elevationGainMeters)).toBe(false);
    expect(state2.metrics.elevationGainMeters).toBeGreaterThanOrEqual(10);
  });
});

describe('AUDITORIA EXTERNA: Filtro Cinemático Bidireccional y Permisos en Restauración (EXT-08, EXT-09)', () => {
  beforeEach(() => {
    _resetTrackerForTesting();
  });

  afterEach(async () => {
    await stopTracking();
  });

  test('EXT-08: Si la velocidad cae o sube a un ritmo no físico (> 55 km/h por segundo), se descarta el glitch y se conserva la velocidad anterior', async () => {
    const startTime = Date.now();
    _setActiveStateForTesting({
      status: 'recording',
      startTime,
      pausedTime: null,
      totalPausedDuration: 0,
      points: [
        {
          latitude: 40.0000,
          longitude: -3.0000,
          altitude: 500,
          timestamp: startTime,
          speed: 100, // Rodando a 100 km/h en autovía
          accuracy: 5,
        },
      ],
      metrics: {
        totalDistanceKm: 0,
        currentSpeed: 100,
        maxSpeed: 100,
        avgSpeed: 100,
        movingDurationSeconds: 10,
        totalDurationSeconds: 10,
        currentAltitude: 500,
        elevationGainMeters: 0,
        maxAltitudeMeters: 500,
        minAltitudeMeters: 500,
        isAutoPaused: false,
      },
    });

    // En 0.5s cae repentinamente a 10 km/h (deltaV = -90 km/h en 0.5s = -180 km/h/s, fisicamente imposible para una moto)
    processLocationUpdates([
      {
        coords: {
          latitude: 40.0001,
          longitude: -3.0000,
          altitude: 500,
          accuracy: 5,
          altitudeAccuracy: null,
          heading: 0,
          speed: 10 / 3.6,
        },
        timestamp: startTime + 500,
      },
    ]);

    const state = getTrackerState();
    // La velocidad calculada para el punto debe haber retenido los 100 km/h anteriores
    const lastPoint = state.points[state.points.length - 1];
    expect(lastPoint.speed).toBe(100);
  });

  test('EXT-09: restoreActiveSession no monta listeners de ubicación si los permisos están denegados y pausa la ruta', async () => {
    await saveActiveRideState({
      status: 'recording',
      startTime: Date.now() - 10000,
      pausedTime: null,
      totalPausedDuration: 0,
      lastMovingTimestamp: Date.now() - 1000,
      points: [{ latitude: 40.0, longitude: -3.0, altitude: 500, timestamp: Date.now(), speed: 50, accuracy: 5 }],
      metrics: {
        totalDistanceKm: 1,
        currentSpeed: 50,
        maxSpeed: 50,
        avgSpeed: 50,
        movingDurationSeconds: 10,
        totalDurationSeconds: 10,
        currentAltitude: 500,
        elevationGainMeters: 0,
        maxAltitudeMeters: 500,
        minAltitudeMeters: 500,
        isAutoPaused: false,
      },
    });

    (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      status: 'denied',
      granted: false,
    });
    (Location.watchPositionAsync as jest.Mock).mockClear();
    (Location.startLocationUpdatesAsync as jest.Mock).mockClear();

    const restored = await restoreActiveSession();
    expect(restored).not.toBeNull();
    expect(restored?.status).toBe('paused');
    expect(Location.watchPositionAsync).not.toHaveBeenCalled();
    expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  test('EXT-03: Cruce de túnel largo de 400s (más de 5 min) es admitido por isTunnelExit y acumula la distancia', async () => {
    _resetTrackerForTesting();
    const t0 = 1710000000000;
    _setActiveStateForTesting({
      status: 'recording',
      startTime: t0,
      points: [
        {
          latitude: 40.0,
          longitude: -3.0,
          altitude: 600,
          speed: 72,
          accuracy: 4,
          timestamp: t0,
        },
      ],
    });

    // Salida del túnel tras 400 segundos recorriendo ~8 km (72 km/h)
    // 8 km en latitud es aprox 0.072 grados
    const tExit = t0 + 400 * 1000;
    processLocationUpdates([
      {
        coords: {
          latitude: 40.072,
          longitude: -3.0,
          altitude: 620,
          altitudeAccuracy: null,
          speed: 20, // 20 m/s = 72 km/h
          accuracy: 4,
          heading: 0,
        },
        timestamp: tExit,
      },
    ]);

    const state = getTrackerState();
    // La distancia debe haber acumulado el tramo del túnel (aprox 8 km) y no ser 0
    expect(state.metrics.totalDistanceKm).toBeGreaterThan(7.5);
    expect(state.metrics.totalDistanceKm).toBeLessThan(8.5);
    expect(state.metrics.isGpsSignalLost).toBe(false);
  });

  test('EXT-03: Si transcurren más de 3 segundos sin fix, el temporizador marca isGpsSignalLost = true y velocidad 0', async () => {
    jest.useFakeTimers();
    _resetTrackerForTesting();
    await startTracking();

    const tStart = Date.now();
    // Primer fix acelerando progresivamente respetando límite de 55 km/h/s
    processLocationUpdates([
      {
        coords: {
          latitude: 40.4168,
          longitude: -3.7038,
          altitude: 650,
          altitudeAccuracy: null,
          speed: 10, // 36 km/h
          accuracy: 4,
          heading: 0,
        },
        timestamp: tStart + 1000,
      },
    ]);

    // Segundo fix a 72 km/h (deltaV = 36 en 1s <= 55)
    processLocationUpdates([
      {
        coords: {
          latitude: 40.4172,
          longitude: -3.7038,
          altitude: 650,
          altitudeAccuracy: null,
          speed: 20, // 72 km/h
          accuracy: 4,
          heading: 0,
        },
        timestamp: tStart + 2000,
      },
    ]);

    let state = getTrackerState();
    expect(state.metrics.currentSpeed).toBe(72);
    expect(state.metrics.isGpsSignalLost).toBe(false);

    // Avanzamos el tiempo 4 segundos sin recibir ningún fix
    jest.advanceTimersByTime(4000);

    state = getTrackerState();
    expect(state.metrics.currentSpeed).toBe(0);
    expect(state.metrics.isGpsSignalLost).toBe(true);

    // Al recibir un nuevo fix, isGpsSignalLost vuelve a false
    processLocationUpdates([
      {
        coords: {
          latitude: 40.4175,
          longitude: -3.7038,
          altitude: 650,
          altitudeAccuracy: null,
          speed: 15, // 54 km/h
          accuracy: 4,
          heading: 0,
        },
        timestamp: Date.now() + 6000,
      },
    ]);

    state = getTrackerState();
    expect(state.metrics.isGpsSignalLost).toBe(false);

    await stopTracking();
    jest.useRealTimers();
  });
});
