import fs from 'node:fs';
const filename = process.env.CREDENTIAL_TEST_STORE;
function read() { return fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf8')) : {}; }
function fail(operation) {
  if (process.env.CREDENTIAL_TEST_FAIL === operation) throw new Error('Native error containing dummy-refresh SECRET-MUST-NOT-LEAK');
}
export class AsyncEntry {
  constructor(service, account, options) {
    fail('construct');
    if (service !== 'settle-up-cli' || options.linux.store !== 'secret-service') throw new Error('Unexpected native-store configuration');
    this.key = `${service}:${account}`;
  }
  async getSecret() {
    fail('read');
    if (process.env.CREDENTIAL_TEST_BAD_READBACK) return null;
    const value = read()[this.key];
    return value === undefined ? null : Array.from(Buffer.from(value, 'utf8'));
  }
  async setSecret(value) {
    fail('save');
    const entries = read(); entries[this.key] = Buffer.from(value).toString('utf8');
    fs.writeFileSync(filename, JSON.stringify(entries));
  }
  async deletePassword() {
    fail('delete');
    const entries = read(); const existed = this.key in entries;
    if (!process.env.CREDENTIAL_TEST_DELETE_NOOP) delete entries[this.key];
    fs.writeFileSync(filename, JSON.stringify(entries));
    return existed;
  }
}
