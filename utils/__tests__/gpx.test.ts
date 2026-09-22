import { generateGpx } from '../gpx';
import { RideSession } from '@/types/ride';

describe('Generador de Rutas GPX 1.1 Estándar (utils/gpx.ts)', () => {
  const sampleRide: RideSession = {
    id: 'ride-1234',
    name: 'Ruta Puerto de Navacerrada & Cotos',
    date: new Date(1711000000000).toISOString(),
    startTime: 1711000000000,
    endTime: 1711003600000,
    vehicleId: 'veh-yamaha-mt07',
    vehicleName: 'Yamaha MT-07',
    totalDistanceKm: 45.2,
    totalDurationSeconds: 3600,
    movingDurationSeconds: 3200,
    avgSpeedKmh: 50.8,
    maxSpeedKmh: 112.4,
    elevationGainMeters: 850,
    maxAltitudeMeters: 1860,
    minAltitudeMeters: 720,
    ratings: {
      overall: 5,
      roadCondition: 4,
      sceneryCurves: 5,
    },
    points: [
      {
        latitude: 40.7001,
        longitude: -4.0001,
        altitude: 1200,
        speed: 60, // 60 km/h = 16.67 m/s
        accuracy: 4,
        timestamp: 1711000000000,
      },
      {
        latitude: 40.7102,
        longitude: -4.0102,
        altitude: 1450,
        speed: 80, // 80 km/h = 22.22 m/s
        accuracy: 3,
        timestamp: 1711001000000,
      },
    ],
  };

  test('Genera un encabezado XML y esquema GPX 1.1 válidos', () => {
    const xml = generateGpx(sampleRide);

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<gpx version="1.1" creator="ArlyTrack - MotoTrack"');
    expect(xml).toContain('xmlns="http://www.topografix.com/GPX/1/1"');
    expect(xml).toContain('</gpx>');
  });

  test('Escapa caracteres XML especiales en el nombre de la ruta y del vehículo', () => {
    const xml = generateGpx({
      ...sampleRide,
      name: 'Ruta <Norte> & "Curvas" \'Extremas\'',
      vehicleName: 'KTM 890 Duke R & Akrapovic',
    });

    expect(xml).toContain('&amp;');
    expect(xml).toContain('&lt;Norte&gt;');
    expect(xml).toContain('&quot;Curvas&quot;');
    expect(xml).toContain('&apos;Extremas&apos;');
    expect(xml).toContain('Moto: KTM 890 Duke R &amp; Akrapovic');
    // Asegurar que no hay caracteres sin escapar en los tags de texto
    expect(xml).not.toContain('<name>Ruta <Norte>');
  });

  test('Escribe correctamente los trkpt con lat, lon, ele, time y speed', () => {
    const xml = generateGpx(sampleRide);

    expect(xml).toContain('<trk>');
    expect(xml).toContain('<trkseg>');
    expect(xml).toContain('</trkseg>');
    expect(xml).toContain('</trk>');

    // Verificar coordenadas con 7 decimales
    expect(xml).toContain('<trkpt lat="40.7001000" lon="-4.0001000">');
    expect(xml).toContain('<ele>1200.0</ele>');
    expect(xml).toContain('<time>' + new Date(1711000000000).toISOString() + '</time>');
    expect(xml).toContain('<speed>16.67</speed>'); // 60 km/h / 3.6 = 16.67 m/s

    expect(xml).toContain('<trkpt lat="40.7102000" lon="-4.0102000">');
    expect(xml).toContain('<ele>1450.0</ele>');
    expect(xml).toContain('<speed>22.22</speed>');
  });

  test('Maneja rutas vacías sin puntos sin errores', () => {
    const emptyRide: RideSession = {
      id: 'ride-empty',
      name: 'Ruta Cancelada',
      date: new Date(1711000000000).toISOString(),
      startTime: 1711000000000,
      endTime: 1711000005000,
      totalDistanceKm: 0,
      totalDurationSeconds: 5,
      movingDurationSeconds: 0,
      avgSpeedKmh: 0,
      maxSpeedKmh: 0,
      elevationGainMeters: 0,
      maxAltitudeMeters: 0,
      minAltitudeMeters: 0,
      ratings: { overall: 3, roadCondition: 3, sceneryCurves: 3 },
      points: [],
    };

    const xml = generateGpx(emptyRide);
    expect(xml).toContain('<gpx version="1.1"');
    expect(xml).toContain('<trkseg>\n\n    </trkseg>');
    expect(xml).toContain('</gpx>');
  });
});
