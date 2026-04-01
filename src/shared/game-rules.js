export const PLAYER_COLORS = [
  { name: "Red", value: "#e53935" },
  { name: "Black", value: "#111111" }
];

export const GRID_POSITIONS = {
  N0: { x: 10, y: 10 },
  N1: { x: 50, y: 10 },
  N2: { x: 90, y: 10 },
  N3: { x: 20, y: 20 },
  N4: { x: 50, y: 20 },
  N5: { x: 80, y: 20 },
  N6: { x: 30, y: 30 },
  N7: { x: 50, y: 30 },
  N8: { x: 70, y: 30 },
  N9: { x: 10, y: 50 },
  N10: { x: 20, y: 50 },
  N11: { x: 30, y: 50 },
  N12: { x: 70, y: 50 },
  N13: { x: 80, y: 50 },
  N14: { x: 90, y: 50 },
  N15: { x: 30, y: 70 },
  N16: { x: 50, y: 70 },
  N17: { x: 70, y: 70 },
  N18: { x: 20, y: 80 },
  N19: { x: 50, y: 80 },
  N20: { x: 80, y: 80 },
  N21: { x: 10, y: 90 },
  N22: { x: 50, y: 90 },
  N23: { x: 90, y: 90 }
};

export const ADJACENCY = {
  N0: ["N1", "N9"],
  N1: ["N0", "N2", "N4"],
  N2: ["N1", "N14"],
  N3: ["N4", "N10"],
  N4: ["N1", "N3", "N5", "N7"],
  N5: ["N4", "N13"],
  N6: ["N7", "N11"],
  N7: ["N4", "N6", "N8"],
  N8: ["N7", "N12"],
  N9: ["N0", "N10", "N21"],
  N10: ["N3", "N9", "N11", "N18"],
  N11: ["N6", "N10", "N15"],
  N12: ["N8", "N13", "N17"],
  N13: ["N5", "N12", "N14", "N20"],
  N14: ["N2", "N13", "N23"],
  N15: ["N11", "N16"],
  N16: ["N15", "N17", "N19"],
  N17: ["N12", "N16"],
  N18: ["N10", "N19"],
  N19: ["N16", "N18", "N20", "N22"],
  N20: ["N13", "N19"],
  N21: ["N9", "N22"],
  N22: ["N19", "N21", "N23"],
  N23: ["N14", "N22"]
};

export const MILLS = [
  ["N0", "N1", "N2"],
  ["N3", "N4", "N5"],
  ["N6", "N7", "N8"],
  ["N9", "N10", "N11"],
  ["N12", "N13", "N14"],
  ["N15", "N16", "N17"],
  ["N18", "N19", "N20"],
  ["N21", "N22", "N23"],
  ["N0", "N9", "N21"],
  ["N3", "N10", "N18"],
  ["N6", "N11", "N15"],
  ["N1", "N4", "N7"],
  ["N16", "N19", "N22"],
  ["N8", "N12", "N17"],
  ["N5", "N13", "N20"],
  ["N2", "N14", "N23"]
];

export const BOARD_LINES = [
  { type: "horizontal", left: 10, top: 10, width: 80 },
  { type: "horizontal", left: 20, top: 20, width: 60 },
  { type: "horizontal", left: 30, top: 30, width: 40 },
  { type: "horizontal", left: 10, top: 50, width: 20 },
  { type: "horizontal", left: 70, top: 50, width: 20 },
  { type: "horizontal", left: 30, top: 70, width: 40 },
  { type: "horizontal", left: 20, top: 80, width: 60 },
  { type: "horizontal", left: 10, top: 90, width: 80 },
  { type: "vertical", left: 10, top: 10, height: 80 },
  { type: "vertical", left: 20, top: 20, height: 60 },
  { type: "vertical", left: 30, top: 30, height: 40 },
  { type: "vertical", left: 50, top: 10, height: 20 },
  { type: "vertical", left: 50, top: 70, height: 20 },
  { type: "vertical", left: 70, top: 30, height: 40 },
  { type: "vertical", left: 80, top: 20, height: 60 },
  { type: "vertical", left: 90, top: 10, height: 80 }
];

export const RANKING = {
  base: 100,
  win: 12,
  loss: -8,
  floor: 60
};

export function createEmptyBoard() {
  return Object.fromEntries(Object.keys(GRID_POSITIONS).map((node) => [node, null]));
}

function colorSeed(value) {
  return [...String(value || "")].reduce((sum, char, index) => sum + char.charCodeAt(0) * (index + 1), 0);
}

