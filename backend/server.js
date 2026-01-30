import "dotenv/config";
import express from "express";
import cors from "cors";
import { openDb, run, get, all } from "./db.js";
import { sendTelegram } from "./telegram.js";
import { makeToken, requireAdmin } from "./auth.js";

const app = express();
const db = openDb();

function allowedOrigins() {
  const list = [];
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("CORS_ORIGIN_") && v) list.push(v);
  }
  return list.length ? list : ["*"];
}

const origins = allowedOrigins();

app.use(cors({
  origin: function (origin, cb) {
    // allow server-to-server/no-origin
    if (!origin) return cb(null, true);
    if (origins.includes("*")) return cb(null, true);
    if (origins.includes(origin)) return cb(null, true);
    return cb(new Error("CORS blocked"), false);
  },
  credentials: false
}));

app.use(express.json({ limit: "256kb" }));

app.get("/api/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// --------- Public lead endpoint ---------
app.post("/api/lead", async (req, res) => {
  try {
    const name = (req.body?.name || "").toString().trim().slice(0, 120);
    const phone = (req.body?.phone || "").toString().trim().slice(0, 40);
    const car = (req.body?.car || "").toString().trim().slice(0, 120);
    const msg = (req.body?.msg || req.body?.message || "").toString().trim().slice(0, 2000);
    const page = (req.body?.page || "").toString().trim().slice(0, 500);
    const ua = (req.body?.ua || "").toString().trim().slice(0, 400);

    if (!phone || phone.length < 6) {
      return res.status(400).json({ error: "Invalid phone" });
    }

    const created_at = new Date().toISOString();
    const ins = await run(db, `
      INSERT INTO leads (created_at, name, phone, car, message, page, ua, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'new')
    `, [created_at, name || null, phone, car || null, msg || null, page || null, ua || null]);

    const id = ins.lastID;

    // Telegram (optional)
    const safe = (s) => (s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    const text =
      `<b>Apex Autolab • Нова заявка</b>\n` +
      `<b>ID:</b> ${id}\n` +
      `<b>Імʼя:</b> ${safe(name) || "-"}\n` +
      `<b>Телефон:</b> ${safe(phone)}\n` +
      `<b>Авто:</b> ${safe(car) || "-"}\n` +
      `<b>Повідомлення:</b> ${safe(msg) || "-"}\n` +
      (page ? `<b>Сторінка:</b> ${safe(page)}\n` : "");

    try { await sendTelegram(text); } catch (e) { /* don't fail lead */ }

    return res.json({ ok: true, id });
  } catch (e) {
    return res.status(500).json({ error: "Server error" });
  }
});

// --------- Admin API ---------
app.post("/api/admin/login", (req, res) => {
  const u = (req.body?.username || "").toString();
  const p = (req.body?.password || "").toString();

  if (!process.env.ADMIN_USER || !process.env.ADMIN_PASS) {
    return res.status(500).json({ error: "Admin credentials missing" });
  }
  if (u !== process.env.ADMIN_USER || p !== process.env.ADMIN_PASS) {
    return res.status(401).json({ error: "Bad credentials" });
  }

  try {
    const token = makeToken();
    return res.json({ token });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Token error" });
  }
});

app.get("/api/admin/leads", requireAdmin, async (req, res) => {
  const status = (req.query.status || "").toString().trim();
  const q = (req.query.q || "").toString().trim();
  const limit = Math.min(parseInt(req.query.limit || "200", 10) || 200, 500);

  const where = [];
  const params = [];

  if (status) {
    where.push("status = ?");
    params.push(status);
  }
  if (q) {
    where.push("(phone LIKE ? OR name LIKE ? OR car LIKE ? OR message LIKE ?)");
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }

  const sql = `
    SELECT id, created_at, phone, status
    FROM leads
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY id DESC
    LIMIT ?
  `;
  params.push(limit);

  const rows = await all(db, sql, params);
  return res.json({ rows });
});

app.get("/api/admin/leads/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = await get(db, "SELECT * FROM leads WHERE id = ?", [id]);
  if (!row) return res.status(404).json({ error: "Not found" });
  return res.json({ row });
});

app.patch("/api/admin/leads/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const cur = await get(db, "SELECT * FROM leads WHERE id = ?", [id]);
  if (!cur) return res.status(404).json({ error: "Not found" });

  const status = (req.body?.status ?? cur.status).toString().trim().slice(0, 30);
  const internal_note = (req.body?.internal_note ?? cur.internal_note ?? "").toString().slice(0, 4000);

  await run(db, "UPDATE leads SET status = ?, internal_note = ? WHERE id = ?", [status || "new", internal_note || null, id]);
  const row = await get(db, "SELECT * FROM leads WHERE id = ?", [id]);
  return res.json({ row });
});

// --------- Error handler (CORS etc.) ---------
app.use((err, req, res, next) => {
  if (err?.message === "CORS blocked") return res.status(403).json({ error: "CORS blocked" });
  return res.status(500).json({ error: "Server error" });
});

const port = parseInt(process.env.PORT || "8080", 10);
app.listen(port, () => console.log("Apex backend listening on", port));
