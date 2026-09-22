/**
 * Modal de Finalización y Calificación de Ruta para MotoTrack.
 * Permite asignar nombre a la ruta, calificar con estrellas (general, asfalto, curvas/paisaje)
 * y guardar la sesión completa con todas sus métricas y coordenadas en AsyncStorage.
 */

import React, { useState, useRef } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Bike, Check, CheckCircle2, Flag, Fuel, Mountain, Route, Timer, Trash2 } from 'lucide-react-native';
import { MotoColors } from '@/constants/Colors';
import { ActiveRideState, MotorcycleSettings, RideRatings, RideSession, Vehicle } from '@/types/ride';
import {
  DEFAULT_MOTORCYCLE_SETTINGS,
  getActiveVehicle,
  getMotorcycleSettings,
  getUserNickname,
  getVehicles,
  saveRide,
} from '@/services/storage';
import { StarRating } from './StarRating';

interface FinishRideModalProps {
  visible: boolean;
  rideData: ActiveRideState | null;
  onSaveSuccess: (savedRide: RideSession) => void;
  onDiscard: () => void;
}

function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) {
    return `${hrs}h ${mins}m`;
  }
  return `${mins}m ${secs}s`;
}

function getDefaultRouteName(riderNickname: string): string {
  const now = new Date();
  const hour = now.getHours();
  let timeOfDay = 'Matutina';
  if (hour >= 13 && hour < 17) {
    timeOfDay = 'del Mediodía';
  } else if (hour >= 17 && hour < 21) {
    timeOfDay = 'Vespertina';
  } else if (hour >= 21 || hour < 6) {
    timeOfDay = 'Nocturna';
  }

  const dateStr = new Date().toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'short',
  });
  return `Ruta ${timeOfDay} de ${riderNickname} (${dateStr})`;
}