export function assignMatchColors(playerOneId, playerTwoId) {
  const total = colorSeed(playerOneId) + colorSeed(playerTwoId);
  const firstIndex = total % PLAYER_COLORS.length;
  const offset = (colorSeed(playerOneId) * 3 + colorSeed(playerTwoId)) % (PLAYER_COLORS.length - 1);
  const secondIndex = (firstIndex + offset + 1) % PLAYER_COLORS.length;
  return [PLAYER_COLORS[firstIndex].value, PLAYER_COLORS[secondIndex].value];
}

export function createGameRecord({ id, playerOne, playerTwo, source }) {
  const [playerOneColor, playerTwoColor] = assignMatchColors(playerOne.id, playerTwo.id);
  return {
    id,
    playerIds: [playerOne.id, playerTwo.id],
    players: [
      {
        id: playerOne.id,
        name: playerOne.name,
        color: playerOneColor,
        pawnsInHand: 9,
        pawnsOnBoard: 0,
        captures: 0
      },
      {
        id: playerTwo.id,
        name: playerTwo.name,
        color: playerTwoColor,
        pawnsInHand: 9,
        pawnsOnBoard: 0,
        captures: 0
      }
    ],
    board: createEmptyBoard(),
    turn: playerOne.id,
    stage: "placement",
    pendingCaptureBy: null,
    winnerId: null,
    status: "active",
    source,
    moveCount: 0,
    lastMove: null,
    history: [`${playerOne.name} and ${playerTwo.name} started a Navkankari match.`],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    savedAt: null,
    winnerReason: null
  };
}

export function getParticipant(game, playerId) {
  return game.players.find((player) => player.id === playerId) || null;
}

export function getOpponent(game, playerId) {
  return game.players.find((player) => player.id !== playerId) || null;
}

export function getNodeMills(node) {
  return MILLS.filter((mill) => mill.includes(node));
}

export function getActiveMills(game, playerId) {
  return MILLS.filter((mill) => mill.every((spot) => game.board[spot] === playerId));
}

export function nodesInMill(game, playerId) {
  return new Set(getActiveMills(game, playerId).flat());
}

export function isMillFormed(game, playerId, node) {
  return getNodeMills(node).some((mill) => mill.every((spot) => game.board[spot] === playerId));
}

export function canFly(game, playerId) {
  const participant = getParticipant(game, playerId);
  return Boolean(participant && participant.pawnsInHand === 0 && participant.pawnsOnBoard === 3);
}

export function playerStage(game, playerId) {
  const participant = getParticipant(game, playerId);
  if (!participant) {
    return "placement";
  }
  if (participant.pawnsInHand > 0) {
    return "placement";
  }
  return canFly(game, playerId) ? "fly" : "movement";
}

export function getLegalMoves(game, node, playerId) {
  if (game.board[node] !== playerId) {
    return [];
  }
  if (canFly(game, playerId)) {
    return Object.keys(game.board).filter((target) => !game.board[target]);
  }
  return ADJACENCY[node].filter((target) => !game.board[target]);
}

export function tryCaptureEligibleNodes(game, capturerId) {
  const opponent = getOpponent(game, capturerId);
  const occupiedNodes = Object.keys(game.board).filter((node) => game.board[node] === opponent.id);
  const millNodes = nodesInMill(game, opponent.id);
  const outsideMill = occupiedNodes.filter((node) => !millNodes.has(node));
  return outsideMill.length ? outsideMill : occupiedNodes;
}

export function hasAnyMove(game, playerId) {
  const participant = getParticipant(game, playerId);
  if (!participant) {
    return false;
  }

  if (participant.pawnsOnBoard <= 3 && participant.pawnsInHand === 0) {
    return Object.values(game.board).some((value) => value === null);
  }

  return Object.keys(game.board)
    .filter((node) => game.board[node] === playerId)
    .some((node) => getLegalMoves(game, node, playerId).length > 0);
}

function switchTurn(game) {
  game.turn = game.playerIds.find((playerId) => playerId !== game.turn);
  const nextPlacement = game.players.some((player) => player.pawnsInHand > 0);
  game.stage = nextPlacement ? "placement" : "movement";
  if (canFly(game, game.turn)) {
    game.stage = "fly";
  }
  game.updatedAt = Date.now();
}

function updateStageFromState(game) {
  if (game.players.some((player) => player.pawnsInHand > 0)) {
    game.stage = "placement";
    return;
  }
  game.stage = canFly(game, game.turn) ? "fly" : "movement";
}

function declareWinner(game, winnerId, reason) {
  game.winnerId = winnerId;
  game.winnerReason = reason;
  game.status = "finished";
  game.pendingCaptureBy = null;
  game.updatedAt = Date.now();
  game.history.unshift(reason);
}

