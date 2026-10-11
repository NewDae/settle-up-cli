CREATE TABLE browser_logins (
  browser_id TEXT PRIMARY KEY,
  device_hash TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  envelope TEXT
);
CREATE INDEX browser_login_expiry ON browser_logins(expires_at);
CREATE TABLE login_limits (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
