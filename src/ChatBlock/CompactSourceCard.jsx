import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { SVGIcon, getSourceDisplayName } from './utils';

import FileIcon from './../icons/file.svg';
import GlobeIcon from './../icons/globe.svg';

function getDomainFromUrl(url) {
  if (!url) return null;
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return null;
  }
}

function getFaviconUrl(url) {
  const domain = getDomainFromUrl(url);
  if (!domain) return null;
  // Use Google's favicon service for reliable favicon fetching
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
}

function SourceIcon({ source_type, link }) {
  const [imgError, setImgError] = useState(false);
  const faviconUrl = source_type === 'web' ? getFaviconUrl(link) : null;

  // For web sources with a valid favicon URL, show the favicon
  if (source_type === 'web' && faviconUrl && !imgError) {
    return (
      <img
        src={faviconUrl}
        alt=""
        className="card-favicon"
        width="16"
        height="16"
        onError={() => setImgError(true)}
      />
    );
  }

  // Fallback to generic icons
  if (source_type === 'web') {
    return <SVGIcon name={GlobeIcon} size="14" className="card-icon" />;
  }
  return <SVGIcon name={FileIcon} size="14" className="card-icon" />;
}

function getBlurbText(source) {
  const { match_highlights, blurb } = source || {};
  // Use match_highlights first, then fall back to blurb
  if (match_highlights?.filter(Boolean).length > 0) {
    // Strip HTML tags from highlights for plain text display
    return match_highlights
      .filter(Boolean)
      .join(' ')
      .replace(/<[^>]*>/g, '');
  }
  return blurb || '';
}

function CompactSourceCard({ source, index, variant, onClick, count, sources }) {
  if (variant === 'show-all') {
    // Show All card with stacked icons/favicons
    const displaySources = (sources || []).slice(0, 3);
    return (
      <button
        type="button"
        className="show-all-card"
        onClick={onClick}
        aria-label={`Show all ${count || sources?.length || 0} sources`}
      >
        <span className="stacked-icons">
          {displaySources.map((src, i) => (
            <SourceIcon key={i} source_type={src.source_type} link={src.link} />
          ))}
        </span>
        <span>Show All</span>
      </button>
    );
  }

  // Regular compact source card
  const displayName = getSourceDisplayName(source);
  const blurbText = getBlurbText(source);
  const { link, source_type } = source || {};
  const isLinkType = source_type === 'web';

  const cardContent = (
    <>
      {/* Top row: citation number + blurb/highlight text */}
      <div className="card-top">
        {index && <span className="chat-citation card-index">{index}</span>}
        <span className="card-blurb" title={blurbText}>
          {blurbText}
        </span>
      </div>
      {/* Bottom row: icon + source title */}
      <div className="card-source">
        <SourceIcon source_type={source_type} link={link} />
        <span className="card-title" title={displayName}>
          {displayName}
        </span>
      </div>
    </>
  );

  if (isLinkType && link) {
    return (
      <a
        href={link}
        target="_blank"
        rel="noreferrer"
        className="compact-card"
        title={displayName}
      >
        {cardContent}
      </a>
    );
  }

  return (
    <div className="compact-card" title={displayName}>
      {cardContent}
    </div>
  );
}

CompactSourceCard.propTypes = {
  source: PropTypes.object,
  index: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  variant: PropTypes.oneOf(['source', 'show-all']),
  onClick: PropTypes.func,
  count: PropTypes.number,
  sources: PropTypes.array,
};

export default CompactSourceCard;
