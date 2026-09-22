/**
 * Navegación por pestañas de MotoTrack (app/(tabs)/_layout.tsx).
 * Incluye pestañas "Ruta en Vivo" e "Historial" con iconos de Lucide y tema oscuro predeterminado.
 */

import React from 'react';
import { Platform } from 'react-native';
import { Tabs } from 'expo-router';
import { History, Navigation } from 'lucide-react-native';
import { MotoColors } from '@/constants/Colors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  // Elevar la barra de pestañas para que nunca quede oculta por los botones del sistema Android (3 botones o gestos)
  const bottomInset = Math.max(insets.bottom, Platform.OS === 'android' ? 16 : 8);
  const barHeight = 58 + bottomInset;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: MotoColors.primary,
        tabBarInactiveTintColor: MotoColors.textMuted,
        tabBarStyle: {
          backgroundColor: MotoColors.background,
          borderTopColor: MotoColors.border,
          borderTopWidth: 1.5,
          height: barHeight,
          paddingBottom: bottomInset,
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '700',
        },
        headerStyle: {
          backgroundColor: MotoColors.background,
          borderBottomColor: MotoColors.border,
          borderBottomWidth: 1,
          shadowOpacity: 0,
          elevation: 0,
        },
        headerTintColor: MotoColors.text,
        headerTitleStyle: {
          fontWeight: '900',
          fontSize: 20,
        },
      }}>
      {/* Pestaña Principal: Grabación en Vivo con HUD */}
      <Tabs.Screen
        name="index"
        options={{
          title: 'En Vivo',
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Navigation size={size || 24} color={color} />
          ),
        }}
      />

      {/* Pestaña: Historial de Rutas Anteriores */}
      <Tabs.Screen
        name="history"
        options={{
          title: 'Historial',
          headerTitle: 'Historial de Rutas',
          headerShown: true,
          tabBarIcon: ({ color, size }) => (
            <History size={size || 24} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
