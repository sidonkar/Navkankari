import {
  PLAYER_COLORS,
  GRID_POSITIONS,
  BOARD_LINES,
  getLegalMoves,
  playerStage,
  tryCaptureEligibleNodes
} from "../shared/game-rules.js";

const app = document.getElementById("app");
const TOKEN_KEY = "navkankari-auth-token";

const state = {
  token: localStorage.getItem(TOKEN_KEY) || "",
  user: null,
  dashboard: null,
  game: null,
  selectedNode: null,
  toasts: [],
  socket: null,
  config: {
    colors: PLAYER_COLORS
  }
};

const STAGE_COPY = {
  placement: "Place one pawn on any empty highlighted position.",
  movement: "Select one of your pawns, then move it to an adjacent empty point.",
  fly: "With three pawns left, you can fly to any empty point on the board."
};

bootstrap();

async function bootstrap() {
  try {
    const payload = await api("/api/bootstrap", { method: "GET", allowAnonymous: true });
    state.user = payload.user;
    state.dashboard = payload.dashboard;
    state.game = payload.game;
    state.config = payload.config || state.config;
    if (state.user) {
      connectSocket();
    }
    render();
  } catch (error) {
    toast(error.message || "Could not load Navkankari.");
    render();
  }
}

async function api(url, { method = "GET", body, allowAnonymous = false } = {}) {
  const headers = {};
  if (body) {
    headers["Content-Type"] = "application/json";
  }
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !allowAnonymous) {
      logout();
    }
    throw new Error(data.error || "Request failed.");
  }
  return data;
}

function saveSession(payload) {
  state.token = payload.token;
  localStorage.setItem(TOKEN_KEY, payload.token);
  state.user = payload.user;
  state.dashboard = payload.dashboard;
  state.game = payload.game;
  state.selectedNode = null;
  connectSocket(true);
  render();
}

function logout() {
  if (state.socket) {
    state.socket.disconnect();
    state.socket = null;
  }
  localStorage.removeItem(TOKEN_KEY);
  state.token = "";
  state.user = null;
  state.dashboard = null;
  state.game = null;
  state.selectedNode = null;
  render();
}

function connectSocket(reconnect = false) {
  if (!state.token || !window.io) {
    return;
  }

  if (state.socket && !reconnect) {
    return;
  }

  if (state.socket) {
    state.socket.disconnect();
  }

  state.socket = window.io({
    auth: { token: state.token }
  });

  state.socket.on("dashboard:update", (dashboard) => {
    state.dashboard = dashboard;
    if (dashboard?.player) {
      state.user = dashboard.player;
    }
    render();
  });

  state.socket.on("game:update", (game) => {
    state.game = game;
    if (!game) {
      state.selectedNode = null;
    } else if (state.selectedNode && game.board[state.selectedNode] !== state.user.id) {
      state.selectedNode = null;
    }
    render();
  });

  state.socket.on("connect_error", () => {
    toast("Live sync could not connect. You can still refresh manually.");
  });
}

function toast(message) {
  const item = { id: crypto.randomUUID(), message };
  state.toasts.push(item);
  state.toasts = state.toasts.slice(-4);
  render();
  window.setTimeout(() => {
    state.toasts = state.toasts.filter((entry) => entry.id !== item.id);
    render();
  }, 2600);
}

function rankTier(rating) {
  if (rating >= 170) return "Grandmaster";
  if (rating >= 145) return "Strategist";
  if (rating >= 120) return "Challenger";
  if (rating >= 95) return "Rising";
  return "Apprentice";
}

function winRate(player) {
  if (!player?.gamesPlayed) {
    return "New";
  }
  return `${Math.round((player.wins / player.gamesPlayed) * 100)}%`;
}

function formatStage(stage) {
  return stage === "fly" ? "Fly" : `${stage[0].toUpperCase()}${stage.slice(1)}`;
}

function formatClock(timestamp) {
  if (!timestamp) {
    return "Just now";
  }
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(timestamp));
}

function latestMoveSummary(game) {
  if (!game?.lastMove) {
    return "No move yet. The opening placement will set the tone.";
  }
  if (game.lastMove.type === "place") {
    return `${playerName(game, game.lastMove.playerId)} placed a pawn at ${game.lastMove.to}.`;
  }
  if (game.lastMove.type === "capture") {
    return `${playerName(game, game.lastMove.playerId)} captured a pawn at ${game.lastMove.target}.`;
  }
  return `${playerName(game, game.lastMove.playerId)} ${game.lastMove.type === "fly" ? "flew" : "moved"} from ${game.lastMove.from} to ${game.lastMove.to}.`;
}

