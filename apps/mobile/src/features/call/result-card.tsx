import { memo, useEffect } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { BorderlessButton } from "react-native-gesture-handler";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useCardStore } from "~/features/call/card-store";
import { colors, spacing, typography } from "~/theme/tokens";

/**
 * What `show_card` puts on screen.
 *
 * The first overlay in this app, so it sets the pattern: depth comes from
 * `colors.surface` over `colors.background` and an accent rule, NOT from a
 * shadow - there is no elevation anywhere else here and one card should not
 * introduce it.
 *
 * It subscribes to `card-store` with one selector, and to nothing else. The
 * voice screen re-renders several times a sentence; none of those reach this,
 * and none of this reaches the orb.
 */

const ENTER_MS = 220;

export const ResultCard = memo(function ResultCard() {
  const card = useCardStore((state) => state.card);
  const dismiss = useCardStore((state) => state.dismiss);

  // Rendering nothing keeps the animation below from running on an empty card,
  // and keeps the card out of the tree entirely while there is none.
  if (!card) return null;

  return <Card key={card.id} onDismiss={dismiss} card={card} />;
});

/**
 * Split out and keyed on `card.id` so a NEW card gets a fresh mount and
 * therefore a fresh entrance. Animating in place would slide the old text
 * upward while the new text is already in it.
 */
function Card({
  card,
  onDismiss,
}: {
  card: NonNullable<ReturnType<typeof useCardStore.getState>["card"]>;
  onDismiss: () => void;
}) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(1, {
      duration: ENTER_MS,
      easing: Easing.out(Easing.cubic),
    });
  }, [progress]);

  /**
   * On the UI thread, like the orb. The card arrives in the middle of a spoken
   * reply, which is the busiest the JS thread ever is - an entrance driven from
   * JS would stutter exactly when it is most visible.
   */
  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 16 }],
  }));

  /**
   * No exit animation, deliberately. Playing one means keeping the card mounted
   * after the store says it is gone, which needs `runOnJS` to clear it and a
   * rule for what happens when a second card arrives mid-fade. A tap that makes
   * something vanish immediately reads as responsive; the entrance is where the
   * animation earns its place.
   */
  const close = () => onDismiss();

  return (
    <Animated.View style={[styles.wrap, style]} pointerEvents="box-none">
      <View style={styles.card}>
        <View style={styles.rule} />

        <View style={styles.body}>
          <View style={styles.headerRow}>
            <Text style={styles.title} numberOfLines={1}>
              {card.title}
            </Text>
            <BorderlessButton
              onPress={close}
              rippleRadius={20}
              style={styles.close}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.closeGlyph}>{"✕"}</Text>
            </BorderlessButton>
          </View>

          <Text style={styles.subtitle} numberOfLines={2}>
            {card.subtitle}
          </Text>

          {card.snippets.map((snippet) => (
            <Text key={snippet} style={styles.snippet} numberOfLines={3}>
              {snippet}
            </Text>
          ))}

          {card.sources.length > 0 && (
            <View style={styles.sources}>
              {card.sources.map((source) => (
                <Pressable
                  key={source.url}
                  onPress={() => {
                    // A dead link must not take the call down with it.
                    void Linking.openURL(source.url).catch(() => {});
                  }}
                  style={styles.source}
                >
                  <Text style={styles.sourceLabel}>{source.label}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  /**
   * Absolute, above the transcript, below nothing. The menu button owns
   * zIndex 1, so this takes 2 - and `box-none` lets taps through everywhere the
   * card itself is not, so the orb underneath stays pressable.
   */
  wrap: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
    zIndex: 2,
  },
  card: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: 10,
    overflow: "hidden",
  },
  /** The orb's green, as a rule down the edge. This is what ties it to the app. */
  rule: {
    width: 4,
    backgroundColor: colors.accent,
  },
  body: {
    flex: 1,
    padding: spacing.md,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  title: {
    ...typography.caption,
    color: colors.muted,
    flex: 1,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  close: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    marginRight: -spacing.sm,
    marginTop: -spacing.sm,
  },
  closeGlyph: {
    fontSize: 15,
    color: colors.muted,
  },
  /** The answer. Accent-coloured because it is the one thing worth a glance. */
  subtitle: {
    fontSize: 26,
    lineHeight: 32,
    color: colors.accent,
    fontWeight: "600",
    marginTop: spacing.xs,
  },
  snippet: {
    ...typography.body,
    color: colors.text,
    marginTop: spacing.sm,
  },
  sources: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: spacing.md,
  },
  source: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.muted,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    marginRight: spacing.sm,
    marginTop: spacing.xs,
  },
  sourceLabel: {
    ...typography.caption,
    color: colors.muted,
  },
});
