# Security Architecture, System Hardening & Abuse Prevention (Phase 13)

## 1. Overview & Threat Model

The Haramaya University Academic Submission Management System (HU-ASMS) is designed with multi-layered defense-in-depth principles. The threat model accounts for adversarial attempts by students to:
1. Harvest identities or submit on behalf of other students or groups.
2. Circumvent submission deadlines or submit arbitrary unassigned files.
3. Overwhelm Telegram bot handlers or web actions via request flooding and spam.
4. Execute directory traversal (`../../etc/passwd`) or inject malicious filenames.
5. Forge Telegram webhook updates to trigger unauthorized administrative actions.
6. Access private submission files outside their assigned academic section.

---

## 2. Security Shield Architecture

```mermaid
flowchart TD
    subgraph Ingress [Ingress & Network Layer]
        TG_IN[Telegram Webhook Update]
        WEB_IN[Web Dashboard HTTP Request]
    end

    subgraph DefenseLayer [Phase 13 Hardening & Security Layer]
        TOK[Webhook Secret Token Verifier (timingSafeEqual)]
        RATE[Sliding-Window Rate Limiter]
        AUTH[Session & Role Context Resolver]
        SCOPE[Section Scope Authorizer (assertRepresentativeSectionScope)]
        FILE[Filename Sanitizer (Directory Traversal Removal)]
        VAULT[Private Storage Vault (15-min Signed URLs Only)]
        ERR[Error Redaction & PII Masking Engine]
    end

    subgraph DataLayer [Persistence & Auditing]
        AUDIT[(Immutable Audit Logs)]
        POSTGRES[(PostgreSQL Database + RLS Policies)]
    end

    TG_IN --> TOK
    TOK --> RATE
    WEB_IN --> RATE
    RATE --> AUTH
    AUTH --> SCOPE
    SCOPE --> FILE
    FILE --> VAULT
    VAULT --> POSTGRES
    SCOPE --> AUDIT
    POSTGRES --> AUDIT
    ERR -. Strips SQL & Stack Traces .-> TG_IN
    ERR -. Redacts Secrets .-> AUDIT
```

---

## 3. Defense-in-Depth Implementation Details

### 3.1 Rate Limiting & Abuse Prevention
- **Telegram Bot (`SlidingWindowRateLimiter`)**:
  - Sliding-window algorithm tracks request timestamps per Telegram User ID.
  - Limits: Max 10 requests per 10-second window for general commands.
  - File upload throttling: Max 3 document uploads per 60 seconds per student.
  - Cooldown feedback: Responds with exact retry-after seconds without crashing or locking the bot conversation.
  - Periodic pruning: Background timer purges stale user records every 5 minutes to prevent heap growth.
- **Web Dashboard (`globalWebRateLimiter`)**:
  - Enforces rate limits on sensitive Server Actions:
    - Signed URL generation: Max 30 requests per minute per representative.
    - Delivery batch operations: Max 20 requests per minute per representative (manifest generation: 30 requests/min; registration review: 30 requests/min).
    - Unauthenticated callers (`unauth` keys): 15 requests/min per action bucket.
  - Violations immediately throw an informative error specifying seconds until reset.
  - **Architectural Limitation (Per-Instance Memory Only)**: `globalWebRateLimiter` in `apps/web/src/lib/security/rate-limiter.ts` stores timestamps inside a single Node.js `Map` in process memory. On Vercel serverless or multi-instance horizontal scaling, state is neither shared across concurrent function instances nor persisted across cold starts (see **Section 5** for the proposed shared rate-limiting architecture).

### 3.2 Telegram Webhook Security
- **Header Verification (`X-Telegram-Bot-Api-Secret-Token`)**:
  - Incoming requests to the bot webhook must supply the secret token header matching `process.env.TELEGRAM_WEBHOOK_SECRET`.
  - Comparison uses `crypto.timingSafeEqual` over UTF-8 byte buffers to eliminate timing side-channel attacks.
  - Missing, malformed, or mismatched tokens immediately return HTTP 403 Forbidden without parsing JSON payloads.
  - Server boot without `TELEGRAM_WEBHOOK_SECRET` returns HTTP 500 and prevents unauthorized update processing.

### 3.3 Filename Sanitization & Directory Traversal Protection
- **`sanitizeFilename(filename: string)` in `@hu-asms/validation`**:
  - Traversal Prevention: Strips `..`, `/`, `\`, and directory sequences.
  - Injection Prevention: Removes null bytes (`\x00`), control characters (`\x00-\x1F\x7F`), and reserved characters (`<>:"|?*`).
  - Base Truncation: Caps the filename base at 80 characters while preserving the extension (e.g. `.pdf`, `.zip`).
  - Fallback: Empty or symbol-only names safely normalize to `submission_file`.
  - Storage Paths: Internal storage paths are strictly generated as:
    `projects/${projectId}/${submissionType}/${studentOrGroupId}/v${version}_${sanitizedFilename}`

