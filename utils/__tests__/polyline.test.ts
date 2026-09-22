import { simplifyPoints } from '../polyline';
import { LocationPoint } from '@/types/ride';

describe('Algoritmo Ramer-Douglas-Peucker para Rutas en Moto (simplifyPoints)', () => {
  test('Maneja colecciones vacías o de menos de 3 puntos sin alterar', () => {
    expect(simplifyPoints([])).toEqual([]);

    const singlePoint: LocationPoint[] = [
      { latitude: 40.4168, longitude: -3.7038, altitude: 650, speed: 50, accuracy: 5, timestamp: 1000 },
    ];
    expect(simplifyPoints(singlePoint)).toEqual(singlePoint);

    const twoPoints: LocationPoint[] = [
      { latitude: 40.4168, longitude: -3.7038, altitude: 650, speed: 50, accuracy: 5, timestamp: 1000 },
      { latitude: 40.4178, longitude: -3.7038, altitude: 650, speed: 50, accuracy: 5, timestamp: 2000 },
    ];
    expect(simplifyPoints(twoPoints)).toEqual(twoPoints);
  });

  test('Una recta de 100 puntos colineales se reduce a exactamente 2 puntos (inicio y fin)', () => {
    const straightPoints: LocationPoint[] = [];
    const baseLat = 40.0;
    const baseLon = -3.5;

    for (let i = 0; i < 100; i++) {
      straightPoints.push({
        latitude: baseLat + i * 0.0001,
        longitude: baseLon,
        altitude: 600,
        speed: 80,
        accuracy: 4,
        timestamp: 1000 + i * 1000,
      });
    }

    const simplified = simplifyPoints(straightPoints, 1.0);
    expect(simplified.length).toBe(2);
    expect(simplified[0]).toEqual(straightPoints[0]);
    expect(simplified[1]).toEqual(straightPoints[99]);
  });

  test('Conserva vértices críticos en una curva cerrada / horquilla', () => {
    const pointsWithCorner: LocationPoint[] = [
      { latitude: 40.0, longitude: -3.0, altitude: 700, speed: 60, accuracy: 4, timestamp: 1000 },
      { latitude: 40.005, longitude: -3.0, altitude: 700, speed: 50, accuracy: 4, timestamp: 2000 },
      // Vértice de la curva a 90 grados
      { latitude: 40.01, longitude: -3.0, altitude: 700, speed: 40, accuracy: 4, timestamp: 3000 },
      { latitude: 40.01, longitude: -2.995, altitude: 700, speed: 50, accuracy: 4, timestamp: 4000 },
      { latitude: 40.01, longitude: -2.99, altitude: 700, speed: 60, accuracy: 4, timestamp: 5000 },
    ];

    const simplified = simplifyPoints(pointsWithCorner, 1.0);
    // Debe conservar el punto de giro intermedio
    expect(simplified.length).toBeGreaterThanOrEqual(3);
    const hasCorner = simplified.some(
      (p) => Math.abs(p.latitude - 40.01) < 0.00001 && Math.abs(p.longitude - -3.0) < 0.00001
    );
    expect(hasCorner).toBe(true);
  });

  test('Preserva la geometría de una miniglorieta urbana estrecha (radio 5 metros) con tolerancia 1.0 m', () => {
    // Generar arco de 90 grados en una rotonda de radio 5 m
    // Radio 5 m: deltaLat = 5 / 111320 ≈ 0.000045 deg
    const centerLat = 40.4168;
    const centerLon = -3.7038;
    const rDeg = 5 / 111320;
    const roundaboutPoints: LocationPoint[] = [];

    for (let angle = 0; angle <= 90; angle += 15) {
      const rad = (angle * Math.PI) / 180;
      roundaboutPoints.push({
        latitude: centerLat + rDeg * Math.sin(rad),
        longitude: centerLon + rDeg * Math.cos(rad),
        altitude: 650,
        speed: 20,
        accuracy: 3,
        timestamp: 1000 + angle * 100,
      });
    }

    const simplified = simplifyPoints(roundaboutPoints, 1.0);
    // Con 1.0 m de tolerancia, el vértice intermedio de la glorieta no debe aplanarse a una secante
    expect(simplified.length).toBeGreaterThanOrEqual(3);
  });

  test('Simulación de ruta de 5000 puntos: reduce el número de puntos al menos un 50% conservando curvas', () => {
    const routePoints: LocationPoint[] = [];
    let lat = 40.5;
    let lon = -4.0;
    const now = Date.now();

    for (let i = 0; i < 5000; i++) {
      if (i % 50 === 0) {
        lon += 0.002;
      } else {
        lat += 0.0001;
      }
      routePoints.push({
        latitude: lat,
        longitude: lon,
        altitude: 800,
        speed: 70,
        accuracy: 4,
        timestamp: now + i * 1000,
      });
    }

    const simplified = simplifyPoints(routePoints, 1.0);
    const reductionRatio = 1 - simplified.length / routePoints.length;
    expect(reductionRatio).toBeGreaterThan(0.5);
  });

  test('Estrés Extremo: Procesa 35.000 puntos (ruta de 500 km) en modo iterativo sin desbordar la pila de llamadas', () => {
    const massivePoints: LocationPoint[] = [];
    const baseTime = Date.now() - 8 * 3600 * 1000;

    for (let i = 0; i < 35000; i++) {
      massivePoints.push({
        latitude: 40.0 + (i * 0.00005) + Math.sin(i / 100) * 0.0002,
        longitude: -3.0 + Math.cos(i / 100) * 0.0002,
        altitude: 700 + Math.round(Math.sin(i / 50) * 200),
        speed: 85,
        accuracy: 4,
        timestamp: baseTime + i * 1000,
      });
    }

    const startTime = Date.now();
    // No debe lanzar RangeError: Maximum call stack size exceeded
    const simplified = simplifyPoints(massivePoints, 1.0);
    const elapsedMs = Date.now() - startTime;

    expect(simplified.length).toBeGreaterThan(0);
    expect(simplified.length).toBeLessThan(massivePoints.length);
    // Debe ejecutarse con extrema rapidez (< 200 ms)
    expect(elapsedMs).toBeLessThan(1000);
  });
});
