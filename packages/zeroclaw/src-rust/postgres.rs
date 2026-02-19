// PostgreSQL memory backend for ZeroClaw (CloudClaw patch)
//
// Implements the `Memory` trait using tokio-postgres + deadpool-postgres + pgvector.
// Schema initialization is deferred (lazy) so the constructor stays synchronous,
// matching the `create_memory()` factory signature.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use anyhow::{Context, Result};
use async_trait::async_trait;
use deadpool_postgres::{Config as PoolConfig, Pool, Runtime};
use pgvector::Vector;
use sha2::{Digest, Sha256};
use tokio_postgres_rustls::MakeRustlsConnect;
use rustls::ClientConfig as RustlsConfig;

use crate::memory::embeddings::EmbeddingProvider;
use crate::memory::traits::{Memory, MemoryCategory, MemoryEntry};
use crate::memory::vector;

// ---------------------------------------------------------------------------
// Schema DDL
// ---------------------------------------------------------------------------

const SCHEMA_DDL: &str = r#"
CREATE EXTENSION IF NOT EXISTS "vector";

CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    content TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'core',
    embedding vector,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    session_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
CREATE INDEX IF NOT EXISTS idx_memories_key ON memories(key);
CREATE INDEX IF NOT EXISTS idx_memories_session ON memories(session_id);

ALTER TABLE memories ADD COLUMN IF NOT EXISTS tsv tsvector;
CREATE INDEX IF NOT EXISTS idx_memories_fts ON memories USING GIN(tsv);

CREATE OR REPLACE FUNCTION memories_tsv_trigger() RETURNS trigger AS $$
BEGIN
    NEW.tsv := to_tsvector('english', COALESCE(NEW.key,'') || ' ' || COALESCE(NEW.content,''));
    RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS memories_tsv_update ON memories;
CREATE TRIGGER memories_tsv_update BEFORE INSERT OR UPDATE ON memories
    FOR EACH ROW EXECUTE FUNCTION memories_tsv_trigger();

CREATE TABLE IF NOT EXISTS embedding_cache (
    content_hash TEXT PRIMARY KEY,
    embedding BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cache_accessed ON embedding_cache(accessed_at);
"#;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn category_to_string(cat: &MemoryCategory) -> String {
    cat.to_string()
}

fn string_to_category(s: &str) -> MemoryCategory {
    match s {
        "core" => MemoryCategory::Core,
        "daily" => MemoryCategory::Daily,
        "conversation" => MemoryCategory::Conversation,
        other => MemoryCategory::Custom(other.to_string()),
    }
}

/// Deterministic content hash (matches SQLite implementation).
/// SHA-256 → first 8 bytes → 16 hex chars.
fn content_hash(text: &str) -> String {
    let hash = Sha256::digest(text.as_bytes());
    format!("{:016x}", u64::from_be_bytes(hash[..8].try_into().unwrap()))
}

// ---------------------------------------------------------------------------
// PostgresMemory
// ---------------------------------------------------------------------------

pub struct PostgresMemory {
    pool: Pool,
    embedder: Arc<dyn EmbeddingProvider>,
    vector_weight: f32,
    keyword_weight: f32,
    cache_max: usize,
    schema_initialized: AtomicBool,
}

impl PostgresMemory {
    /// Create a new PostgresMemory. This is **synchronous** — no I/O happens here.
    /// Schema creation is deferred to the first async operation.
    pub fn new(
        database_url: &str,
        pool_size: usize,
        embedder: Arc<dyn EmbeddingProvider>,
        vector_weight: f32,
        keyword_weight: f32,
        cache_max: usize,
    ) -> Result<Self> {
        let mut cfg = PoolConfig::new();
        cfg.url = Some(database_url.to_string());
        cfg.pool = Some(deadpool_postgres::PoolConfig::new(pool_size));

        // Neon (and most cloud Postgres providers) require TLS.
        let mut root_store = rustls::RootCertStore::empty();
        root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        let tls_config = RustlsConfig::builder()
            .with_root_certificates(root_store)
            .with_no_client_auth();
        let tls = MakeRustlsConnect::new(tls_config);

        let pool = cfg
            .create_pool(Some(Runtime::Tokio1), tls)
            .context("failed to create postgres connection pool")?;

        Ok(Self {
            pool,
            embedder,
            vector_weight,
            keyword_weight,
            cache_max,
            schema_initialized: AtomicBool::new(false),
        })
    }

