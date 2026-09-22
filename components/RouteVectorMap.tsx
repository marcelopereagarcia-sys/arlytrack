/**
 * Componente de visualización de mapa real con trazado de ruta para MotoTrack (RouteVectorMap).
 * Renderiza teselas de mapa reales (Estándar OpenStreetMap / Satélite Esri / Oscuro / Foto Galería)
 * combinadas con trazado vectorial de alta precisión en <Svg>.
 * 
 * Estilo "Electric Motorsport": Polilínea destacada (strokeWidth: 6) en Cian Neón (#00F0FF) / Lima (#39FF14)
 * con contorno de alto contraste para máxima visibilidad sobre mapas claros limpios sin oscurecer.
 */

import React, { useEffect, useRef } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  G,
  LinearGradient,
  Path,
  Polygon,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import { MotoColors } from '@/constants/Colors';
import { LocationPoint } from '@/types/ride';

export type RouteMapMode = 'standard' | 'satellite' | 'dark' | 'custom_photo';

interface RouteVectorMapProps {
  points: LocationPoint[];
  width: number;
  height: number;
  mapMode?: RouteMapMode;
  customPhotoUri?: string | null;
  strokeColor?: string;
  strokeWidth?: number;
  onTilesReady?: () => void;
}

function lon2pixel(lon: number, zoom: number): number {
  return ((lon + 180) / 360) * Math.pow(2, zoom) * 256;
}

function lat2pixel(lat: number, zoom: number): number {
  const sin = Math.sin((lat * Math.PI) / 180);
  const clampedSin = Math.min(Math.max(sin, -0.9999), 0.9999);
  return (
    (0.5 - Math.log((1 + clampedSin) / (1 - clampedSin)) / (4 * Math.PI)) *
    Math.pow(2, zoom) *
    256
  );
}

function getTileUrl(x: number, y: number, z: number, mode: RouteMapMode): string {
  const maxTile = Math.pow(2, z);
  const wrappedX = ((x % maxTile) + maxTile) % maxTile;
  const wrappedY = Math.min(Math.max(y, 0), maxTile - 1);

  if (mode === 'satellite') {
    // Esri World Imagery: satélite de alta resolución
    return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${wrappedY}/${wrappedX}.jpg`;
  }
  if (mode === 'dark') {
    // OpenStreetMap estándar
    return `https://tile.openstreetmap.org/${z}/${wrappedX}/${wrappedY}.png`;
  }
  // Modo estándar limpio: OpenStreetMap oficial sin marcas de agua
  return `https://tile.openstreetmap.org/${z}/${wrappedX}/${wrappedY}.png`;
}

