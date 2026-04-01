import {
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
  authMode: "login",
  selectedNode: null,
  toasts: [],
  socket: null,
  config: {}
};

let lastPresencePingAt = 0;
let presenceTrackingReady = false;

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

function applyLocalState(payload) {
  if (!payload) {
    return;
  }
  if (payload.user) {
    state.user = payload.user;
  }
  if (Object.hasOwn(payload, "dashboard")) {
    state.dashboard = payload.dashboard;
  }
  if (Object.hasOwn(payload, "game")) {
    state.game = payload.game;
    if (!payload.game) {
      state.selectedNode = null;
    } else if (state.selectedNode && payload.game.board[state.selectedNode] !== state.user.id) {
      state.selectedNode = null;
    }
  }
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

function reportPresence(force = false) {
  if (!state.socket?.connected) {
    return;
  }
  const now = Date.now();
  if (!force && now - lastPresencePingAt < 20000) {
    return;
  }
  lastPresencePingAt = now;
  state.socket.emit("presence:active");
}

function ensurePresenceTracking() {
  if (presenceTrackingReady) {
    return;
  }
  presenceTrackingReady = true;

  ["pointerdown", "keydown", "touchstart", "mousemove"].forEach((eventName) => {
    window.addEventListener(eventName, () => reportPresence(), { passive: true });
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      reportPresence(true);
    }
  });

  window.addEventListener("focus", () => {
    reportPresence(true);
  });

  window.setInterval(() => {
    reportPresence();
  }, 30000);
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

  ensurePresenceTracking();

  state.socket.on("connect", () => {
    reportPresence(true);
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

  state.socket.on("notice", (payload) => {
    if (payload?.message) {
      toast(payload.message);
    }
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
      email: form.get("email"),
      phone: form.get("phone"),
      password: form.get("password"),
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

async function handleForgotPassword(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const name = String(form.get("name") || "").trim();
  const email = String(form.get("email") || "").trim();
  const password = String(form.get("password") || "");
  const confirmPassword = String(form.get("confirmPassword") || "");

  if (password !== confirmPassword) {
    throw new Error("The new passwords do not match.");
  }

  await api("/api/auth/forgot-password", {
    method: "POST",
    body: {
      name,
      email,
      password
    }
  });

  state.authMode = "login";
  render();
  toast("Password updated. You can log in now.");
}

async function sendInvite(opponentId) {
  const payload = await api("/api/invites", {
    method: "POST",
    body: { opponentId }
  });
  applyLocalState(payload);
  render();
  toast("Invite sent.");
}

async function acceptInvite(inviteId) {
  const payload = await api(`/api/invites/${inviteId}/accept`, { method: "POST" });
  applyLocalState(payload);
  render();
}

async function declineInvite(inviteId) {
  const payload = await api(`/api/invites/${inviteId}/decline`, { method: "POST" });
  applyLocalState(payload);
  render();
}

async function cancelInvite(inviteId) {
  const payload = await api(`/api/invites/${inviteId}/decline`, { method: "POST" });
  applyLocalState(payload);
  render();
}

async function saveCurrentGame() {
  if (!state.game) return;
  const payload = await api(`/api/games/${state.game.id}/save`, { method: "POST" });
  applyLocalState(payload);
  render();
  toast("Game saved. You can restore it later.");
}

async function restoreGame(gameId) {
  const payload = await api(`/api/games/${gameId}/restore`, { method: "POST" });
  applyLocalState(payload);
  render();
}

async function forfeitCurrentGame() {
  if (!state.game) return;
  if (!window.confirm("Forfeit this match? It will count as a loss and end the game immediately.")) {
    return;
  }
  const payload = await api(`/api/games/${state.game.id}/forfeit`, { method: "POST" });
  applyLocalState(payload);
  render();
}

async function closeFinishedGame() {
  if (!state.game) return;
  const payload = await api(`/api/games/${state.game.id}/close`, { method: "POST" });
  applyLocalState(payload);
  render();
}

async function sendGameAction(body) {
  if (!state.game) return;
  const payload = await api(`/api/games/${state.game.id}/action`, {
    method: "POST",
    body
  });
  applyLocalState(payload);
  render();
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
      <div class="footer-note">Navkankari brings the classic board into a brighter, smoother live-play experience.</div>
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
      <div class="hero-side">
        ${state.user ? `
          <div class="hero-user">
            <span class="tag">Signed in as <strong>${state.user.name}</strong></span>
            <button id="logout-btn" class="btn-secondary" type="button">Logout</button>
          </div>
        ` : `
          <div class="hero-badges">
            <span class="pill">Invite-based play</span>
            <span class="pill">Realtime sync</span>
            <span class="pill">Save and restore</span>
          </div>
        `}
      </div>
    </section>
  `;
}

function renderAuthShell() {
  const authTitle = state.authMode === "register"
    ? "Create your player account"
    : state.authMode === "recover"
      ? "Recover your password"
      : "Welcome back";
  const authSubtitle = state.authMode === "register"
    ? "Set up your account with your name, email, and phone number, then step straight into your first match."
    : state.authMode === "recover"
      ? "Verify your player name and email, then set a new password."
      : "Sign in to continue your matches, invites, and saved games.";

  return `
    <div class="shell">
      <section class="hero">
        <div class="hero-copy">
          <h1>Navkankari</h1>
          <p>Create an account, sign in, and play live invite-based matches with saved progress, rankings, and resumable games.</p>
        </div>
        <div class="hero-badges">
          <span class="pill">Two-player duels</span>
          <span class="pill">Live invites</span>
          <span class="pill">Fast rematches</span>
        </div>
      </section>
      <section class="auth-grid">
        <div class="auth-card">
          <div class="auth-head">
            <div>
              <h2>${authTitle}</h2>
              <div class="muted">${authSubtitle}</div>
            </div>
            <div class="auth-links">
              <button id="go-login-btn" class="auth-link ${state.authMode === "login" ? "auth-link-active" : ""}" type="button">Login</button>
            </div>
          </div>
          <div class="auth-stack">
            ${state.authMode === "register" ? `<form id="register-form" class="form-grid">
              <h3>Create account</h3>
              <label>Player name<input name="name" maxlength="24" placeholder="Choose a display name"></label>
              <label>Email address<input type="email" name="email" maxlength="120" placeholder="you@example.com"></label>
              <label>Phone number<input type="tel" name="phone" maxlength="20" placeholder="Your mobile number"></label>
              <label>Password<input type="password" name="password" maxlength="40" placeholder="Create a password"></label>
              <button class="btn-primary" type="submit">Register & Play</button>
              <div class="auth-footnote">Already have an account? <button id="switch-to-login-btn" class="text-link" type="button">Login</button></div>
            </form>` : state.authMode === "recover" ? `<form id="recover-form" class="form-grid">
              <h3>Reset password</h3>
              <label>Player name<input name="name" maxlength="24" placeholder="Your player name"></label>
              <label>Email address<input type="email" name="email" maxlength="120" placeholder="Email used to register"></label>
              <label>New password<input type="password" name="password" maxlength="40" placeholder="Choose a new password"></label>
              <label>Confirm new password<input type="password" name="confirmPassword" maxlength="40" placeholder="Type it again"></label>
              <button class="btn-primary" type="submit">Update password</button>
              <div class="auth-footnote">Remembered it? <button id="switch-to-login-btn" class="text-link" type="button">Back to login</button></div>
            </form>` : `<form id="login-form" class="form-grid">
              <h3>Login</h3>
              <label>Player name<input name="name" maxlength="24" placeholder="Existing player"></label>
              <label>Password<input type="password" name="password" maxlength="40" placeholder="Your password"></label>
              <button class="btn-primary" type="submit">Login</button>
              <div class="auth-inline-row">
                <button id="switch-to-recover-btn" class="text-link" type="button">Forgot password?</button>
                <button id="switch-to-register-btn" class="text-link" type="button">Create account</button>
              </div>
            </form>`}
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
      <div class="footer-note">Navkankari brings the classic board into a brighter, smoother live-play experience.</div>
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
            <div class="muted">Invite another player directly or resume your saved battles.</div>
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
            <h3>Current session</h3>
            <div class="list compact-list" style="margin-top:12px;">
              <div class="inline-stat"><span class="muted">Tier</span><strong>${rankTier(state.user.rating)}</strong></div>
              <div class="inline-stat"><span class="muted">Win rate</span><strong>${winRate(state.user)}</strong></div>
              <div class="inline-stat"><span class="muted">Presence</span><strong>${state.user.idle ? "Idle" : "Active"}</strong></div>
              <div class="inline-stat"><span class="muted">Live game</span><strong>${dashboard.activeGameId ? "In progress" : "None"}</strong></div>
              <div class="inline-stat"><span class="muted">Pending invites</span><strong>${dashboard.incomingInvites.length + dashboard.outgoingInvites.length}</strong></div>
            </div>
            <div class="button-row" style="margin-top:12px;">
              <button id="resume-game-btn" class="btn-primary" type="button" ${dashboard.activeGameId ? "" : "disabled"}>Resume Active Game</button>
            </div>
          </div>
        </div>

        <div class="coach-card" style="margin-top:16px;">
          <div>
            <strong>${dashboard.activeGameId ? "Your match is waiting" : "Ready for another great game?"}</strong>
            <div class="muted">${dashboard.activeGameId ? "You can only play one live game at a time until it is saved or finished." : "Invite a specific opponent to start a live head-to-head match."}</div>
          </div>
          <span class="tag ${dashboard.activeGameId ? "danger" : "success"}">${dashboard.activeGameId ? "One active game only" : "Free to invite"}</span>
        </div>

        <div class="panel card-lite" style="margin-top:16px;">
          <div class="section-head">
            <div>
              <h3>Invite a Player</h3>
              <div class="muted">Pick an available player and send a direct challenge.</div>
            </div>
          </div>
          <div class="players-grid" style="margin-top:14px;">
            ${dashboard.availablePlayers.length ? dashboard.availablePlayers.map((entry) => `
              <div class="player-card">
                <div class="section-head">
                  <div>
                    <strong>${entry.name}</strong>
                    <div class="muted">${rankTier(entry.rating)} | Ranking ${entry.rating}</div>
                  </div>
                  <span class="tag">Ready</span>
                </div>
                <div class="button-row">
                  <button class="btn-ghost invite-btn" data-player-id="${entry.id}" type="button" ${dashboard.activeGameId ? "disabled" : ""}>Invite</button>
                </div>
              </div>
            `).join("") : `<div class="empty-state">No free players right now. Open another browser window to create another account, or wait for another player to log in.</div>`}
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
            <h3>Sent invites</h3>
            <div class="match-list">
              ${dashboard.outgoingInvites.length ? dashboard.outgoingInvites.map((invite) => `
                <div class="match-card">
                  <strong>${invite.toPlayer.name}</strong>
                  <div class="muted">Waiting for a response to your challenge.</div>
                  <div class="button-row" style="margin-top:12px;">
                    <button class="btn-secondary cancel-invite-btn" data-invite-id="${invite.id}" type="button">Cancel Invite</button>
                  </div>
                </div>
              `).join("") : `<div class="empty-state">No sent invites waiting on a response.</div>`}
            </div>
          </div>
        </div>

        <div class="mini-grid" style="margin-top:16px;">
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
  const boardStageClass = `board-shell board-stage-${game.stage}`;
  const myMoves = Object.keys(game.board)
    .filter((node) => game.board[node] === state.user.id)
    .reduce((sum, node) => sum + getLegalMoves(game, node, state.user.id).length, 0);
  const opponentMoves = Object.keys(game.board)
    .filter((node) => game.board[node] === opponent.id)
    .reduce((sum, node) => sum + getLegalMoves(game, node, opponent.id).length, 0);

  const finished = game.status === "finished";
  const winner = game.players.find((entry) => entry.id === game.winnerId);
  return `
    <section class="game-grid">
      <div class="game-card board-wrap">
        <div class="turn-banner">
          <div class="turn-main">
            <div class="tag"><span class="dot" style="color:${me.color}; background:${me.color};"></span>${me.name}</div>
            <h2>${finished ? `${winner?.name || "Winner"} wins` : game.pendingCaptureBy === state.user.id ? "Capture an opponent pawn" : game.turn === state.user.id ? `Your turn | ${formatStage(playerStage(game, state.user.id))}` : `${opponent.name}'s turn`}</h2>
            <div class="muted">${finished ? (game.winnerReason || "The match is over.") : boardStagePrompt(game)}</div>
          </div>
          <div class="button-row">
            ${finished ? `<button id="close-game-btn" class="btn-primary" type="button">Close Match</button>` : `<button id="save-game-btn" class="btn-ghost" type="button">Save & Exit</button><button id="forfeit-btn" class="btn-danger" type="button">Forfeit</button>`}
        
          </div>
        </div>
        <div class="${boardStageClass}">
          <div class="board">
            <div class="board-stage-badge">${formatStage(game.stage)} phase</div>
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
            <div class="timeline-item">${finished ? (game.winnerReason || "The match is over.") : boardStagePrompt(game)}</div>
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
  document.getElementById("go-login-btn")?.addEventListener("click", () => {
    state.authMode = "login";
    render();
  });
  document.getElementById("go-register-btn")?.addEventListener("click", () => {
    state.authMode = "register";
    render();
  });
  document.getElementById("go-recover-btn")?.addEventListener("click", () => {
    state.authMode = "recover";
    render();
  });
  document.getElementById("switch-to-login-btn")?.addEventListener("click", () => {
    state.authMode = "login";
    render();
  });
  document.getElementById("switch-to-register-btn")?.addEventListener("click", () => {
    state.authMode = "register";
    render();
  });
  document.getElementById("switch-to-recover-btn")?.addEventListener("click", () => {
    state.authMode = "recover";
    render();
  });
  document.getElementById("register-form")?.addEventListener("submit", (event) => {
    handleRegister(event).catch((error) => toast(error.message));
  });
  document.getElementById("login-form")?.addEventListener("submit", (event) => {
    handleLogin(event).catch((error) => toast(error.message));
  });
  document.getElementById("recover-form")?.addEventListener("submit", (event) => {
    handleForgotPassword(event).catch((error) => toast(error.message));
  });
}

function bindAppEvents() {
  document.getElementById("logout-btn")?.addEventListener("click", logout);
  document.getElementById("resume-game-btn")?.addEventListener("click", () => render());
  document.getElementById("save-game-btn")?.addEventListener("click", () => saveCurrentGame().catch((error) => toast(error.message)));
  document.getElementById("forfeit-btn")?.addEventListener("click", () => forfeitCurrentGame().catch((error) => toast(error.message)));
  document.getElementById("close-game-btn")?.addEventListener("click", () => closeFinishedGame().catch((error) => toast(error.message)));

  document.querySelectorAll(".invite-btn").forEach((button) => {
    button.addEventListener("click", () => sendInvite(button.dataset.playerId).catch((error) => toast(error.message)));
  });

  document.querySelectorAll(".accept-invite-btn").forEach((button) => {
    button.addEventListener("click", () => acceptInvite(button.dataset.inviteId).catch((error) => toast(error.message)));
  });

  document.querySelectorAll(".decline-invite-btn").forEach((button) => {
    button.addEventListener("click", () => declineInvite(button.dataset.inviteId).catch((error) => toast(error.message)));
  });

  document.querySelectorAll(".cancel-invite-btn").forEach((button) => {
    button.addEventListener("click", () => cancelInvite(button.dataset.inviteId).catch((error) => toast(error.message)));
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
