// Ported from the add-on's src/halloumi/middleware.js. Grounding is a single
// request/response, not a stream.
export async function callHalloumi(body, { url, token } = {}) {
  if (!url) throw new Error('HallOumi is not configured');
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  if (!response.ok) throw new Error(`HallOumi returned ${response.status}`);
  return response.json();
}
