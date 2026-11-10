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
    - Delivery batch creation: Max 10 batches per minute.
  - Violations immediately throw an informative error specifying seconds until reset.

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
