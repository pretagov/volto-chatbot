import { describe, it, expect } from 'vitest';
import { resolveOnyxPath, pinTenantFields, ALLOWED_PATHS } from './proxy.js';

describe('resolveOnyxPath', () => {
  it('maps a proxied path onto the Onyx api prefix', () => {
    expect(resolveOnyxPath('/_da/chat/send-message')).toBe('/api/chat/send-message');
  });

  it('allows exactly the four documented paths', () => {
    expect([...ALLOWED_PATHS].sort()).toEqual([
      'chat/create-chat-message-feedback',
      'chat/create-chat-session',
      'chat/send-message',
      'health',
    ]);
  });

  it('preserves a query string on an allowed path', () => {
    expect(resolveOnyxPath('/_da/health?probe=1')).toBe('/api/health?probe=1');
  });

  it('refuses persona, which is a server-to-server call and not the client’s', () => {
    // The credential check hits /api/persona/-1 from inside login(), never
    // through this proxy, so allowing it here would widen the surface the
    // allowlist exists to narrow.
    expect(resolveOnyxPath('/_da/persona/-1')).toBeNull();
    expect(resolveOnyxPath('/_da/persona?include_deleted=false')).toBeNull();
  });

  it('refuses anything else', () => {
    expect(resolveOnyxPath('/_da/admin/delete-everything')).toBeNull();
    expect(resolveOnyxPath('/_da/')).toBeNull();
    expect(resolveOnyxPath('/_da/chat')).toBeNull();
  });

  it('refuses traversal attempts', () => {
    expect(resolveOnyxPath('/_da/chat/../admin')).toBeNull();
    expect(resolveOnyxPath('/_da/../api/admin')).toBeNull();
  });

  it('refuses an absolute URL smuggled into the path', () => {
    expect(resolveOnyxPath('/_da/http://evil.test/steal')).toBeNull();
  });
});

describe('pinTenantFields', () => {
  const tenant = { assistantId: '7' };

  it('overrides a client-supplied assistant id', () => {
    // The assistant is client config in the reused components, so proxying it
    // unchanged would let one tenant's endpoint drive another's assistant.
    const body = pinTenantFields({ message: 'hi', persona_id: '999' }, tenant);
    expect(body.persona_id).toBe('7');
  });

  it('overrides alternate_assistant_id too', () => {
    const body = pinTenantFields({ alternate_assistant_id: '999' }, tenant);
    expect(body.alternate_assistant_id).toBe('7');
  });

  it('pins the assistant even when the client omits it', () => {
    const body = pinTenantFields({ message: 'hi' }, tenant);
    expect(body.persona_id).toBe('7');
    expect(body.alternate_assistant_id).toBe('7');
  });

  it('leaves the rest of the body alone', () => {
    const body = pinTenantFields({ message: 'hi', chat_session_id: 'abc' }, tenant);
    expect(body.message).toBe('hi');
    expect(body.chat_session_id).toBe('abc');
  });

  it('does not mutate the caller’s object', () => {
    const original = { message: 'hi', persona_id: '999' };
    pinTenantFields(original, tenant);
    expect(original.persona_id).toBe('999');
  });

  it('passes non-object bodies through untouched', () => {
    expect(pinTenantFields(undefined, tenant)).toBeUndefined();
    expect(pinTenantFields('raw', tenant)).toBe('raw');
  });
});
