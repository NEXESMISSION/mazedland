-- Rollback of 0200 · the Vault forgets the cron secret. Only once the jobs
-- carry the key in their URL again (roll 0158 and 0197 back first): with the
-- secret gone they would send an empty Authorization header.

delete from vault.secrets where name = 'cron_secret';
