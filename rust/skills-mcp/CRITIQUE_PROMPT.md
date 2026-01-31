# Rust Implementation Critique Prompt

You are a senior Rust engineer with 10+ years of systems programming experience, deep expertise in async Rust, and extensive knowledge of production MCP (Model Context Protocol) servers. Your task is to perform an exhaustive, unsparing critique of this Rust crate.

## Context

This crate (`skills-mcp`) is a Rust port of a Python/TypeScript Skills MCP Server. It provides:
- Skill indexing and metadata management
- Full-text and metadata-based search
- Schema validation
- HTTP REST API (Axum)
- MCP server scaffolding (pending SDK integration)

The codebase is located at: `rust/skills-mcp/`

## Critique Dimensions

Evaluate each dimension with specific line references, code examples, and concrete recommendations.

---

### 1. IDIOMATIC RUST

#### 1.1 Ownership & Borrowing
- Are there unnecessary clones that could be avoided with references or `Cow<'_, str>`?
- Are lifetimes used correctly, or are there places where explicit lifetimes would improve clarity?
- Is `Arc` overused where `&T` or `Rc` would suffice?
- Are there cases of "clone-happy" code that suggest ownership confusion?

#### 1.2 Error Handling
- Is `thiserror` used appropriately for library errors?
- Should any `unwrap()` or `expect()` calls be replaced with proper error propagation?
- Are error types granular enough for callers to handle specific cases?
- Is `anyhow` used correctly (applications) vs `thiserror` (libraries)?
- Are `Result` return types consistent across the API?

#### 1.3 Type System Usage
- Are newtypes used where they'd prevent bugs (e.g., `SkillName(String)` vs raw `String`)?
- Could `NonZeroUsize`, `NonEmpty<Vec<T>>`, or other refinement types improve safety?
- Are enums exhaustive with `#[non_exhaustive]` where appropriate?
- Is `Option<T>` vs sentinel values handled consistently?

#### 1.4 Trait Implementation
- Are standard traits (`Debug`, `Clone`, `Default`, `PartialEq`, `Eq`, `Hash`) derived where appropriate?
- Should any types implement `Display` for user-facing output?
- Are `From`/`Into` conversions implemented where they'd reduce boilerplate?
- Is `AsRef`/`Borrow` used for flexible APIs?

#### 1.5 Module Organization
- Does the module structure follow Rust conventions?
- Are visibility modifiers (`pub`, `pub(crate)`, `pub(super)`) used correctly?
- Is there unnecessary re-exporting or unclear public API surface?

---

### 2. ASYNC CORRECTNESS

#### 2.1 Tokio Usage
- Are blocking operations (file I/O, CPU-heavy work) properly offloaded with `spawn_blocking`?
- Is `tokio::fs` used instead of `std::fs` in async contexts?
- Are there hidden blocking calls that could stall the runtime?

#### 2.2 Concurrency Primitives
- Is `parking_lot` vs `tokio::sync` used appropriately?
- Are there potential deadlocks from lock ordering issues?
- Could `DashMap` be replaced with `tokio::sync::RwLock<HashMap>` for async-friendliness?
- Are mutex guards held across `.await` points (a major bug)?

#### 2.3 Task Spawning
- Are spawned tasks properly tracked with `JoinHandle`?
- Is there proper cancellation handling?
- Are panics in spawned tasks handled?

#### 2.4 Channel Usage
- Are channels bounded where they should be to prevent memory exhaustion?
- Is `mpsc` vs `broadcast` vs `watch` used appropriately?

---

### 3. PERFORMANCE

#### 3.1 Allocation Patterns
- Are there hot paths with unnecessary allocations?
- Could `SmallVec`, `ArrayVec`, or stack allocation improve performance?
- Are string operations using `&str` where possible instead of `String`?
- Is `String::with_capacity` used when final size is known?

#### 3.2 Search Performance
- Is the search algorithm O(n) when it could be O(log n) or O(1)?
- Should content indexing use an inverted index instead of linear scan?
- Are regex patterns compiled once or on every search?
- Could `aho-corasick` multi-pattern matching improve multi-term search?

#### 3.3 Indexing Performance
- Is directory traversal parallel with `rayon`?
- Are file reads buffered appropriately?
- Is JSON parsing streaming or loading entire files?
- Could incremental indexing avoid full rebuilds?

#### 3.4 Memory Usage
- Are large structures boxed to reduce stack size?
- Is `content: String` in `ContentIndexEntry` wasteful for large files?
- Could memory-mapped files reduce RAM usage?

---

### 4. CORRECTNESS & SAFETY

#### 4.1 Unsafe Code
- Is there any `unsafe` code? If so, is it justified and sound?
- Are FFI boundaries (if any) handled correctly?

#### 4.2 Panics
- Are there any `unwrap()`, `expect()`, `panic!()`, or index operations that could panic in production?
- Is `#![deny(clippy::unwrap_used)]` enabled?

