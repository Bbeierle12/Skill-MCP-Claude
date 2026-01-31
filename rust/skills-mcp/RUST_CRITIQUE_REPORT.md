# Rust Skills MCP Server - Code Critique Report

**Date**: 2026-01-31
**Reviewer**: Claude Opus 4.5
**Codebase Version**: 0.1.0 (Early scaffold)
**Test Status**: Compiles and passes 47 tests

---

## Executive Summary

The crate compiles and passes 47 tests, but has significant issues that would cause problems in production. The code is functional but not idiomatic Rust, with pervasive cloning, blocking I/O in async contexts, and missing safety guarantees.

**Overall Assessment**: 🟡 **MEDIUM MATURITY** - Functional but needs significant hardening before production

---

## 1. Categorized Issue List

### Dimension 1: Idiomatic Rust

#### 🔴 CRITICAL - Lock Held Across Clone (Hidden Blocking)

| Location | Issue |
|----------|-------|
| `src/index/indexer.rs:63-64` | RwLock held during deep clone of entire SkillIndex |
| `src/index/indexer.rs:68-69` | Same issue with ContentIndex |

```rust
// Current (indexer.rs:63-64)
pub fn get_skill_index(&self) -> SkillIndex {
    self.skill_index.read().clone()  // Lock held during deep clone
}
```

**Problem**: The RwLock is held while cloning the entire SkillIndex (all skills, all strings). With 100 skills, this could take milliseconds, blocking all other readers.

**Recommendation**:
```rust
pub fn get_skill_index(&self) -> Arc<SkillIndex> {
    Arc::clone(&self.skill_index.read())
}

// Change field to: skill_index: Arc<RwLock<Arc<SkillIndex>>>
// Swap whole Arc on reload, clone Arc (cheap) on read
```

#### 🟠 HIGH - Clone-Heavy API Design

| Location | Issue |
|----------|-------|
| `src/mcp/tools.rs:75-80` | Every API call clones all strings |
| `src/search/service.rs:30-31` | `get_skill_index()` called (cloning) for every search operation |

```rust
// Current (tools.rs:75-80) - list_skills with 100 skills clones 400+ strings
SkillSummary {
    name: s.name.clone(),
    description: s.description.clone(),
    tags: s.tags.clone(),
    sub_skills: s.sub_skill_names().iter().map(|n| n.to_string()).collect(),
}
```

**Recommendation**: Use `Arc<str>` for shared strings, return references with lifetimes, or use `Cow<'a, str>`

#### 🟠 HIGH - Repeated Lowercase Conversion

| Location | Issue |
|----------|-------|
| `src/search/service.rs:161-162` | Called on EVERY search, for EVERY skill |
| `src/models/index.rs:130-131` | Allocates in hot path |
| `src/models/index.rs:136-137` | Same in `count_matches()` |

```rust
// Called on EVERY search, for EVERY skill
let name_lower = skill.name.to_lowercase();
let desc_lower = skill.description.to_lowercase();

// And again in content matching (index.rs:136-137)
pub fn count_matches(&self, term: &str) -> usize {
    let term_lower = term.to_lowercase();  // Allocation
    self.content.matches(&term_lower).count()
}
```

**Problem**: Allocates new strings on every search. For 100 skills with 10 searches/second, that's 2000 allocations/second.

**Recommendation**:
```rust
// Pre-compute in SkillMeta
pub struct SkillMeta {
    pub name: String,
    pub name_lower: String,  // Computed once on load
    // ...
}
```

#### 🟡 MEDIUM - Error Handling Patterns

| Location | Issue |
|----------|-------|
| `src/validation/meta.rs:14` | Regex compiled on every validation call |
| `src/api/routes.rs:274` | `.unwrap()` on serialization that could theoretically fail |
| `src/index/indexer.rs:174` | Silent error swallowing with `entries.flatten()` |

```rust
// Current (meta.rs:14) - Compiled every call
let name_regex = Regex::new(r"^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$").unwrap();

// Better: Use lazy_static or once_cell
use once_cell::sync::Lazy;
static NAME_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$").unwrap()
});
```

#### 🟡 MEDIUM - No Newtypes for Domain Concepts

| Location | Issue |
|----------|-------|
| `src/models/meta.rs:28` | `pub name: String` - just a String, not a SkillName |
| `src/models/search.rs` | `pub domain: String` - just a String |

