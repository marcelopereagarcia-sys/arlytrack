/**
 * Modal de detalle interactivo para una ruta del historial en MotoTrack.
 * Muestra el mapa navegable con el trazado completo, desglose detallado de estadísticas,
 * valoraciones individuales y acceso directo a la tarjeta compartible 9:16.
 */

import React, { useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  ArrowLeft,
  Bike,
  Coins,
  Compass,
  Download,
  Fuel,
  Gauge,
  MapPin,
  Maximize2,
  Mountain,
  Play,
  Route,
  Share2,
  Timer,
  Trash2,
} from 'lucide-react-native';
import { MotoColors } from '@/constants/Colors';
import { RideSession } from '@/types/ride';
import { StarRating } from './StarRating';
import { exportAndShareGpx } from '@/utils/gpx';
import { ShareCardModal } from './ShareCard';
import { MotorcycleMap } from './MotorcycleMap';
import { RouteReplayModal } from './RouteReplayModal';

interface RideDetailModalProps {
  visible: boolean;
  ride: RideSession | null;
  onClose: () => void;
  onDelete: (id: string) => void;
}

function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) {
    return `${hrs}h ${mins.toString().padStart(2, '0')}m`;
  }
  return `${mins}m ${secs.toString().padStart(2, '0')}s`;
}

function formatDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString('es-ES', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return 'Fecha no disponible';
  }
}