    /// Run DDL once on first use.
    async fn ensure_schema(&self) -> Result<()> {
        if self.schema_initialized.load(Ordering::Acquire) {
            return Ok(());
        }

        let client = self.pool.get().await.context("pool connection for schema init")?;

        // Use batch_execute to send the entire DDL as one batch.
        // This is necessary because the DDL contains $$ dollar-quoted function
        // bodies with semicolons that must not be split on.
        client
            .batch_execute(SCHEMA_DDL)
            .await
            .context("schema DDL batch execution failed")?;

        self.schema_initialized.store(true, Ordering::Release);
        Ok(())
    }

    /// Get an embedding from cache or compute it, then cache it.
    /// Returns None if the embedder is a no-op (returns empty vectors).
    async fn get_or_compute_embedding(&self, text: &str) -> Result<Option<Vec<f32>>> {
        let hash = content_hash(text);
        let client = self.pool.get().await?;

        // Check cache
        let cached = client
            .query_opt(
                "SELECT embedding FROM embedding_cache WHERE content_hash = $1",
                &[&hash],
            )
            .await?;

        if let Some(row) = cached {
            // Update accessed_at for LRU tracking
            let _ = client
                .execute(
                    "UPDATE embedding_cache SET accessed_at = NOW() WHERE content_hash = $1",
                    &[&hash],
                )
                .await;

            let bytes: Vec<u8> = row.get("embedding");
            let vec = vector::bytes_to_vec(&bytes);
            if !vec.is_empty() {
                return Ok(Some(vec));
            }
        }

        // Compute embedding
        let batch = self.embedder.embed(&[text]).await?;
        let vec = match batch.into_iter().next() {
            Some(v) if !v.is_empty() => v,
            _ => return Ok(None),
        };

        // Store in cache
        let bytes = vector::vec_to_bytes(&vec);
        let _ = client
            .execute(
                "INSERT INTO embedding_cache (content_hash, embedding, created_at, accessed_at)
                 VALUES ($1, $2, NOW(), NOW())
                 ON CONFLICT (content_hash) DO UPDATE
                 SET embedding = EXCLUDED.embedding, accessed_at = NOW()",
                &[&hash, &bytes],
            )
            .await;

        // LRU eviction: keep only the top cache_max entries by accessed_at
        if self.cache_max > 0 {
            let max_i64 = self.cache_max as i64;
            let _ = client
                .execute(
                    "DELETE FROM embedding_cache
                     WHERE content_hash NOT IN (
                         SELECT content_hash FROM embedding_cache
                         ORDER BY accessed_at DESC LIMIT $1
                     )",
                    &[&max_i64],
                )
                .await;
        }

        Ok(Some(vec))
    }

    fn row_to_entry(&self, r: &tokio_postgres::Row) -> MemoryEntry {
        let created: chrono::DateTime<chrono::Utc> = r.get("created_at");
        let cat_str: String = r.get("category");
        MemoryEntry {
            id: r.get("id"),
            key: r.get("key"),
            content: r.get("content"),
            category: string_to_category(&cat_str),
            timestamp: created.to_rfc3339(),
            session_id: r.get("session_id"),
            score: None,
        }
    }

    /// Re-embed all memories that are missing embeddings and rebuild tsvector.
    /// Returns the number of newly embedded entries.
    pub async fn reindex(&self) -> Result<usize> {
        self.ensure_schema().await?;
        let client = self.pool.get().await?;

        // Rebuild tsvector for all rows (in case trigger missed any)
        client
            .execute(
                "UPDATE memories SET tsv = to_tsvector('english', COALESCE(key,'') || ' ' || COALESCE(content,''))",
                &[],
            )
            .await
            .context("tsvector rebuild failed")?;

        // Find entries without embeddings
        let rows = client
            .query(
                "SELECT id, content FROM memories WHERE embedding IS NULL",
                &[],
            )
            .await?;

        let mut count = 0usize;
        for row in &rows {
            let id: String = row.get("id");
            let content: String = row.get("content");

            if let Some(vec) = self.get_or_compute_embedding(&content).await? {
                let pgvec = Vector::from(vec);
                client
                    .execute(
                        "UPDATE memories SET embedding = $1 WHERE id = $2",
                        &[&pgvec, &id],
                    )
                    .await?;
                count += 1;
            }
        }

        Ok(count)
    }
}

