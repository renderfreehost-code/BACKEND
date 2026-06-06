import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import jwt from "jsonwebtoken";
import { createStore } from "./store.js";
import { convertUsd, roundMoney } from "./currency.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PUBLIC_DIR = path.resolve(process.env.FRONTEND_DIR || path.join(ROOT, "..", "frontend", "dist"));
const PORT = Number(process.env.PORT || 3000);
const TOKEN_SECRET = process.env.TOKEN_SECRET || "dev-change-this-panel-marketplace-secret";
const DEFAULT_ADMIN_PASSWORD = "Admin@12345";
const RESET_CODE_TTL_MS = 10 * 60 * 1000;

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

function issueToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    TOKEN_SECRET,
    { expiresIn: "7d" }
  );
}

function verifyToken(token) {
  if (!token) return null;
  try {
    return jwt.verify(token, TOKEN_SECRET);
  } catch {
    return null;
  }
}

function getBearer(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
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
  const sections = (data.sections || []).filter((section) => section.enabled).sort((a, b) => a.sortOrder - b.sortOrder);
  const products = (data.products || []).filter((product) => product.enabled).map(publicProduct);
  return {
    updatedAt: data.updatedAt,
    settings: {
      ...data.settings,
      googleClientId: process.env.GOOGLE_CLIENT_ID || data.settings?.googleClientId || ""
    },
    paymentMethods: (data.paymentMethods || []).filter((method) => method.enabled),
    sections,
    products
  };
}

function makeSlug(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || crypto.randomUUID();
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

function normalizeSettings(settings, existing = {}) {
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
    }
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
    return { email: info.email, name: info.name || info.email, avatar: info.picture || "" };
  }

  const [, payload] = credential.split(".");
  if (!payload) throw new Error("Invalid Google credential");
  const info = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (!info.email) throw new Error("Google credential missing email");
  return { email: info.email, name: info.name || info.email, avatar: info.picture || "" };
}

function base64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function gmailResetConfig(settings = {}) {
  return {
    clientId: process.env.GMAIL_CLIENT_ID || settings.googleClientId || "",
    clientSecret: process.env.GMAIL_CLIENT_SECRET || "",
    refreshToken: process.env.GMAIL_REFRESH_TOKEN || "",
    from: process.env.GMAIL_FROM || process.env.GMAIL_USER || ""
  };
}

async function sendResetCodeEmail({ email, code, settings }) {
  const siteName = settings?.siteName || "ACI STORE";
  const config = gmailResetConfig(settings);
  if (!config.clientId || !config.clientSecret || !config.refreshToken || !config.from) {
    throw new Error("Gmail reset email is not configured. Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN and GMAIL_FROM.");
  }

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: "refresh_token"
    })
  });
  const tokenPayload = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenPayload.access_token) {
    throw new Error(tokenPayload.error_description || "Gmail access token request failed.");
  }

  const message = [
    `To: ${email}`,
    `From: ${config.from}`,
    `Subject: ${siteName} password reset code`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    `Your ${siteName} reset code is: ${code}`,
    "",
    "This code will expire in 10 minutes.",
    "If you did not request this, ignore this email."
  ].join("\r\n");

  const sendResponse = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokenPayload.access_token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ raw: base64Url(message) })
  });
  const sendPayload = await sendResponse.json().catch(() => ({}));
  if (!sendResponse.ok) {
    throw new Error(sendPayload.error?.message || "Gmail reset email failed to send.");
  }
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
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
    res.status(401).json({ error: "Login required" });
    return null;
  }
  return user;
}

async function requireAdmin(req, res, store) {
  const user = await requireUser(req, res, store);
  if (!user) return null;
  if (user.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return null;
  }
  return user;
}

