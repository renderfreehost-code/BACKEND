import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { createStore } from "./store.js";
import { convertUsd, roundMoney } from "./currency.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PUBLIC_DIR = path.resolve(process.env.FRONTEND_DIR || path.join(ROOT, "..", "frontend", "public"));
const PORT = Number(process.env.PORT || 3000);
const TOKEN_SECRET = process.env.TOKEN_SECRET || "dev-change-this-panel-marketplace-secret";
const DEFAULT_ADMIN_PASSWORD = "Admin@12345";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function sign(payload) {
  return crypto.createHmac("sha256", TOKEN_SECRET).update(payload).digest("base64url");
}

function issueToken(user) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      sub: user.id,
      email: user.email,
      role: user.role,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7
    })
  );
  const body = `${header}.${payload}`;
  return `${body}.${sign(body)}`;
}

function verifyToken(token) {
  if (!token || !token.includes(".")) return null;
  const [header, payload, signature] = token.split(".");
  const body = `${header}.${payload}`;
  if (sign(body) !== signature) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (parsed.exp && parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${derived}`;
}

function verifyPassword(password, passwordHash) {
  if (!passwordHash?.startsWith("scrypt:")) return false;
  const [, salt, saved] = passwordHash.split(":");
  const derived = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(Buffer.from(saved, "hex"), derived);
}

function isGmailAddress(email) {
  return /^[^\s@]+@gmail\.com$/i.test(String(email || ""));
}

function withoutSecretUser(user) {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  return safe;
}

function publicProduct(product) {
  return {
    ...product,
    variants: (product.variants || []).map(({ stockKeys, ...variant }) => ({
      ...variant,
      stockCount: Array.isArray(stockKeys) ? stockKeys.length : 0
    }))
  };
}

function publicData(data) {
  const sections = data.sections.filter((section) => section.enabled).sort((a, b) => a.sortOrder - b.sortOrder);
  const products = data.products.filter((product) => product.enabled).map(publicProduct);
  return {
    updatedAt: data.updatedAt,
    settings: {
      ...data.settings,
      googleClientId: process.env.GOOGLE_CLIENT_ID || data.settings.googleClientId || ""
    },
    paymentMethods: data.paymentMethods.filter((method) => method.enabled),
    sections,
    products
  };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function sendText(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 10 * 1024 * 1024) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function getBearer(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

async function getUser(req, store) {
  const payload = verifyToken(getBearer(req));
  if (!payload) return null;
  const data = await store.read();
  return data.users.find((user) => user.id === payload.sub) || null;
}

async function requireUser(req, res, store) {
  const user = await getUser(req, store);
  if (!user) {
    sendError(res, 401, "Login required");
    return null;
  }
  return user;
}

async function requireAdmin(req, res, store) {
  const user = await requireUser(req, res, store);
  if (!user) return null;
  if (user.role !== "admin") {
    sendError(res, 403, "Admin access required");
    return null;
  }
  return user;
}

function routeParams(pattern, pathname) {
  const names = [];
  const regex = new RegExp(`^${pattern.replace(/:[^/]+/g, (match) => {
    names.push(match.slice(1));
    return "([^/]+)";
  })}$`);
  const match = pathname.match(regex);
  if (!match) return null;
  return Object.fromEntries(names.map((name, index) => [name, decodeURIComponent(match[index + 1])]));
}

function makeSlug(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || crypto.randomUUID();
}

function normalizeProduct(product, existing = {}) {
  const existingVariants = Array.isArray(existing.variants) ? existing.variants : [];
  return {
    id: existing.id || product.id || crypto.randomUUID(),
    sectionId: product.sectionId || existing.sectionId,
    name: String(product.name || existing.name || "Untitled product").trim(),
    panelName: String(product.panelName || existing.panelName || "").trim(),
    shortDescription: String(product.shortDescription || existing.shortDescription || "").trim(),
    image: String(product.image || existing.image || "").trim(),
    demoVideoUrl: String(product.demoVideoUrl || existing.demoVideoUrl || "").trim(),
    badge: String(product.badge || existing.badge || "").trim(),
    enabled: product.enabled ?? existing.enabled ?? true,
    features: Array.isArray(product.features) ? product.features.filter(Boolean) : existing.features || [],
    variants: Array.isArray(product.variants)
      ? product.variants.map((variant) => {
          const matched = existingVariants.find((item) => item.id === variant.id)
            || existingVariants.find((item) => item.name?.toLowerCase() === String(variant.name || "").trim().toLowerCase());
          return {
            id: matched?.id || variant.id || crypto.randomUUID(),
            name: String(variant.name || "Variant").trim(),
            priceUsd: roundMoney(variant.priceUsd),
            durationDays: Number(variant.durationDays !== undefined ? variant.durationDays : matched?.durationDays || 0),
            description: String(variant.description || "").trim(),
            stockKeys: Array.isArray(variant.stockKeys)
              ? variant.stockKeys.map((key) => String(key).trim()).filter(Boolean)
              : matched?.stockKeys || []
          };
        })
      : existing.variants || []
  };
}

function normalizeSection(section, existing = {}) {
  return {
    id: existing.id || section.id || crypto.randomUUID(),
    title: String(section.title || existing.title || "New section").trim(),
    subtitle: String(section.subtitle || existing.subtitle || "").trim(),
    image: String(section.image || existing.image || "").trim(),
    enabled: section.enabled ?? existing.enabled ?? true,
    sortOrder: Number(section.sortOrder ?? existing.sortOrder ?? 99)
  };
}

function normalizeSettings(settings, existing) {
  return {
    ...existing,
    siteName: String(settings.siteName ?? existing.siteName ?? "").trim(),
    logoText: String(settings.logoText ?? existing.logoText ?? "").trim(),
    logoUrl: String(settings.logoUrl ?? existing.logoUrl ?? "").trim(),
    heroTitle: String(settings.heroTitle ?? existing.heroTitle ?? "").trim(),
    heroSubtitle: String(settings.heroSubtitle ?? existing.heroSubtitle ?? "").trim(),
    introAnimation: Boolean(settings.introAnimation),
    backgroundImage: String(settings.backgroundImage ?? existing.backgroundImage ?? "").trim(),
    heroIntervalSeconds: Math.max(3, Math.min(30, Number(settings.heroIntervalSeconds || existing.heroIntervalSeconds || 6))),
    heroSlides: Array.isArray(settings.heroSlides)
      ? settings.heroSlides.map((slide) => ({
          id: slide.id || crypto.randomUUID(),
          image: String(slide.image || "").trim(),
          title: String(slide.title || "").trim(),
          subtitle: String(slide.subtitle || "").trim()
        })).filter((slide) => slide.image)
      : existing.heroSlides || [],
    supportWhatsApp: String(settings.supportWhatsApp ?? existing.supportWhatsApp ?? "").trim(),
    supportTelegram: String(settings.supportTelegram ?? existing.supportTelegram ?? "").trim(),
    googleClientId: String(settings.googleClientId ?? existing.googleClientId ?? "").trim(),
    currencyRates: {
      BDT: Number(settings.currencyRates?.BDT || existing.currencyRates?.BDT || 118),
      INR: Number(settings.currencyRates?.INR || existing.currencyRates?.INR || 84)
    },
    overviewBadges: Array.isArray(settings.overviewBadges)
      ? settings.overviewBadges.map((badge) => ({
          id: badge.id || crypto.randomUUID(),
          name: String(badge.name || "").trim(),
          image: String(badge.image || "").trim()
        })).filter((badge) => badge.name)
      : existing.overviewBadges || []
  };
}

async function verifyGoogleCredential(credential) {
  if (!credential) throw new Error("Missing Google credential");
  const clientId = process.env.GOOGLE_CLIENT_ID;

  if (clientId) {
    const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
    if (!response.ok) throw new Error("Google token verification failed");
    const info = await response.json();
    if (info.aud !== clientId) throw new Error("Google audience mismatch");
    if (String(info.email_verified) !== "true") throw new Error("Google email is not verified");
    return {
      email: info.email,
      name: info.name || info.email,
      avatar: info.picture || ""
    };
  }

  const [, payload] = credential.split(".");
  if (!payload) throw new Error("Invalid Google credential");
  const info = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (!info.email) throw new Error("Google credential missing email");
  return {
    email: info.email,
    name: info.name || info.email,
    avatar: info.picture || ""
  };
}

async function handleApi(req, res, store, pathname) {
  const method = req.method;

  if (method === "GET" && pathname === "/api/health") {
    return sendJson(res, 200, {
      ok: true,
      service: "panel-marketplace-backend",
      time: new Date().toISOString()
    });
  }

  if (method === "GET" && pathname === "/api/bootstrap") {
    const data = await store.read();
    const user = await getUser(req, store);
    return sendJson(res, 200, { ...publicData(data), user: withoutSecretUser(user) });
  }

  if (method === "POST" && pathname === "/api/auth/register") {
    const body = await readBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const name = String(body.name || "").trim() || email.split("@")[0];
    if (!isGmailAddress(email)) return sendError(res, 400, "Use your own Gmail address, for example name@gmail.com");
    if (password.length < 6) return sendError(res, 400, "Create a 6+ character site password");
    const result = await store.update((data) => {
      if (data.users.some((user) => user.email.toLowerCase() === email)) throw new Error("Email already registered");
      const user = {
        id: crypto.randomUUID(),
        name,
        email,
        role: "user",
        passwordHash: hashPassword(password),
        balanceUsd: 0,
        provider: "password",
        avatar: "",
        createdAt: new Date().toISOString(),
        history: []
      };
      data.users.push(user);
      return user;
    }).catch((error) => ({ error: error.message }));
    if (result.error) return sendError(res, 409, result.error);
    return sendJson(res, 201, { token: issueToken(result), user: withoutSecretUser(result) });
  }

  if (method === "POST" && pathname === "/api/auth/login") {
    const body = await readBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    const data = await store.read();
    const user = data.users.find((item) => item.email.toLowerCase() === email);
    if (!user || !verifyPassword(String(body.password || ""), user.passwordHash)) {
      return sendError(res, 401, "Invalid email or password");
    }
    return sendJson(res, 200, { token: issueToken(user), user: withoutSecretUser(user) });
  }

  if (method === "POST" && pathname === "/api/auth/google") {
    try {
      const body = await readBody(req);
      const googleUser = await verifyGoogleCredential(body.credential);
      if (!isGmailAddress(googleUser.email)) {
        return sendError(res, 400, "Please login with a personal Gmail account");
      }
      const user = await store.update((data) => {
        const email = googleUser.email.toLowerCase();
        let record = data.users.find((item) => item.email.toLowerCase() === email);
        if (!record) {
          record = {
            id: crypto.randomUUID(),
            name: googleUser.name,
            email,
            role: "user",
            passwordHash: "",
            balanceUsd: 0,
            provider: "google",
            avatar: googleUser.avatar,
            createdAt: new Date().toISOString(),
            history: []
          };
          data.users.push(record);
        } else {
          record.name = record.name || googleUser.name;
          record.avatar = googleUser.avatar || record.avatar;
          record.provider = record.provider === "password" ? "password,google" : record.provider;
        }
        return record;
      });
      return sendJson(res, 200, { token: issueToken(user), user: withoutSecretUser(user) });
    } catch (error) {
      return sendError(res, 401, error.message);
    }
  }

  if (method === "GET" && pathname === "/api/me") {
    const user = await requireUser(req, res, store);
    if (!user) return;
    const data = await store.read();
    const orders = data.orders.filter((order) => order.userId === user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return sendJson(res, 200, { user: withoutSecretUser(user), orders });
  }

  if (method === "POST" && pathname === "/api/orders") {
    const user = await requireUser(req, res, store);
    if (!user) return;
    const body = await readBody(req);
    const quantity = Math.max(1, Number(body.quantity || 1));
    const result = await store.update((data) => {
      const product = data.products.find((item) => item.id === body.productId && item.enabled);
      if (!product) throw new Error("Product not found");
      const variant = product.variants.find((item) => item.id === body.variantId);
      if (!variant) throw new Error("Variant not found");
      const method = data.paymentMethods.find((item) => item.id === body.paymentMethodId && item.enabled);
      if (!method) throw new Error("Payment method not found");
      const totalUsd = roundMoney(Number(variant.priceUsd) * quantity);
      const converted = convertUsd(totalUsd, method, data.settings.currencyRates);
      const order = {
        id: crypto.randomUUID(),
        userId: user.id,
        userEmail: user.email,
        productId: product.id,
        productName: product.name,
        variantId: variant.id,
        variantName: variant.name,
        quantity,
        unitUsd: Number(variant.priceUsd),
        totalUsd,
        currency: converted.currency,
        exchangeRate: converted.exchangeRate,
        totalLocal: converted.amount,
        paymentMethodId: method.id,
        paymentMethodName: method.name,
        transactionId: String(body.transactionId || "").trim(),
        contact: String(body.contact || "").trim(),
        status: "pending",
        adminNote: "",
        createdAt: new Date().toISOString()
      };
      data.orders.push(order);
      return order;
    }).catch((error) => ({ error: error.message }));
    if (result.error) return sendError(res, 400, result.error);
    return sendJson(res, 201, { order: result });
  }

  if (method === "GET" && pathname === "/api/admin/dashboard") {
    const admin = await requireAdmin(req, res, store);
    if (!admin) return;
    const data = await store.read();
    return sendJson(res, 200, {
      ...data,
      users: data.users.map(withoutSecretUser),
      defaultCredentials: {
        adminEmail: "admin@example.com",
        adminPassword: DEFAULT_ADMIN_PASSWORD
      }
    });
  }

  if (method === "PUT" && pathname === "/api/admin/settings") {
    const admin = await requireAdmin(req, res, store);
    if (!admin) return;
    const body = await readBody(req);
    const settings = await store.update((data) => {
      data.settings = normalizeSettings(body, data.settings);
      return data.settings;
    });
    return sendJson(res, 200, { settings });
  }

  if (method === "PUT" && pathname === "/api/admin/payment-methods") {
    const admin = await requireAdmin(req, res, store);
    if (!admin) return;
    const body = await readBody(req);
    const methods = Array.isArray(body.paymentMethods) ? body.paymentMethods : [];
    const saved = await store.update((data) => {
      data.paymentMethods = methods.map((method) => ({
        id: String(method.id || makeSlug(method.name)).trim(),
        name: String(method.name || "").trim(),
        currency: String(method.currency || "USD").trim().toUpperCase(),
        rateKey: String(method.rateKey || method.currency || "USD").trim().toUpperCase(),
        account: String(method.account || "").trim(),
        instructions: String(method.instructions || "").trim(),
        enabled: Boolean(method.enabled)
      })).filter((method) => method.id && method.name);
      return data.paymentMethods;
    });
    return sendJson(res, 200, { paymentMethods: saved });
  }

  if (method === "POST" && pathname === "/api/admin/sections") {
    const admin = await requireAdmin(req, res, store);
    if (!admin) return;
    const body = await readBody(req);
    const section = await store.update((data) => {
      const saved = normalizeSection(body);
      data.sections.push(saved);
      return saved;
    });
    return sendJson(res, 201, { section });
  }

  const sectionUpdate = routeParams("/api/admin/sections/:id", pathname);
  if (sectionUpdate && method === "PUT") {
    const admin = await requireAdmin(req, res, store);
    if (!admin) return;
    const body = await readBody(req);
    const section = await store.update((data) => {
      const index = data.sections.findIndex((item) => item.id === sectionUpdate.id);
      if (index < 0) throw new Error("Section not found");
      data.sections[index] = normalizeSection(body, data.sections[index]);
      return data.sections[index];
    }).catch((error) => ({ error: error.message }));
    if (section.error) return sendError(res, 404, section.error);
    return sendJson(res, 200, { section });
  }

  if (sectionUpdate && method === "DELETE") {
    const admin = await requireAdmin(req, res, store);
    if (!admin) return;
    await store.update((data) => {
      data.sections = data.sections.filter((item) => item.id !== sectionUpdate.id);
      data.products = data.products.filter((item) => item.sectionId !== sectionUpdate.id);
    });
    return sendJson(res, 200, { ok: true });
  }

  if (method === "POST" && pathname === "/api/admin/products") {
    const admin = await requireAdmin(req, res, store);
    if (!admin) return;
    const body = await readBody(req);
    const product = await store.update((data) => {
      const saved = normalizeProduct(body);
      data.products.push(saved);
      return saved;
    });
    return sendJson(res, 201, { product });
  }

  const productUpdate = routeParams("/api/admin/products/:id", pathname);
  if (productUpdate && method === "PUT") {
    const admin = await requireAdmin(req, res, store);
    if (!admin) return;
    const body = await readBody(req);
    const product = await store.update((data) => {
      const index = data.products.findIndex((item) => item.id === productUpdate.id);
      if (index < 0) throw new Error("Product not found");
      data.products[index] = normalizeProduct(body, data.products[index]);
      return data.products[index];
    }).catch((error) => ({ error: error.message }));
    if (product.error) return sendError(res, 404, product.error);
    return sendJson(res, 200, { product });
  }

  if (productUpdate && method === "DELETE") {
    const admin = await requireAdmin(req, res, store);
    if (!admin) return;
    await store.update((data) => {
      data.products = data.products.filter((item) => item.id !== productUpdate.id);
    });
    return sendJson(res, 200, { ok: true });
  }

  const orderUpdate = routeParams("/api/admin/orders/:id", pathname);
  if (orderUpdate && method === "PUT") {
    const admin = await requireAdmin(req, res, store);
    if (!admin) return;
    const body = await readBody(req);
    const order = await store.update((data) => {
      const saved = data.orders.find((item) => item.id === orderUpdate.id);
      if (!saved) throw new Error("Order not found");
      saved.status = ["pending", "approved", "rejected"].includes(body.status) ? body.status : saved.status;
      saved.adminNote = String(body.adminNote ?? saved.adminNote ?? "").trim();
      saved.reviewedAt = new Date().toISOString();
      if (saved.status === "approved" && !saved.approvedBalanceApplied) {
        const product = data.products.find((item) => item.id === saved.productId);
        const variant = product?.variants?.find((item) => item.id === saved.variantId);
        if (variant && !saved.deliveredKeys?.length && Array.isArray(variant.stockKeys) && variant.stockKeys.length) {
          saved.deliveredKeys = variant.stockKeys.splice(0, saved.quantity);
        }
        const user = data.users.find((item) => item.id === saved.userId);
        if (user) {
          user.history = user.history || [];
          user.history.push({
            id: crypto.randomUUID(),
            type: "order-approved",
            amountUsd: saved.totalUsd,
            note: `${saved.productName} - ${saved.variantName}`,
            createdAt: new Date().toISOString()
          });
        }
        saved.approvedBalanceApplied = true;
      }
      return saved;
    }).catch((error) => ({ error: error.message }));
    if (order.error) return sendError(res, 404, order.error);
    return sendJson(res, 200, { order });
  }

  if (orderUpdate && method === "DELETE") {
    const admin = await requireAdmin(req, res, store);
    if (!admin) return;
    await store.update((data) => {
      data.orders = data.orders.filter((item) => item.id !== orderUpdate.id);
    });
    return sendJson(res, 200, { ok: true });
  }

  if (method === "POST" && pathname === "/api/admin/orders/delete-bulk") {
    const admin = await requireAdmin(req, res, store);
    if (!admin) return;
    const body = await readBody(req);
    const ids = new Set(Array.isArray(body.ids) ? body.ids : []);
    const deleted = await store.update((data) => {
      const before = data.orders.length;
      data.orders = data.orders.filter((item) => !ids.has(item.id));
      return before - data.orders.length;
    });
    return sendJson(res, 200, { ok: true, deleted });
  }

  if (method === "POST" && pathname === "/api/admin/stock") {
    const admin = await requireAdmin(req, res, store);
    if (!admin) return;
    const body = await readBody(req);
    const result = await store.update((data) => {
      const product = data.products.find((item) => item.id === body.productId);
      if (!product) throw new Error("Product not found");
      const variant = product.variants.find((item) => item.id === body.variantId);
      if (!variant) throw new Error("Variant not found");
      const keys = Array.isArray(body.keys)
        ? body.keys.map((key) => String(key).trim()).filter(Boolean)
        : String(body.keys || "").split(/\r?\n/).map((key) => key.trim()).filter(Boolean);
      variant.durationDays = Number(body.durationDays !== undefined ? body.durationDays : variant.durationDays || 0);
      variant.stockKeys = Array.from(new Set([...(variant.stockKeys || []), ...keys]));
      return { product, variant };
    }).catch((error) => ({ error: error.message }));
    if (result.error) return sendError(res, 400, result.error);
    return sendJson(res, 200, { product: result.product, variant: result.variant });
  }

  if (method === "DELETE" && pathname === "/api/admin/stock") {
    const admin = await requireAdmin(req, res, store);
    if (!admin) return;
    const body = await readBody(req);
    const result = await store.update((data) => {
      const product = data.products.find((item) => item.id === body.productId);
      if (!product) throw new Error("Product not found");
      const variant = product.variants.find((item) => item.id === body.variantId);
      if (!variant) throw new Error("Variant not found");
      const current = Array.isArray(variant.stockKeys) ? variant.stockKeys : [];
      if (body.clear) {
        variant.stockKeys = [];
      } else {
        const remove = new Set(Array.isArray(body.keys) ? body.keys : []);
        variant.stockKeys = current.filter((key) => !remove.has(key));
      }
      return { product, variant };
    }).catch((error) => ({ error: error.message }));
    if (result.error) return sendError(res, 400, result.error);
    return sendJson(res, 200, { product: result.product, variant: result.variant });
  }

  const userUpdate = routeParams("/api/admin/users/:id", pathname);
  if (userUpdate && method === "PUT") {
    const admin = await requireAdmin(req, res, store);
    if (!admin) return;
    const body = await readBody(req);
    const user = await store.update((data) => {
      const saved = data.users.find((item) => item.id === userUpdate.id);
      if (!saved) throw new Error("User not found");
      if (body.name !== undefined) saved.name = String(body.name).trim();
      if (body.balanceUsd !== undefined) {
        saved.balanceUsd = roundMoney(body.balanceUsd);
        saved.history = saved.history || [];
        saved.history.push({
          id: crypto.randomUUID(),
          type: "balance-set",
          amountUsd: saved.balanceUsd,
          note: String(body.note || "Admin balance update").trim(),
          createdAt: new Date().toISOString()
        });
      }
      return saved;
    }).catch((error) => ({ error: error.message }));
    if (user.error) return sendError(res, 404, user.error);
    return sendJson(res, 200, { user: withoutSecretUser(user) });
  }

  if (method === "PUT" && pathname === "/api/admin/password") {
    const admin = await requireAdmin(req, res, store);
    if (!admin) return;
    const body = await readBody(req);
    const newPassword = String(body.newPassword || "");
    if (newPassword.length < 8) return sendError(res, 400, "Password must be at least 8 characters");
    await store.update((data) => {
      const record = data.users.find((item) => item.id === admin.id);
      record.passwordHash = hashPassword(newPassword);
    });
    return sendJson(res, 200, { ok: true });
  }

  sendError(res, 404, "API route not found");
}

async function serveStatic(req, res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname === "/admin" || pathname === "/admin/" ? "/admin.html" : pathname;
  const normalized = path.normalize(decodeURIComponent(requested)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, normalized);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
    res.end(data);
  } catch {
    try {
      const index = await fs.readFile(path.join(PUBLIC_DIR, "index.html"));
      res.writeHead(200, { "Content-Type": mimeTypes[".html"] });
      res.end(index);
    } catch {
      if (pathname === "/" || pathname === "/health") {
        return sendJson(res, 200, {
          ok: true,
          service: "panel-marketplace-backend",
          message: "Backend API is running. Deploy the frontend separately and set FRONTEND_API_URL to this backend URL.",
          health: "/api/health"
        });
      }
      return sendText(res, 404, "Frontend files are not present in this backend service. Use the frontend Render service for the website UI.");
    }
  }
}

async function main() {
  const seedPasswordHashes = {
    admin: hashPassword(DEFAULT_ADMIN_PASSWORD)
  };
  const store = await createStore(seedPasswordHashes);
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS"
        });
        return res.end();
      }
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname.startsWith("/api/")) {
        return await handleApi(req, res, store, url.pathname);
      }
      return await serveStatic(req, res, url.pathname);
    } catch (error) {
      console.error(error);
      return sendError(res, 500, error.message || "Server error");
    }
  });

  server.listen(PORT, () => {
    console.log(`Panel marketplace running on http://localhost:${PORT}`);
  });
}

main();