// ---------------------------------------------------------------------------
// Memory trait implementation
// ---------------------------------------------------------------------------

#[async_trait]
impl Memory for PostgresMemory {
    fn name(&self) -> &str {
        "postgres"
    }

    async fn health_check(&self) -> bool {
        if self.ensure_schema().await.is_err() {
            return false;
        }
        match self.pool.get().await {
            Ok(client) => client.execute("SELECT 1", &[]).await.is_ok(),
            Err(_) => false,
        }
    }

    async fn store(
        &self,
        key: &str,
        content: &str,
        category: MemoryCategory,
        session_id: Option<&str>,
    ) -> Result<()> {
        self.ensure_schema().await?;

        // Embedding failure is non-fatal — store the entry without an embedding.
        let embedding = match self.get_or_compute_embedding(content).await {
            Ok(v) => v,
            Err(_) => None,
        };
        let id = uuid::Uuid::new_v4().to_string();
        let cat = category_to_string(&category);
        let client = self.pool.get().await?;

        match embedding {
            Some(ref vec) => {
                let pgvec = Vector::from(vec.clone());
                client
                    .execute(
                        "INSERT INTO memories (id, key, content, category, embedding, session_id, updated_at)
                         VALUES ($1, $2, $3, $4, $5, $6, NOW())
                         ON CONFLICT (key) DO UPDATE
                         SET content = EXCLUDED.content,
                             category = EXCLUDED.category,
                             embedding = EXCLUDED.embedding,
                             session_id = EXCLUDED.session_id,
                             updated_at = NOW()",
                        &[&id, &key, &content, &cat, &pgvec, &session_id],
                    )
                    .await?;
            }
            None => {
                client
                    .execute(
                        "INSERT INTO memories (id, key, content, category, session_id, updated_at)
                         VALUES ($1, $2, $3, $4, $5, NOW())
                         ON CONFLICT (key) DO UPDATE
                         SET content = EXCLUDED.content,
                             category = EXCLUDED.category,
                             session_id = EXCLUDED.session_id,
                             updated_at = NOW()",
                        &[&id, &key, &content, &cat, &session_id],
                    )
                    .await?;
            }
        }

        Ok(())
    }

