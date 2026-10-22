/*
# Create chat_messages table (single-tenant, no auth)

1. New Tables
- `chat_messages`
  - `id` (uuid, primary key)
  - `session_id` (text, identifies a chat conversation session, stored in localStorage on the client)
  - `role` (text, either 'user' or 'assistant')
  - `content` (text, the message content)
  - `created_at` (timestamptz, defaults to now())
2. Security
- Enable RLS on `chat_messages`.
- Allow anon + authenticated CRUD because the app is intentionally public/shared (no sign-in screen).
3. Indexes
- Index on `session_id` for fast conversation retrieval.
- Index on `created_at` for chronological ordering.
*/

CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_chat_messages" ON chat_messages;
CREATE POLICY "anon_select_chat_messages"
ON chat_messages FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_chat_messages" ON chat_messages;
CREATE POLICY "anon_insert_chat_messages"
ON chat_messages FOR INSERT
TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_chat_messages" ON chat_messages;
CREATE POLICY "anon_update_chat_messages"
ON chat_messages FOR UPDATE
TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_chat_messages" ON chat_messages;
CREATE POLICY "anon_delete_chat_messages"
ON chat_messages FOR DELETE
TO anon, authenticated USING (true);