function playerName(game, playerId) {
  return game?.players?.find((entry) => entry.id === playerId)?.name || "Unknown";
}

function getMyParticipant(game) {
  return game?.players?.find((entry) => entry.id === state.user.id) || null;
}

function getOpponentParticipant(game) {
  return game?.players?.find((entry) => entry.id !== state.user.id) || null;
}

function boardStagePrompt(game) {
  if (!game) {
    return "";
  }
  if (game.pendingCaptureBy === state.user.id) {
    return "You formed a mill. Capture an opponent pawn. If one outside a mill exists, it must be taken first.";
  }
  if (game.turn !== state.user.id) {
    return "Your opponent is thinking. Watch the board and plan your next mill.";
  }
  return STAGE_COPY[playerStage(game, state.user.id)];
}

function nodeSelectable(game, node) {
  if (!game || game.status !== "active") {
    return false;
  }

  if (game.pendingCaptureBy === state.user.id) {
    return tryCaptureEligibleNodes(game, state.user.id).includes(node);
  }

  if (game.turn !== state.user.id) {
    return false;
  }

  const stage = playerStage(game, state.user.id);
  if (stage === "placement") {
    return !game.board[node];
  }

  if (state.selectedNode) {
    if (node === state.selectedNode) {
      return true;
    }
    if (!game.board[node]) {
      return getLegalMoves(game, state.selectedNode, state.user.id).includes(node);
    }
  }

  return game.board[node] === state.user.id;
}

async function handleRegister(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const payload = await api("/api/auth/register", {
    method: "POST",
    body: {
      name: form.get("name"),
      password: form.get("password"),
      favoriteColor: form.get("favoriteColor")
    }
  });
  saveSession(payload);
  toast(`Welcome to Navkankari, ${payload.user.name}.`);
}

async function handleLogin(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const payload = await api("/api/auth/login", {
    method: "POST",
    body: {
      name: form.get("name"),
      password: form.get("password")
    }
  });
  saveSession(payload);
  toast(`Welcome back, ${payload.user.name}.`);
}

async function handleGuest() {
  const payload = await api("/api/auth/guest", {
    method: "POST",
    body: {
      favoriteColor: PLAYER_COLORS[1].value
    }
  });
  saveSession(payload);
  toast(`${payload.user.name} joined as guest.`);
}

async function updateColor() {
  const select = document.getElementById("favorite-color-select");
  if (!select) {
    return;
  }
  await api("/api/profile/color", {
    method: "POST",
    body: { favoriteColor: select.value }
  });
  toast("Pawn color updated.");
}

async function sendInvite(opponentId) {
  await api("/api/invites", {
    method: "POST",
    body: { opponentId }
  });
  toast("Invite sent.");
}

async function acceptInvite(inviteId) {
  const payload = await api(`/api/invites/${inviteId}/accept`, { method: "POST" });
  state.game = payload.game;
  state.selectedNode = null;
  render();
}

async function declineInvite(inviteId) {
  await api(`/api/invites/${inviteId}/decline`, { method: "POST" });
}

async function joinQueue() {
  const payload = await api("/api/matchmaking/join", { method: "POST" });
  if (!payload.matched) {
    toast("Open challenge posted. We'll match you when someone close in rank is ready.");
  }
}

async function leaveQueue() {
  await api("/api/matchmaking/leave", { method: "POST" });
}

async function saveCurrentGame() {
  if (!state.game) return;
  await api(`/api/games/${state.game.id}/save`, { method: "POST" });
  state.game = null;
  state.selectedNode = null;
  toast("Game saved. You can restore it later.");
}

async function restoreGame(gameId) {
  const payload = await api(`/api/games/${gameId}/restore`, { method: "POST" });
  state.game = payload.game;
  state.selectedNode = null;
  render();
}

async function forfeitCurrentGame() {
  if (!state.game) return;
  if (!window.confirm("Forfeit this match? It will count as a loss and end the game immediately.")) {
    return;
  }
  await api(`/api/games/${state.game.id}/forfeit`, { method: "POST" });
  state.game = null;
  state.selectedNode = null;
}

