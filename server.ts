import express from 'express';
import fs from 'fs';
import path from 'path';
import type { Server } from 'http';
import { fileURLToPath } from 'url';
import {
  adjustProductStock,
  authenticateUser,
  backupDatabase,
  createCustomer,
  createCashbookEntry,
  createProduct,
  createInvoiceNumber,
  createInventoryOption,
  createPurchaseEntry,
  createSale,
  createSaleReturn,
  createSalesReturnVoucher,
  deleteSalesReturnVoucher,
  createUser,
  createVendor,
  deleteCustomer,
  deleteProduct,
  deleteInventoryOption,
  deletePurchase,
  deleteSale,
  deleteUser,
  deleteVendor,
  flushPrintQueue,
  getDb,
  getCashbookData,
  getSettings,
  importProducts,
  listCustomers,
  listPrintQueue,
  listProducts,
  listInventoryOptions,
  listPurchases,
  listSales,
  listSalesReturnVouchers,
  listUsers,
  listVendors,
  resetDatabase,
  restoreDatabase,
  updateCustomer,
  updateProduct,
  updateInventoryOption,
  updatePurchase,
  updateSale,
  updateSaleInvoice,
  updateSalesReturnVoucher,
  updateSettings,
  updateUser,
  updateVendor,
  voidSale,
  setCashbookOpeningBalance,
} from './server/db';

const translationCache = new Map<string, string>();
const inFlightTranslations = new Map<string, Promise<string>>();

class TranslationProviderError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'TranslationProviderError';
  }
}

