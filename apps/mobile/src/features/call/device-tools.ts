import {
  findTool,
  getCurrentTimeTool,
  type ShowCardArgs,
  showCardTool,
  webSearchTool,
} from "@convo/ai";
import type { RealtimeFunctionCall } from "./realtime-events";

/**
 * Where a model function call actually runs.
 *
 * Every tool is declared to the model at mint time, device and privileged
 * alike - the model cannot see where a tool runs and does not need to. Routing
 * is the DEVICE's job, which is exactly why the server still checks `execution`
 * on arrival and answers 403 rather than trusting what it is sent.
 *
 * Nothing here imports React Native. `proxy`, `now` and `timeZone` come in so a
 * test can drive the whole dispatch without a network or a clock.
 */

export interface ToolProxyRequest {
  callId: string;
  arguments: Record<string, unknown>;
  conversationId?: string | undefined;
}

export interface DeviceToolDeps {
  /** `POST /api/tools/:name`, already carrying the USER's bearer token. */
  proxy: (name: string, request: ToolProxyRequest) => Promise<unknown>;
  now: () => Date;
  /** The device's own IANA zone, used when the model does not name one. */
  deviceTimeZone: () => string;
  /**
   * Hand a `web_search` result to whatever remembers it, on its way past.
   *
   * This is the whole reason `show_card` can take an id rather than a payload:
   * the snippets and links are already ON this device by the time the model
   * decides to display them.
   */
  rememberSearch: (result: unknown) => void;
  /**
   * Draw a card. FALSE when the id names a search this device never saw, which
   * is the model quoting an id it invented.
   */
  showCard: (args: ShowCardArgs) => boolean;
}

/**
 * The result of a call, as the JSON string a `function_call_output` carries.
 *
 * A failure comes back as `{ error }` rather than throwing, because the model
 * is waiting on this item: throwing would leave the turn open and the user
 * listening to silence. The model can read an error and say something useful.
 */
export async function runFunctionCall(
  call: RealtimeFunctionCall,
  conversationId: string | null,
  deps: DeviceToolDeps,
): Promise<string> {
  const definition = findTool(call.name);

  if (!definition) {
    // The model invented a tool. The server would answer 404; save the trip.
    return fail(`There is no tool called ${call.name}.`);
  }

  let args: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(call.argumentsJson);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return fail("The tool arguments were not an object.");
    }
    args = parsed as Record<string, unknown>;
  } catch {
    return fail("The tool arguments were not valid JSON.");
  }

  if (definition.execution === "device") {
    /**
     * Validated HERE, with the same schema that generated what the model was
     * shown. A privileged tool is deliberately NOT validated here: the server
     * cannot trust this device to have done it, so it does it itself, and
     * doing it twice would only let the two drift.
     */
    const validated = definition.input.safeParse(args);
    if (!validated.success) {
      return fail(`Those arguments are not valid for ${call.name}.`);
    }

    return runOnDevice(call.name, validated.data as Record<string, unknown>, deps);
  }

  try {
    const result = await deps.proxy(call.name, {
      callId: call.callId,
      arguments: args,
      // Ownership is NEVER sent. It comes from the session, on the server.
      conversationId: conversationId ?? undefined,
    });

    if (call.name === webSearchTool.name) {
      /**
       * Kept on the way past, NOT re-fetched later. The model gets the same
       * JSON either way; this device just stops throwing away the half of it
       * that a card needs.
       */
      deps.rememberSearch(result);
    }

    return JSON.stringify(result ?? null);
  } catch (error) {
    return fail(errorMessage(error));
  }
}

function runOnDevice(
  name: string,
  args: Record<string, unknown>,
  deps: DeviceToolDeps,
): string {
  if (name === getCurrentTimeTool.name) {
    return JSON.stringify(currentTime(args.timeZone, deps));
  }

  if (name === showCardTool.name) {
    const shown = deps.showCard(args as unknown as ShowCardArgs);

    /**
     * A refusal the model can act on, not a crash. It quoted an id from a
     * search that never happened - usually because it tried to show a card
     * without searching first - and the useful thing is to say so in a sentence
     * it can recover from.
     */
    return shown
      ? JSON.stringify({ shown: true })
      : fail(
          "There is no search with that id, so nothing was shown. Search first, then show the card for that search.",
        );
  }

  // A declared device tool with no implementation is OUR bug, and it reads as
  // one: the same distinction the server draws with its 500.
  return fail(`${name} runs on the device but this app does not implement it.`);
}

/**
 * The one tool that genuinely needs the phone: it answers with the user's own
 * clock and zone, which is why the server refuses to run it at all.
 */
function currentTime(requested: unknown, deps: DeviceToolDeps): Record<string, string> {
  const now = deps.now();
  const zone = resolveZone(requested, deps.deviceTimeZone());

  return {
    iso: now.toISOString(),
    timeZone: zone,
    /** Spelled out, because this is going to be READ ALOUD, not parsed. */
    spoken: new Intl.DateTimeFormat("en-GB", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: zone,
    }).format(now),
  };
}

/** A zone the model made up must not throw. Fall back to the device's own. */
function resolveZone(requested: unknown, fallback: string): string {
  if (typeof requested !== "string" || requested.length === 0) return fallback;

  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: requested }).format(new Date());
    return requested;
  } catch {
    return fallback;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The tool could not be reached.";
}

function fail(message: string): string {
  return JSON.stringify({ error: message });
}
