CREATE TABLE password_reset_requests (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash bytea NOT NULL UNIQUE,
    state text NOT NULL DEFAULT 'pending',
    requested_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    resolved_at timestamptz,
    CONSTRAINT password_reset_token_hash_length CHECK (octet_length(token_hash) = 32),
    CONSTRAINT password_reset_state CHECK (
        state IN ('pending', 'consumed', 'superseded', 'expired')
    ),
    CONSTRAINT password_reset_expiration CHECK (expires_at > requested_at),
    CONSTRAINT password_reset_resolution CHECK (
        (state = 'pending' AND resolved_at IS NULL)
        OR (state <> 'pending' AND resolved_at IS NOT NULL)
    ),
    CONSTRAINT password_reset_resolution_time CHECK (
        resolved_at IS NULL OR resolved_at >= requested_at
    )
);

CREATE UNIQUE INDEX password_reset_user_pending_unique
    ON password_reset_requests(user_id)
    WHERE state = 'pending';

CREATE INDEX password_reset_user_history_idx
    ON password_reset_requests(user_id, requested_at DESC);

CREATE TABLE email_outbox (
    id uuid PRIMARY KEY,
    kind text NOT NULL,
    aggregate_id uuid NOT NULL UNIQUE REFERENCES password_reset_requests(id) ON DELETE CASCADE,
    key_id varchar(64),
    nonce bytea,
    ciphertext bytea,
    state text NOT NULL DEFAULT 'queued',
    attempts smallint NOT NULL DEFAULT 0,
    max_attempts smallint NOT NULL,
    next_attempt_at timestamptz NOT NULL,
    locked_by varchar(160),
    locked_until timestamptz,
    heartbeat_at timestamptz,
    last_error_code varchar(160),
    created_at timestamptz NOT NULL,
    delivered_at timestamptz,
    finished_at timestamptz,
    CONSTRAINT email_outbox_kind CHECK (kind IN ('password_reset')),
    CONSTRAINT email_outbox_key_id_format CHECK (
        key_id IS NULL OR key_id ~ '^[A-Za-z0-9._-]{1,64}$'
    ),
    CONSTRAINT email_outbox_nonce_length CHECK (
        nonce IS NULL OR octet_length(nonce) = 24
    ),
    CONSTRAINT email_outbox_ciphertext_length CHECK (
        ciphertext IS NULL OR octet_length(ciphertext) > 16
    ),
    CONSTRAINT email_outbox_state CHECK (
        state IN ('queued', 'sending', 'delivered', 'failed', 'cancelled')
    ),
    CONSTRAINT email_outbox_attempts CHECK (
        attempts >= 0 AND max_attempts > 0 AND attempts <= max_attempts
    ),
    CONSTRAINT email_outbox_lease CHECK (
        (state = 'sending' AND locked_by IS NOT NULL AND locked_until IS NOT NULL)
        OR (state <> 'sending' AND locked_by IS NULL AND locked_until IS NULL AND heartbeat_at IS NULL)
    ),
    CONSTRAINT email_outbox_payload_lifecycle CHECK (
        (
            state IN ('queued', 'sending')
            AND key_id IS NOT NULL
            AND nonce IS NOT NULL
            AND ciphertext IS NOT NULL
            AND delivered_at IS NULL
            AND finished_at IS NULL
        )
        OR (
            state = 'delivered'
            AND key_id IS NULL
            AND nonce IS NULL
            AND ciphertext IS NULL
            AND delivered_at IS NOT NULL
            AND finished_at IS NOT NULL
        )
        OR (
            state IN ('failed', 'cancelled')
            AND key_id IS NULL
            AND nonce IS NULL
            AND ciphertext IS NULL
            AND delivered_at IS NULL
            AND finished_at IS NOT NULL
        )
    ),
    CONSTRAINT email_outbox_finish_time CHECK (
        finished_at IS NULL OR finished_at >= created_at
    ),
    CONSTRAINT email_outbox_delivery_time CHECK (
        delivered_at IS NULL OR delivered_at >= created_at
    )
);

CREATE INDEX email_outbox_claim_idx
    ON email_outbox(next_attempt_at, created_at, id)
    WHERE state = 'queued';

CREATE INDEX email_outbox_lease_idx
    ON email_outbox(locked_until)
    WHERE state = 'sending';
