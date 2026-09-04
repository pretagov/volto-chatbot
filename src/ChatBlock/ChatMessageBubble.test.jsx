import { MemoryRouter } from 'react-router-dom';
import configureStore from 'redux-mock-store';
import renderer from 'react-test-renderer';
import React from 'react';

import '@testing-library/jest-dom/extend-expect';
import { Provider } from 'react-intl-redux';
import { ToolCall, AgentThinking } from './ChatMessageBubble';

const mockStore = configureStore();

jest.mock('@eeacms/volto-matomo/utils', () => ({
  trackEvent: jest.fn(),
}));

describe('ToolCall', () => {
  it('should render the component', () => {
    const store = mockStore({
      userSession: { token: '1234' },
      intl: {
        locale: 'en',
        messages: {},
      },
    });

    const props = {
      tool_name: 'run_search',
      tool_args: {
        query: 'Tell me a joke',
      },
      tool_result: [],
    };

    const component = renderer.create(
      <Provider store={store}>
        <MemoryRouter>
          <ToolCall {...props} />
        </MemoryRouter>
      </Provider>,
    );
    const json = component.toJSON();
    expect(json).toMatchSnapshot();
  });
});

describe('AgentThinking', () => {
  const store = mockStore({
    userSession: { token: '1234' },
    intl: {
      locale: 'en',
      messages: {},
    },
  });

  it('should render with thinking steps', () => {
    const props = {
      thinkingSteps: [
        'Analyzing your query...',
        'Searching documentation...',
        'Synthesizing response...',
      ],
      isStreaming: true,
    };

    const component = renderer.create(
      <Provider store={store}>
        <MemoryRouter>
          <AgentThinking {...props} />
        </MemoryRouter>
      </Provider>,
    );
    const json = component.toJSON();
    expect(json).toMatchSnapshot();
  });

  it('should render with empty array', () => {
    const props = {
      thinkingSteps: [],
      isStreaming: false,
    };

    const component = renderer.create(
      <Provider store={store}>
        <MemoryRouter>
          <AgentThinking {...props} />
        </MemoryRouter>
      </Provider>,
    );
    const json = component.toJSON();
    expect(json).toMatchSnapshot();
  });

  it('should not render when streaming is complete', () => {
    const props = {
      thinkingSteps: [
        'Analyzing your query...',
        'Searching documentation...',
      ],
      isStreaming: false,
    };

    const component = renderer.create(
      <Provider store={store}>
        <MemoryRouter>
          <AgentThinking {...props} />
        </MemoryRouter>
      </Provider>,
    );
    const json = component.toJSON();
    expect(json).toBeNull();
  });

  it('should throw if thinkingSteps is not an array', () => {
    const props = {
      thinkingSteps: 'not an array',
      isStreaming: true,
    };

    expect(() => {
      renderer.create(
        <Provider store={store}>
          <MemoryRouter>
            <AgentThinking {...props} />
          </MemoryRouter>
        </Provider>,
      );
    }).toThrow('AgentThinking: thinkingSteps must be an array');
  });

  it('should throw if thinkingSteps is undefined', () => {
    const props = {
      isStreaming: true,
    };

    expect(() => {
      renderer.create(
        <Provider store={store}>
          <MemoryRouter>
            <AgentThinking {...props} />
          </MemoryRouter>
        </Provider>,
      );
    }).toThrow();
  });

  it('should throw if isStreaming is undefined', () => {
    const props = {
      thinkingSteps: ['Step 1'],
    };

    expect(() => {
      renderer.create(
        <Provider store={store}>
          <MemoryRouter>
            <AgentThinking {...props} />
          </MemoryRouter>
        </Provider>,
      );
    }).toThrow();
  });
});
