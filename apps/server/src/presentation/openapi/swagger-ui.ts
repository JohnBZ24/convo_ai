/**
 * Swagger UI shell.
 *
 * This is the ONE HTML page this server serves. The baseline CSP is
 * `default-src 'none'` because everything else here is JSON for a native
 * client; this page opts itself back in explicitly rather than the whole
 * server being loosened for it.
 */
export function swaggerUiHtml(specUrl: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Convo AI API</title>
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
<style>body { margin: 0; } .swagger-ui .topbar { display: none; }</style>
</head>
<body>
<div id="swagger"></div>
<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
<script>
  window.ui = SwaggerUIBundle({
    url: ${JSON.stringify(specUrl)},
    dom_id: "#swagger",
    deepLinking: true,
    persistAuthorization: true,
    tryItOutEnabled: true,
  });
</script>
</body>
</html>`;
}

/** CSP for the docs page only - narrow, and scoped to this one route. */
export const SWAGGER_CSP =
  "default-src 'none'; " +
  "script-src 'unsafe-inline' https://unpkg.com; " +
  "style-src 'unsafe-inline' https://unpkg.com; " +
  "img-src 'self' data:; " +
  "connect-src 'self'; " +
  "font-src https://unpkg.com";
