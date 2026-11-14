import { buildApp } from './app.js';
import { loadConfig } from './platform/config.js';
import { connect } from './platform/db.js';

const config = loadConfig();
const app = await buildApp(config, connect(config.databaseUrl));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    app.log.info(`${signal}: shutting down`);
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ port: config.port, host: config.host });