    async fn recall(
        &self,
        query: &str,
        limit: usize,
        session_id: Option<&str>,
    ) -> Result<Vec<MemoryEntry>> {
        self.ensure_schema().await?;

        if query.trim().is_empty() || limit == 0 {
            return Ok(vec![]);
        }

        let client = self.pool.get().await?;
        let limit_i64 = limit as i64;
        let fetch_limit = (limit * 2) as i64;

        // --- Vector search (non-fatal if embedding fails) ---
        let vector_results = match self.get_or_compute_embedding(query).await {
            Ok(Some(ref vec)) => {
                let pgvec = Vector::from(vec.clone());
                let rows = match session_id {
                    Some(sid) => {
                        client
                            .query(
                                "SELECT id, 1.0 - (embedding <=> $1::vector) AS score
                                 FROM memories
                                 WHERE embedding IS NOT NULL AND session_id = $3
                                 ORDER BY embedding <=> $1::vector LIMIT $2",
                                &[&pgvec, &fetch_limit, &sid],
                            )
                            .await?
                    }
                    None => {
                        client
                            .query(
                                "SELECT id, 1.0 - (embedding <=> $1::vector) AS score
                                 FROM memories WHERE embedding IS NOT NULL
                                 ORDER BY embedding <=> $1::vector LIMIT $2",
                                &[&pgvec, &fetch_limit],
                            )
                            .await?
                    }
                };
                let results: Vec<_> = rows.iter()
                    .map(|r| {
                        let score: f64 = r.get("score");
                        (r.get::<_, String>("id"), score as f32)
                    })
                    .collect();
                results
            }
            Ok(None) | Err(_) => vec![]
        };

        // --- Keyword (FTS) search using OR logic ---
        // Split query into individual terms and build an OR tsquery so matching
        // ANY term returns results (plainto_tsquery's default is AND which is
        // too strict for multi-topic queries like "name and favorite color").
        // Each word is a parameterized $N — no string interpolation.
        let fts_words: Vec<String> = query
            .split_whitespace()
            .map(|w| w.to_string())
            .collect();

        let keyword_results = if fts_words.is_empty() {
            vec![]
        } else {
            // Build: plainto_tsquery('english', $1) || plainto_tsquery('english', $2) || ...
            let tsquery_expr: String = (1..=fts_words.len())
                .map(|i| format!("plainto_tsquery('english', ${i})"))
                .collect::<Vec<_>>()
                .join(" || ");

            let mut fts_params: Vec<&(dyn tokio_postgres::types::ToSql + Sync)> = fts_words
                .iter()
                .map(|w| w as &(dyn tokio_postgres::types::ToSql + Sync))
                .collect();

            let sql = if let Some(ref sid) = session_id {
                let sp = fts_words.len() + 1;
                let lp = fts_words.len() + 2;
                fts_params.push(sid as &(dyn tokio_postgres::types::ToSql + Sync));
                fts_params.push(&fetch_limit as &(dyn tokio_postgres::types::ToSql + Sync));
                format!(
                    "SELECT id, ts_rank(tsv, {tsquery_expr}) AS score
                     FROM memories
                     WHERE tsv @@ ({tsquery_expr}) AND session_id = ${sp}
                     ORDER BY score DESC LIMIT ${lp}"
                )
            } else {
                let lp = fts_words.len() + 1;
                fts_params.push(&fetch_limit as &(dyn tokio_postgres::types::ToSql + Sync));
                format!(
                    "SELECT id, ts_rank(tsv, {tsquery_expr}) AS score
                     FROM memories WHERE tsv @@ ({tsquery_expr})
                     ORDER BY score DESC LIMIT ${lp}"
                )
            };

            // Fix 7: FTS errors are non-fatal — fall through to ILIKE fallback
            let rows = match client.query(&sql, &fts_params).await {
                Ok(r) => r,
                Err(_) => vec![],
            };
            rows.iter()
                .map(|r| {
                    let score: f32 = r.get("score");
                    (r.get::<_, String>("id"), score)
                })
                .collect::<Vec<_>>()
        };

        // --- Hybrid merge ---
        // When vector results are empty (no embeddings available), bypass
        // hybrid_merge and use keyword scores directly — matching SQLite behavior.
        // hybrid_merge would multiply by keyword_weight (0.3), reducing scores.
        let merged = if vector_results.is_empty() {
            // Normalize keyword scores the same way hybrid_merge does
            let max_kw = keyword_results
                .iter()
                .map(|(_, s)| *s)
                .fold(0.0_f32, f32::max);
            let max_kw = if max_kw < f32::EPSILON { 1.0 } else { max_kw };
            keyword_results
                .iter()
                .map(|(id, score)| vector::ScoredResult {
                    id: id.clone(),
                    vector_score: None,
                    keyword_score: Some(score / max_kw),
                    final_score: score / max_kw,
                })
                .collect::<Vec<_>>()
        } else {
            vector::hybrid_merge(
                &vector_results,
                &keyword_results,
                self.vector_weight,
                self.keyword_weight,
                limit,
            )
        };
        // If both searches returned empty, fall back to ILIKE per-keyword
        let scored_ids: Vec<(String, f64)> = if merged.is_empty() {
            let keywords: Vec<String> = query
                .split_whitespace()
                .map(|w| format!("%{}%", w))
                .collect();

            if keywords.is_empty() {
                vec![]
            } else {
                // Build: (content ILIKE $1 OR key ILIKE $1) OR (content ILIKE $2 OR key ILIKE $2) ...
                let mut conditions = Vec::new();
                for i in 0..keywords.len() {
                    let p = i + 1;
                    conditions.push(format!("(content ILIKE ${p} OR key ILIKE ${p})"));
                }
                let where_clause = conditions.join(" OR ");

                let mut params: Vec<&(dyn tokio_postgres::types::ToSql + Sync)> =
                    keywords.iter().map(|k| k as &(dyn tokio_postgres::types::ToSql + Sync)).collect();

                let sql = if let Some(ref sid) = session_id {
                    let sp = keywords.len() + 1;
                    let lp = keywords.len() + 2;
                    params.push(sid as &(dyn tokio_postgres::types::ToSql + Sync));
                    params.push(&limit_i64 as &(dyn tokio_postgres::types::ToSql + Sync));
                    format!("SELECT id FROM memories WHERE ({where_clause}) AND session_id = ${sp} ORDER BY updated_at DESC LIMIT ${lp}")
                } else {
                    let lp = keywords.len() + 1;
                    params.push(&limit_i64 as &(dyn tokio_postgres::types::ToSql + Sync));
                    format!("SELECT id FROM memories WHERE ({where_clause}) ORDER BY updated_at DESC LIMIT ${lp}")
                };

                let rows = client.query(&sql, &params).await?;
                let results: Vec<_> = rows.iter()
                    .enumerate()
                    .map(|(i, r)| {
                        let id: String = r.get("id");
                        (id, 1.0 / (i as f64 + 1.0))
                    })
                    .collect();
                results
            }
        } else {
            merged
                .iter()
                .map(|r| (r.id.clone(), r.final_score as f64))
                .collect()
        };

        if scored_ids.is_empty() {
            return Ok(vec![]);
        }

        // Fetch full rows for the selected IDs
        let id_list: Vec<&str> = scored_ids.iter().map(|(id, _)| id.as_str()).collect();
        let placeholders: Vec<String> = (1..=id_list.len()).map(|i| format!("${i}")).collect();
        let in_clause = placeholders.join(", ");

        let sql = format!(
            "SELECT id, key, content, category, created_at, session_id
             FROM memories WHERE id IN ({in_clause})"
        );

        let params: Vec<&(dyn tokio_postgres::types::ToSql + Sync)> =
            id_list.iter().map(|s| s as &(dyn tokio_postgres::types::ToSql + Sync)).collect();

        let rows = client.query(&sql, &params).await?;

        let mut row_map: std::collections::HashMap<String, MemoryEntry> =
            std::collections::HashMap::new();
        for row in &rows {
            let entry = self.row_to_entry(row);
            row_map.insert(entry.id.clone(), entry);
        }

        // Assemble results in merged order with scores
        let mut results = Vec::with_capacity(scored_ids.len());
        for (id, score) in &scored_ids {
            if let Some(mut entry) = row_map.remove(id) {
                entry.score = Some(*score);
                results.push(entry);
            }
        }

        // Safety net — ensure we never return more than requested
        results.truncate(limit);
        Ok(results)
    }

