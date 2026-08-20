import { Transform } from 'node:stream';

// Translates upgraded Onyx's streaming protocol into the shape the existing chat
// components already parse.
//
// Upstream renamed the endpoint and replaced flat packets with NDJSON Packet
// envelopes carrying typed objects. Rather than rewrite useBackendChat.js — one of
// the most-churned files in the add-on, with upstream 280 commits ahead on the old
// protocol — the translation lives here, in code that is entirely ours. If EEA
// migrate later, this layer is deleted.

// Packet types with no equivalent in the old shape. The current UI has nothing to
// render them with, so they are dropped rather than guessed at.
const IGNORED = new Set([
  'section_end',
  'chat_heartbeat',
  'reasoning_start',
  'reasoning_done',
  'top_level_branching',
  'tool_call_debug',
  'search_tool_start',
  'search_tool_queries_delta',
  'search_tool_filter_delta',
  'open_url_start',
  'open_url_urls',
  'open_url_documents',
  'image_generation_start',
  'image_generation_heartbeat',
  'image_generation_final',
  'python_tool_start',
  'python_tool_delta',
  'bash_tool_start',
  'bash_tool_delta',
  'memory_tool_start',
  'memory_tool_delta',
  'memory_tool_no_access',
  'deep_research_plan_start',
  'deep_research_plan_delta',
  'research_agent_start',
  'intermediate_report_start',
  'intermediate_report_delta',
  'intermediate_report_cited_docs',
  'coding_agent_start',
  'coding_agent_thinking_delta',
  'coding_agent_final',
  'file_reader_start',
  'file_reader_result',
  'tool_call_argument_delta',
  'custom_tool_args_delta',
]);

// Tool progress carries structured data; the components render steps from plain
// strings, so pull out the most useful text we can find.
function progressText(data) {
  if (typeof data === 'string') return data;
  if (data && typeof data === 'object') {
    return data.step ?? data.message ?? data.status ?? null;
  }
  return null;
}

export function translatePacket(packet) {
  const obj = packet?.obj;
  if (!obj || typeof obj !== 'object' || !obj.type) return [];

  switch (obj.type) {
    case 'message_delta':
      return obj.content ? [{ answer_piece: obj.content }] : [];

    case 'message_start':
      return obj.final_documents?.length ? [{ top_documents: obj.final_documents }] : [];

    case 'search_tool_documents_delta':
      return obj.documents?.length ? [{ top_documents: obj.documents }] : [];

    case 'custom_tool_start':
      return [{ tool_name: obj.tool_name, tool_args: {} }];

    case 'custom_tool_args':
      return [{ tool_name: obj.tool_name, tool_args: obj.tool_args ?? {} }];

    case 'custom_tool_delta': {
      // TableRAG progress arrives here. The components display steps from
      // agent_sub_answer pieces, so that is the shape it has to take.
      const text = progressText(obj.data);
      return text ? [{ answer_piece: text, answer_type: 'agent_sub_answer' }] : [];
    }

    case 'reasoning_delta':
      return obj.reasoning
        ? [{ answer_piece: obj.reasoning, answer_type: 'agent_sub_answer' }]
        : [];

    case 'citation_info':
      return [
        { citations: [{ citation_num: obj.citation_number, document_id: obj.document_id }] },
      ];

    case 'error':
      return [{ error: obj.exception ?? 'error' }];

    case 'stop':
      // The old format ends the stream by closing it, so nothing to emit.
      return [];

    default:
      // Includes IGNORED and anything upstream adds later. An unrecognised type
      // must never kill a turn.
      return [];
  }
}

export function translateRequest(body, onyxPath = '') {
  const source = body && typeof body === 'object' ? body : {};

  // Session creation keeps its own shape — notably persona_id, which is where the
  // tenant's assistant is pinned now that the message request has no persona.
  if (onyxPath.includes('create-chat-session')) {
    return { ...source };
  }

  const request = { message: source.message ?? '' };

  // Fields the new SendMessageRequest still understands, forwarded when present.
  for (const key of [
    'chat_session_id',
    'parent_message_id',
    'file_descriptors',
    'llm_override',
    'allowed_tool_ids',
    'forced_tool_id',
    'deep_research',
  ]) {
    if (source[key] !== undefined) request[key] = source[key];
  }

  return request;
}

export function createTranslateStream() {
  let buffer = '';

  return new Transform({
    transform(chunk, _encoding, done) {
      buffer += chunk.toString();

      // Network chunks do not respect line boundaries, so keep the trailing
      // partial line for the next chunk.
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        let packet;
        try {
          packet = JSON.parse(line);
        } catch {
          // One bad line must not take the whole answer down.
          continue;
        }
        for (const translated of translatePacket(packet)) {
          this.push(`${JSON.stringify(translated)}\n`);
        }
      }
      done();
    },

    flush(done) {
      if (buffer.trim()) {
        try {
          for (const translated of translatePacket(JSON.parse(buffer))) {
            this.push(`${JSON.stringify(translated)}\n`);
          }
        } catch {
          // Truncated final line; nothing useful to salvage.
        }
      }
      done();
    },
  });
}
