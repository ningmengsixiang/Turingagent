CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('direct', 'project', 'group')),
  title TEXT NOT NULL,
  last_seq BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS session_members (
  session_id UUID NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  last_read_seq BIGINT NOT NULL DEFAULT 0,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL,
  sender_kind TEXT NOT NULL CHECK (sender_kind IN ('human', 'agent')),
  content_type TEXT NOT NULL,
  content TEXT NOT NULL,
  client_msg_id TEXT NOT NULL,
  seq BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, seq),
  UNIQUE (sender_id, client_msg_id)
);

CREATE INDEX IF NOT EXISTS idx_session_members_user ON session_members (user_id);
