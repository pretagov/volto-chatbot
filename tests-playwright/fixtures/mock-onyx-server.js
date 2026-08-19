/**
 * Onyx (Danswer) + HallOumi mock.
 *
 * Extracted from mock-plone-server.js so the embeddable widget can be tested
 * without Plone. These fixtures are ours alone — upstream has no version of
 * tests-playwright — so restructuring them carries no merge risk.
 *
 * Run standalone:  node mock-onyx-server.js
 * Or mount it:     app.use(createOnyxMock())
 */
const express = require('express');

function createOnyxMock() {
  const router = express.Router();

  router.post('/api/auth/login', (req, res) => {
    // Return a mock cookie for authentication
    res.set('Set-Cookie', 'fastapiusersauth=mock-auth-token; Path=/; Max-Age=3600; HttpOnly; SameSite=lax');
    res.json({ success: true });
  });

  router.get('/api/persona/-1', (req, res) => {
    res.json({ id: -1, name: 'Test Persona' });
  });

  router.post('/api/chat/create-chat-session', (req, res) => {
    const chatSessionId = `test-session-${Date.now()}`;
    res.json({
      chat_session_id: chatSessionId,
    });
  });

  router.post('/api/chat/send-message', (req, res) => {
    const { message } = req.body;
  
    // Set headers for streaming response
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Transfer-Encoding', 'chunked');
  
    // Generate message IDs
    const userMessageId = Math.floor(Math.random() * 10000);
    const assistantMessageId = userMessageId + 1;
  
    // Stream response chunks
    const chunks = [
      // Message IDs
      { user_message_id: userMessageId, reserved_assistant_message_id: assistantMessageId },
  
      // Agent thinking (tool call)
      { tool_name: 'run_search', tool_args: { query: message } },
  
      // Agent sub-answer thinking steps (like Danswer's agent thinking)
      {
        level: null,
        level_question_num: null,
        answer_piece: 'Searching through available documents',
        answer_type: 'agent_sub_answer'
      },
      {
        level: null,
        level_question_num: null,
        answer_piece: 'Found relevant information in 1 document',
        answer_type: 'agent_sub_answer'
      },
  
      // Search results
      {
        level: null,
        level_question_num: null,
        top_documents: [
          {
            document_id: 'test-doc-1',
            semantic_identifier: 'Test Document',
            link: 'https://example.com/test',
            blurb: 'This is a test document for the chatbot.',
            score: 0.95,
          },
        ],
      },
  
      // Answer chunks - include reasoning model thinking tags and regular content
      { answer_piece: '<thinking>Analyzing the question and documents to formulate a response.</thinking>' },
      ...`This is a test response to your question: "${message}". The chatbot is working correctly in test mode.`
        .split(' ')
        .map((word) => ({ answer_piece: word + ' ' })),
  
      // Final message
      { message_id: assistantMessageId },
    ];
  
    // Send chunks with small delays to simulate streaming
    let index = 0;
    const sendChunk = () => {
      if (index < chunks.length) {
        res.write(JSON.stringify(chunks[index]) + '\n');
        index++;
        setTimeout(sendChunk, 50); // 50ms delay between chunks
      } else {
        res.end();
      }
    };
  
    sendChunk();
  });

// Feedback endpoint the widget calls through /_da/chat/create-chat-message-feedback.
router.post('/api/chat/create-chat-message-feedback', (req, res) => {
  res.json({ success: true });
});

// Health, used by the rewake ping in lib.js.
router.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// HallOumi grounding — absent from the original mock entirely.
router.post('/halloumi/generate', (req, res) => {
  res.json({
    claims: [{ claim_id: 0, supported: true, score: 0.92, rationale: 'mock grounding' }],
  });
});

  return router;
}

module.exports = { createOnyxMock };

// Standalone mode, so the widget suite can run without the Plone mock.
if (require.main === module) {
  const app = express();
  app.use(express.json());
  app.use(createOnyxMock());
  const port = process.env.PORT || 9100;
  app.listen(port, () => console.log(`Mock Onyx API listening on ${port}`));
}
