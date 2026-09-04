import { describe, it, expect } from 'vitest';
import { translatePacket, translateRequest, createTranslateStream } from './protocol.js';

const wrap = (obj) => ({ placement: { turn_index: 0 }, obj });

describe('translatePacket', () => {
  it('turns a message delta into the answer_piece the components parse', () => {
    expect(translatePacket(wrap({ type: 'message_delta', content: 'Hello' }))).toEqual([
      { answer_piece: 'Hello' },
    ]);
  });

  it('emits one packet per delta so streaming stays incremental', () => {
    const first = translatePacket(wrap({ type: 'message_delta', content: 'Hel' }));
    const second = translatePacket(wrap({ type: 'message_delta', content: 'lo' }));
    expect(first.concat(second).map((p) => p.answer_piece).join('')).toBe('Hello');
  });

  it('turns search documents into top_documents', () => {
    const docs = [{ document_id: 'd1', semantic_identifier: 'Doc one' }];
    expect(
      translatePacket(wrap({ type: 'search_tool_documents_delta', documents: docs })),
    ).toEqual([{ top_documents: docs }]);
  });

  it('carries final documents from message_start through as well', () => {
    const docs = [{ document_id: 'd2' }];
    const out = translatePacket(
      wrap({ type: 'message_start', final_documents: docs, pre_answer_processing_seconds: 0 }),
    );
    expect(out).toEqual([{ top_documents: docs }]);
  });

  it('ignores message_start when it carries no documents', () => {
    expect(translatePacket(wrap({ type: 'message_start', final_documents: [] }))).toEqual([]);
  });

  it('turns a custom tool start into a tool call', () => {
    expect(
      translatePacket(wrap({ type: 'custom_tool_start', tool_name: 'table_query', tool_id: 1 })),
    ).toEqual([{ tool_name: 'table_query', tool_args: {} }]);
  });

  it('attaches tool args to the tool call', () => {
    expect(
      translatePacket(
        wrap({ type: 'custom_tool_args', tool_name: 'table_query', tool_args: { q: 'sales' } }),
      ),
    ).toEqual([{ tool_name: 'table_query', tool_args: { q: 'sales' } }]);
  });

  it('surfaces tool progress as an agent sub-answer, which is what renders steps', () => {
    // TableRAG progress arrives as custom_tool_delta. The components display
    // steps from agent_sub_answer pieces, so that is what it becomes.
    expect(
      translatePacket(
        wrap({
          type: 'custom_tool_delta',
          tool_name: 'table_query',
          response_type: 'progress',
          data: { step: 'Generating SQL' },
        }),
      ),
    ).toEqual([{ answer_piece: 'Generating SQL', answer_type: 'agent_sub_answer' }]);
  });

  it('accepts a plain string tool progress payload', () => {
    expect(
      translatePacket(
        wrap({ type: 'custom_tool_delta', tool_name: 't', response_type: 'progress', data: 'Working' }),
      ),
    ).toEqual([{ answer_piece: 'Working', answer_type: 'agent_sub_answer' }]);
  });

  it('translates reasoning deltas as sub-answers too', () => {
    expect(translatePacket(wrap({ type: 'reasoning_delta', reasoning: 'Considering' }))).toEqual([
      { answer_piece: 'Considering', answer_type: 'agent_sub_answer' },
    ]);
  });

  it('translates citations', () => {
    expect(
      translatePacket(wrap({ type: 'citation_info', citation_number: 1, document_id: 'd1' })),
    ).toEqual([{ citations: [{ citation_num: 1, document_id: 'd1' }] }]);
  });

  it('translates an error', () => {
    expect(translatePacket(wrap({ type: 'error', exception: 'boom' }))).toEqual([
      { error: 'boom' },
    ]);
  });

  it('drops packet types the current UI cannot render', () => {
    // Deep research, python and bash tools have no equivalent in the old shape,
    // and inventing a rendering for them is out of scope.
    for (const type of ['deep_research_plan_delta', 'python_tool_delta', 'bash_tool_start']) {
      expect(translatePacket(wrap({ type }))).toEqual([]);
    }
  });

  it('ignores an unknown packet type rather than throwing', () => {
    // Upstream will keep adding types; an unrecognised one must not kill a turn.
    expect(translatePacket(wrap({ type: 'something_invented_later', foo: 1 }))).toEqual([]);
  });

  it('ignores a malformed packet', () => {
    expect(translatePacket(null)).toEqual([]);
    expect(translatePacket({})).toEqual([]);
    expect(translatePacket({ obj: null })).toEqual([]);
  });
});

