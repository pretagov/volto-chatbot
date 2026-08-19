import pg from 'pg';
import Redis from 'ioredis';
import { createApp } from './app.js';
import { createTenantStore } from './tenants.js';

// Fail at boot rather than on the first request: a missing signing secret would
// otherwise mint tokens anyone could forge.
if (!process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET is required');
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const app = createApp({
  secret: process.env.SESSION_SECRET,
  tenants: createTenantStore(pool),
  redis: new Redis(process.env.REDIS_URL),
  onyx: {
    baseUrl: process.env.DANSWER_URL,
    username: process.env.DANSWER_USERNAME,
    password: process.env.DANSWER_PASSWORD,
    apiKey: process.env.DANSWER_API_KEY,
  },
  halloumi: { url: process.env.LLMGW_URL, token: process.env.LLMGW_TOKEN },
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`chatbot middleware listening on ${port}`);
});
