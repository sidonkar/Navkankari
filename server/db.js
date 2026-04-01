import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";

const ROOT = process.cwd();
const LEGACY_DATA_FILE = path.join(ROOT, "data", "store.json");

function emptyStore() {
  return {
    players: [],
    invites: [],
    queue: [],
    games: []
  };
}

function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required. Set it to your Render Postgres connection string.");
  }

  const useSsl = process.env.DATABASE_SSL_DISABLE === "1"
    ? false
    : { rejectUnauthorized: false };

  return new Pool({
    connectionString,
    ssl: useSsl
  });
}

export const pool = createPool();

export async function initDatabase() {
  await pool.query(`
    create table if not exists app_state (
      id boolean primary key default true,
      state jsonb not null,
      updated_at timestamptz not null default now()
    )
  `);

  const existing = await pool.query("select id from app_state where id = true");
  if (existing.rowCount) {
    return;
  }

  let seed = emptyStore();
  if (process.env.MIGRATE_JSON_ON_BOOT !== "0" && fs.existsSync(LEGACY_DATA_FILE)) {
    try {
      seed = JSON.parse(fs.readFileSync(LEGACY_DATA_FILE, "utf8"));
    } catch {
      seed = emptyStore();
    }
  }

  await pool.query(
    "insert into app_state (id, state) values (true, $1::jsonb) on conflict (id) do nothing",
    [JSON.stringify(seed)]
  );
}

export async function readStore() {
  const result = await pool.query("select state from app_state where id = true");
  if (!result.rowCount) {
    return emptyStore();
  }
  return result.rows[0].state || emptyStore();
}

export async function withStore(mutator) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`
      create table if not exists app_state (
        id boolean primary key default true,
        state jsonb not null,
        updated_at timestamptz not null default now()
      )
    `);

    const existing = await client.query("select id from app_state where id = true");
    if (!existing.rowCount) {
      let seed = emptyStore();
      if (process.env.MIGRATE_JSON_ON_BOOT !== "0" && fs.existsSync(LEGACY_DATA_FILE)) {
        try {
          seed = JSON.parse(fs.readFileSync(LEGACY_DATA_FILE, "utf8"));
        } catch {
          seed = emptyStore();
        }
      }

      await client.query(
        "insert into app_state (id, state) values (true, $1::jsonb)",
        [JSON.stringify(seed)]
      );
    }

    const locked = await client.query("select state from app_state where id = true for update");
    const store = locked.rows[0]?.state || emptyStore();
    const result = await mutator(store, client);
    await client.query(
      "update app_state set state = $1::jsonb, updated_at = now() where id = true",
      [JSON.stringify(store)]
    );
    await client.query("commit");
    return { store, result };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
