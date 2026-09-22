/**
 * Servicio de almacenamiento local offline para MotoTrack.
 * Utiliza @react-native-async-storage/async-storage para el catálogo ligero de rutas
 * y expo-file-system para almacenar los trazados GPS detallados (puntos) de forma individual.
 * Evita el límite CursorWindow de 2 MB de SQLite en Android en rutas de larga distancia (>100 km).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { ActiveRideState, LocationPoint, MotorcycleSettings, RideSession, Vehicle } from '@/types/ride';
import { simplifyPoints } from '@/utils/polyline';

const RIDES_INDEX_STORAGE_KEY = '@mototrack_rides_index';
const RIDES_STORAGE_KEY = '@mototrack_rides'; // Clave legacy para migración
const ACTIVE_RIDE_STORAGE_KEY = '@mototrack_active_ride';

function getRidesDir(): string {
  return FileSystem && FileSystem.documentDirectory
    ? `${FileSystem.documentDirectory}rides/`
    : '';
}

function getActivePointsFile(): string {
  return FileSystem && FileSystem.documentDirectory
    ? `${FileSystem.documentDirectory}active_ride_points.json`
    : '';
}

/**
 * Resuelve la ruta del archivo de puntos de una ruta aplicando sanitización estricta (EXT-07).
 * Previene vulnerabilidades de Path Traversal (../).
 */
export function getSafeRidePointsPath(id: string): string | null {
  const ridesDir = getRidesDir();
  if (!ridesDir || !id || typeof id !== 'string') return null;
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeId) return null;
  return `${ridesDir}${safeId}_points.json`;
}

/**
 * Valida que una URI pertenezca estrictamente al documentDirectory sin retroceso de ruta (EXT-08).
 */
export function isSafeDocumentFile(uri: string): boolean {
  if (!uri || !FileSystem || !FileSystem.documentDirectory) return false;
  if (!uri.startsWith(FileSystem.documentDirectory)) return false;
  const relative = uri.slice(FileSystem.documentDirectory.length);
  return !relative.includes('..');
}

async function ensureRidesDirectory(): Promise<void> {
  const dir = getRidesDir();
  if (!dir) return;
  try {
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    }
  } catch (err) {
    console.warn('Error al verificar o crear directorio de rutas:', err);
  }
}

/**
 * Ruta de ejemplo de alta calidad por un puerto de montaña para pruebas inmediatas.
 */
export const RUTA_DEMO: RideSession = {
  id: 'demo-sierra-norte-01',
  name: 'Puerto de la Cruz Verde - El Escorial',
  date: new Date(Date.now() - 86400000 * 2).toISOString(), // Hace 2 días
  startTime: Date.now() - 86400000 * 2 - 3600000 * 2,
  endTime: Date.now() - 86400000 * 2,
  totalDurationSeconds: 7200, // 2 horas
  movingDurationSeconds: 6120, // 1h 42m rodando
  totalDistanceKm: 84.6,
  elevationGainMeters: 1240,
  maxAltitudeMeters: 1420,
  minAltitudeMeters: 650,
  maxSpeedKmh: 98.4,
  avgSpeedKmh: 49.8,
  fuelConsumedLiters: 3.8,
  fuelCostEstimate: 6.27,
  ratings: {
    overall: 5,
    roadCondition: 4,
    sceneryCurves: 5,
  },
  points: [
    { latitude: 40.5898, longitude: -4.1293, altitude: 980, speed: 45, accuracy: 5, timestamp: 1 },
    { latitude: 40.5950, longitude: -4.1350, altitude: 1020, speed: 52, accuracy: 4, timestamp: 2 },
    { latitude: 40.6020, longitude: -4.1480, altitude: 1080, speed: 64, accuracy: 5, timestamp: 3 },
    { latitude: 40.6110, longitude: -4.1610, altitude: 1150, speed: 58, accuracy: 6, timestamp: 4 },
    { latitude: 40.6190, longitude: -4.1750, altitude: 1256, speed: 42, accuracy: 4, timestamp: 5 },
    { latitude: 40.6270, longitude: -4.1890, altitude: 1380, speed: 48, accuracy: 5, timestamp: 6 },
    { latitude: 40.6350, longitude: -4.1980, altitude: 1420, speed: 55, accuracy: 5, timestamp: 7 },
    { latitude: 40.6410, longitude: -4.1850, altitude: 1360, speed: 62, accuracy: 4, timestamp: 8 },
    { latitude: 40.6480, longitude: -4.1720, altitude: 1280, speed: 67, accuracy: 5, timestamp: 9 },
    { latitude: 40.6540, longitude: -4.1590, altitude: 1190, speed: 71, accuracy: 6, timestamp: 10 },
    { latitude: 40.6610, longitude: -4.1420, altitude: 1050, speed: 65, accuracy: 5, timestamp: 11 },
    { latitude: 40.6690, longitude: -4.1280, altitude: 940, speed: 50, accuracy: 4, timestamp: 12 },
  ],
};

