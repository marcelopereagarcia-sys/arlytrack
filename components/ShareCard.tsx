/**
 * Componente Tarjeta Resumen Compartible (ShareCard) para MotoTrack.
 * Formato vertical 9:16 de alta resolución para Instagram Stories, WhatsApp y redes sociales.
 * Incluye cabecera de piloto, selector de fondo (Estándar OpenStreetMap / Satélite Esri / Oscuro / Foto de Galería),
 * trazado de ruta en neón naranja, telemetría 2x2, valoración por estrellas y compartición nativa fiable.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import {
  Calendar,
  Camera,
  Coins,
  Fuel,
  Gauge,
  Image as ImageIcon,
  Layers,
  Mountain,
  Navigation,
  Route,
  Share2,
  Star,
  Timer,
  User,
  X,
} from 'lucide-react-native';
import { MotoColors } from '@/constants/Colors';
import { RideSession } from '@/types/ride';
import { getUserNickname, getUserProfilePhoto, updateRidePhoto } from '@/services/storage';
import { RouteMapMode, RouteVectorMap } from './RouteVectorMap';

interface ShareCardModalProps {
  visible: boolean;
  ride: RideSession | null;
  onClose: () => void;
}

function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hrs > 0) {
    return `${hrs}h ${mins.toString().padStart(2, '0')}m`;
  }
  return `${mins}m`;
}

function formatDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return 'Ruta en moto';
  }
}

export function ShareCardModal({ visible, ride, onClose }: ShareCardModalProps) {
  const cardRef = useRef<View>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [riderName, setRiderName] = useState('Piloto');
  const [riderPhoto, setRiderPhoto] = useState<string | null>(null);
  // Modo por defecto estándar para ver todas las calles, curvas y carreteras a todo color
  const [cardMapMode, setCardMapMode] = useState<RouteMapMode>('standard');
  const [customPhotoUri, setCustomPhotoUri] = useState<string | null>(ride?.photoUri ?? null);
  const [tilesReady, setTilesReady] = useState(false);
  const tilesReadyRef = useRef(false);

  useEffect(() => {
    tilesReadyRef.current = false;
    setTilesReady(false);
  }, [cardMapMode, customPhotoUri]);

  useEffect(() => {
    if (visible) {
      getUserNickname().then(setRiderName);
      getUserProfilePhoto().then(setRiderPhoto);
      if (ride?.photoUri) {
        setCustomPhotoUri(ride.photoUri);
      }
    }
  }, [visible, ride]);

  if (!ride) return null;

  // Seleccionar foto del paisaje o la moto desde la galería del teléfono
  const handlePickCustomPhoto = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permiso necesario',
          'Se necesita acceso a la galería para seleccionar una foto de tu salida en moto.'
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.9,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const sourceUri = result.assets[0].uri;
        let finalUri = sourceUri;
        if (FileSystem.documentDirectory) {
          try {
            const filename = `ride_photo_${Date.now()}.jpg`;
            const targetUri = `${FileSystem.documentDirectory}${filename}`;
            await FileSystem.copyAsync({ from: sourceUri, to: targetUri });
            finalUri = targetUri;
          } catch (copyErr) {
            console.warn('No se pudo copiar foto de ruta a documentDirectory:', copyErr);
          }
        }
        const previousPhotoUri = customPhotoUri;
        setCustomPhotoUri(finalUri);
        setCardMapMode('custom_photo');
        if (ride) {
          ride.photoUri = finalUri;
          updateRidePhoto(ride.id, finalUri).catch((err) =>
            console.warn('Error al actualizar foto de ruta:', err)
          );
        }
        if (
          previousPhotoUri &&
          previousPhotoUri !== finalUri &&
          FileSystem.documentDirectory &&
          previousPhotoUri.startsWith(FileSystem.documentDirectory)
        ) {
          FileSystem.deleteAsync(previousPhotoUri, { idempotent: true }).catch(() => {});
        }
      }
    } catch (err) {
      console.error('Error al abrir la galería:', err);
      Alert.alert('Error', 'No se pudo abrir la galería de imágenes.');
    }
  };

  const handleShare = async () => {
    if (!cardRef.current) return;

    try {
      setIsSharing(true);

      // A-20: Esperar a que las teselas del mapa o foto estén cargadas (máx 4 s de seguridad).
      // Ambos temporizadores se limpian en el finally: si vence el plazo de seguridad sin que
      // las teselas carguen (típico sin cobertura), el sondeo no debe quedar vivo indefinidamente.
      if (!tilesReadyRef.current) {
        let pollTimer: ReturnType<typeof setInterval> | undefined;
        let safetyTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          await new Promise<void>((resolve) => {
            pollTimer = setInterval(() => {
              if (tilesReadyRef.current) resolve();
            }, 100);
            safetyTimer = setTimeout(resolve, 4000);
          });
        } finally {
          clearInterval(pollTimer);
          clearTimeout(safetyTimer);
        }
      }
      // Breve pausa para asegurar el render final en el hilo de composición
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Captura en PNG de alta resolución
      const uri = await captureRef(cardRef, {
        format: 'png',
        quality: 0.98,
        result: 'tmpfile',
      });

      // Asegurar formato file:// indispensable para Android FileProvider
      const fileUri = uri.startsWith('file://') ? uri : `file://${uri}`;

      const isAvailable = await Sharing.isAvailableAsync();
      if (isAvailable) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'image/png',
          dialogTitle: `Ruta de ${riderName} - ArlyTrack`,
          UTI: 'public.png',
        });
      } else {
        Alert.alert(
          'Función no disponible',
          'La opción nativa de compartir no se encuentra disponible en este dispositivo.'
        );
      }
    } catch (error) {
      console.error('Error al capturar y compartir la tarjeta:', error);
      Alert.alert('Error', 'No se pudo generar la imagen para compartir. Inténtalo de nuevo.');
    } finally {
      setIsSharing(false);
    }
  };

  const mapAreaWidth = cardWidth - 32;
  const mapAreaHeight = Math.round(cardHeight * 0.38);

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <View style={styles.container}>
        {/* Barra superior modal */}
        <View style={styles.topBar}>
          <Text style={styles.topBarTitle}>Tarjeta para Redes (9:16)</Text>
          <Pressable onPress={onClose} hitSlop={12} style={styles.closeButton}>
            <X size={24} color={MotoColors.text} />
          </Pressable>
        </View>

        {/* Selector de modo de fondo (Estándar / Satélite / Oscuro / Foto Galería) */}
        <View style={styles.mapSelectorBar}>
          <View style={styles.mapSelectorTitleGroup}>
            <Layers size={13} color={MotoColors.primary} />
            <Text style={styles.mapSelectorLabel}>FONDO:</Text>
          </View>
          <View style={styles.mapSelectorTabs}>
            <Pressable
              onPress={() => setCardMapMode('standard')}
              style={[
                styles.mapTab,
                cardMapMode === 'standard' && styles.mapTabActive,
              ]}>
              <Text
                style={[
                  styles.mapTabText,
                  cardMapMode === 'standard' && styles.mapTabTextActive,
                ]}>
                Estándar
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setCardMapMode('satellite')}
              style={[
                styles.mapTab,
                cardMapMode === 'satellite' && styles.mapTabActive,
              ]}>
              <Text
                style={[
                  styles.mapTabText,
                  cardMapMode === 'satellite' && styles.mapTabTextActive,
                ]}>
                Satélite
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setCardMapMode('dark')}
              style={[
                styles.mapTab,
                cardMapMode === 'dark' && styles.mapTabActive,
              ]}>
              <Text
                style={[
                  styles.mapTabText,
                  cardMapMode === 'dark' && styles.mapTabTextActive,
                ]}>
                Oscuro
              </Text>
            </Pressable>

            {/* Pestaña para foto personalizada */}
            <Pressable
              onPress={() => {
                if (!customPhotoUri) {
                  handlePickCustomPhoto();
                } else {
                  setCardMapMode('custom_photo');
                }
              }}
              style={[
                styles.mapTab,
                cardMapMode === 'custom_photo' && styles.mapTabActive,
              ]}>
              <View style={styles.photoTabInner}>
                <Camera
                  size={11}
                  color={cardMapMode === 'custom_photo' ? '#FFFFFF' : MotoColors.textSecondary}
                />
                <Text
                  style={[
                    styles.mapTabText,
                    cardMapMode === 'custom_photo' && styles.mapTabTextActive,
                  ]}>
                  Foto
                </Text>
              </View>
            </Pressable>
          </View>
        </View>

        {/* Botón flotante para cambiar foto cuando está en modo foto */}
        {cardMapMode === 'custom_photo' && (
          <View style={styles.photoEditBar}>
            <Pressable onPress={handlePickCustomPhoto} style={styles.changePhotoBtn}>
              <ImageIcon size={13} color={MotoColors.primary} />
              <Text style={styles.changePhotoBtnText}>
                {customPhotoUri ? 'Cambiar foto de paisaje / moto' : 'Seleccionar foto de galería'}
              </Text>
            </Pressable>
          </View>
        )}

        <ScrollView
          contentContainerStyle={styles.scrollContainer}
          showsVerticalScrollIndicator={false}>
          {/* Tarjeta 9:16 capturable */}
          <View
            ref={cardRef}
            collapsable={false}
            style={styles.cardWrapper}>
            {/* 1. Cabecera con marca y piloto */}
            <View style={styles.cardHeader}>
              <View style={styles.brandingRow}>
                <View style={styles.brandBadge}>
                  <Image
                    source={require('@/assets/images/icon.png')}
                    style={styles.brandLogoImg}
                  />
                  <Text style={styles.brandName}>ARLYTRACK</Text>
                  <View style={styles.brandDot} />
                  <Text style={styles.brandTelemetry}>GPS</Text>
                </View>

                {/* Badge con el Apodo y Foto del Piloto */}
                <View style={styles.riderBadge}>
                  {riderPhoto ? (
                    <Image source={{ uri: riderPhoto }} style={styles.riderBadgePhoto} />
                  ) : (
                    <User size={12} color={MotoColors.primary} />
                  )}
                  <Text style={styles.riderText}>PILOTO: {riderName.toUpperCase()}</Text>
                </View>
              </View>

              {/* Mensaje y Título */}
              <Text style={styles.personalGreeting}>
                ¡Esta fue tu ruta, {riderName}! 🏁
              </Text>
              <Text style={styles.rideTitle} numberOfLines={2}>
                {ride.name}
              </Text>
              <View style={styles.dateRow}>
                <Calendar size={12} color={MotoColors.textMuted} />
                <Text style={styles.rideDate}>{formatDate(ride.date)}</Text>
              </View>
            </View>

            {/* 2. Trazado sobre Mapa Real o Foto de Galería */}
            <View style={styles.mapContainer}>
              <RouteVectorMap
                points={ride.points}
                width={mapAreaWidth}
                height={mapAreaHeight}
                mapMode={cardMapMode}
                customPhotoUri={customPhotoUri}
                strokeColor={MotoColors.primary}
                strokeWidth={5}
                onTilesReady={() => {
                  tilesReadyRef.current = true;
                  setTilesReady(true);
                }}
              />
            </View>

            {/* 3. Panel de Telemetría (Grid 2x2 Simétrico) */}
            <View style={styles.metricsContainer}>
              {/* Fila 1: Distancia y Tiempo */}
              <View style={styles.metricsRow}>
                <View style={styles.metricItem}>
                  <View style={styles.metricHeader}>
                    <Route size={14} color={MotoColors.primary} />
                    <Text style={styles.metricLabel}>DISTANCIA</Text>
                  </View>
                  <Text style={styles.metricValue}>
                    {ride.totalDistanceKm.toFixed(1)}{' '}
                    <Text style={styles.metricUnit}>km</Text>
                  </Text>
                </View>

                <View style={styles.metricItem}>
                  <View style={styles.metricHeader}>
                    <Timer size={14} color={MotoColors.lime} />
                    <Text style={styles.metricLabel}>RODANDO</Text>
                  </View>
                  <Text style={styles.metricValue}>
                    {formatDuration(ride.movingDurationSeconds)}
                  </Text>
                </View>
              </View>

              {/* Fila 2: Desnivel y Velocidad Máxima */}
              <View style={styles.metricsRow}>
                <View style={styles.metricItem}>
                  <View style={styles.metricHeader}>
                    <Mountain size={14} color={MotoColors.cyan} />
                    <Text style={styles.metricLabel}>DESNIVEL +</Text>
                  </View>
                  <Text style={styles.metricValue}>
                    +{ride.elevationGainMeters}{' '}
                    <Text style={styles.metricUnit}>m</Text>
                  </Text>
                </View>

                <View style={styles.metricItem}>
                  <View style={styles.metricHeader}>
                    <Gauge size={14} color={MotoColors.recording} />
                    <Text style={styles.metricLabel}>VEL. MÁXIMA</Text>
                  </View>
                  <Text style={styles.metricValue}>
                    {Math.round(ride.maxSpeedKmh)}{' '}
                    <Text style={styles.metricUnit}>km/h</Text>
                  </Text>
                </View>
              </View>
            </View>

            {/* 4. Telemetría de Combustible */}
            <View style={styles.fuelBadgeRow}>
              <View style={styles.fuelBadge}>
                <Fuel size={12} color={MotoColors.warning} />
                <Text style={styles.fuelBadgeText}>
                  {(ride.fuelConsumedLiters ?? Math.round(((ride.totalDistanceKm * 4.5) / 100) * 10) / 10).toFixed(1)} L GASOLINA
                </Text>
              </View>
              <View style={styles.fuelBadge}>
                <Coins size={12} color={MotoColors.lime} />
                <Text style={styles.fuelBadgeCostText}>
                  ~{(ride.fuelCostEstimate ?? Math.round((ride.fuelConsumedLiters ?? ((ride.totalDistanceKm * 4.5) / 100)) * 1.65 * 100) / 100).toFixed(2)} €
                </Text>
              </View>
            </View>

            {/* 5. Valoración por estrellas en pastilla */}
            <View style={styles.ratingRow}>
              <Text style={styles.ratingRowLabel}>Sensaciones de ruta:</Text>
              <View style={styles.starsContainer}>
                {[1, 2, 3, 4, 5].map((s) => (
                  <Star
                    key={s}
                    size={17}
                    color={s <= ride.ratings.overall ? MotoColors.star : '#2D3748'}
                    fill={s <= ride.ratings.overall ? MotoColors.star : 'transparent'}
                  />
                ))}
              </View>
            </View>

            {/* 5. Pie de tarjeta / Marca de agua */}
            <View style={styles.cardFooter}>
              <Text style={styles.footerText}>
                ArlyTrack · Telemetría GPS Offline para Motociclistas
              </Text>
            </View>
          </View>

          {/* Botón de Compartir Nativo (Área táctil > 64px para guantes) */}
          <Pressable
            onPress={handleShare}
            disabled={isSharing}
            style={({ pressed }) => [
              styles.shareButton,
              pressed && styles.shareButtonPressed,
              isSharing && { opacity: 0.75 },
            ]}>
            {isSharing ? (
              <ActivityIndicator color="#0B0E14" size="small" />
            ) : (
              <>
                <Share2 size={24} color="#0B0E14" />
                <Text style={styles.shareButtonText}>COMPARTIR RUTA EN REDES</Text>
              </>
            )}
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

