/**
 * Utilidad para exportación de rutas a formato GPX 1.1 estándar (GPS Exchange Format).
 * Permite a los usuarios exportar sus rutas a Garmin, Wikiloc, Strava, Google Earth, etc.
 * Resuelve el problema de lock-in y pérdida de historial (EXT-01).
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { RideSession } from '@/types/ride';

/**
 * Escapa caracteres XML reservados.
 */
function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Genera el documento XML en formato GPX 1.1 a partir de una sesión de ruta.
 */
export function generateGpx(ride: RideSession): string {
  const safeName = escapeXml(ride.name || 'Ruta ArlyTrack');
  const safeDate = new Date(ride.startTime || Date.now()).toISOString();
  const vehicleText = ride.vehicleName ? ` | Moto: ${escapeXml(ride.vehicleName)}` : '';

  const trackPoints = (ride.points || [])
    .map((pt) => {
      const lat = Number(pt.latitude).toFixed(7);
      const lon = Number(pt.longitude).toFixed(7);
      const ele = pt.altitude != null && !Number.isNaN(pt.altitude) ? `<ele>${Number(pt.altitude).toFixed(1)}</ele>` : '';
      const timeIso = new Date(pt.timestamp).toISOString();
      const speedMs = pt.speed != null ? (Number(pt.speed) / 3.6).toFixed(2) : null;
      const speedTag = speedMs != null ? `<speed>${speedMs}</speed>` : '';

      return `      <trkpt lat="${lat}" lon="${lon}">
        ${ele ? `${ele}\n        ` : ''}<time>${timeIso}</time>${speedTag ? `\n        <extensions>${speedTag}</extensions>` : ''}
      </trkpt>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="ArlyTrack - MotoTrack"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${safeName}</name>
    <desc>Registrado con ArlyTrack${vehicleText}</desc>
    <time>${safeDate}</time>
  </metadata>
  <trk>
    <name>${safeName}</name>
    <trkseg>
${trackPoints}
    </trkseg>
  </trk>
</gpx>`;
}

/**
 * Guarda el archivo GPX en disco temporal y abre el diálogo nativo de compartir/guardar archivo.
 */
export async function exportAndShareGpx(ride: RideSession): Promise<boolean> {
  try {
    const isAvailable = await Sharing.isAvailableAsync();
    if (!isAvailable) {
      return false;
    }

    const gpxContent = generateGpx(ride);
    const sanitizedName = (ride.name || 'ruta')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
    const sanitizedId = (ride.id || 'id').replace(/[^a-zA-Z0-9_-]/g, '');
    const fileName = `${sanitizedName}_${sanitizedId}.gpx`;
    const targetUri = `${FileSystem.cacheDirectory || FileSystem.documentDirectory}${fileName}`;

    await FileSystem.writeAsStringAsync(targetUri, gpxContent, {
      encoding: FileSystem.EncodingType.UTF8,
    });

    await Sharing.shareAsync(targetUri, {
      mimeType: 'application/gpx+xml',
      dialogTitle: `Exportar ruta GPX: ${ride.name}`,
      UTI: 'com.topografix.gpx',
    });

    return true;
  } catch (err) {
    console.error('Error al exportar GPX:', err);
    return false;
  }
}
