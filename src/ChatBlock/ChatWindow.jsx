import { trackEvent } from "@eeacms/volto-matomo/utils";
import { injectLazyLibs } from "@plone/volto/helpers/Loadable";
import React from "react";
import { Checkbox, Form, Popup } from "semantic-ui-react";

import AutoResizeTextarea from "./AutoResizeTextarea";
import { ChatMessageBubble, PendingResponseBubble } from "./ChatMessageBubble";
import EmptyState from "./EmptyState";
import { useScrollonStream } from "./lib";
import { useBackendChat, ChatState } from './useBackendChat';

import { sourcesForSelectedMessage, newChatTrigger } from "#stores/sidebarStore";
import { useStore } from "@nanostores/react";
import { usePrevious } from "@plone/volto/helpers";

import "./style.less";

export const IsSidebarContext = React.createContext(false);

function ChatWindow({
  persona,
  rehypePrism,
  remarkGfm,
  placeholderPrompt = "Ask a question",
  isEditMode,
  ...data
}) {
  const {
    height,
    qgenAsistantId,
    enableQgen,
    enableFeedback = true,
    scrollToInput,
    showToolCalls,
    feedbackReasons,
    qualityCheck = "disabled",
    qualityCheckStages = [],
    qualityCheckContext = "citations",
    noSupportDocumentsMessage,
    totalFailMessage,
    enableShowTotalFailMessage,
    showAssistantDescription,
    starterPromptsPosition = "top",
    enableMatomoTracking,
  } = data;
  const [qualityCheckEnabled, setQualityCheckEnabled] = React.useState(true);
  const libs = { rehypePrism, remarkGfm }; // rehypePrism, remarkGfm
  const abortController = React.useRef(new AbortController());
  const {
    onSubmit,
    messages,
    chatState,
    clearChat,
    error,
    wake,
    lastSubmittedMessage,
    clearLastSubmittedMessage,
    latestAgentStep,
    documentCount,
    isWaking,
  } = useBackendChat({
    persona: data.assistant,
    qgenAsistantId,
    enableQgen,
    signal: abortController.current.signal,
  });
  const [showLandingPage, setShowLandingPage] = React.useState(false);
  const isStreaming = chatState === ChatState.STREAMING;

  const textareaRef = React.useRef(null);
  const conversationRef = React.useRef(null);
  const endDivRef = React.useRef(null);
  const scrollDist = React.useRef(0); // Keep track of scroll distance

  React.useEffect(() => {
    if (!textareaRef.current || isEditMode) return;

    if (isStreaming || scrollToInput) {
      textareaRef.current.focus();
    }
  }, [isStreaming, scrollToInput, isEditMode]);

  const currentPersonaId = persona?.id;
  const previousPersonaId = usePrevious(currentPersonaId);
  React.useEffect(() => {
    if (previousPersonaId && currentPersonaId !== previousPersonaId) {
      handleClearChat();
    }
  }, [currentPersonaId]);

  const handleClearChat = () => {
    clearChat();
    setShowLandingPage(true);
  };

  // Listen for new chat trigger from sidebar
  const $newChatTrigger = useStore(newChatTrigger);
  const prevTrigger = usePrevious($newChatTrigger);
  React.useEffect(() => {
    if (prevTrigger !== undefined && $newChatTrigger !== prevTrigger) {
      handleClearChat();
    }
  }, [$newChatTrigger]);

  React.useEffect(() => {
    setShowLandingPage(messages.length === 0);
  }, [messages]);

  useScrollonStream({
    isStreaming,
    scrollableDivRef: conversationRef,
    scrollDist,
    endDivRef,
    distance: 500, // distance that should "engage" the scroll
    debounce: 100, // time for debouncing
  });

  const handleStarterPromptChoice = (message) => {
    if (enableMatomoTracking) {
      trackEvent({
        category: persona?.name ? `Chatbot - ${persona.name}` : "Chatbot",
        action: "Chatbot: Starter prompt click",
        name: "Message submitted",
      });
    }
    onSubmit({ message });
    setShowLandingPage(false);
  };

  return (
    <div className="chat-window">
      <div className="messages">
        {/* Show pending status on landing page only after user submits (not during background wake on focus) */}
        {showLandingPage && chatState === ChatState.SUBMITTING && (
          <PendingResponseBubble
            latestAgentStep={latestAgentStep}
            documentCount={documentCount}
            isWaking={isWaking}
          />
        )}
        {showLandingPage ? (
          <>
            {persona && showAssistantDescription && (
              <p>{persona.description}</p>
            )}

            {starterPromptsPosition === "top" && (
              <EmptyState
                {...data}
                persona={persona}
                onChoice={handleStarterPromptChoice}
                starterPromptsHeading={
                  data.displayMode === "sidebar"
                    ? null
                    : data.starterPromptsHeading
                }
              />
            )}
          </>
        ) : (
          <>
            <div
              ref={conversationRef}
              className={`conversation ${height ? "include-scrollbar" : ""}`}
              style={{ maxHeight: height }}
            >
              {messages?.map((m, index) => (
                <ChatMessageBubble
                  key={m.messageId}
                  message={m}
                  isMostRecent={index === messages.length - 1}
                  isLoading={isStreaming}
                  enableFeedback={enableFeedback}
                  feedbackReasons={feedbackReasons}
                  libs={libs}
                  qualityCheck={qualityCheck}
                  qualityCheckStages={qualityCheckStages}
                  qualityCheckEnabled={qualityCheckEnabled}
                  onChoice={(message) => {
                    onSubmit({ message });
                  }}
                  qualityCheckContext={qualityCheckContext}
                  noSupportDocumentsMessage={noSupportDocumentsMessage}
                  enableShowTotalFailMessage={enableShowTotalFailMessage}
                  totalFailMessage={totalFailMessage}
                  showToolCalls={showToolCalls}
                  isFetchingRelatedQuestions={chatState === ChatState.FETCHING_RELATED}
                  enableMatomoTracking={enableMatomoTracking}
                  persona={persona}
                  blockData={data}
                  latestAgentStep={latestAgentStep}
                  documentCount={documentCount}
                  isWaking={isWaking}
                />
              ))}
              {/* Show pending response bubble when waiting and no assistant message exists yet */}
              {[ChatState.SUBMITTING, ChatState.STREAMING].includes(chatState) &&
                (messages.length === 0 || messages[messages.length - 1]?.type === 'user') && (
                <PendingResponseBubble
                  latestAgentStep={latestAgentStep}
                  documentCount={documentCount}
                  isWaking={isWaking}
                />
              )}
              <div ref={endDivRef} /> {/* End div to mark the bottom */}
            </div>
          </>
        )}
      </div>

      <div className="chat-form">
        <Form>
          {error ? (
            <p
              id="chat-wake-error-message"
              aria-live="polite"
              className="ui red basic label form-error-label"
            >
              {error}
            </p>
          ) : null}
          <div className="textarea-wrapper">
            <AutoResizeTextarea
              maxRows={8}
              minRows={1}
              ref={textareaRef}
              placeholder={
                messages.length > 0 ? "Ask follow-up..." : placeholderPrompt
              }
              disableSubmit={[ChatState.STREAMING].includes(
                chatState,
              )}
              enableMatomoTracking={enableMatomoTracking}
              persona={persona}
              restoreMessage={error ? lastSubmittedMessage : ''}
              onRestoreMessageUsed={clearLastSubmittedMessage}
              onSubmit={(submitHandlerInput) => {
                sourcesForSelectedMessage.set([]);
                onSubmit(submitHandlerInput);
              }}
              onFocus={() => {
                wake(chatState);
              }}
              onChange={() => {
                wake(chatState);
              }}
            />
          </div>
        </Form>

        {qualityCheck === "ondemand_toggle" && (
          <div className="quality-check-toggle">
            <Popup
              wide
              basic
              className="quality-check-popup"
              content="Checks the AI's statements against cited sources to highlight possible inaccuracies and hallucinations."
              trigger={
                <Checkbox
                  id="fact-check-toggle"
                  toggle
                  label={{
                    children: "Fact-check AI answer",
                    htmlFor: "fact-check-toggle",
                  }}
                  checked={qualityCheckEnabled}
                  onChange={() => setQualityCheckEnabled((v) => !v)}
                />
              }
            />
          </div>
        )}
      </div>

      {showLandingPage && starterPromptsPosition === "bottom" && (
        <EmptyState
          {...data}
          persona={persona}
          onChoice={handleStarterPromptChoice}
        />
      )}
    </div>
  );
}

function WrappedChatWindow(props) {
  return (
    <IsSidebarContext.Provider value={props.displayMode === "sidebar"}>
      <ChatWindow {...props} />
    </IsSidebarContext.Provider>
  );
}

export default injectLazyLibs(["rehypePrism", "remarkGfm"])(WrappedChatWindow);
