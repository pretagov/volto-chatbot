import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { sourcesForSelectedMessage } from '#stores/sidebarStore';
import { SourcesView } from './SourcesView.jsx';

// The answer shows three source cards and a "show all" control, which sets a
// store the add-on's Volto sidebar renders. The widget has no sidebar, so that
// control led nowhere: a visitor could see three sources and never reach the
// rest, which for an assistant whose whole claim is "check the source" is the
// wrong half to hide.

const SOURCES = [
  { document_id: 'a', semantic_identifier: 'LECC Annual Report', link: 'https://lecc.example/ar', blurb: 'Yearly summary.' },
  { document_id: 'b', semantic_identifier: 'Operation Harrisdale', link: 'https://lecc.example/harrisdale', blurb: 'Section 132 report.' },
];

afterEach(() => {
  sourcesForSelectedMessage.set([]);
  cleanup();
});

describe('SourcesView', () => {
  it('stays out of the conversation until a message asks for its sources', () => {
    render(<SourcesView />);
    // Mounted so it can slide, but not exposed: no dialog, nothing focusable.
    expect(screen.queryByRole('dialog')).toBe(null);
    expect(screen.queryByRole('button', { name: /close sources/i })).toBe(null);
  });

  it('is a side panel that slides in, not a screen that replaces the chat', () => {
    const { container } = render(<SourcesView />);
    const panel = container.querySelector('.chat-sources');
    expect(panel).toBeTruthy();
    expect(panel.className).not.toContain('chat-sources--open');
    expect(panel.getAttribute('aria-hidden')).toBe('true');

    act(() => sourcesForSelectedMessage.set(SOURCES));
    expect(container.querySelector('.chat-sources').className).toContain(
      'chat-sources--open',
    );
    expect(container.querySelector('.chat-sources').getAttribute('aria-hidden')).toBe(
      null,
    );
  });

  it('closes when the conversation behind it is tapped', () => {
    sourcesForSelectedMessage.set(SOURCES);
    render(<SourcesView />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss sources/i }));
    expect(sourcesForSelectedMessage.get()).toEqual([]);
  });

  it('closes on Escape, since the close control scrolls out of reach', () => {
    sourcesForSelectedMessage.set(SOURCES);
    render(<SourcesView />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(sourcesForSelectedMessage.get()).toEqual([]);
  });

  it('lists every source, not just the three shown inline', () => {
    sourcesForSelectedMessage.set(SOURCES);
    render(<SourcesView />);
    expect(screen.getByText('LECC Annual Report')).toBeTruthy();
    expect(screen.getByText('Operation Harrisdale')).toBeTruthy();
  });

  it('numbers them so they match the citation markers in the answer', () => {
    sourcesForSelectedMessage.set(SOURCES);
    render(<SourcesView />);
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('links each source to the document it came from', () => {
    sourcesForSelectedMessage.set(SOURCES);
    render(<SourcesView />);
    const link = screen.getByRole('link', { name: /LECC Annual Report/ });
    expect(link.getAttribute('href')).toBe('https://lecc.example/ar');
  });

  it('closes back to the conversation', () => {
    sourcesForSelectedMessage.set(SOURCES);
    render(<SourcesView />);
    fireEvent.click(screen.getByRole('button', { name: /close sources/i }));
    expect(sourcesForSelectedMessage.get()).toEqual([]);
  });

  it('survives a source with no title or link', () => {
    // Retrieved chunks do not always carry a semantic_identifier, and a missing
    // one must not blank the whole list.
    sourcesForSelectedMessage.set([{ document_id: 'c' }]);
    expect(() => render(<SourcesView />)).not.toThrow();
  });
});
