import React, { useCallback, useState } from 'react';
import { Launcher } from './Launcher.jsx';
import { Panel } from './Panel.jsx';
import { useChatConfig } from './ConfigProvider.jsx';

// Tells the loader to resize the iframe. The loader owns geometry in the host
// page; the widget only says which state it is in.
function notifyParent(type) {
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type }, '*');
  }
}

export function App() {
  const config = useChatConfig();
  // Opened directly when a host page's own trigger created this frame, so the
  // visitor does not have to click a second time inside it.
  const [open, setOpen] = useState(Boolean(config.startOpen));

  const handleOpen = useCallback(() => {
    setOpen(true);
    notifyParent('chat:open');
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
    notifyParent('chat:close');
  }, []);

  return open ? <Panel onClose={handleClose} /> : <Launcher onOpen={handleOpen} title={config.chatTitle} />;
}

export default App;
