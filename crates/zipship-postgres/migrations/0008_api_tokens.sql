-- ZipShip has no production data at this stage. Replace the provisional table
-- instead of carrying compatibility defaults into the final token model.
DROP TABLE api_tokens;

CREATE TABLE api_tokens (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name varchar(120) NOT NULL,
    display_prefix varchar(12) NOT NULL,
    token_hash bytea NOT NULL UNIQUE,
    scopes text[] NOT NULL,
    expires_at timestamptz NOT NULL,
    last_used_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL,
    CONSTRAINT api_tokens_name_format CHECK (
        name = btrim(name)
        AND char_length(name) BETWEEN 1 AND 120
        AND name !~ '[[:cntrl:]]'
    ),
    CONSTRAINT api_tokens_display_prefix_format CHECK (
        display_prefix ~ '^zps_[A-Za-z0-9_-]{8}$'
    ),
    CONSTRAINT api_tokens_token_hash_length CHECK (octet_length(token_hash) = 32),
    CONSTRAINT api_tokens_scopes_shape CHECK (
        array_ndims(scopes) = 1
        AND cardinality(scopes) BETWEEN 1 AND 4
        AND array_position(scopes, NULL) IS NULL
    ),
    CONSTRAINT api_tokens_scopes_known CHECK (
        scopes <@ ARRAY[
            'projects:read',
            'releases:read',
            'uploads:write',
            'deployments:write'
        ]::text[]
    ),
    CONSTRAINT api_tokens_scopes_unique CHECK (
        cardinality(scopes) =
            CASE WHEN 'projects:read' = ANY(scopes) THEN 1 ELSE 0 END
            + CASE WHEN 'releases:read' = ANY(scopes) THEN 1 ELSE 0 END
            + CASE WHEN 'uploads:write' = ANY(scopes) THEN 1 ELSE 0 END
            + CASE WHEN 'deployments:write' = ANY(scopes) THEN 1 ELSE 0 END
    ),
    CONSTRAINT api_tokens_expiration_window CHECK (
        expires_at >= created_at + INTERVAL '1 day'
        AND expires_at <= created_at + INTERVAL '365 days'
    ),
    CONSTRAINT api_tokens_last_used_time CHECK (
        last_used_at IS NULL OR last_used_at >= created_at
    ),
    CONSTRAINT api_tokens_revocation_time CHECK (
        revoked_at IS NULL OR revoked_at >= created_at
    ),
    CONSTRAINT api_tokens_use_before_revocation CHECK (
        last_used_at IS NULL OR revoked_at IS NULL OR last_used_at <= revoked_at
    )
);

CREATE INDEX api_tokens_user_history_idx
    ON api_tokens(user_id, created_at DESC, id DESC);

CREATE INDEX api_tokens_user_unrevoked_expiry_idx
    ON api_tokens(user_id, expires_at)
    WHERE revoked_at IS NULL;
