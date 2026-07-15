ALTER TABLE jobs
    ADD CONSTRAINT jobs_running_lease_consistent CHECK (
        (
            status = 'running'
            AND locked_by IS NOT NULL
            AND locked_until IS NOT NULL
            AND heartbeat_at IS NOT NULL
        )
        OR
        (
            status <> 'running'
            AND locked_by IS NULL
            AND locked_until IS NULL
            AND heartbeat_at IS NULL
        )
    ),
    ADD CONSTRAINT jobs_artifact_process_has_domain CHECK (
        kind <> 'artifact.process' OR domain_id IS NOT NULL
    );

ALTER TABLE uploads
    ADD CONSTRAINT uploads_processing_release_consistent CHECK (
        state NOT IN ('processing', 'completed') OR release_id IS NOT NULL
    );