/**
 * Guarda una nueva sesión de ruta:
 * 1. Simplifica los puntos GPS con RDP (tolerancia 2m).
 * 2. Escribe los puntos en un archivo individual en expo-file-system.
 * 3. Guarda la entrada en el catálogo ligero en AsyncStorage (sin array de puntos masivo).
 */
export async function saveRide(ride: RideSession): Promise<void> {
  let pointsWrittenFile: string | null = null;
  try {
    const ridesDir = getRidesDir();
    let pointsToStore = ride.points || [];

    if (pointsToStore.length > 2) {
      pointsToStore = simplifyPoints(pointsToStore, 2.0);
    }
    // 1. Guardar archivo individual de puntos en FileSystem
    const pointsFile = getSafeRidePointsPath(ride.id);
    if (pointsFile && pointsToStore.length > 0) {
      await ensureRidesDirectory();
      await FileSystem.writeAsStringAsync(
        pointsFile,
        JSON.stringify(pointsToStore),
        { encoding: FileSystem.EncodingType.UTF8 }
      );
      pointsWrittenFile = pointsFile;
    }

    // 2. Guardar sesión en catálogo ligero
    const existingRides = await getRides(false);
    const rideSummary: RideSession = {
      ...ride,
      points: [], // No sobrecargar SQLite con miles de puntos
    };

    const updatedRides = [rideSummary, ...existingRides.filter((r) => r.id !== ride.id)];
    await AsyncStorage.setItem(RIDES_INDEX_STORAGE_KEY, JSON.stringify(updatedRides));
  } catch (error) {
    if (pointsWrittenFile) {
      await FileSystem.deleteAsync(pointsWrittenFile, { idempotent: true }).catch(() => {});
    }
    console.error('Error al guardar la ruta en almacenamiento:', error);
    throw new Error('No se pudo guardar la ruta en el dispositivo.');
  }
}

/**
 * Obtiene el catálogo de rutas guardadas, ordenadas de la más reciente a la más antigua.
 * Incluye migración automática transparente si existen datos en la clave legacy @mototrack_rides.
 */
export async function getRides(includeDemo = true): Promise<RideSession[]> {
  try {
    let json = await AsyncStorage.getItem(RIDES_INDEX_STORAGE_KEY);

    // Migración transparente de rutas anteriores si no existe el nuevo índice
    if (!json) {
      const legacyJson = await AsyncStorage.getItem(RIDES_STORAGE_KEY);
      if (legacyJson) {
        try {
          const legacyRides: RideSession[] = JSON.parse(legacyJson);
          if (Array.isArray(legacyRides) && legacyRides.length > 0) {
            const ridesDir = getRidesDir();
            let migrationHadErrors = false;
            if (ridesDir) {
              await ensureRidesDirectory();
              for (const r of legacyRides) {
                if (r.id && r.id !== RUTA_DEMO.id && r.points && r.points.length > 0) {
                  try {
                    const simplified = simplifyPoints(r.points, 2.0);
                    await FileSystem.writeAsStringAsync(
                      `${ridesDir}${r.id}_points.json`,
                      JSON.stringify(simplified),
                      { encoding: FileSystem.EncodingType.UTF8 }
                    );
                  } catch (ptsErr) {
                    migrationHadErrors = true;
                    console.warn(`Aviso al migrar puntos de ruta ${r.id}:`, ptsErr);
                  }
                }
              }
            } else {
              migrationHadErrors = true;
            }

            const migratedIndex: RideSession[] = legacyRides.map((r) => ({
              ...r,
              points: r.id === RUTA_DEMO.id ? r.points : [],
            }));

            await AsyncStorage.setItem(RIDES_INDEX_STORAGE_KEY, JSON.stringify(migratedIndex));
            // H-06: Solo eliminar clave legacy si no hubo ningún error de I/O en la migración de puntos
            if (!migrationHadErrors) {
              await AsyncStorage.removeItem(RIDES_STORAGE_KEY);
            }
            json = JSON.stringify(migratedIndex);
          }
        } catch (migErr) {
          console.warn('Advertencia durante la migración de rutas legacy:', migErr);
        }
      }
    }

    if (!json) {
      return includeDemo ? [RUTA_DEMO] : [];
    }

    const rides: RideSession[] = JSON.parse(json);
    if (rides.length === 0 && includeDemo) {
      return [RUTA_DEMO];
    }
    return rides.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  } catch (error) {
    console.error('Error al obtener rutas de almacenamiento:', error);
    return [];
  }
}

