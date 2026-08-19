// Cost control, not just traffic control. Every turn costs inference credits, so
// an uncapped public endpoint is a billing risk — which is why dailyTurnCap is a
// required field on the tenant record rather than an optional one.

const IP_WINDOW_SECONDS = 60;
const IP_LIMIT = 20;
const TENANT_KEY_TTL_SECONDS = 60 * 60 * 26; // a little over a day, so the UTC key expires on its own

function utcDayKey() {
  return new Date().toISOString().slice(0, 10);
}

// Metered at ADMISSION and never refunded. Metering on completion would be
// gameable in exactly the direction the cap exists to prevent: inference is
// billed as tokens are produced, so a client that aborts each stream just before
// the end would spend without ever being counted.
export async function admitTurn(redis, tenant, clientIp) {
  try {
    const tenantKey = `chat:turns:${tenant.tenantId}:${utcDayKey()}`;
    const turns = await redis.incr(tenantKey);
    await redis.expire(tenantKey, TENANT_KEY_TTL_SECONDS);
    if (turns > tenant.dailyTurnCap) {
      return { admitted: false, reason: 'tenant_cap' };
    }

    const ipKey = `chat:turns:${tenant.tenantId}:ip:${clientIp}`;
    const ipTurns = await redis.incr(ipKey);
    await redis.expire(ipKey, IP_WINDOW_SECONDS);
    if (ipTurns > IP_LIMIT) {
      return { admitted: false, reason: 'ip_rate' };
    }

    return { admitted: true };
  } catch {
    // Fail closed: an outage is cheaper than an unbounded inference bill.
    return { admitted: false, reason: 'metering_unavailable' };
  }
}
