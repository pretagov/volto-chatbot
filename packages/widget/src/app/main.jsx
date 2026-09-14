import React from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from './ConfigProvider.jsx';
import { App } from './App.jsx';
import { readEmbedConfig } from './embedConfig.js';
import { installFetchWrapper } from './fetchWrapper.js';
import { installStorageGuard } from './storageGuard.js';

// The add-on styles the conversation; this styles the shell around it. Imported
// explicitly rather than relied on transitively, so the dependency is visible.
import '@eeacms/volto-chatbot/ChatBlock/style.less';
import './shell.css';


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
