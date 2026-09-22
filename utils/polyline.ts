/**
 * Utilidades geométricas y de compresión para polilíneas GPS en MotoTrack.
 * Implementa el algoritmo Ramer-Douglas-Peucker (RDP) en versión 100% iterativa
 * adaptado a coordenadas geográficas en metros, inmune a desbordamientos de pila
 * y optimizado sin asignaciones intermedias para rutas de cualquier longitud (>35.000 puntos).
 */

import { LocationPoint } from '@/types/ride';

const EARTH_RADIUS_METERS = 6371000;
const DEG_TO_RAD = Math.PI / 180;

/**
 * Simplifica un array de puntos GPS aplicando el algoritmo Ramer-Douglas-Peucker
 * en modo iterativo con pila explícita en memoria heap (cero riesgo de stack overflow).
 * Optimizado: cálculo cuadrático sin Math.sqrt() en el bucle interior e invariantes
 * de segmento izados fuera del bucle de escaneo.
 *
 * @param points Array original de coordenadas GPS
 * @param toleranceMeters Tolerancia máxima de desviación en metros (por defecto 1.0 m para preservar rotondas y curvas lentas)
 * @returns Array simplificado conservando la geometría y vértices clave
 */
export function simplifyPoints(
  points: LocationPoint[],
  toleranceMeters: number = 1.0
): LocationPoint[] {
  const len = points ? points.length : 0;
  if (len <= 2) {
    return points ? [...points] : [];
  }

  const toleranceSq = toleranceMeters * toleranceMeters;

  // Máscara booleana para marcar los vértices que se conservan (1 byte por punto)
  const keep = new Uint8Array(len);
  keep[0] = 1;
  keep[len - 1] = 1;

  // Pila explícita en memoria heap [start, end, start, end, ...]
  const stack: number[] = [0, len - 1];

  while (stack.length > 0) {
    const end = stack.pop()!;
    const start = stack.pop()!;

    if (end <= start + 1) {
      continue;
    }

    const a = points[start];
    const b = points[end];

    // Invariantes del segmento AB calculados una única vez para todo el rango
    const meanLatRad = ((a.latitude + b.latitude) / 2) * DEG_TO_RAD;
    const cosMeanLat = Math.cos(meanLatRad);
    const kx = DEG_TO_RAD * cosMeanLat * EARTH_RADIUS_METERS;
    const ky = DEG_TO_RAD * EARTH_RADIUS_METERS;

    const dxAB = (b.longitude - a.longitude) * kx;
    const dyAB = (b.latitude - a.latitude) * ky;
    const segLengthSq = dxAB * dxAB + dyAB * dyAB;

    let maxDistSq = toleranceSq;
    let maxIndex = 0;

    for (let i = start + 1; i < end; i++) {
      const p = points[i];
      const dxAP = (p.longitude - a.longitude) * kx;
      const dyAP = (p.latitude - a.latitude) * ky;

      let distSq: number;
      if (segLengthSq === 0) {
        distSq = dxAP * dxAP + dyAP * dyAP;
      } else {
        const t = Math.max(0, Math.min(1, (dxAP * dxAB + dyAP * dyAB) / segLengthSq));
        const diffX = dxAP - t * dxAB;
        const diffY = dyAP - t * dyAB;
        distSq = diffX * diffX + diffY * diffY;
      }

      if (distSq > maxDistSq) {
        maxDistSq = distSq;
        maxIndex = i;
      }
    }

    if (maxIndex > 0) {
      keep[maxIndex] = 1;
      // Empujar ambos subsegmentos a la pila
      stack.push(start, maxIndex);
      stack.push(maxIndex, end);
    }
  }

  // Recolectar puntos marcados en una sola pasada O(N)
  const result: LocationPoint[] = [];
  for (let i = 0; i < len; i++) {
    if (keep[i] === 1) {
      result.push(points[i]);
    }
  }

  return result;
}