    async fn get(&self, key: &str) -> Result<Option<MemoryEntry>> {
        self.ensure_schema().await?;
        let client = self.pool.get().await?;

        let row = client
            .query_opt(
                "SELECT id, key, content, category, created_at, session_id
                 FROM memories WHERE key = $1",
                &[&key],
            )
            .await?;

        Ok(row.as_ref().map(|r| self.row_to_entry(r)))
    }

    async fn list(
        &self,
        category: Option<&MemoryCategory>,
        session_id: Option<&str>,
    ) -> Result<Vec<MemoryEntry>> {
        self.ensure_schema().await?;
        let client = self.pool.get().await?;

        let rows = match (category, session_id) {
            (Some(cat), Some(sid)) => {
                let cat_str = category_to_string(cat);
                client
                    .query(
                        "SELECT id, key, content, category, created_at, session_id
                         FROM memories WHERE category = $1 AND session_id = $2
                         ORDER BY updated_at DESC",
                        &[&cat_str, &sid],
                    )
                    .await?
            }
            (Some(cat), None) => {
                let cat_str = category_to_string(cat);
                client
                    .query(
                        "SELECT id, key, content, category, created_at, session_id
                         FROM memories WHERE category = $1
                         ORDER BY updated_at DESC",
                        &[&cat_str],
                    )
                    .await?
            }
            (None, Some(sid)) => {
                client
                    .query(
                        "SELECT id, key, content, category, created_at, session_id
                         FROM memories WHERE session_id = $1
                         ORDER BY updated_at DESC",
                        &[&sid],
                    )
                    .await?
            }
            (None, None) => {
                client
                    .query(
                        "SELECT id, key, content, category, created_at, session_id
                         FROM memories ORDER BY updated_at DESC",
                        &[],
                    )
                    .await?
            }
        };

        Ok(rows.iter().map(|r| self.row_to_entry(r)).collect())
    }