export function RouteVectorMap({
  points,
  width,
  height,
  mapMode = 'standard',
  customPhotoUri,
  strokeColor = MotoColors.primary,
  strokeWidth = 6,
  onTilesReady,
}: RouteVectorMapProps) {
  if (!points || points.length < 2) {
    return (
      <View style={[styles.container, { width, height }]}>
        <Svg width={width} height={height}>
          <Rect width={width} height={height} fill="#161B26" />
          <SvgText
            x={width / 2}
            y={height / 2}
            fill={MotoColors.textMuted}
            fontSize={12}
            fontWeight="bold"
            textAnchor="middle">
            Ruta sin coordenadas registradas
          </SvgText>
        </Svg>
      </View>
    );
  }

  // Bounding box en coordenadas geográficas WGS84
  let minLat = points[0].latitude;
  let maxLat = points[0].latitude;
  let minLon = points[0].longitude;
  let maxLon = points[0].longitude;

  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (p.latitude < minLat) minLat = p.latitude;
    if (p.latitude > maxLat) maxLat = p.latitude;
    if (p.longitude < minLon) minLon = p.longitude;
    if (p.longitude > maxLon) maxLon = p.longitude;
  }

  const centerLat = (minLat + maxLat) / 2;
  const centerLon = (minLon + maxLon) / 2;

  // Determinar zoom óptimo para encajar el trazado en el lienzo disponible (H-05: ampliado a z >= 4 para rutas largas)
  let zoom = 16;
  for (let z = 16; z >= 4; z--) {
    const xMin = lon2pixel(minLon, z);
    const xMax = lon2pixel(maxLon, z);
    const yMin = lat2pixel(maxLat, z);
    const yMax = lat2pixel(minLat, z);

    if (Math.abs(xMax - xMin) <= width - 36 && Math.abs(yMax - yMin) <= height - 36) {
      zoom = z;
      break;
    }
    zoom = z;
  }

  // Origen en píxeles del centro del mapa
  const centerPixelX = lon2pixel(centerLon, zoom);
  const centerPixelY = lat2pixel(centerLat, zoom);

  const originX = centerPixelX - width / 2;
  const originY = centerPixelY - height / 2;

  // Generar cuadrícula de teselas visibles para el área
  const tiles: { key: string; x: number; y: number; z: number; left: number; top: number; url: string }[] = [];
  const minTileX = Math.floor(originX / 256);
  const maxTileX = Math.floor((originX + width) / 256);
  const minTileY = Math.floor(originY / 256);
  const maxTileY = Math.floor((originY + height) / 256);

  for (let tx = minTileX; tx <= maxTileX; tx++) {
    for (let ty = minTileY; ty <= maxTileY; ty++) {
      tiles.push({
        key: `${zoom}-${tx}-${ty}`,
        x: tx,
        y: ty,
        z: zoom,
        left: Math.round(tx * 256 - originX),
        top: Math.round(ty * 256 - originY),
        url: getTileUrl(tx, ty, zoom, mapMode),
      });
    }
  }

  // A-20: Seguimiento de carga de teselas para asegurar captura nítida sin fondos negros
  const loadedCountRef = useRef(0);
  const notifiedRef = useRef(false);

  useEffect(() => {
    loadedCountRef.current = 0;
    notifiedRef.current = false;
    if (mapMode === 'custom_photo') {
      if (!customPhotoUri) {
        notifiedRef.current = true;
        onTilesReady?.();
      }
    } else if (tiles.length === 0) {
      notifiedRef.current = true;
      onTilesReady?.();
    }
  }, [tiles.length, mapMode, customPhotoUri, onTilesReady]);

  const handleTileDone = () => {
    loadedCountRef.current += 1;
    if (loadedCountRef.current >= tiles.length && !notifiedRef.current) {
      notifiedRef.current = true;
      onTilesReady?.();
    }
  };

  // Convertir puntos GPS a coordenadas SVG
  const svgPoints = points.map((p) => ({
    x: lon2pixel(p.longitude, zoom) - originX,
    y: lat2pixel(p.latitude, zoom) - originY,
  }));

  // H-06: Construcción O(N) eficiente sin asignaciones intermedias de strings inmutables
  const pathParts: string[] = new Array(svgPoints.length);
  for (let i = 0; i < svgPoints.length; i++) {
    const pt = svgPoints[i];
    pathParts[i] = `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
  }
  const pathD = pathParts.join(' ');

  const startPt = svgPoints[0];
  const endPt = svgPoints[svgPoints.length - 1];

  return (
    <View style={[styles.container, { width, height }]}>
      {/* Capa 1: Foto personalizada de galería o teselas de mapa real limpias */}
      {mapMode === 'custom_photo' && customPhotoUri ? (
        <Image
          source={{ uri: customPhotoUri }}
          onLoad={() => {
            if (!notifiedRef.current) {
              notifiedRef.current = true;
              onTilesReady?.();
            }
          }}
          onError={() => {
            if (!notifiedRef.current) {
              notifiedRef.current = true;
              onTilesReady?.();
            }
          }}
          style={[StyleSheet.absoluteFill, { width, height }]}
          resizeMode="cover"
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.tileCanvas]}>
          {tiles.map((tile) => (
            <Image
              key={tile.key}
              source={{ uri: tile.url }}
              onLoad={handleTileDone}
              onError={handleTileDone}
              style={{
                position: 'absolute',
                left: tile.left,
                top: tile.top,
                width: 256,
                height: 256,
              }}
              resizeMode="cover"
            />
          ))}
        </View>
      )}

      {/* Capa 2: Filtro condicional (Estándar 100% limpio sin oscurecimiento) */}
      <View
        style={[
          StyleSheet.absoluteFill,
          mapMode === 'custom_photo'
            ? styles.customPhotoVignette
            : mapMode === 'satellite'
            ? styles.satelliteVignette
            : mapMode === 'dark'
            ? styles.darkVignette
            : styles.standardVignette,
        ]}
        pointerEvents="none"
      />

      {/* Capa 3: Trazado vectorial de la ruta con react-native-svg (Electric Motorsport) */}
      <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          {/* Gradiente Cian Neón a Lima Flúor */}
          <LinearGradient id="routeElectric" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor="#00F0FF" />
            <Stop offset="100%" stopColor="#39FF14" />
          </LinearGradient>
        </Defs>

        {/* Brújula Norte en la esquina superior derecha */}
        <G transform={`translate(${width - 28}, 22)`}>
          <Circle cx={0} cy={0} r={11} fill="rgba(11, 14, 20, 0.85)" stroke="#263044" strokeWidth={1} />
          <Polygon points="0,-7 2.5,2 0,0 -2.5,2" fill="#00F0FF" />
          <Polygon points="0,7 2.5,0 0,0 -2.5,0" fill="#94A3B8" />
          <SvgText x={0} y={-9} fill="#FFFFFF" fontSize={7.5} fontWeight="bold" textAnchor="middle">
            N
          </SvgText>
        </G>

        {/* Contorno oscuro técnico de la polilínea para garantizar máximo contraste en mapa claro */}
        <Path
          d={pathD}
          fill="none"
          stroke="#0B0E14"
          strokeWidth={strokeWidth + 4}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.7}
        />

        {/* Resplandor eléctrico neón */}
        <Path
          d={pathD}
          fill="none"
          stroke="rgba(0, 240, 255, 0.35)"
          strokeWidth={strokeWidth + 8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Línea principal en Cian Neón destacado (grosor 6) */}
        <Path
          d={pathD}
          fill="none"
          stroke="url(#routeElectric)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Marcador de Salida (Verde Lima Flúor) */}
        {startPt && (
          <G>
            <Circle cx={startPt.x} cy={startPt.y} r={11} fill="rgba(57, 255, 20, 0.35)" />
            <Circle cx={startPt.x} cy={startPt.y} r={5.5} fill="#39FF14" stroke="#FFFFFF" strokeWidth={2} />
          </G>
        )}

        {/* Marcador de Meta (Rojo Láser Neón) */}
        {endPt && (
          <G>
            <Circle cx={endPt.x} cy={endPt.y} r={11} fill="rgba(255, 0, 85, 0.35)" />
            <Circle cx={endPt.x} cy={endPt.y} r={5.5} fill="#FF0055" stroke="#FFFFFF" strokeWidth={2} />
          </G>
        )}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#0B0E14',
  },
  tileCanvas: {
    overflow: 'hidden',
  },
  // Modo estándar 100% limpio sin oscurecimiento para respetar el mapa claro
  standardVignette: {
    backgroundColor: 'transparent',
  },
  satelliteVignette: {
    backgroundColor: 'rgba(0, 0, 0, 0.12)',
  },
  darkVignette: {
    backgroundColor: 'rgba(0, 0, 0, 0.20)',
  },
  customPhotoVignette: {
    backgroundColor: 'rgba(11, 14, 20, 0.40)',
  },
});
