import { CONVERSATION_TITLE_MAX_LENGTH, type ConversationSummary } from "@convo/shared";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { BorderlessButton } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing, typography } from "~/theme/tokens";
import {
  useConversations,
  useDeleteConversation,
  useRenameConversation,
} from "./use-conversations";

/**
 * The drawer's contents: search, the conversation list, and the two things a
 * user can do to a row.
 *
 * It fetches its OWN data rather than being handed it, which is what keeps the
 * search box cheap. The voice screen re-renders on every `activity` change -
 * several times a sentence - and if the search term or the query result lived
 * up there, every keystroke and every refetch would reconcile the whole drawer
 * panel behind the next tap. Here, none of that leaves this subtree.
 */

interface ConversationListProps {
  onNewChat: () => void;
  onSelect: (id: string) => void;
  onSignOut: () => void;
}

/** What an untitled conversation is called before its first user turn lands. */
const UNTITLED = "New conversation";

/**
 * Long enough that a normal typing speed sends one request per word rather
 * than one per letter; short enough that the list feels like it is tracking
 * what is being typed.
 */
const SEARCH_DEBOUNCE_MS = 250;

function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    // Every keystroke cancels the previous timer, so only a PAUSE in typing
    // reaches the server - that is the whole mechanism.
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}

/**
 * The rename field, as its own component so it MOUNTS when editing starts.
 *
 * That is the whole reason it is not just a branch inside the row: a `useState`
 * initialiser runs once per mount, so a draft held by the always-mounted row
 * would still hold whatever the title was when the drawer first rendered -
 * which is empty for a conversation that was untitled until its first turn
 * landed. Mounting fresh makes the initial value correct by construction.
 */