    async fn forget(&self, key: &str) -> Result<bool> {
        self.ensure_schema().await?;
        let client = self.pool.get().await?;

        let rows_affected = client
            .execute("DELETE FROM memories WHERE key = $1", &[&key])
            .await?;

        Ok(rows_affected > 0)
    }

    async fn count(&self) -> Result<usize> {
        self.ensure_schema().await?;
        let client = self.pool.get().await?;

        let row = client
            .query_one("SELECT COUNT(*) AS cnt FROM memories", &[])
            .await?;
        let cnt: i64 = row.get("cnt");

        Ok(cnt as usize)
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memory::embeddings::NoopEmbedding;

    async fn test_postgres() -> Option<PostgresMemory> {
        let url = match std::env::var("DATABASE_URL") {
            Ok(u) => u,
            Err(_) => return None,
        };
        let mem = PostgresMemory::new(&url, 2, Arc::new(NoopEmbedding), 0.7, 0.3, 10_000).unwrap();
        mem.ensure_schema().await.unwrap();
        let client = mem.pool.get().await.unwrap();
        client
            .execute("TRUNCATE memories, embedding_cache", &[])
            .await
            .unwrap();
        Some(mem)
    }

    macro_rules! pg_test {
        ($name:ident, $body:expr) => {
            #[tokio::test]
            async fn $name() {
                let Some(mem) = test_postgres().await else {
                    eprintln!("Skipping {} — DATABASE_URL not set", stringify!($name));
                    return;
                };
                $body(mem).await;
            }
        };
    }

    // -- Core operations --

    pg_test!(postgres_name, |mem: PostgresMemory| async move {
        assert_eq!(mem.name(), "postgres");
    });

    pg_test!(postgres_health, |mem: PostgresMemory| async move {
        assert!(mem.health_check().await);
    });

    pg_test!(postgres_store_and_get, |mem: PostgresMemory| async move {
        mem.store("user.name", "Alice", MemoryCategory::Core, None).await.unwrap();
        let entry = mem.get("user.name").await.unwrap().unwrap();
        assert_eq!(entry.key, "user.name");
        assert_eq!(entry.content, "Alice");
        assert_eq!(entry.category, MemoryCategory::Core);
    });

    pg_test!(postgres_store_upsert, |mem: PostgresMemory| async move {
        mem.store("user.name", "Alice", MemoryCategory::Core, None).await.unwrap();
        mem.store("user.name", "Bob", MemoryCategory::Core, None).await.unwrap();
        let entry = mem.get("user.name").await.unwrap().unwrap();
        assert_eq!(entry.content, "Bob");
        assert_eq!(mem.count().await.unwrap(), 1);
    });

    pg_test!(postgres_forget, |mem: PostgresMemory| async move {
        mem.store("temp", "data", MemoryCategory::Core, None).await.unwrap();
        assert!(mem.forget("temp").await.unwrap());
        assert!(mem.get("temp").await.unwrap().is_none());
    });

    pg_test!(postgres_forget_nonexistent, |mem: PostgresMemory| async move {
        assert!(!mem.forget("nonexistent_key").await.unwrap());
    });

    pg_test!(postgres_count_empty, |mem: PostgresMemory| async move {
        assert_eq!(mem.count().await.unwrap(), 0);
    });

    pg_test!(postgres_get_nonexistent, |mem: PostgresMemory| async move {
        assert!(mem.get("does_not_exist").await.unwrap().is_none());
    });

    // -- Search & retrieval --

    pg_test!(postgres_recall_keyword, |mem: PostgresMemory| async move {
        mem.store("hobby", "I love hiking in the mountains", MemoryCategory::Custom("personal".into()), None)
            .await.unwrap();
        mem.store("food", "My favorite food is sushi", MemoryCategory::Custom("personal".into()), None)
            .await.unwrap();
        let results = mem.recall("hiking", 10, None).await.unwrap();
        assert!(!results.is_empty());
        assert!(results.iter().any(|r| r.key == "hobby"));
    });

    pg_test!(postgres_recall_no_match, |mem: PostgresMemory| async move {
        mem.store("hobby", "I love hiking", MemoryCategory::Core, None).await.unwrap();
        let results = mem.recall("quantum_physics_xyzzy", 10, None).await.unwrap();
        assert!(results.is_empty());
    });

    pg_test!(postgres_recall_empty_query, |mem: PostgresMemory| async move {
        mem.store("key", "value", MemoryCategory::Core, None).await.unwrap();
        assert!(mem.recall("", 10, None).await.unwrap().is_empty());
        assert!(mem.recall("   ", 10, None).await.unwrap().is_empty());
    });

    pg_test!(postgres_recall_fallback_ilike, |mem: PostgresMemory| async move {
        mem.store("code", "error_code_xq47z", MemoryCategory::Custom("debug".into()), None)
            .await.unwrap();
        let results = mem.recall("xq47z", 10, None).await.unwrap();
        assert!(!results.is_empty());
        assert_eq!(results[0].key, "code");
    });

    pg_test!(postgres_recall_multi_keyword_fallback, |mem: PostgresMemory| async move {
        mem.store("addr", "Lives in Berlin Germany", MemoryCategory::Core, None).await.unwrap();
        mem.store("food", "Loves sushi and ramen", MemoryCategory::Core, None).await.unwrap();
        // "Berlin" should match via FTS or ILIKE fallback
        let results = mem.recall("Berlin Germany", 10, None).await.unwrap();
        assert!(!results.is_empty());
        assert!(results.iter().any(|r| r.key == "addr"));
    });

    // -- List & filtering --

    pg_test!(postgres_list_all, |mem: PostgresMemory| async move {
        mem.store("a", "1", MemoryCategory::Core, None).await.unwrap();
        mem.store("b", "2", MemoryCategory::Core, None).await.unwrap();
        let all = mem.list(None, None).await.unwrap();
        assert_eq!(all.len(), 2);
    });

    pg_test!(postgres_list_by_category, |mem: PostgresMemory| async move {
        mem.store("a", "1", MemoryCategory::Core, None).await.unwrap();
        mem.store("b", "2", MemoryCategory::Custom("personal".into()), None).await.unwrap();
        let core = mem.list(Some(&MemoryCategory::Core), None).await.unwrap();
        assert_eq!(core.len(), 1);
        assert_eq!(core[0].key, "a");
    });

    pg_test!(postgres_list_empty_db, |mem: PostgresMemory| async move {
        assert!(mem.list(None, None).await.unwrap().is_empty());
    });

    pg_test!(postgres_list_custom_category, |mem: PostgresMemory| async move {
        let cat = MemoryCategory::Custom("project".into());
        mem.store("x", "data", cat.clone(), None).await.unwrap();
        let results = mem.list(Some(&MemoryCategory::Custom("project".into())), None).await.unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].key, "x");
    });

    // -- Session isolation --

    pg_test!(postgres_store_recall_with_session, |mem: PostgresMemory| async move {
        mem.store("fact", "sky is blue", MemoryCategory::Core, Some("s1")).await.unwrap();
        let results = mem.recall("sky", 10, Some("s1")).await.unwrap();
        assert!(!results.is_empty());
    });

    pg_test!(postgres_cross_session_isolation, |mem: PostgresMemory| async move {
        mem.store("secret", "session1_data", MemoryCategory::Core, Some("s1")).await.unwrap();
        let results = mem.recall("session1_data", 10, Some("s2")).await.unwrap();
        assert!(results.is_empty());
    });

    pg_test!(postgres_list_with_session_filter, |mem: PostgresMemory| async move {
        mem.store("a", "1", MemoryCategory::Core, Some("s1")).await.unwrap();
        mem.store("b", "2", MemoryCategory::Core, Some("s2")).await.unwrap();
        let s1 = mem.list(None, Some("s1")).await.unwrap();
        assert_eq!(s1.len(), 1);
        assert_eq!(s1[0].key, "a");
    });

    pg_test!(postgres_recall_no_session_returns_all, |mem: PostgresMemory| async move {
        mem.store("a", "alpha data", MemoryCategory::Core, Some("s1")).await.unwrap();
        mem.store("b", "beta data", MemoryCategory::Core, Some("s2")).await.unwrap();
        let all = mem.recall("data", 10, None).await.unwrap();
        assert_eq!(all.len(), 2);
    });

    // -- Edge cases --

    pg_test!(postgres_store_empty_content, |mem: PostgresMemory| async move {
        mem.store("empty", "", MemoryCategory::Core, None).await.unwrap();
        let entry = mem.get("empty").await.unwrap().unwrap();
        assert_eq!(entry.content, "");
    });

    pg_test!(postgres_store_unicode_and_emoji, |mem: PostgresMemory| async move {
        let content = "Hello 世界! 🎉 Привет мир";
        mem.store("unicode", content, MemoryCategory::Core, None).await.unwrap();
        let entry = mem.get("unicode").await.unwrap().unwrap();
        assert_eq!(entry.content, content);
    });

    pg_test!(postgres_store_very_long_content, |mem: PostgresMemory| async move {
        let content = "x".repeat(100_000);
        mem.store("long", &content, MemoryCategory::Core, None).await.unwrap();
        let entry = mem.get("long").await.unwrap().unwrap();
        assert_eq!(entry.content.len(), 100_000);
    });

    pg_test!(postgres_recall_with_special_chars, |mem: PostgresMemory| async move {
        mem.store("test", "some data", MemoryCategory::Core, None).await.unwrap();
        let _ = mem.recall("it's a \"test\" (with) *parens*", 10, None).await.unwrap();
        let _ = mem.recall("'; DROP TABLE memories; --", 10, None).await.unwrap();
    });

    // -- Limits --

    pg_test!(postgres_recall_limit_zero, |mem: PostgresMemory| async move {
        mem.store("a", "data", MemoryCategory::Core, None).await.unwrap();
        assert!(mem.recall("data", 0, None).await.unwrap().is_empty());
    });

    pg_test!(postgres_recall_respects_limit, |mem: PostgresMemory| async move {
        for i in 0..10 {
            mem.store(&format!("key_{i}"), &format!("searchable data item {i}"), MemoryCategory::Core, None)
                .await.unwrap();
        }
        let results = mem.recall("searchable data", 3, None).await.unwrap();
        assert!(results.len() <= 3);
    });

    pg_test!(postgres_recall_results_have_scores, |mem: PostgresMemory| async move {
        mem.store("test", "searchable test data", MemoryCategory::Core, None).await.unwrap();
        let results = mem.recall("searchable test", 10, None).await.unwrap();
        for r in &results {
            assert!(r.score.unwrap_or(0.0) > 0.0);
        }
    });

    // -- Reindex --

    pg_test!(postgres_reindex_returns_zero_with_noop_embedder, |mem: PostgresMemory| async move {
        mem.store("a", "some content", MemoryCategory::Core, None).await.unwrap();
        // NoopEmbedding returns empty, so reindex can't embed anything
        let count = mem.reindex().await.unwrap();
        assert_eq!(count, 0);
    });

    // -- Schema --

    pg_test!(postgres_schema_idempotent, |mem: PostgresMemory| async move {
        mem.schema_initialized.store(false, Ordering::Release);
        mem.ensure_schema().await.unwrap();
        assert!(mem.health_check().await);
    });

    // -- Content hash --

    #[test]
    fn content_hash_deterministic() {
        let h1 = content_hash("hello world");
        let h2 = content_hash("hello world");
        assert_eq!(h1, h2);
        assert_eq!(h1.len(), 16); // 16 hex chars
    }

    #[test]
    fn content_hash_different_for_different_input() {
        let h1 = content_hash("hello");
        let h2 = content_hash("world");
        assert_ne!(h1, h2);
    }
}
