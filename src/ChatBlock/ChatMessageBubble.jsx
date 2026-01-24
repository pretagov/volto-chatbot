import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { visit } from 'unist-util-visit';
import loadable from '@loadable/component';
import { Button, Message, MessageContent, Icon } from 'semantic-ui-react';
import { trackEvent } from '@eeacms/volto-matomo/utils';
import { SourceDetails } from './Source';
import { SVGIcon, useCopyToClipboard } from './utils';
import ChatMessageFeedback from './ChatMessageFeedback';
import useQualityMarkers from './useQualityMarkers';
import Spinner from './Spinner';
import { useDeepCompareMemoize } from './useDeepCompareMemoize';
import { components } from './MarkdownComponents';
import { serializeNodes } from '@plone/volto-slate/editor/render';

import BotIcon from './../icons/bot.svg';
import UserIcon from './../icons/user.svg';
import CopyIcon from './../icons/copy.svg';
import CheckIcon from './../icons/check.svg';
import GlassesIcon from './../icons/glasses.svg';

import { sourcesForSelectedMessage } from "#stores/sidebarStore";
import LinkIcon from "@plone/volto/icons/link.svg";
import SearchIcon from "@plone/volto/icons/zoom.svg";

const CITATION_MATCH = /\[\d+\](?![[(\])])/gm;

const Markdown = loadable(() => import('react-markdown'));

const VERIFY_CLAIM_MESSAGES = [
  'Going through each claim and verify against the referenced documents...',
  'Summarising claim verifications results...',
  'Calculating scores...',
];

