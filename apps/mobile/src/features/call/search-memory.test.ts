import { describe, expect, it } from "vitest";
import { REMEMBERED_SEARCHES, SearchMemory } from "./search-memory";

function result(searchId: string, url = "https://example.test/a") {
  return {
    searchId,
    query: "beirut weather",
    results: [
      {
        title: "Beirut weather",
        url,
        snippet: "30C and sunny.",
        publishedDate: null,
        favicon: null,
      },
    ],
  };
}

describe("remembering a search", () => {
  it("recalls what it was given, by id", () => {
    const memory = new SearchMemory();
    memory.remember(result("ws_1"));

    expect(memory.recall("ws_1")?.query).toBe("beirut weather");
  });

  it("returns undefined for an id it never saw", () => {
    const memory = new SearchMemory();
    memory.remember(result("ws_1"));

    // The model inventing an id is the case this protects: `show_card` must be
    // able to refuse rather than draw an empty card.
    expect(memory.recall("ws_2")).toBeUndefined();
  });

  /**
   * The payload comes from our own server, but it arrives here as `unknown`
   * after a round trip through JSON. Validating it against the published
   * contract turns an upstream shape change into "no card" rather than a crash
   * in the middle of a call.
   */
  it("ignores anything that is not a web_search result", () => {
    const memory = new SearchMemory();

    memory.remember(null);
    memory.remember({ query: "no searchId here", results: [] });
    memory.remember({ searchId: "ws_1", query: "x", results: [{ title: "t" }] });
    memory.remember("a string");

    expect(memory.size).toBe(0);
  });

  it("keeps a bounded number, dropping the least recent", () => {
    const memory = new SearchMemory();

    for (let i = 0; i < REMEMBERED_SEARCHES + 3; i += 1) {
      memory.remember(result(`ws_${i}`));
    }

    expect(memory.size).toBe(REMEMBERED_SEARCHES);
    expect(memory.recall("ws_0")).toBeUndefined();
    expect(memory.recall(`ws_${REMEMBERED_SEARCHES + 2}`)).toBeDefined();
  });

  it("treats re-remembering an id as making it the most recent", () => {
    const memory = new SearchMemory();
    memory.remember(result("ws_keep"));

    for (let i = 0; i < REMEMBERED_SEARCHES - 1; i += 1) {
      memory.remember(result(`ws_${i}`));
    }
    // Touch it again, then overflow by one. Without recency ordering the
    // re-touched entry would still be the one evicted.
    memory.remember(result("ws_keep"));
    memory.remember(result("ws_overflow"));

    expect(memory.recall("ws_keep")).toBeDefined();
    expect(memory.recall("ws_0")).toBeUndefined();
  });

  it("forgets everything when a call ends", () => {
    const memory = new SearchMemory();
    memory.remember(result("ws_1"));
    memory.clear();

    expect(memory.recall("ws_1")).toBeUndefined();
  });
});