describe('translateRequest', () => {
  it('maps the old body onto SendMessageRequest', () => {
    const out = translateRequest({ message: 'hi', chat_session_id: 'abc', persona_id: '7' });
    expect(out.message).toBe('hi');
    expect(out.chat_session_id).toBe('abc');
  });

  it('keeps fields the new request model still understands', () => {
    const out = translateRequest({ message: 'hi', file_descriptors: [{ id: 'f1' }] });
    expect(out.file_descriptors).toEqual([{ id: 'f1' }]);
  });

  it('tolerates a missing body', () => {
    expect(translateRequest(undefined)).toEqual({ message: '' });
  });

  // Under anonymous access every tenant's documents are public, so the ACL is the
  // same for everyone and the persona's document sets are the ONLY thing keeping
  // one tenant's widget out of another's corpus.
  //
  // Onyx does not defend that boundary for us. Both places that authorise a
  // client-supplied document set — _build_index_filters and process_message —
  // are guarded by `not user.is_anonymous`, so for an anonymous caller a supplied
  // document set overrides the persona's with no access check whatsoever.
  it('drops client-supplied search filters, which would override the persona document sets', () => {
    const out = translateRequest({
      message: 'hi',
      internal_search_filters: { document_set: ['another-tenants-set'] },
    });
    expect(out.internal_search_filters).toBeUndefined();
  });

  // chat_session_info is a full ChatSessionCreationRequest embedded in the message
  // request. Forwarding it would let a caller create a session against any persona
  // and sidestep the pinning done at create-chat-session.
  it('drops an embedded session creation request, which would carry its own persona', () => {
    const out = translateRequest({
      message: 'hi',
      chat_session_info: { persona_id: 99999 },
    });
    expect(out.chat_session_info).toBeUndefined();
  });
});

describe('createTranslateStream', () => {
  async function run(chunks) {
    const stream = createTranslateStream();
    const encoder = new TextEncoder();

    // Read concurrently with writing: a TransformStream applies backpressure, so
    // draining only after close would deadlock on anything larger than the queue.
    const collected = (async () => {
      const reader = stream.readable.getReader();
      const decoder = new TextDecoder();
      let out = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return out;
        out += decoder.decode(value, { stream: true });
      }
    })();

    const writer = stream.writable.getWriter();
    for (const chunk of chunks) await writer.write(encoder.encode(chunk));
    await writer.close();
    return collected;
  }

  it('translates a stream of NDJSON packets', async () => {
    const input =
      JSON.stringify(wrap({ type: 'message_delta', content: 'a' })) +
      '\n' +
      JSON.stringify(wrap({ type: 'message_delta', content: 'b' })) +
      '\n';
    const output = await run([input]);
    const lines = output.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toEqual([{ answer_piece: 'a' }, { answer_piece: 'b' }]);
  });

  it('handles a packet split across chunk boundaries', async () => {
    // Network chunks do not respect line boundaries, and a half-parsed packet
    // must not be dropped or throw.
    const packet = JSON.stringify(wrap({ type: 'message_delta', content: 'split' })) + '\n';
    const output = await run([packet.slice(0, 20), packet.slice(20)]);
    expect(JSON.parse(output.trim())).toEqual({ answer_piece: 'split' });
  });

  it('skips a malformed line rather than killing the stream', async () => {
    const good = JSON.stringify(wrap({ type: 'message_delta', content: 'ok' })) + '\n';
    const output = await run(['not json at all\n', good]);
    expect(JSON.parse(output.trim())).toEqual({ answer_piece: 'ok' });
  });
});
