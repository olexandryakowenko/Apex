import "dotenv/config";
import express from "express";
import cors from "cors";
import crypto from "crypto";
import pg from "pg";

const { Pool } = pg;

// -------------------- Postgres pool (Render) --------------------
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is missing. Add it in Render Environment.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("render.com")
    ? { rejectUnauthorized: false }
    : undefined,
});

// -------------------- DB init (one table) --------------------
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS leads (
      id SERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      name TEXT,
      phone TEXT NOT NULL,
      car TEXT,
      message TEXT,
      page TEXT,
      ua TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      internal_note TEXT
    );
  `);
}
initDb().catch((err) => console.error("DB init error:", err));

// -------------------- Telegram --------------------
async function sendTelegram(htmlText) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) return; // Telegram optional

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = {
    chat_id: chatId,
    text: htmlText,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok || data?.ok === false) {
    throw new Error(`Telegram error: ${JSON.stringify(data)}`);
  }
}

// -------------------- Simple admin auth (token in memory) --------------------
const ADMIN_TOKENS = new Set();

function makeToken() {
  return crypto.randomBytes(24).toString("hex");
}

function requireAdmin(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!token || !ADMIN_TOKENS.has(token)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// -------------------- CORS --------------------
function allowedOrigins() {
  const list = [];
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("CORS_ORIGIN_") && v) list.push(v);
  }
  return list.length ? list : ["*"];
}

const origins = allowedOrigins();

// -------------------- App --------------------
const app = express();

app.use(
  cors({
    origin: function (origin, cb) {
      if (!origin) return cb(null, true); // server-to-server / no-origin
      if (origins.includes("*")) return cb(null, true);
      if (origins.includes(origin)) return cb(null, true);
      return cb(new Error("CORS blocked"), false);
    },
    credentials: false,
  })
);

app.use(express.json({ limit: "256kb" }));

app.get("/api/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// -------------------- Public lead endpoint --------------------
app.post("/api/lead", async (req, res) => {
  try {
    const name = (req.body?.name || "").toString().trim().slice(0, 120);
    const phone = (req.body?.phone || "").toString().trim().slice(0, 40);
    const car = (req.body?.car || "").toString().trim().slice(0, 120);
    const msg = (req.body?.msg || req.body?.message || "")
      .toString()
      .trim()
      .slice(0, 2000);

    const page = (req.body?.page || "").toString().trim().slice(0, 500);
    const ua = (req.body?.ua || "").toString().trim().slice(0, 400);

    if (!phone || phone.length < 6) {
      return res.status(400).json({ error: "Invalid phone" });
    }

    const { rows } = await pool.query(
      `INSERT INTO leads (name, phone, car, message, page, ua, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'new')
       RETURNING id`,
      [name || null, phone, car || null, msg || null, page || null, ua || null]
    );

    const id = rows[0].id;

    // Telegram message (optional)
    const safe = (s) =>
      (s || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    const text =
      `<b>Apex Autolab • Нова заявка</b>\n` +
      `<b>ID:</b> ${id}\n` +
      `<b>Імʼя:</b> ${safe(name) || "-"}\n` +
      `<b>Телефон:</b> ${safe(phone)}\n` +
      `<b>Авто:</b> ${safe(car) || "-"}\n` +
      `<b>Повідомлення:</b> ${safe(msg) || "-"}\n` +
      (page ? `<b>Сторінка:</b> ${safe(page)}\n` : "");

    try {
      await sendTelegram(text);
    } catch (e) {
      // don't fail request if Telegram failed
      console.error(e?.message || e);
    }

    return res.json({ ok: true, id });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Server error" });
  }
});

// -------------------- Admin API --------------------
app.post("/api/admin/login", (req, res) => {
  const u = (req.body?.username || "").toString();
  const p = (req.body?.password || "").toString();

  if (!process.env.ADMIN_USER || !process.env.ADMIN_PASS) {
    return res.status(500).json({ error: "Admin credentials missing" });
  }
  if (u !== process.env.ADMIN_USER || p !== process.env.ADMIN_PASS) {
    return res.status(401).json({ error: "Bad credentials" });
  }

  const token = makeToken();
  ADMIN_TOKENS.add(token);

  return res.json({ token });
});

app.get("/api/admin/leads", requireAdmin, async (req, res) => {
  try {
    const status = (req.query.status || "").toString().trim();
    const q = (req.query.q || "").toString().trim();
    const limit = Math.min(parseInt(req.query.limit || "200", 10) || 200, 500);

    const where = [];
    const params = [];
    let i = 1;

    if (status) {
      where.push(`status = $${i++}`);
      params.push(status);
    }

    if (q) {
      where.push(
        `(phone ILIKE $${i} OR name ILIKE $${i} OR car ILIKE $${i} OR message ILIKE $${i})`
      );
      params.push(`%${q}%`);
      i++;
    }

    params.push(limit);

    const sql = `
      SELECT id, created_at, phone, status
      FROM leads
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY id DESC
      LIMIT $${i}
    `;

    const { rows } = await pool.query(sql, params);
    return res.json({ rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/admin/leads/:id", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { rows } = await pool.query("SELECT * FROM leads WHERE id = $1", [id]);
    if (!rows[0]) return res.status(404).json({ error: "Not found" });
    return res.json({ row: rows[0] });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Server error" });
  }
});

app.patch("/api/admin/leads/:id", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);

    const { rows: curRows } = await pool.query(
      "SELECT * FROM leads WHERE id = $1",
      [id]
    );
    const cur = curRows[0];
    if (!cur) return res.status(404).json({ error: "Not found" });

    const status = (req.body?.status ?? cur.status)
      .toString()
      .trim()
      .slice(0, 30) || "new";

    const internal_note = (req.body?.internal_note ?? cur.internal_note ?? "")
      .toString()
      .slice(0, 4000) || null;

    await pool.query(
      "UPDATE leads SET status = $1, internal_note = $2 WHERE id = $3",
      [status, internal_note, id]
    );

    const { rows } = await pool.query("SELECT * FROM leads WHERE id = $1", [id]);
    return res.json({ row: rows[0] });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Server error" });
  }
});

// -------------------- Error handler --------------------
app.use((err, req, res, next) => {
  if (err?.message === "CORS blocked") {
    return res.status(403).json({ error: "CORS blocked" });
  }
  console.error(err);
  return res.status(500).json({ error: "Server error" });
});

// -------------------- Listen --------------------
const port = parseInt(process.env.PORT || "8080", 10);
app.listen(port, () => console.log("Apex backend listening on", port));
