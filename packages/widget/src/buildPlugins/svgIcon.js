// Turns an .svg import into the shape the add-on's components expect.
//
// The components do `import BotIcon from './icons/bot.svg'` and hand the result
// to SVGIcon, which reads `attributes` and `content` off it — that is what
// Volto's loader produces. Vite's default for .svg is a URL string, so those
// reads land on a string: `attributes` is undefined, and indexing it throws
// before React can mount. The icons would render empty even if it didn't.

const SVG_ROOT = /<svg([^>]*)>([\s\S]*)<\/svg>/i;
const ATTRIBUTE = /([\w:-]+)\s*=\s*"([^"]*)"/g;

export function parseSvg(source) {
  const match = SVG_ROOT.exec(source);
  // Not an icon we understand. Failing here would be a build error on a file
  // that may simply be decorative, so hand back an empty icon instead.
  if (!match) return { attributes: {}, content: '' };

  const [, rawAttributes, content] = match;
  const attributes = {};
  for (const [, name, value] of rawAttributes.matchAll(ATTRIBUTE)) {
    attributes[name] = value;
  }

  return { attributes, content: content.trim() };
}

/**
 * Vite plugin. `enforce: 'pre'` so it claims .svg before Vite's own asset
 * handling turns it into a URL.
 */
export function svgAsIconData({ readFile }) {
  return {
    name: 'chatbot-svg-icon-data',
    enforce: 'pre',
    async load(id) {
      const [file] = id.split('?');
      if (!file.endsWith('.svg')) return null;
      const source = await readFile(file, 'utf8');
      return `export default ${JSON.stringify(parseSvg(source))};`;
    },
  };
}
