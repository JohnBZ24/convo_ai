import type { WebSearchResult } from "@convo/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CARD_SNIPPET_MAX_LENGTH,
  CARD_SNIPPETS,
  CARD_SOURCES,
  CARD_VISIBLE_MS,
  type ResultCard,
  toResultCard,
  useCardStore,
} from "./card-store";

function hit(url: string, snippet = "Something worth reading.") {
  return { title: "T", url, snippet, publishedDate: null, favicon: null };
}

function searchResult(hits: ReturnType<typeof hit>[]): WebSearchResult {
  return { searchId: "ws_1", query: "beirut weather", results: hits };
}

function card(id = "ws_1"): ResultCard {
  return { id, title: "Beirut", subtitle: "30C", snippets: [], sources: [] };
}

const initial = useCardStore.getState();

beforeEach(() => {
  vi.useFakeTimers();
  useCardStore.setState({ ...initial, card: null });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("building a card from a search", () => {
  it("takes the headline from the model and the sources from the search", () => {
    const built = toResultCard(
      searchResult([hit("https://www.bbc.com/weather/276781", "Sunny, high 32.")]),
      { title: "Beirut, Lebanon", subtitle: "30°C" },
    );

    expect(built).toEqual({
      id: "ws_1",
      title: "Beirut, Lebanon",
      subtitle: "30°C",
      snippets: ["Sunny, high 32."],
      // `www.` dropped: it is noise on a card read at a glance.
      sources: [{ label: "bbc.com", url: "https://www.bbc.com/weather/276781" }],
    });
  });

  /**
   * `new URL()` is NOT safe on this platform - React Native ships a partial
   * implementation, the same one whose URLSearchParams throws. These are the
   * shapes the hand-rolled parser has to survive without throwing mid-call.
   */
  it("parses hosts without URL(), including the ones that would throw", () => {
    const built = toResultCard(
      searchResult([
        hit("https://exa.ai/library/weather/beirut?lat=33.8&lon=35.5"),
        hit("http://www.example.co.uk:8080/a/b#frag"),
        hit("not a url at all"),
      ]),
      { title: "T", subtitle: "S" },
    );

    expect(built.sources.map((source) => source.label)).toEqual([
      "exa.ai",
      "example.co.uk",
      "not a url at all",
    ]);
  });

  it("shows at most a glance of it", () => {
    const built = toResultCard(
      searchResult([
        hit("https://a.test", "a".repeat(400)),
        hit("https://b.test"),
        hit("https://c.test"),
        hit("https://d.test"),
      ]),
      { title: "T", subtitle: "S" },
    );

    expect(built.snippets).toHaveLength(CARD_SNIPPETS);
    expect(built.snippets[0]?.length).toBe(CARD_SNIPPET_MAX_LENGTH);
    expect(built.snippets[0]?.endsWith("…")).toBe(true);
    expect(built.sources).toHaveLength(CARD_SOURCES);
  });

  it("lists a host once, however many pages came from it", () => {
    const built = toResultCard(
      searchResult([
        hit("https://bbc.com/one"),
        hit("https://www.bbc.com/two"),
        hit("https://cnn.com/three"),
      ]),
      { title: "T", subtitle: "S" },
    );

    expect(built.sources.map((source) => source.label)).toEqual(["bbc.com", "cnn.com"]);
  });

  it("drops empty snippets rather than rendering blank lines", () => {
    const built = toResultCard(
      searchResult([hit("https://a.test", "   "), hit("https://b.test", "Real text.")]),
      { title: "T", subtitle: "S" },
    );

    expect(built.snippets).toEqual(["Real text."]);
  });
});

describe("showing and hiding", () => {
  it("holds the card, then takes it away on its own", () => {
    useCardStore.getState().show(card());
    expect(useCardStore.getState().card?.title).toBe("Beirut");

    vi.advanceTimersByTime(CARD_VISIBLE_MS - 1);
    expect(useCardStore.getState().card).not.toBeNull();

    vi.advanceTimersByTime(1);
    expect(useCardStore.getState().card).toBeNull();
  });

  /**
   * The bug this prevents: a second search replaces the card, then the FIRST
   * card's timer fires and closes the one the user is reading.
   */
  it("does not let a replaced card's timer close its replacement", () => {
    useCardStore.getState().show(card("ws_1"));
    vi.advanceTimersByTime(CARD_VISIBLE_MS - 100);

    useCardStore.getState().show(card("ws_2"));
    vi.advanceTimersByTime(200);

    expect(useCardStore.getState().card?.id).toBe("ws_2");
  });

  it("closes on a tap, before the timer", () => {
    useCardStore.getState().show(card());
    useCardStore.getState().dismiss();

    expect(useCardStore.getState().card).toBeNull();
  });

  it("ignores a dismiss aimed at a card that is no longer showing", () => {
    useCardStore.getState().show(card("ws_1"));
    useCardStore.getState().show(card("ws_2"));

    useCardStore.getState().dismiss("ws_1");

    expect(useCardStore.getState().card?.id).toBe("ws_2");
  });
});
