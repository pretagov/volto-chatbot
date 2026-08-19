import { describe, it, expect } from 'vitest';
import { rowToTenant, createTenantStore } from './tenants.js';

const row = (overrides = {}) => ({
  tenant_id: 'lecc',
  assistant_id: '7',
  daily_turn_cap: 500,
  allowed_origins: ['https://lecc.test'],
  config: {},
  ...overrides,
});

describe('rowToTenant', () => {
  it('maps a database row onto the contract', () => {
    const tenant = rowToTenant(row());
    expect(tenant.tenantId).toBe('lecc');
    expect(tenant.assistantId).toBe('7');
    expect(tenant.dailyTurnCap).toBe(500);
    expect(tenant.allowedOrigins).toEqual(['https://lecc.test']);
  });

  it('fills contract defaults the row does not set', () => {
    expect(rowToTenant(row()).rewakeUrl).toBe('/_da/health');
  });

  it('lets the config column override a presentation default', () => {
    const tenant = rowToTenant(row({ config: { chatTitle: 'Ask LECC' } }));
    expect(tenant.chatTitle).toBe('Ask LECC');
  });

  it('does not let the config column smuggle in a different assistant', () => {
    // config is free-form JSON, so it must not be able to override the columns
    // that decide which tenant's content a caller reaches.
    const tenant = rowToTenant(row({ config: { assistantId: '999', dailyTurnCap: 1e9 } }));
    expect(tenant.assistantId).toBe('7');
    expect(tenant.dailyTurnCap).toBe(500);
  });

  it('refuses a row with no cap', () => {
    expect(() => rowToTenant(row({ daily_turn_cap: null }))).toThrow(/dailyTurnCap/);
  });

  it('tolerates a null origins column', () => {
    expect(rowToTenant(row({ allowed_origins: null })).allowedOrigins).toEqual([]);
  });
});

describe('createTenantStore', () => {
  it('returns null for an unknown tenant', async () => {
    const store = createTenantStore({ query: async () => ({ rows: [] }) });
    expect(await store.get('nope')).toBeNull();
  });

  it('queries by tenant id and maps the row', async () => {
    const seen = {};
    const store = createTenantStore({
      query: async (sql, params) => {
        seen.sql = sql;
        seen.params = params;
        return { rows: [row()] };
      },
    });
    const tenant = await store.get('lecc');
    expect(seen.params).toEqual(['lecc']);
    expect(seen.sql).toMatch(/WHERE tenant_id = \$1/);
    expect(tenant.assistantId).toBe('7');
  });
});
