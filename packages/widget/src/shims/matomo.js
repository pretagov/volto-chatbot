// Stands in for @eeacms/volto-matomo/utils.
//
// Matomo tracking is out of scope for the embedded widget — a host site has no
// reason to inherit EEA's analytics — but four reused components import
// trackEvent, so it must resolve to something harmless rather than being absent.
export function trackEvent() {}

export default { trackEvent };
