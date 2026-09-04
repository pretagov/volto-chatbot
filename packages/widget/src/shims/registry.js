// Stands in for @plone/registry.
//
// This is a second config channel, not merely an import to satisfy: lib.js reads
// config.settings['volto-chatbot'].rewakeUrl and useBackendChat.js reads
// .rewakeDelay from this singleton rather than from props. The widget shell seeds
// it at boot from the tenant config, or those reads are undefined.
const config = {
  settings: {},
};

export default config;
