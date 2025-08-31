import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import cors from 'cors';
import { fileURLToPath } from 'url';

// Para tener __dirname en ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001; // ✅ Usar variable de entorno

// Middleware
app.use(cors({
  origin: true, // Permitir todos los dominios
  credentials: true
}));
app.use(express.json());

// Ruta del archivo de productos
const productsFile = path.join(__dirname, 'api', 'products-data.json');

// FUNCIÓN PARA LEER PRODUCTOS
async function readProducts() {
  try {
    const data = await fs.readFile(productsFile, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    // Si el archivo no existe, crearlo con array vacío
    await fs.writeFile(productsFile, JSON.stringify([], null, 2));
    return [];
  }
}

// FUNCIÓN PARA GUARDAR PRODUCTOS
async function saveProducts(products) {
  await fs.writeFile(productsFile, JSON.stringify(products, null, 2));
}

// 📦 RUTA: Obtener todos los productos (CON FILTROS)
app.get('/api/products', async (req, res) => {
  try {
    const { category, search } = req.query;
    let products = await readProducts();

    // Filtrar por categoría si se especifica
    if (category) {
      products = products.filter(p => p.category === category);
    }

    // Buscar por término si se especifica
    if (search) {
      const term = search.toLowerCase();
      products = products.filter(p =>
        p.name.toLowerCase().includes(term) ||
        (p.description && p.description.toLowerCase().includes(term))
      );
    }

    res.json(products);
  } catch (error) {
    res.status(500).json({ error: 'Error al leer productos' });
  }
});

// ➕ RUTA: Crear nuevo producto
app.post('/api/products', async (req, res) => {
  try {
    const products = await readProducts();
    const newProduct = {
      id: Date.now().toString(),
      ...req.body,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    products.push(newProduct);
    await saveProducts(products);

    res.status(201).json(newProduct);
  } catch (error) {
    res.status(500).json({ error: 'Error al crear producto' });
  }
});

// ✏️ RUTA: Actualizar producto
app.put('/api/products/:id', async (req, res) => {
  try {
    const products = await readProducts();
    const index = products.findIndex(p => p.id === req.params.id);

    if (index === -1) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    products[index] = {
      ...products[index],
      ...req.body,
      updatedAt: new Date().toISOString()
    };

    await saveProducts(products);
    res.json(products[index]);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar producto' });
  }
});

// 🗑️ RUTA: Eliminar producto
app.delete('/api/products/:id', async (req, res) => {
  try {
    let products = await readProducts();
    const initialLength = products.length;
    
    products = products.filter(p => p.id !== req.params.id);
    
    if (products.length === initialLength) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    await saveProducts(products);
    res.json({ message: 'Producto eliminado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar producto' });
  }
});

// 🔍 RUTA: Buscar productos (endpoint específico)
app.get('/api/products/search', async (req, res) => {
  try {
    const { q } = req.query;
    const products = await readProducts();
    
    if (!q) {
      return res.json(products);
    }

    const filteredProducts = products.filter(product =>
      product.name.toLowerCase().includes(q.toLowerCase()) ||
      (product.description && product.description.toLowerCase().includes(q.toLowerCase()))
    );

    res.json(filteredProducts);
  } catch (error) {
    res.status(500).json({ error: 'Error al buscar productos' });
  }
});

// 🏠 Ruta de prueba
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'ECO API funcionando' });
});

// 🚀 Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 API Server running on port ${PORT}`);
  console.log(`📦 GET: http://localhost:${PORT}/api/products`);
  console.log(`➕ POST: http://localhost:${PORT}/api/products`);
  console.log(`✏️ PUT: http://localhost:${PORT}/api/products/:id`);
  console.log(`🗑️ DELETE: http://localhost:${PORT}/api/products/:id`);
  console.log(`🔍 SEARCH: http://localhost:${PORT}/api/products/search?q=texto`);
  console.log(`🏠 HEALTH: http://localhost:${PORT}/api/health`);
});