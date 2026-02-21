export interface JsProviderInfo {
  name: string;
  displayName: string;
  local: boolean;
}

export interface JsMemoryBackend {
  key: string;
  label: string;
}

export interface JsValidationResult {
  ok: boolean;
  channel: string;
  message: string;
}

export interface JsProviderSetupResult {
  provider: string;
  apiKey: string;
  model: string;
  apiUrl: string | null;
}

export function getProviders(): JsProviderInfo[];
export function getMemoryBackends(): JsMemoryBackend[];
export function getDefaultConfigJson(): string;
export function getChannelsSchema(): string;
export function getChannelSchema(key: string): string | null;
export function validateChannel(key: string, configJson: string): Promise<JsValidationResult>;
export function runProviderWizard(): Promise<JsProviderSetupResult>;
export function runChannelWizard(): Promise<string>;
export function getSavedConfig(): Promise<string>;
