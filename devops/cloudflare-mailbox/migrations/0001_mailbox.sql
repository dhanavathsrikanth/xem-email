PRAGMA foreign_keys = ON;

CREATE TABLE mailbox_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  uid_validity INTEGER NOT NULL CHECK (uid_validity > 0 AND uid_validity <= 4294967295),
  total_emails INTEGER NOT NULL DEFAULT 0,
  latest_uid INTEGER NOT NULL DEFAULT 0
);

INSERT INTO mailbox_state (id, uid_validity)
VALUES (1, ((random() & 4294967295) % 4294967295) + 1);

CREATE TABLE messages (
  uid INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  folder TEXT NOT NULL DEFAULT 'INBOX' CHECK (folder = 'INBOX'),
  received_at TEXT NOT NULL,
  envelope_from TEXT NOT NULL,
  envelope_to TEXT NOT NULL,
  header_from TEXT NOT NULL,
  header_to TEXT NOT NULL,
  header_cc TEXT NOT NULL,
  header_bcc TEXT NOT NULL,
  reply_to TEXT NOT NULL,
  subject TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  message_id TEXT NOT NULL,
  body_key TEXT NOT NULL,
  body_preview TEXT NOT NULL,
  attachment_json TEXT NOT NULL DEFAULT '[]',
  raw_key TEXT NOT NULL,
  raw_size INTEGER NOT NULL CHECK (raw_size > 0 AND raw_size <= 10485760),
  seen INTEGER NOT NULL DEFAULT 0 CHECK (seen IN (0, 1)),
  flagged INTEGER NOT NULL DEFAULT 0 CHECK (flagged IN (0, 1))
);

CREATE INDEX messages_folder_uid ON messages(folder, uid DESC);
CREATE INDEX messages_folder_seen_uid ON messages(folder, seen, uid DESC);
CREATE INDEX messages_folder_flagged_uid ON messages(folder, flagged, uid DESC);

CREATE TRIGGER messages_update_state AFTER INSERT ON messages
BEGIN
  UPDATE mailbox_state SET total_emails = total_emails + 1, latest_uid = NEW.uid WHERE id = 1;
END;

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size >= 0),
  object_key TEXT NOT NULL,
  UNIQUE (message_id, position)
);

CREATE INDEX attachments_message ON attachments(message_id, position);

CREATE TABLE api_rate_limits (
  bucket INTEGER PRIMARY KEY,
  requests INTEGER NOT NULL
);