### 3.4 Storage Privacy & Signed URL Security
- **Private Bucket Configuration**:
  - Storage bucket `submission-files-vault` is configured with `public = false`. Public URLs are disabled.
- **Short-Lived Signed URLs**:
  - Signed URLs are generated with a strict 15-minute (900-second) TTL.
  - Server actions call `assertRepresentativeSectionScope()` prior to calling `createSignedUrl()`.
  - Row-Level Security (RLS) on `storage.objects` restricts select access to users authorized for the section via `auth_is_rep_for_section()`.

### 3.5 Centralized Error Redaction & PII Protection
- **`formatSafeErrorMessage(err)` in `apps/bot/src/utils/error-handler.ts`**:
  - Intercepts uncaught database errors, Postgrest exceptions, and storage failures.
  - Raw SQL queries, table names (`students`, `submissions`), and stack traces are redacted.
  - Known operational domain errors (e.g., `DUPLICATE_GROUP_SUBMISSION`, `DEADLINE_EXCEEDED`) pass through with clean user guidance.
- **`sanitizeLogData(payload)`**:
  - Recursively traverses objects and replaces sensitive keys (`token`, `secret`, `service_role`, `apikey`) with `[REDACTED]` before writing to logs.

---

## 4. Verification & Coverage Summary

| Suite | Focus Area | Tests | Result |
|---|---|:---:|:---:|
| `rate-limiter.test.ts` | Bot sliding-window limiter, burst throttling, cooldown, pruning, middleware | 6 | **PASS** |
| `webhook-security.test.ts` | Secret token constant-time check, 403/500 guards, SQL redaction, log sanitization | 11 | **PASS** |
| `security-hardening.test.ts` | Filename traversal, null bytes, web rate limiter, privilege escalation review | 11 | **PASS** |
| **All Phase 13 Suites** | Security, abuse prevention & hardening | **28** | **PASS** |
| **Total Workspace Suites** | Phases 01 through 13 regression suite | **139** | **PASS** |

### Final Verified Coverage Metrics
- **Line Coverage**: **88.68%**
- **Branch Coverage**: **67.60%**
- **Function Coverage**: **80.93%**

---

## 5. Architectural Proposal — Shared Distributed Rate Limiting (Future Work)

> **Status:** Proposal only. No external Redis service, dependency, or credentials have been added or configured. See also [`docs/TRACK_B_CORRECTION_PLAN.md`](TRACK_B_CORRECTION_PLAN.md).

### 5.1 Current Limitation
- `globalWebRateLimiter` (`MemoryRateLimiter` in `apps/web/src/lib/security/rate-limiter.ts`, bounded to `10,000` LRU buckets and `60_000 ms` `O(n)` expiry pruning) and `SlidingWindowRateLimiter` (`apps/bot/src/middleware/rate-limit.middleware.ts`) maintain sliding-window timestamps solely in in-process JavaScript `Map` structures.
- In serverless runtimes such as Vercel, concurrent invocations execute across isolated worker instances and warm containers recycle independently. A flood distributed across $N$ cold starts or parallel lambdas bypasses per-instance thresholds up to $N \times \text{limit}$ and resets whenever an instance recycles. Furthermore, unauthenticated callers fallback to a coarse shared key (`admin-reg-review:unauth`) unless keyed by validated client IP at the edge.

### 5.2 Proposed Shared Architecture (Two Viable Options)
1. **Recommended for Low-Latency Edge/Serverless Enforcement — Managed Redis (e.g., Upstash Redis REST API):**
   - Implement a `RateLimitStore` interface (`check(key, maxRequests, windowMs): Promise<RateLimitCheckResult>`) backed by an atomic Lua/INCR+PEXPIRE sliding-window or token-bucket script over HTTPS REST so both Edge Middleware and Node.js Server Actions can share counters without TCP pooling limits.
   - Inject server-only env vars (`RATE_LIMIT_REDIS_REST_URL`, `RATE_LIMIT_REDIS_REST_TOKEN` — never prefixed with `NEXT_PUBLIC_`).
   - Fail-closed / degraded policy: log operational error with secret redaction; fail closed on high-risk admin/auth actions (`approveRegistration`, `rejectRegistration`, signed URLs) and fall back to strict short-window memory throttling only if explicitly configured for availability.
