const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool, types } = require("pg");

// Return NUMERIC columns as JS numbers instead of strings.
types.setTypeParser(1700, (val) => (val === null ? null : parseFloat(val)));

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.warn("WARNING: JWT_SECRET is not set — set it in your environment before deploying.");
}

const isLocalDb = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || "");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocalDb ? false : { rejectUnauthorized: false },
});

async function migrate() {
  await pool.query(`create extension if not exists pgcrypto;`);
  await pool.query(`
    create table if not exists users (
      id uuid primary key default gen_random_uuid(),
      email text unique not null,
      password_hash text not null,
      created_at timestamptz not null default now()
    );
  `);
  await pool.query(`
    create table if not exists trades (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references users(id) on delete cascade,
      trade_ref text,
      symbol text not null,
      contract_type text,
      stake numeric,
      payout numeric,
      profit numeric not null,
      buy_time timestamptz,
      sell_time timestamptz,
      result text generated always as (
        case when profit > 0 then 'win' when profit < 0 then 'loss' else 'breakeven' end
      ) stored,
      raw jsonb,
      created_at timestamptz not null default now()
    );
  `);
  await pool.query(`create index if not exists trades_user_id_idx on trades (user_id);`);
}

app.use(express.json({ limit: "5mb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: "30d" });
}
function setAuthCookie(res, token) {
  res.cookie("token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}
function requireAuth(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "Not signed in." });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Session expired, please sign in again." });
  }
}

app.post("/api/auth/signup", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password || password.length < 6) {
    return res.status(400).json({ error: "Email and a password of at least 6 characters are required." });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      "insert into users (email, password_hash) values ($1,$2) returning id, email",
      [email.toLowerCase().trim(), hash]
    );
    const user = rows[0];
    setAuthCookie(res, signToken(user));
    res.json({ email: user.email });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "An account with that email already exists." });
    console.error(err);
    res.status(500).json({ error: "Could not create account." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  const { rows } = await pool.query("select * from users where email = $1", [(email || "").toLowerCase().trim()]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password || "", user.password_hash))) {
    return res.status(401).json({ error: "Incorrect email or password." });
  }
  setAuthCookie(res, signToken(user));
  res.json({ email: user.email });
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ ok: true });
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ email: req.user.email });
});

app.get("/api/trades", requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    "select * from trades where user_id = $1 order by sell_time asc nulls last",
    [req.user.sub]
  );
  res.json(rows);
});

app.post("/api/trades/bulk", requireAuth, async (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: "No rows to import." });
  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const r of rows) {
      await client.query(
        `insert into trades (user_id, trade_ref, symbol, contract_type, stake, payout, profit, buy_time, sell_time, raw)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [req.user.sub, r.trade_ref || null, r.symbol, r.contract_type || null, r.stake, r.payout, r.profit, r.buy_time, r.sell_time, r.raw ? JSON.stringify(r.raw) : null]
      );
    }
    await client.query("commit");
    res.json({ imported: rows.length });
  } catch (err) {
    await client.query("rollback");
    console.error(err);
    res.status(500).json({ error: "Import failed." });
  } finally {
    client.release();
  }
});

app.delete("/api/trades/:id", requireAuth, async (req, res) => {
  await pool.query("delete from trades where id = $1 and user_id = $2", [req.params.id, req.user.sub]);
  res.json({ ok: true });
});

app.delete("/api/trades", requireAuth, async (req, res) => {
  await pool.query("delete from trades where user_id = $1", [req.user.sub]);
  res.json({ ok: true });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

migrate()
  .then(() => app.listen(PORT, () => console.log(`Trade Desk listening on port ${PORT}`)))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
