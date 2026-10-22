/*
# Create app_secrets table for storing API keys securely

1. New Tables
- `app_secrets`
  - `key` (text, primary key — the secret name, e.g. 'GROQ_API_KEY')
  - `value` (text, not null — the secret value)
  - `created_at` (timestamptz, defaults to now())
2. Security
- Enable RLS on `app_secrets`.
- Deny ALL access to anon and authenticated roles. Only the service role
  (which bypasses RLS and is auto-injected into edge functions) can read/write.
- This table is NOT exposed to the frontend. The anon key cannot read it.
*/

CREATE TABLE IF NOT EXISTS app_secrets (
  key text PRIMARY KEY,
  value text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE app_secrets ENABLE ROW LEVEL SECURITY;

-- No policies = deny by default for anon and authenticated.
-- The service role bypasses RLS entirely, so edge functions can read secrets.
