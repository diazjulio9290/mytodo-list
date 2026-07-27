import crypto from "node:crypto";
import { promisify } from "node:util";
import dotenv from "dotenv";
import express from "express";
import pg from "pg";
import { rescheduleTasks } from "./schedule.js";

dotenv.config();

const { Pool } = pg;
const scrypt = promisify(crypto.scrypt);
const app = express();
const port = process.env.PORT || 3000;
const sessionSecret = process.env.SESSION_SECRET;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required. Add your Neon connection string to .env.");
}

if (!sessionSecret) {
  throw new Error("SESSION_SECRET is required. Add a long random value to .env.");
}

const databaseUrl = new URL(process.env.DATABASE_URL);
const sslMode = databaseUrl.searchParams.get("sslmode");
databaseUrl.searchParams.delete("sslmode");

const pool = new Pool({
  connectionString: databaseUrl.toString(),
  ssl: sslMode ? { rejectUnauthorized: false } : undefined,
});

const taskColumns = `
  id,
  user_id,
  task_name,
  duration_minutes,
  to_char(task_date, 'YYYY-MM-DD') as task_date,
  start_at,
  end_at,
  sort_order,
  done_adding,
  created_at,
  updated_at
`;

app.use(express.json());
app.use(express.static("."));

function signSession(userId) {
  const payload = Buffer.from(JSON.stringify({ userId })).toString("base64url");
  const signature = crypto
    .createHmac("sha256", sessionSecret)
    .update(payload)
    .digest("base64url");

  return `${payload}.${signature}`;
}

function verifySession(token) {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expected = crypto
    .createHmac("sha256", sessionSecret)
    .update(payload)
    .digest("base64url");

  const receivedSignature = Buffer.from(signature);
  const expectedSignature = Buffer.from(expected);
  if (
    receivedSignature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(receivedSignature, expectedSignature)
  ) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function readCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((cookie) => cookie.trim().split("="))
      .filter(([key, value]) => key && value)
      .map(([key, value]) => [key, decodeURIComponent(value)]),
  );
}

function sessionCookie(token) {
  const secure = process.env.NODE_ENV === "production" ? " Secure;" : "";
  return `planner_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000;${secure}`;
}

function clearSessionCookie() {
  return "planner_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0;";
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = await scrypt(password, salt, 64);
  return `${salt}:${derivedKey.toString("hex")}`;
}

async function verifyPassword(password, storedHash) {
  const [salt, key] = storedHash.split(":");
  if (!salt || !key) return false;

  const derivedKey = await scrypt(password, salt, 64);
  return crypto.timingSafeEqual(Buffer.from(key, "hex"), derivedKey);
}

async function currentUser(req) {
  const cookies = readCookies(req.headers.cookie);
  const session = verifySession(cookies.planner_session);
  if (!session?.userId) return null;

  const { rows } = await pool.query(
    "select id, email from app_users where id = $1",
    [session.userId],
  );

  return rows[0] || null;
}

async function requireUser(req, res, next) {
  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: "Sign in required." });
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

function toApiSession(user) {
  return { user: { id: String(user.id), email: user.email } };
}

async function initDb() {
  await pool.query(`
    create table if not exists app_users (
      id bigserial primary key,
      email text not null unique,
      password_hash text not null,
      created_at timestamptz not null default now()
    );

    create table if not exists tasks (
      id bigserial primary key,
      user_id bigint not null references app_users(id) on delete cascade,
      task_name text not null,
      duration_minutes integer not null check (duration_minutes > 0),
      task_date date not null,
      start_at timestamptz not null,
      end_at timestamptz not null,
      sort_order integer not null default 0,
      done_adding boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create index if not exists tasks_user_date_sort_idx
      on tasks (user_id, task_date, sort_order, start_at);
  `);
}

app.get("/api/session", async (req, res, next) => {
  try {
    const user = await currentUser(req);
    res.json({ session: user ? toApiSession(user) : null });
  } catch (error) {
    next(error);
  }
});

app.post("/api/signup", async (req, res, next) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!email || !password) {
      return res.status(400).json({ error: "Enter an email and password." });
    }

    const passwordHash = await hashPassword(password);
    const { rows } = await pool.query(
      "insert into app_users (email, password_hash) values ($1, $2) returning id, email",
      [email, passwordHash],
    );
    const user = rows[0];

    res.setHeader("Set-Cookie", sessionCookie(signSession(user.id)));
    res.status(201).json({ session: toApiSession(user) });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "An account with that email already exists." });
    }
    next(error);
  }
});

app.post("/api/signin", async (req, res, next) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const { rows } = await pool.query(
      "select id, email, password_hash from app_users where email = $1",
      [email],
    );
    const user = rows[0];

    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    res.setHeader("Set-Cookie", sessionCookie(signSession(user.id)));
    res.json({ session: toApiSession(user) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/reset-password", async (req, res, next) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!email || !password) {
      return res.status(400).json({ error: "Enter an email and new password." });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: "Use at least 8 characters." });
    }

    const passwordHash = await hashPassword(password);
    const { rows } = await pool.query(
      `update app_users
       set password_hash = $1
       where email = $2
       returning id, email`,
      [passwordHash, email],
    );

    if (!rows[0]) {
      return res.status(404).json({ error: "No account found for that email." });
    }

    const user = rows[0];
    res.setHeader("Set-Cookie", sessionCookie(signSession(user.id)));
    res.json({ session: toApiSession(user) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/signout", (req, res) => {
  res.setHeader("Set-Cookie", clearSessionCookie());
  res.json({ ok: true });
});

