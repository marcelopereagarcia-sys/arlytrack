/**
 * Modal para configurar o cambiar el perfil del piloto y gestionar "Mi Garaje" (múltiples vehículos) en MotoTrack.
 * Permite:
 * - Seleccionar una foto de perfil desde la galería con recorte cuadrado 1:1.
 * - Modificar el apodo del piloto.
 * - Gestionar vehículos: añadir motos, editarlas, eliminarlas y alternar el vehículo activo.
 * Estilo "Electric Motorsport" con acentos en Cian Neón (#00F0FF) y carbón profundo (#161B26).
 */

import React, { useEffect, useState } from 'react';
import {
  Alert,
  Image,
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
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import {
  Bike,
  Camera,
  Check,
  Coins,
  Edit2,
  Fuel,
  Plus,
  Trash2,
  User,
  X,
} from 'lucide-react-native';
import { MotoColors } from '@/constants/Colors';
import { Vehicle } from '@/types/ride';
import {
  addVehicle,
  deleteVehicle,
  getActiveVehicleId,
  getVehicles,
  getUserProfilePhoto,
  saveUserNickname,
  saveUserProfilePhoto,
  setActiveVehicleId,
  updateVehicle,
} from '@/services/storage';

interface RiderProfileModalProps {
  visible: boolean;
  currentNickname: string;
  currentPhotoUri?: string | null;
  onClose: () => void;
  onSave: (newNickname: string, newPhotoUri: string | null) => void;
  onVehicleChanged?: (activeVehicle: Vehicle) => void;
}

export function RiderProfileModal({
  visible,
  currentNickname,
  currentPhotoUri,
  onClose,
  onSave,
  onVehicleChanged,
}: RiderProfileModalProps) {
  const [nickname, setNickname] = useState(currentNickname);
  const [photoUri, setPhotoUri] = useState<string | null>(currentPhotoUri ?? null);

  // Estados de vehículos
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [activeVehId, setActiveVehId] = useState<string>('');

  // Modo edición / creación de vehículo
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formConsumption, setFormConsumption] = useState('4.5');
  const [formPrice, setFormPrice] = useState('1.65');

  const loadVehiclesData = async () => {
    const list = await getVehicles();
    const activeId = await getActiveVehicleId();
    setVehicles(list);
    setActiveVehId(activeId);
  };

  useEffect(() => {
    if (visible) {
      setNickname(currentNickname);
      if (currentPhotoUri !== undefined) {
        setPhotoUri(currentPhotoUri);
      } else {
        getUserProfilePhoto().then(setPhotoUri);
      }
      loadVehiclesData();
      setIsFormOpen(false);
      setEditingVehicleId(null);
    }
  }, [visible, currentNickname, currentPhotoUri]);

  // Abrir galería para elegir foto de perfil cuadrada
  const handlePickPhoto = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permiso necesario',
          'Se requiere permiso de acceso a la galería para cambiar tu foto de perfil de piloto.'
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const sourceUri = result.assets[0].uri;
        let finalUri = sourceUri;
        if (FileSystem.documentDirectory) {
          try {
            const filename = `profile_${Date.now()}.jpg`;
            const targetUri = `${FileSystem.documentDirectory}${filename}`;
            await FileSystem.copyAsync({ from: sourceUri, to: targetUri });
            finalUri = targetUri;
          } catch (copyErr) {
            console.warn('No se pudo copiar foto de perfil a documentDirectory:', copyErr);
          }
        }
        setPhotoUri(finalUri);
      }
    } catch (err) {
      console.error('Error al abrir la galería para foto de perfil:', err);
      Alert.alert('Error', 'No se pudo cargar la imagen de la galería.');
    }
  };

  // Quitar foto de perfil
  const handleRemovePhoto = () => {
    setPhotoUri(null);
  };

  // Seleccionar vehículo activo
  const handleSelectActive = async (veh: Vehicle) => {
    await setActiveVehicleId(veh.id);
    setActiveVehId(veh.id);
    if (onVehicleChanged) {
      onVehicleChanged(veh);
    }
  };

  // Abrir formulario para añadir vehículo nuevo
  const handleOpenAddVehicle = () => {
    setEditingVehicleId(null);
    setFormName('');
    setFormConsumption('4.5');
    setFormPrice('1.65');
    setIsFormOpen(true);
  };

  // Abrir formulario para editar vehículo existente
  const handleOpenEditVehicle = (veh: Vehicle) => {
    setEditingVehicleId(veh.id);
    setFormName(veh.name);
    setFormConsumption(veh.avgConsumptionL100km.toString());
    setFormPrice(veh.fuelPricePerLiter.toString());
    setIsFormOpen(true);
  };

  // Cancelar edición de vehículo
  const handleCancelForm = () => {
    setIsFormOpen(false);
    setEditingVehicleId(null);
  };

  // Guardar vehículo (crear o editar)
  const handleSaveVehicleForm = async () => {
    const trimmedName = formName.trim();
    if (!trimmedName) {
      Alert.alert('Datos incompletos', 'Introduce un nombre o modelo para el vehículo.');
      return;
    }

    const consNum = parseFloat(formConsumption.replace(',', '.')) || 4.5;
    const priceNum = parseFloat(formPrice.replace(',', '.')) || 1.65;

    if (editingVehicleId) {
      const updated: Vehicle = {
        id: editingVehicleId,
        name: trimmedName,
        avgConsumptionL100km: consNum > 0 ? consNum : 4.5,
        fuelPricePerLiter: priceNum > 0 ? priceNum : 1.65,
      };
      await updateVehicle(updated);
      if (editingVehicleId === activeVehId && onVehicleChanged) {
        onVehicleChanged(updated);
      }
    } else {
      const created = await addVehicle({
        name: trimmedName,
        avgConsumptionL100km: consNum > 0 ? consNum : 4.5,
        fuelPricePerLiter: priceNum > 0 ? priceNum : 1.65,
      });
      await setActiveVehicleId(created.id);
      setActiveVehId(created.id);
      if (onVehicleChanged) {
        onVehicleChanged(created);
      }
    }

    setIsFormOpen(false);
    setEditingVehicleId(null);
    await loadVehiclesData();
  };

  // Eliminar vehículo con confirmación
  const handleDeleteVehicle = (veh: Vehicle) => {
    if (vehicles.length <= 1) {
      Alert.alert('Aviso', 'Debes conservar al menos un vehículo en tu garaje.');
      return;
    }

    Alert.alert(
      'Eliminar vehículo',
      `¿Seguro que deseas eliminar "${veh.name}" de tu garaje?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            await deleteVehicle(veh.id);
            const remaining = await getVehicles();
            const newActiveId = await getActiveVehicleId();
            setVehicles(remaining);
            setActiveVehId(newActiveId);
            const activeVeh = remaining.find((v) => v.id === newActiveId);
            if (activeVeh && onVehicleChanged) {
              onVehicleChanged(activeVeh);
            }
          },
        },
      ]
    );
  };

  // Guardar perfil completo
  const handleSave = async () => {
    const finalName = nickname.trim() || 'Piloto';
    await saveUserNickname(finalName);
    await saveUserProfilePhoto(photoUri);
    onSave(finalName, photoUri);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}>
        <View style={styles.card}>
          {/* Cabecera */}
          <View style={styles.header}>
            <Text style={styles.title}>Perfil y Garaje</Text>
            <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
              <X size={22} color={MotoColors.textSecondary} />
            </Pressable>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled">
            {/* Selector de Foto de Perfil */}
            <View style={styles.avatarSection}>
              <Pressable onPress={handlePickPhoto} style={styles.avatarWrapper}>
                {photoUri ? (
                  <Image source={{ uri: photoUri }} style={styles.avatarImage} />
                ) : (
                  <View style={styles.avatarPlaceholder}>
                    <User size={46} color={MotoColors.primary} />
                  </View>
                )}

                <View style={styles.cameraBadge}>
                  <Camera size={16} color="#0B0E14" />
                </View>
              </Pressable>

              <View style={styles.avatarActions}>
                <Pressable onPress={handlePickPhoto} style={styles.pickPhotoBtn}>
                  <Text style={styles.pickPhotoText}>
                    {photoUri ? 'Cambiar Foto' : 'Añadir Foto'}
                  </Text>
                </Pressable>

                {photoUri && (
                  <Pressable onPress={handleRemovePhoto} style={styles.removePhotoBtn}>
                    <Trash2 size={14} color={MotoColors.danger} />
                    <Text style={styles.removePhotoText}>Quitar</Text>
                  </Pressable>
                )}
              </View>
            </View>

            {/* Campo de Apodo / Nombre */}
            <View style={styles.inputSection}>
              <Text style={styles.inputLabel}>APODO O NOMBRE DE PILOTO</Text>
              <TextInput
                style={styles.input}
                value={nickname}
                onChangeText={setNickname}
                placeholder="Ej. Álex, Rossi46, RiderX..."
                placeholderTextColor={MotoColors.textMuted}
                selectionColor={MotoColors.primary}
                maxLength={25}
              />
            </View>

            {/* Separador de sección */}
            <View style={styles.fuelDivider} />

            {/* Sección Mi Garaje (Multivehículo) */}
            <View style={styles.sectionHeaderRow}>
              <View style={styles.sectionHeader}>
                <Bike size={18} color={MotoColors.primary} />
                <Text style={styles.sectionTitle}>MI GARAJE</Text>
              </View>
              {!isFormOpen && (
                <Pressable
                  onPress={handleOpenAddVehicle}
                  style={styles.addVehicleBtn}>
                  <Plus size={14} color="#0B0E14" />
                  <Text style={styles.addVehicleBtnText}>Añadir Moto</Text>
                </Pressable>
              )}
            </View>

            {/* Formulario para Crear / Editar Vehículo */}
            {isFormOpen ? (
              <View style={styles.vehicleFormCard}>
                <Text style={styles.formTitle}>
                  {editingVehicleId ? 'Editar Vehículo' : 'Añadir Nuevo Vehículo'}
                </Text>

                <View style={styles.inputSection}>
                  <Text style={styles.inputLabel}>MODELO / NOMBRE</Text>
                  <TextInput
                    style={styles.input}
                    value={formName}
                    onChangeText={setFormName}
                    placeholder="Ej. Yamaha MT-07, KTM Duke 390..."
                    placeholderTextColor={MotoColors.textMuted}
                    selectionColor={MotoColors.primary}
                    maxLength={30}
                    autoFocus
                  />
                </View>

                <View style={styles.rowInputs}>
                  <View style={[styles.inputSection, { flex: 1 }]}>
                    <Text style={styles.inputLabel}>CONSUMO (L/100 KM)</Text>
                    <View style={styles.inputWithIcon}>
                      <Fuel size={16} color={MotoColors.warning} />
                      <TextInput
                        style={styles.innerInput}
                        value={formConsumption}
                        onChangeText={setFormConsumption}
                        placeholder="4.5"
                        placeholderTextColor={MotoColors.textMuted}
                        keyboardType="decimal-pad"
                        selectionColor={MotoColors.primary}
                        maxLength={5}
                      />
                    </View>
                  </View>

                  <View style={[styles.inputSection, { flex: 1 }]}>
                    <Text style={styles.inputLabel}>PRECIO (€/L)</Text>
                    <View style={styles.inputWithIcon}>
                      <Coins size={16} color={MotoColors.lime} />
                      <TextInput
                        style={styles.innerInput}
                        value={formPrice}
                        onChangeText={setFormPrice}
                        placeholder="1.65"
                        placeholderTextColor={MotoColors.textMuted}
                        keyboardType="decimal-pad"
                        selectionColor={MotoColors.primary}
                        maxLength={5}
                      />
                    </View>
                  </View>
                </View>

                <View style={styles.formButtonsRow}>
                  <Pressable
                    onPress={handleCancelForm}
                    style={styles.cancelFormBtn}>
                    <Text style={styles.cancelFormText}>Cancelar</Text>
                  </Pressable>
                  <Pressable
                    onPress={handleSaveVehicleForm}
                    style={styles.submitFormBtn}>
                    <Check size={16} color="#0B0E14" />
                    <Text style={styles.submitFormText}>Guardar Vehículo</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              /* Lista de Vehículos del Garaje */
              <View style={styles.vehiclesList}>
                {vehicles.map((veh) => {
                  const isActive = veh.id === activeVehId;
                  return (
                    <Pressable
                      key={veh.id}
                      onPress={() => handleSelectActive(veh)}
                      style={[
                        styles.vehicleItem,
                        isActive && styles.vehicleItemActive,
                      ]}>
                      <View style={styles.vehicleItemHeader}>
                        <View style={styles.vehicleTitleRow}>
                          <Bike
                            size={16}
                            color={isActive ? MotoColors.primary : MotoColors.textSecondary}
                          />
                          <Text
                            style={[
                              styles.vehicleName,
                              isActive && styles.vehicleNameActive,
                            ]}
                            numberOfLines={1}>
                            {veh.name}
                          </Text>
                        </View>
                        {isActive && (
                          <View style={styles.activeBadge}>
                            <Check size={10} color="#0B0E14" />
                            <Text style={styles.activeBadgeText}>ACTIVA</Text>
                          </View>
                        )}
                      </View>

                      <View style={styles.vehicleMetricsRow}>
                        <Text style={styles.vehicleMetricText}>
                          ⛽ {veh.avgConsumptionL100km} L/100 km
                        </Text>
                        <Text style={styles.vehicleMetricText}>
                          💶 {veh.fuelPricePerLiter.toFixed(2)} €/L
                        </Text>
                      </View>

                      <View style={styles.vehicleActionsRow}>
                        <Pressable
                          onPress={() => handleOpenEditVehicle(veh)}
                          hitSlop={8}
                          style={styles.actionBtn}>
                          <Edit2 size={14} color={MotoColors.primary} />
                          <Text style={styles.actionBtnText}>Editar</Text>
                        </Pressable>

                        {vehicles.length > 1 && (
                          <Pressable
                            onPress={() => handleDeleteVehicle(veh)}
                            hitSlop={8}
                            style={styles.actionBtn}>
                            <Trash2 size={14} color={MotoColors.danger} />
                            <Text style={[styles.actionBtnText, { color: MotoColors.danger }]}>
                              Eliminar
                            </Text>
                          </Pressable>
                        )}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}

            <Text style={styles.hintText}>
              Toca una moto para marcarla como la que vas a pilotar hoy. El consumo y coste de combustible de tu ruta se calcularán según la moto activa.
            </Text>

            {/* Botón Guardar */}
            <Pressable
              onPress={handleSave}
              style={({ pressed }) => [
                styles.saveBtn,
                pressed && styles.saveBtnPressed,
              ]}>
              <Check size={20} color="#0B0E14" />
              <Text style={styles.saveBtnText}>LISTO</Text>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.78)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    maxHeight: '90%',
    backgroundColor: '#161B26',
    borderColor: '#263044',
    borderWidth: 1.5,
    borderRadius: 22,
    padding: 22,
    gap: 14,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
  },
  scrollContent: {
    gap: 14,
    paddingBottom: 4,
  },
  fuelDivider: {
    height: 1,
    backgroundColor: '#263044',
    marginVertical: 4,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitle: {
    color: MotoColors.primary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  addVehicleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: MotoColors.primary,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  addVehicleBtnText: {
    color: '#0B0E14',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  vehicleFormCard: {
    backgroundColor: '#101622',
    borderColor: MotoColors.primary,
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  formTitle: {
    color: MotoColors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  formButtonsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  cancelFormBtn: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderColor: '#263044',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelFormText: {
    color: MotoColors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  submitFormBtn: {
    flex: 1.5,
    backgroundColor: MotoColors.primary,
    borderRadius: 10,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  submitFormText: {
    color: '#0B0E14',
    fontSize: 12,
    fontWeight: '900',
  },
  vehiclesList: {
    gap: 8,
  },
  vehicleItem: {
    backgroundColor: '#101622',
    borderColor: '#263044',
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 12,
    gap: 6,
  },
  vehicleItemActive: {
    borderColor: MotoColors.primary,
    backgroundColor: 'rgba(0, 240, 255, 0.05)',
  },
  vehicleItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  vehicleTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  vehicleName: {
    color: MotoColors.text,
    fontSize: 14,
    fontWeight: '800',
    flex: 1,
  },
  vehicleNameActive: {
    color: MotoColors.primary,
  },
  activeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: MotoColors.primary,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  activeBadgeText: {
    color: '#0B0E14',
    fontSize: 9.5,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  vehicleMetricsRow: {
    flexDirection: 'row',
    gap: 16,
  },
  vehicleMetricText: {
    color: MotoColors.textSecondary,
    fontSize: 11.5,
    fontWeight: '600',
  },
  vehicleActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderTopWidth: 1,
    borderTopColor: '#1A2232',
    paddingTop: 6,
    marginTop: 2,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actionBtnText: {
    color: MotoColors.primary,
    fontSize: 11,
    fontWeight: '700',
  },
  rowInputs: {
    flexDirection: 'row',
    gap: 12,
  },
  inputWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#101622',
    borderColor: '#263044',
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 12,
    gap: 8,
  },
  innerInput: {
    flex: 1,
    color: MotoColors.text,
    fontSize: 16,
    fontWeight: '700',
    paddingVertical: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    color: MotoColors.text,
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  closeBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  // Sección de foto de perfil
  avatarSection: {
    alignItems: 'center',
    gap: 10,
  },
  avatarWrapper: {
    position: 'relative',
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2.5,
    borderColor: MotoColors.primary,
    elevation: 6,
    shadowColor: MotoColors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 48,
  },
  avatarPlaceholder: {
    width: '100%',
    height: '100%',
    borderRadius: 48,
    backgroundColor: '#101622',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: MotoColors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2.5,
    borderColor: '#161B26',
  },
  avatarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  pickPhotoBtn: {
    backgroundColor: 'rgba(0, 240, 255, 0.12)',
    borderColor: 'rgba(0, 240, 255, 0.35)',
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 12,
  },
  pickPhotoText: {
    color: MotoColors.primary,
    fontSize: 12.5,
    fontWeight: '800',
  },
  removePhotoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: 'rgba(255, 0, 85, 0.12)',
    borderColor: 'rgba(255, 0, 85, 0.35)',
    borderWidth: 1,
  },
  removePhotoText: {
    color: MotoColors.danger,
    fontSize: 12.5,
    fontWeight: '800',
  },
  // Sección de entrada
  inputSection: {
    gap: 6,
  },
  inputLabel: {
    color: MotoColors.textSecondary,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  input: {
    backgroundColor: '#101622',
    borderColor: '#263044',
    borderWidth: 1.5,
    borderRadius: 14,
    color: MotoColors.text,
    fontSize: 16,
    fontWeight: '700',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  hintText: {
    color: MotoColors.textMuted,
    fontSize: 11.5,
    fontWeight: '600',
    lineHeight: 16,
  },
  // Botón guardar
  saveBtn: {
    backgroundColor: MotoColors.primary,
    minHeight: 52,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    elevation: 4,
    shadowColor: MotoColors.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
  },
  saveBtnPressed: {
    backgroundColor: MotoColors.primaryHover,
    transform: [{ scale: 0.98 }],
  },
  saveBtnText: {
    color: '#0B0E14',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
});
