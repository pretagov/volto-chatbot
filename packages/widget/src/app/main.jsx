import React from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from './ConfigProvider.jsx';
import { App } from './App.jsx';
import { installFetchWrapper } from './fetchWrapper.js';
import { installStorageGuard } from './storageGuard.js';

// Both guards must be installed before any reused component runs: they issue bare
// fetch() calls and touch localStorage directly, and neither file may be edited.
let token = globalThis.__CHAT_TOKEN__;
installFetchWrapper({
  getToken: () => token,
  setToken: (fresh) => {
    token = fresh;
  },
  tenant: globalThis.__CHAT_TENANT__,
});
installStorageGuard();

createRoot(document.getElementById('root')).render(
  <ConfigProvider>
    <App />
  </ConfigProvider>,
);
