/**
 * Pantalla de Historial de Rutas de MotoTrack (app/(tabs)/history.tsx).
 * Muestra el listado cronológico de salidas en moto ordenadas de la más reciente a la más antigua.
 * Al pulsar sobre cualquier ruta, abre el modal detallado interactivo con mapa y estadísticas.
 */

import React, { useCallback, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import {
  Calendar,
  ChevronRight,
  Gauge,
  History,
  Mountain,
  Plus,
  Route,
  Share2,
  Star,
  Timer,
} from 'lucide-react-native';
import { MotoColors } from '@/constants/Colors';
import { deleteRide, getRideById, getRides, saveRide } from '@/services/storage';
import { RideSession } from '@/types/ride';
import { RideDetailModal } from '@/components/RideDetailModal';
import { ShareCardModal } from '@/components/ShareCard';

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
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return 'Fecha desconocida';
  }
}

export default function HistoryScreen() {
  const [rides, setRides] = useState<RideSession[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedRide, setSelectedRide] = useState<RideSession | null>(null);
  const [shareModalRide, setShareModalRide] = useState<RideSession | null>(null);

  // Cargar lista de rutas cada vez que la pantalla recibe el foco
  const loadRides = useCallback(async () => {
    const data = await getRides(true);
    setRides(data);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadRides();
    }, [loadRides])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadRides();
    setRefreshing(false);
  };

  const handleDeleteRide = async (id: string) => {
    await deleteRide(id);
    await loadRides();
  };

  const handleOpenDetail = async (item: RideSession) => {
    const fullRide = await getRideById(item.id);
    setSelectedRide(fullRide || item);
  };

  const handleOpenShare = async (item: RideSession) => {
    const fullRide = await getRideById(item.id);
    setShareModalRide(fullRide || item);
  };

  const renderRideItem = ({ item }: { item: RideSession }) => {
    return (
      <Pressable
        onPress={() => handleOpenDetail(item)}
        style={({ pressed }) => [
          styles.card,
          pressed && styles.cardPressed,
        ]}>
        {/* Cabecera de la tarjeta: Título y fecha */}
        <View style={styles.cardHeader}>
          <View style={styles.titleContainer}>
            <Text style={styles.routeTitle} numberOfLines={1}>
              {item.name}
            </Text>
            <View style={styles.dateContainer}>
              <Calendar size={13} color={MotoColors.textSecondary} />
              <Text style={styles.routeDate}>{formatDate(item.date)}</Text>
            </View>
          </View>

          {/* Botón rápido para abrir compartir */}
          <Pressable
            onPress={() => handleOpenShare(item)}
            hitSlop={10}
            style={({ pressed }) => [
              styles.quickShareButton,
              pressed && styles.quickShareButtonPressed,
            ]}>
            <Share2 size={18} color={MotoColors.primary} />
          </Pressable>
        </View>

        {/* Fila de métricas clave */}
        <View style={styles.metricsRow}>
          <View style={styles.metricBadge}>
            <Route size={14} color={MotoColors.primary} />
            <Text style={styles.metricValue}>
              {item.totalDistanceKm.toFixed(1)} <Text style={styles.metricUnit}>km</Text>
            </Text>
          </View>

          <View style={styles.metricBadge}>
            <Timer size={14} color={MotoColors.success} />
            <Text style={styles.metricValue}>
              {formatDuration(item.movingDurationSeconds)}
            </Text>
          </View>

          <View style={styles.metricBadge}>
            <Mountain size={14} color={MotoColors.cyan} />
            <Text style={styles.metricValue}>
              +{item.elevationGainMeters} <Text style={styles.metricUnit}>m</Text>
            </Text>
          </View>

          <View style={styles.metricBadge}>
            <Gauge size={14} color={MotoColors.amber} />
            <Text style={styles.metricValue}>
              {Math.round(item.avgSpeedKmh)} <Text style={styles.metricUnit}>km/h</Text>
            </Text>
          </View>
        </View>

        {/* Pie de tarjeta: Estrellas y botón de ver más */}
        <View style={styles.cardFooter}>
          <View style={styles.starsRow}>
            {[1, 2, 3, 4, 5].map((s) => (
              <Star
                key={s}
                size={16}
                color={s <= item.ratings.overall ? MotoColors.star : MotoColors.border}
                fill={s <= item.ratings.overall ? MotoColors.star : 'transparent'}
              />
            ))}
            <Text style={styles.starsText}>{item.ratings.overall}.0</Text>
          </View>

          <View style={styles.viewDetailIndicator}>
            <Text style={styles.viewDetailText}>Ver ruta</Text>
            <ChevronRight size={16} color={MotoColors.textSecondary} />
          </View>
        </View>
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      {/* Listado de Rutas */}
      <FlatList
        data={rides}
        keyExtractor={(item) => item.id}
        renderItem={renderRideItem}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={MotoColors.primary}
            colors={[MotoColors.primary]}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyStateContainer}>
            <History size={64} color={MotoColors.borderLight} />
            <Text style={styles.emptyStateTitle}>Aún no hay rutas guardadas</Text>
            <Text style={styles.emptyStateDescription}>
              Inicia tu primera salida desde la pestaña "En Vivo" para grabar tu trazado,
              velocidad y desniveles.
            </Text>
          </View>
        }
      />

      {/* Modal de Detalle con mapa navegable */}
      <RideDetailModal
        visible={selectedRide !== null}
        ride={selectedRide}
        onClose={() => setSelectedRide(null)}
        onDelete={handleDeleteRide}
      />

      {/* Modal de Tarjeta Compartible 9:16 */}
      <ShareCardModal
        visible={shareModalRide !== null}
        ride={shareModalRide}
        onClose={() => setShareModalRide(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: MotoColors.background,
  },
  listContent: {
    padding: 16,
    paddingBottom: 32,
    gap: 14,
  },
  card: {
    backgroundColor: MotoColors.surface,
    borderColor: MotoColors.border,
    borderWidth: 1.5,
    borderRadius: 18,
    padding: 16,
    gap: 12,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
  },
  cardPressed: {
    backgroundColor: MotoColors.surfaceLight,
    borderColor: MotoColors.primary,
    transform: [{ scale: 0.99 }],
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  titleContainer: {
    flex: 1,
  },
  routeTitle: {
    color: MotoColors.text,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 4,
  },
  dateContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  routeDate: {
    color: MotoColors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  quickShareButton: {
    padding: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 122, 0, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 122, 0, 0.3)',
  },
  quickShareButtonPressed: {
    backgroundColor: 'rgba(255, 122, 0, 0.25)',
  },
  // Métricas
  metricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metricBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#121826',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: MotoColors.border,
  },
  metricValue: {
    color: MotoColors.text,
    fontSize: 13,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  metricUnit: {
    fontSize: 10,
    color: MotoColors.textSecondary,
    fontWeight: '600',
  },
  // Pie de tarjeta
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: MotoColors.border,
    paddingTop: 10,
  },
  starsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  starsText: {
    color: MotoColors.star,
    fontSize: 12,
    fontWeight: '800',
    marginLeft: 4,
  },
  viewDetailIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  viewDetailText: {
    color: MotoColors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  // Estado vacío
  emptyStateContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
    paddingHorizontal: 24,
    gap: 14,
  },
  emptyStateTitle: {
    color: MotoColors.text,
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  emptyStateDescription: {
    color: MotoColors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
});
