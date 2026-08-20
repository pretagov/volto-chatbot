import express from 'express';
import { registerRoutes } from './routes.js';
import { createWidgetRenderer } from './widgetPage.js';

// Used when no build output is configured, which is the case in unit tests: they
// exercise routing and auth, not the bundle. A deployment passes widgetDist and
// gets the real widget.
const placeholderWidget = (tenant, token) =>
  '<!doctype html><html><head><meta charset="utf-8">' +
  `<script>window.__CHAT_TOKEN__=${JSON.stringify(token)};` +
  `window.__CHAT_TENANT__=${JSON.stringify(tenant.tenantId)};</script>` +
  '</head><body><div id="root"></div></body></html>';

export function createApp(deps) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // The widget build is static and hashed, so it can be cached hard. loader.js
  // is deliberately unhashed — host pages reference it by name — so it must not
  // be, or sites would pin an old loader indefinitely.
  if (deps.widgetDist) {
    app.use(
      '/assets',
      express.static(`${deps.widgetDist}/assets`, { immutable: true, maxAge: '1y' }),
    );
    app.get('/loader.js', (_req, res) => {
      res.set('Cache-Control', 'no-cache');
      res.type('application/javascript');
      res.sendFile(`${deps.widgetDist}/loader.js`);
    });
  }

  const renderWidget = deps.widgetDist
    ? createWidgetRenderer(`${deps.widgetDist}/index.html`)
    : placeholderWidget;

  registerRoutes(app, { renderWidget, ...deps });
  return app;
}
