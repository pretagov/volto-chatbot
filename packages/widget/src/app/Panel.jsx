import React from 'react';
import ChatWindow from '@eeacms/volto-chatbot/ChatBlock/ChatWindow';
import { useChatConfig } from './ConfigProvider.jsx';

// The expanded state. ChatWindow is the add-on's component, imported in place and
// unmodified — everything it needs that Volto used to provide comes from the
// shims and the seeded registry.
export function Panel({ onClose }) {
  const config = useChatConfig();

  return (
    <div className="chat-panel">
      <header className="chat-panel__header">
        <span className="chat-panel__title">{config.chatTitle}</span>
        <button type="button" onClick={onClose} aria-label="Close chat">
          ×
        </button>
      </header>
      <div className="chat-panel__body">
        {/*
          `assistant` is what ChatWindow feeds to useBackendChat, and it is what
          builds the chat controller that owns onSubmit. That controller is only
          constructed when the id differs from the one already held, so leaving
          it undefined means undefined !== undefined is false, no controller is
          ever built, and every submit throws before a request is made.
        */}
        <ChatWindow
          {...config}
          assistant={config.personaId}
          persona={config.persona}
          placeholderPrompt={config.placeholderPrompt}
        />
      </div>
    </div>
  );
}

export default Panel;
