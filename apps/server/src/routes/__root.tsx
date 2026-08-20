import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";

/**
 * This server has no web UI - every route under /api returns JSON, and the one
 * HTML page it serves (Swagger UI) writes its own markup. TanStack Start still
 * requires a root route to build the route tree, so this stays deliberately
 * minimal rather than growing into an app shell.
 */
export const Route = createRootRoute({
  component: () => (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  ),
});
