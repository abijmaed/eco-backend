// Validación de los datos de productos que llegan al servidor.
// Solo se aceptan los campos conocidos; todo lo demás se ignora.

const LIMITS = {
  name: 200,
  description: 5000,
  category: 60,
  maxPrice: 10_000_000,
  maxStock: 100_000,
  maxImages: 20,
  imageLength: 300,
  maxSpecsBytes: 10_000,
};

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Devuelve { ok: true, value } o { ok: false, error }
export function sanitizeProduct(input, { partial = false } = {}) {
  if (!isPlainObject(input)) {
    return { ok: false, error: 'Datos de producto inválidos' };
  }

  const value = {};

  if (input.name !== undefined || !partial) {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name || name.length > LIMITS.name) {
      return { ok: false, error: 'Nombre inválido' };
    }
    value.name = name;
  }

  if (input.price !== undefined || !partial) {
    const price = Number(input.price);
    if (!Number.isFinite(price) || price < 0 || price > LIMITS.maxPrice) {
      return { ok: false, error: 'Precio inválido' };
    }
    value.price = price;
  }

  if (input.description !== undefined) {
    if (typeof input.description !== 'string' || input.description.length > LIMITS.description) {
      return { ok: false, error: 'Descripción inválida' };
    }
    value.description = input.description.trim();
  }

  if (input.category !== undefined) {
    if (typeof input.category !== 'string' || input.category.length > LIMITS.category) {
      return { ok: false, error: 'Categoría inválida' };
    }
    value.category = input.category;
  }

  if (input.stock !== undefined) {
    const stock = Number(input.stock);
    if (!Number.isInteger(stock) || stock < 0 || stock > LIMITS.maxStock) {
      return { ok: false, error: 'Existencias inválidas' };
    }
    value.stock = stock;
  }

  if (input.specs !== undefined) {
    if (!isPlainObject(input.specs) || JSON.stringify(input.specs).length > LIMITS.maxSpecsBytes) {
      return { ok: false, error: 'Especificaciones inválidas' };
    }
    value.specs = input.specs;
  }

  if (input.images !== undefined) {
    if (
      !Array.isArray(input.images) ||
      input.images.length > LIMITS.maxImages ||
      input.images.some((img) => typeof img !== 'string' || img.length > LIMITS.imageLength)
    ) {
      return { ok: false, error: 'Imágenes inválidas' };
    }
    value.images = input.images;
  }

  return { ok: true, value };
}
