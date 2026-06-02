import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "..", "data", "app-data.json");

export function createSeedData() {
  const now = new Date().toISOString();
  const sectionA = crypto.randomUUID();
  const sectionB = crypto.randomUUID();
  const sectionC = crypto.randomUUID();
  const productA = crypto.randomUUID();
  const productB = crypto.randomUUID();
  const productC = crypto.randomUUID();
  const productD = crypto.randomUUID();
  const adminId = crypto.randomUUID();

  return {
    version: 1,
    settings: {
      siteName: "GlowPanel Market",
      logoText: "GP",
      logoUrl: "",
      heroTitle: "Professional panel marketplace with smooth purchase flow",
      heroSubtitle: "Browse polished product sections, preview demos, choose variants, check converted prices, and submit orders with a clean account history.",
      introAnimation: true,
      backgroundImage: "/assets/marketplace-bg.png",
      supportWhatsApp: "https://wa.me/8801700000000",
      supportTelegram: "https://t.me/your_support",
      googleClientId: process.env.GOOGLE_CLIENT_ID || "",
      currencyRates: {
        BDT: 118,
        INR: 84
      },
      overviewBadges: [
        { id: crypto.randomUUID(), name: "FF Rewards", image: "/assets/marketplace-bg.png" },
        { id: crypto.randomUUID(), name: "Non Root", image: "/assets/marketplace-bg.png" },
        { id: crypto.randomUUID(), name: "iPhone", image: "/assets/marketplace-bg.png" },
        { id: crypto.randomUUID(), name: "PC Panel", image: "/assets/marketplace-bg.png" }
      ]
    },
    paymentMethods: [
      {
        id: "bkash",
        name: "bKash",
        currency: "BDT",
        rateKey: "BDT",
        account: "01700000000",
        instructions: "Send money manually, then paste transaction id.",
        enabled: true
      },
      {
        id: "nagad",
        name: "Nagad",
        currency: "BDT",
        rateKey: "BDT",
        account: "01700000000",
        instructions: "Send money manually, then paste transaction id.",
        enabled: true
      },
      {
        id: "rocket",
        name: "Rocket",
        currency: "BDT",
        rateKey: "BDT",
        account: "01700000000",
        instructions: "Send money manually, then paste transaction id.",
        enabled: true
      },
      {
        id: "binance",
        name: "Binance USDT",
        currency: "USD",
        rateKey: "USD",
        account: "binance-pay-id",
        instructions: "Pay the exact USD amount and submit payment reference.",
        enabled: true
      },
      {
        id: "india",
        name: "India UPI",
        currency: "INR",
        rateKey: "INR",
        account: "yourupi@bank",
        instructions: "Pay the INR converted amount and submit UPI reference.",
        enabled: true
      }
    ],
    sections: [
      {
        id: sectionA,
        title: "Non Root Panel",
        subtitle: "Android friendly panel options with clean setup.",
        image: "/assets/marketplace-bg.png",
        enabled: true,
        sortOrder: 1
      },
      {
        id: sectionB,
        title: "Root & iPhone Panel",
        subtitle: "Advanced tools, video demos, and variant based pricing.",
        image: "/assets/marketplace-bg.png",
        enabled: true,
        sortOrder: 2
      },
      {
        id: sectionC,
        title: "PC Panel",
        subtitle: "Desktop focused products with manual order approval.",
        image: "/assets/marketplace-bg.png",
        enabled: true,
        sortOrder: 3
      }
    ],
    products: [
      {
        id: productA,
        sectionId: sectionA,
        name: "FF Reward Panel",
        panelName: "Non Root",
        shortDescription: "Stable package with account-safe setup and clear demo.",
        image: "/assets/marketplace-bg.png",
        demoVideoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        badge: "Popular",
        enabled: true,
        features: ["Fast delivery", "Manual approval", "Video demo", "Balance history"],
        variants: [
          { id: crypto.randomUUID(), name: "Basic", priceUsd: 5, description: "Starter setup" },
          { id: crypto.randomUUID(), name: "Premium", priceUsd: 12, description: "Extra features" },
          { id: crypto.randomUUID(), name: "VIP", priceUsd: 25, description: "Priority support" }
        ]
      },
      {
        id: productB,
        sectionId: sectionA,
        name: "Campus Reward Pack",
        panelName: "Non Root",
        shortDescription: "Reward workflow with flexible quantity and manual checking.",
        image: "/assets/marketplace-bg.png",
        demoVideoUrl: "https://youtu.be/dQw4w9WgXcQ",
        badge: "New",
        enabled: true,
        features: ["Quantity control", "Admin variants", "Payment proof", "User history"],
        variants: [
          { id: crypto.randomUUID(), name: "1 Day", priceUsd: 3, description: "Short access" },
          { id: crypto.randomUUID(), name: "7 Days", priceUsd: 15, description: "Weekly access" }
        ]
      },
      {
        id: productC,
        sectionId: sectionB,
        name: "Root Pro Panel",
        panelName: "Root",
        shortDescription: "Advanced root panel with clean product details.",
        image: "/assets/marketplace-bg.png",
        demoVideoUrl: "",
        badge: "Advanced",
        enabled: true,
        features: ["Root mode", "Admin editable", "Demo optional", "Clear graphics"],
        variants: [
          { id: crypto.randomUUID(), name: "Standard", priceUsd: 9, description: "Root panel standard" },
          { id: crypto.randomUUID(), name: "Lifetime", priceUsd: 39, description: "Long access" }
        ]
      },
      {
        id: productD,
        sectionId: sectionC,
        name: "PC Control Panel",
        panelName: "PC",
        shortDescription: "Desktop panel product with variant based checkout.",
        image: "/assets/marketplace-bg.png",
        demoVideoUrl: "",
        badge: "PC",
        enabled: true,
        features: ["PC tools", "USD base price", "BDT/INR conversion", "Help button"],
        variants: [
          { id: crypto.randomUUID(), name: "Lite", priceUsd: 8, description: "Lite PC setup" },
          { id: crypto.randomUUID(), name: "Full", priceUsd: 30, description: "Full PC package" }
        ]
      }
    ],
    users: [
      {
        id: adminId,
        name: "Admin",
        email: "admin@example.com",
        role: "admin",
        passwordHash: "",
        balanceUsd: 0,
        provider: "password",
        avatar: "",
        createdAt: now,
        history: []
      }
    ],
    orders: [],
    createdAt: now,
    updatedAt: now
  };
}