function RowEditor({
  initialTitle,
  onCommit,
  onCancel,
}: {
  initialTitle: string;
  onCommit: (title: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initialTitle);

  /**
   * Submitting also blurs, so both handlers fire for one rename. This makes
   * the second one a no-op rather than a second identical PATCH.
   */
  const committed = useRef(false);
  const commitOnce = (title: string) => {
    if (committed.current) return;
    committed.current = true;
    onCommit(title);
  };

  return (
    <View style={styles.row}>
      <TextInput
        style={styles.rowInput}
        value={draft}
        onChangeText={setDraft}
        placeholder={UNTITLED}
        placeholderTextColor={colors.muted}
        autoFocus
        selectTextOnFocus
        returnKeyType="done"
        maxLength={CONVERSATION_TITLE_MAX_LENGTH}
        /**
         * Commit on BOTH, and commit rather than cancel on blur: tapping away
         * from a half-typed title and losing it is the more annoying of the two
         * mistakes. An unchanged or empty draft is discarded by the handler, so
         * a stray tap costs nothing.
         */
        onSubmitEditing={() => commitOnce(draft)}
        onBlur={() => commitOnce(draft)}
      />
      <BorderlessButton
        style={styles.rowAction}
        onPress={onCancel}
        rippleRadius={20}
        accessibilityRole="button"
        accessibilityLabel="Cancel rename"
      >
        <Text style={styles.rowActionGlyph}>{"✕"}</Text>
      </BorderlessButton>
    </View>
  );
}

interface RowProps {
  conversation: ConversationSummary;
  editing: boolean;
  onSelect: (id: string) => void;
  onStartEditing: (conversation: ConversationSummary) => void;
  onCommitEditing: (id: string, title: string) => void;
  onCancelEditing: () => void;
  onDelete: (conversation: ConversationSummary) => void;
}

/**
 * One conversation.
 *
 * Tapping it opens the conversation; the `⋯` opens the two things that can be
 * done to it. A long-press does the same as the `⋯`, because a menu affordance
 * that small is easy to miss with a thumb - but the visible button is what
 * makes the feature discoverable at all, so both exist.
 */
const ConversationItem = memo(function ConversationItem({
  conversation,
  editing,
  onSelect,
  onStartEditing,
  onCommitEditing,
  onCancelEditing,
  onDelete,
}: RowProps) {
  const openMenu = useCallback(() => {
    Alert.alert(conversation.title ?? UNTITLED, undefined, [
      { text: "Rename", onPress: () => onStartEditing(conversation) },
      { text: "Delete", style: "destructive", onPress: () => onDelete(conversation) },
      { text: "Cancel", style: "cancel" },
    ]);
  }, [conversation, onStartEditing, onDelete]);

  if (editing) {
    return (
      <RowEditor
        initialTitle={conversation.title ?? ""}
        onCommit={(title) => onCommitEditing(conversation.id, title)}
        onCancel={onCancelEditing}
      />
    );
  }

  return (
    <View style={styles.row}>
      {/*
        Every row is identical - there is deliberately no "current chat"
        highlight. The design calls for one flat list, not a main chat plus
        side chats.
      */}
      <Pressable
        style={styles.rowLabelSlot}
        onPress={() => onSelect(conversation.id)}
        onLongPress={openMenu}
        accessibilityRole="button"
      >
        <Text style={styles.rowLabel} numberOfLines={1}>
          {conversation.title ?? UNTITLED}
        </Text>
      </Pressable>

      <BorderlessButton
        style={styles.rowAction}
        onPress={openMenu}
        rippleRadius={20}
        accessibilityRole="button"
        accessibilityLabel={`Options for ${conversation.title ?? UNTITLED}`}
      >
        <Text style={styles.rowActionGlyph}>{"⋯"}</Text>
      </BorderlessButton>
    </View>
  );
});

export function ConversationList({
  onNewChat,
  onSelect,
  onSignOut,
}: ConversationListProps) {
  const insets = useSafeAreaInsets();
  const [editingId, setEditingId] = useState<string | null>(null);

  /**
   * Two pieces of state for one box: what is on screen, and what has been
   * asked for. Typing updates the first immediately (a text field that lags
   * the keyboard feels broken) and the second only after a pause.
   */
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, SEARCH_DEBOUNCE_MS);

  const { conversations, isPending, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useConversations(debouncedSearch);

  const rename = useRenameConversation();
  const remove = useDeleteConversation();

  const searching = debouncedSearch.trim().length > 0;

  const startEditing = useCallback((conversation: ConversationSummary) => {
    setEditingId(conversation.id);
  }, []);

  const cancelEditing = useCallback(() => setEditingId(null), []);

  const commitEditing = useCallback(
    (id: string, title: string) => {
      setEditingId(null);

      const trimmed = title.trim();
      // The server would reject an empty title with a 422, and a rename to the
      // same string is a request worth not sending at all.
      if (trimmed.length === 0) return;

      const current = conversations.find((row) => row.id === id);
      if (current?.title === trimmed) return;

      rename.mutate({ id, title: trimmed });
    },
    [conversations, rename.mutate],
  );

  const confirmDelete = useCallback(
    (conversation: ConversationSummary) => {
      Alert.alert(
        "Delete conversation?",
        `"${conversation.title ?? UNTITLED}" and everything said in it will be erased.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => remove.mutate(conversation.id),
          },
        ],
      );
    },
    [remove.mutate],
  );

  /**
   * Read through a REF rather than closed over: `isFetchingNextPage` flips
   * twice per page, and `onEndReached` fires on any bounce at the bottom of a
   * short list. Asking for a page that is already being fetched would spend a
   * request to be told the same thing again.
   */
  const pagingRef = useRef({ hasNextPage, isFetchingNextPage, fetchNextPage });
  pagingRef.current = { hasNextPage, isFetchingNextPage, fetchNextPage };

  const onEndReached = useCallback(() => {
    const paging = pagingRef.current;
    if (paging.hasNextPage && !paging.isFetchingNextPage) void paging.fetchNextPage();
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: ConversationSummary }) => (
      <ConversationItem
        conversation={item}
        editing={item.id === editingId}
        onSelect={onSelect}
        onStartEditing={startEditing}
        onCommitEditing={commitEditing}
        onCancelEditing={cancelEditing}
        onDelete={confirmDelete}
      />
    ),
    [editingId, onSelect, startEditing, commitEditing, cancelEditing, confirmDelete],
  );

  return (
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

      <View style={styles.search}>
        <Text style={styles.searchGlyph}>{"⌕"}</Text>
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search chats"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search conversations"
        />
        {search.length > 0 ? (
          <BorderlessButton
            style={styles.rowAction}
            onPress={() => setSearch("")}
            rippleRadius={20}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
          >
            <Text style={styles.rowActionGlyph}>{"✕"}</Text>
          </BorderlessButton>
        ) : null}
      </View>

      <FlatList
        style={styles.list}
        data={conversations}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        showsVerticalScrollIndicator={false}
        // Keyset paginated, and the server pages the MATCHES - so this works
        // the same whether or not a search is running.
        onEndReached={onEndReached}
        onEndReachedThreshold={0.4}
        // Otherwise a tap on a row while the keyboard is up only dismisses the
        // keyboard, and the row itself is never pressed.
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          isPending ? (
            <ActivityIndicator style={styles.empty} color={colors.muted} />
          ) : (
            <Text style={styles.empty}>
              {searching ? "No chats match that" : "No conversations yet"}
            </Text>
          )
        }
      />

      <Pressable style={styles.signOut} onPress={onSignOut} accessibilityRole="button">
        <Text style={styles.signOutLabel}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const keyExtractor = (item: ConversationSummary) => item.id;

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
  search: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.md,
    paddingLeft: spacing.sm,
    borderRadius: 10,
    backgroundColor: colors.background,
  },
  searchGlyph: {
    fontSize: 18,
    color: colors.muted,
  },
  searchInput: {
    ...typography.body,
    flex: 1,
    color: colors.text,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  list: {
    flex: 1,
    marginTop: spacing.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  rowLabelSlot: {
    flex: 1,
    paddingVertical: spacing.md,
  },
  rowLabel: {
    ...typography.body,
    color: colors.text,
  },
  /** 40dp square, which is the smallest comfortable target inside a list row. */
  rowAction: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  rowActionGlyph: {
    fontSize: 18,
    color: colors.muted,
  },
  rowInput: {
    ...typography.body,
    flex: 1,
    color: colors.text,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
    backgroundColor: colors.background,
  },
  empty: {
    ...typography.body,
    color: colors.muted,
    paddingVertical: spacing.md,
  },
  signOut: {
    paddingVertical: spacing.md,
  },
  signOutLabel: {
    ...typography.body,
    color: colors.muted,
  },
});
