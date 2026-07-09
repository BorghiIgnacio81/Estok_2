INSERT INTO application_deployment_queues (application_id, deployment_uuid, force_rebuild, status, is_webhook, created_at, updated_at, commit, restart_only)
VALUES ('4', gen_random_uuid()::text, true, 'queued', false, NOW(), NOW(), 'HEAD', false);