async function sendGameAction(body) {
  if (!state.game) return;
  const payload = await api(`/api/games/${state.game.id}/action`, {
    method: "POST",
    body
  });
  state.game = payload.game;
  if (!payload.game) {
    state.selectedNode = null;
  }
}

async function handleBoardClick(node) {
  const game = state.game;
  if (!game || game.status !== "active") {
    return;
  }

  if (game.pendingCaptureBy === state.user.id) {
    await sendGameAction({ type: "capture", node });
    return;
  }

  if (game.turn !== state.user.id) {
    return;
  }

  const stage = playerStage(game, state.user.id);
  if (stage === "placement") {
    if (!game.board[node]) {
      await sendGameAction({ type: "place", node });
    }
    return;
  }

  const owner = game.board[node];
  if (owner === state.user.id) {
    state.selectedNode = state.selectedNode === node ? null : node;
    render();
    return;
  }

  if (state.selectedNode && !owner && getLegalMoves(game, state.selectedNode, state.user.id).includes(node)) {
    await sendGameAction({ type: "move", from: state.selectedNode, to: node });
    state.selectedNode = null;
  }
}

function render() {
  if (!state.user) {
    app.innerHTML = renderAuthShell();
    bindAuthEvents();
    renderToasts();
    return;
  }

  app.innerHTML = `
    <div class="shell">
      ${renderHero()}
      ${state.game ? renderGame() : renderDashboard()}
      <div class="footer-note">Persistent local accounts, realtime play, matchmaking, saves, and resumable matches.</div>
    </div>
    <div class="toast-wrap"></div>
  `;

  bindAppEvents();
  renderToasts();
}

function renderHero() {
  return `
    <section class="hero">
      <div class="hero-copy">
        <h1>Navkankari</h1>
        <p>A modern local multiplayer arena for the classic nine-pawn strategy battle. Build mills, pound relentlessly, capture cleanly, and outmaneuver your rival across the exact 24-point field.</p>
      </div>
      <div class="hero-badges">
        <div class="pill">2 players · 9 pawns each</div>
        <div class="pill">Placement, Movement, Fly</div>
        <div class="pill">Persistent account: ${state.user.name}</div>
        <div class="pill">Rank tier: ${rankTier(state.user.rating)}</div>
      </div>
    </section>
  `;
}

function renderAuthShell() {
  return `
    <div class="shell">
      <section class="hero">
        <div class="hero-copy">
          <h1>Navkankari</h1>
          <p>Create an account, jump in as a guest, and play live matches with saved progress, invitations, matchmaking, rankings, and resumable games.</p>
        </div>
        <div class="hero-badges">
          <div class="pill">Persistent local accounts</div>
          <div class="pill">Live matchmaking</div>
          <div class="pill">Save and restore games</div>
        </div>
      </section>
      <section class="auth-grid">
        <div class="auth-card">
          <div class="section-head">
            <div>
              <h2>Enter The Arena</h2>
              <div class="muted">Choose the fastest way to start playing.</div>
            </div>
          </div>
          <div class="auth-stack">
            <form id="register-form" class="form-grid">
              <h3>Create account</h3>
              <label>Player name<input name="name" maxlength="24" placeholder="Choose a display name"></label>
              <label>Password<input type="password" name="password" maxlength="40" placeholder="Create a password"></label>
              <label>Pawn color
                <select name="favoriteColor">
                  ${PLAYER_COLORS.map((color) => `<option value="${color.value}">${color.name}</option>`).join("")}
                </select>
              </label>
              <button class="btn-primary" type="submit">Register & Play</button>
            </form>
            <form id="login-form" class="form-grid">
              <h3>Login</h3>
              <label>Player name<input name="name" maxlength="24" placeholder="Existing player"></label>
              <label>Password<input type="password" name="password" maxlength="40" placeholder="Your password"></label>
              <button class="btn-secondary" type="submit">Login</button>
            </form>
            <div class="card-lite">
              <h3>Play as guest</h3>
              <p class="muted">Guests can play instantly. Registered players keep their ranking history across sessions.</p>
              <button id="guest-btn" class="btn-ghost" type="button">Play as Guest</button>
            </div>
          </div>
        </div>
        <div class="auth-card">
          <div class="section-head">
            <div>
              <h2>The Match Flow</h2>
              <div class="muted">Easy to start, hard to put down.</div>
            </div>
          </div>
          <div class="stack">
            <div class="status-card">
              <h3>1. Placement</h3>
              <p class="muted">Each player places nine pawns on the 24 highlighted positions shown in the original board layout.</p>
            </div>
            <div class="status-card">
              <h3>2. Movement</h3>
              <p class="muted">After placement ends, pawns move only along connected lines to adjacent empty positions.</p>
            </div>
            <div class="status-card">
              <h3>3. Fly</h3>
              <p class="muted">With only three pawns left, a player may jump to any empty position and mount a comeback.</p>
            </div>
          </div>
        </div>
      </section>
      <div class="toast-wrap"></div>
    </div>
  `;
}