**Problem**: Can pass any string where skill name expected. No compile-time safety.

**Recommendation**:
```rust
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct SkillName(String);

impl SkillName {
    pub fn new(s: impl Into<String>) -> Result<Self, ValidationError> {
        let s = s.into();
        if !s.chars().all(|c| c.is_ascii_lowercase() || c == '-') {
            return Err(ValidationError::InvalidSkillName);
        }
        Ok(Self(s))
    }
}
```

#### 🟡 MEDIUM - Missing `#[non_exhaustive]`

| Location | Issue |
|----------|-------|
| `src/index/indexer.rs:315-327` | `IndexError` enum is exhaustive |

```rust
// Current
pub enum IndexError {
    NotFound(String),
    ReadError(String),
    ParseError(String),
    ValidationError(String),
}
```

**Problem**: Adding new variants is a breaking change for downstream match expressions.

**Recommendation**: Add `#[non_exhaustive]` attribute.

#### 🟢 LOW - Style & Conventions

| Location | Issue |
|----------|-------|
| `src/models/mod.rs:12-16` | Glob re-exports (`pub use *`) reduce API clarity |
| `src/mcp/tools.rs:12` | `use crate::models::*;` - prefer explicit imports |
| `src/lib.rs:96-97` | `#![warn(...)]` should be `#![deny(...)]` for production |

---

### Dimension 2: Async Correctness

#### 🔴 CRITICAL - Blocking I/O in Async Context

| Location | Issue |
|----------|-------|
| `src/index/indexer.rs:99` | `fs::read_to_string()` blocks Tokio runtime |
| `src/index/indexer.rs:143-145` | Same blocking I/O issue |
| `src/index/indexer.rs:230` | Blocking in `build_content_index` |
| `src/index/indexer.rs:245` | Blocking in sub-skill indexing |
| `src/index/indexer.rs:287` | Blocking in `index_directory` |
| `src/api/routes.rs:161` | `std::fs::create_dir_all()` blocks in async handler |
| `src/api/routes.rs:184-195` | Multiple blocking `std::fs` calls in async route |

```rust
// Current (indexer.rs:99) - Blocking in async-called code
let content = fs::read_to_string(&skill_md).map_err(|e| { ... })?;

// Current (routes.rs:161) - Blocking in async handler
std::fs::create_dir_all(&skill_dir).map_err(|e| { ... })?;
```

**Problem**: Uses `std::fs` (blocking) instead of `tokio::fs` (async) in async handlers. This blocks the Tokio runtime thread, causing thread starvation under load. Every file read stalls all concurrent requests.

**Impact**: Server will hang under moderate concurrent load. 10 simultaneous requests reading files will serialize to sequential execution.

**Recommendation**:
```rust
// Option 1: Use tokio::fs for async operations
let content = tokio::fs::read_to_string(&skill_md).await.map_err(|e| { ... })?;

// Option 2: Offload to blocking thread pool
let content = tokio::task::spawn_blocking(move || {
    std::fs::read_to_string(&path)
}).await??;
```

#### 🔴 CRITICAL - Race Condition in Reload

| Location | Issue |
|----------|-------|
| `src/index/indexer.rs:44-60` | Indexes become inconsistent during reload |

```rust
// Current (indexer.rs:44-60)
pub fn reload(&self) -> Result<(), IndexError> {
    let skill_index = self.build_skill_index()?;      // Step 1
    let content_index = self.build_content_index(&skill_index)?;  // Step 2

    *self.skill_index.write() = skill_index;          // Step 3
    *self.content_index.write() = content_index;      // Step 4
}
```

**Problem**: Between steps 3 and 4, the indexes are inconsistent. A concurrent search could see new skill_index but old content_index. Also, two concurrent reloads could interleave writes.

**Recommendation**:
```rust
pub fn reload(&self) -> Result<(), IndexError> {
    let skill_index = self.build_skill_index()?;
    let content_index = self.build_content_index(&skill_index)?;

    // Atomic swap of both indexes
    let mut skill_guard = self.skill_index.write();
    let mut content_guard = self.content_index.write();
    *skill_guard = skill_index;
    *content_guard = content_index;
    // Both guards drop together
}
```

#### 🟠 HIGH - File Watcher Callback Issues

