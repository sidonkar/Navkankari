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

async function ensureSchema(client) {
  await client.query(`
    create table if not exists app_state (
      id boolean primary key default true,
      state jsonb not null,
      updated_at timestamptz not null default now()
    )
  `);

  await client.query(`
    create table if not exists players (
      id text primary key,
      name text not null,
      email text,
      phone text,
      favorite_color text,
      games_played integer not null default 0,
      wins integer not null default 0,
      losses integer not null default 0,
      rating integer not null default 100,
      active_game_id text,
      guest boolean not null default false,
      salt text,
      password_hash text,
      created_at bigint
    )
  `);

  await client.query("alter table players add column if not exists email text");
  await client.query("alter table players add column if not exists phone text");

  await client.query(`
    create table if not exists games (
      id text primary key,
      status text not null,
      source text,
      winner_id text,
      player_ids jsonb not null,
      players jsonb not null,
      board jsonb not null,
      stage text not null,
      turn_player_id text,
      pending_capture_by text,
      move_count integer not null default 0,
      last_move jsonb,
      history jsonb not null,
      created_at bigint,
      updated_at bigint,
      saved_at bigint,
      winner_reason text,
      result_recorded boolean not null default false
    )
  `);

  await client.query(`
    create table if not exists invites (
      id text primary key,
      from_player text not null,
      to_player text not null,
      created_at bigint not null
    )
  `);

  await client.query(`
    create table if not exists matchmaking_queue (
      player_id text primary key,
      created_at bigint not null
    )
  `);
}

async function syncMirrorTables(client, store) {
  await client.query("delete from invites");
  await client.query("delete from matchmaking_queue");
  await client.query("delete from games");
  await client.query("delete from players");

  for (const player of store.players) {
    await client.query(
      `insert into players (
        id, name, email, phone, favorite_color, games_played, wins, losses, rating,
        active_game_id, guest, salt, password_hash, created_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        player.id,
        player.name,
        player.email || null,
        player.phone || null,
        player.favoriteColor,
        player.gamesPlayed,
        player.wins,
        player.losses,
        player.rating,
        player.activeGameId,
        Boolean(player.guest),
        player.salt || null,
        player.passwordHash || null,
        player.createdAt || null
      ]
    );
  }

  for (const game of store.games) {
    await client.query(
      `insert into games (
        id, status, source, winner_id, player_ids, players, board, stage,
        turn_player_id, pending_capture_by, move_count, last_move, history,
        created_at, updated_at, saved_at, winner_reason, result_recorded
      ) values ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15,$16,$17,$18)`,
      [
        game.id,
        game.status,
        game.source || null,
        game.winnerId || null,
        JSON.stringify(game.playerIds),
        JSON.stringify(game.players),
        JSON.stringify(game.board),
        game.stage,
        game.turn || null,
        game.pendingCaptureBy || null,
        game.moveCount || 0,
        JSON.stringify(game.lastMove || null),
        JSON.stringify(game.history || []),
        game.createdAt || null,
        game.updatedAt || null,
        game.savedAt || null,
        game.winnerReason || null,
        Boolean(game.resultRecorded)
      ]
    );
  }

  for (const invite of store.invites) {
    await client.query(
      "insert into invites (id, from_player, to_player, created_at) values ($1,$2,$3,$4)",
      [invite.id, invite.from, invite.to, invite.createdAt]
    );
  }

  for (const entry of store.queue) {
    await client.query(
      "insert into matchmaking_queue (player_id, created_at) values ($1,$2)",
      [entry.playerId, entry.createdAt]
    );
  }
}

export async function initDatabase() {
  const client = await pool.connect();
  try {
    await ensureSchema(client);

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
        "insert into app_state (id, state) values (true, $1::jsonb) on conflict (id) do nothing",
        [JSON.stringify(seed)]
      );
    }

    const stateResult = await client.query("select state from app_state where id = true");
    await syncMirrorTables(client, stateResult.rows[0]?.state || emptyStore());
  } finally {
    client.release();
  }
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
    await ensureSchema(client);

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
    await syncMirrorTables(client, store);
    await client.query("commit");
    return { store, result };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
