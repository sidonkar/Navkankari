import express from "express";
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Server } from "socket.io";
import {
  PLAYER_COLORS,
  RANKING,
  createGameRecord,
  applyGameAction,
  getMillOwnerMap
} from "../src/shared/game-rules.js";
import { initDatabase, readStore, withStore } from "./db.js";

const ROOT = process.cwd();
const DIST_PUBLIC = path.join(ROOT, "dist", "public");
const DIST_SERVER = path.join(ROOT, "dist", "server");
const SRC_DIR = path.join(ROOT, "src");
const SECRET = process.env.NAVKANKARI_SECRET || "navkankari-local-secret";
const PORT = Number(process.env.PORT || 3000);

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const socketsByPlayer = new Map();

app.use(express.json({ limit: "1mb" }));

if (fs.existsSync(path.join(DIST_PUBLIC, "assets"))) {
  app.use("/assets", express.static(path.join(DIST_PUBLIC, "assets")));
} else {
  app.use("/src", express.static(SRC_DIR));
}

function uid(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function sanitizeName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 24);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const passwordHash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, passwordHash };
}

function safeCompare(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function verifyToken(token) {
  if (!token || !token.includes(".")) {
    return null;
  }

  const [body, signature] = token.split(".");
  const expected = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  if (!safeCompare(signature, expected)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (payload.exp < Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function createToken(playerId) {
  return signToken({
    playerId,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 14
  });
}

function publicPlayer(player) {
  return {
    id: player.id,
    name: player.name,
    favoriteColor: player.favoriteColor,
    gamesPlayed: player.gamesPlayed,
    wins: player.wins,
    losses: player.losses,
    rating: player.rating,
    activeGameId: player.activeGameId,
    guest: Boolean(player.guest)
  };
}

function getPlayer(store, playerId) {
  return store.players.find((player) => player.id === playerId) || null;
}

function getGame(store, gameId) {
  return store.games.find((game) => game.id === gameId) || null;
}

function getActiveGameFor(store, playerId) {
  return store.games.find((game) => game.status === "active" && game.playerIds.includes(playerId)) || null;
}

function getSavedGamesFor(store, playerId) {
  return store.games.filter((game) => game.status === "saved" && game.playerIds.includes(playerId));
}

function canStartNewGame(store, playerId) {
  const player = getPlayer(store, playerId);
  return Boolean(player && !player.activeGameId);
}

function queueWithoutUnavailable(store) {
  store.queue = store.queue.filter((entry) => {
    const player = getPlayer(store, entry.playerId);
    return player && !player.activeGameId;
  });
}

function clearPlayerPresence(store, playerIds) {
  store.invites = store.invites.filter((invite) => !playerIds.includes(invite.from) && !playerIds.includes(invite.to));
  store.queue = store.queue.filter((entry) => !playerIds.includes(entry.playerId));
}

function createGame(store, playerOneId, playerTwoId, source) {
  const playerOne = getPlayer(store, playerOneId);
  const playerTwo = getPlayer(store, playerTwoId);

  if (!playerOne || !playerTwo) {
    return { ok: false, error: "Could not locate both players." };
  }
  if (playerOne.activeGameId || playerTwo.activeGameId) {
    return { ok: false, error: "One of the players is already in another active game." };
  }

  const game = createGameRecord({
    id: uid("game"),
    playerOne,
    playerTwo,
    source
  });

  store.games.push(game);
  playerOne.activeGameId = game.id;
  playerTwo.activeGameId = game.id;
  clearPlayerPresence(store, [playerOneId, playerTwoId]);
  return { ok: true, game };
}

function settleFinishedGame(store, game) {
  if (!game || game.status !== "finished" || game.resultRecorded) {
    return;
  }

  const winner = getPlayer(store, game.winnerId);
  const loserId = game.playerIds.find((playerId) => playerId !== game.winnerId);
  const loser = getPlayer(store, loserId);

  if (winner) {
    winner.gamesPlayed += 1;
    winner.wins += 1;
    winner.rating += RANKING.win;
    winner.activeGameId = null;
  }

  if (loser) {
    loser.gamesPlayed += 1;
    loser.losses += 1;
    loser.rating = Math.max(RANKING.floor, loser.rating + RANKING.loss);
    loser.activeGameId = null;
  }

  game.resultRecorded = true;
}

function saveGame(store, game) {
  if (!game || game.status !== "active") {
    return { ok: false, error: "Only active games can be saved." };
  }

  game.status = "saved";
  game.savedAt = Date.now();
  game.updatedAt = Date.now();
  game.pendingCaptureBy = null;
  game.playerIds.forEach((playerId) => {
    const player = getPlayer(store, playerId);
    if (player) {
      player.activeGameId = null;
    }
  });
  return { ok: true };
}

function restoreGame(store, game) {
  if (!game || game.status !== "saved") {
    return { ok: false, error: "Only saved games can be restored." };
  }

  const blocked = game.playerIds.some((playerId) => {
    const player = getPlayer(store, playerId);
    return player?.activeGameId;
  });

  if (blocked) {
    return { ok: false, error: "One of the players is already in another active game." };
  }

  game.status = "active";
  game.savedAt = null;
  game.updatedAt = Date.now();
  game.playerIds.forEach((playerId) => {
    const player = getPlayer(store, playerId);
    if (player) {
      player.activeGameId = game.id;
    }
  });
  return { ok: true };
}

function serializeGame(game, viewerId) {
  if (!game) {
    return null;
  }

  return {
    ...game,
    meId: viewerId,
    millOwners: getMillOwnerMap(game)
  };
}

function buildDashboard(store, playerId) {
  const player = getPlayer(store, playerId);
  if (!player) {
    return null;
  }

  queueWithoutUnavailable(store);

  const incomingInvites = store.invites
    .filter((invite) => invite.to === playerId)
    .map((invite) => ({
      ...invite,
      fromPlayer: publicPlayer(getPlayer(store, invite.from))
    }));

  const outgoingInvites = store.invites
    .filter((invite) => invite.from === playerId)
    .map((invite) => ({
      ...invite,
      toPlayer: publicPlayer(getPlayer(store, invite.to))
    }));

  const leaderboard = [...store.players]
    .filter((entry) => !entry.guest)
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 12)
    .map(publicPlayer);

  const availablePlayers = store.players
    .filter((entry) => entry.id !== playerId && !entry.activeGameId)
    .map(publicPlayer);

  const openChallenges = store.queue
    .filter((entry) => entry.playerId !== playerId)
    .map((entry) => publicPlayer(getPlayer(store, entry.playerId)))
    .filter(Boolean);

  const savedGames = getSavedGamesFor(store, playerId).map((game) => ({
    id: game.id,
    playerIds: game.playerIds,
    playerNames: game.players.map((entry) => ({ id: entry.id, name: entry.name })),
    stage: game.stage,
    updatedAt: game.updatedAt,
    moveCount: game.moveCount,
    turn: game.turn
  }));

  return {
    player: publicPlayer(player),
    leaderboard,
    availablePlayers,
    incomingInvites,
    outgoingInvites,
    openChallenges,
    savedGames,
    inQueue: store.queue.some((entry) => entry.playerId === playerId),
    activeGameId: player.activeGameId
  };
}

function pushDashboard(store, playerId) {
  const payload = buildDashboard(store, playerId);
  if (!payload) {
    return;
  }
  const sockets = socketsByPlayer.get(playerId) || [];
  sockets.forEach((socket) => socket.emit("dashboard:update", payload));
}

function pushGame(store, playerId) {
  const game = getActiveGameFor(store, playerId);
  const sockets = socketsByPlayer.get(playerId) || [];
  sockets.forEach((socket) => socket.emit("game:update", serializeGame(game, playerId)));
}

function pushPlayers(store, playerIds) {
  [...new Set(playerIds)].forEach((playerId) => {
    pushDashboard(store, playerId);
    pushGame(store, playerId);
  });
}

function matchmake(store, challengerId) {
  queueWithoutUnavailable(store);
  const player = getPlayer(store, challengerId);
  if (!player || player.activeGameId) {
    return { ok: false, error: "You are not available for matchmaking." };
  }

  const candidates = store.queue
    .filter((entry) => entry.playerId !== challengerId)
    .map((entry) => getPlayer(store, entry.playerId))
    .filter((entry) => entry && !entry.activeGameId)
    .sort((a, b) => Math.abs(a.rating - player.rating) - Math.abs(b.rating - player.rating));

  if (!candidates.length) {
    return { ok: false };
  }

  return createGame(store, challengerId, candidates[0].id, "queue");
}

async function currentAuthPlayer(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const payload = verifyToken(token);
  if (!payload) {
    return null;
  }

  const store = await readStore();
  const player = getPlayer(store, payload.playerId);
  if (!player) {
    return null;
  }

  return { player, store, token };
}

async function requireAuth(req, res, next) {
  const auth = await currentAuthPlayer(req);
  if (!auth) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  req.auth = auth;
  next();
}

function renderIndex(useBuiltAssets) {
  const stylesheet = useBuiltAssets ? "/assets/styles.css" : "/src/client/styles.css";
  const script = useBuiltAssets ? "/assets/app.js" : "/src/client/app.js";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Navkankari</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="${stylesheet}">
  </head>
  <body>
    <div id="app"></div>
    <script src="/socket.io/socket.io.js"></script>
    <script type="module" src="${script}"></script>
  </body>
</html>`;
}

app.get("/api/bootstrap", async (req, res) => {
  const auth = await currentAuthPlayer(req);
  if (!auth) {
    res.json({ user: null, dashboard: null, game: null, config: { colors: PLAYER_COLORS } });
    return;
  }

  const { player, store } = auth;
  const dashboard = buildDashboard(store, player.id);
  const game = getActiveGameFor(store, player.id);
  res.json({
    user: publicPlayer(player),
    dashboard,
    game: serializeGame(game, player.id),
    config: { colors: PLAYER_COLORS }
  });
});

app.post("/api/auth/register", async (req, res) => {
  const name = sanitizeName(req.body.name);
  const password = String(req.body.password || "").trim();
  const favoriteColor = String(req.body.favoriteColor || PLAYER_COLORS[0].value);

  if (!name || !password) {
    res.status(400).json({ error: "Name and password are required." });
    return;
  }

  const { store, result } = await withStore(async (draft) => {
    if (draft.players.some((player) => player.name.toLowerCase() === name.toLowerCase())) {
      return { error: "That player name is already taken." };
    }

    const { salt, passwordHash } = hashPassword(password);
    const player = {
      id: uid("player"),
      name,
      salt,
      passwordHash,
      favoriteColor,
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
      rating: RANKING.base,
      activeGameId: null,
      guest: false,
      createdAt: Date.now()
    };

    draft.players.push(player);
    return { player };
  });

  if (result.error) {
    res.status(400).json({ error: result.error });
    return;
  }

  res.json({
    token: createToken(result.player.id),
    user: publicPlayer(result.player),
    dashboard: buildDashboard(store, result.player.id),
    game: null
  });
});

app.post("/api/auth/login", async (req, res) => {
  const store = await readStore();
  const name = sanitizeName(req.body.name);
  const password = String(req.body.password || "").trim();
  const player = store.players.find((entry) => entry.name.toLowerCase() === name.toLowerCase());

  if (!player || player.guest) {
    res.status(400).json({ error: "Name or password did not match." });
    return;
  }

  const attempt = hashPassword(password, player.salt).passwordHash;
  if (!safeCompare(attempt, player.passwordHash)) {
    res.status(400).json({ error: "Name or password did not match." });
    return;
  }

  res.json({
    token: createToken(player.id),
    user: publicPlayer(player),
    dashboard: buildDashboard(store, player.id),
    game: serializeGame(getActiveGameFor(store, player.id), player.id)
  });
});

app.post("/api/auth/guest", async (req, res) => {
  const favoriteColor = String(req.body.favoriteColor || PLAYER_COLORS[1].value);

  const { store, result } = await withStore(async (draft) => {
    let guestName = "";
    do {
      guestName = `Guest ${Math.floor(Math.random() * 900 + 100)}`;
    } while (draft.players.some((player) => player.name === guestName));

    const player = {
      id: uid("guest"),
      name: guestName,
      salt: "",
      passwordHash: "",
      favoriteColor,
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
      rating: RANKING.base,
      activeGameId: null,
      guest: true,
      createdAt: Date.now()
    };

    draft.players.push(player);
    return { player };
  });

  res.json({
    token: createToken(result.player.id),
    user: publicPlayer(result.player),
    dashboard: buildDashboard(store, result.player.id),
    game: null
  });
});

app.post("/api/profile/color", requireAuth, async (req, res) => {
  const favoriteColor = String(req.body.favoriteColor || "");
  const { store, result } = await withStore(async (draft) => {
    const player = getPlayer(draft, req.auth.player.id);
    if (!player) {
      return { error: "Player not found." };
    }
    player.favoriteColor = favoriteColor || player.favoriteColor;
    return { player };
  });

  if (result.error) {
    res.status(404).json({ error: result.error });
    return;
  }

  pushDashboard(store, result.player.id);
  res.json({ ok: true, user: publicPlayer(result.player) });
});

app.post("/api/invites", requireAuth, async (req, res) => {
  const from = req.auth.player.id;
  const to = String(req.body.opponentId || "");

  const { store, result } = await withStore(async (draft) => {
    if (!canStartNewGame(draft, from)) {
      return { error: "Finish or save your current game first." };
    }

    const opponent = getPlayer(draft, to);
    if (!opponent || opponent.activeGameId) {
      return { error: "That player is unavailable." };
    }

    if (draft.invites.some((invite) => invite.from === from && invite.to === to)) {
      return { error: "Invite already sent." };
    }

    draft.invites.push({
      id: uid("invite"),
      from,
      to,
      createdAt: Date.now()
    });

    return { affected: [from, to] };
  });

  if (result.error) {
    res.status(400).json({ error: result.error });
    return;
  }

  pushPlayers(store, result.affected);
  res.json({ ok: true });
});

app.post("/api/invites/:inviteId/accept", requireAuth, async (req, res) => {
  const viewerId = req.auth.player.id;
  const { store, result } = await withStore(async (draft) => {
    const invite = draft.invites.find((entry) => entry.id === req.params.inviteId && entry.to === viewerId);
    if (!invite) {
      return { error: "Invite not found.", status: 404 };
    }

    draft.invites = draft.invites.filter((entry) => entry.id !== invite.id);
    const gameResult = createGame(draft, invite.from, invite.to, "invite");
    if (!gameResult.ok) {
      return { error: gameResult.error, status: 400 };
    }

    return { game: gameResult.game, affected: gameResult.game.playerIds };
  });

  if (result.error) {
    res.status(result.status || 400).json({ error: result.error });
    return;
  }

  pushPlayers(store, result.affected);
  res.json({ ok: true, game: serializeGame(result.game, viewerId) });
});

app.post("/api/invites/:inviteId/decline", requireAuth, async (req, res) => {
  const { store, result } = await withStore(async (draft) => {
    const invite = draft.invites.find((entry) => entry.id === req.params.inviteId);
    if (!invite) {
      return { error: "Invite not found.", status: 404 };
    }

    draft.invites = draft.invites.filter((entry) => entry.id !== invite.id);
    return { affected: [invite.from, invite.to] };
  });

  if (result.error) {
    res.status(result.status || 400).json({ error: result.error });
    return;
  }

  pushPlayers(store, result.affected);
  res.json({ ok: true });
});

app.post("/api/matchmaking/join", requireAuth, async (req, res) => {
  const playerId = req.auth.player.id;
  const { store, result } = await withStore(async (draft) => {
    if (!canStartNewGame(draft, playerId)) {
      return { error: "Finish or save your current game first." };
    }

    draft.queue = draft.queue.filter((entry) => entry.playerId !== playerId);
    draft.queue.push({ playerId, createdAt: Date.now() });
    const matched = matchmake(draft, playerId);
    if (matched.ok) {
      return { matched: true, game: matched.game, affected: matched.game.playerIds };
    }

    return { matched: false, affected: [playerId] };
  });

  if (result.error) {
    res.status(400).json({ error: result.error });
    return;
  }

  pushPlayers(store, result.affected);
  if (result.matched) {
    res.json({ ok: true, matched: true, game: serializeGame(result.game, playerId) });
    return;
  }

  res.json({ ok: true, matched: false });
});

app.post("/api/matchmaking/leave", requireAuth, async (req, res) => {
  const playerId = req.auth.player.id;
  const { store } = await withStore(async (draft) => {
    draft.queue = draft.queue.filter((entry) => entry.playerId !== playerId);
    return {};
  });

  pushDashboard(store, playerId);
  res.json({ ok: true });
});

app.post("/api/games/:gameId/save", requireAuth, async (req, res) => {
  const { store, result } = await withStore(async (draft) => {
    const game = getGame(draft, req.params.gameId);
    if (!game || !game.playerIds.includes(req.auth.player.id)) {
      return { error: "Game not found.", status: 404 };
    }

    const saveResult = saveGame(draft, game);
    if (!saveResult.ok) {
      return { error: saveResult.error, status: 400 };
    }

    return { affected: game.playerIds };
  });

  if (result.error) {
    res.status(result.status || 400).json({ error: result.error });
    return;
  }

  pushPlayers(store, result.affected);
  res.json({ ok: true });
});

app.post("/api/games/:gameId/restore", requireAuth, async (req, res) => {
  const viewerId = req.auth.player.id;
  const { store, result } = await withStore(async (draft) => {
    const game = getGame(draft, req.params.gameId);
    if (!game || !game.playerIds.includes(viewerId)) {
      return { error: "Saved game not found.", status: 404 };
    }

    const restoreResult = restoreGame(draft, game);
    if (!restoreResult.ok) {
      return { error: restoreResult.error, status: 400 };
    }

    return { game, affected: game.playerIds };
  });

  if (result.error) {
    res.status(result.status || 400).json({ error: result.error });
    return;
  }

  pushPlayers(store, result.affected);
  res.json({ ok: true, game: serializeGame(result.game, viewerId) });
});

app.post("/api/games/:gameId/forfeit", requireAuth, async (req, res) => {
  const { store, result } = await withStore(async (draft) => {
    const game = getGame(draft, req.params.gameId);
    if (!game || !game.playerIds.includes(req.auth.player.id)) {
      return { error: "Game not found.", status: 404 };
    }

    const forfeitResult = applyGameAction(game, req.auth.player.id, { type: "forfeit" });
    if (!forfeitResult.ok) {
      return { error: forfeitResult.error, status: 400 };
    }

    settleFinishedGame(draft, game);
    return { affected: game.playerIds };
  });

  if (result.error) {
    res.status(result.status || 400).json({ error: result.error });
    return;
  }

  pushPlayers(store, result.affected);
  res.json({ ok: true });
});

app.post("/api/games/:gameId/action", requireAuth, async (req, res) => {
  const viewerId = req.auth.player.id;
  const { store, result } = await withStore(async (draft) => {
    const game = getGame(draft, req.params.gameId);
    if (!game || !game.playerIds.includes(viewerId)) {
      return { error: "Game not found.", status: 404 };
    }

    const actionResult = applyGameAction(game, viewerId, req.body);
    if (!actionResult.ok) {
      return { error: actionResult.error, status: 400 };
    }

    settleFinishedGame(draft, game);
    return {
      affected: game.playerIds,
      game: game.status === "active" ? game : null
    };
  });

  if (result.error) {
    res.status(result.status || 400).json({ error: result.error });
    return;
  }

  pushPlayers(store, result.affected);
  res.json({ ok: true, game: serializeGame(result.game, viewerId) });
});

app.use((req, res, next) => {
  if (req.path.startsWith("/api")) {
    next();
    return;
  }
  const useBuiltAssets = fs.existsSync(path.join(DIST_SERVER, "app.cjs")) && fs.existsSync(path.join(DIST_PUBLIC, "assets", "app.js"));
  res.type("html").send(renderIndex(useBuiltAssets));
});

io.use(async (socket, next) => {
  const payload = verifyToken(socket.handshake.auth?.token);
  if (!payload) {
    next(new Error("Authentication failed"));
    return;
  }
  socket.playerId = payload.playerId;
  next();
});

io.on("connection", async (socket) => {
  const playerId = socket.playerId;
  const sockets = socketsByPlayer.get(playerId) || [];
  sockets.push(socket);
  socketsByPlayer.set(playerId, sockets);

  const store = await readStore();
  pushDashboard(store, playerId);
  pushGame(store, playerId);

  socket.on("disconnect", () => {
    const remaining = (socketsByPlayer.get(playerId) || []).filter((entry) => entry.id !== socket.id);
    if (remaining.length) {
      socketsByPlayer.set(playerId, remaining);
    } else {
      socketsByPlayer.delete(playerId);
    }
  });
});

async function main() {
  await initDatabase();
  server.listen(PORT, () => {
    console.log(`Navkankari server running on http://localhost:${PORT}`);
  });
}

main().catch((error) => {
  console.error("Navkankari failed to start.", error);
  process.exit(1);
});