async function buildApp() {
  const store = await createStore({ admin: hashPassword(DEFAULT_ADMIN_PASSWORD) });
  const app = express();

  app.disable("x-powered-by");
  app.use(cors());
  app.use(express.json({ limit: "25mb" }));

  app.get("/api/health", (req, res) => {
    res.json({ ok: true, service: "panel-marketplace-express-api", time: new Date().toISOString() });
  });

  app.get("/api/bootstrap", asyncRoute(async (req, res) => {
    const data = await store.read();
    const user = await getUser(req, store);
    res.json({ ...publicData(data), user: withoutSecretUser(user) });
  }));

  app.post("/api/auth/register", asyncRoute(async (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const name = String(req.body.name || "").trim() || email.split("@")[0];
    if (!isGmailAddress(email)) return res.status(400).json({ error: "Use your own Gmail address, for example name@gmail.com" });
    if (password.length < 6) return res.status(400).json({ error: "Create a 6+ character site password" });

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
    if (result.error) return res.status(409).json({ error: result.error });
    res.status(201).json({ token: issueToken(result), user: withoutSecretUser(result) });
  }));

  app.post("/api/auth/login", asyncRoute(async (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();
    const data = await store.read();
    const user = data.users.find((item) => item.email.toLowerCase() === email);
    if (!user || !verifyPassword(String(req.body.password || ""), user.passwordHash)) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    res.json({ token: issueToken(user), user: withoutSecretUser(user) });
  }));

  app.post("/api/auth/forgot-password", asyncRoute(async (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();
    const phase = String(req.body.phase || (req.body.code ? "reset" : "request")).toLowerCase();
    const newPassword = String(req.body.password || req.body.newPassword || "");
    if (!isGmailAddress(email)) return res.status(400).json({ error: "Use your registered Gmail address" });

    if (phase === "request") {
      const data = await store.read();
      const user = data.users.find((item) => item.email.toLowerCase() === email);
      if (!user) return res.status(404).json({ error: "Account not found" });
      const code = String(crypto.randomInt(100000, 1000000));
      try {
        await sendResetCodeEmail({ email, code, settings: data.settings });
      } catch (error) {
        return res.status(503).json({ error: error.message });
      }
      await store.update((nextData) => {
        const now = Date.now();
        nextData.passwordResetCodes = (nextData.passwordResetCodes || [])
          .filter((item) => item.email !== email && new Date(item.expiresAt).getTime() > now);
        nextData.passwordResetCodes.push({
          email,
          codeHash: hashPassword(code),
          createdAt: new Date().toISOString(),
          expiresAt: new Date(now + RESET_CODE_TTL_MS).toISOString()
        });
        return true;
      });
      return res.json({ ok: true, message: "Reset code sent to your Gmail. Code expires in 10 minutes." });
    }

    const code = String(req.body.code || "").trim();
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: "Enter the 6 digit reset code from Gmail" });
    if (newPassword.length < 6) return res.status(400).json({ error: "Create a 6+ character site password" });
    const result = await store.update((data) => {
      const user = data.users.find((item) => item.email.toLowerCase() === email);
      if (!user) throw new Error("Account not found");
      const now = Date.now();
      const records = (data.passwordResetCodes || [])
        .filter((item) => item.email === email && new Date(item.expiresAt).getTime() > now)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const matched = records.find((item) => verifyPassword(code, item.codeHash));
      if (!matched) throw new Error("Invalid or expired reset code");
      user.passwordHash = hashPassword(newPassword);
      user.provider = user.provider?.includes("password") ? user.provider : `${user.provider || "user"},password`;
      user.history = [...(user.history || []), { type: "password-reset", createdAt: new Date().toISOString() }];
      data.passwordResetCodes = (data.passwordResetCodes || []).filter((item) => item.email !== email);
      return withoutSecretUser(user);
    }).catch((error) => ({ error: error.message }));
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ ok: true, user: result });
  }));

  app.post("/api/auth/google", asyncRoute(async (req, res) => {
    try {
      const googleUser = await verifyGoogleCredential(req.body.credential);
      if (!isGmailAddress(googleUser.email)) return res.status(400).json({ error: "Please login with a personal Gmail account" });
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
      res.json({ token: issueToken(user), user: withoutSecretUser(user) });
    } catch (error) {
      res.status(401).json({ error: error.message });
    }
  }));

  app.get("/api/me", asyncRoute(async (req, res) => {
    const user = await requireUser(req, res, store);
    if (!user) return;
    const data = await store.read();
    const orders = data.orders.filter((order) => order.userId === user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json({ user: withoutSecretUser(user), orders });
  }));

  app.post("/api/orders", asyncRoute(async (req, res) => {
    const user = await requireUser(req, res, store);
    if (!user) return;
    const quantity = Math.max(1, Number(req.body.quantity || 1));
    const result = await store.update((data) => {
      const product = data.products.find((item) => item.id === req.body.productId && item.enabled);
      if (!product) throw new Error("Product not found");
      const variant = product.variants.find((item) => item.id === req.body.variantId);
      if (!variant) throw new Error("Variant not found");
      const method = data.paymentMethods.find((item) => item.id === req.body.paymentMethodId && item.enabled);
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
        transactionId: String(req.body.transactionId || "").trim(),
        contact: String(req.body.contact || "").trim(),
        status: "pending",
        adminNote: "",
        createdAt: new Date().toISOString()
      };
      data.orders.push(order);
      return order;
    }).catch((error) => ({ error: error.message }));
    if (result.error) return res.status(400).json({ error: result.error });
    res.status(201).json({ order: result });
  }));

  app.get("/api/admin/dashboard", asyncRoute(async (req, res) => {
    const admin = await requireAdmin(req, res, store);
    if (!admin) return;
    const data = await store.read();
    res.json({
      ...data,
      users: data.users.map(withoutSecretUser),
      defaultCredentials: { adminEmail: admin.email, adminPassword: DEFAULT_ADMIN_PASSWORD }
    });
  }));

  app.put("/api/admin/settings", asyncRoute(async (req, res) => {
    const admin = await requireAdmin(req, res, store);
    if (!admin) return;
    const settings = await store.update((data) => {
      data.settings = normalizeSettings(req.body, data.settings);
      return data.settings;
    });
    res.json({ settings });
  }));

  app.put("/api/admin/payment-methods", asyncRoute(async (req, res) => {
    const admin = await requireAdmin(req, res, store);
    if (!admin) return;
    const methods = Array.isArray(req.body.paymentMethods) ? req.body.paymentMethods : [];
    const paymentMethods = await store.update((data) => {
      data.paymentMethods = methods.map((method) => ({
        id: String(method.id || makeSlug(method.name)).trim(),
        name: String(method.name || "").trim(),
        currency: String(method.currency || "USD").trim().toUpperCase(),
        rateKey: String(method.rateKey || method.currency || "USD").trim().toUpperCase(),
        account: String(method.account || "").trim(),
        logoUrl: String(method.logoUrl || "").trim(),
        group: String(method.group || "").trim().toLowerCase() === "binance" ? "binance" : "main",
        instructions: String(method.instructions || "").trim(),
        enabled: Boolean(method.enabled)
      })).filter((method) => method.id && method.name);
      return data.paymentMethods;
    });
    res.json({ paymentMethods });
  }));

  app.post("/api/admin/sections", asyncRoute(async (req, res) => {
    const admin = await requireAdmin(req, res, store);
    if (!admin) return;
    const section = await store.update((data) => {
      const saved = normalizeSection(req.body);
      data.sections.push(saved);
      return saved;
    });
    res.status(201).json({ section });
  }));

  app.put("/api/admin/sections/:id", asyncRoute(async (req, res) => {
    const admin = await requireAdmin(req, res, store);
    if (!admin) return;
    const section = await store.update((data) => {
      const index = data.sections.findIndex((item) => item.id === req.params.id);
      if (index < 0) throw new Error("Section not found");
      data.sections[index] = normalizeSection(req.body, data.sections[index]);
      return data.sections[index];
    }).catch((error) => ({ error: error.message }));
    if (section.error) return res.status(404).json({ error: section.error });
    res.json({ section });
  }));

  app.delete("/api/admin/sections/:id", asyncRoute(async (req, res) => {
    const admin = await requireAdmin(req, res, store);
    if (!admin) return;
    await store.update((data) => {
      data.sections = data.sections.filter((item) => item.id !== req.params.id);
      data.products = data.products.filter((item) => item.sectionId !== req.params.id);
    });
    res.json({ ok: true });
  }));

  app.post("/api/admin/products", asyncRoute(async (req, res) => {
    const admin = await requireAdmin(req, res, store);
    if (!admin) return;
    const product = await store.update((data) => {
      const saved = normalizeProduct(req.body);
      data.products.push(saved);
      return saved;
    });
    res.status(201).json({ product });
  }));

  app.put("/api/admin/products/:id", asyncRoute(async (req, res) => {
    const admin = await requireAdmin(req, res, store);
    if (!admin) return;
    const product = await store.update((data) => {
      const index = data.products.findIndex((item) => item.id === req.params.id);
      if (index < 0) throw new Error("Product not found");
      data.products[index] = normalizeProduct(req.body, data.products[index]);
      return data.products[index];
    }).catch((error) => ({ error: error.message }));
    if (product.error) return res.status(404).json({ error: product.error });
    res.json({ product });
  }));

  app.delete("/api/admin/products/:id", asyncRoute(async (req, res) => {
    const admin = await requireAdmin(req, res, store);
    if (!admin) return;
    await store.update((data) => {
      data.products = data.products.filter((item) => item.id !== req.params.id);
    });
    res.json({ ok: true });
  }));

  app.put("/api/admin/orders/:id", asyncRoute(async (req, res) => {
    const admin = await requireAdmin(req, res, store);
    if (!admin) return;
    const order = await store.update((data) => {
      const saved = data.orders.find((item) => item.id === req.params.id);
      if (!saved) throw new Error("Order not found");
      saved.status = ["pending", "approved", "rejected"].includes(req.body.status) ? req.body.status : saved.status;
      saved.adminNote = String(req.body.adminNote ?? saved.adminNote ?? "").trim();
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
    if (order.error) return res.status(404).json({ error: order.error });
    res.json({ order });
  }));

  app.delete("/api/admin/orders/:id", asyncRoute(async (req, res) => {
    const admin = await requireAdmin(req, res, store);
    if (!admin) return;
    await store.update((data) => {
      data.orders = data.orders.filter((item) => item.id !== req.params.id);
    });
    res.json({ ok: true });
  }));

  app.post("/api/admin/orders/delete-bulk", asyncRoute(async (req, res) => {
    const admin = await requireAdmin(req, res, store);
    if (!admin) return;
    const ids = new Set(Array.isArray(req.body.ids) ? req.body.ids : []);
    const deleted = await store.update((data) => {
      const before = data.orders.length;
      data.orders = data.orders.filter((item) => !ids.has(item.id));
      return before - data.orders.length;
    });
    res.json({ ok: true, deleted });
  }));

  app.post("/api/admin/stock", asyncRoute(async (req, res) => {
    const admin = await requireAdmin(req, res, store);
    if (!admin) return;
    const result = await store.update((data) => {
      const product = data.products.find((item) => item.id === req.body.productId);
      if (!product) throw new Error("Product not found");
      const variant = product.variants.find((item) => item.id === req.body.variantId);
      if (!variant) throw new Error("Variant not found");
      const keys = Array.isArray(req.body.keys)
        ? req.body.keys.map((key) => String(key).trim()).filter(Boolean)
        : String(req.body.keys || "").split(/\r?\n/).map((key) => key.trim()).filter(Boolean);
      variant.durationDays = Number(req.body.durationDays !== undefined ? req.body.durationDays : variant.durationDays || 0);
      variant.stockKeys = Array.from(new Set([...(variant.stockKeys || []), ...keys]));
      return { product, variant };
    }).catch((error) => ({ error: error.message }));
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ product: result.product, variant: result.variant });
  }));

  app.delete("/api/admin/stock", asyncRoute(async (req, res) => {
    const admin = await requireAdmin(req, res, store);
    if (!admin) return;
    const result = await store.update((data) => {
      const product = data.products.find((item) => item.id === req.body.productId);
      if (!product) throw new Error("Product not found");
      const variant = product.variants.find((item) => item.id === req.body.variantId);
      if (!variant) throw new Error("Variant not found");
      const current = Array.isArray(variant.stockKeys) ? variant.stockKeys : [];
      if (req.body.clear) {
        variant.stockKeys = [];
      } else {
        const remove = new Set(Array.isArray(req.body.keys) ? req.body.keys : []);
        variant.stockKeys = current.filter((key) => !remove.has(key));
      }
      return { product, variant };
    }).catch((error) => ({ error: error.message }));
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ product: result.product, variant: result.variant });
  }));

  app.put("/api/admin/users/:id", asyncRoute(async (req, res) => {
    const admin = await requireAdmin(req, res, store);
    if (!admin) return;
    const user = await store.update((data) => {
      const saved = data.users.find((item) => item.id === req.params.id);
      if (!saved) throw new Error("User not found");
      if (req.body.name !== undefined) saved.name = String(req.body.name).trim();
      if (req.body.balanceUsd !== undefined) {
        saved.balanceUsd = roundMoney(req.body.balanceUsd);
        saved.history = saved.history || [];
        saved.history.push({
          id: crypto.randomUUID(),
          type: "balance-set",
          amountUsd: saved.balanceUsd,
          note: String(req.body.note || "Admin balance update").trim(),
          createdAt: new Date().toISOString()
        });
      }
      return saved;
    }).catch((error) => ({ error: error.message }));
    if (user.error) return res.status(404).json({ error: user.error });
    res.json({ user: withoutSecretUser(user) });
  }));

  app.put("/api/admin/password", asyncRoute(async (req, res) => {
    const admin = await requireAdmin(req, res, store);
    if (!admin) return;
    const newPassword = String(req.body.newPassword || "");
    if (newPassword.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
    await store.update((data) => {
      const record = data.users.find((item) => item.id === admin.id);
      record.passwordHash = hashPassword(newPassword);
    });
    res.json({ ok: true });
  }));

  app.put("/api/admin/account", asyncRoute(async (req, res) => {
    const admin = await requireAdmin(req, res, store);
    if (!admin) return;
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!isGmailAddress(email)) return res.status(400).json({ error: "Enter a valid Gmail address" });
    const user = await store.update((data) => {
      const duplicate = data.users.find((item) => item.id !== admin.id && item.email.toLowerCase() === email);
      if (duplicate) throw new Error("This email is already used by another account");
      const record = data.users.find((item) => item.id === admin.id);
      if (!record) throw new Error("Admin account not found");
      record.email = email;
      record.history = [...(record.history || []), { id: crypto.randomUUID(), type: "admin-email-change", createdAt: new Date().toISOString() }];
      return record;
    }).catch((error) => ({ error: error.message }));
    if (user.error) return res.status(400).json({ error: user.error });
    res.json({ user: withoutSecretUser(user) });
  }));

  async function serveFrontend(req, res) {
    if (req.path.startsWith("/admin")) {
      res.set("Cache-Control", "no-store");
    }
    const index = await fs.readFile(path.join(PUBLIC_DIR, "index.html"), "utf8");
    res.type("html").send(index);
  }

  app.get(/^\/admin(?:\/.*)?$/, asyncRoute(serveFrontend));

  app.use(express.static(PUBLIC_DIR, {
    setHeaders(res, filePath) {
      const name = path.basename(filePath);
      if (name === "sw.js" || name === "manifest.webmanifest") {
        res.setHeader("Cache-Control", "no-cache");
      }
    }
  }));

  app.use(async (req, res) => {
    if (req.path.startsWith("/api/")) return res.status(404).json({ error: "API route not found" });
    try {
      await serveFrontend(req, res);
    } catch {
      res.json({
        ok: true,
        service: "panel-marketplace-express-api",
        message: "Backend API is running. Build/deploy the React frontend separately and set VITE_API_URL to this backend URL.",
        health: "/api/health"
      });
    }
  });

  app.use((error, req, res, next) => {
    console.error(error);
    res.status(500).json({ error: error.message || "Server error" });
  });

  return app;
}

const app = await buildApp();
app.listen(PORT, () => {
  console.log(`Panel marketplace Express API running on http://localhost:${PORT}`);
});
