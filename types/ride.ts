/**
 * Definiciones de tipos TypeScript para el sistema de rastreo y sesiones de MotoTrack.
 * Tipado estricto sin uso de tipo `any`.
 */

export interface LocationPoint {
  latitude: number;
  longitude: number;
  altitude: number | null;
  speed: number | null; // En km/h
  accuracy: number | null; // En metros
  timestamp: number; // Marca de tiempo en milisegundos
}

export type TrackerStatus = 'idle' | 'recording' | 'paused' | 'finished';

export interface LiveMetrics {
  currentSpeed: number; // km/h
  maxSpeed: number; // km/h
  avgSpeed: number; // km/h
  totalDistanceKm: number; // Kilómetros recorridos con 2 decimales
  totalDurationSeconds: number; // Duración total transcurrida en segundos
  movingDurationSeconds: number; // Duración en movimiento (velocidad >= 3 km/h)
  currentAltitude: number | null; // Metros
  elevationGainMeters: number; // Desnivel positivo acumulado en metros
  maxAltitudeMeters: number | null;
  minAltitudeMeters: number | null;
  isAutoPaused: boolean; // Indica si se pausó automáticamente por parada prolongada
  isGpsSignalLost?: boolean; // Indica si se ha perdido la señal GPS (ej. túnel prolongado o fallo de señal)
}

export interface RideRatings {
  overall: number; // 1 a 5 estrellas
  roadCondition: number; // 1 a 5 estrellas (Estado del asfalto)
  sceneryCurves: number; // 1 a 5 estrellas (Nivel de curvas / paisaje)
}

export interface RideSession {
  id: string; // Identificador único UUID o timestamp
  name: string; // Nombre dado a la ruta
  date: string; // Fecha en formato ISO
  startTime: number; // Marca temporal de inicio (ms)
  endTime: number; // Marca temporal de fin (ms)
  totalDurationSeconds: number; // Duración total en segundos
  movingDurationSeconds: number; // Tiempo rodando en segundos
  totalDistanceKm: number; // Distancia en kilómetros
  elevationGainMeters: number; // Desnivel positivo ganado en metros
  maxAltitudeMeters: number; // Altitud máxima alcanzada
  minAltitudeMeters: number; // Altitud mínima alcanzada
  maxSpeedKmh: number; // Velocidad máxima registrada
  avgSpeedKmh: number; // Velocidad media
  ratings: RideRatings; // Valoraciones de la ruta
  points: LocationPoint[]; // Coordenadas del trazado
  photoUri?: string; // Foto opcional del paisaje o moto tomada en la ruta
  fuelConsumedLiters?: number; // Litros consumidos estimados
  fuelCostEstimate?: number; // Coste económico estimado de gasolina
  vehicleId?: string; // ID del vehículo utilizado (ej. "veh-1727000000000")
  vehicleName?: string; // Nombre del vehículo utilizado (ej. "Yamaha MT-07")
}

export interface Vehicle {
  id: string; // Identificador único (ej. "veh-1727000000000")
  name: string; // Nombre del vehículo / moto (ej. "Yamaha MT-07", "KTM Duke 390")
  avgConsumptionL100km: number; // Consumo medio en L/100 km (ej. 4.5)
  fuelPricePerLiter: number; // Precio del combustible en €/L (ej. 1.65)
}

export interface MotorcycleSettings {
  bikeModel: string; // Modelo de la moto (ej. "Yamaha MT-07", "KTM Duke 390")
  avgConsumptionL100km: number; // Consumo medio en L/100 km (por defecto 4.5)
  fuelPricePerLiter: number; // Precio por litro en moneda local (por defecto 1.65)
}

export interface ActiveRideState {
  status: TrackerStatus;
  startTime: number | null;
  pausedTime: number | null;
  totalPausedDuration: number;
  lastMovingTimestamp: number | null;
  points: LocationPoint[];
  metrics: LiveMetrics;
}
