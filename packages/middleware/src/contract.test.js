import { describe, it, expect } from 'vitest';
import { DEFAULTS, validateTenantConfig, toWidgetConfig } from './contract.js';

const validRecord = () => ({
  tenantId: 'lecc',
  assistantId: '7',
  dailyTurnCap: 100,
  allowedOrigins: ['https://lecc.test'],
});

describe('validateTenantConfig', () => {
  it('rejects a tenant without an assistant id', () => {
    expect(() => validateTenantConfig({ tenantId: 'a', dailyTurnCap: 100 })).toThrow(
      /assistantId/,
    );
  });

  it('rejects a tenant without a spend cap', () => {
    // Required, not optional: an uncapped public endpoint that costs inference
    // credits per turn is a billing risk, not just a traffic one.
    expect(() => validateTenantConfig({ tenantId: 'a', assistantId: '7' })).toThrow(
      /dailyTurnCap/,
    );
  });

  it('fills presentation defaults', () => {
    const cfg = validateTenantConfig(validRecord());
    expect(cfg.chatTitle).toBe(DEFAULTS.chatTitle);
  });

  it('defaults rewakeUrl to a path, never an absolute URL', () => {
    // The widget's fetch wrapper matches on path prefix, so an absolute URL
    // would send the health ping untokenised.
    const cfg = validateTenantConfig(validRecord());
    expect(cfg.rewakeUrl).toBe('/_da/health');
    expect(cfg.rewakeUrl.startsWith('/')).toBe(true);
  });

  it('lets a tenant override a presentation default', () => {
    const cfg = validateTenantConfig({ ...validRecord(), chatTitle: 'Ask LECC' });
    expect(cfg.chatTitle).toBe('Ask LECC');
  });
});

describe('toWidgetConfig', () => {
  it('never leaks server-only fields to the browser', () => {
    // The assistant id is pinned server-side; if it reached the browser a caller
    // could substitute another tenant's assistant.
    const widget = toWidgetConfig(validateTenantConfig(validRecord()));
    expect(widget.assistantId).toBeUndefined();
    expect(widget.dailyTurnCap).toBeUndefined();
    expect(widget.allowedOrigins).toBeUndefined();
  });

  it('keeps the forced search tool server-side', () => {
    // It decides which tool the assistant is compelled to run, so it is pinned
    // from the tenant record rather than offered to the browser.
    const widget = toWidgetConfig(
      validateTenantConfig({ ...validRecord(), searchToolId: '1' }),
    );
    expect(widget.searchToolId).toBeUndefined();
  });

  it('keeps the presentation and registry fields the widget needs', () => {
    const widget = toWidgetConfig(validateTenantConfig(validRecord()));
    expect(widget.chatTitle).toBe(DEFAULTS.chatTitle);
    expect(widget.rewakeUrl).toBe('/_da/health');
    expect(widget.rewakeDelay).toBe(DEFAULTS.rewakeDelay);
  });

  it('does not mutate the tenant config it is given', () => {
    const cfg = validateTenantConfig(validRecord());
    toWidgetConfig(cfg);
    expect(cfg.assistantId).toBe('7');
  });
});
