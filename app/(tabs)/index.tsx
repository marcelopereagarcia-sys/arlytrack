/**
 * Pantalla Principal en Vivo de MotoTrack (app/(tabs)/index.tsx).
 * Incluye:
 * - Mensaje personalizado con nombre o apodo de piloto ("¡Listo para rodar, [Nombre]!", "[Nombre], tu ruta está en marcha").
 * - Modal para editar el apodo del piloto en cualquier momento.
 * - Motor de mapas MotorcycleMap (OpenStreetMap / Leaflet) que garantiza visualización 100% real
 *   de carreteras sin pantallas negras ni dependencia de Google Maps API Key.
 * - 3 Modos de mapa conmutables con 1 toque: Oscuro (CartoDB), Estándar (OSM) y Satélite (Esri).
 * - Sistema completo de Pausa y Reanudación para descansos moteros con cronómetro de descanso en vivo.
 * - Trazado de polilínea en tiempo real en naranja moto de alta visibilidad (#FF7A00).
 * - Panel HUD superior con 4 tarjetas de métricas en 3 niveles (sin colisiones de texto).
 * - Botones flotantes de gran tamaño (68px) aptos para guantes de moto.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import {
  AlertTriangle,
  Bike,
  Coffee,
  Crosshair,
  Edit3,
  Gauge,
  Layers,
  Mountain,
  Pause,
  Play,
  Route,
  Square,
  Timer,
  User,
} from 'lucide-react-native';
import { MotoColors } from '@/constants/Colors';
import { MetricCard } from '@/components/MetricCard';
import { FinishRideModal } from '@/components/FinishRideModal';
import { ShareCardModal } from '@/components/ShareCard';
import { RiderProfileModal } from '@/components/RiderProfileModal';
import {
  MotorcycleMap,
  MotorcycleMapRef,
  MapMode,
} from '@/components/MotorcycleMap';
import {
  discardOrFinalizeActiveRide,
  getTrackerState,
  pauseTracking,
  restoreActiveSession,
  resumeTracking,
  startTracking,
  stopTracking,
  subscribeToTracker,
} from '@/services/tracker';
import { getActiveVehicle, getUserNickname, getUserProfilePhoto } from '@/services/storage';
import { ActiveRideState, RideSession, Vehicle } from '@/types/ride';

function formatTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes.toString().padStart(2, '0')}:${seconds
    .toString()
    .padStart(2, '0')}`;
}

export default function LiveRideScreen() {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const [isFocused, setIsFocused] = useState(true);
  const isFocusedRef = useRef(true);
  const pendingStateRef = useRef<ActiveRideState | null>(null);

  const mapRef = useRef<MotorcycleMapRef>(null);
  const [trackerState, setTrackerState] = useState<ActiveRideState>(getTrackerState());
  const [riderNickname, setRiderNickname] = useState('Piloto');
  const [riderPhoto, setRiderPhoto] = useState<string | null>(null);
  const [activeVehicle, setActiveVehicle] = useState<Vehicle | null>(null);
  const [isProfileModalVisible, setIsProfileModalVisible] = useState(false);
  const [mapMode, setMapMode] = useState<MapMode>('dark');
  const [restSeconds, setRestSeconds] = useState(0);

  const [currentCoord, setCurrentCoord] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);

  // Estados de modales
  const [isFinishModalVisible, setIsFinishModalVisible] = useState(false);
  const [completedRideData, setCompletedRideData] = useState<ActiveRideState | null>(null);
  const [savedRideForShare, setSavedRideForShare] = useState<RideSession | null>(null);

  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      isFocusedRef.current = true;
      if (pendingStateRef.current) {
        setTrackerState(pendingStateRef.current);
        const lastPoint = pendingStateRef.current.points[pendingStateRef.current.points.length - 1];
        if (lastPoint) {
          setCurrentCoord({
            latitude: lastPoint.latitude,
            longitude: lastPoint.longitude,
          });
        }
        pendingStateRef.current = null;
      }
      return () => {
        setIsFocused(false);
        isFocusedRef.current = false;
      };
    }, [])
  );

  // Cargar perfil del usuario (apodo, foto y vehículo activo)
  useEffect(() => {
    getUserNickname().then(setRiderNickname);
    getUserProfilePhoto().then(setRiderPhoto);
    getActiveVehicle().then(setActiveVehicle);
  }, []);

  // Cronómetro de descanso en vivo mientras la ruta está pausada
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (trackerState.status === 'paused') {
      const startPause = trackerState.pausedTime || Date.now();
      setRestSeconds(Math.floor((Date.now() - startPause) / 1000));
      interval = setInterval(() => {
        setRestSeconds(Math.floor((Date.now() - startPause) / 1000));
      }, 1000);
    } else {
      setRestSeconds(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [trackerState.status, trackerState.pausedTime]);

  // EXT-02 / A-19: Mantener la pantalla encendida ÚNICAMENTE mientras se graba en marcha
  // En descansos/pausa, se desactiva para refrigerar el terminal y evitar sobrecalentamiento al sol
  useEffect(() => {
    if (trackerState.status === 'recording') {
      activateKeepAwakeAsync('mototrack-ride');
    } else {
      deactivateKeepAwake('mototrack-ride');
    }
    return () => {
      deactivateKeepAwake('mototrack-ride');
    };
  }, [trackerState.status]);

  // Suscribirse a las actualizaciones del servicio de rastreo
  useEffect(() => {
    let isMounted = true;
    restoreActiveSession().then((restored) => {
      if (!isMounted) return;
      if (restored && restored.status === 'finished') {
        setCompletedRideData(restored);
        setIsFinishModalVisible(true);
      }
    });

    const unsubscribe = subscribeToTracker((newState) => {
      if (!isFocusedRef.current) {
        pendingStateRef.current = newState;
        return; // EXT-03: Evitar clonar y re-renderizar la UI si el usuario está en otra pestaña
      }
      setTrackerState(newState);

      const lastPoint = newState.points[newState.points.length - 1];
      if (lastPoint) {
        setCurrentCoord({
          latitude: lastPoint.latitude,
          longitude: lastPoint.longitude,
        });
      }
    });

    // Obtención rápida de posición inicial
    Location.requestForegroundPermissionsAsync().then(async ({ status }) => {
      if (!isMounted) return;
      if (status === 'granted') {
        try {
          const lastKnown = await Location.getLastKnownPositionAsync();
          if (!isMounted) return;
          if (lastKnown) {
            const coord = {
              latitude: lastKnown.coords.latitude,
              longitude: lastKnown.coords.longitude,
            };
            setCurrentCoord(coord);
            mapRef.current?.recenter(coord.latitude, coord.longitude, 15);
          }

          const currentPos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          if (!isMounted) return;
          const freshCoord = {
            latitude: currentPos.coords.latitude,
            longitude: currentPos.coords.longitude,
          };
          setCurrentCoord(freshCoord);
          mapRef.current?.recenter(freshCoord.latitude, freshCoord.longitude, 16);
        } catch (posErr) {
          console.warn('Error al fijar posición inicial de GPS:', posErr);
        }
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  // Alternar modos de mapa (Oscuro -> Estándar -> Satélite)
  const toggleMapMode = useCallback(() => {
    setMapMode((prev) => (prev === 'dark' ? 'standard' : prev === 'standard' ? 'hybrid' : 'dark'));
  }, []);

  // Re-centrar el mapa
  const handleRecenter = useCallback(() => {
    if (currentCoord && mapRef.current) {
      mapRef.current.recenter(currentCoord.latitude, currentCoord.longitude, 16);
    }
  }, [currentCoord]);

  // Iniciar ruta
  const handleStart = useCallback(async () => {
    const res = await startTracking();
    if (!res.success && res.error) {
      Alert.alert('Aviso de Permisos GPS', res.error);
    }
  }, []);

  // Pausar ruta (para descansos, paradas de repostaje o fotos)
  const handlePause = useCallback(async () => {
    await pauseTracking();
    Alert.alert(
      '☕ Ruta en Pausa',
      'Modo descanso activado. La distancia y el tiempo rodando quedan congelados mientras descansas. Pulsa "REANUDAR" cuando vayas a continuar.',
      [{ text: 'Entendido' }]
    );
  }, []);

  // Reanudar ruta
  const handleResume = useCallback(async () => {
    await resumeTracking();
  }, []);

  // Pulsar Finalizar
  const handleFinishPress = useCallback(async () => {
    const finalData = await stopTracking();

    if (finalData.points.length === 0 && finalData.metrics.totalDistanceKm === 0) {
      await discardOrFinalizeActiveRide();
      Alert.alert(
        'Ruta sin movimiento',
        'No se registraron coordenadas suficientes durante esta salida.',
        [{ text: 'Aceptar' }]
      );
      return;
    }

    setCompletedRideData(finalData);
    setIsFinishModalVisible(true);
  }, []);

  // Callback al guardar la ruta
  const handleRideSaved = async (savedRide: RideSession) => {
    setIsFinishModalVisible(false);
    setCompletedRideData(null);
    await discardOrFinalizeActiveRide();
    Alert.alert(
      `¡Ruta Guardada, ${riderNickname}!`,
      `"${savedRide.name}" se ha almacenado en tu historial. ¿Quieres generar la tarjeta 9:16 para compartirla?`,
      [
        { text: 'Más tarde', style: 'cancel' },
        {
          text: 'Compartir Tarjeta',
          onPress: () => setSavedRideForShare(savedRide),
        },
      ]
    );
  };

  // Descartar ruta
  const handleDiscardRide = async () => {
    setIsFinishModalVisible(false);
    setCompletedRideData(null);
    await discardOrFinalizeActiveRide();
  };

  const { status, metrics, points } = trackerState;

  return (
    <View style={styles.container}>
      {/* 1. Mapa interactivo de fondo completo (MotorcycleMap - OpenStreetMap / Leaflet) */}
      <MotorcycleMap
        ref={mapRef}
        currentCoord={currentCoord}
        points={points}
        mapMode={mapMode}
        isRecording={status === 'recording'}
      />

      {/* Botones de control del mapa en el lateral derecho (o inferior izquierdo en landscape) */}
      <View style={isLandscape ? styles.mapSideControlsLandscape : styles.mapSideControls}>
        {/* Selector de modo de mapa (Oscuro / Estándar / Satélite) */}
        <Pressable
          onPress={toggleMapMode}
          style={({ pressed }) => [
            styles.sideButton,
            pressed && styles.sideButtonPressed,
          ]}>
          <Layers size={22} color={MotoColors.primary} />
          <Text style={styles.sideButtonSubText}>
            {mapMode === 'dark' ? 'Oscuro' : mapMode === 'standard' ? 'Estándar' : 'Satélite'}
          </Text>
        </Pressable>

        {/* Botón para re-centrar el mapa */}
        <Pressable
          onPress={handleRecenter}
          style={({ pressed }) => [
            styles.sideButton,
            pressed && styles.sideButtonPressed,
          ]}>
          <Crosshair size={24} color={MotoColors.text} />
        </Pressable>
      </View>

      {/* 2. Panel HUD superior con saludo personalizado y métricas */}
      <View style={isLandscape ? styles.hudOverlayLandscape : styles.hudOverlay} pointerEvents="box-none">
        {/* Barra superior interactiva de bienvenida y perfil de piloto */}
        <Pressable
          onPress={() => setIsProfileModalVisible(true)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={({ pressed }) => [
            styles.riderBar,
            pressed && styles.riderBarPressed,
          ]}>
          <View style={styles.riderChipRow}>
            <View style={styles.riderChip}>
              {riderPhoto ? (
                <Image source={{ uri: riderPhoto }} style={styles.riderAvatar} />
              ) : (
                <User size={16} color={MotoColors.primary} />
              )}
              <Text style={styles.riderChipText}>PILOTO: {riderNickname.toUpperCase()}</Text>
              <Edit3 size={13} color={MotoColors.primary} />
            </View>

            {activeVehicle && (
              <View style={styles.vehicleBadge}>
                <Bike size={13} color={MotoColors.primary} />
                <Text style={styles.vehicleBadgeText} numberOfLines={1}>
                  {activeVehicle.name}
                </Text>
              </View>
            )}
          </View>

          <Text style={styles.riderGreeting} numberOfLines={1}>
            {status === 'idle' && `¡Listo para rodar! 🏍️`}
            {status === 'recording' && `En marcha 🔥`}
            {status === 'paused' && `En descanso ☕`}
            {status === 'finished' && `Ruta finalizada 🏁`}
          </Text>
        </Pressable>

        {/* Banner destacado de Modo Descanso en pausa */}
        {status === 'paused' && (
          <View style={styles.restBanner}>
            <View style={styles.restIconCircle}>
              <Coffee size={20} color={MotoColors.warning} />
            </View>
            <View style={styles.restTextGroup}>
              <Text style={styles.restTitle}>MODO DESCANSO EN CURSO</Text>
              <Text style={styles.restSub}>
                Pausa: {formatTime(restSeconds)} · Kilómetros y tiempo rodando congelados
              </Text>
            </View>
          </View>
        )}

        {/* Banner de alerta por pérdida de señal GPS o cruce de túnel (EXT-03, EXT-04) */}
        {metrics.isGpsSignalLost && status === 'recording' && (
          <View style={styles.gpsWarningBanner}>
            <View style={styles.gpsWarningCircle}>
              <AlertTriangle size={18} color={MotoColors.warning} />
            </View>
            <View style={styles.gpsWarningTextGroup}>
              <Text style={styles.gpsWarningTitle}>SEÑAL GPS PERDIDA (TÚNEL)</Text>
              <Text style={styles.gpsWarningSub}>
                Sin cobertura GPS. La velocidad se reanudará automáticamente al salir.
              </Text>
            </View>
          </View>
        )}

        {/* Fila 1 del HUD: Velocidad (Prominente) y Distancia */}
        <View style={styles.metricsRow}>
          <MetricCard
            label="Velocidad"
            value={Math.round(metrics.currentSpeed)}
            unit="km/h"
            subValue={
              metrics.isGpsSignalLost && status === 'recording'
                ? '⚠️ Sin GPS / Túnel'
                : `Máx: ${Math.round(metrics.maxSpeed)}`
            }
            isProminent={true}
            accentColor={
              metrics.isGpsSignalLost && status === 'recording'
                ? MotoColors.warning
                : MotoColors.primary
            }
            icon={
              <Gauge
                size={16}
                color={
                  metrics.isGpsSignalLost && status === 'recording'
                    ? MotoColors.warning
                    : MotoColors.primary
                }
              />
            }
          />

          <MetricCard
            label="Distancia"
            value={metrics.totalDistanceKm.toFixed(2)}
            unit="km"
            subValue={`Med: ${metrics.avgSpeed.toFixed(1)} km/h`}
            accentColor={MotoColors.lime}
            icon={<Route size={16} color={MotoColors.lime} />}
          />
        </View>

        {/* Fila 2 del HUD: Tiempo rodando y Altitud/Desnivel */}
        <View style={styles.metricsRow}>
          <MetricCard
            label="Tiempo Rodando"
            value={formatTime(metrics.movingDurationSeconds)}
            subValue={
              status === 'paused'
                ? `PAUSADO (${formatTime(restSeconds)})`
                : `Total: ${formatTime(metrics.totalDurationSeconds)}`
            }
            accentColor={status === 'paused' ? MotoColors.warning : MotoColors.lime}
            icon={<Timer size={16} color={status === 'paused' ? MotoColors.warning : MotoColors.lime} />}
          />

          <MetricCard
            label="Altitud"
            value={metrics.currentAltitude !== null ? metrics.currentAltitude : '--'}
            unit="m"
            subValue={`+${metrics.elevationGainMeters} m`}
            accentColor={MotoColors.cyan}
            icon={<Mountain size={16} color={MotoColors.cyan} />}
          />
        </View>
      </View>

      {/* 3. Botones Flotantes Glove-Friendly (Área táctil de 68px de alto para guantes) */}
      <View style={isLandscape ? styles.controlBarLandscape : styles.controlBar} pointerEvents="box-none">
        {status === 'idle' && (
          <Pressable
            onPress={handleStart}
            style={({ pressed }) => [
              styles.actionButton,
              styles.startButton,
              pressed && styles.startButtonPressed,
            ]}>
            <Play size={32} color="#0B0E14" fill="#0B0E14" />
            <Text style={[styles.actionButtonText, { color: '#0B0E14' }]}>INICIAR RUTA</Text>
          </Pressable>
        )}

        {status === 'recording' && (
          <View style={styles.dualButtonsRow}>
            {/* Botón Pausar (para descanso o repostaje) */}
            <Pressable
              onPress={handlePause}
              style={({ pressed }) => [
                styles.actionButton,
                styles.pauseButton,
                pressed && styles.pauseButtonPressed,
              ]}>
              <Pause size={28} color="#0B0E14" fill="#0B0E14" />
              <Text style={[styles.actionButtonText, { color: '#0B0E14' }]}>PAUSAR</Text>
            </Pressable>

            {/* Botón Finalizar */}
            <Pressable
              onPress={handleFinishPress}
              style={({ pressed }) => [
                styles.actionButton,
                styles.finishButton,
                pressed && styles.finishButtonPressed,
              ]}>
              <Square size={26} color="#FFFFFF" fill="#FFFFFF" />
              <Text style={styles.actionButtonText}>FINALIZAR</Text>
            </Pressable>
          </View>
        )}

        {status === 'paused' && (
          <View style={styles.dualButtonsRow}>
            {/* Botón Reanudar Marcha */}
            <Pressable
              onPress={handleResume}
              style={({ pressed }) => [
                styles.actionButton,
                styles.resumeButton,
                pressed && styles.resumeButtonPressed,
              ]}>
              <Play size={28} color="#0B0E14" fill="#0B0E14" />
              <Text style={[styles.actionButtonText, { color: '#0B0E14' }]}>REANUDAR</Text>
            </Pressable>

            {/* Botón Finalizar */}
            <Pressable
              onPress={handleFinishPress}
              style={({ pressed }) => [
                styles.actionButton,
                styles.finishButton,
                pressed && styles.finishButtonPressed,
              ]}>
              <Square size={26} color="#FFFFFF" fill="#FFFFFF" />
              <Text style={styles.actionButtonText}>FINALIZAR</Text>
            </Pressable>
          </View>
        )}

        {status === 'finished' && (
          <Pressable
            onPress={() => {
              setCompletedRideData(trackerState);
              setIsFinishModalVisible(true);
            }}
            style={({ pressed }) => [
              styles.actionButton,
              styles.finishButton,
              pressed && styles.finishButtonPressed,
            ]}>
            <Square size={26} color="#FFFFFF" fill="#FFFFFF" />
            <Text style={styles.actionButtonText}>VER RESUMEN / GUARDAR</Text>
          </Pressable>
        )}
      </View>

      {/* Modal para cambiar Apodo, Foto y Vehículos (Mi Garaje) */}
      <RiderProfileModal
        visible={isProfileModalVisible}
        currentNickname={riderNickname}
        currentPhotoUri={riderPhoto}
        onClose={() => setIsProfileModalVisible(false)}
        onSave={(newNickname, newPhoto) => {
          setRiderNickname(newNickname);
          setRiderPhoto(newPhoto);
        }}
        onVehicleChanged={(newVeh) => {
          setActiveVehicle(newVeh);
        }}
      />

      {/* Modal de Finalización y Calificación */}
      <FinishRideModal
        visible={isFinishModalVisible}
        rideData={completedRideData}
        onSaveSuccess={handleRideSaved}
        onDiscard={handleDiscardRide}
      />

      {/* Modal de Compartir Tarjeta 9:16 */}
      <ShareCardModal
        visible={savedRideForShare !== null}
        ride={savedRideForShare}
        onClose={() => setSavedRideForShare(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: MotoColors.background,
  },
  // Controles laterales del mapa
  mapSideControls: {
    position: 'absolute',
    right: 18,
    bottom: 120,
    gap: 10,
  },
  mapSideControlsLandscape: {
    position: 'absolute',
    right: 14,
    top: 10,
    gap: 10,
    flexDirection: 'row',
  },
  sideButton: {
    width: 54,
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: 'rgba(22, 27, 38, 0.95)',
    borderColor: MotoColors.border,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 5,
  },
  sideButtonPressed: {
    backgroundColor: MotoColors.surfaceElevated,
    transform: [{ scale: 0.94 }],
  },
  sideButtonSubText: {
    color: MotoColors.textSecondary,
    fontSize: 9,
    fontWeight: '800',
    marginTop: 2,
    textTransform: 'uppercase',
  },
  // Panel HUD superior superpuesto
  hudOverlay: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 16,
    left: 14,
    right: 14,
    gap: 8,
  },
  hudOverlayLandscape: {
    position: 'absolute',
    top: 10,
    left: 14,
    width: 350,
    gap: 6,
  },
  riderBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(22, 27, 38, 0.96)',
    borderColor: MotoColors.border,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 54,
    borderRadius: 16,
    gap: 10,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
  },
  riderBarPressed: {
    backgroundColor: '#1C2433',
    borderColor: MotoColors.primary,
    transform: [{ scale: 0.99 }],
  },
  riderChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  riderChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#101622',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: 'rgba(0, 240, 255, 0.55)',
  },
  vehicleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0, 240, 255, 0.12)',
    borderColor: 'rgba(0, 240, 255, 0.35)',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  vehicleBadgeText: {
    color: MotoColors.primary,
    fontSize: 11,
    fontWeight: '800',
    maxWidth: 130,
  },
  riderAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: MotoColors.primary,
  },
  riderChipPressed: {
    backgroundColor: '#1F2637',
  },
  riderChipText: {
    color: MotoColors.primary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  riderGreeting: {
    flex: 1,
    color: MotoColors.text,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
  },
  // Banner de descanso en pausa
  restBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(20, 28, 46, 0.95)',
    borderColor: MotoColors.warning,
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    elevation: 4,
    shadowColor: MotoColors.warning,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
  },
  restIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: MotoColors.warning,
  },
  restTextGroup: {
    flex: 1,
  },
  restTitle: {
    color: MotoColors.warning,
    fontSize: 11.5,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  restSub: {
    color: MotoColors.textSecondary,
    fontSize: 10.5,
    fontWeight: '700',
    marginTop: 2,
  },
  // Banner de alerta GPS / Túnel
  gpsWarningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(30, 24, 16, 0.95)',
    borderColor: MotoColors.warning,
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    elevation: 4,
    shadowColor: MotoColors.warning,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
  },
  gpsWarningCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(245, 158, 11, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: MotoColors.warning,
  },
  gpsWarningTextGroup: {
    flex: 1,
  },
  gpsWarningTitle: {
    color: MotoColors.warning,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  gpsWarningSub: {
    color: MotoColors.textSecondary,
    fontSize: 9.5,
    fontWeight: '600',
    marginTop: 1,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  // Barra de Controles para Guantes (Glove-Friendly)
  controlBar: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    right: 16,
  },
  controlBarLandscape: {
    position: 'absolute',
    bottom: 12,
    right: 14,
    width: 300,
  },
  dualButtonsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    minHeight: 68,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 20,
    elevation: 6,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  startButton: {
    backgroundColor: MotoColors.success,
    shadowColor: MotoColors.success,
  },
  startButtonPressed: {
    backgroundColor: MotoColors.successDark,
    transform: [{ scale: 0.98 }],
  },
  pauseButton: {
    flex: 1,
    backgroundColor: MotoColors.warning,
    shadowColor: MotoColors.warning,
  },
  pauseButtonPressed: {
    backgroundColor: MotoColors.warningDark,
    transform: [{ scale: 0.98 }],
  },
  resumeButton: {
    flex: 1,
    backgroundColor: MotoColors.success,
    shadowColor: MotoColors.success,
  },
  resumeButtonPressed: {
    backgroundColor: MotoColors.successDark,
    transform: [{ scale: 0.98 }],
  },
  finishButton: {
    flex: 1,
    backgroundColor: MotoColors.danger,
    shadowColor: MotoColors.danger,
  },
  finishButtonPressed: {
    backgroundColor: MotoColors.dangerDark,
    transform: [{ scale: 0.98 }],
  },
});
