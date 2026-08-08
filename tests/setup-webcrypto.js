// Polyfill WebCrypto per Node < 19 (CI gira anche su Node 18).
// jose 6.x usa la build webapi che richiede globalThis.crypto.
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}
