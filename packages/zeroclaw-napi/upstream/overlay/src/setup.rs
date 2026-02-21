//! Channel setup descriptors and validation for external consumers (e.g. napi-rs bridge).
//!
//! Validation reuses ZeroClaw's own channel `health_check()` implementations —
//! zero duplicated HTTP logic.

use serde::{Deserialize, Serialize};

/// Returns the JSON Schema for the entire ChannelsConfig struct.
pub fn channels_config_schema() -> String {
    let generator = schemars::generate::SchemaSettings::default().into_generator();
    let schema = generator.into_root_schema_for::<crate::config::ChannelsConfig>();
    serde_json::to_string_pretty(&schema).unwrap_or_default()
}

/// Returns the JSON Schema for a specific channel config struct, identified by key.
pub fn channel_schema(key: &str) -> Option<String> {
    use crate::config::schema;

    let generator = schemars::generate::SchemaSettings::default().into_generator();
    let schema = match key {
        "telegram" => generator.into_root_schema_for::<schema::TelegramConfig>(),
        "discord" => generator.into_root_schema_for::<schema::DiscordConfig>(),
        "slack" => generator.into_root_schema_for::<schema::SlackConfig>(),
        "mattermost" => generator.into_root_schema_for::<schema::MattermostConfig>(),
        "webhook" => generator.into_root_schema_for::<schema::WebhookConfig>(),
        "imessage" => generator.into_root_schema_for::<schema::IMessageConfig>(),
        "matrix" => generator.into_root_schema_for::<schema::MatrixConfig>(),
        "signal" => generator.into_root_schema_for::<schema::SignalConfig>(),
        "whatsapp" => generator.into_root_schema_for::<schema::WhatsAppConfig>(),
        "linq" => generator.into_root_schema_for::<schema::LinqConfig>(),
        "nextcloud_talk" => generator.into_root_schema_for::<schema::NextcloudTalkConfig>(),
        "email" => generator.into_root_schema_for::<crate::channels::email_channel::EmailConfig>(),
        "irc" => generator.into_root_schema_for::<schema::IrcConfig>(),
        "lark" => generator.into_root_schema_for::<schema::LarkConfig>(),
        "dingtalk" => generator.into_root_schema_for::<schema::DingTalkConfig>(),
        "qq" => generator.into_root_schema_for::<schema::QQConfig>(),
        "nostr" => generator.into_root_schema_for::<schema::NostrConfig>(),
        "clawdtalk" => generator.into_root_schema_for::<crate::channels::clawdtalk::ClawdTalkConfig>(),
        _ => return None,
    };
    Some(serde_json::to_string_pretty(&schema).unwrap_or_default())
}

/// Result of a channel credential validation attempt.
#[derive(Debug, Serialize, Deserialize)]
pub struct ChannelValidationResult {
    pub ok: bool,
    pub channel: String,
    pub message: String,
}