async function fetchTranslation(url: string, provider: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new TranslationProviderError(`${provider} returned HTTP ${response.status}.`, response.status);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function translateEnglishToArabic(text: string): Promise<string> {
  const cacheKey = text.toLocaleLowerCase('en');
  const cached = translationCache.get(cacheKey);
  if (cached) return cached;

  const pending = inFlightTranslations.get(cacheKey);
  if (pending) return pending;

  const request = (async () => {
    let googleError: unknown;
    try {
      const googleUrl = new URL('https://translate.googleapis.com/translate_a/single');
      googleUrl.search = new URLSearchParams({
        client: 'gtx',
        sl: 'en',
        tl: 'ar',
        dt: 't',
        q: text,
      }).toString();
      const payload: unknown = await fetchTranslation(googleUrl.toString(), 'Google Translate');
      const segments =
        Array.isArray(payload) && Array.isArray(payload[0]) ? payload[0] : [];
      const translation = segments
        .map((segment: unknown) =>
          Array.isArray(segment) && typeof segment[0] === 'string' ? segment[0] : ''
        )
        .join('')
        .trim();
      if (!translation) throw new TranslationProviderError('Google Translate returned no Arabic text.');
      return translation;
    } catch (error) {
      googleError = error;
    }

    try {
      const backupUrl = new URL('https://api.mymemory.translated.net/get');
      backupUrl.search = new URLSearchParams({ q: text, langpair: 'en|ar' }).toString();
      const payload = await fetchTranslation(backupUrl.toString(), 'Backup translation service') as {
        responseStatus?: number;
        responseData?: { translatedText?: string };
      };
      const translation = payload.responseData?.translatedText?.trim();
      if (!translation || (payload.responseStatus !== undefined && payload.responseStatus >= 400)) {
        throw new TranslationProviderError(
          'Backup translation service returned no Arabic text.',
          payload.responseStatus
        );
      }
      return translation;
    } catch (backupError) {
      const googleStatus = googleError instanceof TranslationProviderError ? googleError.status : undefined;
      const backupStatus = backupError instanceof TranslationProviderError ? backupError.status : undefined;
      if (googleStatus === 429 || backupStatus === 429) {
        throw new TranslationProviderError(
          'Translation services are rate-limited. Please wait a moment and try again.',
          429
        );
      }
      throw new TranslationProviderError(
        'Arabic translation is temporarily unavailable. Check your connection and try again.'
      );
    }
  })();

  inFlightTranslations.set(cacheKey, request);
  try {
    const translation = await request;
    translationCache.set(cacheKey, translation);
    if (translationCache.size > 1000) {
      const oldestKey = translationCache.keys().next().value;
      if (oldestKey !== undefined) translationCache.delete(oldestKey);
    }
    return translation;
  } finally {
    inFlightTranslations.delete(cacheKey);
  }
}

async function startServer(): Promise<Server> {
  await getDb();

  const app = express();
  const port = Number(process.env.POS_PORT || 3000);
  const host = process.env.POS_HOST || '0.0.0.0';
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid POS_PORT value: ${process.env.POS_PORT}`);
  }

  app.use(express.json({ limit: '50mb' }));
  app.use(express.raw({ type: 'application/octet-stream', limit: '100mb' }));
  if (process.env.NODE_ENV === 'production') {
    app.use((_req, res, next) => {
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
      );
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      next();
    });
  }

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, engine: 'sqlite' });
  });

  app.post('/api/login', async (req, res) => {
    try {
      const { username, password } = req.body || {};
      if (!username || !password) {
        res.status(400).json({ error: 'Username and password are required.' });
        return;
      }
      const user = await authenticateUser(String(username), String(password));
      if (!user) {
        res.status(401).json({ error: 'Invalid username or password.' });
        return;
      }
      res.json({ ok: true, user });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/users', async (_req, res) => {
    try {
      const users = await listUsers();
      res.json(users);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/users', async (req, res) => {
    try {
      const user = await createUser(req.body);
      res.status(201).json(user);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.put('/api/users/:id', async (req, res) => {
    try {
      const user = await updateUser(Number(req.params.id), req.body);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      res.json(user);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.delete('/api/users/:id', async (req, res) => {
    try {
      await deleteUser(Number(req.params.id));
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.get('/api/inventory-options', async (_req, res) => {
    try {
      res.json(await listInventoryOptions());
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/translate/ar', async (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text || text.length > 300) {
      res.status(400).json({ error: 'Enter text up to 300 characters to translate.' });
      return;
    }

    try {
      res.json({ translation: await translateEnglishToArabic(text) });
    } catch (error) {
      console.error('Arabic translation request failed:', error);
      res.status(error instanceof TranslationProviderError && error.status === 429 ? 429 : 502).json({
        error: (error as Error).message,
      });
    }
  });

  app.post('/api/inventory-options', async (req, res) => {
    try {
      res.status(201).json(await createInventoryOption(req.body || {}));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.put('/api/inventory-options/:id', async (req, res) => {
    try {
      const option = await updateInventoryOption(Number(req.params.id), req.body || {});
      if (!option) {
        res.status(404).json({ error: 'Inventory option not found.' });
        return;
      }
      res.json(option);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.delete('/api/inventory-options/:id', async (req, res) => {
    try {
      await deleteInventoryOption(Number(req.params.id));
      res.json({ deleted: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.get('/api/products', async (req, res) => {
    try {
      const products = await listProducts({
        search: req.query.search as string | undefined,
        category: req.query.category as string | undefined,
        stockStatus: req.query.stockStatus as string | undefined,
      });
      res.json(products);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/products', async (req, res) => {
    try {
      const product = await createProduct(req.body);
      res.status(201).json(product);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/products/import', async (req, res) => {
    try {
      const items = Array.isArray(req.body?.items) ? req.body.items : (Array.isArray(req.body) ? req.body : []);
      if (!items || items.length === 0) {
        res.status(400).json({ error: 'No product rows provided for import.' });
        return;
      }
      const result = await importProducts(items);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.put('/api/products/:id', async (req, res) => {
    try {
      const updated = await updateProduct(Number(req.params.id), req.body);
      if (!updated) {
        res.status(404).json({ error: 'Product not found' });
        return;
      }
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.patch('/api/products/:id/stock', async (req, res) => {
    try {
      const delta = Number(req.body.delta ?? 0);
      const updated = await adjustProductStock(Number(req.params.id), delta);
      if (!updated) {
        res.status(404).json({ error: 'Product not found' });
        return;
      }
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.delete('/api/products/:id', async (req, res) => {
    try {
      const deleted = await deleteProduct(Number(req.params.id));
      if (!deleted) {
        res.status(404).json({ error: 'Product not found' });
        return;
      }
      res.json({ deleted: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.get('/api/sales', async (_req, res) => {
    try {
      const sales = await listSales();
      res.json(sales);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/sales-returns', async (_req, res) => {
    try {
      res.json(await listSalesReturnVouchers());
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/cashbook', async (_req, res) => {
    try {
      res.json(await getCashbookData());
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/cashbook/entries', async (req, res) => {
    try {
      const entry = await createCashbookEntry(req.body);
      res.status(201).json(entry);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.put('/api/cashbook/opening-balance', async (req, res) => {
    try {
      const openingBalance = await setCashbookOpeningBalance(req.body);
      res.json(openingBalance);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/sales', async (req, res) => {
    try {
      const result = await createSale(req.body);
      res.status(201).json(result);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/invoice-numbers', async (_req, res) => {
    try {
      res.status(201).json({ invoiceNumber: await createInvoiceNumber() });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/sales/:id/returns', async (req, res) => {
    try {
      const result = await createSaleReturn(Number(req.params.id), req.body);
      if (!result) {
        res.status(404).json({ error: 'Sale not found' });
        return;
      }
      res.status(201).json(result);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/sales-returns', async (req, res) => {
    try {
      const result = await createSalesReturnVoucher(req.body);
      if (!result) {
        res.status(404).json({ error: 'Sales invoices not found' });
        return;
      }
      res.status(201).json(result);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.put('/api/sales-returns/:id', async (req, res) => {
    try {
      const result = await updateSalesReturnVoucher(Number(req.params.id), req.body);
      if (!result) {
        res.status(404).json({ error: 'Sales return voucher not found' });
        return;
      }
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.delete('/api/sales-returns/:id', async (req, res) => {
    try {
      const deleted = await deleteSalesReturnVoucher(Number(req.params.id));
      if (!deleted) {
        res.status(404).json({ error: 'Sales return voucher not found' });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/sales/:id/void', async (req, res) => {
    try {
      const updated = await voidSale(Number(req.params.id));
      if (!updated) {
        res.status(404).json({ error: 'Sale not found' });
        return;
      }
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.put('/api/sales/:id', async (req, res) => {
    try {
      const updated = await updateSale(Number(req.params.id), req.body);
      if (!updated) {
        res.status(404).json({ error: 'Sale not found' });
        return;
      }
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.put('/api/sales/:id/invoice', async (req, res) => {
    try {
      const updated = await updateSaleInvoice(Number(req.params.id), req.body);
      if (!updated) {
        res.status(404).json({ error: 'Sale not found' });
        return;
      }
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.delete('/api/sales/:id', async (req, res) => {
    try {
      const deleted = await deleteSale(Number(req.params.id));
      if (!deleted) {
        res.status(404).json({ error: 'Sale not found' });
        return;
      }
      res.json({ deleted: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.get('/api/settings', async (_req, res) => {
    try {
      const settings = await getSettings();
      res.json(settings);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.put('/api/settings', async (req, res) => {
    try {
      const settings = await updateSettings(req.body);
      res.json(settings);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.get('/api/print-queue', async (_req, res) => {
    try {
      const queue = await listPrintQueue();
      res.json(queue);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/print-queue/flush', async (_req, res) => {
    try {
      await flushPrintQueue();
      res.json({ flushed: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ----------------- CUSTOMERS API -----------------
  app.get('/api/customers', async (req, res) => {
    try {
      const customers = await listCustomers(req.query.search as string | undefined);
      res.json(customers);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/customers', async (req, res) => {
    try {
      const customer = await createCustomer(req.body);
      res.status(201).json(customer);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.put('/api/customers/:id', async (req, res) => {
    try {
      const updated = await updateCustomer(Number(req.params.id), req.body);
      if (!updated) {
        res.status(404).json({ error: 'Customer not found' });
        return;
      }
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.delete('/api/customers/:id', async (req, res) => {
    try {
      await deleteCustomer(Number(req.params.id));
      res.json({ deleted: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // ----------------- VENDORS API -----------------
  app.get('/api/vendors', async (req, res) => {
    try {
      const vendors = await listVendors(req.query.search as string | undefined);
      res.json(vendors);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/vendors', async (req, res) => {
    try {
      const vendor = await createVendor(req.body);
      res.status(201).json(vendor);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.put('/api/vendors/:id', async (req, res) => {
    try {
      const updated = await updateVendor(Number(req.params.id), req.body);
      if (!updated) {
        res.status(404).json({ error: 'Vendor not found' });
        return;
      }
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.delete('/api/vendors/:id', async (req, res) => {
    try {
      await deleteVendor(Number(req.params.id));
      res.json({ deleted: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // ----------------- PURCHASES API -----------------
  app.get('/api/purchases', async (_req, res) => {
    try {
      const purchases = await listPurchases();
      res.json(purchases);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/purchases', async (req, res) => {
    try {
      const purchase = await createPurchaseEntry(req.body);
      res.status(201).json(purchase);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.put('/api/purchases/:id', async (req, res) => {
    try {
      const updated = await updatePurchase(Number(req.params.id), req.body);
      if (!updated) {
        res.status(404).json({ error: 'Purchase entry not found' });
        return;
      }
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.delete('/api/purchases/:id', async (req, res) => {
    try {
      const deleted = await deletePurchase(Number(req.params.id));
      if (!deleted) {
        res.status(404).json({ error: 'Purchase entry not found' });
        return;
      }
      res.json({ deleted: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // ----------------- DATABASE MAINTENANCE & BACKUP -----------------
  app.post('/api/database/reset', async (_req, res) => {
    try {
      await resetDatabase();
      res.json({ ok: true, message: 'Database reset and re-seeded successfully.' });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/database/backup', async (_req, res) => {
    try {
      const buffer = await backupDatabase();
      const dateStr = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'application/x-sqlite3');
      res.setHeader('Content-Disposition', `attachment; filename="aptpos-backup-${dateStr}.sqlite"`);
      res.send(buffer);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/database/restore', async (req, res) => {
    try {
      let fileBuffer: Buffer | null = null;
      if (Buffer.isBuffer(req.body)) {
        fileBuffer = req.body;
      } else if (req.body?.base64) {
        fileBuffer = Buffer.from(req.body.base64, 'base64');
      } else if (typeof req.body === 'string') {
        fileBuffer = Buffer.from(req.body, 'base64');
      }

      if (!fileBuffer || fileBuffer.length === 0) {
        res.status(400).json({ error: 'No database backup file provided.' });
        return;
      }

      await restoreDatabase(fileBuffer);
      res.json({ ok: true, message: 'Database restored successfully.' });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const candidateDistPaths = [
      process.env.DIST_PATH,
      path.resolve(__dirname, '..', 'dist'),
      path.resolve(__dirname, 'dist'),
      path.resolve(process.cwd(), 'dist'),
    ].filter(Boolean) as string[];

    const distPath = candidateDistPaths.find((p) => fs.existsSync(p)) || path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(port, host, () => {
    console.log(`aptPOS server running on http://${host}:${port}`);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  return server;
}

export { startServer };

if (process.env.POS_SERVER_AUTOSTART !== 'false') {
  void startServer().catch((error: unknown) => {
    console.error('Failed to start the aptPOS server:', error);
    process.exitCode = 1;
  });
}
