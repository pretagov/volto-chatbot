import express from 'express';
import { registerRoutes } from './routes.js';

// The widget bundle is injected here in plan 2. The token and tenant are handed
// over on window so the shell's fetch wrapper has them before any reused
// component runs — those components issue bare fetch() calls with no hook for a
// header, and they must not be edited.
const defaultRenderWidget = (tenant, token) =>
  '<!doctype html><html><head><meta charset="utf-8">' +
  `<script>window.__CHAT_TOKEN__=${JSON.stringify(token)};` +
  `window.__CHAT_TENANT__=${JSON.stringify(tenant.tenantId)};</script>` +
  '</head><body><div id="root"></div></body></html>';

export function createApp(deps) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  registerRoutes(app, { renderWidget: defaultRenderWidget, ...deps });
  return app;
}
