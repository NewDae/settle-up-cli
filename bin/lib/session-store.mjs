import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

// Keep OS integration behind this adapter; the CLI never handles encryption keys.
export function createSessionStore({ configDir, environment, apiBaseUrl, authBaseUrl, storage = 'keyring' }) {
  const scope = createHash('sha256').update(JSON.stringify([
    path.resolve(configDir), environment, apiBaseUrl, authBaseUrl,
  ])).digest('hex');
  const directory = path.join(configDir, environment);
  const legacyPath = path.join(directory, 'auth.json');
  const filePath = path.join(directory, `auth-${scope}.json`);
  let entry;

  function validateStorage() {
    if (!['keyring', 'file'].includes(storage)) {
      throw Object.assign(new Error('SETTLEUP_AUTH_STORAGE must be keyring or file'), {
        cliCode: 'INVALID_INPUT', details: { variable: 'SETTLEUP_AUTH_STORAGE' },
      });
    }
  }

  function failure(operation) {
    // Native errors can contain secret values. Never forward them to CLI output.
    return Object.assign(new Error(`Could not ${operation} the ${storage === 'keyring' ? 'OS credential store' : 'session file'}`), {
      cliCode: 'AUTH_STORAGE_FAILED',
      details: {
        storage, operation,
        help: storage === 'keyring'
          ? 'Unlock or enable your OS credential store (Secret Service on Linux), then retry. For an intentional plaintext session, set SETTLEUP_AUTH_STORAGE=file and sign in again. No automatic fallback was used.'
          : 'Check access to SETTLEUP_CLI_CONFIG_DIR. File storage is plaintext and must be accessible only to your user account.',
      },
    });
  }

  function session(value) {
    const accessToken = value?.accessToken || value?.idToken;
    if (typeof accessToken !== 'string' || !accessToken
        || typeof value?.refreshToken !== 'string' || !value.refreshToken
        || typeof value?.uid !== 'string' || !value.uid
        || !Number.isFinite(value?.expiresAt)) throw new Error('Invalid stored session');
    // Persist only session fields, even if a legacy file has unrelated secrets.
    return {
      accessToken, refreshToken: value.refreshToken, uid: value.uid,
      ...(typeof value.email === 'string' ? { email: value.email } : {}), expiresAt: value.expiresAt,
    };
  }

  function readFile(filename) {
    try {
      return fs.readFileSync(filename, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  function removeFile(filename) {
    try { fs.unlinkSync(filename); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }

  async function keyring() {
    if (!entry) {
      const { AsyncEntry } = await import('@napi-rs/keyring');
      entry = new AsyncEntry('settle-up-cli', scope, { linux: { store: 'secret-service' } });
    }
    return entry;
  }

  function saveFile(text) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') {
      fs.chmodSync(configDir, 0o700);
      fs.chmodSync(directory, 0o700);
    }
    // Write atomically so interruption cannot truncate a working session.
    const temporary = `${filePath}.${randomUUID()}.tmp`;
    try {
      const fd = fs.openSync(temporary, 'wx', 0o600);
      try {
        fs.writeFileSync(fd, text);
        fs.fsyncSync(fd);
      } finally { fs.closeSync(fd); }
      fs.renameSync(temporary, filePath);
    } finally { removeFile(temporary); }
  }

  async function rawRead() {
    if (storage === 'file') return readFile(filePath);
    // UTF-8 bytes avoid the UTF-16 expansion of Windows password storage.
    const bytes = await (await keyring()).getSecret();
    return bytes === null ? null : Buffer.from(bytes).toString('utf8');
  }

  async function saveVerified(auth) {
    const text = JSON.stringify(session(auth));
    if (storage === 'file') saveFile(text);
    else await (await keyring()).setSecret(Buffer.from(text, 'utf8'));
    if (await rawRead() !== text) throw new Error('Session could not be verified');
  }

  async function guarded(operation, work) {
    validateStorage();
    try { return await work(); } catch { throw failure(operation); }
  }

  return {
    storage, filePath,
    // Check accessibility before sending login credentials to the auth service.
    check: () => guarded('access', async () => { await rawRead(); }),
    read: () => guarded('read', async () => {
      const stored = await rawRead();
      if (stored !== null) {
        const auth = session(JSON.parse(stored));
        const legacy = readFile(legacyPath);
        if (legacy !== null) {
          // Complete a migration interrupted after the verified write. Never
          // replace an existing OS session with a stale or unrelated file.
          let matching = false;
          try { matching = JSON.stringify(session(JSON.parse(legacy))) === JSON.stringify(auth); } catch {}
          if (matching && readFile(legacyPath) === legacy) removeFile(legacyPath);
        }
        return auth;
      }
      const legacy = readFile(legacyPath);
      if (legacy === null) return null;
      const auth = session(JSON.parse(legacy));
      await saveVerified(auth);
      // Preserve the original if a concurrent command replaced it during migration.
      if (readFile(legacyPath) !== legacy) throw new Error('Legacy session changed during migration');
      removeFile(legacyPath);
      return auth;
    }),
    write: (auth) => guarded('save', async () => {
      await saveVerified(auth);
      removeFile(legacyPath);
    }),
    delete: () => guarded('delete', async () => {
      if (storage === 'keyring') {
        await (await keyring()).deletePassword();
        if (await rawRead() !== null) throw new Error('Session still exists');
      }
      removeFile(filePath);
      removeFile(legacyPath);
    }),
  };
}
