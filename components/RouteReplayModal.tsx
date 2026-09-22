/**
 * Modal de Exploración y Reproducción de Ruta Virtual (RouteReplayModal).
 * Permite recorrer cualquier ruta del historial en pantalla completa sin conflictos de scroll,
 * ver la polilínea completa con banderas de salida y meta, interactuar con un reproductor
 * temporal (play/pause, selector de velocidad, barra deslizadora) que desplaza la moto
 * mostrando la telemetría exacta en cada curva (velocidad, altitud, distancia),
 * y compartir el resumen por WhatsApp o tarjeta 9:16.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Dimensions,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  Compass,
  FastForward,
  Fuel,
  Gauge,
  Layers,
  MapPin,
  Maximize2,
  Mountain,
  Pause,
  Play,
  RotateCcw,
  Route,
  Share2,
  Timer,
  X,
} from 'lucide-react-native';
import { MotoColors } from '@/constants/Colors';
import { LocationPoint, RideSession } from '@/types/ride';
import { calculateHaversineDistance } from '@/services/tracker';
import { MapMode, MotorcycleMap, MotorcycleMapRef } from './MotorcycleMap';
import { ShareCardModal } from './ShareCard';

interface RouteReplayModalProps {
  visible: boolean;
  ride: RideSession | null;
  onClose: () => void;
}

function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}h ${mins.toString().padStart(2, '0')}m`;
  }
  return `${mins}m ${secs.toString().padStart(2, '0')}s`;
}

export function RouteReplayModal({ visible, ride, onClose }: RouteReplayModalProps) {
  const mapRef = useRef<MotorcycleMapRef>(null);
  const [mapMode, setMapMode] = useState<MapMode>('standard');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<1 | 2 | 5>(2);
  const [followRider, setFollowRider] = useState(false);
  const [showShareCard, setShowShareCard] = useState(false);
  const playTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentIndexRef = useRef(currentIndex);
  currentIndexRef.current = currentIndex;

  const points = ride?.points || [];
  const totalPoints = points.length;
  const currentPoint: LocationPoint | null = points[currentIndex] || null;

  // Reset al abrir el modal
  useEffect(() => {
    if (visible && points.length > 0) {
      setCurrentIndex(0);
      currentIndexRef.current = 0;
      setIsPlaying(false);
      setFollowRider(false);
      setTimeout(() => {
        mapRef.current?.fitBounds();
      }, 300);
    } else {
      stopPlayback();
    }
  }, [visible]);

  // Manejador del temporizador de reproducción (H-12: paso dinámico para duración razonable de 30-45s)
  useEffect(() => {
    if (isPlaying && totalPoints > 1) {
      const intervalMs = Math.max(80, Math.floor(250 / playbackSpeed));
      const baseStep = Math.max(1, Math.ceil(totalPoints / 350));
      const step = Math.max(1, Math.round(baseStep * playbackSpeed));

      playTimerRef.current = setInterval(() => {
        const cur = currentIndexRef.current;
        if (cur >= totalPoints - 1) {
          setIsPlaying(false);
          return;
        }
        const nextIndex = Math.min(totalPoints - 1, cur + step);
        currentIndexRef.current = nextIndex;
        setCurrentIndex(nextIndex);
        const pt = points[nextIndex];
        if (pt) {
          mapRef.current?.moveToPoint(pt.latitude, pt.longitude, followRider);
        }
        if (nextIndex >= totalPoints - 1) {
          setIsPlaying(false);
        }
      }, intervalMs);
    } else {
      stopPlayback();
    }

    return () => stopPlayback();
  }, [isPlaying, playbackSpeed, totalPoints, followRider]);

  const stopPlayback = () => {
    if (playTimerRef.current) {
      clearInterval(playTimerRef.current);
      playTimerRef.current = null;
    }
  };

  const togglePlay = () => {
    if (currentIndex >= totalPoints - 1) {
      setCurrentIndex(0);
      if (points[0]) {
        mapRef.current?.moveToPoint(points[0].latitude, points[0].longitude, followRider);
      }
    }
    setIsPlaying((prev) => !prev);
  };

  const handleSpeedToggle = () => {
    if (playbackSpeed === 1) setPlaybackSpeed(2);
    else if (playbackSpeed === 2) setPlaybackSpeed(5);
    else setPlaybackSpeed(1);
  };

  const handleSeek = (newIndex: number) => {
    const clamped = Math.max(0, Math.min(totalPoints - 1, newIndex));
    setCurrentIndex(clamped);
    const pt = points[clamped];
    if (pt) {
      mapRef.current?.moveToPoint(pt.latitude, pt.longitude, followRider);
    }
  };

  const handleFitAll = () => {
    setFollowRider(false);
    mapRef.current?.fitBounds();
  };

  const handleFocusRider = () => {
    setFollowRider((prev) => !prev);
    if (currentPoint) {
      mapRef.current?.moveToPoint(currentPoint.latitude, currentPoint.longitude, true);
    }
  };

  const toggleMapLayer = () => {
    if (mapMode === 'standard') setMapMode('dark');
    else if (mapMode === 'dark') setMapMode('hybrid');
    else setMapMode('standard');
  };

  // Compartir resumen estructurado a WhatsApp
  const handleShareWhatsApp = async () => {
    if (!ride) return;
    const fuelLiters = ride.fuelConsumedLiters ?? Math.round(((ride.totalDistanceKm * 4.5) / 100) * 10) / 10;
    const fuelCost = ride.fuelCostEstimate ?? Math.round(fuelLiters * 1.65 * 100) / 100;

    const message =
`🏍️ *Ruta en Moto: ${ride.name}*
📍 Registrada con *ArlyTrack*

📏 Distancia total: ${ride.totalDistanceKm.toFixed(1)} km
⏱️ Tiempo en marcha: ${formatDuration(ride.movingDurationSeconds)}
🚀 Velocidad máxima: ${Math.round(ride.maxSpeedKmh)} km/h
📊 Velocidad media: ${ride.avgSpeedKmh.toFixed(1)} km/h
⛰️ Desnivel positivo: +${ride.elevationGainMeters} m
⛽ Consumo estimado: ${fuelLiters.toFixed(1)} L (~${fuelCost.toFixed(2)} €)

⭐ Valoración del piloto: ${ride.ratings.overall}/5
🔥 ¡Rueda seguro con ArlyTrack!`;

    try {
      await Share.share({
        title: ride.name,
        message,
      });
    } catch (err) {
      console.error('Error al compartir resumen por WhatsApp:', err);
    }
  };

  // Precalcular distancias geodésicas acumuladas reales para el odómetro del reproductor (A-04)
  const cumulativeDistances = useMemo(() => {
    if (!points || points.length === 0) return [0];
    const dists: number[] = [0];
    let acc = 0;
    for (let i = 1; i < points.length; i++) {
      acc += calculateHaversineDistance(
        points[i - 1].latitude,
        points[i - 1].longitude,
        points[i].latitude,
        points[i].longitude
      );
      dists.push(acc);
    }
    return dists;
  }, [points]);

  // Cálculo de progreso acumulado en porcentaje
  const progressRatio = totalPoints > 1 ? currentIndex / (totalPoints - 1) : 0;
  const currentDistanceKm = (cumulativeDistances[currentIndex] ?? (ride ? ride.totalDistanceKm * progressRatio : 0)).toFixed(1);
  const currentSpeed = currentPoint?.speed ? Math.round(currentPoint.speed) : 0;
  const currentAltitude = currentPoint?.altitude ? Math.round(currentPoint.altitude) : '--';

  // Configuración de gestos táctiles para la barra deslizadora (Scrubber) (H-04)
  const trackLayoutRef = useRef<{ x: number; width: number }>({ x: 0, width: 1 });
  const totalPointsRef = useRef(totalPoints);
  totalPointsRef.current = totalPoints;
  const handleSeekRef = useRef(handleSeek);
  handleSeekRef.current = handleSeek;
  const dragStartRatioRef = useRef(0);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        setIsPlaying(false);
        stopPlayback();
        const width = trackLayoutRef.current.width || 1;
        const ratio = Math.max(0, Math.min(1, evt.nativeEvent.locationX / width));
        dragStartRatioRef.current = ratio;
        const total = totalPointsRef.current;
        if (total > 1) {
          handleSeekRef.current(Math.floor(ratio * (total - 1)));
        }
      },
      onPanResponderMove: (_evt, gestureState) => {
        const width = trackLayoutRef.current.width || 1;
        const startX = dragStartRatioRef.current * width;
        const currentX = Math.max(0, Math.min(width, startX + gestureState.dx));
        const ratio = currentX / width;
        const total = totalPointsRef.current;
        if (total > 1) {
          handleSeekRef.current(Math.floor(ratio * (total - 1)));
        }
      },
    })
  ).current;

  if (!visible || !ride) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={styles.screen}>
        {/* 1. Mapa interactivo de fondo en pantalla completa */}
        <View style={styles.mapFullscreen}>
          <MotorcycleMap
            ref={mapRef}
            points={points}
            currentCoord={points.length > 0 ? { latitude: points[0].latitude, longitude: points[0].longitude } : null}
            mapMode={mapMode}
            fitBoundsOnLoad={true}
          />
        </View>

        {/* 2. Barra Superior Flotante */}
        <View style={styles.topBar}>
          <Pressable onPress={onClose} hitSlop={10} style={styles.iconCircleBtn}>
            <X size={22} color={MotoColors.text} />
          </Pressable>

          <View style={styles.titleGroup}>
            <Text style={styles.routeHeaderTitle} numberOfLines={1}>
              {ride.name}
            </Text>
            <Text style={styles.routeHeaderSubtitle}>
              {ride.totalDistanceKm.toFixed(1)} km · {points.length} puntos GPS
            </Text>
          </View>

          {/* Selector de modo de mapa */}
          <Pressable onPress={toggleMapLayer} hitSlop={8} style={styles.layerBtn}>
            <Layers size={18} color={MotoColors.primary} />
            <Text style={styles.layerBtnText}>
              {mapMode === 'standard' ? 'Calles' : mapMode === 'dark' ? 'Oscuro' : 'Satélite'}
            </Text>
          </Pressable>
        </View>

        {/* 3. Botones Flotantes de Navegación Lateral */}
        <View style={styles.floatingControls}>
          {/* Botón: Ver Ruta Completa */}
          <Pressable
            onPress={handleFitAll}
            style={({ pressed }) => [
              styles.floatingSideBtn,
              pressed && styles.floatingSideBtnPressed,
            ]}>
            <Maximize2 size={20} color={MotoColors.primary} />
            <Text style={styles.floatingSideBtnText}>Ruta total</Text>
          </Pressable>

          {/* Botón: Centrar / Seguir Piloto */}
          <Pressable
            onPress={handleFocusRider}
            style={({ pressed }) => [
              styles.floatingSideBtn,
              followRider && styles.floatingSideBtnActive,
              pressed && styles.floatingSideBtnPressed,
            ]}>
            <Compass size={20} color={followRider ? '#0B0E14' : MotoColors.primary} />
            <Text
              style={[
                styles.floatingSideBtnText,
                followRider && { color: '#0B0E14', fontWeight: '900' },
              ]}>
              {followRider ? 'Siguiendo' : 'Piloto'}
            </Text>
          </Pressable>
        </View>

        {/* 4. Panel Inferior de Replay y Telemetría */}
        <View style={styles.bottomSheet}>
          {/* Fila de Telemetría Dinámica en este punto */}
          <View style={styles.telemetryRow}>
            <View style={styles.telemetryCard}>
              <View style={styles.telemetryHeader}>
                <Gauge size={14} color={MotoColors.primary} />
                <Text style={styles.telemetryLabel}>VELOCIDAD</Text>
              </View>
              <Text style={styles.telemetryValue}>
                {currentSpeed} <Text style={styles.telemetryUnit}>km/h</Text>
              </Text>
            </View>

            <View style={styles.telemetryCard}>
              <View style={styles.telemetryHeader}>
                <Route size={14} color={MotoColors.lime} />
                <Text style={styles.telemetryLabel}>DISTANCIA</Text>
              </View>
              <Text style={styles.telemetryValue}>
                {currentDistanceKm} <Text style={styles.telemetryUnit}>km</Text>
              </Text>
            </View>

            <View style={styles.telemetryCard}>
              <View style={styles.telemetryHeader}>
                <Mountain size={14} color={MotoColors.cyan} />
                <Text style={styles.telemetryLabel}>ALTITUD</Text>
              </View>
              <Text style={styles.telemetryValue}>
                {currentAltitude} <Text style={styles.telemetryUnit}>m</Text>
              </Text>
            </View>
          </View>

          {/* Barra Deslizadora Temporal (Scrubber) */}
          <View style={styles.scrubberContainer}>
            <View style={styles.scrubberHeader}>
              <Text style={styles.scrubberTime}>
                Punto {currentIndex + 1} de {totalPoints}
              </Text>
              <Text style={styles.scrubberPercentage}>
                {Math.round(progressRatio * 100)}% de ruta
              </Text>
            </View>

            <View
              style={styles.scrubberTrack}
              onLayout={(e) => {
                trackLayoutRef.current = {
                  x: e.nativeEvent.layout.x,
                  width: e.nativeEvent.layout.width,
                };
              }}
              {...panResponder.panHandlers}>
              <View
                pointerEvents="none"
                style={[
                  styles.scrubberProgress,
                  { width: `${Math.max(2, progressRatio * 100)}%` },
                ]}
              />
              <View
                pointerEvents="none"
                style={[
                  styles.scrubberThumb,
                  { left: `${Math.max(0, Math.min(97, progressRatio * 100))}%` },
                ]}
              />
            </View>
          </View>

          {/* Botones de Control de Reproducción */}
          <View style={styles.controlsRow}>
            {/* Reiniciar al inicio */}
            <Pressable
              onPress={() => handleSeek(0)}
              hitSlop={8}
              style={styles.auxControlBtn}>
              <RotateCcw size={20} color={MotoColors.textSecondary} />
            </Pressable>

            {/* Velocidad de reproducción */}
            <Pressable
              onPress={handleSpeedToggle}
              hitSlop={8}
              style={styles.speedBadge}>
              <Text style={styles.speedBadgeText}>{playbackSpeed}x</Text>
            </Pressable>

            {/* Botón Principal: Play / Pause */}
            <Pressable
              onPress={togglePlay}
              style={({ pressed }) => [
                styles.mainPlayBtn,
                pressed && styles.mainPlayBtnPressed,
              ]}>
              {isPlaying ? (
                <Pause size={28} color="#0B0E14" fill="#0B0E14" />
              ) : (
                <Play size={28} color="#0B0E14" fill="#0B0E14" style={{ marginLeft: 3 }} />
              )}
            </Pressable>

            {/* Compartir por WhatsApp directo */}
            <Pressable
              onPress={handleShareWhatsApp}
              hitSlop={8}
              style={styles.shareOptionBtn}>
              <Share2 size={20} color={MotoColors.lime} />
              <Text style={styles.shareOptionText}>WhatsApp</Text>
            </Pressable>

            {/* Abrir Tarjeta de Redes 9:16 */}
            <Pressable
              onPress={() => setShowShareCard(true)}
              hitSlop={8}
              style={styles.shareCardBtn}>
              <Text style={styles.shareCardBtnText}>Tarjeta 9:16</Text>
            </Pressable>
          </View>
        </View>

        {/* Modal de Tarjeta 9:16 */}
        <ShareCardModal
          visible={showShareCard}
          ride={ride}
          onClose={() => setShowShareCard(false)}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: MotoColors.background,
  },
  mapFullscreen: {
    ...StyleSheet.absoluteFill,
  },
  // Barra Superior
  topBar: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 52 : 20,
    left: 14,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(22, 27, 38, 0.94)',
    borderColor: MotoColors.border,
    borderWidth: 1.5,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
  iconCircleBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#101622',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: MotoColors.border,
  },
  titleGroup: {
    flex: 1,
  },
  routeHeaderTitle: {
    color: MotoColors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  routeHeaderSubtitle: {
    color: MotoColors.primary,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 1,
  },
  layerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#101622',
    borderColor: MotoColors.primary,
    borderWidth: 1.5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 44,
    borderRadius: 14,
  },
  layerBtnText: {
    color: MotoColors.text,
    fontSize: 11,
    fontWeight: '800',
  },
  // Controles flotantes laterales
  floatingControls: {
    position: 'absolute',
    right: 14,
    top: Platform.OS === 'ios' ? 120 : 88,
    gap: 10,
  },
  floatingSideBtn: {
    width: 58,
    height: 54,
    borderRadius: 16,
    backgroundColor: 'rgba(22, 27, 38, 0.95)',
    borderColor: MotoColors.border,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 5,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
  },
  floatingSideBtnActive: {
    backgroundColor: MotoColors.primary,
    borderColor: '#FFFFFF',
  },
  floatingSideBtnPressed: {
    transform: [{ scale: 0.95 }],
  },
  floatingSideBtnText: {
    color: MotoColors.textSecondary,
    fontSize: 9,
    fontWeight: '800',
    marginTop: 2,
    textTransform: 'uppercase',
  },
  // Hoja inferior de telemetría y controles
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(16, 20, 30, 0.96)',
    borderColor: MotoColors.border,
    borderTopWidth: 1.5,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: Platform.OS === 'ios' ? 32 : 18,
    gap: 12,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
  },
  telemetryRow: {
    flexDirection: 'row',
    gap: 8,
  },
  telemetryCard: {
    flex: 1,
    backgroundColor: 'rgba(22, 27, 38, 0.9)',
    borderColor: '#263044',
    borderWidth: 1.5,
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  telemetryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 2,
  },
  telemetryLabel: {
    color: MotoColors.textSecondary,
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  telemetryValue: {
    color: MotoColors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  telemetryUnit: {
    color: MotoColors.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  // Barra de desplazamiento (Scrubber)
  scrubberContainer: {
    gap: 6,
  },
  scrubberHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  scrubberTime: {
    color: MotoColors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
  },
  scrubberPercentage: {
    color: MotoColors.primary,
    fontSize: 11,
    fontWeight: '800',
  },
  scrubberTrack: {
    position: 'relative',
    height: 22,
    justifyContent: 'center',
  },
  scrubberProgress: {
    height: 8,
    backgroundColor: MotoColors.primary,
    borderRadius: 4,
  },
  scrubberThumb: {
    position: 'absolute',
    top: 3,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: MotoColors.primary,
    shadowColor: MotoColors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 5,
    elevation: 4,
  },
  // Fila de controles de reproducción
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  auxControlBtn: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#161B26',
    borderWidth: 1.5,
    borderColor: MotoColors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speedBadge: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#161B26',
    borderWidth: 1.5,
    borderColor: MotoColors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speedBadgeText: {
    color: MotoColors.primary,
    fontSize: 13.5,
    fontWeight: '900',
  },
  mainPlayBtn: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: MotoColors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: MotoColors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
  mainPlayBtnPressed: {
    transform: [{ scale: 0.94 }],
  },
  shareOptionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(57, 255, 20, 0.12)',
    borderColor: 'rgba(57, 255, 20, 0.35)',
    borderWidth: 1,
    paddingHorizontal: 10,
    height: 44,
    borderRadius: 12,
  },
  shareOptionText: {
    color: MotoColors.lime,
    fontSize: 11,
    fontWeight: '800',
  },
  shareCardBtn: {
    backgroundColor: '#20293A',
    borderColor: MotoColors.border,
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareCardBtnText: {
    color: MotoColors.text,
    fontSize: 11,
    fontWeight: '800',
  },
});
