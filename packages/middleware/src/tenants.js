import { validateTenantConfig } from './contract.js';

// The config column is free-form JSON for presentation settings. It is spread
// FIRST so the authoritative columns always win: letting config override
// assistant_id or daily_turn_cap would put the fields that decide which content a
// caller reaches, and how much they may spend, into editable free text.
export function rowToTenant(row) {
  return validateTenantConfig({
    ...(row.config || {}),
    tenantId: row.tenant_id,
    assistantId: row.assistant_id,
    dailyTurnCap: row.daily_turn_cap,
    allowedOrigins: row.allowed_origins || [],
    // Only overrides config when the column actually holds a value, so a
    // deployment whose table predates the column can still set it in config
    // rather than silently losing the forced tool.
    ...(row.search_tool_id == null ? {} : { searchToolId: row.search_tool_id }),
  });
}

export function createTenantStore(pool) {
  return {
    async get(tenantId) {
      const { rows } = await pool.query(
        'SELECT * FROM chatbot_tenant WHERE tenant_id = $1',
        [tenantId],
      );
      return rows[0] ? rowToTenant(rows[0]) : null;
    },
  };
}
