// The one config contract, filled from two sources: the Volto shell derives it
// from block data, this service serves it from a tenant record. The widget
// bundles this file, so keep it free of server-only imports.

export const DEFAULTS = {
  chatTitle: 'Ask a question',
  placeholderPrompt: 'Ask me anything…',
  starterPromptsHeading: '',
  enableStarterPrompts: true,
  starterPrompts: [],
  enableFeedback: true,
  showAssistantTitle: true,
  showAssistantDescription: false,
  showToolCalls: false,
  qualityCheck: false,
  qualityCheckContext: '',
  noSupportDocumentsMessage: '',

  // Registry-only settings. lib.js reads rewakeUrl and useBackendChat.js reads
  // rewakeDelay from the settings singleton rather than from props, so the
  // contract has to carry them or those reads are undefined outside Volto.
  //
  // rewakeUrl MUST stay a path. The widget's fetch wrapper matches on path
  // prefix, so an absolute URL would send the health ping untokenised.
  rewakeUrl: '/_da/health',
  rewakeDelay: 15,
};

// Fields the browser must never see. The assistant id above all: it is pinned
// server-side precisely so a caller cannot point one tenant's endpoint at
// another tenant's assistant.
const SERVER_ONLY = ['tenantId', 'assistantId', 'dailyTurnCap', 'allowedOrigins'];

export function validateTenantConfig(record) {
  if (!record?.tenantId) throw new Error('tenant record needs a tenantId');
  if (!record.assistantId) throw new Error('tenant record needs an assistantId');
  if (typeof record.dailyTurnCap !== 'number') {
    throw new Error('tenant record needs a numeric dailyTurnCap');
  }
  return { ...DEFAULTS, allowedOrigins: [], ...record };
}

export function toWidgetConfig(config) {
  const out = { ...config };
  for (const key of SERVER_ONLY) delete out[key];
  return out;
}
