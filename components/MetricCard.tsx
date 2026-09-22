/**
 * Componente de tarjeta de métrica de telemetría para MotoTrack.
 * Diseño inspirado en cuadros de instrumentos TFT de motocicletas.
 * Estructura en 3 niveles verticales (Categoría -> Gran Cifra -> Sub-métrica) para eliminar colisiones de texto.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MotoColors } from '@/constants/Colors';

interface MetricCardProps {
  label: string;
  value: string | number;
  unit?: string;
  subValue?: string;
  accentColor?: string;
  icon?: React.ReactNode;
  isProminent?: boolean;
}

function MetricCardComponent({
  label,
  value,
  unit,
  subValue,
  accentColor = MotoColors.primary,
  icon,
  isProminent = false,
}: MetricCardProps) {
  return (
    <View style={[styles.container, isProminent && styles.prominentContainer]}>
      {/* 1. Nivel Superior: Icono y Etiqueta de Categoría */}
      <View style={styles.topRow}>
        <View style={styles.labelGroup}>
          {icon && <View style={styles.iconBox}>{icon}</View>}
          <Text style={styles.label} numberOfLines={1}>
            {label.toUpperCase()}
          </Text>
        </View>
      </View>

      {/* 2. Nivel Central: Gran Cifra y Unidad de Medida */}
      <View style={styles.valueRow}>
        <Text
          numberOfLines={1}
          style={[
            styles.valueText,
            isProminent ? styles.prominentValueText : null,
            { color: isProminent ? accentColor : MotoColors.text },
          ]}>
          {value}
        </Text>
        {unit ? <Text style={styles.unitText}>{unit}</Text> : null}
      </View>

      {/* 3. Nivel Inferior: Sub-métrica / Telemetría Secundaria en micro-pastilla */}
      {subValue ? (
        <View style={styles.bottomRow}>
          <View style={[styles.subValueBadge, { borderColor: accentColor + '40' }]}>
            <Text style={[styles.subValueText, { color: accentColor }]} numberOfLines={1}>
              {subValue}
            </Text>
          </View>
        </View>
      ) : (
        <View style={styles.bottomSpacer} />
      )}
    </View>
  );
}

export const MetricCard = React.memo(MetricCardComponent, (prev, next) => {
  return (
    prev.label === next.label &&
    prev.value === next.value &&
    prev.unit === next.unit &&
    prev.subValue === next.subValue &&
    prev.accentColor === next.accentColor &&
    prev.isProminent === next.isProminent
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: MotoColors.surface,
    borderColor: MotoColors.border,
    borderWidth: 1.5,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 88,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
  },
  prominentContainer: {
    borderColor: 'rgba(0, 240, 255, 0.45)',
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  labelGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  iconBox: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    color: MotoColors.textSecondary,
    fontSize: 11.5,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    marginVertical: 2,
  },
  valueText: {
    fontSize: 28,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.5,
  },
  prominentValueText: {
    fontSize: 34,
  },
  unitText: {
    color: MotoColors.textSecondary,
    fontSize: 13.5,
    fontWeight: '700',
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  subValueBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  subValueText: {
    fontSize: 10.5,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.3,
  },
  bottomSpacer: {
    height: 14,
  },
});
