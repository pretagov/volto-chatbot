import { describe, it, expect } from 'vitest';
import { parseSvg, svgAsIconData } from './svgIcon.js';

// A real icon from the add-on, unmodified.
const BOT =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" ' +
  'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
  'stroke-linejoin="round" class="lucide lucide-bot"><path d="M12 8V4H8"/>' +
  '<rect width="16" height="12" x="4" y="8" rx="2"/></svg>';

describe('parseSvg', () => {
  it('pulls the root attributes out', () => {
    const { attributes } = parseSvg(BOT);
    expect(attributes.viewBox).toBe('0 0 24 24');
    expect(attributes.xmlns).toBe('http://www.w3.org/2000/svg');
    expect(attributes.fill).toBe('none');
  });

  it('keeps hyphenated attribute names as written', () => {
    // SVGIcon reads them by their hyphenated names, not camelCased.
    const { attributes } = parseSvg(BOT);
    expect(attributes['stroke-width']).toBe('2');
    expect(attributes['stroke-linecap']).toBe('round');
    expect(attributes['stroke-linejoin']).toBe('round');
  });

  it('returns the inner markup as content', () => {
    // SVGIcon injects this with dangerouslySetInnerHTML, so the paths have to
    // survive intact or the icon renders as an empty box.
    const { content } = parseSvg(BOT);
    expect(content).toContain('<path d="M12 8V4H8"/>');
    expect(content).toContain('<rect');
    expect(content).not.toContain('<svg');
  });

  it('gives an empty icon rather than throwing on something unparseable', () => {
    expect(parseSvg('not an svg')).toEqual({ attributes: {}, content: '' });
  });
});

describe('svgAsIconData', () => {
  const plugin = (source) => svgAsIconData({ readFile: async () => source });

  it('claims svg imports before Vite turns them into a URL', () => {
    expect(plugin(BOT).enforce).toBe('pre');
  });

  it('emits the object shape the add-on components expect', async () => {
    const code = await plugin(BOT).load('/icons/bot.svg');
    const value = JSON.parse(code.replace('export default ', '').replace(/;$/, ''));
    expect(value.attributes['stroke-width']).toBe('2');
    expect(value.content).toContain('<path');
  });

  it('handles a query suffix, which Vite appends to asset ids', async () => {
    const code = await plugin(BOT).load('/icons/bot.svg?used');
    expect(code).toContain('stroke-width');
  });

  it('leaves non-svg modules alone', async () => {
    expect(await plugin(BOT).load('/src/app/App.jsx')).toBeNull();
  });
});