/**
 * Obtiene una ruta específica con sus puntos GPS detallados resueltos bajo demanda desde el archivo en disco.
 */
export async function getRideById(id: string): Promise<RideSession | null> {
  if (id === RUTA_DEMO.id) {
    return RUTA_DEMO;
  }

  const rides = await getRides(false);
  const ride = rides.find((r) => r.id === id);
  if (!ride) return null;

  // Si ya tiene puntos cargados, devolver directamente
  if (ride.points && ride.points.length > 0) {
    return ride;
  }

  // Leer puntos desde expo-file-system
  const pointsFile = getSafeRidePointsPath(id);
  if (pointsFile) {
    try {
      const fileInfo = await FileSystem.getInfoAsync(pointsFile);
      if (fileInfo.exists) {
        const pointsJson = await FileSystem.readAsStringAsync(pointsFile, {
          encoding: FileSystem.EncodingType.UTF8,
        });
        const points: LocationPoint[] = JSON.parse(pointsJson);
        return {
          ...ride,
          points,
        };
      }
    } catch (err) {
      console.warn(`No se pudieron cargar los puntos del archivo para la ruta ${id}:`, err);
    }
  }

  return { ...ride, points: [] };
}

// Contador de generación para invalidar escrituras asíncronas en vuelo al descartar sesión (H-03)
let activeWriteSessionToken = 0;

/**
 * Elimina una ruta por su id tanto del catálogo en AsyncStorage como de su archivo de puntos en disco.
 */
export async function deleteRide(id: string): Promise<void> {
  try {
    const rides = await getRides(false);
    const rideToDelete = rides.find((r) => r.id === id);
    const filtered = rides.filter((r) => r.id !== id);
    await AsyncStorage.setItem(RIDES_INDEX_STORAGE_KEY, JSON.stringify(filtered));

    const pointsFile = getSafeRidePointsPath(id);
    if (pointsFile) {
      await FileSystem.deleteAsync(pointsFile, { idempotent: true });
    }

    // H-09: Limpiar foto asociada de la ruta en documentDirectory si existe
    if (rideToDelete?.photoUri && isSafeDocumentFile(rideToDelete.photoUri)) {
      await FileSystem.deleteAsync(rideToDelete.photoUri, { idempotent: true });
    }
  } catch (error) {
    console.error('Error al eliminar la ruta de almacenamiento:', error);
    throw new Error('No se pudo eliminar la ruta.');
  }
}

/**
 * Actualiza la foto asociada a una ruta guardada en el catálogo.
 */
export async function updateRidePhoto(rideId: string, photoUri: string): Promise<void> {
  try {
    if (rideId === RUTA_DEMO.id) {
      // La ruta demo se genera en memoria, no sobreescribir el índice de usuario con un array vacío
      RUTA_DEMO.photoUri = photoUri;
      return;
    }
    const rides = await getRides(false);
    const updated = rides.map((r) => (r.id === rideId ? { ...r, photoUri } : r));
    await AsyncStorage.setItem(RIDES_INDEX_STORAGE_KEY, JSON.stringify(updated));
  } catch (error) {
    console.error('Error al actualizar la foto de la ruta:', error);
  }
}

/**
 * Guarda el estado activo de una ruta en curso.
 * Los metadatos van a AsyncStorage y los puntos a un archivo temporal para no saturar SQLite cada 20s.
 */