// TODO: don't use this over the text like this, make it a rehype plugin
function addCitations(text) {
  return text.replaceAll(CITATION_MATCH, (match) => {
    const number = match.match(/\d+/)[0];
    return `${match}(${number})`;
  });
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function ToolCall({ tool_args, tool_name, thinkingSteps = [] }) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (tool_name === 'run_search') {
    const hasSteps = thinkingSteps.length > 0;
    return (
      <div className="tool_info">
        <span>Searched for: <em>{tool_args?.query || ''}</em></span>
        {hasSteps && (
          <>
            <button
              className="steps-toggle"
              onClick={() => setIsExpanded(!isExpanded)}
              aria-expanded={isExpanded}
              aria-label={isExpanded ? 'Hide steps' : 'Show steps'}
              aria-controls="search-steps-content"
            >
              <Icon name={isExpanded ? 'chevron up' : 'chevron down'} size="small" />
            </button>
            {isExpanded && (
              <div id="search-steps-content" className="search-steps">
                {thinkingSteps.map((step, idx) => (
                  <div key={idx} className="search-step">
                    {step}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    );
  }
  return null;
}

export function AgentThinking({ thinkingSteps, isStreaming }) {
  // Fail loudly if invalid props
  if (!Array.isArray(thinkingSteps)) {
    throw new Error('AgentThinking: thinkingSteps must be an array');
  }
  if (typeof isStreaming !== 'boolean') {
    throw new Error('AgentThinking: isStreaming must be a boolean');
  }

  const [isExpanded, setIsExpanded] = useState(true);

  // Don't render if no thinking steps or if streaming is complete
  if (thinkingSteps.length === 0 || !isStreaming) {
    return null;
  }

  return (
    <div className="agent-thinking">
      <div
        className="thinking-header"
        onClick={() => setIsExpanded(!isExpanded)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsExpanded(!isExpanded);
          }
        }}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        aria-controls="thinking-steps-content"
      >
        <Icon name={isExpanded ? 'chevron down' : 'chevron right'} />
        <span>Agent thinking ({thinkingSteps.length} steps)</span>
      </div>
      {isExpanded && (
        <div id="thinking-steps-content" className="thinking-steps">
          {thinkingSteps.map((step, idx) => (
            <div key={idx} className="thinking-step">
              {step}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

AgentThinking.propTypes = {
  thinkingSteps: PropTypes.array.isRequired,
  isStreaming: PropTypes.bool.isRequired,
};

function getStatusText(agentStep, documentCount, isWaking) {
  if (isWaking) return "Warming up...";
  if (agentStep) return agentStep;
  if (documentCount > 0) return `Generating response from ${documentCount} documents...`;
  // "Thinking..." until we get the query from the response
  return "Thinking...";
}

export function PendingResponseBubble({ latestAgentStep, documentCount, isWaking }) {
  const statusText = getStatusText(latestAgentStep, documentCount, isWaking);

  return (
    <div className="comment comment--assistant">
      <div className="circle assistant" aria-hidden="true">
        <SVGIcon name={BotIcon} size="20" color="white" />
      </div>
      <div className="message-status">
        <SVGIcon name={SearchIcon} size="16" />
        <span>{statusText}</span>
      </div>
    </div>
  );
}

PendingResponseBubble.propTypes = {
  latestAgentStep: PropTypes.string,
  documentCount: PropTypes.number,
  isWaking: PropTypes.bool,
};

function addQualityMarkersPlugin() {
  return function (tree) {
    visit(tree, 'text', function (node, idx, parent) {
      if (node.value?.trim()) {
        const newNode = {
          type: 'element',
          tagName: 'span',
          children: [node],
        };
        parent.children[idx] = newNode;
      }
    });
  };
}

function visitTextNodes(node, visitor) {
  if (Array.isArray(node)) {
    node.forEach((child) => visitTextNodes(child, visitor));
  } else if (node && typeof node === 'object') {
    if (node.text !== undefined) {
      // Process the text node value here
      // console.log(node.text);
      visitor(node);
    }
    if (node.children) {
      visitTextNodes(node.children, visitor);
    }
  }
}

function printSlate(value, score) {
  if (typeof value === 'string') {
    return value.replaceAll('{score}', score);
  }
  function visitor(node) {
    if (node.text.indexOf('{score}') > -1) {
      node.text = node.text.replaceAll('{score}', score);
    }
  }

  visitTextNodes(value, visitor);
  return serializeNodes(value);
}

function VerifyClaims() {
  const [message, setMessage] = React.useState(0);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      if (message < VERIFY_CLAIM_MESSAGES.length - 1) {
        setMessage(message + 1);
      }
    }, 5000);
    return () => clearTimeout(timer);
  }, [message]);

  return (
    <div className="verify-claims">
      <Spinner />
      {VERIFY_CLAIM_MESSAGES[message]}
    </div>
  );
}

function HalloumiFeedback({
  halloumiMessage,
  isLoadingHalloumi,
  markers,
  score,
  scoreColor,
  setForceHallomi,
  showVerifyClaimsButton,
  sources,
}) {
  const noClaimsScore = markers?.claims[0]?.score === null;
  const messageBySource =
    'Please allow a few minutes for claim verification when many references are involved.';

  return (
    <>
      {showVerifyClaimsButton && (
        <div className="halloumi-feedback-button">
          <Button onClick={() => setForceHallomi(true)} className="claims-btn">
            <SVGIcon name={GlassesIcon} /> Verify AI claims
          </Button>
          <div>
            <span>{messageBySource}</span>{' '}
          </div>
        </div>
      )}

      {isLoadingHalloumi && sources.length > 0 && (
        <Message color="blue">
          <VerifyClaims />
        </Message>
      )}

      {noClaimsScore && (
        <Message color="red">{markers?.claims?.[0].rationale}</Message>
      )}

      {!!halloumiMessage && !!markers && !noClaimsScore && (
        <Message color={scoreColor} icon>
          <MessageContent>
            {printSlate(halloumiMessage, `${score}%`)}
          </MessageContent>
        </Message>
      )}
    </>
  );
}

function UserActionsToolbar({
  copied,
  message,
  handleCopy,
  enableFeedback,
  feedbackReasons,
  enableMatomoTracking,
  persona,
}) {
  return (
    <div className="message-actions">
      <Button
        basic
        onClick={() => handleCopy()}
        title="Copy"
        aria-label="Copy"
        disabled={copied}
      >
        {copied ? <SVGIcon name={CheckIcon} /> : <SVGIcon name={CopyIcon} />}
      </Button>

      {enableFeedback && (
        <>
          <ChatMessageFeedback
            message={message}
            feedbackReasons={feedbackReasons}
            enableMatomoTracking={enableMatomoTracking}
            persona={persona}
          />
        </>
      )}
    </div>
  );
}

export function addHalloumiContext(doc, text) {
  const updatedDate = doc.updated_at
    ? new Date(doc.updated_at).toLocaleString('en-GB', {
        year: 'numeric',
        month: 'long',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

  const docIndex = doc.index ? `DOCUMENT ${doc.index}: ` : '';

  const sourceType = doc.source_type
    ? { web: 'Website', file: 'File' }[doc.source_type] ||
      capitalize(doc.source_type)
    : '';

  const header = `${docIndex}${doc.semantic_identifier}${
    sourceType ? `\nSource: ${sourceType}` : ''
  }${updatedDate ? `\nUpdated: ${updatedDate}` : ''}`;

  return `${header}\n${text}`;
}

export function ChatMessageBubble(props) {
  const {
    message,
    isLoading,
    isMostRecent,
    libs,
    onChoice,
    showToolCalls,
    enableFeedback,
    feedbackReasons,
    qualityCheck,
    qualityCheckStages,
    qualityCheckContext,
    qualityCheckEnabled,
    noSupportDocumentsMessage,
    totalFailMessage,
    isFetchingRelatedQuestions,
    enableShowTotalFailMessage,
    enableMatomoTracking,
    persona,
    blockData,
    latestAgentStep,
    documentCount,
    isWaking,
  } = props;
  const { remarkGfm } = libs; // , rehypePrism
  const { citations = {}, documents = [], type } = message;
  const isUser = type === 'user';
  const [copied, handleCopy] = useCopyToClipboard(message.message);
  const [forceHalloumi, setForceHallomi] = React.useState(
    qualityCheck === 'enabled',
  );

  React.useEffect(() => {
    if (qualityCheck === 'ondemand_toggle' && qualityCheckEnabled) {
      setForceHallomi(true);
    }
  }, [qualityCheck, qualityCheckEnabled]);

  const inverseMap = Object.entries(citations).reduce((acc, [k, v]) => {
    return { ...acc, [v]: k };
  }, {});

  const sources = Object.values(citations).map((doc_id) => ({
    ...(documents.find((doc) => doc.db_doc_id === doc_id) || {}),
    index: inverseMap[doc_id],
  }));
  // const showLoader = isMostRecent && isLoading;
  const showSources = sources.length > 0;

  // TODO: maybe this should be just on the first tool call?
  const documentIdToText = message.toolCalls?.reduce((acc, cur) => {
    return {
      ...acc,
      ...Object.assign(
        {},
        ...(cur.tool_result || []).map((doc) => ({
          [doc.document_id]: doc.content,
        })),
      ),
    };
  }, {});
  // console.log({ qualityCheckContext });

  const contextSources =
    qualityCheckContext === 'citations'
      ? sources.map((doc) => ({
          ...doc,
          id: doc.document_id,
          text: documentIdToText[doc.document_id] || '',
          halloumiContext: addHalloumiContext(
            doc,
            documentIdToText[doc.document_id] || '',
          ),
        }))
      : (message.toolCalls || []).reduce(
          (acc, cur) => [
            ...acc,
            ...(cur.tool_result || []).map((doc) => ({
              ...doc,
              id: doc.document_id,
              text: doc.content,
              halloumiContext: addHalloumiContext(doc, doc.content),
            })),
          ], // TODO: make sure we don't add multiple times the same doc
          // TODO: this doesn't have the index for source
          [],
        );

  const stableContextSources = useDeepCompareMemoize(contextSources);

  const doQualityControl =
    !isUser &&
    qualityCheck &&
    qualityCheck !== 'disabled' &&
    forceHalloumi &&
    showSources &&
    qualityCheckEnabled &&
    message.messageId > -1;
  const { markers, isLoadingHalloumi } = useQualityMarkers(
    doQualityControl,
    addCitations(message.message),
    stableContextSources,
  );
  // console.log({ message, sources, documentIdToText, citedSources });

  const claims = markers?.claims || [];
  const score = (
    (claims.length > 0
      ? claims.reduce((acc, { score }) => acc + score, 0) / claims.length
      : 1) * 100
  ).toFixed(0);

  const scoreStage = qualityCheckStages?.find(
    ({ start, end }) => start <= score && score <= end,
  );
  const isFirstScoreStage =
    qualityCheckStages?.reduce(
      (acc, { start, end }, curIx) =>
        start <= score && score <= end ? curIx : acc,
      -1,
    ) ?? -1;
  const scoreColor = scoreStage?.color || 'black';

  const isFetching = isLoadingHalloumi || isLoading;
  const halloumiMessage = doQualityControl ? scoreStage?.label : '';

  const showVerifyClaimsButton =
    sources.length > 0 &&
    qualityCheck === 'ondemand' &&
    !isFetching &&
    !markers;
  const showTotalFailMessage =
    sources.length === 0 && !isFetching && enableShowTotalFailMessage;
  const showRelatedQuestions = message.relatedQuestions?.length > 0;

  const handleRelatedQuestionClick = (question) => {
    if (!isLoading) {
      if (enableMatomoTracking) {
        trackEvent({
          category: persona?.name ? `Chatbot - ${persona.name}` : 'Chatbot',
          action: 'Chatbot: Related question click',
          name: 'Message submitted',
        });
      }
      onChoice(question);
    }
  };

  return (
    <div>
      <div className={`comment ${isUser ? 'comment--user' : 'comment--assistant'}`}>
        {isUser ? (
          <div className="circle user">
            <SVGIcon name={UserIcon} size="20" color="white" />
          </div>
        ) : (
          <div className="circle assistant">
            <SVGIcon name={BotIcon} size="20" color="white" />
          </div>
        )}
        <div>
          {/* Show status when this is the most recent assistant message and still loading */}
          {!isUser && isMostRecent && isLoading && (() => {
            const searchQuery = message.query || message.toolCalls?.[0]?.tool_args?.query;
            const statusText = isWaking
              ? 'Warming up...'
              : latestAgentStep
                ? latestAgentStep
                : documentCount > 0
                  ? `Generating response from ${documentCount} documents...`
                  : searchQuery
                    ? `Searching for: ${searchQuery}`
                    : 'Thinking...';
            return (
              <div className="message-status">
                <SVGIcon name={SearchIcon} size="16" />
                <span>{statusText}</span>
              </div>
            );
          })()}

          {/* Hide tool calls while loading - status replaces "Searched for:" */}
          {showToolCalls && !(isMostRecent && isLoading) &&
            message.toolCalls?.map((info, index) => (
              <ToolCall key={index} {...info} thinkingSteps={message.agentThinking} />
            ))}

          {Object.keys(documents).length > 0 &&
            blockData.displayMode === 'sidebar' && (
              <>
                <Button
                  onClick={() => {
                    sourcesForSelectedMessage.set(documents);
                  }}
                  className="floated show-sources-button"
                >
                  <span aria-hidden="true">
                    <SVGIcon name={LinkIcon} />
                  </span>
                  {`${Object.keys(documents).length} results`}
                </Button>
              </>
            )}

          <Markdown
            components={components(message, markers, stableContextSources)}
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[addQualityMarkersPlugin]}
          >
            {addCitations(message.message)}
          </Markdown>

          {!isUser && showTotalFailMessage && (
            <Message color="red">{serializeNodes(totalFailMessage)}</Message>
          )}

          <div className="sources">
            {sources.map((source, i) => (
              <SourceDetails source={source} key={i} index={source.index} />
            ))}
          </div>

          {!isUser && (
            <HalloumiFeedback
              sources={sources}
              halloumiMessage={halloumiMessage}
              isLoadingHalloumi={isLoadingHalloumi}
              markers={markers}
              score={score}
              scoreColor={scoreColor}
              setForceHallomi={setForceHallomi}
              showVerifyClaimsButton={showVerifyClaimsButton}
            />
          )}

          {!isUser && !isLoading && (
            <UserActionsToolbar
              handleCopy={handleCopy}
              copied={copied}
              enableFeedback={enableFeedback}
              message={message}
              feedbackReasons={feedbackReasons}
              enableMatomoTracking={enableMatomoTracking}
              persona={persona}
            />
          )}

          {isFirstScoreStage === -1 &&
            serializeNodes(noSupportDocumentsMessage)}

          {!isUser && isFetchingRelatedQuestions && (
            <div className="related-questions-loader">
              <Spinner />
              Finding related questions...
            </div>
          )}

          {showRelatedQuestions && (
            <>
              <h5>Related questions:</h5>
              <div className="chat-related-questions">
                {message.relatedQuestions?.map(({ question }) => (
                  <div
                    className="relatedQuestionButton"
                    role="button"
                    onClick={() => handleRelatedQuestionClick(question)}
                    onKeyDown={() => handleRelatedQuestionClick(question)}
                    tabIndex="-1"
                  >
                    {question}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
