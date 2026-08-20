// Presentation settings for a demo, and the shape the reused components expect.
//
// In the add-on these come from the current Plone page's block data. Here they
// come from the embed's data- attributes, in the same shape, so the components
// take identical config either way.
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

  // Read from the settings singleton rather than from props: lib.js reads
  // rewakeUrl and useBackendChat.js reads rewakeDelay, so these have to be
  // seeded or those reads are undefined outside Volto.
  //
  // rewakeUrl MUST stay a path. The fetch wrapper matches on path prefix, so an
  // absolute URL would bypass the rewrite and never reach Onyx.
  rewakeUrl: '/_da/health',
  rewakeDelay: 15,
};

export default DEFAULTS;
