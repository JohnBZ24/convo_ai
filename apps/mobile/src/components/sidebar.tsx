import type { ReactNode } from "react";
import { forwardRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import ReanimatedDrawerLayout, {
  type DrawerLayoutMethods,
  DrawerPosition,
  DrawerType,
} from "react-native-gesture-handler/ReanimatedDrawerLayout";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing, typography } from "~/theme/tokens";

export interface ConversationRow {
  id: string;
  title: string | null;
}

interface SidebarProps {
  conversations: readonly ConversationRow[];
  onNewChat: () => void;
  onSelect: (id: string) => void;
  onSignOut: () => void;
  children: ReactNode;
}

/**
 * ChatGPT-mobile style: the drawer slides OVER the content on a left-edge
 * swipe rather than pushing it aside - hence `DrawerType.FRONT`.
 *
 * ReanimatedDrawerLayout, not a JS drawer: the gesture and the translation both
 * run on the UI thread, so the swipe cannot stutter while React is rendering a
 * transcript. That is the entire reason for the dependency.
 */
export const Sidebar = forwardRef<DrawerLayoutMethods, SidebarProps>(function Sidebar(
  { conversations, onNewChat, onSelect, onSignOut, children },
  ref,
) {
  const insets = useSafeAreaInsets();

  const renderNavigationView = () => (
    <View
      style={[
        styles.panel,
        {
          paddingTop: insets.top + spacing.md,
          paddingBottom: insets.bottom + spacing.md,
        },
      ]}
    >
      <Pressable style={styles.newChat} onPress={onNewChat} accessibilityRole="button">
        <Text style={styles.newChatLabel}>New chat</Text>
      </Pressable>

      <View style={styles.list}>
        {conversations.map((conversation) => (
          <Pressable
            key={conversation.id}
            style={styles.row}
            onPress={() => onSelect(conversation.id)}
            accessibilityRole="button"
          >
            {/*
              Every row is identical - there is deliberately no "current chat"
              highlight. The design calls for one flat list, not a main chat
              plus side chats.
            */}
            <Text style={styles.rowLabel} numberOfLines={1}>
              {conversation.title ?? "New conversation"}
            </Text>
          </Pressable>
        ))}
      </View>

      <Pressable style={styles.signOut} onPress={onSignOut} accessibilityRole="button">
        <Text style={styles.signOutLabel}>Sign out</Text>
      </Pressable>
    </View>
  );

  return (
    <ReanimatedDrawerLayout
      ref={ref}
      renderNavigationView={renderNavigationView}
      drawerWidth={300}
      drawerType={DrawerType.FRONT}
      drawerPosition={DrawerPosition.LEFT}
      overlayColor={colors.scrim}
      /** Wide enough to catch a thumb on a 411dp screen without stealing taps. */
      edgeWidth={48}
    >
      {children}
    </ReanimatedDrawerLayout>
  );
});

const styles = StyleSheet.create({
  panel: {
    flex: 1,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
  },
  newChat: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  newChatLabel: {
    ...typography.title,
    color: colors.accent,
    fontWeight: "600",
  },
  list: {
    flex: 1,
    marginTop: spacing.lg,
  },
  row: {
    paddingVertical: spacing.md,
  },
  rowLabel: {
    ...typography.body,
    color: colors.text,
  },
  signOut: {
    paddingVertical: spacing.md,
  },
  signOutLabel: {
    ...typography.body,
    color: colors.muted,
  },
});
