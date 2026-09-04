import React, { createContext, useContext } from 'react';
import registry from '../shims/registry.js';

// Supplies what Volto used to. In the add-on the config comes from the current
// Plone page's blocks via Redux; here it comes from the embed, in the same
// contract shape, so the reused components take identical config either way.
//
// It arrives as a prop rather than being fetched: the whole configuration is in
// the iframe URL, so there is nothing to wait for and no failure mode where the
// launcher renders before its settings do.

const ChatConfigContext = createContext(null);

export function useChatConfig() {
  return useContext(ChatConfigContext);
}

// The reused components read these from the settings singleton rather than from
// props, so seed it before they render.
function seedRegistry(config) {
  registry.settings = {
    ...registry.settings,
    'volto-chatbot': {
      ...(registry.settings['volto-chatbot'] || {}),
      rewakeUrl: config.rewakeUrl,
      rewakeDelay: config.rewakeDelay,
    },
  };
}

export function ConfigProvider({ children, config }) {
  if (!config) return null;
  seedRegistry(config);
  return <ChatConfigContext.Provider value={config}>{children}</ChatConfigContext.Provider>;
}

export default ConfigProvider;
