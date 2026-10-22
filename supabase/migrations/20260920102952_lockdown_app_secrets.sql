/*
# Lock down app_secrets table — revoke anon/authenticated privileges

1. Security Changes
- Revoke ALL privileges on `app_secrets` from `anon` and `authenticated` roles.
- RLS is already enabled with zero policies (deny-by-default), so anon/authenticated
  cannot read any rows. This migration additionally removes the table-level GRANTs
  so those roles have no privileges at all on this table.
- Only the service role (used by edge functions, bypasses RLS) can access secrets.
*/

REVOKE ALL ON app_secrets FROM anon;
REVOKE ALL ON app_secrets FROM authenticated;
