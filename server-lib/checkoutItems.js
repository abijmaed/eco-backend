// Construye los artículos del pago de Stripe usando SIEMPRE los precios del servidor.
// El navegador solo envía qué productos (id) y cuántos (cantidad); nunca el precio.

export const MAX_DIFFERENT_ITEMS = 30;
export const MAX_QUANTITY_PER_ITEM = 20;

export class CheckoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CheckoutError';
  }
}

function imageUrlFor(product, baseUrl) {
  const first = Array.isArray(product.images) ? product.images[0] : null;
  if (typeof first !== 'string' || !first) return null;

  const fileName = first
    .replace(/^\/?public\//, '')
    .replace(/^\/?images\/productos\//, '')
    .replace(/^\/+/, '');

  if (!fileName || !baseUrl) return null;
  return `${baseUrl}/images/productos/${encodeURIComponent(fileName)}`;
}

export function buildLineItems(items, products, baseUrl = '') {
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_DIFFERENT_ITEMS) {
    throw new CheckoutError('Carrito inválido');
  }
  if (!Array.isArray(products)) {
    throw new CheckoutError('No se pudo verificar los productos');
  }

  const byId = new Map(products.map((p) => [String(p.id), p]));

  // Unir líneas repetidas y validar cantidades
  const quantities = new Map();
  for (const item of items) {
    const id = String(item?.id ?? '');
    const quantity = Number(item?.quantity);
    if (!id || !Number.isInteger(quantity) || quantity < 1) {
      throw new CheckoutError('Cantidad inválida');
    }
    quantities.set(id, (quantities.get(id) || 0) + quantity);
  }

  const cleanBase = String(baseUrl || '').replace(/\/+$/, '');
  const lineItems = [];

  for (const [id, quantity] of quantities) {
    if (quantity > MAX_QUANTITY_PER_ITEM) {
      throw new CheckoutError('Cantidad inválida');
    }

    const product = byId.get(id);
    if (!product) {
      throw new CheckoutError('Un producto del carrito ya no está disponible');
    }

    const price = Number(product.price);
    if (!Number.isFinite(price) || price <= 0) {
      throw new CheckoutError('Un producto del carrito no tiene precio válido');
    }

    const productData = { name: String(product.name || 'Producto').slice(0, 200) };
    const imageUrl = imageUrlFor(product, cleanBase);
    if (imageUrl) productData.images = [imageUrl];

    lineItems.push({
      price_data: {
        currency: 'mxn',
        product_data: productData,
        unit_amount: Math.round(price * 100),
      },
      quantity,
    });
  }

  return lineItems;
}
