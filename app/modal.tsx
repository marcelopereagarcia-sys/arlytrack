/**
 * Pantalla modal de información y configuración de MotoTrack.
 * Explica el funcionamiento offline, permisos de GPS y optimización de batería.
 */

import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { Image, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BatteryCharging, MapPin, ShieldCheck } from 'lucide-react-native';
import { MotoColors } from '@/constants/Colors';

export default function ModalScreen() {
  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        {/* Cabecera con Logo Oficial */}
        <View style={styles.header}>
          <Image
            source={require('@/assets/images/icon.png')}
            style={styles.officialLogo}
          />
          <Text style={styles.title}>Acerca de ArlyTrack</Text>
          <Text style={styles.versionText}>Versión 1.0.0 (Telemetría de Competición)</Text>
        </View>

        {/* Sección 1: Funcionamiento Offline */}
        <View style={styles.infoCard}>
          <View style={styles.cardHeader}>
            <ShieldCheck size={22} color={MotoColors.success} />
            <Text style={styles.cardTitle}>100% Sin Conexión</Text>
          </View>
          <Text style={styles.cardBody}>
            ArlyTrack guarda tus rutas y telemetría directamente en el almacenamiento interno de tu
            dispositivo. No necesitas cobertura móvil ni plan de datos en carreteras de montaña.
          </Text>
        </View>

        {/* Sección 2: Rastreo en segundo plano */}
        <View style={styles.infoCard}>
          <View style={styles.cardHeader}>
            <MapPin size={22} color={MotoColors.primary} />
            <Text style={styles.cardTitle}>GPS en Segundo Plano</Text>
          </View>
          <Text style={styles.cardBody}>
            Para registrar todo tu recorrido con la pantalla apagada o usando tu app de mapas
            favorita, asegúrate de conceder el permiso de ubicación en "Permitir siempre".
          </Text>
        </View>

        {/* Sección 3: Consejos de batería */}
        <View style={styles.infoCard}>
          <View style={styles.cardHeader}>
            <BatteryCharging size={22} color={MotoColors.cyan} />
            <Text style={styles.cardTitle}>Ajuste de Batería (Android)</Text>
          </View>
          <Text style={styles.cardBody}>
            En los ajustes de batería de tu teléfono, desactiva la optimización de batería estricta
            para ArlyTrack. Esto garantizará que el sistema operativo no cierre el servicio GPS en
            rutas largas.
          </Text>
        </View>
      </ScrollView>

      <StatusBar style={Platform.OS === 'ios' ? 'light' : 'light'} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: MotoColors.background,
  },
  scrollContent: {
    padding: 20,
    paddingTop: 24,
    paddingBottom: 40,
    gap: 16,
  },
  header: {
    alignItems: 'center',
    marginBottom: 10,
  },
  officialLogo: {
    width: 100,
    height: 100,
    borderRadius: 22,
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: MotoColors.primary,
  },
  title: {
    color: MotoColors.text,
    fontSize: 22,
    fontWeight: '900',
  },
  versionText: {
    color: MotoColors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
  },
  infoCard: {
    backgroundColor: MotoColors.surface,
    borderColor: MotoColors.border,
    borderWidth: 1.5,
    borderRadius: 16,
    padding: 16,
    gap: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  cardTitle: {
    color: MotoColors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  cardBody: {
    color: MotoColors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
});