app.get("/api/tasks", requireUser, async (req, res, next) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: "date is required." });

    const [tasksResult, datesResult, historyResult] = await Promise.all([
      pool.query(
        `select ${taskColumns} from tasks
         where user_id = $1 and task_date = $2
         order by sort_order asc, start_at asc`,
        [req.user.id, date],
      ),
      pool.query(
        "select distinct to_char(task_date, 'YYYY-MM-DD') as task_date from tasks where user_id = $1",
        [req.user.id],
      ),
      pool.query(
        `select ${taskColumns} from tasks
         where user_id = $1
         order by start_at desc
         limit 20`,
        [req.user.id],
      ),
    ]);

    res.json({
      tasks: tasksResult.rows,
      dates: datesResult.rows,
      history: historyResult.rows,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/tasks", requireUser, async (req, res, next) => {
  try {
    const {
      task_name,
      duration_minutes,
      task_date,
      start_at,
      end_at,
      sort_order,
      done_adding = false,
    } = req.body;

    const { rows } = await pool.query(
      `insert into tasks (
        user_id, task_name, duration_minutes, task_date,
        start_at, end_at, sort_order, done_adding
      ) values ($1, $2, $3, $4, $5, $6, $7, $8)
      returning ${taskColumns}`,
      [
        req.user.id,
        task_name,
        duration_minutes,
        task_date,
        start_at,
        end_at,
        sort_order,
        done_adding,
      ],
    );

    res.status(201).json({ task: rows[0] });
  } catch (error) {
    next(error);
  }
});

app.put("/api/tasks/reorder", requireUser, async (req, res, next) => {
  const taskDate = String(req.body.task_date || "");
  const taskIds = Array.isArray(req.body.task_ids)
    ? req.body.task_ids.map((id) => String(id))
    : [];
  const anchorStart = new Date(req.body.anchor_start);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(taskDate)) {
    return res.status(400).json({ error: "A valid task date is required." });
  }

  if (
    taskIds.length === 0 ||
    new Set(taskIds).size !== taskIds.length ||
    Number.isNaN(anchorStart.getTime())
  ) {
    return res.status(400).json({ error: "A valid task order and start time are required." });
  }

  let client;

  try {
    client = await pool.connect();
    await client.query("begin");
    const { rows } = await client.query(
      `select ${taskColumns} from tasks
       where user_id = $1 and task_date = $2
       order by sort_order asc, start_at asc
       for update`,
      [req.user.id, taskDate],
    );

    const tasksById = new Map(rows.map((task) => [String(task.id), task]));
    if (
      rows.length !== taskIds.length ||
      taskIds.some((taskId) => !tasksById.has(taskId))
    ) {
      await client.query("rollback");
      return res.status(409).json({
        error: "The task list changed. Refresh the day and try the move again.",
      });
    }

    const orderedTasks = taskIds.map((taskId) => tasksById.get(taskId));
    const scheduledTasks = rescheduleTasks(orderedTasks, anchorStart);

    for (const task of scheduledTasks) {
      await client.query(
        `update tasks
         set start_at = $1,
             end_at = $2,
             sort_order = $3,
             updated_at = now()
         where id = $4 and user_id = $5`,
        [
          task.start_at,
          task.end_at,
          task.sort_order,
          task.id,
          req.user.id,
        ],
      );
    }

    const reorderedResult = await client.query(
      `select ${taskColumns} from tasks
       where user_id = $1 and task_date = $2
       order by sort_order asc, start_at asc`,
      [req.user.id, taskDate],
    );

    await client.query("commit");
    res.json({ tasks: reorderedResult.rows });
  } catch (error) {
    await client?.query("rollback").catch(() => {});
    next(error);
  } finally {
    client?.release();
  }
});

app.put("/api/tasks/:id", requireUser, async (req, res, next) => {
  try {
    const {
      task_name,
      duration_minutes,
      start_at,
      end_at,
      sort_order,
      done_adding,
    } = req.body;

    const { rows } = await pool.query(
      `update tasks
       set task_name = $1,
           duration_minutes = $2,
           start_at = $3,
           end_at = $4,
           sort_order = $5,
           done_adding = $6,
           updated_at = now()
       where id = $7 and user_id = $8
       returning ${taskColumns}`,
      [
        task_name,
        duration_minutes,
        start_at,
        end_at,
        sort_order,
        done_adding,
        req.params.id,
        req.user.id,
      ],
    );

    if (!rows[0]) return res.status(404).json({ error: "Task not found." });
    res.json({ task: rows[0] });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/tasks/:id", requireUser, async (req, res, next) => {
  try {
    await pool.query("delete from tasks where id = $1 and user_id = $2", [
      req.params.id,
      req.user.id,
    ]);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/tasks", requireUser, async (req, res, next) => {
  try {
    const { date } = req.query;
    if (date) {
      await pool.query("delete from tasks where user_id = $1 and task_date = $2", [
        req.user.id,
        date,
      ]);
    } else {
      await pool.query("delete from tasks where user_id = $1", [req.user.id]);
    }

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ error: "Something went wrong." });
});

await initDb();

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Productive Day Timer running at http://localhost:${port}`);
  });
}

export default app;
