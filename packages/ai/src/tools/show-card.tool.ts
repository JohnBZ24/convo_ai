import { z } from "zod";
import { defineTool } from "./tool-definition";

/** Long enough for "Beirut, Lebanon", short enough to stay on one line. */
export const SHOW_CARD_TITLE_MAX_LENGTH = 60;
/** The answer itself. If it does not fit here it is not a card, it is a reply. */
export const SHOW_CARD_SUBTITLE_MAX_LENGTH = 80;

/**
 * Put what was just found on the screen.
 *
 * A DEVICE tool, and the clearest case for that lane in the whole registry:
 * there is no version of "draw on the user's screen" the server could perform.
 * If one of these ever arrives at `POST /api/tools/:name` it is answered 403,
 * because a device tool showing up over HTTP means something is wrong, not that
 * a shortcut is available.
 *
 * Note what the model is NOT asked for: the snippets and the links. Those came
 * back through the phone on their way from `web_search`, so the app already
 * holds them and looks them up by `searchId`. Making the model retype them
 * would cost output tokens - which is speech latency, in this app - and would
 * put URLs somewhere they can be hallucinated. It supplies only the words it
 * alone can write.
 */
export const showCardTool = defineTool({
  name: "show_card",
  description:
    "Show the user a card on screen with what you just found. Call this right after web_search whenever the answer is something worth seeing rather than only hearing - a temperature, a price, a score, a date, a name. You give the headline; the app already has the sources and the excerpts from that search and attaches them itself. Do not call it for anything you did not just search for, and do not call it twice for the same search.",
  execution: "device",
  input: z.object({
    searchId: z
      .string()
      .min(1)
      .max(128)
      .describe(
        "The searchId from the web_search result you are showing. The app finds that search's sources by it. It is never shown to the user, so do not mention it.",
      ),
    title: z
      .string()
      .min(1)
      .max(SHOW_CARD_TITLE_MAX_LENGTH)
      .describe(
        'What the card is about, labelled the way a person would: "Beirut, Lebanon". A few words, not a sentence.',
      ),
    subtitle: z
      .string()
      .min(1)
      .max(SHOW_CARD_SUBTITLE_MAX_LENGTH)
      .describe(
        'The answer itself, short enough to take in at a glance: "30°C, partly cloudy". This is the line the user actually reads.',
      ),
  }),
});

export type ShowCardArgs = z.output<typeof showCardTool.input>;