export function RideDetailModal({
  visible,
  ride,
  onClose,
  onDelete,
}: RideDetailModalProps) {
  const [showShareModal, setShowShareModal] = useState(false);
  const [showReplayModal, setShowReplayModal] = useState(false);

  if (!ride) return null;

  const points = ride.points;
  const hasPoints = points.length > 0;

  const handleShareWhatsApp = async () => {
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
      console.error('Error al compartir por WhatsApp:', err);
    }
  };

  const handleExportGpx = async () => {
    const success = await exportAndShareGpx(ride);
    if (!success) {
      Alert.alert('Exportación GPX', 'No se pudo generar o compartir el archivo GPX en este dispositivo.');
    }
  };

  const handleDeletePress = () => {
    Alert.alert(
      '¿Eliminar esta ruta?',
      `Se borrará permanentemente "${ride.name}".`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: () => {
            onDelete(ride.id);
            onClose();
          },
        },
      ]
    );
  };

  return (
    <>
      <Modal visible={visible} animationType="slide" transparent={false}>
        <View style={styles.container}>
          {/* Cabecera */}
          <View style={styles.topBar}>
            <Pressable onPress={onClose} hitSlop={12} style={styles.backButton}>
              <ArrowLeft size={24} color={MotoColors.text} />
            </Pressable>
            <Text style={styles.topBarTitle} numberOfLines={1}>
              {ride.name}
            </Text>
            <View style={styles.topBarActions}>
              <Pressable
                onPress={handleExportGpx}
                hitSlop={10}
                style={styles.actionIconButton}>
                <Download size={20} color={MotoColors.primary} />
              </Pressable>
              <Pressable
                onPress={() => setShowShareModal(true)}
                hitSlop={10}
                style={styles.actionIconButton}>
                <Share2 size={20} color={MotoColors.primary} />
              </Pressable>
              <Pressable onPress={handleDeletePress} hitSlop={10} style={styles.deleteButton}>
                <Trash2 size={20} color={MotoColors.danger} />
              </Pressable>
            </View>
          </View>

          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}>
            {/* Mapa interactivo con ruta total y botón para explorar/recorrer */}
            <View style={styles.mapContainer}>
              {hasPoints ? (
                <>
                  <MotorcycleMap
                    points={points}
                    currentCoord={points.length > 0 ? { latitude: points[0].latitude, longitude: points[0].longitude } : null}
                    mapMode="standard"
                    fitBoundsOnLoad={true}
                  />

                  {/* Botón flotante para abrir el Replay / Explorador a Pantalla Completa */}
                  <Pressable
                    onPress={() => setShowReplayModal(true)}
                    style={({ pressed }) => [
                      styles.exploreButton,
                      pressed && styles.exploreButtonPressed,
                    ]}>
                    <Play size={15} color="#0B0E14" fill="#0B0E14" style={{ marginLeft: 2 }} />
                    <Text style={styles.exploreButtonText}>RECORRER Y EXPLORAR RUTA</Text>
                  </Pressable>
                </>
              ) : (
                <View style={styles.noMapPlaceholder}>
                  <Text style={styles.noMapText}>No hay coordenadas para esta ruta.</Text>
                </View>
              )}
            </View>

            {/* Información básica */}
            <View style={styles.infoSection}>
              <View style={styles.titleRow}>
                <Text style={styles.routeTitle}>{ride.name}</Text>
                {ride.vehicleName && (
                  <View style={styles.vehicleBadge}>
                    <Bike size={12} color={MotoColors.primary} />
                    <Text style={styles.vehicleBadgeText}>{ride.vehicleName}</Text>
                  </View>
                )}
              </View>
              <Text style={styles.routeDate}>{formatDate(ride.date)}</Text>
            </View>

            {/* Cuadrícula de Métricas completas */}
            <View style={styles.metricsGrid}>
              <View style={styles.metricCard}>
                <View style={styles.metricCardHeader}>
                  <Route size={18} color={MotoColors.primary} />
                  <Text style={styles.metricLabel}>DISTANCIA</Text>
                </View>
                <Text style={styles.metricValue}>
                  {ride.totalDistanceKm.toFixed(2)}{' '}
                  <Text style={styles.metricUnit}>km</Text>
                </Text>
              </View>

              <View style={styles.metricCard}>
                <View style={styles.metricCardHeader}>
                  <Timer size={18} color={MotoColors.success} />
                  <Text style={styles.metricLabel}>TIEMPO RODANDO</Text>
                </View>
                <Text style={styles.metricValue}>
                  {formatDuration(ride.movingDurationSeconds)}
                </Text>
              </View>

              <View style={styles.metricCard}>
                <View style={styles.metricCardHeader}>
                  <Gauge size={18} color={MotoColors.amber} />
                  <Text style={styles.metricLabel}>VELOCIDAD MEDIA</Text>
                </View>
                <Text style={styles.metricValue}>
                  {ride.avgSpeedKmh.toFixed(1)}{' '}
                  <Text style={styles.metricUnit}>km/h</Text>
                </Text>
              </View>

              <View style={styles.metricCard}>
                <View style={styles.metricCardHeader}>
                  <Gauge size={18} color={MotoColors.danger} />
                  <Text style={styles.metricLabel}>VELOCIDAD MÁXIMA</Text>
                </View>
                <Text style={styles.metricValue}>
                  {ride.maxSpeedKmh.toFixed(1)}{' '}
                  <Text style={styles.metricUnit}>km/h</Text>
                </Text>
              </View>

              <View style={styles.metricCard}>
                <View style={styles.metricCardHeader}>
                  <Mountain size={18} color={MotoColors.cyan} />
                  <Text style={styles.metricLabel}>DESNIVEL +</Text>
                </View>
                <Text style={styles.metricValue}>
                  +{ride.elevationGainMeters}{' '}
                  <Text style={styles.metricUnit}>m</Text>
                </Text>
              </View>

              <View style={styles.metricCard}>
                <View style={styles.metricCardHeader}>
                  <Mountain size={18} color={MotoColors.primary} />
                  <Text style={styles.metricLabel}>ALTITUD MÁXIMA</Text>
                </View>
                <Text style={styles.metricValue}>
                  {ride.maxAltitudeMeters}{' '}
                  <Text style={styles.metricUnit}>m</Text>
                </Text>
              </View>

              <View style={styles.metricCard}>
                <View style={styles.metricCardHeader}>
                  <Fuel size={18} color={MotoColors.warning} />
                  <Text style={styles.metricLabel}>GASOLINA GASTADA</Text>
                </View>
                <Text style={styles.metricValue}>
                  {(ride.fuelConsumedLiters ?? Math.round(((ride.totalDistanceKm * 4.5) / 100) * 10) / 10).toFixed(1)}{' '}
                  <Text style={styles.metricUnit}>L</Text>
                </Text>
              </View>

              <View style={styles.metricCard}>
                <View style={styles.metricCardHeader}>
                  <Coins size={18} color={MotoColors.lime} />
                  <Text style={styles.metricLabel}>COSTE ESTIMADO</Text>
                </View>
                <Text style={styles.metricValue}>
                  ~{(ride.fuelCostEstimate ?? Math.round((ride.fuelConsumedLiters ?? ((ride.totalDistanceKm * 4.5) / 100)) * 1.65 * 100) / 100).toFixed(2)}{' '}
                  <Text style={styles.metricUnit}>€</Text>
                </Text>
              </View>
            </View>

            {/* Sección de valoraciones */}
            <View style={styles.ratingsSection}>
              <Text style={styles.ratingsSectionTitle}>VALORACIONES DE LA RUTA</Text>

              <View style={styles.ratingCard}>
                <StarRating
                  label="Valoración General"
                  rating={ride.ratings.overall}
                  readonly
                  size={26}
                />
              </View>

              <View style={styles.ratingCard}>
                <StarRating
                  label="Estado del Asfalto"
                  rating={ride.ratings.roadCondition}
                  readonly
                  size={26}
                />
              </View>

              <View style={styles.ratingCard}>
                <StarRating
                  label="Nivel de Curvas y Paisaje"
                  rating={ride.ratings.sceneryCurves}
                  readonly
                  size={26}
                />
              </View>
            </View>

            {/* Opciones de Compartir: WhatsApp y Tarjeta 9:16 */}
            <View style={styles.shareButtonsContainer}>
              <Pressable
                onPress={handleShareWhatsApp}
                style={({ pressed }) => [
                  styles.whatsappShareButton,
                  pressed && styles.whatsappShareButtonPressed,
                ]}>
                <Share2 size={22} color={MotoColors.lime} />
                <Text style={styles.whatsappShareButtonText}>
                  COMPARTIR POR WHATSAPP
                </Text>
              </Pressable>

              <Pressable
                onPress={handleExportGpx}
                style={({ pressed }) => [
                  styles.gpxExportButton,
                  pressed && styles.gpxExportButtonPressed,
                ]}>
                <Download size={22} color={MotoColors.primary} />
                <Text style={styles.gpxExportButtonText}>
                  EXPORTAR GPX (GARMIN / WIKILOC)
                </Text>
              </Pressable>

              <Pressable
                onPress={() => setShowShareModal(true)}
                style={({ pressed }) => [
                  styles.shareActionButton,
                  pressed && styles.shareActionButtonPressed,
                ]}>
                <Share2 size={22} color="#FFFFFF" />
                <Text style={styles.shareActionButtonText}>
                  CREAR TARJETA PARA REDES (9:16)
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Modal de Exploración y Reproducción de Ruta (H-NAV-02: montaje perezoso para no saturar RAM con múltiples WebViews) */}
      {showReplayModal && (
        <RouteReplayModal
          visible={showReplayModal}
          ride={ride}
          onClose={() => setShowReplayModal(false)}
        />
      )}

      {/* Modal de Tarjeta Compartible 9:16 */}
      <ShareCardModal
        visible={showShareModal}
        ride={ride}
        onClose={() => setShowShareModal(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: MotoColors.background,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 56 : 24,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: MotoColors.border,
  },
  backButton: {
    padding: 8,
    borderRadius: 10,
    backgroundColor: MotoColors.surface,
  },
  topBarTitle: {
    flex: 1,
    marginHorizontal: 12,
    color: MotoColors.text,
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
  },
  topBarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionIconButton: {
    padding: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(0, 240, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(0, 240, 255, 0.35)',
  },
  deleteButton: {
    padding: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  mapContainer: {
    height: 250,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: MotoColors.border,
    marginBottom: 20,
    position: 'relative',
  },
  exploreButton: {
    position: 'absolute',
    bottom: 12,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: MotoColors.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
    elevation: 6,
    shadowColor: MotoColors.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.45,
    shadowRadius: 6,
  },
  exploreButtonPressed: {
    backgroundColor: MotoColors.primaryHover,
    transform: [{ scale: 0.96 }],
  },
  exploreButtonText: {
    color: '#0B0E14',
    fontSize: 12.5,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  map: {
    width: '100%',
    height: '100%',
  },
  noMapPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: MotoColors.surface,
  },
  noMapText: {
    color: MotoColors.textSecondary,
    fontSize: 14,
  },
  markerStart: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: MotoColors.success,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  markerEnd: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: MotoColors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  infoSection: {
    marginBottom: 20,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  routeTitle: {
    color: MotoColors.text,
    fontSize: 24,
    fontWeight: '900',
    lineHeight: 30,
    flex: 1,
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
  },
  routeDate: {
    color: MotoColors.textSecondary,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 4,
    textTransform: 'capitalize',
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 24,
  },
  metricCard: {
    width: '48%',
    backgroundColor: MotoColors.surface,
    borderColor: MotoColors.border,
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 12,
  },
  metricCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  metricLabel: {
    color: MotoColors.textSecondary,
    fontSize: 10,
    fontWeight: '700',
  },
  metricValue: {
    color: MotoColors.text,
    fontSize: 20,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  metricUnit: {
    fontSize: 12,
    color: MotoColors.textSecondary,
    fontWeight: '600',
  },
  ratingsSection: {
    marginBottom: 28,
  },
  ratingsSectionTitle: {
    color: MotoColors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  ratingCard: {
    backgroundColor: MotoColors.surface,
    borderColor: MotoColors.border,
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  shareButtonsContainer: {
    gap: 12,
    marginTop: 8,
  },
  whatsappShareButton: {
    backgroundColor: 'rgba(57, 255, 20, 0.12)',
    borderColor: 'rgba(57, 255, 20, 0.4)',
    borderWidth: 1.5,
    minHeight: 58,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  whatsappShareButtonPressed: {
    backgroundColor: 'rgba(57, 255, 20, 0.22)',
    transform: [{ scale: 0.98 }],
  },
  whatsappShareButtonText: {
    color: MotoColors.lime,
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  gpxExportButton: {
    backgroundColor: 'rgba(0, 240, 255, 0.12)',
    borderColor: 'rgba(0, 240, 255, 0.4)',
    borderWidth: 1.5,
    minHeight: 58,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  gpxExportButtonPressed: {
    backgroundColor: 'rgba(0, 240, 255, 0.22)',
    transform: [{ scale: 0.98 }],
  },
  gpxExportButtonText: {
    color: MotoColors.primary,
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  shareActionButton: {
    backgroundColor: MotoColors.primary,
    minHeight: 64,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    elevation: 4,
    shadowColor: MotoColors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
  },
  shareActionButtonPressed: {
    backgroundColor: MotoColors.primaryHover,
    transform: [{ scale: 0.98 }],
  },
  shareActionButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
});
