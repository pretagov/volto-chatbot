import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { SVGIcon } from '../../../../src/ChatBlock/utils.js';
import BotIcon from '../../../../src/icons/bot.svg';

// The widget crashed before React mounted because SVGIcon indexed
// name.attributes without guarding it, and the build handed it a URL string
// rather than the {attributes, content} object the add-on expects. Nothing in
// the suite rendered an icon, so both went unnoticed until the page was opened.

afterEach(cleanup);

describe('SVGIcon', () => {
  it('renders an icon imported from the build', () => {
    // Exercises the vite plugin too: if .svg still resolved to a URL string,
    // this would be an empty icon.
    const { container } = render(<SVGIcon name={BotIcon} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.getAttribute('stroke-width')).toBe('2');
    expect(container.querySelector('path')).not.toBeNull();
  });

  it('survives an icon with no attributes', () => {
    expect(() => render(<SVGIcon name={{ content: '<path d="M0 0"/>' }} />)).not.toThrow();
  });

  it('survives a missing icon', () => {
    expect(() => render(<SVGIcon name={undefined} />)).not.toThrow();
  });

  it('survives an icon that is a plain string', () => {
    // What Vite's default asset handling produces, and what took the widget
    // down: a URL where an object was expected.
    expect(() => render(<SVGIcon name="/assets/bot-abc123.svg" />)).not.toThrow();
  });

  it('renders a title when given one', () => {
    const { container } = render(<SVGIcon name={BotIcon} title="Assistant" />);
    expect(container.querySelector('title')?.textContent).toBe('Assistant');
  });
});