function finishIfGameOver(game, actingPlayerId) {
  const opponent = getOpponent(game, actingPlayerId);
  const actor = getParticipant(game, actingPlayerId);

  if (actor.captures >= 7 || (opponent.pawnsOnBoard <= 2 && opponent.pawnsInHand === 0)) {
    declareWinner(game, actingPlayerId, `${actor.name} captured enough pawns to win.`);
    return;
  }

  if (opponent.pawnsInHand === 0 && !hasAnyMove(game, opponent.id)) {
    declareWinner(game, actingPlayerId, `${opponent.name} has no legal move left.`);
  }
}

export function applyGameAction(game, playerId, action) {
  if (!game || game.status !== "active") {
    return { ok: false, error: "This game is no longer active." };
  }

  const participant = getParticipant(game, playerId);
  const opponent = getOpponent(game, playerId);

  if (action.type === "forfeit") {
    declareWinner(game, opponent.id, `${participant.name} forfeited the match.`);
    return { ok: true };
  }

  if (game.turn !== playerId && game.pendingCaptureBy !== playerId) {
    return { ok: false, error: "It is not your turn." };
  }

  if (action.type === "capture") {
    if (game.pendingCaptureBy !== playerId) {
      return { ok: false, error: "You can only capture right after forming a mill." };
    }

    const target = action.node;
    if (!target || game.board[target] !== opponent.id) {
      return { ok: false, error: "Pick a valid opponent pawn to capture." };
    }

    const eligible = tryCaptureEligibleNodes(game, playerId);
    if (!eligible.includes(target)) {
      return { ok: false, error: "You must capture a pawn outside a mill if one is available." };
    }

    game.board[target] = null;
    opponent.pawnsOnBoard -= 1;
    participant.captures += 1;
    game.pendingCaptureBy = null;
    game.lastMove = { type: "capture", playerId, target };
    game.history.unshift(`${participant.name} captured ${opponent.name} at ${target}.`);
    finishIfGameOver(game, playerId);
    if (game.status === "active") {
      switchTurn(game);
      updateStageFromState(game);
    }
    return { ok: true };
  }

  if (game.pendingCaptureBy) {
    return { ok: false, error: "Complete your capture before making another move." };
  }

  const stage = playerStage(game, playerId);

  if (action.type === "place") {
    const node = action.node;
    if (stage !== "placement") {
      return { ok: false, error: "Placement is over for this pawn set." };
    }
    if (!node || game.board[node]) {
      return { ok: false, error: "Choose an empty position for placement." };
    }

    game.board[node] = playerId;
    participant.pawnsInHand -= 1;
    participant.pawnsOnBoard += 1;
    game.moveCount += 1;
    game.lastMove = { type: "place", playerId, to: node };
    game.history.unshift(`${participant.name} placed at ${node}.`);

    if (isMillFormed(game, playerId, node)) {
      game.pendingCaptureBy = playerId;
      game.history.unshift(`${participant.name} formed a mill and can capture.`);
    } else {
      switchTurn(game);
    }

    updateStageFromState(game);
    finishIfGameOver(game, playerId);
    return { ok: true };
  }

  if (action.type === "move") {
    const { from, to } = action;
    if (!from || !to) {
      return { ok: false, error: "A move must include both origin and destination." };
    }
    if (stage === "placement") {
      return { ok: false, error: "You still have pawns left to place." };
    }
    if (game.board[from] !== playerId) {
      return { ok: false, error: "You can only move your own pawn." };
    }
    if (game.board[to]) {
      return { ok: false, error: "That destination is already occupied." };
    }

    const legalMoves = getLegalMoves(game, from, playerId);
    if (!legalMoves.includes(to)) {
      return { ok: false, error: stage === "fly" ? "Flying lets you move to any empty spot only." : "That move is not adjacent." };
    }

    game.board[from] = null;
    game.board[to] = playerId;
    game.moveCount += 1;
    game.lastMove = { type: stage === "fly" ? "fly" : "move", playerId, from, to };
    game.history.unshift(`${participant.name} ${stage === "fly" ? "flew" : "moved"} from ${from} to ${to}.`);

    if (isMillFormed(game, playerId, to)) {
      game.pendingCaptureBy = playerId;
      game.history.unshift(`${participant.name} formed a mill and can capture.`);
    } else {
      switchTurn(game);
    }

    updateStageFromState(game);
    finishIfGameOver(game, playerId);
    return { ok: true };
  }

  return { ok: false, error: "Unknown action type." };
}

export function getMillOwnerMap(game) {
  const owners = {};
  game.players.forEach((participant) => {
    getActiveMills(game, participant.id).flat().forEach((node) => {
      owners[node] = owners[node] || [];
      if (!owners[node].includes(participant.id)) {
        owners[node].push(participant.id);
      }
    });
  });
  return owners;
}
