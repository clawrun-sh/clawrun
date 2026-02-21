/**
 * Interactive demo — runs ZeroClaw's provider + channel wizards via napi-rs.
 * Must be run with `-it` (interactive TTY) in Docker:
 *   docker exec -it zeroclaw-napi-test node demo.mjs
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  getProviders,
  getMemoryBackends,
  runProviderWizard,
  runChannelWizard,
  getSavedConfig,
} = require('./index.js');

console.log(`\n  Providers: ${getProviders().length}`);
console.log(`  Memory backends: ${getMemoryBackends().length}\n`);

console.log('--- Running Provider Wizard (ZeroClaw dialoguer) ---\n');
const providerResult = await runProviderWizard();
console.log('\n  Provider result:', JSON.stringify(providerResult, null, 2));

console.log('\n--- Running Channel Wizard (ZeroClaw dialoguer) ---\n');
const channelResult = await runChannelWizard();
console.log('\n  Channel wizard returned config (truncated):');
const parsed = JSON.parse(channelResult);
console.log(`  channels_config keys: ${Object.keys(parsed.channels_config || {}).filter(k => parsed.channels_config[k] != null).join(', ') || '(none)'}`);

console.log('\n--- Reading Full Saved Config ---\n');
const fullConfig = JSON.parse(await getSavedConfig());
console.log(`  provider: ${fullConfig.default_provider}`);
console.log(`  model: ${fullConfig.default_model}`);
console.log(`  api_key: ${fullConfig.api_key ? '***' : '(none)'}`);

console.log('\n  Done!');
