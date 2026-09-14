import React, { useCallback, useState } from 'react';
import { Launcher } from './Launcher.jsx';
import { Panel } from './Panel.jsx';
import { useChatConfig } from './ConfigProvider.jsx';
import { notifyParent } from './frame.js';

export function App() {
  const config = useChatConfig();

  // Set on the root rather than in the stylesheet so it also reaches Semantic
  // UI's popups, which mount outside the panel.
  React.useEffect(() => {
    if (config.fontFamily) {
      document.documentElement.style.setProperty('--chat-font', config.fontFamily);
    }
  }, [config.fontFamily]);
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