function renderDashboard() {
  const dashboard = state.dashboard;
  return `
    <section class="dashboard-grid">
      <div class="panel">
        <div class="section-head">
          <div>
            <h2>Dashboard</h2>
            <div class="muted">Invite friends, queue up, or resume your saved battles.</div>
          </div>
          <div class="button-row">
            <button id="logout-btn" class="btn-secondary" type="button">Logout</button>
          </div>
        </div>

        <div class="stats-grid four">
          <div class="stat-card"><div class="stat-label">Games</div><div class="stat-value">${state.user.gamesPlayed}</div></div>
          <div class="stat-card"><div class="stat-label">Wins</div><div class="stat-value success">${state.user.wins}</div></div>
          <div class="stat-card"><div class="stat-label">Losses</div><div class="stat-value danger">${state.user.losses}</div></div>
          <div class="stat-card"><div class="stat-label">Ranking</div><div class="stat-value accent">${state.user.rating}</div></div>
        </div>

        <div class="mini-grid" style="margin-top:16px;">
          <div class="card-lite">
            <h3>Your style</h3>
            <div class="muted">Choose the pawn color used in your next match. Tier: <strong class="accent">${rankTier(state.user.rating)}</strong>.</div>
            <label style="margin-top:12px;">Pawn color
              <select id="favorite-color-select">
                ${PLAYER_COLORS.map((color) => `<option value="${color.value}" ${state.user.favoriteColor === color.value ? "selected" : ""}>${color.name}</option>`).join("")}
              </select>
            </label>
            <div class="button-row" style="margin-top:12px;">
              <button id="save-color-btn" class="btn-secondary" type="button">Save Color</button>
              <span class="tag"><span class="dot" style="color:${state.user.favoriteColor}; background:${state.user.favoriteColor};"></span>Current</span>
            </div>
          </div>
          <div class="card-lite">
            <h3>Current session</h3>
            <div class="list compact-list" style="margin-top:12px;">
              <div class="inline-stat"><span class="muted">Win rate</span><strong>${winRate(state.user)}</strong></div>
              <div class="inline-stat"><span class="muted">Queue status</span><strong>${dashboard.inQueue ? "Queued" : "Idle"}</strong></div>
              <div class="inline-stat"><span class="muted">Live game</span><strong>${dashboard.activeGameId ? "In progress" : "None"}</strong></div>
            </div>
            <div class="button-row" style="margin-top:12px;">
              <button id="resume-game-btn" class="btn-primary" type="button" ${dashboard.activeGameId ? "" : "disabled"}>Resume Active Game</button>
            </div>
          </div>
        </div>

        <div class="coach-card" style="margin-top:16px;">
          <div>
            <strong>${dashboard.activeGameId ? "Your match is waiting" : "Ready for another great game?"}</strong>
            <div class="muted">${dashboard.activeGameId ? "You can only play one live game at a time until it is saved or finished." : "Join the open pool for live matchmaking or invite a specific opponent directly."}</div>
          </div>
          <span class="tag ${dashboard.activeGameId ? "danger" : "success"}">${dashboard.activeGameId ? "One active game only" : "Free to queue"}</span>
        </div>

        <div class="panel card-lite" style="margin-top:16px;">
          <div class="section-head">
            <div>
              <h3>Start Playing</h3>
              <div class="muted">Live matchmaking pairs you with players of similar ranking.</div>
            </div>
          </div>
          <div class="action-grid">
            <button id="open-pool-btn" class="btn-primary" type="button" ${dashboard.activeGameId ? "disabled" : ""}>${dashboard.inQueue ? "Refresh Open Match" : "Join Open Match Pool"}</button>
            <button id="leave-pool-btn" class="btn-secondary" type="button" ${dashboard.inQueue ? "" : "disabled"}>Leave Pool</button>
          </div>
          <div class="players-grid" style="margin-top:14px;">
            ${dashboard.availablePlayers.length ? dashboard.availablePlayers.map((entry) => `
              <div class="player-card">
                <div class="section-head">
                  <div>
                    <strong>${entry.name}</strong>
                    <div class="muted">${rankTier(entry.rating)} | Ranking ${entry.rating}</div>
                  </div>
                  <span class="tag"><span class="dot" style="color:${entry.favoriteColor}; background:${entry.favoriteColor};"></span>${entry.guest ? "Guest" : "Ready"}</span>
                </div>
                <div class="button-row">
                  <button class="btn-ghost invite-btn" data-player-id="${entry.id}" type="button" ${dashboard.activeGameId ? "disabled" : ""}>Invite</button>
                </div>
              </div>
            `).join("") : `<div class="empty-state">No free players right now. Open another browser window to create another account, or wait in the queue.</div>`}
          </div>
        </div>

        <div class="mini-grid" style="margin-top:16px;">
          <div class="card-lite">
            <h3>Incoming invites</h3>
            <div class="match-list">
              ${dashboard.incomingInvites.length ? dashboard.incomingInvites.map((invite) => `
                <div class="match-card">
                  <strong>${invite.fromPlayer.name}</strong>
                  <div class="muted">${rankTier(invite.fromPlayer.rating)} sent you a challenge.</div>
                  <div class="button-row" style="margin-top:12px;">
                    <button class="btn-primary accept-invite-btn" data-invite-id="${invite.id}" type="button" ${dashboard.activeGameId ? "disabled" : ""}>Accept</button>
                    <button class="btn-secondary decline-invite-btn" data-invite-id="${invite.id}" type="button">Decline</button>
                  </div>
                </div>
              `).join("") : `<div class="empty-state">No incoming invites right now.</div>`}
            </div>
          </div>
          <div class="card-lite">
            <h3>Open pool nearby</h3>
            <div class="match-list">
              ${dashboard.openChallenges.length ? dashboard.openChallenges.map((entry) => `
                <div class="match-card">
                  <strong>${entry.name}</strong>
                  <div class="muted">${rankTier(entry.rating)} | Rating gap ${Math.abs(entry.rating - state.user.rating)}</div>
                </div>
              `).join("") : `<div class="empty-state">Nobody else is waiting in the queue yet.</div>`}
            </div>
          </div>
        </div>

        <div class="mini-grid" style="margin-top:16px;">
          <div class="card-lite">
            <h3>Sent invites</h3>
            <div class="list">
              ${dashboard.outgoingInvites.length ? dashboard.outgoingInvites.map((invite) => `
                <div class="match-card">
                  <strong>${invite.toPlayer.name}</strong>
                  <div class="muted">Waiting for response.</div>
                </div>
              `).join("") : `<div class="empty-state">No pending invites.</div>`}
            </div>
          </div>
          <div class="card-lite">
            <h3>Saved games</h3>
            <div class="saved-list">
              ${dashboard.savedGames.length ? dashboard.savedGames.map((game) => `
                <div class="save-card">
                  <strong>${game.playerNames.map((entry) => entry.name).join(" vs ")}</strong>
                  <div class="muted">${formatStage(game.stage)} stage | ${game.moveCount} turns played</div>
                  <div class="muted">Turn: ${game.playerNames.find((entry) => entry.id === game.turn)?.name || "Unknown"} | Updated ${formatClock(game.updatedAt)}</div>
                  <div class="button-row" style="margin-top:12px;">
                    <button class="btn-primary restore-btn" data-game-id="${game.id}" type="button" ${dashboard.activeGameId ? "disabled" : ""}>Restore</button>
                  </div>
                </div>
              `).join("") : `<div class="empty-state">No saved games yet.</div>`}
            </div>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="section-head">
          <div>
            <h2>Leaderboard</h2>
            <div class="muted">Base ranking is 100. Wins add 12 points, losses deduct 8 points.</div>
          </div>
        </div>
        <div class="leaderboard-list">
          ${dashboard.leaderboard.map((entry, index) => `
            <div class="leader-row">
              <div class="section-head">
                <div>
                  <strong>#${index + 1} ${entry.name}</strong>
                  <div class="muted">${entry.wins}W / ${entry.losses}L | ${rankTier(entry.rating)}</div>
                </div>
                <div class="accent">${entry.rating}</div>
              </div>
              <div class="progress-line"><span style="width:${Math.min(100, Math.max(12, entry.rating - 40))}%"></span></div>
            </div>
          `).join("")}
        </div>
      </div>
    </section>
  `;
}

