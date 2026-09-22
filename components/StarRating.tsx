/**
 * Componente táctil de calificación de 1 a 5 estrellas con iconos de Lucide.
 * Apto para interacción con guantes de moto (área táctil amplia).
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Star } from 'lucide-react-native';
import { MotoColors } from '@/constants/Colors';

interface StarRatingProps {
  label?: string;
  rating: number;
  onRatingChange?: (rating: number) => void;
  size?: number;
  readonly?: boolean;
  showScoreText?: boolean;
}

const RATING_DESCRIPTIONS: Record<number, string> = {
  1: 'Malo',
  2: 'Regular',
  3: 'Aceptable',
  4: 'Muy bueno',
  5: 'Espectacular',
};

export function StarRating({
  label,
  rating,
  onRatingChange,
  size = 32,
  readonly = false,
  showScoreText = true,
}: StarRatingProps) {
  const stars = [1, 2, 3, 4, 5];

  return (
    <View style={styles.container}>
      {label ? (
        <View style={styles.labelRow}>
          <Text style={styles.label}>{label}</Text>
          {showScoreText && rating > 0 ? (
            <Text style={styles.scoreText}>
              {rating}/5 · {RATING_DESCRIPTIONS[rating] || ''}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View style={styles.starsRow}>
        {stars.map((star) => {
          const isFilled = star <= rating;

          if (readonly) {
            return (
              <View key={star} style={styles.starWrapper}>
                <Star
                  size={size}
                  color={isFilled ? MotoColors.star : MotoColors.borderLight}
                  fill={isFilled ? MotoColors.star : 'transparent'}
                />
              </View>
            );
          }

          return (
            <Pressable
              key={star}
              onPress={() => onRatingChange?.(star)}
              hitSlop={10}
              style={({ pressed }) => [
                styles.starButton,
                pressed && styles.starButtonPressed,
              ]}>
              <Star
                size={size}
                color={isFilled ? MotoColors.star : MotoColors.borderLight}
                fill={isFilled ? MotoColors.star : 'transparent'}
              />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 6,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  label: {
    color: MotoColors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  scoreText: {
    color: MotoColors.star,
    fontSize: 13,
    fontWeight: '700',
  },
  starsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  starButton: {
    padding: 6,
    borderRadius: 8,
  },
  starButtonPressed: {
    transform: [{ scale: 1.15 }],
    backgroundColor: 'rgba(251, 191, 36, 0.15)',
  },
  starWrapper: {
    padding: 2,
  },
});