export class JsonStore {
  constructor(filePath = DATA_FILE) {
    this.filePath = filePath;
    this.queue = Promise.resolve();
  }

  async init(seedPasswordHashes) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      await fs.access(this.filePath);
    } catch {
      const seed = createSeedData();
      seed.users = seed.users.map((user) => ({
        ...user,
        passwordHash: user.role === "admin" ? seedPasswordHashes.admin : seedPasswordHashes.user
      }));
      await this.write(seed);
    }
  }

  async read() {
    const raw = await fs.readFile(this.filePath, "utf8");
    return JSON.parse(raw);
  }

  async write(data) {
    data.updatedAt = new Date().toISOString();
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
    await fs.rename(tmp, this.filePath);
  }

  async update(mutator) {
    const job = this.queue.then(async () => {
      const data = await this.read();
      const result = await mutator(data);
      await this.write(data);
      return result ?? data;
    });
    this.queue = job.catch(() => {});
    return job;
  }
}

export class PgStore {
  constructor(pool) {
    this.pool = pool;
    this.queue = Promise.resolve();
  }

  async init(seedPasswordHashes) {
    await this.pool.query(`
      create table if not exists app_state (
        id integer primary key,
        doc jsonb not null,
        updated_at timestamptz not null default now()
      )
    `);
    const existing = await this.pool.query("select id from app_state where id = 1");
    if (!existing.rowCount) {
      const seed = createSeedData();
      seed.users = seed.users.map((user) => ({
        ...user,
        passwordHash: user.role === "admin" ? seedPasswordHashes.admin : seedPasswordHashes.user
      }));
      await this.pool.query("insert into app_state (id, doc) values (1, $1::jsonb)", [JSON.stringify(seed)]);
    }
  }

  async read() {
    const result = await this.pool.query("select doc from app_state where id = 1");
    return result.rows[0].doc;
  }

  async write(data) {
    data.updatedAt = new Date().toISOString();
    await this.pool.query("update app_state set doc = $1::jsonb, updated_at = now() where id = 1", [
      JSON.stringify(data)
    ]);
  }

  async update(mutator) {
    const job = this.queue.then(async () => {
      const data = await this.read();
      const result = await mutator(data);
      await this.write(data);
      return result ?? data;
    });
    this.queue = job.catch(() => {});
    return job;
  }
}

export async function createStore(seedPasswordHashes) {
  if (process.env.DATABASE_URL) {
    try {
      const { Pool } = await import("pg");
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL.includes("sslmode=disable")
          ? false
          : { rejectUnauthorized: false }
      });
      const store = new PgStore(pool);
      await store.init(seedPasswordHashes);
      return store;
    } catch (error) {
      if (process.env.NODE_ENV === "production") {
        throw error;
      }
      console.warn(`Postgres unavailable, using JSON store: ${error.message}`);
    }
  }

  const store = new JsonStore();
  await store.init(seedPasswordHashes);
  return store;
}
