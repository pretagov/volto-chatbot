import { Popup } from 'semantic-ui-react';
import { SVGIcon } from './utils';

import FileIcon from './../icons/file.svg';
import GlobeIcon from './../icons/globe.svg';

import { injectLazyLibs } from '@plone/volto/helpers/Loadable/Loadable';

import loadable from "@loadable/component";
const Markdown = loadable(() => import("react-markdown"));

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
              <Markdown
                components={{
                  p: (props) => {
                    const { node, ...rest } = props;
                    const value = node.children?.[0]?.value || ""; 
                    return value;
                  },
                  a: (props) => {
                    const { node, ...rest } = props;
                    const value = node.children?.[0]?.value || ""; 
                    return value;
                  },
                  h1: (props) => {
                    const { node, ...rest } = props;
                    const value = node.children?.[0]?.value || ""; 
                    return `${value}. `;
                  },
                  h2: (props) => {
                    const { node, ...rest } = props;
                    const value = node.children?.[0]?.value || ""; 
                    return `${value}. `;
                  },
                  h3: (props) => {
                    const { node, ...rest } = props;
                    const value = node.children?.[0]?.value || ""; 
                    return `${value}. `;
                  },
                  ul: (props) => {
                    const {node, ...rest} = props;
                    const liNodes = node.children.filter((child) => child.tagName === 'li')
                    // Assumed the list element is either text or an element with text.
                    const listValues = liNodes.map((node) => {
                      const childNode = node.children?.[0]
                      if (childNode.value) {
                        return childNode.value
                      }
                      return childNode.children[0].value
                    })
                    return listValues.join(". ");
                  },
                }}
              >
                {blurb}
              </Markdown>
            </div>
          )}
        </>
      </div>
    </SourceWrapper>
  );
};

export const SourceDetails = injectLazyLibs(['luxon'])(SourceDetails_);