| Location | Issue |
|----------|-------|
| `src/index/file_watcher.rs:26-46` | File watcher callback blocks on `indexer.reload()` which does heavy I/O |

```rust
// Current: Blocking reload in notify callback
let watcher = notify::recommended_watcher(move |res| {
    // This callback runs in notify's thread pool
    if let Err(e) = indexer_clone.reload() {  // Heavy blocking I/O here
        error!("Failed to reload index: {}", e);
    }
});

// Better: Send event to channel, handle in async task
```

#### 🟡 MEDIUM - Missing Async Boundaries

| Location | Issue |
|----------|-------|
| `src/index/file_watcher.rs:16` | `shutdown_tx` field is never used |
| `src/mcp/server.rs:44-62` | `run()` is placeholder - no actual MCP protocol handling |

#### 🟢 LOW - Unused Fields

| Location | Issue |
|----------|-------|
| `src/index/file_watcher.rs:5` | `use std::time::Duration;` - unused |
| `src/index/file_watcher.rs:16` | `shutdown_tx: Option<mpsc::Sender<()>>` - never read |

---

### Dimension 3: Performance

#### 🔴 CRITICAL - Unbounded Memory in ContentIndex

| Location | Issue |
|----------|-------|
| `src/models/index.rs:87` | Stores ENTIRE file content lowercase |
| `src/models/index.rs:107` | Duplicate lowercase copy for every file |

```rust
// Current (index.rs:87, 107)
pub struct ContentIndexEntry {
    pub content: String,  // Stores ENTIRE file content lowercase
}

// In constructor (index.rs:107)
let content_lower = content.to_lowercase();  // Full copy
```

**Problem**: For a 10MB skill file, this stores 10MB in RAM. With 50 large skills, that's 500MB just for lowercase content copies. The original content is also read separately when serving.

**Recommendation**:
- Store content hash + word frequency map instead of full text
- Use memory-mapped files for large content
- Implement streaming search without full content storage

#### 🟠 HIGH - O(n) Search Where O(1) Possible

| Location | Issue |
|----------|-------|
| `src/models/index.rs:45-47` | Finding skill by name is O(n) |
| `src/search/service.rs:36-61` | Linear scan for every search |
| `src/models/index.rs:135-137` | `count_matches()` - O(n*m) per entry |

```rust
// Current (index.rs:45-47) - Linear scan
pub fn find(&self, name: &str) -> Option<&SkillMeta> {
    self.skills.iter().find(|s| s.name == name)  // O(n) for every lookup
}
```

**Problem**: With 1000 skills, every lookup scans all 1000.

**Recommendation**:
```rust
pub struct SkillIndex {
    pub skills: Vec<SkillMeta>,
    name_index: HashMap<String, usize>,  // name -> index in skills vec
}
```

#### 🟠 HIGH - Memory Usage Patterns

| Location | Issue |
|----------|-------|
| `src/models/stats.rs:77-80` | `searches.remove(0)` is O(n) - use VecDeque |

```rust
// Current (stats.rs:77-80)
if self.searches.len() > Self::MAX_SEARCHES {
    self.searches.remove(0);  // O(n) removal
}

// Better: Use VecDeque
use std::collections::VecDeque;
pub searches: VecDeque<SearchEntry>,
// Then use push_back() and pop_front()
```

#### 🟡 MEDIUM - No Timeouts

| Location | Issue |
|----------|-------|
| `src/index/indexer.rs:271-299` | WalkDir could hang forever |

```rust
// Current (indexer.rs:271)
for entry in WalkDir::new(dir).follow_links(true) {
    // Could follow symlink loops forever
    // No timeout, no depth limit
}
```

**Problem**: A symlink loop or very deep directory hangs forever.

**Recommendation**:
```rust
WalkDir::new(dir)
    .follow_links(false)  // Don't follow symlinks
    .max_depth(10)        // Limit depth
```

#### 🟡 MEDIUM - Allocation Patterns

| Location | Issue |
|----------|-------|
| `src/search/snippet.rs:8-9` | Creates new lowercase strings on every extraction |
| `src/search/service.rs:31-32` | `query.to_lowercase()` and `split_whitespace().collect()` allocate |

---

### Dimension 4: Correctness & Safety

#### 🔴 CRITICAL - Missing Input Validation (Path Traversal)

