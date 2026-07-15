CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email varchar(255) NOT NULL,
    display_name varchar(120) NOT NULL,
    password_hash text NOT NULL,
    email_verified_at timestamptz,
    disabled_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT users_email_unique UNIQUE (email),
    CONSTRAINT users_email_normalized CHECK (email = lower(email))
);

CREATE TABLE web_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash bytea NOT NULL UNIQUE,
    csrf_secret_hash bytea NOT NULL,
    expires_at timestamptz NOT NULL,
    last_seen_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX web_sessions_user_active_idx
    ON web_sessions(user_id, expires_at)
    WHERE revoked_at IS NULL;

CREATE TABLE api_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name varchar(120) NOT NULL,
    token_hash bytea NOT NULL UNIQUE,
    scopes text[] NOT NULL DEFAULT '{}',
    expires_at timestamptz,
    last_used_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_tokens_user_active_idx
    ON api_tokens(user_id, created_at DESC)
    WHERE revoked_at IS NULL;

CREATE TABLE organizations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar(160) NOT NULL,
    slug varchar(63) NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CONSTRAINT organizations_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9_-]{0,62}$')
);

CREATE TABLE memberships (
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, user_id),
    CONSTRAINT memberships_role CHECK (role IN ('owner', 'admin', 'developer', 'deployer', 'viewer'))
);
CREATE INDEX memberships_user_idx ON memberships(user_id, organization_id);

CREATE TABLE projects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name varchar(160) NOT NULL,
    slug varchar(63) NOT NULL UNIQUE,
    description text,
    spa_fallback boolean NOT NULL DEFAULT true,
    cache_policy text NOT NULL DEFAULT 'standard',
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CONSTRAINT projects_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9_-]{0,62}$'),
    CONSTRAINT projects_cache_policy CHECK (cache_policy IN ('standard', 'aggressive'))
);
CREATE INDEX projects_organization_idx ON projects(organization_id, created_at DESC);

CREATE TABLE project_domains (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    hostname varchar(253) NOT NULL UNIQUE,
    state text NOT NULL DEFAULT 'pending',
    verification_token_hash bytea NOT NULL,
    verified_at timestamptz,
    last_checked_at timestamptz,
    error_code varchar(120),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT project_domains_hostname_normalized CHECK (hostname = lower(hostname)),
    CONSTRAINT project_domains_state CHECK (state IN ('pending', 'verified', 'active', 'failed', 'disabled'))
);
CREATE INDEX project_domains_project_idx ON project_domains(project_id, created_at DESC);

CREATE TABLE artifacts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sha256 char(64) NOT NULL UNIQUE,
    storage_key text NOT NULL UNIQUE,
    state text NOT NULL DEFAULT 'staging',
    file_count integer NOT NULL DEFAULT 0,
    total_size bigint NOT NULL DEFAULT 0,
    manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
    detect_report jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    ready_at timestamptz,
    deleted_at timestamptz,
    CONSTRAINT artifacts_sha256_format CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT artifacts_state CHECK (state IN ('staging', 'ready', 'quarantined', 'deleting', 'deleted')),
    CONSTRAINT artifacts_sizes_non_negative CHECK (file_count >= 0 AND total_size >= 0)
);

CREATE TABLE releases (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    artifact_id uuid REFERENCES artifacts(id) ON DELETE RESTRICT,
    version_number integer NOT NULL,
    state text NOT NULL DEFAULT 'processing',
    failure_code varchar(160),
    failure_detail jsonb,
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    ready_at timestamptz,
    archived_at timestamptz,
    UNIQUE (project_id, version_number),
    UNIQUE (project_id, id),
    CONSTRAINT releases_version_positive CHECK (version_number > 0),
    CONSTRAINT releases_state CHECK (state IN ('processing', 'ready', 'failed', 'archived'))
);
CREATE INDEX releases_project_state_idx ON releases(project_id, state, created_at DESC);
CREATE INDEX releases_artifact_idx ON releases(artifact_id) WHERE artifact_id IS NOT NULL;