#### 4.3 Edge Cases
- What happens with empty skill directories?
- What happens with malformed `_meta.json`?
- What happens with very large files (>1GB)?
- What happens with symlink loops?
- What happens with non-UTF8 file names?

#### 4.4 Race Conditions
- Can concurrent index reloads corrupt state?
- Is the file watcher + reload logic race-free?
- Are statistics updates atomic?

---

### 5. API DESIGN

#### 5.1 Public API Surface
- Is the public API minimal and focused?
- Are internal implementation details exposed?
- Is the API consistent in naming and conventions?

#### 5.2 Builder Patterns
- Should complex structs use builders instead of constructors?
- Are required vs optional fields clear?

#### 5.3 HTTP API
- Are status codes semantically correct (201 for create, 204 for delete, etc.)?
- Is error response format consistent?
- Are routes RESTful?
- Is input validation comprehensive?

#### 5.4 Extensibility
- Can new search match types be added without breaking changes?
- Can new tool handlers be added easily?
- Is the indexer pluggable for different storage backends?

---

### 6. TESTING

#### 6.1 Test Coverage
- What critical paths lack tests?
- Are edge cases tested (empty inputs, very long strings, Unicode)?
- Are error paths tested?

#### 6.2 Test Quality
- Are tests isolated (no shared mutable state)?
- Are tests deterministic (no flaky timing)?
- Are test assertions specific enough?

#### 6.3 Integration Testing
- Are there integration tests for the HTTP API?
- Are there tests for the full indexer -> search pipeline?
- Is file system behavior tested on different platforms?

#### 6.4 Property-Based Testing
- Could `proptest` or `quickcheck` catch edge cases?
- Are there invariants that should be fuzz-tested?

---

### 7. DOCUMENTATION

#### 7.1 API Documentation
- Do all public items have doc comments?
- Are examples provided for complex APIs?
- Are panics and errors documented?

#### 7.2 Architecture Documentation
- Is the module structure documented?
- Are key design decisions explained?
- Is there a CONTRIBUTING guide?

---

### 8. DEPENDENCIES

#### 8.1 Dependency Audit
- Are all dependencies necessary?
- Are there lighter alternatives (e.g., `regex` vs `regex-lite`)?
- Are version constraints appropriate (exact vs caret)?
- Are features minimized to reduce compile time?

#### 8.2 Security
- Are dependencies audited with `cargo audit`?
- Is `serde` derive used safely (no untrusted input deserialized to types with `#[serde(default)]` issues)?

---

### 9. BUILD & CI

#### 9.1 Compilation
- Does `cargo clippy` pass without warnings?
- Does `cargo fmt --check` pass?
- Are there unused dependencies?

#### 9.2 Features
- Are feature flags used appropriately?
- Is the `mcp` feature stub-only code gated?

#### 9.3 Cross-Platform
- Does the code compile on Windows, Linux, and macOS?
- Are path separators handled correctly?
- Are file system case sensitivity differences handled?

---

### 10. PRODUCTION READINESS

#### 10.1 Observability
- Is `tracing` instrumentation sufficient?
- Are spans structured for debugging?
- Are metrics exported (request counts, latencies)?

#### 10.2 Configuration
- Is configuration externalized (env vars, config files)?
- Are defaults sensible and documented?

#### 10.3 Graceful Shutdown
- Is shutdown properly implemented?
- Are in-flight requests completed?
- Are resources cleaned up?

#### 10.4 Resource Limits
- Are there timeouts on operations?
- Is memory usage bounded?
- Are file handles limited?

---

## Critique Output Format

For each issue found, provide:

```markdown
### [SEVERITY] Category: Issue Title

**Location:** `src/path/file.rs:123-145`

**Current Code:**
```rust
// problematic code snippet
```

**Problem:** Explain why this is an issue.

**Recommendation:**
```rust
// improved code
```

**Impact:** What bugs, performance issues, or maintenance problems does this cause?
```

Severity levels:
- 🔴 **CRITICAL**: Will cause bugs, crashes, or security issues
- 🟠 **HIGH**: Significant performance or correctness concerns
- 🟡 **MEDIUM**: Code quality, maintainability, or minor issues
- 🟢 **LOW**: Style, documentation, or nitpicks

---

## Files to Review

Prioritize review in this order:

1. `src/lib.rs` - Public API surface
2. `src/models/*.rs` - Core data types
3. `src/index/indexer.rs` - Critical indexing logic
4. `src/search/service.rs` - Search algorithm
5. `src/api/routes.rs` - HTTP handlers
6. `src/mcp/tools.rs` - MCP tool implementations
7. `src/validation/*.rs` - Validation logic
8. `Cargo.toml` - Dependencies

---

## Final Deliverables

1. **Issue List**: All issues found, categorized by severity
2. **Priority Fixes**: Top 10 changes to make before production
3. **Refactoring Roadmap**: Larger structural improvements
4. **Missing Features**: Gaps compared to Python/TypeScript implementations
5. **Recommended Dependencies**: Libraries that would improve the crate

Begin your critique now. Be thorough, specific, and actionable.
