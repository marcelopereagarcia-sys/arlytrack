/**
 * Pruebas unitarias para el subsistema de almacenamiento (services/storage.ts).
 * Valida la persistencia desacoplada (AsyncStorage + expo-file-system) y la resistencia
 * a rutas largas (>100 km, más de 12.000 puntos GPS).
 */

const mockFiles: Record<string, string> = {};

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///mock/storage/',
  EncodingType: {
    UTF8: 'utf8',
  },
  makeDirectoryAsync: jest.fn().mockResolvedValue(undefined),
  getInfoAsync: jest.fn().mockImplementation(async (uri: string) => ({
    exists: uri in mockFiles,
    isDirectory: uri.endsWith('/'),
  })),
  writeAsStringAsync: jest.fn().mockImplementation(async (uri: string, content: string) => {
    mockFiles[uri] = content;
  }),
  readAsStringAsync: jest.fn().mockImplementation(async (uri: string) => {
    if (uri in mockFiles) return mockFiles[uri];
    throw new Error(`File not found: ${uri}`);
  }),
  deleteAsync: jest.fn().mockImplementation(async (uri: string) => {
    delete mockFiles[uri];
  }),
}));

// Mock de AsyncStorage
const mockStorage: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockImplementation(async (key: string) => mockStorage[key] || null),
  setItem: jest.fn().mockImplementation(async (key: string, val: string) => {
    mockStorage[key] = val;
  }),
  removeItem: jest.fn().mockImplementation(async (key: string) => {
    delete mockStorage[key];
  }),
  clear: jest.fn().mockImplementation(async () => {
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);
  }),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  saveRide,
  getRides,
  getRideById,
  deleteRide,
  saveActiveRideState,
  getActiveRideState,
  clearActiveRideState,
  updateRidePhoto,
  saveUserProfilePhoto,
  getUserProfilePhoto,
  getSafeRidePointsPath,
  isSafeDocumentFile,
  RUTA_DEMO,
  getVehicles,
  saveVehicles,
  getActiveVehicleId,
  setActiveVehicleId,
  getActiveVehicle,
  addVehicle,
  updateVehicle,
  deleteVehicle,
  getMotorcycleSettings,
  saveMotorcycleSettings,
  DEFAULT_VEHICLE,
} from '../storage';
import { LocationPoint, RideSession, Vehicle } from '@/types/ride';