export function FinishRideModal({
  visible,
  rideData,
  onSaveSuccess,
  onDiscard,
}: FinishRideModalProps) {
  const [routeName, setRouteName] = useState('');
  const [riderName, setRiderName] = useState('Piloto');
  const [motoSettings, setMotoSettings] = useState<MotorcycleSettings>(DEFAULT_MOTORCYCLE_SETTINGS);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [ratings, setRatings] = useState<RideRatings>({
    overall: 5,
    roadCondition: 4,
    sceneryCurves: 5,
  });
  const [isSaving, setIsSaving] = useState(false);
  const isSavingLockRef = useRef(false);

  React.useEffect(() => {
    if (visible) {
      setRouteName('');
      setRatings({
        overall: 5,
        roadCondition: 4,
        sceneryCurves: 5,
      });
      setIsSaving(false);
      isSavingLockRef.current = false;
      getUserNickname().then(setRiderName);
      getMotorcycleSettings().then(setMotoSettings);
      getVehicles().then((list) => {
        setVehicles(list);
        getActiveVehicle().then((active) => {
          setSelectedVehicle(active);
        });
      });
    }
  }, [visible]);

  const avgCons = selectedVehicle?.avgConsumptionL100km ?? motoSettings.avgConsumptionL100km ?? 4.5;
  const fuelPrice = selectedVehicle?.fuelPricePerLiter ?? motoSettings.fuelPricePerLiter ?? 1.65;

  const fuelConsumed = rideData
    ? Math.round(((rideData.metrics.totalDistanceKm * avgCons) / 100) * 10) / 10
    : 0;
  const fuelCost = Math.round(fuelConsumed * fuelPrice * 100) / 100;

  // Inicializar nombre por defecto si está vacío
  const displayName = routeName.trim() || getDefaultRouteName(riderName);

  const handleSave = async () => {
    if (!rideData || isSavingLockRef.current) return;
    isSavingLockRef.current = true;
    setIsSaving(true);

    try {
      const finalRide: RideSession = {
        id: `ride-${Date.now()}`,
        name: displayName,
        date: new Date(rideData.startTime || Date.now()).toISOString(),
        startTime: rideData.startTime || Date.now(),
        endTime: Date.now(),
        totalDurationSeconds: rideData.metrics.totalDurationSeconds,
        movingDurationSeconds: rideData.metrics.movingDurationSeconds,
        totalDistanceKm: rideData.metrics.totalDistanceKm,
        elevationGainMeters: rideData.metrics.elevationGainMeters,
        maxAltitudeMeters: rideData.metrics.maxAltitudeMeters ?? 0,
        minAltitudeMeters: rideData.metrics.minAltitudeMeters ?? 0,
        maxSpeedKmh: rideData.metrics.maxSpeed,
        avgSpeedKmh: rideData.metrics.avgSpeed,
        fuelConsumedLiters: fuelConsumed,
        fuelCostEstimate: fuelCost,
        vehicleId: selectedVehicle?.id,
        vehicleName: selectedVehicle?.name,
        ratings,
        points: rideData.points,
      };

      await saveRide(finalRide);
      onSaveSuccess(finalRide);
    } catch (error) {
      Alert.alert('Error', 'No se pudo guardar la ruta. Inténtalo de nuevo.');
    } finally {
      isSavingLockRef.current = false;
      setIsSaving(false);
    }
  };

  const handleDiscardPress = () => {
    Alert.alert(
      '¿Descartar ruta?',
      'Esta acción eliminará todos los datos de la salida actual y no se podrán recuperar.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Descartar',
          style: 'destructive',
          onPress: onDiscard,
        },
      ]
    );
  };

  if (!rideData) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={handleDiscardPress}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.screen}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled">
          {/* Cabecera */}
          <View style={styles.header}>
            <View style={styles.headerIconContainer}>
              <Flag size={32} color={MotoColors.primary} />
            </View>
            <Text style={styles.headerTitle}>¡Gran rodada, {riderName}!</Text>
            <Text style={styles.headerSubtitle}>
              Esta fue tu ruta. Revisa el resumen y califica tu experiencia:
            </Text>
          </View>

          {/* Tarjetas resumen de métricas */}
          <View style={styles.summaryGrid}>
            <View style={styles.summaryCard}>
              <Route size={20} color={MotoColors.primary} />
              <Text style={styles.summaryCardValue}>
                {rideData.metrics.totalDistanceKm.toFixed(1)} km
              </Text>
              <Text style={styles.summaryCardLabel}>Distancia</Text>
            </View>

            <View style={styles.summaryCard}>
              <Timer size={20} color={MotoColors.success} />
              <Text style={styles.summaryCardValue}>
                {formatDuration(rideData.metrics.movingDurationSeconds)}
              </Text>
              <Text style={styles.summaryCardLabel}>En marcha</Text>
            </View>

            <View style={styles.summaryCard}>
              <Mountain size={20} color={MotoColors.cyan} />
              <Text style={styles.summaryCardValue}>
                +{rideData.metrics.elevationGainMeters} m
              </Text>
              <Text style={styles.summaryCardLabel}>Desnivel +</Text>
            </View>
          </View>

          {/* Tarjeta de Consumo de Combustible */}
          <View style={styles.fuelCard}>
            <View style={styles.fuelIconWrapper}>
              <Fuel size={24} color={MotoColors.warning} />
            </View>
            <View style={styles.fuelInfo}>
              <Text style={styles.fuelTitle}>COMBUSTIBLE ESTIMADO</Text>
              <View style={styles.fuelStatsRow}>
                <Text style={styles.fuelStatText}>
                  <Text style={styles.fuelHighlight}>{fuelConsumed.toFixed(1)} L</Text> gastados
                </Text>
                <Text style={styles.fuelStatText}>
                  Coste: <Text style={styles.fuelCostHighlight}>~{fuelCost.toFixed(2)} €</Text>
                </Text>
              </View>
              {vehicles.length > 1 ? (
                <View style={styles.vehicleSelectorContainer}>
                  <Text style={styles.vehicleSelectorTitle}>Vehículo usado:</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.vehicleChipsList}>
                    {vehicles.map((v) => {
                      const isSelected = selectedVehicle?.id === v.id;
                      return (
                        <Pressable
                          key={v.id}
                          onPress={() => setSelectedVehicle(v)}
                          style={[
                            styles.vehicleChip,
                            isSelected && styles.vehicleChipSelected,
                          ]}>
                          <Bike
                            size={12}
                            color={isSelected ? '#0B0E14' : MotoColors.primary}
                          />
                          <Text
                            style={[
                              styles.vehicleChipText,
                              isSelected && styles.vehicleChipTextSelected,
                            ]}>
                            {v.name}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                  <Text style={styles.fuelSubText}>
                    Media: {avgCons} L/100km ({fuelPrice.toFixed(2)} €/L)
                  </Text>
                </View>
              ) : (
                <Text style={styles.fuelSubText}>
                  Media: {avgCons} L/100km ({fuelPrice.toFixed(2)} €/L)
                  {selectedVehicle?.name ? ` · ${selectedVehicle.name}` : ''}
                </Text>
              )}
            </View>
          </View>

          {/* Formulario: Nombre de la ruta */}
          <View style={styles.inputSection}>
            <Text style={styles.inputLabel}>NOMBRE DE LA RUTA</Text>
            <TextInput
              style={styles.textInput}
              value={routeName}
              onChangeText={setRouteName}
              placeholder={getDefaultRouteName(riderName)}
              placeholderTextColor={MotoColors.textMuted}
              selectionColor={MotoColors.primary}
            />
          </View>

          {/* Formulario: Calificaciones con estrellas */}
          <View style={styles.ratingsSection}>
            <Text style={styles.ratingsSectionTitle}>VALORACIÓN DE LA SALIDA</Text>

            <View style={styles.ratingCard}>
              <StarRating
                label="Valoración General"
                rating={ratings.overall}
                onRatingChange={(val) => setRatings((prev) => ({ ...prev, overall: val }))}
                size={34}
              />
            </View>

            <View style={styles.ratingCard}>
              <StarRating
                label="Estado del Asfalto"
                rating={ratings.roadCondition}
                onRatingChange={(val) => setRatings((prev) => ({ ...prev, roadCondition: val }))}
                size={34}
              />
            </View>

            <View style={styles.ratingCard}>
              <StarRating
                label="Nivel de Curvas y Paisaje"
                rating={ratings.sceneryCurves}
                onRatingChange={(val) => setRatings((prev) => ({ ...prev, sceneryCurves: val }))}
                size={34}
              />
            </View>
          </View>

          {/* Botones de acción Glove-friendly (mínimo 64px de alto) */}
          <View style={styles.actionsContainer}>
            <Pressable
              onPress={handleSave}
              disabled={isSaving}
              style={({ pressed }) => [
                styles.saveButton,
                pressed && styles.saveButtonPressed,
                isSaving && { opacity: 0.7 },
              ]}>
              <CheckCircle2 size={28} color="#0B0E14" />
              <Text style={styles.saveButtonText}>
                {isSaving ? 'Guardando...' : 'GUARDAR RUTA'}
              </Text>
            </Pressable>

            <Pressable
              onPress={handleDiscardPress}
              disabled={isSaving}
              style={({ pressed }) => [
                styles.discardButton,
                pressed && styles.discardButtonPressed,
              ]}>
              <Trash2 size={24} color={MotoColors.danger} />
              <Text style={styles.discardButtonText}>Descartar Ruta</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: MotoColors.background,
  },
  scrollContent: {
    padding: 20,
    paddingTop: Platform.OS === 'ios' ? 60 : 36,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  headerIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255, 122, 0, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: MotoColors.primary,
  },
  headerTitle: {
    color: MotoColors.text,
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  headerSubtitle: {
    color: MotoColors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 4,
  },
  summaryGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 24,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: MotoColors.surface,
    borderColor: MotoColors.border,
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryCardValue: {
    color: MotoColors.text,
    fontSize: 17,
    fontWeight: '800',
    marginTop: 6,
    marginBottom: 2,
    fontVariant: ['tabular-nums'],
  },
  summaryCardLabel: {
    color: MotoColors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  fuelCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    borderColor: 'rgba(245, 158, 11, 0.35)',
    borderWidth: 1.5,
    borderRadius: 16,
    padding: 14,
    gap: 14,
    marginBottom: 24,
  },
  fuelIconWrapper: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: MotoColors.warning,
  },
  fuelInfo: {
    flex: 1,
    gap: 3,
  },
  fuelTitle: {
    color: MotoColors.warning,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  fuelStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  fuelStatText: {
    color: MotoColors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
  },
  fuelHighlight: {
    color: MotoColors.text,
    fontSize: 15,
    fontWeight: '900',
  },
  fuelCostHighlight: {
    color: MotoColors.lime,
    fontSize: 15,
    fontWeight: '900',
  },
  fuelSubText: {
    color: MotoColors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  vehicleSelectorContainer: {
    marginTop: 6,
    gap: 4,
  },
  vehicleSelectorTitle: {
    color: MotoColors.textSecondary,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  vehicleChipsList: {
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 2,
  },
  vehicleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#101622',
    borderColor: '#263044',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  vehicleChipSelected: {
    backgroundColor: MotoColors.primary,
    borderColor: MotoColors.primary,
  },
  vehicleChipText: {
    color: MotoColors.text,
    fontSize: 11,
    fontWeight: '700',
  },
  vehicleChipTextSelected: {
    color: '#0B0E14',
    fontWeight: '900',
  },
  inputSection: {
    marginBottom: 20,
  },
  inputLabel: {
    color: MotoColors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  textInput: {
    backgroundColor: MotoColors.surface,
    borderColor: MotoColors.border,
    borderWidth: 1.5,
    borderRadius: 14,
    color: MotoColors.text,
    fontSize: 17,
    fontWeight: '600',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  ratingsSection: {
    marginBottom: 28,
  },
  ratingsSectionTitle: {
    color: MotoColors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 10,
    letterSpacing: 0.5,
  },
  ratingCard: {
    backgroundColor: MotoColors.surface,
    borderColor: MotoColors.border,
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  actionsContainer: {
    gap: 12,
  },
  // Botón grande apto para guantes (altura mínima 64px)
  saveButton: {
    backgroundColor: MotoColors.primary,
    minHeight: 64,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    elevation: 4,
    shadowColor: MotoColors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
  },
  saveButtonPressed: {
    backgroundColor: MotoColors.primaryHover,
    transform: [{ scale: 0.98 }],
  },
  saveButtonText: {
    color: '#0B0E14',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 1,
  },
  discardButton: {
    backgroundColor: 'transparent',
    borderColor: MotoColors.border,
    borderWidth: 1.5,
    minHeight: 56,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  discardButtonPressed: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  discardButtonText: {
    color: MotoColors.danger,
    fontSize: 15,
    fontWeight: '700',
  },
});
