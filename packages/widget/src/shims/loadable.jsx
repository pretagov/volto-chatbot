import React, { useEffect, useState } from 'react';

// Stands in for Volto's injectLazyLibs.
//
// In Volto these libraries come from config.settings.loadables, which the add-on
// populates with rehypePrism, remarkGfm and luxon. Rather than vendor Volto's
// loadable machinery, resolve exactly those three by dynamic import and hand them
// to the wrapped component as props — which is the contract ChatWindow relies on.
const LOADERS = {
  rehypePrism: () => import('rehype-prism-plus'),
  remarkGfm: () => import('remark-gfm'),
  luxon: () => import('luxon'),
};

function normalise(names) {
  if (!names) return [];
  return Array.isArray(names) ? names : [names];
}

export function injectLazyLibs(names) {
  const wanted = normalise(names);

  return function wrap(Component) {
    function WithLazyLibs(props) {
      const [libs, setLibs] = useState({});

      useEffect(() => {
        let cancelled = false;
        Promise.all(
          wanted.map(async (name) => {
            const loader = LOADERS[name];
            if (!loader) return [name, undefined];
            try {
              const mod = await loader();
              return [name, mod.default ?? mod];
            } catch {
              // A missing optional library must not take the chat down with it.
              return [name, undefined];
            }
          }),
        ).then((entries) => {
          if (!cancelled) setLibs(Object.fromEntries(entries));
        });
        return () => {
          cancelled = true;
        };
      }, []);

      // Render immediately rather than blocking on the imports: the chat is
      // usable before syntax highlighting is.
      return <Component {...props} {...libs} />;
    }

    WithLazyLibs.displayName = `injectLazyLibs(${Component.displayName || Component.name || 'Component'})`;
    return WithLazyLibs;
  };
}

export default injectLazyLibs;