export async function saveActiveRideState(state: ActiveRideState): Promise<void> {
  const currentToken = activeWriteSessionToken;
  try {
    const pointsFile = getActivePointsFile();
    if (pointsFile && state.points && state.points.length > 0) {
      if (currentToken !== activeWriteSessionToken) return;
      await FileSystem.writeAsStringAsync(
        pointsFile,
        JSON.stringify(state.points),
        { encoding: FileSystem.EncodingType.UTF8 }
      );
    }

    if (currentToken !== activeWriteSessionToken) return;
    const stateMeta: ActiveRideState = {
      ...state,
      points: [],
    };
    await AsyncStorage.setItem(ACTIVE_RIDE_STORAGE_KEY, JSON.stringify(stateMeta));
  } catch (error) {
    console.error('Error al guardar el estado activo de la ruta:', error);
  }
}

/**
 * Recupera el estado de una ruta activa si existía antes del cierre, resolviendo los puntos del archivo.
 */
export async function getActiveRideState(): Promise<ActiveRideState | null> {
  try {
    const json = await AsyncStorage.getItem(ACTIVE_RIDE_STORAGE_KEY);
    if (!json) return null;

    const state: ActiveRideState = JSON.parse(json);
    const pointsFile = getActivePointsFile();
    if (pointsFile) {
      try {
        const fileInfo = await FileSystem.getInfoAsync(pointsFile);
        if (fileInfo.exists) {
          const pointsJson = await FileSystem.readAsStringAsync(pointsFile, {
            encoding: FileSystem.EncodingType.UTF8,
          });
          state.points = JSON.parse(pointsJson);
        }
      } catch (ptsErr) {
        console.warn('Aviso al recuperar puntos activos del archivo:', ptsErr);
      }
    }
    return state;
  } catch (error) {
    console.error('Error al recuperar estado activo:', error);
    return null;
  }
}

/**
 * Limpia el estado activo y su archivo de puntos temporal cuando se finaliza o cancela una ruta.
 */
export async function clearActiveRideState(): Promise<void> {
  // H-03: Invalidar tokens de escritura en curso para evitar resurrección de rutas zombi
  activeWriteSessionToken++;
  try {
    await AsyncStorage.removeItem(ACTIVE_RIDE_STORAGE_KEY);
    const pointsFile = getActivePointsFile();
    if (pointsFile) {
      await FileSystem.deleteAsync(pointsFile, { idempotent: true });
    }
  } catch (error) {
    console.error('Error al limpiar el estado activo:', error);
  }
}

const USER_NICKNAME_KEY = '@mototrack_user_nickname';

/**
 * Obtiene el apodo o nombre del piloto guardado.
 */
export async function getUserNickname(): Promise<string> {
  try {
    const name = await AsyncStorage.getItem(USER_NICKNAME_KEY);
    return name && name.trim().length > 0 ? name : 'Piloto';
  } catch {
    return 'Piloto';
  }
}

/**
 * Guarda el apodo o nombre del piloto.
 */
export async function saveUserNickname(nickname: string): Promise<void> {
  try {
    await AsyncStorage.setItem(USER_NICKNAME_KEY, nickname.trim() || 'Piloto');
  } catch (error) {
    console.error('Error al guardar el apodo del piloto:', error);
  }
}

const USER_PROFILE_PHOTO_KEY = '@mototrack_user_profile_photo';

/**
 * Obtiene la URI de la foto de perfil del piloto guardada.
 */
export async function getUserProfilePhoto(): Promise<string | null> {
  try {
    const photoUri = await AsyncStorage.getItem(USER_PROFILE_PHOTO_KEY);
    return photoUri && photoUri.trim().length > 0 ? photoUri : null;
  } catch {
    return null;
  }
}

/**
 * Guarda o actualiza la foto de perfil del piloto en almacenamiento persistente.
 */
export async function saveUserProfilePhoto(photoUri: string | null): Promise<void> {
  try {
    const oldPhotoUri = await getUserProfilePhoto();
    if (photoUri && photoUri.trim().length > 0) {
      await AsyncStorage.setItem(USER_PROFILE_PHOTO_KEY, photoUri);
    } else {
      await AsyncStorage.removeItem(USER_PROFILE_PHOTO_KEY);
    }
    // H-09: Limpiar foto anterior en disco para evitar fugas acumulativas
    if (
      oldPhotoUri &&
      oldPhotoUri !== photoUri &&
      isSafeDocumentFile(oldPhotoUri)
    ) {
      await FileSystem.deleteAsync(oldPhotoUri, { idempotent: true }).catch(() => {});
    }
  } catch (error) {
    console.error('Error al guardar la foto de perfil del piloto:', error);
  }
}

