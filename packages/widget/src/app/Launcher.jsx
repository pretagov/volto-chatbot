import React from 'react';

// The collapsed state. The iframe is launcher-sized until this is clicked, so the
// host page only ever has a small fixed element until someone engages.
export function Launcher({ onOpen, title }) {
  return (
    <button type="button" className="chat-launcher" onClick={onOpen} aria-label={title}>
      <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 3c5 0 9 3.4 9 7.6 0 4.2-4 7.6-9 7.6-.9 0-1.8-.1-2.6-.3L4 20l1.3-3.2C3.9 15.5 3 13.2 3 10.6 3 6.4 7 3 12 3Z"
        />
      </svg>
    </button>
  );
}

export default Launcher;
