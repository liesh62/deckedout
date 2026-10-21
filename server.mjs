import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { randomUUID, timingSafeEqual, createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicRoot = resolve(root, 'public');
const dataRoot = resolve(root, 'data');
const port = Number(process.env.PORT || 4173);
const adminToken = process.env.ADMIN_TOKEN || '';
const rzpKeyId = process.env.RAZORPAY_KEY_ID || '';
const rzpKeySecret = process.env.RAZORPAY_KEY_SECRET || '';
const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || '';
const paths = {
  products: resolve(dataRoot, 'products.json'),
  orders: resolve(dataRoot, 'orders.json'),
  settings: resolve(dataRoot, 'settings.json'),
  contacts: resolve(dataRoot, 'contacts.json')
};
const initialProducts = [
  { id: 'nhie', name: 'Never Have I Ever', category: 'Never Have I Ever', description: 'A slightly chaotic game for finding out what your friends have really been up to.', tagline: 'A conversation starter for your next hangout.', prompt: 'LIED ABOUT MY AGE', color: '#c9eafb', price: 499, stock: 0, available: false },
  { id: 'tod', name: 'Truth or Dare', category: 'Truth or Dare', description: 'Questions, challenges, and unexpected moments for your next hangout.', tagline: 'Questions, challenges, unexpected moments.', prompt: 'TRUTH OR DARE', color: '#ded3f3', price: 499, stock: 0, available: false },
  { id: 'bb', name: 'Bestie Bucketlist', category: 'Bestie Bucketlist', description: 'A collection of activities and memories to make with your favourite people.', tagline: 'One Pinky Promise at a Time.', prompt: 'ONE PINKY PROMISE AT A TIME', color: '#f8d8e4', price: 499, stock: 0, available: false }
];
const initialSettings = { shippingFeePaise: null, freeShippingThresholdPaise: null, taxRatePercent: null, country: 'IN', contactEmail: '', policiesReviewed: false };
await mkdir(dataRoot, { recursive: true });
for (const [name, initial] of [['products', initialProducts], ['orders', []], ['settings', initialSettings], ['contacts', []]]) {
  try { await readFile(paths[name]); } catch { await writeFile(paths[name], JSON.stringify(initial, null, 2)); }
}
async function readJson(name) { return JSON.parse(await readFile(paths[name], 'utf8')); }
async function saveJson(name, value) { await writeFile(paths[name], JSON.stringify(value, null, 2)); }
let settlementQueue = Promise.resolve();
function serializeSettlement(action) { const next = settlementQueue.then(action); settlementQueue = next.catch(() => {}); return next; }
function json(res, status, body) { const data = JSON.stringify(body); res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(data), 'cache-control': 'no-store' }); res.end(data); }
async function body(req, limit = 30000) { const parts = []; let size = 0; for await (const chunk of req) { size += chunk.length; if (size > limit) throw Object.assign(new Error('Request body is too large.'), { status: 413 }); parts.push(chunk); } return Buffer.concat(parts); }
async function parsed(req) { const b = await body(req); return b.length ? JSON.parse(b.toString('utf8')) : {}; }
function adminOk(req) {
  if (!adminToken) return false;
  const got = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(got), b = Buffer.from(adminToken);
  return a.length === b.length && timingSafeEqual(a, b);
}
function adminOnly(req, res) { if (!adminToken) { json(res, 503, { error: 'Configure ADMIN_TOKEN on the server first.' }); return false; } if (!adminOk(req)) { json(res, 401, { error: 'Admin access denied.' }); return false; } return true; }
function integer(v, min, max) { return Number.isSafeInteger(v) && v >= min && v <= max; }
function rupToPaise(n) { return Math.round(Number(n) * 100); }
function safeEqualHex(a, b) { try { const x = Buffer.from(a, 'hex'), y = Buffer.from(b, 'hex'); return x.length === y.length && timingSafeEqual(x, y); } catch { return false; } }
async function razorpayOrder(amount, receipt) {
  const auth = Buffer.from(`${rzpKeyId}:${rzpKeySecret}`).toString('base64');
  const response = await fetch('https://api.razorpay.com/v1/orders', { method: 'POST', headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' }, body: JSON.stringify({ amount, currency: 'INR', receipt }) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error?.description || 'Payment provider could not create the order.');
  return result;
}
async function serveStatic(pathname, res) {
  const name = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
  const file = resolve(publicRoot, `.${name}`);
  if (!file.startsWith(publicRoot + sep) && file !== resolve(publicRoot, 'index.html')) return json(res, 403, { error: 'Forbidden.' });
  try {
    const stat = await import('node:fs/promises').then(m => m.stat(file));
    if (!stat.isFile()) return json(res, 404, { error: 'Not found.' });
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'content-type': types[extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': stat.size, 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin' });
    createReadStream(file).pipe(res);
  } catch { json(res, 404, { error: 'Not found.' }); }
}
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (req.method === 'GET' && url.pathname === '/api/products') return json(res, 200, { products: await readJson('products') });
    if (req.method === 'GET' && url.pathname === '/api/public-config') {
      const settings = await readJson('settings');
      return json(res, 200, { paymentReady: Boolean(rzpKeyId && rzpKeySecret && Number.isFinite(settings.shippingFeePaise) && settings.taxRatePercent !== null), keyId: rzpKeyId || null, settings });
    }
    if (req.method === 'POST' && url.pathname === '/api/checkout') {
      if (!rzpKeyId || !rzpKeySecret) return json(res, 503, { error: 'Online payment is not configured yet. No order was placed.' });
      const input = await parsed(req);
      const fields = ['name', 'email', 'phone', 'address', 'city', 'state', 'pin'];
      if (!input.customer || fields.some(k => typeof input.customer[k] !== 'string' || !input.customer[k].trim())) return json(res, 400, { error: 'Complete all required delivery details.' });
      if (!/^\S+@\S+\.\S+$/.test(input.customer.email) || !/^[6-9]\d{9}$/.test(input.customer.phone.replace(/[\s-]/g, '')) || !/^[1-9]\d{5}$/.test(input.customer.pin)) return json(res, 400, { error: 'Check the email, Indian mobile number, and six-digit PIN code.' });
      if (!Array.isArray(input.items) || !input.items.length || input.items.length > 10) return json(res, 400, { error: 'Your bag is empty or contains too many different products.' });
      const [products, settings] = await Promise.all([readJson('products'), readJson('settings')]);
      if (!Number.isFinite(settings.shippingFeePaise) || settings.shippingFeePaise < 0 || !Number.isFinite(settings.taxRatePercent) || settings.taxRatePercent < 0 || !settings.policiesReviewed) return json(res, 503, { error: 'The owner has not completed shipping, tax, and policy setup. No order was placed.' });
      const items = [];
      for (const item of input.items) {
        const p = products.find(x => x.id === item.id);
        if (!p || !p.available || !integer(item.quantity, 1, 20) || item.quantity > p.stock || !integer(p.price, 1, 10000000)) return json(res, 409, { error: `Availability or pricing changed for ${p?.name || 'a product'}. Refresh your bag.` });
        items.push({ productId: p.id, name: p.name, unitPricePaise: rupToPaise(p.price), quantity: item.quantity });
      }
      const subtotalPaise = items.reduce((n, x) => n + x.unitPricePaise * x.quantity, 0);
      const shippingPaise = settings.freeShippingThresholdPaise != null && subtotalPaise >= settings.freeShippingThresholdPaise ? 0 : settings.shippingFeePaise;
      const taxablePaise = subtotalPaise + shippingPaise;
      const taxPaise = Math.round(taxablePaise * settings.taxRatePercent / 100);
      const amountPaise = subtotalPaise + shippingPaise + taxPaise;
      if (!Number.isSafeInteger(amountPaise) || amountPaise < 100) return json(res, 400, { error: 'The order total is below the payment provider minimum.' });
      const id = randomUUID();
      try {
        const paymentOrder = await razorpayOrder(amountPaise, id.replaceAll('-', '').slice(0, 40));
        const orders = await readJson('orders');
        orders.push({ id, createdAt: new Date().toISOString(), status: 'payment_pending', paymentStatus: 'pending', paymentOrderId: paymentOrder.id, paymentId: null, items, subtotalPaise, shippingPaise, taxPaise, amountPaise, customer: input.customer, currency: 'INR' });
        await saveJson('orders', orders);
        return json(res, 201, { orderId: id, razorpayOrderId: paymentOrder.id, amount: amountPaise, currency: 'INR', keyId: rzpKeyId });
      } catch (e) { return json(res, 502, { error: e.message || 'Payment setup failed.' }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/payment/verify') {
      if (!rzpKeySecret) return json(res, 503, { error: 'Payment verification is not configured.' });
      const input = await parsed(req);
      if (!input.orderId || !input.razorpayOrderId || !input.razorpayPaymentId || !input.razorpaySignature) return json(res, 400, { error: 'Payment verification details are incomplete.' });
      const expected = createHmac('sha256', rzpKeySecret).update(`${input.razorpayOrderId}|${input.razorpayPaymentId}`).digest('hex');
      if (!safeEqualHex(expected, input.razorpaySignature)) return json(res, 400, { error: 'Payment could not be verified.' });
      const receipt = await serializeSettlement(async () => {
        const orders = await readJson('orders'); const order = orders.find(x => x.id === input.orderId && x.paymentOrderId === input.razorpayOrderId);
        if (!order) return { error: 'Order not found.', status: 404 };
        if (order.paymentStatus === 'paid') return { orderId: order.id, status: 'paid', paymentStatus: 'paid', amountPaise: order.amountPaise };
        const products = await readJson('products');
        if (order.items.some(i => (products.find(p => p.id === i.productId)?.stock ?? 0) < i.quantity)) return { error: 'Inventory changed while payment was processing. Contact support with order ' + order.id, status: 409 };
        for (const item of order.items) { const p = products.find(x => x.id === item.productId); p.stock -= item.quantity; if (!p.stock) p.available = false; }
        order.paymentStatus = 'paid'; order.status = 'processing'; order.paymentId = input.razorpayPaymentId; order.paidAt = new Date().toISOString();
        await saveJson('products', products); await saveJson('orders', orders);
        return { orderId: order.id, status: order.status, paymentStatus: order.paymentStatus, amountPaise: order.amountPaise };
      });
      return json(res, receipt.status || 200, receipt);
    }
    if (req.method === 'POST' && url.pathname === '/api/payment/webhook') {
      const raw = await body(req); const signature = String(req.headers['x-razorpay-signature'] || '');
      if (!webhookSecret || !safeEqualHex(createHmac('sha256', webhookSecret).update(raw).digest('hex'), signature)) return json(res, 400, { error: 'Webhook signature verification failed.' });
      const event = JSON.parse(raw.toString('utf8'));
      if (event.event === 'payment.captured' || event.event === 'order.paid') {
        const payment = event.payload?.payment?.entity; const paymentOrderId = payment?.order_id || event.payload?.order?.entity?.id;
        if (paymentOrderId) await serializeSettlement(async () => { const orders = await readJson('orders'); const order = orders.find(x => x.paymentOrderId === paymentOrderId); if (order && order.paymentStatus !== 'paid' && payment?.amount === order.amountPaise) { const products = await readJson('products'); if (order.items.every(i => (products.find(p => p.id === i.productId)?.stock ?? 0) >= i.quantity)) { for (const item of order.items) { const p = products.find(x => x.id === item.productId); p.stock -= item.quantity; if (!p.stock) p.available = false; } order.paymentStatus = 'paid'; order.status = 'processing'; order.paymentId = payment?.id || null; order.paidAt = new Date().toISOString(); await saveJson('products', products); await saveJson('orders', orders); } else { order.paymentStatus = 'paid'; order.status = 'inventory_review'; order.paymentId = payment?.id || null; order.paidAt = new Date().toISOString(); await saveJson('orders', orders); } } });
      }
      return json(res, 200, { received: true });
    }
    if (url.pathname.startsWith('/api/admin/')) {
      if (!adminOnly(req, res)) return;
      if (req.method === 'GET' && url.pathname === '/api/admin/products') return json(res, 200, { products: await readJson('products') });
      if (req.method === 'PATCH' && url.pathname.startsWith('/api/admin/products/')) {
        const id = url.pathname.split('/').pop(); const input = await parsed(req); const products = await readJson('products'); const p = products.find(x => x.id === id);
        if (!p) return json(res, 404, { error: 'Product not found.' });
        if (!integer(input.price, 1, 10000000) || !integer(input.stock, 0, 100000) || typeof input.available !== 'boolean') return json(res, 400, { error: 'Provide a whole-number price, stock count, and availability.' });
        p.price = input.price; p.stock = input.stock; p.available = input.available && input.stock > 0; await saveJson('products', products); return json(res, 200, { product: p });
      }
      if (req.method === 'GET' && url.pathname === '/api/admin/orders') return json(res, 200, { orders: await readJson('orders') });
      if (req.method === 'GET' && url.pathname === '/api/admin/contacts') return json(res, 200, { contacts: await readJson('contacts') });
      if (req.method === 'PATCH' && url.pathname.startsWith('/api/admin/orders/')) {
        const id = url.pathname.split('/').pop(); const input = await parsed(req); if (!['inventory_review', 'processing', 'shipped', 'delivered', 'cancelled'].includes(input.status)) return json(res, 400, { error: 'Invalid order status.' });
        const orders = await readJson('orders'); const order = orders.find(x => x.id === id); if (!order) return json(res, 404, { error: 'Order not found.' }); if (input.status === 'cancelled' && order.paymentStatus === 'paid') return json(res, 409, { error: 'This paid order needs a gateway refund before it can be cancelled. Refund workflow is not configured.' }); order.status = input.status; order.updatedAt = new Date().toISOString(); await saveJson('orders', orders); return json(res, 200, { id: order.id, status: order.status });
      }
      if (req.method === 'GET' && url.pathname === '/api/admin/settings') return json(res, 200, { settings: await readJson('settings') });
      if (req.method === 'PUT' && url.pathname === '/api/admin/settings') {
        const input = await parsed(req);
        for (const k of ['shippingFeePaise', 'freeShippingThresholdPaise', 'taxRatePercent']) if (input[k] !== null && (!Number.isFinite(input[k]) || input[k] < 0)) return json(res, 400, { error: `Invalid ${k}.` });
        if (typeof input.contactEmail !== 'string' || typeof input.policiesReviewed !== 'boolean') return json(res, 400, { error: 'Invalid store settings.' });
        const settings = { shippingFeePaise: input.shippingFeePaise, freeShippingThresholdPaise: input.freeShippingThresholdPaise, taxRatePercent: input.taxRatePercent, country: 'IN', contactEmail: input.contactEmail.slice(0, 254), policiesReviewed: input.policiesReviewed };
        await saveJson('settings', settings); return json(res, 200, { settings });
      }
      return json(res, 404, { error: 'Admin endpoint not found.' });
    }
    if (req.method === 'POST' && url.pathname === '/api/contact') {
      const input = await parsed(req); if (![input.name, input.email, input.subject, input.message].every(x => typeof x === 'string' && x.trim()) || !/^\S+@\S+\.\S+$/.test(input.email)) return json(res, 400, { error: 'Complete each contact field with a valid email.' });
      const records = await readJson('contacts'); records.push({ id: randomUUID(), createdAt: new Date().toISOString(), name: input.name.slice(0, 150), email: input.email.slice(0, 254), subject: input.subject.slice(0, 200), message: input.message.slice(0, 5000) }); await saveJson('contacts', records); return json(res, 201, { saved: true, message: 'Your message was received.' });
    }
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'API route not found.' });
    return serveStatic(url.pathname, res);
  } catch (error) { console.error('Request error:', error.message); return json(res, error.status || 500, { error: error.status ? error.message : 'The request could not be completed.' }); }
});
server.listen(port, () => console.log(`Decked Out store listening on http://localhost:${port}`));