2. **Zero-New-Vendor Alternative — PostgreSQL/Supabase Fixed-Window or Sliding-Window Bucket Table + `SECURITY DEFINER` RPC:**
   - Store `(rate_key TEXT PRIMARY KEY, window_started_at TIMESTAMPTZ, request_count INT)` in an RLS-locked backend table (`service_role` / `SECURITY DEFINER` RPC only) with atomic `INSERT ... ON CONFLICT (rate_key) DO UPDATE` in a single transaction, plus scheduled cleanup of expired keys.
   - Adds one DB round-trip per rate-limited call (~5–20 ms), suitable for low-QPS admin/rep mutations if zero third-party services are desired, though Redis REST is preferred for high-volume webhook/bot ingress.

---

## 6. Atomic Transactional RPCs & DB Parity (`20261111000002`, Locally Staged Only)

> **Status:** Staged locally in [`supabase/migrations/20261111000002_track_b_atomic_rpcs_and_db_parity.sql`](../supabase/migrations/20261111000002_track_b_atomic_rpcs_and_db_parity.sql) and wired in application services. **NOT** applied or pushed to live Supabase while the deployment freeze remains active. See [`docs/TRACK_B_CORRECTION_PLAN.md`](TRACK_B_CORRECTION_PLAN.md) for the full design and parity matrix.

### 6.1 Track B Atomic RPC Solutions (C1 & C2)
1. **Atomic Student Registration Approval (`public.approve_student_registration(p_request_id UUID, p_notes TEXT DEFAULT NULL)`):**
   - Derives `v_actor_id := auth.uid()` and enforces `public.auth_is_system_owner()` (or trusted `service_role` / DBA session).
   - Locks the target row with `SELECT ... FROM public.registration_requests WHERE id = p_request_id FOR UPDATE`, verifies `status = 'pending'`, guards against duplicate `students` (`hu_student_id` or `telegram_user_id`), creates the locked student record (`registration_status = 'locked'`, `is_locked = true`), updates the request (`status = 'approved'`), and writes `STUDENT_REGISTRATION_APPROVED` into `public.audit_logs` within one PostgreSQL ACID transaction.
   - Paired with partial unique indexes `uq_pending_registration_request_hu_id` and `uq_pending_registration_request_telegram_id` (`WHERE status = 'pending'`).
2. **Atomic Student Registration Rejection (`public.reject_student_registration(p_request_id UUID, p_reason TEXT DEFAULT NULL)`):**
   - Enforces the same `auth_is_system_owner()` check and row lock (`FOR UPDATE`), transitions `'pending' -> 'rejected'` with normalized reason, and commits `STUDENT_REGISTRATION_REJECTED` into `public.audit_logs` atomically.
3. **Atomic Delivery Dispatch (`public.mark_delivery_sent_with_audit(p_delivery_id UUID, p_dispatch_notes TEXT DEFAULT NULL)`):**
   - Verifies active staff profile and section scope (`auth_is_system_owner()` or `auth_is_rep_for_section(v_delivery.section_id)`), locks `deliveries` row (`FOR UPDATE`), validates `'prepared'` state and positive `batch_count = COUNT(delivery_items)`, transitions status to `'sent'`, and commits `TEACHER_DELIVERY_DISPATCHED` (`prepared_by` + `dispatched_by`) atomically.
   - `executeDispatchDelivery` (`apps/web/src/lib/rep/delivery-service.ts`) never reverts `'sent'` back to `'prepared'`, and `enforce_delivery_integrity()` blocks invalid backward status transitions in PostgreSQL.

### 6.2 Application Wrapper Compatibility & Pre-Deployment Constraints
- [`executeApproveRegistration`](../apps/web/src/lib/admin/student-approval-service.ts), `executeRejectRegistration`, and `executeDispatchDelivery` call `.rpc()` first whenever `typeof supabase.rpc === 'function'`, keeping sequential compensating fallbacks only for lightweight test mocks lacking `.rpc()`.
- Direct representative mutations on `groups`, `group_members`, `deliveries`, and `delivery_items` are additionally hardened by database triggers (`enforce_group_integrity`, `enforce_group_member_integrity`, deferrable `enforce_group_member_size_bounds`, updated `check_and_update_group_verification`, `enforce_delivery_integrity`, `enforce_delivery_item_integrity`) and tightened RLS `WITH CHECK` policies (`rep_access_assigned_section_groups`, `rep_access_assigned_section_group_members`, `rep_manage_section_delivery_items`).
- All three `SECURITY DEFINER` RPCs declare `SET search_path = ''`, qualify schema names, `REVOKE ALL FROM PUBLIC`, and grant `EXECUTE` strictly to `authenticated` and `service_role`. Live remote verification remains blocked/UNVERIFIED until deployment freeze authorization is granted.
