import { Popup } from 'semantic-ui-react';
import { getSourceDisplayName } from './utils';

export function Citation({ link, index, value, message }) {
  const isLinkType = value?.toString().startsWith('[');

  const innerText = isLinkType
    ? value?.toString().split('[')[1].split(']')[0]
    : index;
  const document = isLinkType
    ? message.documents[(parseInt(innerText) - 1).toString()]
    : message.documents[value];

  const displayName = getSourceDisplayName(document);

  const handleClick = () => {
    if (link) {
      window.open(link, '_blank');
    }
  };

  // Build popup content - card style with number, title, and snippet
  const popupContent = (
    <div className="citation-popup-content">
      {/* Citation number circle */}
      <div className="citation-popup-number">{innerText}</div>

      {/* Content body */}
      <div className="citation-popup-body">
        {/* Title with optional link */}
        <div className="citation-popup-header">
          {link ? (
            <a
              href={link}
              target="_blank"
              rel="noreferrer"
              className="citation-popup-title-link"
              onClick={(e) => e.stopPropagation()}
              title={displayName}
            >
              {displayName}
            </a>
          ) : (
            <span className="citation-popup-title" title={displayName}>{displayName}</span>
          )}
        </div>

        {/* Match highlights as snippet */}
        {document?.match_highlights?.filter(Boolean).length > 0 && (
          <div className="citation-popup-highlights">
            <p dangerouslySetInnerHTML={{
              __html: document.match_highlights.filter(Boolean)[0]
            }} />
          </div>
        )}

        {/* Fallback if no highlights */}
        {!document?.match_highlights?.filter(Boolean).length && (
          <p className="citation-popup-no-content">
            {document?.blurb ? document.blurb.slice(0, 80) + '...' : 'No preview available'}
          </p>
        )}
      </div>
    </div>
  );

  return (
    <Popup
      on="hover"
      hoverable
      wide="very"
      position="top center"
      mouseEnterDelay={200}
      mouseLeaveDelay={300}
      content={popupContent}
      trigger={
        <span
          className="chat-citation"
          onClick={handleClick}
          style={{ cursor: link ? 'pointer' : 'default' }}
        >
          {innerText}
        </span>
      }
      popper={{ id: 'chat-citation-popup' }}
    />
  );
}
