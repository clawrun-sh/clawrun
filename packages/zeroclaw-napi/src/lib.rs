use napi_derive::napi;
use serde::Serialize;

// --- Providers ---

#[napi(object)]
#[derive(Serialize)]
pub struct JsProviderInfo {
    pub name: String,
    pub display_name: String,
    pub local: bool,
}

#[napi]
pub fn get_providers() -> Vec<JsProviderInfo> {
    zeroclaw::providers::list_providers()
        .into_iter()
        .map(|p| JsProviderInfo {
            name: p.name.to_string(),
            display_name: p.display_name.to_string(),
            local: p.local,
        })
        .collect()
}

// --- Memory backends ---

#[napi(object)]
#[derive(Serialize)]
pub struct JsMemoryBackend {
    pub key: String,
    pub label: String,
}

#[napi]
pub fn get_memory_backends() -> Vec<JsMemoryBackend> {
    zeroclaw::memory::selectable_memory_backends()
        .iter()
        .map(|b| JsMemoryBackend {
            key: b.key.to_string(),
            label: b.label.to_string(),
        })
        .collect()
}

// --- Default config as JSON ---

#[napi]
pub fn get_default_config_json() -> String {
    let config = zeroclaw::config::Config::default();
    serde_json::to_string_pretty(&config).unwrap_or_default()
}

// --- Channel schemas ---

#[napi]
pub fn get_channels_schema() -> String {
    zeroclaw::setup::channels_config_schema()
}

#[napi]
pub fn get_channel_schema(key: String) -> Option<String> {
    zeroclaw::setup::channel_schema(&key)
}

// --- Channel validation (uses ZeroClaw's own health_check) ---

#[napi(object)]
#[derive(Serialize)]
pub struct JsValidationResult {
    pub ok: bool,
    pub channel: String,
    pub message: String,
}

#[napi]
pub async fn validate_channel(key: String, config_json: String) -> JsValidationResult {
    let result = zeroclaw::setup::validate_channel_credentials(&key, &config_json).await;
    JsValidationResult {
        ok: result.ok,
        channel: result.channel,
        message: result.message,
    }
}

// --- Interactive provider wizard (ZeroClaw's real provider setup) ---
// Saves provider/model/key to config.toml

#[napi(object)]
#[derive(Serialize)]
pub struct JsProviderSetupResult {
    pub provider: String,
    pub api_key: String,
    pub model: String,
    pub api_url: Option<String>,
}

#[napi]
pub async fn run_provider_wizard() -> napi::Result<JsProviderSetupResult> {
    let result = zeroclaw::setup::run_provider_wizard()
        .await
        .map_err(|e| napi::Error::from_reason(e))?;
    Ok(JsProviderSetupResult {
        provider: result.provider,
        api_key: result.api_key,
        model: result.model,
        api_url: result.api_url,
    })
}

// --- Interactive channel wizard (ZeroClaw's real dialoguer-based wizard) ---
// Loads config (with provider settings), adds channels, saves

#[napi]
pub async fn run_channel_wizard() -> napi::Result<String> {
    zeroclaw::setup::run_channel_wizard()
        .await
        .map_err(|e| napi::Error::from_reason(e))
}

// --- Read the full saved config ---

#[napi]
pub async fn get_saved_config() -> napi::Result<String> {
    zeroclaw::setup::get_saved_config()
        .await
        .map_err(|e| napi::Error::from_reason(e))
}