const MOTORCYCLE_SETTINGS_KEY = '@mototrack_motorcycle_settings';
const VEHICLES_STORAGE_KEY = '@mototrack_vehicles';
const ACTIVE_VEHICLE_ID_KEY = '@mototrack_active_vehicle_id';

export const DEFAULT_VEHICLE: Vehicle = {
  id: 'veh-default',
  name: 'Mi Moto',
  avgConsumptionL100km: 4.5,
  fuelPricePerLiter: 1.65,
};

export const DEFAULT_MOTORCYCLE_SETTINGS: MotorcycleSettings = {
  bikeModel: 'Mi Moto',
  avgConsumptionL100km: 4.5,
  fuelPricePerLiter: 1.65,
};

/**
 * Obtiene la lista completa de vehículos del usuario (Mi Garaje).
 * Si no existen vehículos, migra automáticamente los ajustes legacy de MotorcycleSettings.
 */
export async function getVehicles(): Promise<Vehicle[]> {
  try {
    const data = await AsyncStorage.getItem(VEHICLES_STORAGE_KEY);
    if (data) {
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((v) => ({
          id: String(v.id || `veh-${Date.now()}`),
          name: typeof v.name === 'string' && v.name.trim().length > 0 ? v.name.trim() : 'Mi Moto',
          avgConsumptionL100km:
            typeof v.avgConsumptionL100km === 'number' && v.avgConsumptionL100km > 0
              ? v.avgConsumptionL100km
              : 4.5,
          fuelPricePerLiter:
            typeof v.fuelPricePerLiter === 'number' && v.fuelPricePerLiter > 0
              ? v.fuelPricePerLiter
              : 1.65,
        }));
      }
    }

    // Migración legacy: si hay MotorcycleSettings guardado previamente
    const legacyData = await AsyncStorage.getItem(MOTORCYCLE_SETTINGS_KEY);
    if (legacyData) {
      const legacy = JSON.parse(legacyData);
      const migratedVehicle: Vehicle = {
        id: 'veh-migrated-1',
        name: typeof legacy.bikeModel === 'string' && legacy.bikeModel.trim().length > 0 ? legacy.bikeModel.trim() : 'Mi Moto',
        avgConsumptionL100km:
          typeof legacy.avgConsumptionL100km === 'number' && legacy.avgConsumptionL100km > 0
            ? legacy.avgConsumptionL100km
            : 4.5,
        fuelPricePerLiter:
          typeof legacy.fuelPricePerLiter === 'number' && legacy.fuelPricePerLiter > 0
            ? legacy.fuelPricePerLiter
            : 1.65,
      };
      await AsyncStorage.setItem(VEHICLES_STORAGE_KEY, JSON.stringify([migratedVehicle]));
      await AsyncStorage.setItem(ACTIVE_VEHICLE_ID_KEY, migratedVehicle.id);
      return [migratedVehicle];
    }

    // Inicialización por defecto
    await AsyncStorage.setItem(VEHICLES_STORAGE_KEY, JSON.stringify([DEFAULT_VEHICLE]));
    await AsyncStorage.setItem(ACTIVE_VEHICLE_ID_KEY, DEFAULT_VEHICLE.id);
    return [{ ...DEFAULT_VEHICLE }];
  } catch (error) {
    console.error('Error al obtener vehículos:', error);
    return [{ ...DEFAULT_VEHICLE }];
  }
}

/**
 * Guarda la lista de vehículos en el almacenamiento persistente.
 */
export async function saveVehicles(vehicles: Vehicle[]): Promise<void> {
  try {
    await AsyncStorage.setItem(VEHICLES_STORAGE_KEY, JSON.stringify(vehicles));
  } catch (error) {
    console.error('Error al guardar lista de vehículos:', error);
  }
}

/**
 * Obtiene el ID del vehículo activo actualmente.
 */
export async function getActiveVehicleId(): Promise<string> {
  try {
    const activeId = await AsyncStorage.getItem(ACTIVE_VEHICLE_ID_KEY);
    if (activeId) return activeId;
    const vehicles = await getVehicles();
    const fallbackId = vehicles[0]?.id || DEFAULT_VEHICLE.id;
    await AsyncStorage.setItem(ACTIVE_VEHICLE_ID_KEY, fallbackId);
    return fallbackId;
  } catch {
    return DEFAULT_VEHICLE.id;
  }
}

