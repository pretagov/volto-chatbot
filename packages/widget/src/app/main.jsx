import React from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from './ConfigProvider.jsx';
import { App } from './App.jsx';
import { readEmbedConfig } from './embedConfig.js';
import { installFetchWrapper } from './fetchWrapper.js';
import { installStorageGuard } from './storageGuard.js';

// The add-on's stylesheet. In Volto the theme pulls this in; standalone,
// nothing did, so the panel rendered with default serif type and no chrome.
// It is self-contained LESS - its own variables, no Volto or Semantic imports.
import '@eeacms/volto-chatbot/ChatBlock/style.less';

// Everything about this demo comes from the iframe's own URL, which the loader
// built from the host page's data- attributes. One chat, one persona.
const config = readEmbedConfig();

// Both guards must be installed before any reused component runs: they issue
// bare fetch() calls and touch localStorage directly, and neither file may be
// edited.
installFetchWrapper({
  onyxBaseUrl: config.onyxBaseUrl,
  personaId: config.personaId,
  forcedToolId: config.forcedToolId,
});
installStorageGuard();

createRoot(document.getElementById('root')).render(
  <ConfigProvider config={config}>
    <App />
  </ConfigProvider>,
);