function renderGame() {
  const game = state.game;
  const me = getMyParticipant(game);
  const opponent = getOpponentParticipant(game);
  const millOwners = game.millOwners || {};
  const myMoves = Object.keys(game.board)
    .filter((node) => game.board[node] === state.user.id)
    .reduce((sum, node) => sum + getLegalMoves(game, node, state.user.id).length, 0);
  const opponentMoves = Object.keys(game.board)
    .filter((node) => game.board[node] === opponent.id)
    .reduce((sum, node) => sum + getLegalMoves(game, node, opponent.id).length, 0);

  return `
    <section class="game-grid">
      <div class="game-card board-wrap">
        <div class="turn-banner">
          <div class="turn-main">
            <div class="tag"><span class="dot" style="color:${me.color}; background:${me.color};"></span>${me.name}</div>
            <h2>${game.pendingCaptureBy === state.user.id ? "Capture an opponent pawn" : game.turn === state.user.id ? `Your turn | ${formatStage(playerStage(game, state.user.id))}` : `${opponent.name}'s turn`}</h2>
            <div class="muted">${boardStagePrompt(game)}</div>
          </div>
          <div class="button-row">
            <button id="save-game-btn" class="btn-ghost" type="button">Save & Exit</button>
            <button id="forfeit-btn" class="btn-danger" type="button">Forfeit</button>
          </div>
        </div>
        <div class="board-shell">
          <div class="board">
            <div class="board-center-glow"></div>
            ${BOARD_LINES.map((line) => line.type === "horizontal"
              ? `<div class="board-line horizontal" style="left:${line.left}%; top:${line.top}%; width:${line.width}%"></div>`
              : `<div class="board-line vertical" style="left:${line.left}%; top:${line.top}%; height:${line.height}%"></div>`
            ).join("")}
            ${Object.entries(GRID_POSITIONS).map(([node, position]) => {
              const ownerId = game.board[node];
              const occupant = ownerId ? game.players.find((entry) => entry.id === ownerId) : null;
              const captureTarget = game.pendingCaptureBy === state.user.id && tryCaptureEligibleNodes(game, state.user.id).includes(node);
              const selected = state.selectedNode === node;
              const selectable = nodeSelectable(game, node);
              const millHighlight = Boolean(millOwners[node]?.length);
              const myMill = millOwners[node]?.includes(state.user.id);
              const opponentMill = occupant && millOwners[node]?.includes(occupant.id) && occupant.id !== state.user.id;
              const lastFrom = game.lastMove?.from === node;
              const lastTo = game.lastMove?.to === node || game.lastMove?.target === node;
              return `
                <button class="node ${selected ? "selected" : ""} ${selectable ? "selectable" : ""} ${captureTarget ? "capture-target" : ""} ${millHighlight ? "mill-highlight" : ""} ${myMill ? "mill-friendly" : ""} ${opponentMill ? "mill-opponent" : ""} ${lastFrom ? "last-from" : ""} ${lastTo ? "last-to" : ""}" data-node="${node}" style="left:${position.x}%; top:${position.y}%;" type="button">
                  ${occupant ? `<span class="pawn ${game.lastMove?.playerId === ownerId && lastTo ? "pawn-arrived" : ""}" style="background:${occupant.color};"></span>` : ""}
                </button>
              `;
            }).join("")}
          </div>
        </div>
      </div>

      <div class="game-sidebar">
        <div class="game-card">
          <div class="game-header">
            <div>
              <h2>Match Status</h2>
              <div class="muted">${me.name} vs ${opponent.name}</div>
            </div>
            <span class="tag">${formatStage(game.stage)}</span>
          </div>
          <div class="timeline" style="margin-top:16px;">
            ${["placement", "movement", "fly"].map((step) => `
              <div class="timeline-item ${playerStage(game, state.user.id) === step ? "timeline-item-active" : ""}">
                <strong>${formatStage(step)}</strong>
                <div class="muted">${STAGE_COPY[step]}</div>
              </div>
            `).join("")}
          </div>
          <div class="mini-grid" style="margin-top:16px;">
            ${game.players.map((participant) => `
              <div class="status-card">
                <div class="tag"><span class="dot" style="color:${participant.color}; background:${participant.color};"></span>${participant.name}</div>
                <div class="stack" style="margin-top:12px;">
                  <div class="muted">In hand: <strong class="accent">${participant.pawnsInHand}</strong></div>
                  <div class="muted">On board: <strong class="accent">${participant.pawnsOnBoard}</strong></div>
                  <div class="muted">Captures: <strong class="accent">${participant.captures}</strong></div>
                  <div class="muted">Mode: <strong class="accent">${formatStage(playerStage(game, participant.id))}</strong></div>
                </div>
              </div>
            `).join("")}
          </div>
        </div>

        <div class="game-card">
          <h3>How to play this turn</h3>
          <div class="timeline">
            <div class="timeline-item">${boardStagePrompt(game)}</div>
            <div class="timeline-item">${latestMoveSummary(game)}</div>
            <div class="timeline-item">Pounding is allowed. You may break your own mill and reform it on a later turn to capture again.</div>
            <div class="timeline-item">Victory comes after 7 captures or when your opponent has no legal move left.</div>
          </div>
        </div>

        <div class="game-card">
          <h3>Pressure meter</h3>
          <div class="stack">
            <div class="inline-stat"><span class="muted">Your capture progress</span><strong>${me.captures} / 7</strong></div>
            <div class="progress-line"><span style="width:${(me.captures / 7) * 100}%"></span></div>
            <div class="inline-stat"><span class="muted">${opponent.name} capture progress</span><strong>${opponent.captures} / 7</strong></div>
            <div class="progress-line"><span style="width:${(opponent.captures / 7) * 100}%"></span></div>
            <div class="inline-stat"><span class="muted">Your legal moves</span><strong>${myMoves}</strong></div>
            <div class="inline-stat"><span class="muted">${opponent.name} legal moves</span><strong>${opponentMoves}</strong></div>
          </div>
        </div>

        <div class="game-card">
          <h3>Recent moves</h3>
          <div class="timeline">
            ${game.history.slice(0, 8).map((item) => `<div class="timeline-item">${item}</div>`).join("")}
          </div>
        </div>
      </div>
    </section>
  `;
}

function bindAuthEvents() {
  document.getElementById("register-form")?.addEventListener("submit", (event) => {
    handleRegister(event).catch((error) => toast(error.message));
  });
  document.getElementById("login-form")?.addEventListener("submit", (event) => {
    handleLogin(event).catch((error) => toast(error.message));
  });
  document.getElementById("guest-btn")?.addEventListener("click", () => {
    handleGuest().catch((error) => toast(error.message));
  });
}

function bindAppEvents() {
  document.getElementById("logout-btn")?.addEventListener("click", logout);
  document.getElementById("save-color-btn")?.addEventListener("click", () => {
    updateColor().catch((error) => toast(error.message));
  });
  document.getElementById("resume-game-btn")?.addEventListener("click", () => render());
  document.getElementById("open-pool-btn")?.addEventListener("click", () => joinQueue().catch((error) => toast(error.message)));
  document.getElementById("leave-pool-btn")?.addEventListener("click", () => leaveQueue().catch((error) => toast(error.message)));
  document.getElementById("save-game-btn")?.addEventListener("click", () => saveCurrentGame().catch((error) => toast(error.message)));
  document.getElementById("forfeit-btn")?.addEventListener("click", () => forfeitCurrentGame().catch((error) => toast(error.message)));

  document.querySelectorAll(".invite-btn").forEach((button) => {
    button.addEventListener("click", () => sendInvite(button.dataset.playerId).catch((error) => toast(error.message)));
  });

  document.querySelectorAll(".accept-invite-btn").forEach((button) => {
    button.addEventListener("click", () => acceptInvite(button.dataset.inviteId).catch((error) => toast(error.message)));
  });

  document.querySelectorAll(".decline-invite-btn").forEach((button) => {
    button.addEventListener("click", () => declineInvite(button.dataset.inviteId).catch((error) => toast(error.message)));
  });

  document.querySelectorAll(".restore-btn").forEach((button) => {
    button.addEventListener("click", () => restoreGame(button.dataset.gameId).catch((error) => toast(error.message)));
  });

  document.querySelectorAll(".node").forEach((button) => {
    button.addEventListener("click", () => handleBoardClick(button.dataset.node).catch((error) => toast(error.message)));
  });
}

function renderToasts() {
  const wrap = document.querySelector(".toast-wrap");
  if (!wrap) {
    return;
  }
  wrap.innerHTML = state.toasts.map((entry) => `<div class="toast">${entry.message}</div>`).join("");
}
