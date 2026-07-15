ALTER TABLE deployments
    ADD CONSTRAINT deployments_idempotency_key_format CHECK (
        octet_length(idempotency_key) BETWEEN 1 AND 128
        AND idempotency_key ~ '^[!-~]+$'
    ),
    ADD CONSTRAINT deployments_message_length CHECK (
        message IS NULL OR char_length(message) BETWEEN 1 AND 500
    ),
    ADD CONSTRAINT deployments_time_order CHECK (finished_at >= created_at),
    ADD CONSTRAINT deployments_release_same_project
        FOREIGN KEY (project_id, release_id)
        REFERENCES releases(project_id, id)
        ON DELETE RESTRICT
        DEFERRABLE INITIALLY DEFERRED,
    ADD CONSTRAINT deployments_previous_release_same_project
        FOREIGN KEY (project_id, previous_release_id)
        REFERENCES releases(project_id, id)
        ON DELETE RESTRICT
        DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX deployments_project_release_succeeded_idx
    ON deployments(project_id, release_id, created_at DESC)
    WHERE status = 'succeeded';
