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
     * Every interface, IPv4 included.
     *
     * Vite left alone binds `::1` ONLY, which breaks the phone two different
     * ways: `adb reverse tcp:3000 tcp:3000` forwards to the host's IPv4
     * loopback, and a device on the same Wi-Fi reaches the LAN address. Both
     * get connection-refused, which surfaces in the app as "Network request
     * failed" on sign-in and reads exactly like an auth bug.
     *
     * `true` covers both. It was `"127.0.0.1"` while the device was on USB;
     * that fixed the IPv6 half but left the app unreachable over Wi-Fi, which
     * is how the demo is actually run. This is a DEV server on a trusted
     * network - it holds the OpenAI key, so do not expose it further than that.
     */
    host: true,
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
