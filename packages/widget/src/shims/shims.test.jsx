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
    function Probe({ rehypePrism, remarkGfm }) {
      return <div>{`prism:${!!rehypePrism} gfm:${!!remarkGfm}`}</div>;
    }
    const Wrapped = injectLazyLibs(['rehypePrism', 'remarkGfm'])(Probe);
    render(<Wrapped />);
    expect(await screen.findByText('prism:true gfm:true')).toBeTruthy();
  });

  it('renders the component even before the libraries resolve', () => {
    function Probe() {
      return <div>rendered</div>;
    }
    const Wrapped = injectLazyLibs(['luxon'])(Probe);
    render(<Wrapped />);
    expect(screen.getByText('rendered')).toBeTruthy();
  });

  it('accepts a single name as a string, as Volto does', () => {
    function Probe({ luxon }) {
      return <div>{`luxon:${luxon === undefined ? 'pending' : 'ready'}`}</div>;
    }
    const Wrapped = injectLazyLibs('luxon')(Probe);
    render(<Wrapped />);
    expect(screen.getByText(/luxon:/)).toBeTruthy();
  });

  it('forwards the props it was given', () => {
    function Probe({ greeting }) {
      return <div>{greeting}</div>;
    }
    const Wrapped = injectLazyLibs(['luxon'])(Probe);
    render(<Wrapped greeting="hello" />);
    expect(screen.getByText('hello')).toBeTruthy();
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
