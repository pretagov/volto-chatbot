import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { injectLazyLibs } from './loadable.jsx';
import { usePrevious } from './helpers.js';
import config from './registry.js';
import { trackEvent } from './matomo.js';

describe('injectLazyLibs', () => {
  it('passes the named libraries to the wrapped component as props', async () => {
    // ChatWindow takes rehypePrism and remarkGfm as props, injected by this HOC
    // in Volto. Outside Volto the shell has to supply them the same way.
    // Asserts they are USABLE, not merely truthy. A module namespace object is
    // truthy and unified still rejects it, which is how a broken plugin got
    // past this test and only surfaced as "Expected usable value" when an
    // answer tried to render.
    function Probe({ rehypePrism, remarkGfm }) {
      return (
        <div>{`prism:${typeof rehypePrism === 'function'} gfm:${typeof remarkGfm === 'function'}`}</div>
      );
    }
    const Wrapped = injectLazyLibs(['rehypePrism', 'remarkGfm'])(Probe);
    render(<Wrapped />);
    // The libraries arrive via dynamic import, so the wait has to allow for a
    // real module load rather than a tick. The default 1s is enough alone and
    // not always enough with the rest of the suite running alongside.
    expect(
      await screen.findByText('prism:true gfm:true', {}, { timeout: 10000 }),
    ).toBeTruthy();
  });

  it('renders the component once the libraries resolve', async () => {
    // Previously this asserted the opposite - that it rendered BEFORE they
    // resolved - which is the defect: the wrapped component passes these
    // straight into ReactMarkdown, and unified throws on an undefined plugin.
    function Probe() {
      return <div>rendered</div>;
    }
    const Wrapped = injectLazyLibs(['luxon'])(Probe);
    render(<Wrapped />);
    expect(await screen.findByText('rendered', {}, { timeout: 10000 })).toBeTruthy();
  });

  it('accepts a single name as a string, as Volto does', async () => {
    function Probe({ luxon }) {
      return <div>{`luxon:${luxon === undefined ? 'pending' : 'ready'}`}</div>;
    }
    const Wrapped = injectLazyLibs('luxon')(Probe);
    render(<Wrapped />);
    expect(await screen.findByText('luxon:ready', {}, { timeout: 10000 })).toBeTruthy();
  });

  it('forwards the props it was given', async () => {
    function Probe({ greeting }) {
      return <div>{greeting}</div>;
    }
    const Wrapped = injectLazyLibs(['luxon'])(Probe);
    render(<Wrapped greeting="hello" />);
    expect(await screen.findByText('hello', {}, { timeout: 10000 })).toBeTruthy();
  });
});

describe('usePrevious', () => {
  it('returns undefined first, then the previous value', () => {
    const seen = [];
    function Probe({ value }) {
      seen.push(usePrevious(value));
      return null;
    }
    const { rerender } = render(<Probe value="a" />);
    rerender(<Probe value="b" />);
    expect(seen[0]).toBeUndefined();
    expect(seen[1]).toBe('a');
  });
});

describe('registry', () => {
  beforeEach(() => {
    config.settings = {};
  });

  it('is a writable settings singleton', () => {
    // lib.js reads config.settings['volto-chatbot'].rewakeUrl and
    // useBackendChat.js reads .rewakeDelay from this module, not from props, so
    // the shell must be able to seed it before those run.
    config.settings['volto-chatbot'] = { rewakeUrl: '/_da/health', rewakeDelay: 15 };
    expect(config.settings['volto-chatbot'].rewakeUrl).toBe('/_da/health');
  });

  it('exposes settings by default so a read does not throw', () => {
    expect(config.settings).toBeTypeOf('object');
  });
});

describe('matomo', () => {
  it('is a no-op that does not throw', () => {
    // Matomo tracking is out of scope for the embedded widget, but four reused
    // components import trackEvent, so it has to exist and be harmless.
    expect(() => trackEvent({ category: 'c', action: 'a' })).not.toThrow();
    expect(trackEvent({})).toBeUndefined();
  });
});

describe('injectLazyLibs timing', () => {
  it('renders nothing until the libraries have resolved', () => {
    // The wrapped component receives these as ReactMarkdown plugins, and an
    // undefined plugin is not a missing nicety - unified throws on it. Rendering
    // early was what took the streamed answer down.
    function Probe({ remarkGfm }) {
      return <div>{`gfm:${typeof remarkGfm}`}</div>;
    }
    const Wrapped = injectLazyLibs(['remarkGfm'])(Probe);
    const { container } = render(<Wrapped />);
    expect(container.textContent).not.toContain('gfm:undefined');
  });
});