/// Validate channel credentials by constructing the real ZeroClaw channel
/// and calling its `health_check()` method — zero duplicated logic.
pub async fn validate_channel_credentials(channel_key: &str, config_json: &str) -> ChannelValidationResult {
    use crate::channels::*;

    match channel_key {
        "telegram" => {
            #[derive(Deserialize)]
            struct C { bot_token: String, #[serde(default)] allowed_users: Vec<String>, #[serde(default)] mention_only: bool }
            let c: C = match serde_json::from_str(config_json) { Ok(c) => c, Err(e) => return err(channel_key, &format!("Invalid config: {e}")) };
            let ch = TelegramChannel::new(c.bot_token, c.allowed_users, c.mention_only);
            health(channel_key, ch.health_check().await)
        }
        "discord" => {
            #[derive(Deserialize)]
            struct C { bot_token: String, #[serde(default)] guild_id: Option<String>, #[serde(default)] allowed_users: Vec<String>, #[serde(default)] listen_to_bots: bool, #[serde(default)] mention_only: bool }
            let c: C = match serde_json::from_str(config_json) { Ok(c) => c, Err(e) => return err(channel_key, &format!("Invalid config: {e}")) };
            let ch = DiscordChannel::new(c.bot_token, c.guild_id, c.allowed_users, c.listen_to_bots, c.mention_only);
            health(channel_key, ch.health_check().await)
        }
        "slack" => {
            #[derive(Deserialize)]
            struct C { bot_token: String, #[serde(default)] channel_id: Option<String>, #[serde(default)] allowed_users: Vec<String> }
            let c: C = match serde_json::from_str(config_json) { Ok(c) => c, Err(e) => return err(channel_key, &format!("Invalid config: {e}")) };
            let ch = SlackChannel::new(c.bot_token, c.channel_id, c.allowed_users);
            health(channel_key, ch.health_check().await)
        }
        "mattermost" => {
            #[derive(Deserialize)]
            struct C { url: String, bot_token: String, #[serde(default)] channel_id: Option<String>, #[serde(default)] allowed_users: Vec<String>, #[serde(default)] thread_replies: bool, #[serde(default)] mention_only: bool }
            let c: C = match serde_json::from_str(config_json) { Ok(c) => c, Err(e) => return err(channel_key, &format!("Invalid config: {e}")) };
            let ch = MattermostChannel::new(c.url, c.bot_token, c.channel_id, c.allowed_users, c.thread_replies, c.mention_only);
            health(channel_key, ch.health_check().await)
        }
        #[cfg(feature = "channel-matrix")]
        "matrix" => {
            #[derive(Deserialize)]
            struct C { homeserver: String, access_token: String, room_id: String, #[serde(default)] allowed_users: Vec<String> }
            let c: C = match serde_json::from_str(config_json) { Ok(c) => c, Err(e) => return err(channel_key, &format!("Invalid config: {e}")) };
            let ch = MatrixChannel::new(c.homeserver, c.access_token, c.room_id, c.allowed_users);
            health(channel_key, ch.health_check().await)
        }
        "whatsapp" => {
            #[derive(Deserialize)]
            struct C { access_token: String, phone_number_id: String, #[serde(default)] verify_token: Option<String>, #[serde(default)] allowed_numbers: Vec<String> }
            let c: C = match serde_json::from_str(config_json) { Ok(c) => c, Err(e) => return err(channel_key, &format!("Invalid config: {e}")) };
            let ch = WhatsAppChannel::new(c.access_token, c.phone_number_id, c.verify_token.unwrap_or_default(), c.allowed_numbers);
            health(channel_key, ch.health_check().await)
        }
        "signal" => {
            #[derive(Deserialize)]
            struct C { http_url: String, account: String, #[serde(default)] group_id: Option<String>, #[serde(default)] allowed_from: Vec<String>, #[serde(default)] ignore_attachments: bool, #[serde(default)] ignore_stories: bool }
            let c: C = match serde_json::from_str(config_json) { Ok(c) => c, Err(e) => return err(channel_key, &format!("Invalid config: {e}")) };
            let ch = SignalChannel::new(c.http_url, c.account, c.group_id, c.allowed_from, c.ignore_attachments, c.ignore_stories);
            health(channel_key, ch.health_check().await)
        }
        "dingtalk" => {
            #[derive(Deserialize)]
            struct C { client_id: String, client_secret: String, #[serde(default)] allowed_users: Vec<String> }
            let c: C = match serde_json::from_str(config_json) { Ok(c) => c, Err(e) => return err(channel_key, &format!("Invalid config: {e}")) };
            let ch = DingTalkChannel::new(c.client_id, c.client_secret, c.allowed_users);
            health(channel_key, ch.health_check().await)
        }
        "qq" => {
            #[derive(Deserialize)]
            struct C { app_id: String, app_secret: String, #[serde(default)] allowed_users: Vec<String> }
            let c: C = match serde_json::from_str(config_json) { Ok(c) => c, Err(e) => return err(channel_key, &format!("Invalid config: {e}")) };
            let ch = QQChannel::new(c.app_id, c.app_secret, c.allowed_users);
            health(channel_key, ch.health_check().await)
        }
        "linq" => {
            #[derive(Deserialize)]
            struct C { api_token: String, from_phone: String, #[serde(default)] allowed_senders: Vec<String> }
            let c: C = match serde_json::from_str(config_json) { Ok(c) => c, Err(e) => return err(channel_key, &format!("Invalid config: {e}")) };
            let ch = LinqChannel::new(c.api_token, c.from_phone, c.allowed_senders);
            health(channel_key, ch.health_check().await)
        }
        #[cfg(feature = "channel-lark")]
        "lark" => {
            #[derive(Deserialize)]
            struct C { app_id: String, app_secret: String, #[serde(default)] verification_token: Option<String>, #[serde(default)] port: Option<u16>, #[serde(default)] allowed_users: Vec<String> }
            let c: C = match serde_json::from_str(config_json) { Ok(c) => c, Err(e) => return err(channel_key, &format!("Invalid config: {e}")) };
            let ch = LarkChannel::new(c.app_id, c.app_secret, c.verification_token.unwrap_or_default(), c.port, c.allowed_users);
            health(channel_key, ch.health_check().await)
        }
        "nextcloud_talk" => {
            #[derive(Deserialize)]
            struct C { base_url: String, app_token: String, #[serde(default)] allowed_users: Vec<String> }
            let c: C = match serde_json::from_str(config_json) { Ok(c) => c, Err(e) => return err(channel_key, &format!("Invalid config: {e}")) };
            let ch = NextcloudTalkChannel::new(c.base_url, c.app_token, c.allowed_users);
            health(channel_key, ch.health_check().await)
        }
        "email" => {
            let cfg: crate::channels::email_channel::EmailConfig = match serde_json::from_str(config_json) {
                Ok(c) => c, Err(e) => return err(channel_key, &format!("Invalid config: {e}"))
            };
            let ch = EmailChannel::new(cfg);
            health(channel_key, ch.health_check().await)
        }
        "imessage" => {
            #[derive(Deserialize)]
            struct C { #[serde(default)] allowed_contacts: Vec<String> }
            let c: C = match serde_json::from_str(config_json) { Ok(c) => c, Err(e) => return err(channel_key, &format!("Invalid config: {e}")) };
            let ch = IMessageChannel::new(c.allowed_contacts);
            health(channel_key, ch.health_check().await)
        }
        "irc" => {
            #[derive(Deserialize)]
            struct C { server: String, #[serde(default = "default_irc_port")] port: u16, nickname: String, #[serde(default)] username: Option<String>, #[serde(default)] channels: Vec<String>, #[serde(default)] allowed_users: Vec<String>, #[serde(default)] server_password: Option<String>, #[serde(default)] nickserv_password: Option<String>, #[serde(default)] sasl_password: Option<String>, #[serde(default)] verify_tls: bool }
            fn default_irc_port() -> u16 { 6697 }
            let c: C = match serde_json::from_str(config_json) { Ok(c) => c, Err(e) => return err(channel_key, &format!("Invalid config: {e}")) };
            let cfg = crate::channels::irc::IrcChannelConfig {
                server: c.server, port: c.port, nickname: c.nickname, username: c.username,
                channels: c.channels, allowed_users: c.allowed_users, server_password: c.server_password,
                nickserv_password: c.nickserv_password, sasl_password: c.sasl_password, verify_tls: c.verify_tls,
            };
            let ch = IrcChannel::new(cfg);
            health(channel_key, ch.health_check().await)
        }
        "clawdtalk" => {
            let cfg: crate::channels::clawdtalk::ClawdTalkConfig = match serde_json::from_str(config_json) {
                Ok(c) => c, Err(e) => return err(channel_key, &format!("Invalid config: {e}"))
            };
            let ch = crate::channels::clawdtalk::ClawdTalkChannel::new(cfg);
            health(channel_key, ch.health_check().await)
        }
        _ => err(channel_key, &format!("No health check available for channel '{channel_key}'")),
    }
}

/// Result of provider setup.
#[derive(Debug, Serialize, Deserialize)]
pub struct ProviderSetupResult {
    pub provider: String,
    pub api_key: String,
    pub model: String,
    pub api_url: Option<String>,
}

/// Run ZeroClaw's native interactive provider setup wizard.
/// Saves provider/model/key to config.toml so the channel wizard picks it up.
/// Returns the selected provider, API key, model, and optional custom URL.
pub async fn run_provider_wizard() -> Result<ProviderSetupResult, String> {
    let config_dir = std::env::var("ZEROCLAW_CONFIG_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| {
            directories::UserDirs::new()
                .map(|u| u.home_dir().join(".zeroclaw"))
                .expect("Could not determine home directory")
        });
    let workspace_dir = config_dir.join("workspace");
    std::fs::create_dir_all(&workspace_dir)
        .map_err(|e| format!("Failed to create workspace dir: {e}"))?;

    // Disable terminal auto-wrap to prevent dialoguer rendering artifacts
    // when long API keys cause visual line wrapping (macOS)
    let _ = std::io::Write::write_all(&mut std::io::stderr(), b"\x1b[?7l");
    let wizard_result = crate::onboard::wizard::setup_provider(&workspace_dir).await;
    let _ = std::io::Write::write_all(&mut std::io::stderr(), b"\x1b[?7h");
    let (provider, api_key, model, api_url) =
        wizard_result.map_err(|e| format!("Provider setup failed: {e}"))?;

    // Persist to config.toml so channel wizard (and later reads) see it
    let mut config = crate::config::Config::load_or_init()
        .await
        .map_err(|e| format!("Failed to load config: {e}"))?;

    config.default_provider = Some(provider.clone());
    config.default_model = Some(model.clone());
    config.api_url = api_url.clone();
    if !api_key.is_empty() {
        config.api_key = Some(api_key.clone());
    }

    config.save()
        .await
        .map_err(|e| format!("Failed to save config: {e}"))?;

    Ok(ProviderSetupResult { provider, api_key, model, api_url })
}

/// Run ZeroClaw's native interactive channel setup wizard.
/// Loads existing config (with provider settings), adds/updates channels, saves.
/// Returns the full Config as JSON.
pub async fn run_channel_wizard() -> Result<String, String> {
    // Disable terminal auto-wrap to prevent dialoguer rendering artifacts
    // when long tokens cause visual line wrapping (macOS)
    let _ = std::io::Write::write_all(&mut std::io::stderr(), b"\x1b[?7l");
    let wizard_result = crate::onboard::run_channels_repair_wizard().await;
    let _ = std::io::Write::write_all(&mut std::io::stderr(), b"\x1b[?7h");
    let config = wizard_result.map_err(|e| format!("Wizard failed: {e}"))?;
    serde_json::to_string_pretty(&config).map_err(|e| format!("Serialization failed: {e}"))
}

/// Read the current saved config as JSON.
/// Call this after both wizards to get the full assembled config.
pub async fn get_saved_config() -> Result<String, String> {
    let config = crate::config::Config::load_or_init()
        .await
        .map_err(|e| format!("Failed to load config: {e}"))?;
    serde_json::to_string_pretty(&config).map_err(|e| format!("Serialization failed: {e}"))
}

fn health(channel: &str, ok: bool) -> ChannelValidationResult {
    ChannelValidationResult {
        ok,
        channel: channel.to_string(),
        message: if ok { "Health check passed".into() } else { "Health check failed".into() },
    }
}

fn err(channel: &str, message: &str) -> ChannelValidationResult {
    ChannelValidationResult {
        ok: false,
        channel: channel.to_string(),
        message: message.to_string(),
    }
}
