import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { BorderlessButton } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Transcript } from "~/features/call/transcript";
import type { TranscriptLine } from "~/features/call/transcript-assembler";
import { useConversation } from "~/features/conversations/use-conversations";
import { colors, spacing, typography } from "~/theme/tokens";

/**
 * A conversation, read back.
 *
 * The counterpart to the recorder: turns were posted as they completed, and
 * this is where they come back out. It renders through the SAME `Transcript`
 * as a live call - same type face, same spacing, same per-word treatment - so
 * yesterday's conversation looks like the one that just happened rather than
 * like a different feature.
 *
 * Read-only. Talking happens on the orb screen, against a NEW conversation; a
 * finished one is a record, not somewhere to resume.
 */
export default function ConversationScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data, isPending, error } = useConversation(id);

  /**
   * Stored turns wear the same shape as live ones. `seq` is unique within a
   * conversation, so it doubles as the list key - and it is what the server
   * ordered by, so the order here is the order they were spoken in.
   */
  const lines: TranscriptLine[] = useMemo(
    () =>
      data?.turns.map((turn) => ({
        id: String(turn.seq),
        role: turn.role,
        text: turn.text,
      })) ?? [],
    [data],
  );

  return (
    <View
      style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
    >
      <View style={styles.header}>
        <BorderlessButton
          style={styles.back}
          onPress={() => router.back()}
          rippleRadius={26}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Text style={styles.backGlyph}>{"‹"}</Text>
        </BorderlessButton>

        <Text style={styles.title} numberOfLines={1}>
          {data?.title ?? "Conversation"}
        </Text>
      </View>

      {isPending ? (
        <ActivityIndicator color={colors.muted} style={styles.notice} />
      ) : null}

      {error ? (
        <Text style={styles.notice}>
          {error instanceof Error ? error.message : "Could not load this conversation"}
        </Text>
      ) : null}

      {/*
        An ended conversation with no turns is a real state, not a bug: a call
        that connected and was hung up before anyone spoke stores nothing. Say
        so rather than showing an empty screen that looks like a failure.
      */}
      {!isPending && !error && lines.length === 0 ? (
        <Text style={styles.notice}>Nothing was said in this conversation.</Text>
      ) : null}

      <View style={styles.body}>
        <Transcript lines={lines} live={false} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  /** 48dp square, the same target as the voice screen's menu button. */
  back: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  backGlyph: {
    fontSize: 30,
    lineHeight: 34,
    color: colors.text,
  },
  title: {
    ...typography.title,
    color: colors.text,
    flex: 1,
    marginRight: spacing.md,
  },
  notice: {
    ...typography.body,
    color: colors.muted,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  body: {
    flex: 1,
  },
});
