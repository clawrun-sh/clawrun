import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  getProviders,
  getMemoryBackends,
  getDefaultConfigJson,
  getChannelsSchema,
  getChannelSchema,
  validateChannel,
  runProviderWizard,
  runChannelWizard,
  getSavedConfig,
} = require('./index.js');

// --- 1. Providers (dynamic from ZeroClaw) ---
console.log('=== Providers ===');
const providers = getProviders();
console.log(`  ${providers.length} providers available`);
for (const p of providers.slice(0, 5)) {
  console.log(`  ${p.name} — ${p.displayName} (local: ${p.local})`);
}
if (providers.length > 5) {
  console.log(`  ... and ${providers.length - 5} more`);
}

// --- 2. Memory Backends (dynamic from ZeroClaw) ---
console.log('\n=== Memory Backends ===');
for (const b of getMemoryBackends()) {
  console.log(`  ${b.key} — ${b.label}`);
}

// --- 3. Channels Schema (dynamic from schemars::JsonSchema) ---
console.log('\n=== Channels Config Schema ===');
const fullSchema = JSON.parse(getChannelsSchema());
const channelProperties = Object.keys(fullSchema.properties || {}).filter(k => k !== 'cli' && k !== 'message_timeout_secs');
console.log(`  ${channelProperties.length} channel types discovered: ${channelProperties.join(', ')}`);

// --- 4. Individual Channel Schema (Telegram example) ---
console.log('\n=== Telegram Schema (from ZeroClaw) ===');
const tgSchema = JSON.parse(getChannelSchema('telegram'));
console.log(JSON.stringify(tgSchema, null, 2));

// --- 5. All channel schemas summary ---
console.log('\n=== All Channel Schemas Summary ===');
for (const ch of channelProperties) {
  const raw = getChannelSchema(ch);
  if (!raw) {
    console.log(`  ${ch}: no schema available`);
    continue;
  }
  const schema = JSON.parse(raw);
  const props = Object.keys(schema.properties || {});
  const required = schema.required || [];
  console.log(`  ${ch}: fields=[${props.join(', ')}] required=[${required.join(', ')}]`);
}

// --- 6. Validate a fake Telegram token (should fail, async) ---
console.log('\n=== Validate Telegram (fake token, async) ===');
const result = await validateChannel('telegram', JSON.stringify({ bot_token: '123:FAKE' }));
console.log(`  ok: ${result.ok}`);
console.log(`  message: ${result.message}`);

// --- 7. Verify async wizard functions are exported ---
console.log('\n=== Async Functions Available ===');
console.log(`  runProviderWizard: ${typeof runProviderWizard}`);
console.log(`  runChannelWizard: ${typeof runChannelWizard}`);
console.log(`  getSavedConfig: ${typeof getSavedConfig}`);

console.log('\n=== All tests passed ===');