CREATE TABLE project_active_releases (
    project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    release_id uuid NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT project_active_release_same_project
        FOREIGN KEY (project_id, release_id)
        REFERENCES releases(project_id, id)
        ON DELETE RESTRICT
        DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE uploads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    release_id uuid REFERENCES releases(id) ON DELETE SET NULL,
    original_filename varchar(255) NOT NULL,
    state text NOT NULL DEFAULT 'pending',
    expected_size bigint NOT NULL,
    received_size bigint NOT NULL DEFAULT 0,
    staging_key text NOT NULL UNIQUE,
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    completed_at timestamptz,
    expires_at timestamptz NOT NULL,
    error_code varchar(160),
    CONSTRAINT uploads_state CHECK (state IN ('pending', 'receiving', 'uploaded', 'processing', 'completed', 'failed', 'cancelled')),
    CONSTRAINT uploads_sizes_valid CHECK (expected_size > 0 AND received_size >= 0 AND received_size <= expected_size)
);
CREATE INDEX uploads_project_state_idx ON uploads(project_id, state, created_at DESC);
CREATE INDEX uploads_expiry_idx ON uploads(expires_at) WHERE state IN ('pending', 'receiving', 'uploaded');

CREATE TABLE jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind text NOT NULL,
    domain_id uuid,
    dedupe_key varchar(255),
    status text NOT NULL DEFAULT 'queued',
    priority smallint NOT NULL DEFAULT 0,
    attempts integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 5,
    next_run_at timestamptz NOT NULL DEFAULT now(),
    locked_by varchar(160),
    locked_until timestamptz,
    heartbeat_at timestamptz,
    input_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    output_json jsonb,
    error_code varchar(160),
    error_detail jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    finished_at timestamptz,
    cancelled_at timestamptz,
    CONSTRAINT jobs_kind CHECK (kind IN ('artifact.process', 'runtime.check', 'webhook.deliver', 'artifact.gc')),
    CONSTRAINT jobs_status CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
    CONSTRAINT jobs_attempts_valid CHECK (attempts >= 0 AND max_attempts > 0)
);
CREATE UNIQUE INDEX jobs_dedupe_unique ON jobs(kind, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX jobs_claim_idx ON jobs(priority DESC, next_run_at, created_at) WHERE status = 'queued';
CREATE INDEX jobs_lease_idx ON jobs(locked_until) WHERE status = 'running';

CREATE TABLE deployments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    release_id uuid NOT NULL REFERENCES releases(id) ON DELETE RESTRICT,
    previous_release_id uuid REFERENCES releases(id) ON DELETE RESTRICT,
    action text NOT NULL,
    status text NOT NULL DEFAULT 'succeeded',
    idempotency_key varchar(255) NOT NULL,
    actor_id uuid NOT NULL REFERENCES users(id),
    message text,
    error_code varchar(160),
    created_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, idempotency_key),
    CONSTRAINT deployments_action CHECK (action IN ('publish', 'rollback')),
    CONSTRAINT deployments_status CHECK (status IN ('succeeded', 'failed'))
);
CREATE INDEX deployments_project_created_idx ON deployments(project_id, created_at DESC);

CREATE TABLE audit_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
    actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
    action varchar(160) NOT NULL,
    target_type varchar(80) NOT NULL,
    target_id uuid,
    request_id uuid,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    ip_address inet,
    user_agent text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_organization_created_idx ON audit_logs(organization_id, created_at DESC);
CREATE INDEX audit_logs_project_created_idx ON audit_logs(project_id, created_at DESC) WHERE project_id IS NOT NULL;

CREATE TABLE webhook_endpoints (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    url text NOT NULL,
    secret_ciphertext bytea NOT NULL,
    events text[] NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    disabled_at timestamptz
);
CREATE INDEX webhook_endpoints_active_idx ON webhook_endpoints(organization_id) WHERE disabled_at IS NULL;

CREATE TABLE webhook_deliveries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    endpoint_id uuid NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
    event_id uuid NOT NULL,
    event_name varchar(160) NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    attempt_count integer NOT NULL DEFAULT 0,
    response_status integer,
    error_code varchar(160),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    delivered_at timestamptz,
    UNIQUE (endpoint_id, event_id),
    CONSTRAINT webhook_deliveries_status CHECK (status IN ('pending', 'delivering', 'delivered', 'failed', 'cancelled'))
);
CREATE INDEX webhook_deliveries_pending_idx
    ON webhook_deliveries(next_attempt_at, created_at)
    WHERE status IN ('pending', 'failed');
