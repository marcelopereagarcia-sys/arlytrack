/**
 * Configuración raíz de la aplicación MotoTrack (app/_layout.tsx).
 * Importa el servicio de rastreo para garantizar el registro del TaskManager en segundo plano,
 * configura el tema oscuro nativo y la barra de estado.
 */

import React, { useEffect } from 'react';
import { LogBox } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { DarkTheme, ThemeProvider } from 'expo-router/react-navigation';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import 'react-native-reanimated';

// Silenciar advertencia informativa de Expo Go sobre background location en Android
LogBox.ignoreLogs(['Background location is limited in Expo Go']);

// Importar servicio de rastreo para registrar la tarea en segundo plano al arrancar la app
import '@/services/tracker';
import { MotoColors } from '@/constants/Colors';

export {
  // Captura de errores del árbol de navegación
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

// Evitar que la pantalla de splash se oculte antes de cargar los recursos
SplashScreen.preventAutoHideAsync();

const MotoNavigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: MotoColors.primary,
    background: MotoColors.background,
    card: MotoColors.surface,
    text: MotoColors.text,
    border: MotoColors.border,
    notification: MotoColors.primary,
  },
};

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return <RootLayoutNav />;
}

function RootLayoutNav() {
  return (
    <ThemeProvider value={MotoNavigationTheme}>
      <StatusBar style="light" />
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="modal"
          options={{
            presentation: 'modal',
            title: 'Información',
            headerStyle: { backgroundColor: MotoColors.background },
            headerTintColor: MotoColors.text,
          }}
        />
      </Stack>
    </ThemeProvider>
  );
}
