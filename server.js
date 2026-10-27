import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import cors from 'cors';
import { fileURLToPath } from 'url';
import {
  verifyPassword,
  signToken,
  verifyToken,
  createLoginLimiter,
} from './server-lib/adminAuth.js';
import { sanitizeProduct } from './server-lib/productValidation.js';

// Para tener __dirname en ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Railway entrega las peticiones a través de un proxy
app.set('trust proxy', 1);
app.disable('x-powered-by');

// ---------------------------------------------------------------
// CONFIGURACIÓN (variables de entorno en Railway)
//   ADMIN_PASSWORD_HASH  -> hash de la contraseña del panel (ver scripts/)
//   ADMIN_TOKEN_SECRET   -> clave para firmar las sesiones del panel
//   ALLOWED_ORIGINS      -> (opcional) dominios extra permitidos, separados por comas
//   DATA_DIR             -> (opcional) carpeta de un Volume de Railway para guardar productos
// ---------------------------------------------------------------
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;
const ADMIN_TOKEN_SECRET = process.env.ADMIN_TOKEN_SECRET;
const adminConfigured = Boolean(ADMIN_PASSWORD_HASH && ADMIN_TOKEN_SECRET);

const allowedOrigins = [
  'https://www.electric-car-orchestra.com',
  'https://electric-car-orchestra.com',
  'http://localhost:3000',
  'http://localhost:5173',
  ...(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
];
// Vista previa de Vercel (electric-car-orchestra-xxxx.vercel.app)
const allowedOriginPattern = /^https:\/\/electric-car-orchestra[a-z0-9-]*\.vercel\.app$/;

app.use(
  cors({
    origin(origin, callback) {
      // Sin "origin" = llamadas de servidor a servidor (por ejemplo el pago en Vercel)
      const allowed =
        !origin || allowedOrigins.includes(origin) || allowedOriginPattern.test(origin);
      callback(null, allowed);
    },
  })
);
app.use(express.json({ limit: '100kb' }));

// ---------------------------------------------------------------
// ALMACÉN DE PRODUCTOS (archivo JSON)
// ---------------------------------------------------------------
const dataDir = process.env.DATA_DIR || path.join(__dirname, 'api');
const productsFile = path.join(dataDir, 'products-data.json');
const seedFile = path.join(__dirname, 'api', 'products-data.json');

async function writeProducts(products) {
  await fs.mkdir(dataDir, { recursive: true });
  // Escritura segura: se escribe a un archivo temporal y luego se reemplaza
  const tmpFile = `${productsFile}.${process.pid}.tmp`;
  await fs.writeFile(tmpFile, JSON.stringify(products, null, 2));
  await fs.rename(tmpFile, productsFile);
}

async function readProducts() {
  try {
    return JSON.parse(await fs.readFile(productsFile, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      // Archivo dañado: no se sobrescribe con una lista vacía
      throw error;
    }
    // Primer arranque: usar los productos incluidos en el proyecto, si existen
    let initial = [];
    try {
      initial = JSON.parse(await fs.readFile(seedFile, 'utf8'));
    } catch {
      initial = [];
    }
    await writeProducts(initial);
    return initial;
  }
}

// Evita que dos cambios simultáneos se pisen entre sí
let queue = Promise.resolve();
function withLock(task) {
  const run = queue.then(task);
  queue = run.catch(() => {});
  return run;
}

// ---------------------------------------------------------------
// ADMINISTRACIÓN: inicio de sesión y protección de cambios
// ---------------------------------------------------------------
const loginLimiter = createLoginLimiter({ max: 5, windowMs: 15 * 60 * 1000 });

function requireAdmin(req, res, next) {
  if (!adminConfigured) {
    return res.status(503).json({ error: 'La administración no está configurada en el servidor' });
  }
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!verifyToken(token, ADMIN_TOKEN_SECRET)) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  next();
}

app.post('/api/admin/login', (req, res) => {
  if (!adminConfigured) {
    return res.status(503).json({ error: 'La administración no está configurada en el servidor' });
  }

  const key = req.ip;
  if (loginLimiter.isBlocked(key)) {
    return res.status(429).json({ error: 'Demasiados intentos. Inténtalo más tarde.' });
  }

  const password = req.body?.password;
  if (!verifyPassword(password, ADMIN_PASSWORD_HASH)) {
    loginLimiter.registerFailure(key);
    return res.status(401).json({ error: 'Contraseña incorrecta' });
  }

  loginLimiter.reset(key);
  res.json(signToken(ADMIN_TOKEN_SECRET));
});

// ---------------------------------------------------------------
// RUTAS DE PRODUCTOS
// ---------------------------------------------------------------

// 📦 Obtener todos los productos (público)
app.get('/api/products', async (req, res) => {
  const { category, search } = req.query;
  let products = await readProducts();

  if (category) {
    products = products.filter((p) => p.category === category);
  }

  if (search) {
    const term = String(search).toLowerCase();
    products = products.filter(
      (p) =>
        String(p.name).toLowerCase().includes(term) ||
        (p.description && String(p.description).toLowerCase().includes(term))
    );
  }

  res.json(products);
});

// 🔍 Buscar productos (público)
app.get('/api/products/search', async (req, res) => {
  const { q } = req.query;
  const products = await readProducts();

  if (!q) {
    return res.json(products);
  }

  const term = String(q).toLowerCase();
  res.json(
    products.filter(
      (p) =>
        String(p.name).toLowerCase().includes(term) ||
        (p.description && String(p.description).toLowerCase().includes(term))
    )
  );
});

// ➕ Crear producto (solo administrador)
app.post('/api/products', requireAdmin, async (req, res) => {
  const result = sanitizeProduct(req.body);
  if (!result.ok) {
    return res.status(400).json({ error: result.error });
  }

  const newProduct = await withLock(async () => {
    const products = await readProducts();
    const now = new Date().toISOString();
    // Identificador único (evita repetir el mismo número si dos productos se crean al mismo tiempo)
    let id = Date.now();
    while (products.some((p) => String(p.id) === String(id))) id += 1;
    const product = {
      id: String(id),
      description: '',
      category: 'uncategorized',
      stock: 0,
      specs: {},
      images: [],
      ...result.value,
      createdAt: now,
      updatedAt: now,
    };
    products.push(product);
    await writeProducts(products);
    return product;
  });

  res.status(201).json(newProduct);
});

// ✏️ Actualizar producto (solo administrador)
app.put('/api/products/:id', requireAdmin, async (req, res) => {
  const result = sanitizeProduct(req.body, { partial: true });
  if (!result.ok) {
    return res.status(400).json({ error: result.error });
  }

  const updated = await withLock(async () => {
    const products = await readProducts();
    const index = products.findIndex((p) => p.id === req.params.id);
    if (index === -1) return null;

    products[index] = {
      ...products[index],
      ...result.value,
      id: products[index].id,
      updatedAt: new Date().toISOString(),
    };
    await writeProducts(products);
    return products[index];
  });

  if (!updated) {
    return res.status(404).json({ error: 'Producto no encontrado' });
  }
  res.json(updated);
});

// 🗑️ Eliminar producto (solo administrador)
app.delete('/api/products/:id', requireAdmin, async (req, res) => {
  const removed = await withLock(async () => {
    const products = await readProducts();
    const remaining = products.filter((p) => p.id !== req.params.id);
    if (remaining.length === products.length) return false;
    await writeProducts(remaining);
    return true;
  });

  if (!removed) {
    return res.status(404).json({ error: 'Producto no encontrado' });
  }
  res.json({ message: 'Producto eliminado' });
});

// 🏠 Ruta de prueba
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'ECO API funcionando' });
});

// Manejo de errores (sin mostrar detalles internos)
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON inválido' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Datos demasiado grandes' });
  }
  console.error('Error en la API:', err.message);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// 🚀 Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 API Server running on port ${PORT}`);
  if (!adminConfigured) {
    console.warn(
      '⚠️ ADMIN_PASSWORD_HASH y ADMIN_TOKEN_SECRET no están configuradas: ' +
        'las operaciones de administración están bloqueadas.'
    );
  }
});
