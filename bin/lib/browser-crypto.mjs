// Shared by the CLI and website backend. Private keys never leave the CLI.
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));
export async function createLoginKey() {
  const keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return {
    publicKey: b64(await crypto.subtle.exportKey('raw', keys.publicKey)),
    privateKey: await crypto.subtle.exportKey('jwk', keys.privateKey),
  };
}
// ECDH shared secret -> HKDF-SHA-256 -> AES-256-GCM key, bound to the login link.
async function sharedKey(privateKey, publicKey, browserId, usage) {
  const peer = await crypto.subtle.importKey('raw', unb64(publicKey), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secret = await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, privateKey, 256);
  const hkdf = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  const info = new TextEncoder().encode(`settleup-cli browser-login v1 ${browserId}`);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info }, hkdf, { name: 'AES-GCM', length: 256 }, false, [usage]);
}
export async function encryptLogin(session, publicKey, browserId) {
  const keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await sharedKey(keys.privateKey, publicKey, browserId, 'encrypt');
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(browserId) }, key, new TextEncoder().encode(JSON.stringify(session)));
  return { publicKey: b64(await crypto.subtle.exportKey('raw', keys.publicKey)), iv: b64(iv), ciphertext: b64(ciphertext) };
}
export async function decryptLogin(envelope, privateJwk, browserId) {
  const privateKey = await crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const key = await sharedKey(privateKey, envelope.publicKey, browserId, 'decrypt');
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(envelope.iv), additionalData: new TextEncoder().encode(browserId) }, key, unb64(envelope.ciphertext));
  return JSON.parse(new TextDecoder().decode(plaintext));
}
