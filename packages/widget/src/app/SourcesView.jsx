import React, { useCallback, useEffect } from 'react';
import { useStore } from '@nanostores/react';
import { sourcesForSelectedMessage } from '#stores/sidebarStore';
import { getSourceDisplayName } from '@eeacms/volto-chatbot/ChatBlock/utils';
import { notifyParent } from './frame.js';

// Where the answer's "show all" control leads.
//
// ChatMessageBubble renders three source cards plus a card that sets
// sourcesForSelectedMessage, and in Volto the sidebar renders that store. The
// widget has no sidebar, so the control set a value nothing displayed: a
// visitor saw three sources and could not reach the rest. For an assistant
// whose claim is "check the source", that is the wrong half to hide.
//
// A side panel rather than a full-frame screen: the answer it belongs to stays
// visible beside it, so a reader can hold both. The loader owns the iframe
// geometry, so the panel slides within the frame instead of widening it, and it
// stays mounted (hidden, inert) so opening and closing can animate.
export function SourcesView() {
  const sources = useStore(sourcesForSelectedMessage);
  const open = Boolean(sources && sources.length > 0);
  const close = useCallback(() => sourcesForSelectedMessage.set([]), []);

  // The frame is sized for one column. Ask the loader for the second one, so
  // the sources land beside the answer rather than over it; below the loader's
  // full-screen breakpoint there is no room and the panel slides over instead.
  useEffect(() => {
    notifyParent(open ? 'chat:sources-open' : 'chat:sources-close');
  }, [open]);

  // The list scrolls, so the close control can be out of view; Escape is the
  // way out that stays available.
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  return (
    <>
      <button
        type="button"
        tabIndex={open ? 0 : -1}
        aria-hidden={open ? undefined : 'true'}
        aria-label="Dismiss sources"
        className={`chat-sources__scrim${open ? ' chat-sources__scrim--open' : ''}`}
        onClick={close}
      />
      <aside
        className={`chat-sources${open ? ' chat-sources--open' : ''}`}
        {...(open
          ? { role: 'dialog', 'aria-label': 'Sources' }
          : { 'aria-hidden': 'true', inert: '' })}
      >
        <header className="chat-sources__header">
          <span className="chat-sources__title">Sources</span>
          <button
            type="button"
            tabIndex={open ? 0 : -1}
            aria-label="Close sources"
            onClick={close}
          >
            ×
          </button>
        </header>

        <ol className="chat-sources__list">
          {(sources || []).map((source, index) => {
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
      </aside>
    </>
  );
}

export default SourcesView;
