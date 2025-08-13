import { Popup } from 'semantic-ui-react';
import { SVGIcon } from './utils';

import FileIcon from './../icons/file.svg';
import GlobeIcon from './../icons/globe.svg';

import { injectLazyLibs } from '@plone/volto/helpers/Loadable/Loadable';

function Icon({ source_type }) {
  if (source_type === 'web') {
    return <SVGIcon name={GlobeIcon} size="15" alt="Web icon" />;
  }
  if (source_type === 'file') {
    return <SVGIcon name={FileIcon} size="15" alt="File icon" />;
  }
  return null;
}

function SourceWrapper({ link, isLinkType, children }) {
  if (isLinkType) {
    return (
      <a href={link} rel="noreferrer" target="_blank" className="source-link">
        {children}
      </a>
    );
  }
  return children;
}

const SourceDetails_ = ({ source, index, luxon }) => {
  const {
    link,
    blurb,
    updated_at,
    source_type,
    semantic_identifier = 'untitled document',
  } = source || {};
  const parsedDate = updated_at ? luxon.DateTime.fromISO(updated_at) : null;
  const relativeTime = parsedDate?.toRelative();
  const isLinkType = source_type === 'web';

  return (
    <SourceWrapper link={link} isLinkType={isLinkType}>
      <div className="source">
        <div className="source-header">
          {isLinkType ? (
            <Popup
              on="click"
              wide="very"
              content="This doc doesn't have a link."
              trigger={<span className="chat-citation">{index}</span>}
              popper={{ id: 'chat-citation-popup' }}
            />
          ) : (
            <span className="chat-citation">{index}</span>
          )}
          <div className="source-title" title={semantic_identifier}>
            {semantic_identifier}
          </div>
          <Icon source_type={source_type} />
        </div>
        <>
          {updated_at && (
            <div className="source-date">
              <span>{relativeTime}</span>
            </div>
          )}
          {blurb && (
            <div className="source-desc">
              <span>{blurb}</span>
            </div>
          )}
        </>
      </div>
    </SourceWrapper>
  );
};

export const SourceDetails = injectLazyLibs(['luxon'])(SourceDetails_);