describe('Servicio de Almacenamiento Desacoplado (storage.ts)', () => {
  beforeEach(() => {
    Object.keys(mockFiles).forEach((k) => delete mockFiles[k]);
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);
    jest.clearAllMocks();
  });

  test('Si no hay rutas guardadas, getRides(true) devuelve la RUTA_DEMO', async () => {
    const rides = await getRides(true);
    expect(rides.length).toBe(1);
    expect(rides[0].id).toBe(RUTA_DEMO.id);
  });

  test('Guarda una ruta, desacopla los puntos a archivo y mantiene el índice ligero en AsyncStorage', async () => {
    const testPoints: LocationPoint[] = [
      { latitude: 40.5, longitude: -3.8, altitude: 700, speed: 60, accuracy: 4, timestamp: 1000 },
      { latitude: 40.51, longitude: -3.81, altitude: 710, speed: 65, accuracy: 4, timestamp: 2000 },
      { latitude: 40.52, longitude: -3.82, altitude: 720, speed: 70, accuracy: 4, timestamp: 3000 },
    ];

    const testRide: RideSession = {
      id: 'test-ride-01',
      name: 'Ruta de Prueba',
      date: new Date().toISOString(),
      startTime: 1000,
      endTime: 3000,
      totalDurationSeconds: 2,
      movingDurationSeconds: 2,
      totalDistanceKm: 3.5,
      elevationGainMeters: 20,
      maxAltitudeMeters: 720,
      minAltitudeMeters: 700,
      maxSpeedKmh: 70,
      avgSpeedKmh: 65,
      ratings: { overall: 5, roadCondition: 4, sceneryCurves: 5 },
      points: testPoints,
    };

    await saveRide(testRide);

    // 1. Verificar catálogo en AsyncStorage: debe existir pero sin puntos masivos
    const indexRaw = mockStorage['@mototrack_rides_index'];
    expect(indexRaw).toBeDefined();
    const indexData = JSON.parse(indexRaw);
    expect(indexData.length).toBe(1);
    expect(indexData[0].id).toBe('test-ride-01');
    expect(indexData[0].points.length).toBe(0); // Puntos desacoplados

    // 2. Verificar archivo en FileSystem: debe existir el JSON con los puntos
    const pointsFileKey = 'file:///mock/storage/rides/test-ride-01_points.json';
    expect(mockFiles[pointsFileKey]).toBeDefined();
    const storedPoints = JSON.parse(mockFiles[pointsFileKey]);
    expect(storedPoints.length).toBeGreaterThan(0);

    // 3. getRideById resuelve los puntos desde el archivo bajo demanda
    const loaded = await getRideById('test-ride-01');
    expect(loaded).not.toBeNull();
    expect(loaded?.points.length).toBeGreaterThan(0);
  });

  test('deleteRide elimina tanto del catálogo en AsyncStorage como del archivo de puntos en disco', async () => {
    const testRide: RideSession = {
      id: 'ride-to-delete',
      name: 'Ruta a Eliminar',
      date: new Date().toISOString(),
      startTime: 1000,
      endTime: 2000,
      totalDurationSeconds: 1,
      movingDurationSeconds: 1,
      totalDistanceKm: 1.0,
      elevationGainMeters: 5,
      maxAltitudeMeters: 600,
      minAltitudeMeters: 595,
      maxSpeedKmh: 50,
      avgSpeedKmh: 50,
      ratings: { overall: 4, roadCondition: 4, sceneryCurves: 4 },
      points: [{ latitude: 40.0, longitude: -3.0, altitude: 600, speed: 50, accuracy: 5, timestamp: 1000 }],
    };

    await saveRide(testRide);
    expect(mockFiles['file:///mock/storage/rides/ride-to-delete_points.json']).toBeDefined();

    await deleteRide('ride-to-delete');

    const ridesAfter = await getRides(false);
    expect(ridesAfter.find((r) => r.id === 'ride-to-delete')).toBeUndefined();
    expect(mockFiles['file:///mock/storage/rides/ride-to-delete_points.json']).toBeUndefined();
  });

  test('Simulación de ruta de 180 km (15.000 puntos): se guarda y se recupera íntegra sin desbordar AsyncStorage', async () => {
    const massivePoints: LocationPoint[] = [];
    const baseTime = Date.now() - 4 * 3600 * 1000;

    for (let i = 0; i < 15000; i++) {
      massivePoints.push({
        latitude: 40.123456 + i * 0.00008,
        longitude: -3.654321 + (i % 20 === 0 ? 0.0002 : 0),
        altitude: 800 + Math.round(Math.sin(i) * 150),
        speed: 75.5,
        accuracy: 4,
        timestamp: baseTime + i * 1000,
      });
    }

    const longRide: RideSession = {
      id: 'ride-180km-madrid-avila',
      name: 'Ruta Sierra 180 km',
      date: new Date().toISOString(),
      startTime: baseTime,
      endTime: Date.now(),
      totalDurationSeconds: 14400,
      movingDurationSeconds: 12600,
      totalDistanceKm: 182.4,
      elevationGainMeters: 2850,
      maxAltitudeMeters: 1520,
      minAltitudeMeters: 620,
      maxSpeedKmh: 118.2,
      avgSpeedKmh: 52.1,
      ratings: { overall: 5, roadCondition: 5, sceneryCurves: 5 },
      points: massivePoints,
    };

    await saveRide(longRide);

    // El catálogo en AsyncStorage debe ser minúsculo (< 2 KB)
    const rawCatalog = mockStorage['@mototrack_rides_index'];
    expect(Buffer.byteLength(rawCatalog, 'utf8')).toBeLessThan(2048);

    // El listado de rutas en Historial no falla
    const rides = await getRides(false);
    expect(rides.length).toBe(1);
    expect(rides[0].totalDistanceKm).toBe(182.4);

    // getRideById carga la ruta completa con sus puntos simplificados
    const fullLongRide = await getRideById('ride-180km-madrid-avila');
    expect(fullLongRide).not.toBeNull();
    expect(fullLongRide?.points.length).toBeGreaterThan(100);
    // Los puntos se redujeron eficazmente por RDP
    expect(fullLongRide!.points.length).toBeLessThan(15000);
  });

  test('Manejo seguro de sesión activa: guarda puntos en archivo y recupera sin tocar SQLite masivamente', async () => {
    const activePoints: LocationPoint[] = [
      { latitude: 40.4, longitude: -3.7, altitude: 650, speed: 45, accuracy: 4, timestamp: 1000 },
      { latitude: 40.41, longitude: -3.71, altitude: 655, speed: 50, accuracy: 4, timestamp: 2000 },
    ];

    await saveActiveRideState({
      status: 'recording',
      startTime: 1000,
      pausedTime: null,
      totalPausedDuration: 0,
      lastMovingTimestamp: 2000,
      points: activePoints,
      metrics: {
        currentSpeed: 50,
        maxSpeed: 50,
        avgSpeed: 47.5,
        totalDistanceKm: 1.2,
        totalDurationSeconds: 2,
        movingDurationSeconds: 2,
        currentAltitude: 655,
        elevationGainMeters: 5,
        maxAltitudeMeters: 655,
        minAltitudeMeters: 650,
        isAutoPaused: false,
      },
    });

    const restored = await getActiveRideState();
    expect(restored).not.toBeNull();
    expect(restored?.status).toBe('recording');
    expect(restored?.points.length).toBe(2);

    await clearActiveRideState();
    const afterClear = await getActiveRideState();
    expect(afterClear).toBeNull();
  });

  test('H-03: clearActiveRideState invalida escrituras concurrentes en vuelo (anti-ruta zombi)', async () => {
    // Simular un guardado en curso que tarda en resolver
    const pendingSave = saveActiveRideState({
      status: 'recording',
      startTime: 5000,
      pausedTime: null,
      totalPausedDuration: 0,
      lastMovingTimestamp: 5000,
      points: [{ latitude: 40.0, longitude: -3.0, altitude: 600, timestamp: 5000, speed: 20, accuracy: 5 }],
      metrics: {
        currentSpeed: 20,
        maxSpeed: 20,
        avgSpeed: 20,
        totalDistanceKm: 0.1,
        totalDurationSeconds: 1,
        movingDurationSeconds: 1,
        currentAltitude: 600,
        elevationGainMeters: 0,
        maxAltitudeMeters: 600,
        minAltitudeMeters: 600,
        isAutoPaused: false,
      },
    });

    // Inmediatamente después el usuario descarta la ruta
    await clearActiveRideState();
    // Esperar a que la promesa en vuelo termine
    await pendingSave;

    // No debe haber resucitado el estado activo en almacenamiento
    const stateAfterSave = await getActiveRideState();
    expect(stateAfterSave).toBeNull();
  });

  test('H-09: deleteRide elimina el archivo de foto de la ruta si existe en documentDirectory', async () => {
    const photoUri = 'file:///mock/storage/ride_photo_12345.jpg';
    mockFiles[photoUri] = 'fake-image-bytes';

    const testRide: RideSession = {
      id: 'ride-with-photo-test',
      name: 'Ruta con Foto',
      date: new Date().toISOString(),
      startTime: 1000,
      endTime: 2000,
      totalDurationSeconds: 1000,
      movingDurationSeconds: 1000,
      totalDistanceKm: 15,
      maxSpeedKmh: 90,
      avgSpeedKmh: 54,
      elevationGainMeters: 200,
      maxAltitudeMeters: 800,
      minAltitudeMeters: 600,
      points: [{ latitude: 40.0, longitude: -3.0, altitude: 600, timestamp: 1000, speed: 50, accuracy: 5 }],
      ratings: { overall: 5, roadCondition: 4, sceneryCurves: 5 },
      photoUri,
    };

    await saveRide(testRide);
    expect(mockFiles[photoUri]).toBeDefined();

    await deleteRide('ride-with-photo-test');
    // El archivo de la foto debe haber sido eliminado del almacenamiento para no fugar espacio
    expect(mockFiles[photoUri]).toBeUndefined();
  });

  test('updateRidePhoto actualiza la foto de una ruta existente en el índice', async () => {
    const testRide: RideSession = {
      id: 'ride-update-photo-test',
      name: 'Ruta a actualizar',
      date: new Date().toISOString(),
      startTime: 1000,
      endTime: 2000,
      totalDurationSeconds: 1000,
      movingDurationSeconds: 1000,
      totalDistanceKm: 15,
      maxSpeedKmh: 90,
      avgSpeedKmh: 54,
      elevationGainMeters: 200,
      maxAltitudeMeters: 800,
      minAltitudeMeters: 600,
      points: [{ latitude: 40.0, longitude: -3.0, altitude: 600, timestamp: 1000, speed: 50, accuracy: 5 }],
      ratings: { overall: 5, roadCondition: 4, sceneryCurves: 5 },
    };

    await saveRide(testRide);
    await updateRidePhoto('ride-update-photo-test', 'file:///mock/storage/new_photo.jpg');

    const updated = await getRideById('ride-update-photo-test');
    expect(updated?.photoUri).toBe('file:///mock/storage/new_photo.jpg');
  });

  test('AUD3-01: updateRidePhoto sobre RUTA_DEMO no vacía ni corrompe el catálogo de rutas', async () => {
    // Si el usuario no tiene rutas y personaliza la demo
    await updateRidePhoto(RUTA_DEMO.id, 'file:///mock/storage/demo_photo.jpg');

    // getRides(true) DEBE seguir devolviendo la ruta demo
    const ridesWithDemo = await getRides(true);
    expect(ridesWithDemo.length).toBe(1);
    expect(ridesWithDemo[0].id).toBe(RUTA_DEMO.id);
  });

  test('AUD3-02: saveUserProfilePhoto elimina la foto de perfil previa en documentDirectory al cambiarla', async () => {
    const oldPhoto = 'file:///mock/storage/profile_old.jpg';
    const newPhoto = 'file:///mock/storage/profile_new.jpg';
    mockFiles[oldPhoto] = 'old-profile-bytes';
    mockFiles[newPhoto] = 'new-profile-bytes';

    await saveUserProfilePhoto(oldPhoto);
    expect(mockFiles[oldPhoto]).toBeDefined();

    // Actualizar a una nueva foto
    await saveUserProfilePhoto(newPhoto);
    expect(await getUserProfilePhoto()).toBe(newPhoto);
    // La foto vieja debe haber sido eliminada de mockFiles
    expect(mockFiles[oldPhoto]).toBeUndefined();
  });

  test('AUD3-03: Si AsyncStorage.setItem falla al guardar ruta, se hace rollback eliminando el archivo de puntos', async () => {
    const originalSetItem = AsyncStorage.setItem;
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('Disk full / storage write error'));

    const testRide: RideSession = {
      id: 'ride-rollback-test',
      name: 'Ruta con Fallo de Catálogo',
      date: new Date().toISOString(),
      startTime: 1000,
      endTime: 2000,
      totalDurationSeconds: 1000,
      movingDurationSeconds: 1000,
      totalDistanceKm: 15,
      maxSpeedKmh: 90,
      avgSpeedKmh: 54,
      elevationGainMeters: 200,
      maxAltitudeMeters: 800,
      minAltitudeMeters: 600,
      points: [{ latitude: 40.0, longitude: -3.0, altitude: 600, timestamp: 1000, speed: 50, accuracy: 5 }],
      ratings: { overall: 5, roadCondition: 4, sceneryCurves: 5 },
    };

    await expect(saveRide(testRide)).rejects.toThrow('No se pudo guardar la ruta en el dispositivo.');

    // El archivo de puntos individual en FileSystem debe haberse limpiado en el bloque catch
    const pointsFileKey = 'file:///mock/storage/rides/ride-rollback-test_points.json';
    expect(mockFiles[pointsFileKey]).toBeUndefined();

    // Restaurar mock
    (AsyncStorage.setItem as jest.Mock).mockImplementation(async (key: string, val: string) => {
      mockStorage[key] = val;
    });
  });

  test('EXT-07: getSafeRidePointsPath sanea IDs y previene path traversal', () => {
    expect(getSafeRidePointsPath('../../../')).toBeNull();
    expect(getSafeRidePointsPath(';;/\\//?...')).toBeNull();
    expect(getSafeRidePointsPath('../../etc/passwd')).toBe('file:///mock/storage/rides/etcpasswd_points.json');
    expect(getSafeRidePointsPath('ride_123-abc')).toBe('file:///mock/storage/rides/ride_123-abc_points.json');
    expect(getSafeRidePointsPath('')).toBeNull();
  });

  test('EXT-07: isSafeDocumentFile rechaza URIs fuera de documentDirectory o con retroceso de ruta', () => {
    expect(isSafeDocumentFile('file:///system/etc/security.key')).toBe(false);
    expect(isSafeDocumentFile('file:///mock/storage/../system/file.png')).toBe(false);
    expect(isSafeDocumentFile('file:///mock/storage/avatar.jpg')).toBe(true);
    expect(isSafeDocumentFile('')).toBe(false);
  });

  describe('Gestión de Vehículos y Mi Garaje', () => {
    test('getVehicles inicializa con DEFAULT_VEHICLE si no hay datos previos', async () => {
      const vehicles = await getVehicles();
      expect(vehicles).toHaveLength(1);
      expect(vehicles[0].name).toBe('Mi Moto');
      expect(vehicles[0].avgConsumptionL100km).toBe(4.5);
      expect(vehicles[0].fuelPricePerLiter).toBe(1.65);

      const activeId = await getActiveVehicleId();
      expect(activeId).toBe(vehicles[0].id);
    });

    test('getVehicles migra automáticamente la configuración legacy si existe', async () => {
      mockStorage['@mototrack_motorcycle_settings'] = JSON.stringify({
        bikeModel: 'Ducati Monster 821',
        avgConsumptionL100km: 5.4,
        fuelPricePerLiter: 1.72,
      });

      const vehicles = await getVehicles();
      expect(vehicles).toHaveLength(1);
      expect(vehicles[0].name).toBe('Ducati Monster 821');
      expect(vehicles[0].avgConsumptionL100km).toBe(5.4);
      expect(vehicles[0].fuelPricePerLiter).toBe(1.72);

      const active = await getActiveVehicle();
      expect(active.name).toBe('Ducati Monster 821');
    });

    test('addVehicle agrega un nuevo vehículo al garaje y lo persiste', async () => {
      await getVehicles(); // inicializa
      const added = await addVehicle({
        name: 'KTM 890 Adventure R',
        avgConsumptionL100km: 4.8,
        fuelPricePerLiter: 1.68,
      });

      expect(added.id).toMatch(/^veh-/);
      expect(added.name).toBe('KTM 890 Adventure R');

      const all = await getVehicles();
      expect(all).toHaveLength(2);
      expect(all.some((v) => v.name === 'KTM 890 Adventure R')).toBe(true);
    });

    test('setActiveVehicleId y getActiveVehicle cambian y devuelven el vehículo activo', async () => {
      await getVehicles();
      const newVeh = await addVehicle({
        name: 'Yamaha Ténéré 700',
        avgConsumptionL100km: 4.2,
        fuelPricePerLiter: 1.65,
      });

      await setActiveVehicleId(newVeh.id);
      const activeId = await getActiveVehicleId();
      expect(activeId).toBe(newVeh.id);

      const activeVeh = await getActiveVehicle();
      expect(activeVeh.name).toBe('Yamaha Ténéré 700');
    });

    test('updateVehicle modifica los datos de un vehículo existente', async () => {
      const [initial] = await getVehicles();
      await updateVehicle({
        ...initial,
        name: 'BMW R1250GS',
        avgConsumptionL100km: 5.1,
        fuelPricePerLiter: 1.69,
      });

      const updatedList = await getVehicles();
      const updated = updatedList.find((v) => v.id === initial.id);
      expect(updated?.name).toBe('BMW R1250GS');
      expect(updated?.avgConsumptionL100km).toBe(5.1);
      expect(updated?.fuelPricePerLiter).toBe(1.69);
    });

    test('deleteVehicle elimina un vehículo y no permite eliminar si solo queda 1', async () => {
      const [first] = await getVehicles();
      const second = await addVehicle({
        name: 'Honda CBR650R',
        avgConsumptionL100km: 4.9,
        fuelPricePerLiter: 1.65,
      });

      expect(await getVehicles()).toHaveLength(2);

      // Borrar el segundo
      const deleted = await deleteVehicle(second.id);
      expect(deleted).toBe(true);
      expect(await getVehicles()).toHaveLength(1);

      // Intentar borrar el único restante debe fallar (proteger garaje vacío)
      const deletedLast = await deleteVehicle(first.id);
      expect(deletedLast).toBe(false);
      expect(await getVehicles()).toHaveLength(1);
    });

    test('adaptadores legacy getMotorcycleSettings y saveMotorcycleSettings sincronizan con el vehículo activo', async () => {
      const settings = await getMotorcycleSettings();
      expect(settings.bikeModel).toBeDefined();

      await saveMotorcycleSettings({
        bikeModel: 'Triumph Street Triple',
        avgConsumptionL100km: 5.3,
        fuelPricePerLiter: 1.70,
      });

      const active = await getActiveVehicle();
      expect(active.name).toBe('Triumph Street Triple');
      expect(active.avgConsumptionL100km).toBe(5.3);
      expect(active.fuelPricePerLiter).toBe(1.70);

      const updatedSettings = await getMotorcycleSettings();
      expect(updatedSettings.bikeModel).toBe('Triumph Street Triple');
    });
  });
});


