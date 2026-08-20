import React, { createContext, useContext, useEffect, useState } from 'react';
import registry from '../shims/registry.js';

// Supplies what Volto used to. In the add-on the config comes from the current
// Plone page's blocks via Redux; here it comes from the middleware, in the same
// contract shape, so the reused components take identical config either way.

const ChatConfigContext = createContext(null);

export function useChatConfig() {
  return useContext(ChatConfigContext);
}

// The reused components read these from the settings singleton rather than from
// props, so the shell has to seed it before they render.
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

export function ConfigProvider({ children, tenant = globalThis.__CHAT_TENANT__ }) {
  const [config, setConfig] = useState(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(`/w/${tenant}/config`);
        if (!response.ok) throw new Error(`config responded ${response.status}`);
        const loaded = await response.json();
        if (cancelled) return;
        seedRegistry(loaded);
        setConfig(loaded);
      } catch {
        // Fail closed. A launcher that opens onto a broken panel is worse on a
        // customer's site than no launcher at all, so we render nothing.
        if (!cancelled) setConfig(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tenant]);

  if (!config) return null;

  return <ChatConfigContext.Provider value={config}>{children}</ChatConfigContext.Provider>;
}

export default ConfigProvider;
