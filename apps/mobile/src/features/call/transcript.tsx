import { FlashList } from "@shopify/flash-list";
import { memo, useCallback, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { StreamdownText } from "react-native-streamdown";
import { colors, spacing, typography } from "~/theme/tokens";
import type { TranscriptLine } from "./transcript-assembler";

/**
 * Re-exported so callers still say `from "~/features/call/transcript"`. The
 * shape itself belongs with the reducer that builds it, not with the view.
 */
export type { TranscriptLine };

interface TranscriptProps {
  lines: readonly TranscriptLine[];
}

/**
 * The spoken text, newest at the bottom, older lines scrolling up.
 *
 * Voice mode, not chat: no bubbles, no avatars, no timestamps. The only thing
 * distinguishing who said what is colour, because a transcript glanced at
 * mid-sentence has to be readable in one look.
 *
 * `StreamdownText` rather than a plain `Text`: it parses on a WORKLET thread, so
 * a busy JS thread cannot stutter the reveal. That is what Bundle Mode is for,
 * and rendering through it here is what proves Bundle Mode actually works on
 * the device rather than merely being configured.
 */
function TranscriptComponent({ lines }: TranscriptProps) {
  /** Two frozen style objects rather than one built per row - this list re-renders per token. */
  const styleFor = useMemo(
    () => ({
      user: { paragraph: { ...typography.transcript, color: colors.muted } },
      assistant: { paragraph: { ...typography.transcript, color: colors.text } },
    }),
    [],
  );

  const renderItem = useCallback(
    ({ item }: { item: TranscriptLine }) => (
      <View style={styles.line}>
        <StreamdownText
          markdown={item.text}
          markdownStyle={styleFor[item.role]}
          /**
           * Native, and animates only the newly appended tail - which is why
           * the per-word fade costs nothing as the transcript grows.
           */
          streamingAnimation={item.role === "assistant"}
          selectable={false}
        />
      </View>
    ),
    [styleFor],
  );

  return (
    <FlashList
      data={lines as TranscriptLine[]}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      /**
       * This IS the "pause when the user scrolls up, resume at the bottom"
       * behaviour. Do NOT add an onScroll handler to reimplement it - a JS-side
       * handler would fight this one and stutter under load.
       */
      maintainVisibleContentPosition={{
        autoscrollToBottomThreshold: 0.2,
        startRenderingFromBottom: true,
      }}
    />
  );
}

const keyExtractor = (item: TranscriptLine) => item.id;

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  line: {
    paddingVertical: spacing.sm,
  },
});

export const Transcript = memo(TranscriptComponent);
