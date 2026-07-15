CREATE TABLE invitations (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email varchar(255) NOT NULL,
    role text NOT NULL,
    token_hash bytea NOT NULL UNIQUE,
    state text NOT NULL DEFAULT 'pending',
    invited_by uuid REFERENCES users(id) ON DELETE SET NULL,
    accepted_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    resolved_at timestamptz,
    CONSTRAINT invitations_email_normalized CHECK (email = lower(email)),
    CONSTRAINT invitations_role CHECK (
        role IN ('owner', 'admin', 'developer', 'deployer', 'viewer')
    ),
    CONSTRAINT invitations_token_hash_length CHECK (octet_length(token_hash) = 32),
    CONSTRAINT invitations_state CHECK (
        state IN ('pending', 'accepted', 'revoked', 'expired')
    ),
    CONSTRAINT invitations_expiration CHECK (expires_at > created_at),
    CONSTRAINT invitations_resolution CHECK (
        (state = 'pending' AND resolved_at IS NULL AND accepted_by IS NULL)
        OR (state = 'accepted' AND resolved_at IS NOT NULL AND accepted_by IS NOT NULL)
        OR (state IN ('revoked', 'expired') AND resolved_at IS NOT NULL AND accepted_by IS NULL)
    ),
    CONSTRAINT invitations_resolution_time CHECK (
        resolved_at IS NULL OR resolved_at >= created_at
    )
);

CREATE UNIQUE INDEX invitations_organization_email_pending_unique
    ON invitations(organization_id, email)
    WHERE state = 'pending';

CREATE INDEX invitations_organization_active_idx
    ON invitations(organization_id, expires_at, created_at DESC)
    WHERE state = 'pending';