| Location | Issue |
|----------|-------|
| `src/api/routes.rs:133-140` | CreateSkillRequest has no validation |
| `src/api/routes.rs:159` | `skill_dir = skills_dir.join(&req.name)` - no path validation |
| `src/api/routes.rs:240` | Same issue in update_skill |
| `src/index/indexer.rs:134` | `skills_dir.join(domain).join(&sub_meta.file)` - no validation |

```rust
// Current (routes.rs:133-140) - No validation!
#[derive(Debug, Deserialize)]
pub struct CreateSkillRequest {
    pub name: String,        // Could be "../../../etc/passwd"
    pub description: String, // Could be empty or 1GB
    pub content: String,     // No size limit
    pub tags: Vec<String>,
}
```

**Problem**:
- `name` could be `"../../../etc/passwd"` (path traversal)
- `name` could be `""` or contain spaces/special chars
- `content` could be 1GB (no size limit)

**Recommendation**:
```rust
use validator::Validate;

#[derive(Deserialize, Validate)]
pub struct CreateSkillRequest {
    #[validate(length(min = 1, max = 50), regex = "^[a-z0-9-]+$")]
    pub name: String,
    #[validate(length(min = 1, max = 500))]
    pub description: String,
    #[validate(length(max = 1_000_000))]  // 1MB max
    pub content: String,
}
```

#### 🟠 HIGH - Silent Error Swallowing

| Location | Issue |
|----------|-------|
| `src/api/routes.rs:296` | Error silently ignored |
| `src/index/indexer.rs:229-237` | Silently skips unreadable files |

```rust
// Current (routes.rs:296)
let _ = state.indexer.reload();  // Error silently ignored

// Current (indexer.rs:230)
if let Ok(content) = fs::read_to_string(&skill_md) {
    // Silently skip unreadable files - no logging, no error collection
}
```

**Problem**: Errors are silently dropped. A permission error on one file silently corrupts the index.

**Recommendation**:
```rust
state.indexer.reload().map_err(|e| {
    tracing::error!("Failed to reload after update: {}", e);
    // Return error or log warning
})?;
```

#### 🟠 HIGH - Race Conditions

| Location | Issue |
|----------|-------|
| `src/api/routes.rs:147-155` | `skill_exists()` check then create is racy (TOCTOU) |

```rust
// Current (routes.rs:147-155) - TOCTOU race
if state.indexer.skill_exists(&req.name) {  // Check
    return Err(...);
}
// ... another request could create skill here ...
std::fs::create_dir_all(&skill_dir)  // Create
```

#### 🟡 MEDIUM - Panics

| Location | Issue |
|----------|-------|
| `src/validation/meta.rs:14` | `Regex::new().unwrap()` can panic (though unlikely with this pattern) |
| `src/api/routes.rs:274` | `serde_json::to_string_pretty(&meta).unwrap()` |
| `src/search/snippet.rs:56-57` | Indexing `bytes[start - 1]` - could panic on UTF-8 boundaries |

```rust
// Current (snippet.rs:56) - Potential panic on non-ASCII
while start > 0 && !bytes[start - 1].is_ascii_whitespace() {
    start -= 1;  // Could land in middle of UTF-8 sequence
}
```

#### 🟡 MEDIUM - Inconsistent Error Types

| Location | Issue |
|----------|-------|
| `src/api/routes.rs` | Returns tuple `(StatusCode, Json<ErrorResponse>)` |
| `src/mcp/tools.rs` | Returns `ErrorResponse` directly |

**Problem**: Two different error handling patterns in the same crate.

---

### Dimension 5: API Design

#### 🟠 HIGH - Missing HTTP Semantics

| Location | Issue |
|----------|-------|
| `src/api/routes.rs:363-376` | `reload_index` returns 200 even on failure |
| `src/api/routes.rs` | No rate limiting |
| `src/api/server.rs:57-60` | CORS allows Any origin/methods/headers |

```rust
// Current (routes.rs:372-375) - Success=false but 200 OK
Err(_) => Json(ReloadResponse {
    success: false,  // Should return 500
    skill_count: 0,
})
```

#### 🟡 MEDIUM - Incomplete REST Design

| Location | Issue |
|----------|-------|
| `src/api/routes.rs` | No pagination for list_skills |
| `src/api/routes.rs` | No ETag/If-None-Match caching headers |
| `src/api/server.rs` | No health check endpoint |
| `src/api/routes.rs` | No versioning (e.g., /api/v1/) |

