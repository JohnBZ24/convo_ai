import type { ConversationSummary } from "@convo/shared";
import {
  type InfiniteData,
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useMemo } from "react";
import { useAuthStore } from "~/features/auth/auth-store";
import {
  type ConversationPage,
  deleteConversation,
  fetchConversation,
  listConversations,
  renameConversation,
} from "~/lib/api/conversations";

/**
 * The sidebar's data, and the two things a user can do to a row.
 *
 * TanStack Query was wired into `_layout.tsx` in iteration 4 with zero
 * `useQuery` calls; this is the first one. It brings the cache bridges that
 * were already set up there into use - a refetch when the app comes back to
 * the foreground, and a pause while it believes it is offline.
 */

/**
 * One place that knows the shape of every key, so an invalidation cannot miss
 * a query by spelling its key slightly differently somewhere else.
 */
export const conversationKeys = {
  all: ["conversations"] as const,
  /**
   * The PREFIX every list shares. Each search term caches separately under it,
   * so `lists()` is what an invalidation targets - it matches the unfiltered
   * list and every search at once, which is what a rename or a delete has to
   * reach.
   */
  lists: () => [...conversationKeys.all, "list"] as const,
  list: (query: string) => [...conversationKeys.lists(), query] as const,
  detail: (id: string) => [...conversationKeys.all, "detail", id] as const,
};

/** How many rows one page of the sidebar asks for. */
const PAGE_SIZE = 30;

/**
 * The conversation list, newest first, paged by cursor.
 *
 * `useInfiniteQuery` rather than `useQuery`, because the endpoint is keyset
 * paginated and the sidebar is a list the user scrolls while new conversations
 * are being written above it. The cursor names a POSITION, so starting a call
 * mid-scroll cannot make the next page repeat a row.
 *
 * `search` narrows it SERVER-SIDE. Filtering the loaded pages here instead
 * would only ever match titles - the words are on the server - so "what was
 * that thing about the boiler" could not find a conversation called something
 * else. It would also break "load more", because a page of thirty rows might
 * hold two matches.
 */
export function useConversations(search = "") {
  const token = useAuthStore((state) => state.token);
  const term = search.trim();

  const query = useInfiniteQuery({
    queryKey: conversationKeys.list(term),
    enabled: Boolean(token),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      if (!token) throw new Error("Not signed in");
      return listConversations(token, {
        limit: PAGE_SIZE,
        cursor: pageParam,
        // Undefined rather than "": the server rejects an empty `q`, because a
        // search that silently means "everything" is the failure mode worth
        // refusing outright.
        q: term.length > 0 ? term : undefined,
      });
    },
    // A null cursor is the server saying there is no more; returning undefined
    // is what tells TanStack Query to stop offering `fetchNextPage`.
    getNextPageParam: (last: ConversationPage) => last.nextCursor ?? undefined,
    /**
     * Keeps the previous term's rows on screen while the next term loads, so
     * typing narrows a list instead of flashing it empty between keystrokes.
     */
    placeholderData: keepPreviousData,
  });

  /**
   * `useMemo`, and it is load-bearing rather than a micro-optimisation.
   *
   * The voice screen re-renders on every `activity` change - several times a
   * sentence - and passes this array to a MEMOISED `Sidebar`. A fresh array
   * identity each render defeats that memo and reconciles the whole drawer
   * panel behind the next tap, which is the exact problem iteration 4 measured
   * and fixed. Flattening once per data change keeps the identity stable.
   */
  const conversations: ConversationSummary[] = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );

  return { ...query, conversations };
}

/** One conversation with every turn - what the history screen renders. */
export function useConversation(id: string | undefined) {
  const token = useAuthStore((state) => state.token);

  return useQuery({
    queryKey: conversationKeys.detail(id ?? ""),
    enabled: Boolean(token) && Boolean(id),
    queryFn: () => {
      if (!token || !id) throw new Error("Not signed in");
      return fetchConversation(token, id);
    },
  });
}

export function useRenameConversation() {
  const token = useAuthStore((state) => state.token);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => {
      if (!token) throw new Error("Not signed in");
      return renameConversation(token, id, title);
    },

    /**
     * Optimistic, because the user is watching the row they just renamed. A
     * round trip to a laptop on the same Wi-Fi is fast, but "fast" and
     * "instant" read differently when the new title is the only feedback that
     * the rename happened at all.
     */
    onMutate: async ({ id, title }) => {
      await queryClient.cancelQueries({ queryKey: conversationKeys.lists() });

      /**
       * `setQueriesData`, PLURAL. Every search term is its own cache entry, so
       * a single `setQueryData` on the prefix would match none of them - the
       * renamed row would keep its old title until a refetch, in whichever
       * list the user was not looking at.
       */
      const previous = queryClient.getQueriesData<InfiniteData<ConversationPage>>({
        queryKey: conversationKeys.lists(),
      });

      queryClient.setQueriesData<InfiniteData<ConversationPage>>(
        { queryKey: conversationKeys.lists() },
        (current) =>
          current && mapConversations(current, id, (row) => ({ ...row, title })),
      );

      return { previous };
    },

    onError: (_error, _variables, context) => {
      // Put the old title back rather than leaving a rename that never landed.
      for (const [key, data] of context?.previous ?? []) {
        queryClient.setQueryData(key, data);
      }
    },

    onSettled: (_data, _error, { id }) => {
      void queryClient.invalidateQueries({ queryKey: conversationKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: conversationKeys.detail(id) });
    },
  });
}

export function useDeleteConversation() {
  const token = useAuthStore((state) => state.token);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => {
      if (!token) throw new Error("Not signed in");
      return deleteConversation(token, id);
    },

    /** Optimistic for the same reason as the rename: the row is on screen. */
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: conversationKeys.lists() });

      // Plural, for the same reason as the rename: the row has to vanish from
      // the unfiltered list and from every search that was showing it.
      const previous = queryClient.getQueriesData<InfiniteData<ConversationPage>>({
        queryKey: conversationKeys.lists(),
      });

      queryClient.setQueriesData<InfiniteData<ConversationPage>>(
        { queryKey: conversationKeys.lists() },
        (current) => current && removeConversation(current, id),
      );

      return { previous };
    },

    onError: (_error, _id, context) => {
      for (const [key, data] of context?.previous ?? []) {
        queryClient.setQueryData(key, data);
      }
    },

    onSettled: (_data, _error, id) => {
      void queryClient.invalidateQueries({ queryKey: conversationKeys.lists() });
      // The detail is gone with it; drop it rather than refetching a 404.
      queryClient.removeQueries({ queryKey: conversationKeys.detail(id) });
    },
  });
}

/**
 * Rewrite one row wherever it sits across the loaded pages.
 *
 * Every page is rebuilt rather than mutated: an infinite query's cache entry is
 * read by React, and editing it in place is a change React cannot see.
 */
function mapConversations(
  data: InfiniteData<ConversationPage>,
  id: string,
  change: (row: ConversationSummary) => ConversationSummary,
): InfiniteData<ConversationPage> {
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.map((row) => (row.id === id ? change(row) : row)),
    })),
  };
}

function removeConversation(
  data: InfiniteData<ConversationPage>,
  id: string,
): InfiniteData<ConversationPage> {
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.filter((row) => row.id !== id),
    })),
  };
}
