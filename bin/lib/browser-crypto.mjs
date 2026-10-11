// Shared by the CLI and login page. Private keys never leave the CLI.
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));
export async function createLoginKey() {
  const keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
  return {
    publicKey: b64(await crypto.subtle.exportKey('raw', keys.publicKey)),
    privateKey: await crypto.subtle.exportKey('jwk', keys.privateKey),
  };
}
export async function loginCode(publicKey) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', unb64(publicKey)));
  const code = [...digest.slice(0, 5)].map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}
async function sharedKey(privateKey, publicKey, usage) {
  const peer = await crypto.subtle.importKey('raw', unb64(publicKey), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  return crypto.subtle.deriveKey({ name: 'ECDH', public: peer }, privateKey, { name: 'AES-GCM', length: 256 }, false, [usage]);
}
export async function encryptLogin(session, publicKey, browserId) {
  const keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await sharedKey(keys.privateKey, publicKey, 'encrypt');
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(browserId) }, key, new TextEncoder().encode(JSON.stringify(session)));
  return { publicKey: b64(await crypto.subtle.exportKey('raw', keys.publicKey)), iv: b64(iv), ciphertext: b64(ciphertext) };
}
export async function decryptLogin(envelope, privateJwk, browserId) {
  const privateKey = await crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
  const key = await sharedKey(privateKey, envelope.publicKey, 'decrypt');
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(envelope.iv), additionalData: new TextEncoder().encode(browserId) }, key, unb64(envelope.ciphertext));
  return JSON.parse(new TextDecoder().decode(plaintext));
}