#### 🟡 MEDIUM - Builder Pattern Inconsistency

| Location | Issue |
|----------|-------|
| `src/models/content.rs:36-45` | Builder methods consume self (good) |
| `src/models/search.rs:143-161` | `SearchOptions` uses inconsistent builder pattern |

---

### Dimension 6: Testing

#### 🟠 HIGH - Coverage Gaps

| Location | Issue |
|----------|-------|
| `src/api/routes.rs` | No tests for create_skill, update_skill, delete_skill |
| `src/index/file_watcher.rs` | No test for actual file change detection |
| `src/search/service.rs` | No test for search_content or search_all |
| `src/mcp/` | Minimal test coverage (only server creation test) |

**Estimated Coverage**: ~40-50% (unit tests only)

#### 🟡 MEDIUM - Test Quality

| Location | Issue |
|----------|-------|
| All test modules | Tests use `unwrap()` extensively without context |
| All test modules | No property-based testing (e.g., proptest/quickcheck) |
| All test modules | No fuzzing for search/validation functions |
| `tests/` | No integration test directory |
| N/A | No benchmarks (`benches/` directory) |

```rust
// Current test pattern (e.g., indexer.rs tests)
let temp_dir = TempDir::new().unwrap();
fs::create_dir_all(&skill_dir).unwrap();
indexer.reload().unwrap();
```

**Problem**: Tests panic on failure without useful context.

**Recommendation**: Use `#[test] -> Result<(), Error>` pattern or `expect("context")`.

---

### Dimension 7: Documentation

#### 🟡 MEDIUM - Missing Docs

| Location | Issue |
|----------|-------|
| `src/search/snippet.rs` | Public functions lack doc comments |
| `src/index/file_watcher.rs:13-17` | `FileWatcher` struct fields undocumented |
| `src/models/search.rs:127-140` | `SearchOptions` fields lack docs |

#### 🟢 LOW - Architecture Docs

| Location | Issue |
|----------|-------|
| `src/lib.rs` | Good module-level docs with ASCII diagram |
| N/A | No ARCHITECTURE.md file |
| N/A | No CONTRIBUTING.md file |
| `Cargo.toml` | No `documentation` or `repository` fields |

---

### Dimension 8: Dependencies

#### 🟠 HIGH - Security & Audit

| Location | Issue |
|----------|-------|
| `Cargo.toml` | No `[dependencies]` version pinning (uses `"1"` instead of `"1.0.x"`) |
| `Cargo.toml` | `chrono` has historical security issues - consider `time` crate |
| N/A | No `cargo audit` CI step |
| N/A | No `Cargo.lock` committed (needed for reproducible builds) |

#### 🟡 MEDIUM - Feature Flags

| Location | Issue |
|----------|-------|
| `Cargo.toml:23` | `tokio = { features = ["full"] }` - too broad, enables unused features |
| `Cargo.toml:42-43` | `dashmap` imported but appears unused |

```toml
# Current (Cargo.toml:23)
tokio = { version = "1", features = ["full"] }

# Better: Only needed features
tokio = { version = "1.35", features = ["rt-multi-thread", "fs", "signal", "net"] }
```

#### 🟢 LOW - Missing Dependencies

| Issue | Recommendation |
|-------|----------------|
| No structured logging | Consider `tracing-appender` for file rotation |
| No metrics | Consider `metrics` or `prometheus` crate |
| Inefficient search | Consider `tantivy` for full-text search |

---

### Dimension 9: Build & CI

#### 🔴 CRITICAL - No CI/CD

| Issue |
|-------|
| No `.github/workflows/` directory |
| No clippy configuration |
| No rustfmt configuration |
| No pre-commit hooks |

#### 🟡 MEDIUM - Build Configuration

| Location | Issue |
|----------|-------|
| `Cargo.toml` | No `[profile.release]` optimization settings |
| `Cargo.toml` | No workspace-level Cargo.toml linking both crates |
| `.gitignore` | Only has `target/` - missing `.env`, IDE files, etc. |

---

### Dimension 10: Production Readiness

#### 🔴 CRITICAL - Observability

| Issue |
|-------|
| No metrics endpoint |
| No distributed tracing (trace IDs) |
| Logs lack structured context |
| No request logging middleware |