const windowWidth = Dimensions.get('window').width;
const cardWidth = Math.min(windowWidth - 32, 360);
const cardHeight = Math.round((cardWidth * 16) / 9);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: MotoColors.background,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 56 : 20,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: MotoColors.border,
  },
  topBarTitle: {
    color: MotoColors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  closeButton: {
    padding: 6,
    borderRadius: 10,
    backgroundColor: MotoColors.surface,
  },
  // Barra de selección de modo de mapa
  mapSelectorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#0E1524',
    borderBottomWidth: 1,
    borderBottomColor: MotoColors.border,
  },
  mapSelectorTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  mapSelectorLabel: {
    color: MotoColors.textSecondary,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  mapSelectorTabs: {
    flexDirection: 'row',
    backgroundColor: '#161B26',
    borderRadius: 10,
    padding: 3,
    gap: 3,
    borderWidth: 1,
    borderColor: MotoColors.border,
  },
  mapTab: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 7,
  },
  mapTabActive: {
    backgroundColor: MotoColors.primary,
  },
  mapTabText: {
    color: MotoColors.textSecondary,
    fontSize: 10.5,
    fontWeight: '700',
  },
  mapTabTextActive: {
    color: '#0B0E14',
    fontWeight: '900',
  },
  photoTabInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  photoEditBar: {
    alignItems: 'center',
    paddingVertical: 6,
    backgroundColor: 'rgba(0, 240, 255, 0.08)',
  },
  changePhotoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: '#161B26',
    borderWidth: 1,
    borderColor: MotoColors.primary,
  },
  changePhotoBtnText: {
    color: MotoColors.primary,
    fontSize: 11,
    fontWeight: '800',
  },
  scrollContainer: {
    alignItems: 'center',
    paddingVertical: 14,
    paddingBottom: 36,
  },
  // Contenedor tarjeta proporción exacta 9:16
  cardWrapper: {
    width: cardWidth,
    height: cardHeight,
    backgroundColor: '#0B0E14',
    borderRadius: 22,
    borderColor: MotoColors.border,
    borderWidth: 2,
    padding: 16,
    justifyContent: 'space-between',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 18,
    elevation: 10,
  },
  cardHeader: {
    gap: 3,
  },
  brandingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  brandBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0, 240, 255, 0.12)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: 'rgba(0, 240, 255, 0.35)',
  },
  brandLogoImg: {
    width: 16,
    height: 16,
    borderRadius: 3,
  },
  brandName: {
    color: MotoColors.primary,
    fontSize: 10.5,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  brandDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: MotoColors.primary,
  },
  brandTelemetry: {
    color: '#CBD5E1',
    fontSize: 8.5,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  riderBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: MotoColors.surface,
    borderColor: MotoColors.border,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 7,
  },
  riderBadgePhoto: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: MotoColors.primary,
  },
  riderText: {
    color: MotoColors.text,
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  personalGreeting: {
    color: MotoColors.primary,
    fontSize: 12,
    fontWeight: '800',
  },
  rideTitle: {
    color: MotoColors.text,
    fontSize: 18,
    fontWeight: '900',
    lineHeight: 22,
    letterSpacing: -0.3,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  rideDate: {
    color: MotoColors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  // Trazado de mapa central
  mapContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: MotoColors.border,
    marginVertical: 2,
  },
  // Panel de telemetría 2x2
  metricsContainer: {
    gap: 7,
    marginVertical: 2,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  metricItem: {
    flex: 1,
    backgroundColor: '#161B26',
    borderColor: '#263044',
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 7,
    justifyContent: 'center',
  },
  metricHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 1,
  },
  metricLabel: {
    color: MotoColors.textSecondary,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  metricValue: {
    color: MotoColors.text,
    fontSize: 17,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  metricUnit: {
    fontSize: 11.5,
    color: MotoColors.textSecondary,
    fontWeight: '700',
  },
  fuelBadgeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  fuelBadge: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#161B26',
    borderColor: '#263044',
    borderWidth: 1,
    borderRadius: 9,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  fuelBadgeText: {
    color: MotoColors.text,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  fuelBadgeCostText: {
    color: MotoColors.lime,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#161B26',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderColor: '#263044',
    borderWidth: 1,
  },
  ratingRowLabel: {
    color: MotoColors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
  },
  starsContainer: {
    flexDirection: 'row',
    gap: 3,
  },
  cardFooter: {
    alignItems: 'center',
  },
  footerText: {
    color: MotoColors.textMuted,
    fontSize: 8.5,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  // Botón de compartir nativo
  shareButton: {
    backgroundColor: MotoColors.primary,
    width: cardWidth,
    minHeight: 62,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 14,
    elevation: 6,
    shadowColor: MotoColors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
  },
  shareButtonPressed: {
    backgroundColor: MotoColors.primaryHover,
    transform: [{ scale: 0.98 }],
  },
  shareButtonText: {
    color: '#0B0E14',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
});