/**
 * Establece el vehículo activo por su ID.
 */
export async function setActiveVehicleId(vehicleId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(ACTIVE_VEHICLE_ID_KEY, vehicleId);
  } catch (error) {
    console.error('Error al establecer vehículo activo:', error);
  }
}

/**
 * Obtiene el objeto del vehículo activo actualmente.
 */
export async function getActiveVehicle(): Promise<Vehicle> {
  try {
    const vehicles = await getVehicles();
    const activeId = await getActiveVehicleId();
    const found = vehicles.find((v) => v.id === activeId);
    if (found) return found;
    if (vehicles.length > 0) {
      await setActiveVehicleId(vehicles[0].id);
      return vehicles[0];
    }
    return { ...DEFAULT_VEHICLE };
  } catch {
    return { ...DEFAULT_VEHICLE };
  }
}

/**
 * Añade un nuevo vehículo al garaje y lo persiste.
 */
export async function addVehicle(data: Omit<Vehicle, 'id'>): Promise<Vehicle> {
  const newVehicle: Vehicle = {
    id: `veh-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: data.name.trim() || 'Nueva Moto',
    avgConsumptionL100km: data.avgConsumptionL100km > 0 ? data.avgConsumptionL100km : 4.5,
    fuelPricePerLiter: data.fuelPricePerLiter > 0 ? data.fuelPricePerLiter : 1.65,
  };

  const vehicles = await getVehicles();
  vehicles.push(newVehicle);
  await saveVehicles(vehicles);
  return newVehicle;
}

/**
 * Actualiza los datos de un vehículo existente.
 */
export async function updateVehicle(vehicle: Vehicle): Promise<void> {
  const vehicles = await getVehicles();
  const index = vehicles.findIndex((v) => v.id === vehicle.id);
  if (index !== -1) {
    vehicles[index] = {
      ...vehicle,
      name: vehicle.name.trim() || 'Moto',
      avgConsumptionL100km: vehicle.avgConsumptionL100km > 0 ? vehicle.avgConsumptionL100km : 4.5,
      fuelPricePerLiter: vehicle.fuelPricePerLiter > 0 ? vehicle.fuelPricePerLiter : 1.65,
    };
    await saveVehicles(vehicles);
  }
}

/**
 * Elimina un vehículo del garaje.
 * Devuelve false si se intenta eliminar el único vehículo restante (siempre debe quedar al menos uno).
 */
export async function deleteVehicle(vehicleId: string): Promise<boolean> {
  const vehicles = await getVehicles();
  if (vehicles.length <= 1) {
    return false; // No permitir vaciar el garaje por completo
  }

  const filtered = vehicles.filter((v) => v.id !== vehicleId);
  await saveVehicles(filtered);

  // Si se eliminó el que estaba activo, seleccionar el primero disponible
  const activeId = await getActiveVehicleId();
  if (activeId === vehicleId) {
    await setActiveVehicleId(filtered[0].id);
  }

  return true;
}

/**
 * Adaptador de compatibilidad: Obtiene los ajustes de la moto activa.
 */
export async function getMotorcycleSettings(): Promise<MotorcycleSettings> {
  try {
    const active = await getActiveVehicle();
    return {
      bikeModel: active.name,
      avgConsumptionL100km: active.avgConsumptionL100km,
      fuelPricePerLiter: active.fuelPricePerLiter,
    };
  } catch {
    return { ...DEFAULT_MOTORCYCLE_SETTINGS };
  }
}

/**
 * Adaptador de compatibilidad: Guarda los ajustes actualizando el vehículo activo.
 */
export async function saveMotorcycleSettings(settings: MotorcycleSettings): Promise<void> {
  try {
    const active = await getActiveVehicle();
    await updateVehicle({
      ...active,
      name: settings.bikeModel.trim() || active.name,
      avgConsumptionL100km: settings.avgConsumptionL100km > 0 ? settings.avgConsumptionL100km : 4.5,
      fuelPricePerLiter: settings.fuelPricePerLiter > 0 ? settings.fuelPricePerLiter : 1.65,
    });
  } catch (error) {
    console.error('Error al guardar ajustes legacy de moto:', error);
  }
}