#### 🔴 CRITICAL - Configuration

| Issue |
|-------|
| Hardcoded port 5050 (only CLI override) |
| No config file support |
| No environment-based configuration |
| CORS allows all origins |

#### 🟠 HIGH - Graceful Shutdown

| Location | Issue |
|----------|-------|
| `src/api/server.rs:108-116` | Shutdown cancels immediately - no drain period |
| `src/index/file_watcher.rs` | No cleanup on shutdown |

```rust
// Current (server.rs:108-116) - Immediate cancellation
tokio::select! {
    result = axum::serve(listener, app) => { ... }
    _ = shutdown => {
        info!("Shutdown signal received");
        // No connection draining!
    }
}
```

#### 🟠 HIGH - Resource Limits

| Issue |
|-------|
| No request body size limits |
| No concurrent request limits |
| No timeout configuration |
| Stats `Vec<SearchEntry>` unbounded until 100 entries |

---

## 2. Top 10 Priority Fixes

| Priority | Issue | Severity | Location | Effort |
|----------|-------|----------|----------|--------|
| **1** | Replace `std::fs` with `tokio::fs` | 🔴 CRITICAL | `indexer.rs`, `routes.rs` | Medium |
| **2** | Fix reload race condition | 🔴 CRITICAL | `indexer.rs:44-60` | Low |
| **3** | Add input validation (path traversal) | 🔴 CRITICAL | `routes.rs:133-140` | Medium |
| **4** | Reduce cloning with `Arc<str>` | 🟠 HIGH | throughout | High |
| **5** | Add HashMap index for skill lookup | 🟠 HIGH | `index.rs:45-47` | Low |
| **6** | Pre-compute lowercase strings | 🟠 HIGH | `index.rs`, `service.rs` | Medium |
| **7** | Add timeouts to directory walking | 🟠 HIGH | `indexer.rs:271` | Low |
| **8** | Don't store full content in index | 🔴 CRITICAL | `index.rs:87` | High |
| **9** | Add `#[non_exhaustive]` to enums | 🟡 MEDIUM | `indexer.rs:315` | Low |
| **10** | Unify error handling patterns | 🟡 MEDIUM | `routes.rs`, `tools.rs` | Medium |

---

## 3. Refactoring Roadmap

### Phase 1: Security Hardening (1-2 days)
1. Add path validation for all user-provided paths
2. Add request body size limits to Axum
3. Restrict CORS to specific origins
4. Pin dependency versions in Cargo.toml

### Phase 2: Async Correctness (2-3 days)
1. Replace all `std::fs` with `tokio::fs` in async code
2. Move file watcher reload to async channel
3. Implement proper graceful shutdown with drain period
4. Add connection draining

### Phase 3: Performance (3-5 days)
1. Avoid cloning indexes - return guards or Arc
2. Compile regex once with `once_cell::Lazy`
3. Use `VecDeque` for search history
4. Consider inverted index for search (or integrate tantivy)

### Phase 4: CI/CD & Quality (2-3 days)
1. Add GitHub Actions workflow:
   - `cargo fmt --check`
   - `cargo clippy -- -D warnings`
   - `cargo test`
   - `cargo audit`
2. Add rustfmt.toml and clippy.toml
3. Add pre-commit hooks
4. Configure release profiles

### Phase 5: Observability (2-3 days)
1. Add `/health` and `/metrics` endpoints
2. Integrate `metrics` crate with Prometheus exporter
3. Add request tracing with trace IDs
4. Configure structured JSON logging for production

### Phase 6: Testing (3-5 days)
1. Add integration tests for all API endpoints
2. Add property-based tests for search
3. Add benchmarks for critical paths
4. Set up coverage reporting (tarpaulin)

---

## 4. Gap Analysis vs Python/TypeScript

Based on the Python/TypeScript MCP Server implementations:

| Feature | Python | TypeScript | Rust | Gap |
|---------|--------|------------|------|-----|
| Import from folder | ✅ | ✅ | ❌ | 🔴 Missing |
| Import from files | ✅ | ✅ | ❌ | 🔴 Missing |
| Claude CLI integration | ✅ | ❌ | ❌ | 🟡 Python-only |
| File browser endpoint | ✅ | ❌ | ❌ | 🟡 Python-only |
| MCP protocol | ✅ Full SDK | ✅ Full SDK | Stub | 🔴 **Major** |
| Search | ✅ | ✅ | ✅ | 🟢 Parity |
| Validation | Pydantic | Zod | Regex | 🟡 Manual |
| File watching | ✅ | ✅ | ✅ | 🟢 Parity |
| API endpoints | ✅ | ✅ | ✅ | 🟢 Parity |
| Batch operations | ✅ | ✅ | ✅ | 🟢 Parity |
| Stats tracking | ✅ | ✅ | ✅ | 🟢 Parity |
| WebSocket updates | ❌ | ❌ | ❌ | ⚪ All missing |
| Incremental indexing | ❌ | ❌ | ❌ | ⚪ All missing |

**Major Gap**: The MCP server implementation (`src/mcp/server.rs:44-62`) is a placeholder. The TypeScript and Python versions use the full MCP SDK while the Rust version waits for a Rust MCP SDK.

---

## 5. Recommended Dependencies

### Add These Dependencies

| Crate | Purpose |
|-------|---------|
| `validator` | Request validation with derive macros |
| `arc-swap` | Lock-free atomic Arc swapping for indexes |
| `dashmap` | Already included, use for concurrent HashMap |
| `rayon` | Parallel directory scanning |
| `lru` | LRU cache for file content |
| `once_cell` | Lazy static initialization (regex) |
| `proptest` | Property-based testing |
| `criterion` | Benchmarking |

```toml
[dependencies]
# Validation
validator = { version = "0.16", features = ["derive"] }

# Lock-free index swapping
arc-swap = "1.6"

# Lazy initialization
once_cell = "1.19"

# Performance (optional, for better search)
tantivy = "0.21"             # Full-text search engine
rayon = "1.8"                # Parallel iteration

# Caching
lru = "0.12"

# Observability
metrics = "0.22"
metrics-exporter-prometheus = "0.13"

[dev-dependencies]
proptest = "1.4"             # Property-based testing
criterion = "0.5"            # Benchmarking
wiremock = "0.5"             # HTTP mocking

# CI tools (install globally)
# cargo install cargo-audit cargo-deny cargo-machete
```

### Consider Replacing

| Current | Replacement | Reason |
|---------|-------------|--------|
| `chrono` | `time` | Fewer historical CVEs |
| `parking_lot::RwLock` for indexes | `arc-swap::ArcSwap` | Lock-free reads |
| Manual regex | `validator` | Derive macros, less error-prone |

### Tokio Features - Reduce Scope

```toml
# Current (too broad)
tokio = { version = "1", features = ["full"] }

# Better: Only needed features
tokio = { version = "1.35", features = ["rt-multi-thread", "fs", "signal", "net", "sync"] }
```

### Remove If Unused

| Dependency | Reason |
|------------|--------|
| `globset` | Appears unused (walkdir handles globs) |
| `notify-debouncer-mini` | Imported but `Config` unused |

---

## Summary Statistics

| Category | Critical | High | Medium | Low |
|----------|----------|------|--------|-----|
| Idiomatic Rust | 1 | 2 | 3 | 1 |
| Async Correctness | 2 | 1 | 1 | 1 |
| Performance | 1 | 2 | 2 | 0 |
| Correctness & Safety | 1 | 2 | 2 | 0 |
| API Design | 0 | 1 | 2 | 0 |
| Testing | 0 | 1 | 1 | 0 |
| Documentation | 0 | 0 | 1 | 2 |
| Dependencies | 0 | 1 | 1 | 1 |
| Build & CI | 1 | 0 | 1 | 0 |
| Production Readiness | 2 | 2 | 0 | 0 |
| **Total** | **8** | **12** | **14** | **5** |

---

## Conclusion

The Rust Skills MCP Server is a functional scaffold that compiles and passes tests, but has **8 critical issues** that would cause production failures:

1. **Blocking I/O** will cause thread starvation under load
2. **Race conditions** in reload will cause inconsistent state
3. **Path traversal** vulnerability allows arbitrary file access
4. **Unbounded memory** from storing full content in index
5. **No input validation** allows malformed/malicious requests

The code demonstrates good Rust patterns in some areas (error types with `thiserror`, builder patterns, module organization) but needs significant hardening for production use. The 6-phase refactoring roadmap prioritizes security and correctness fixes before performance optimizations.

---

*Report generated by automated code review following the 10-dimension critique framework.*
