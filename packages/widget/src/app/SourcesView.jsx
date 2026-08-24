import React from 'react';
import { useStore } from '@nanostores/react';
import { sourcesForSelectedMessage } from '#stores/sidebarStore';
import { getSourceDisplayName } from '@eeacms/volto-chatbot/ChatBlock/utils';

// Where the answer's "show all" control leads.
//
// ChatMessageBubble renders three source cards plus a card that sets
// sourcesForSelectedMessage, and in Volto the sidebar renders that store. The
// widget has no sidebar, so the control set a value nothing displayed: a
// visitor saw three sources and could not reach the rest. For an assistant
// whose claim is "check the source", that is the wrong half to hide.
//
// Rendered as an overlay inside the panel rather than a second frame, because
// the loader owns the iframe geometry and the panel is the whole of it.
export function SourcesView() {
  const sources = useStore(sourcesForSelectedMessage);

  if (!sources || sources.length === 0) return null;

  return (
    <div className="chat-sources" role="dialog" aria-label="Sources">
      <header className="chat-sources__header">
        <span className="chat-sources__title">Sources</span>
        <button
          type="button"
          aria-label="Close sources"
          onClick={() => sourcesForSelectedMessage.set([])}
        >
          ×
        </button>
      </header>

      <ol className="chat-sources__list">
        {sources.map((source, index) => {
          // Retrieved chunks do not always carry a title, and the link can be
          // absent for non-web sources.
          const title = getSourceDisplayName(source) || source.document_id || 'Source';
          return (
            <li key={source.document_id ?? index} className="chat-sources__item">
              <span className="chat-sources__number">{index + 1}</span>
              <div className="chat-sources__body">
                {source.link ? (
                  <a href={source.link} target="_blank" rel="noreferrer noopener">
                    {title}
                  </a>
                ) : (
                  <span>{title}</span>
                )}
                {source.blurb ? (
                  <p className="chat-sources__blurb">{source.blurb}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default SourcesView;
