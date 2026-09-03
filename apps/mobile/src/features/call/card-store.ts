import type { ShowCardArgs } from "@convo/ai";
import type { WebSearchResult } from "@convo/shared";
import { create } from "zustand";

/**
 * The card the model asked to show, and nothing else.
 *
 * A store of its own rather than a field on `call-store`, for the reason
 * `conversation-list` is not part of `sidebar`: the voice screen re-renders
 * several times a sentence, and anything sharing a store with the phase machine
 * is reconciled on every one of those. The card subscribes to this and the orb
 * never hears about it.
 *
 * zustand only - no React Native import - so the timing rule below is testable.
 */

/** Two is a glance. Four is a page, and nobody reads a page mid-conversation. */
export const CARD_SNIPPETS = 2;
/** Long enough to carry a fact, short enough not to become the transcript. */
export const CARD_SNIPPET_MAX_LENGTH = 140;
export const CARD_SOURCES = 3;

/**
 * Long enough to read a temperature and a line of context without hurrying,
 * short enough that a card from four questions ago is never still sitting over
 * the transcript.
 */
export const CARD_VISIBLE_MS = 14_000;

export interface CardSource {
  label: string;
  url: string;
}

export interface ResultCard {
  /** The searchId it was built from. Also what makes showing it twice a no-op. */
  id: string;
  title: string;
  subtitle: string;
  snippets: readonly string[];
  sources: readonly CardSource[];
}

export interface CardState {
  card: ResultCard | null;
  show: (card: ResultCard) => void;
  /** Passing an id dismisses only that card, so a stale timer cannot close a new one. */
  dismiss: (id?: string) => void;
}

/**
 * Module scope, like `amplitude.ts`'s shared value: there is one screen and one
 * card, and threading a timer handle through the store's state would put a
 * value in it that no component ever renders.
 */
let hideTimer: ReturnType<typeof setTimeout> | null = null;

export const useCardStore = create<CardState>((set, get) => ({
  card: null,

  show: (card) => {
    if (hideTimer) clearTimeout(hideTimer);
    set({ card });

    hideTimer = setTimeout(() => {
      hideTimer = null;
      // Only if it is still the same card. Without this an old timer firing
      // after a second search closes the card the user is currently reading.
      if (get().card?.id === card.id) set({ card: null });
    }, CARD_VISIBLE_MS);
  },

  dismiss: (id) => {
    if (id !== undefined && get().card?.id !== id) return;
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    set({ card: null });
  },
}));

/** Read it outside React - the tool dispatch needs this in a callback, not a render. */
export function showResultCard(card: ResultCard): void {
  useCardStore.getState().show(card);
}

export function dismissResultCard(): void {
  useCardStore.getState().dismiss();
}

/**
 * `web_search` result + the model's headline -> what goes on screen.
 *
 * Pure and separate from the store so the trimming rules are asserted rather
 * than eyeballed on a phone.
 */
export function toResultCard(
  result: WebSearchResult,
  args: Pick<ShowCardArgs, "title" | "subtitle">,
): ResultCard {
  const snippets = result.results
    .map((hit) => hit.snippet.trim())
    .filter((snippet) => snippet.length > 0)
    .slice(0, CARD_SNIPPETS)
    .map(truncate);

  const sources: CardSource[] = [];
  const seen = new Set<string>();

  for (const hit of result.results) {
    const label = hostOf(hit.url);
    if (seen.has(label)) continue;
    seen.add(label);
    sources.push({ label, url: hit.url });
    if (sources.length === CARD_SOURCES) break;
  }

  return {
    id: result.searchId,
    title: args.title,
    subtitle: args.subtitle,
    snippets,
    sources,
  };
}

function truncate(text: string): string {
  return text.length > CARD_SNIPPET_MAX_LENGTH
    ? `${text.slice(0, CARD_SNIPPET_MAX_LENGTH - 1).trimEnd()}…`
    : text;
}

/**
 * The host, parsed by hand.
 *
 * `new URL()` is NOT safe here. React Native ships a partial implementation -
 * the same one whose `URLSearchParams` throws on `set`, `get` and `delete`, and
 * which is why query strings in `lib/api` are built by hand. A regex cannot
 * throw on a phone in the middle of a call.
 */
function hostOf(url: string): string {
  const match = /^https?:\/\/([^/?#]+)/i.exec(url.trim());
  const host = match?.[1];
  if (!host) return url;

  return host.replace(/^www\./i, "").replace(/:\d+$/, "");
}
