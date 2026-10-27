// Autenticación del panel de administración (sin dependencias externas).
// - La contraseña nunca se guarda en el código: solo su "hash" en una variable de entorno.
// - Al iniciar sesión se entrega un token firmado que caduca solo.
import crypto from 'node:crypto';

const SCRYPT_KEYLEN = 64;

// Genera un hash seguro de una contraseña: scrypt$<sal>$<hash>
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

// Compara una contraseña con el hash guardado
export function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hashHex] = parts;
  const expected = Buffer.from(hashHex, 'hex');
  if (expected.length !== SCRYPT_KEYLEN) return false;
  const actual = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  return crypto.timingSafeEqual(actual, expected);
}

// Crea un token firmado con fecha de caducidad
export function signToken(secret, ttlMs = 12 * 60 * 60 * 1000, now = Date.now()) {
  const expiresAt = now + ttlMs;
  const payload = Buffer.from(JSON.stringify({ exp: expiresAt })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return { token: `${payload}.${signature}`, expiresAt };
}

// Verifica firma y caducidad de un token
export function verifyToken(token, secret, now = Date.now()) {
  if (typeof token !== 'string' || !secret) return false;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
  const [payload, signature] = parts;

  const expected = crypto.createHmac('sha256', secret).update(payload).digest();
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return false;
  }

  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number.isFinite(exp) && now < exp;
  } catch {
    return false;
  }
}

// Límite de intentos fallidos de inicio de sesión (en memoria)
export function createLoginLimiter({ max = 5, windowMs = 15 * 60 * 1000 } = {}) {
  const attempts = new Map(); // clave -> { count, resetAt }

  return {
    isBlocked(key, now = Date.now()) {
      const entry = attempts.get(key);
      if (!entry) return false;
      if (now >= entry.resetAt) {
        attempts.delete(key);
        return false;
      }
      return entry.count >= max;
    },
    registerFailure(key, now = Date.now()) {
      const entry = attempts.get(key);
      if (!entry || now >= entry.resetAt) {
        attempts.set(key, { count: 1, resetAt: now + windowMs });
      } else {
        entry.count += 1;
      }
    },
    reset(key) {
      attempts.delete(key);
    },
  };
}
