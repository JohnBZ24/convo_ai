import { fileURLToPath } from "node:url";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * `new URL(...).pathname` yields "/C:/..." on Windows, which Vite cannot
 * resolve. fileURLToPath is the only correct conversion.
 */
const srcDir = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  server: {
    port: 3000,
    /**
     * Bind IPv4 explicitly. Vite otherwise binds ::1 only, and `adb reverse
     * tcp:3000 tcp:3000` forwards the phone to the host's IPv4 loopback - so
     * the device would get connection-refused, which surfaces in the app as
     * "Network request failed" on sign-in and reads exactly like an auth bug.
     */
    host: "127.0.0.1",
    strictPort: true,
  },
  resolve: {
    /**
     * The TanStack docs suggest `tsconfigPaths: true`, but that does NOT
     * resolve the "~" alias inside server route handlers - only in client
     * code. An explicit alias is required. This was rediscovered the hard
     * way once already; see docs/HANDOFF.md.
     */
    alias: { "~": srcDir },
  },
  plugins: [
    tanstackStart(),
    // react's plugin must come AFTER start's plugin
    viteReact(),
  ],
});
