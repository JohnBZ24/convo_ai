import { z } from "zod";
import { defineTool } from "./tool-definition";

/**
 * The time where the USER is.
 *
 * A device tool, and the reason the distinction exists: the server's clock is
 * in whatever region it was deployed to, while the phone knows the timezone the
 * person asking is actually standing in. Answering "what time is it" from the
 * server would be confidently wrong for any travelling user.
 *
 * The server refuses to run this (403). It has no better answer than the
 * device, and proxying it would establish exactly the pattern - "the model
 * asked, so we ran it" - that the privileged/device split exists to prevent.
 */
export const getCurrentTimeTool = defineTool({
  name: "get_current_time",
  description:
    "The current date and time where the user is. Call this before answering anything that depends on the present moment - today's date, the time, how long until something.",
  execution: "device",
  input: z.object({
    timeZone: z
      .string()
      .optional()
      .describe(
        "IANA timezone such as Europe/Beirut. Omit to use the device's own timezone, which is almost always what you want.",
      ),
  }),
});
