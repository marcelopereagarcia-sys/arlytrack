/**
 * Paleta de colores "Electric Motorsport" para MotoTrack.
 * Inspirada en cuadros de instrumentos digitales de alta competición (Formula E, MotoE, TFT Motorsport).
 * Diseñada para máxima visibilidad en conducción, contraste elevado bajo luz solar y estética técnica deportiva.
 */

const tintColorLight = '#00F0FF';
const tintColorDark = '#00F0FF';

export const MotoColors = {
  // 1. Fondos y superficies de panel (Carbón profundo y negro deportivo)
  background: '#0B0E14',       // Asfalto / carbón profundo
  surface: '#161B26',          // Superficie panel HUD / tarjetas
  surfaceLight: '#1F2637',     // Superficie secundaria
  surfaceElevated: '#263044',  // Botones flotantes y superficies activas
  border: '#263044',           // Borde técnico de 1.5px
  borderLight: '#374560',      // Borde enfocado
  borderGlow: 'rgba(0, 240, 255, 0.4)', // Resplandor cian neón

  // 2. Acento Primario: Cian Neón
  primary: '#00F0FF',          // Cian Neón oficial
  primaryHover: '#00D2E0',
  primaryDark: '#00B8C7',
  primaryGlow: 'rgba(0, 240, 255, 0.28)',

  // 3. Acentos de Competición Eléctrica
  lime: '#39FF14',             // Verde Lima Flúor (Iniciar / Reanudar / Salida)
  recording: '#FF0055',        // Rojo Láser Neón (Grabación activa / Meta)
  cyan: '#00F0FF',             // Cian Neón (Velocidad / Desnivel / Telemetría)
  amber: '#FFB800',            // Ámbar Neón (Pausa / Modo Descanso)

  // 4. Tipografía y Datos de Alto Contraste (Cumplimiento WCAG AA bajo luz solar)
  text: '#FFFFFF',             // Blanco absoluto para métricas clave
  textSecondary: '#CBD5E1',    // Gris metálico de alto contraste (11.2:1) para etiquetas
  textMuted: '#94A3B8',        // Gris claro legible (7.05:1 > 4.5:1 WCAG AA) para unidades

  // 5. Estados y Acciones Táctiles Glove-Friendly
  success: '#39FF14',          // Verde Lima Flúor (Iniciar / Reanudar)
  successDark: '#2CC810',
  danger: '#FF0055',           // Rojo Láser Neón (Finalizar / Parada / Descartar)
  dangerDark: '#D60047',
  warning: '#FFB800',          // Ámbar Neón (Pausa / Descanso)
  warningDark: '#D49A00',
  star: '#FFB800',             // Estrellas de valoración
};

export default {
  light: {
    text: MotoColors.text,
    background: MotoColors.background,
    tint: tintColorLight,
    tabIconDefault: '#64748B',
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: MotoColors.text,
    background: MotoColors.background,
    tint: tintColorDark,
    tabIconDefault: '#64748B',
    tabIconSelected: tintColorDark,
  },
};
