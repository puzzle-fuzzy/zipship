ALTER TABLE uploads
    ADD COLUMN transfer_id uuid,
    ADD COLUMN receive_lease_expires_at timestamptz,
    ADD COLUMN uploaded_at timestamptz,
    ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
    ADD CONSTRAINT uploads_receive_lease_consistent CHECK (
        (
            state = 'receiving'
            AND transfer_id IS NOT NULL
            AND receive_lease_expires_at IS NOT NULL
        ) OR (
            state <> 'receiving'
            AND transfer_id IS NULL
            AND receive_lease_expires_at IS NULL
        )
    );

CREATE INDEX uploads_receive_lease_idx
    ON uploads(receive_lease_expires_at)
    WHERE state = 'receiving';
