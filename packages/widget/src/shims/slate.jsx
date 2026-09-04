import React from 'react';

// Stands in for @plone/volto-slate/editor/render's serializeNodes.
//
// Only used to render rich-text config fields (the assistant description and
// similar), so this covers the node types those actually use rather than
// reimplementing Slate.
const MARKS = [
  ['bold', 'strong'],
  ['italic', 'em'],
  ['underline', 'u'],
  ['code', 'code'],
];

function renderLeaf(node, key) {
  let element = node.text ?? '';
  for (const [mark, Tag] of MARKS) {
    if (node[mark]) element = <Tag>{element}</Tag>;
  }
  return <React.Fragment key={key}>{element}</React.Fragment>;
}

function renderNode(node, key) {
  if (node == null) return null;
  if (typeof node === 'string') return node;
  if (node.text !== undefined) return renderLeaf(node, key);

  const children = (node.children || []).map((child, i) => renderNode(child, `${key}-${i}`));

  switch (node.type) {
    case 'p':
    case 'paragraph':
      return <p key={key}>{children}</p>;
    case 'h1':
      return <h1 key={key}>{children}</h1>;
    case 'h2':
      return <h2 key={key}>{children}</h2>;
    case 'h3':
      return <h3 key={key}>{children}</h3>;
    case 'ul':
      return <ul key={key}>{children}</ul>;
    case 'ol':
      return <ol key={key}>{children}</ol>;
    case 'li':
      return <li key={key}>{children}</li>;
    case 'link':
    case 'a':
      return (
        <a key={key} href={node.data?.url || node.url} target="_blank" rel="noreferrer">
          {children}
        </a>
      );
    default:
      return <React.Fragment key={key}>{children}</React.Fragment>;
  }
}

export function serializeNodes(nodes) {
  if (!Array.isArray(nodes)) return null;
  return nodes.map((node, i) => renderNode(node, `n-${i}`));
}

export default serializeNodes;
