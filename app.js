'use strict';

import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.0.0-beta.8/+esm';

/* ============================================================
   ESTADO GLOBAL
   ============================================================ */
const state = {
  username: '',
  games: [],
  currentGame: null,   // objeto de partida de chess.com
  chess: null,         // instancia de chess.js para navegar
  history: [],         // lista de jugadas SAN en orden
  positions: [],        // FEN después de cada jugada (index 0 = posición inicial)
  ply: 0,               // jugada actualmente mostrada (0 = posición inicial)
  boardFlipped: false,
  engine: null,
  engineReady: false,
  analysis: [],          // análisis por ply: {cp, mate, best, depth}
  analyzing: false,
  playing: false,
  playTimer: null,
};

const PIECE_UNICODE = {
  wp: '♙', wn: '♘', wb: '♗', wr: '♖', wq: '♕', wk: '♔',
  bp: '♟', bn: '♞', bb: '♝', br: '♜', bq: '♛', bk: '♚',
};

// Set de piezas "cburnett" (el clásico usado por Lichess), servido vía jsDelivr
// desde el repositorio oficial. Licencia libre (GPLv2+ / CC-BY-SA).
const PIECE_SVG_BASE = 'https://cdn.jsdelivr.net/gh/lichess-org/lila@master/public/piece/cburnett/';
const PIECE_FILES = {
  wp: 'wP.svg', wn: 'wN.svg', wb: 'wB.svg', wr: 'wR.svg', wq: 'wQ.svg', wk: 'wK.svg',
  bp: 'bP.svg', bn: 'bN.svg', bb: 'bB.svg', br: 'bR.svg', bq: 'bQ.svg', bk: 'bK.svg',
};

/* ============================================================
   NAVEGACIÓN ENTRE PANTALLAS
   ============================================================ */
function showScreen(name) {
  document.getElementById('screen-home').hidden = name !== 'home';
  document.getElementById('screen-games').hidden = name !== 'games';
  document.getElementById('screen-analysis').hidden = name !== 'analysis';
}

/* ============================================================
   PANTALLA HOME: búsqueda de usuario en Chess.com
   ============================================================ */
const searchForm = document.getElementById('search-form');
const usernameInput = document.getElementById('username-input');
const searchBtn = document.getElementById('search-btn');
const homeError = document.getElementById('home-error');

searchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = usernameInput.value.trim().toLowerCase();
  if (!username) return;

  homeError.hidden = true;
  searchBtn.disabled = true;
  searchBtn.querySelector('.btn-label').textContent = 'Buscando…';

  try {
    const games = await fetchRecentGames(username);
    if (games.length === 0) {
      throw new Error('No se encontraron partidas recientes para ese usuario.');
    }
    state.username = username;
    state.games = games;
    renderGamesList();
    showScreen('games');
  } catch (err) {
    console.error('[Escaque] ERROR:', err);
    homeError.textContent = err.message || 'No se pudo encontrar ese usuario. Comprueba que esté bien escrito.';
    homeError.hidden = false;
  } finally {
    searchBtn.disabled = false;
    searchBtn.querySelector('.btn-label').textContent = 'Buscar partidas';
  }
});

async function fetchRecentGames(username) {
  // Chess.com expone un índice de archivos mensuales; tomamos los últimos meses
  // hasta reunir un número razonable de partidas.
  const archivesResp = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(username)}/games/archives`);
  if (!archivesResp.ok) {
    throw new Error('Usuario no encontrado en Chess.com.');
  }
  const archivesData = await archivesResp.json();
  const archives = archivesData.archives || [];
  if (archives.length === 0) return [];

  const lastArchives = archives.slice(-4).reverse(); // últimos 4 meses, más reciente primero
  let allGames = [];

  for (const url of lastArchives) {
    const resp = await fetch(url);
    if (!resp.ok) continue;
    const data = await resp.json();
    if (data.games) allGames = allGames.concat(data.games);
    if (allGames.length >= 30) break;
  }

  allGames.sort((a, b) => (b.end_time || 0) - (a.end_time || 0));
  return allGames.slice(0, 30);
}

/* ============================================================
   PANTALLA LISTA DE PARTIDAS
   ============================================================ */
document.getElementById('back-to-home').addEventListener('click', () => showScreen('home'));

function renderGamesList() {
  document.getElementById('games-username').textContent = state.username;
  document.getElementById('games-count').textContent = `${state.games.length} partidas recientes`;

  const list = document.getElementById('games-list');
  list.innerHTML = '';

  state.games.forEach((game, idx) => {
    if (!game.white || !game.black) return; // partida con datos incompletos (p.ej. daily/variantes raras)

    const row = document.createElement('button');
    row.className = 'game-row';

    const isWhite = (game.white.username || '').toLowerCase() === state.username;
    const me = isWhite ? game.white : game.black;
    const opp = isWhite ? game.black : game.white;

    let resultClass = 'draw';
    if (me.result === 'win') resultClass = 'win';
    else if (['checkmated', 'timeout', 'resigned', 'abandoned', 'lose'].includes(me.result)) resultClass = 'loss';

    const date = game.end_time ? new Date(game.end_time * 1000) : null;
    const dateStr = date ? date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
    const timeClass = game.time_class || '';

    row.innerHTML = `
      <span class="game-result-chip ${resultClass}"></span>
      <span class="game-row-main">
        <span class="game-row-players"><b>${escapeHtml(me.username)}</b> (${me.rating}) vs ${escapeHtml(opp.username)} (${opp.rating})</span>
        <span class="game-row-meta">${dateStr} · ${timeClass} · ${resultLabel(me.result)}</span>
      </span>
      <span class="game-row-arrow">
        <svg viewBox="0 0 24 24" width="16" height="16"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </span>
    `;

    row.addEventListener('click', () => openGame(idx));
    list.appendChild(row);
  });
}

function resultLabel(r) {
  const map = {
    win: 'victoria', checkmated: 'jaque mate', resigned: 'abandono',
    timeout: 'tiempo agotado', agreed: 'tablas acordadas', stalemate: 'ahogado',
    insufficient: 'material insuficiente', repetition: 'repetición',
    '50move': 'regla 50 jugadas', abandoned: 'abandonada',
  };
  return map[r] || r;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ============================================================
   ABRIR UNA PARTIDA -> PANTALLA DE ANÁLISIS
   ============================================================ */
document.getElementById('back-to-games').addEventListener('click', () => {
  stopPlayback();
  showScreen('games');
});

function openGame(idx) {
  const game = state.games[idx];
  state.currentGame = game;
  boardSquaresPainted = false;
  piecesRenderedForPly = -1;

  const chess = new Chess();
  try {
    chess.loadPgn(game.pgn);
  } catch (err) {
    console.error('Error cargando PGN', err);
    return;
  }

  // Reconstruir posiciones jugada a jugada desde el inicio
  const verboseHistory = chess.history({ verbose: true });
  const replay = new Chess();
  const positions = [replay.fen()];
  const sanHistory = [];
  for (const move of verboseHistory) {
    replay.move(move.san);
    positions.push(replay.fen());
    sanHistory.push(move.san);
  }

  state.chess = chess;
  state.history = sanHistory;
  state.verboseHistory = verboseHistory;
  state.positions = positions;
  state.ply = 0; // mostrar la posición inicial por defecto
  state.analysis = new Array(positions.length).fill(null);
  state.boardFlipped = (game.black.username || '').toLowerCase() === state.username;

  const isWhite = (game.white.username || '').toLowerCase() === state.username;
  const me = isWhite ? game.white : game.black;
  const opp = isWhite ? game.black : game.white;

  document.getElementById('analysis-title').textContent = `${me.username} vs ${opp.username}`;
  const date = game.end_time ? new Date(game.end_time * 1000).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
  document.getElementById('analysis-subtitle').textContent = `${date} · ${game.time_class || ''} · ${resultLabel(me.result)}`;

  document.getElementById('accuracy-panel').hidden = true;
  document.getElementById('progress-wrap').hidden = true;
  document.getElementById('accuracy-white-value').textContent = '—';
  document.getElementById('accuracy-black-value').textContent = '—';
  document.getElementById('accuracy-white-label').textContent = `blancas · ${game.white.username}`;
  document.getElementById('accuracy-black-label').textContent = `negras · ${game.black.username}`;

  renderMovesList();
  renderBoard();
  updateEvalDisplay(null);
  drawEvalGraph();
  renderMoveComment();
  drawBestMoveArrow();
  updateMoveBadge();
  document.getElementById('tag-summary').hidden = true;
  document.getElementById('coach-card').hidden = true;

  showScreen('analysis');
  ensureEngine();
  runFullAnalysis(); // el análisis arranca automáticamente al abrir la partida
}

/* ============================================================
   TABLERO (casillas estáticas + capa de piezas animada)
   ============================================================ */
let boardSquaresPainted = false;

function renderBoard() {
  const boardEl = document.getElementById('board');

  // Las 64 casillas se pintan una sola vez; solo se actualizan resaltados.
  if (!boardSquaresPainted) {
    paintSquares();
    boardSquaresPainted = true;
  }
  updateSquareHighlights();
  renderPieces();
}

function paintSquares() {
  const boardEl = document.getElementById('board');
  boardEl.innerHTML = '<div class="pieces-layer" id="pieces-layer"></div>';

  for (let displayRow = 0; displayRow < 8; displayRow++) {
    for (let displayCol = 0; displayCol < 8; displayCol++) {
      const rank = state.boardFlipped ? displayRow : 7 - displayRow;
      const file = state.boardFlipped ? 7 - displayCol : displayCol;
      const isLight = (rank + file) % 2 === 1;

      const sq = document.createElement('div');
      sq.className = `square ${isLight ? 'light' : 'dark'}`;
      sq.dataset.displayRow = displayRow;
      sq.dataset.displayCol = displayCol;

      if (displayCol === 0) {
        const rc = document.createElement('span');
        rc.className = 'square-coord rank';
        rc.textContent = rank + 1;
        sq.appendChild(rc);
      }
      if (displayRow === 7) {
        const fc = document.createElement('span');
        fc.className = 'square-coord file';
        fc.textContent = 'abcdefgh'[file];
        sq.appendChild(fc);
      }
      boardEl.appendChild(sq);
    }
  }
}

// Convierte (rank,file) del tablero a posición (displayRow,displayCol) según orientación.
function toDisplayPos(rank, file) {
  const displayRow = state.boardFlipped ? rank : 7 - rank;
  const displayCol = state.boardFlipped ? 7 - file : file;
  return { displayRow, displayCol };
}

/* --- Flecha con la mejor jugada sugerida en la posición actual --- */
function drawBestMoveArrow() {
  const layer = document.getElementById('best-move-arrow-layer');
  const info = state.analysis[state.ply];
  const bestUci = info && info.pv ? info.pv[0] : null;

  if (!bestUci || bestUci.length < 4) {
    layer.innerHTML = '';
    return;
  }

  const from = squareToRankFile(bestUci.slice(0, 2));
  const to = squareToRankFile(bestUci.slice(2, 4));
  const fromPos = toDisplayPos(from.rank, from.file);
  const toPos = toDisplayPos(to.rank, to.file);

  // Centro de cada casilla en un viewBox 0-100.
  const x1 = (fromPos.displayCol + 0.5) * 12.5;
  const y1 = (fromPos.displayRow + 0.5) * 12.5;
  const x2 = (toPos.displayCol + 0.5) * 12.5;
  const y2 = (toPos.displayRow + 0.5) * 12.5;

  // Acortar la flecha para que no quede tapada por la pieza destino.
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const shorten = 5;
  const ex = x2 - (dx / len) * shorten;
  const ey = y2 - (dy / len) * shorten;

  layer.innerHTML = `
    <defs>
      <marker id="arrowhead" markerWidth="3" markerHeight="3" refX="1.4" refY="1.5" orient="auto">
        <polygon points="0 0, 3 1.5, 0 3" fill="rgba(106,153,85,0.85)" />
      </marker>
    </defs>
    <line x1="${x1}" y1="${y1}" x2="${ex}" y2="${ey}"
      stroke="rgba(106,153,85,0.85)" stroke-width="3" stroke-linecap="round"
      marker-end="url(#arrowhead)" />
  `;
}

function updateSquareHighlights() {
  const lastMoveSquares = getLastMoveSquares();
  document.querySelectorAll('#board .square').forEach((sq) => {
    const displayRow = parseInt(sq.dataset.displayRow, 10);
    const displayCol = parseInt(sq.dataset.displayCol, 10);
    const rank = state.boardFlipped ? displayRow : 7 - displayRow;
    const file = state.boardFlipped ? 7 - displayCol : displayCol;
    const squareName = 'abcdefgh'[file] + (rank + 1);
    sq.classList.toggle('highlight-from', lastMoveSquares.from === squareName);
    sq.classList.toggle('highlight-to', lastMoveSquares.to === squareName);
  });
}

/* --- Insignia de calidad (mejor/buena/error…) sobre la casilla de destino
   de la última jugada, visible directamente en el tablero. --- */
function updateMoveBadge() {
  const boardEl = document.getElementById('board');
  let badge = document.getElementById('move-badge');

  const ply = state.ply;
  const key = ply > 0 && state.moveTags ? state.moveTags[ply] : null;

  if (!key) {
    if (badge) badge.remove();
    return;
  }

  const move = state.verboseHistory[ply - 1];
  if (!move) { if (badge) badge.remove(); return; }

  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'move-badge';
    badge.innerHTML = '<span class="move-badge-circle"></span>';
    boardEl.appendChild(badge);
  }

  const { rank, file } = squareToRankFile(move.to);
  const { displayRow, displayCol } = toDisplayPos(rank, file);
  badge.style.left = (displayCol * 12.5) + '%';
  badge.style.top = (displayRow * 12.5) + '%';

  const info = TAG_LABELS[key];
  badge.className = `move-badge ${info.cls}`;
  badge.querySelector('.move-badge-circle').innerHTML = info.icon;
  badge.hidden = false;
}

// Cada pieza en pantalla lleva una clave de identidad estable (no basada en
// heurísticas de distancia, que confunden piezas iguales entre sí). El mapa
// vive indexado por casilla actual ("e4" -> <img>) y se actualiza aplicando
// el movimiento real (origen/destino/captura/enroque/promoción) al pasar de
// un ply a otro, en vez de reconstruirse comparando posiciones completas.
let squareToPiece = {}; // "e4" -> <img>
let piecesRenderedForPly = -1; // último ply para el que el DOM de piezas es válido

function renderPieces() {
  const layer = document.getElementById('pieces-layer');
  const targetPly = state.ply;

  // Si venimos de girar el tablero, reconstruir todo el DOM desde cero.
  if (piecesRenderedForPly === -1) {
    layer.innerHTML = '';
    squareToPiece = {};
    const fen = state.positions[targetPly];
    const boardArr = fenToBoardArray(fen);
    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        const piece = boardArr[rank][file];
        if (piece) {
          const squareName = 'abcdefgh'[file] + (rank + 1);
          const img = createPieceImg(piece, rank, file);
          layer.appendChild(img);
          squareToPiece[squareName] = img;
        }
      }
    }
    piecesRenderedForPly = targetPly;
    return;
  }

  // Un salto grande (más de una jugada) reconstruye directamente el tablero
  // desde el FEN destino: aplicar decenas de jugadas en cascada no aporta
  // nada visualmente y sería mucho más lento.
  const plyDistance = Math.abs(targetPly - piecesRenderedForPly);
  if (plyDistance > 1) {
    layer.innerHTML = '';
    squareToPiece = {};
    const fen = state.positions[targetPly];
    const boardArr = fenToBoardArray(fen);
    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        const piece = boardArr[rank][file];
        if (piece) {
          const squareName = 'abcdefgh'[file] + (rank + 1);
          const img = createPieceImg(piece, rank, file);
          layer.appendChild(img);
          squareToPiece[squareName] = img;
        }
      }
    }
    piecesRenderedForPly = targetPly;
    return;
  }

  // Avanzar o retroceder un solo ply aplicando el movimiento real, para que
  // la identidad de cada pieza se preserve y la animación sea correcta.
  while (piecesRenderedForPly < targetPly) {
    applyMoveForward(state.verboseHistory[piecesRenderedForPly]);
    piecesRenderedForPly++;
  }
  while (piecesRenderedForPly > targetPly) {
    piecesRenderedForPly--;
    applyMoveBackward(state.verboseHistory[piecesRenderedForPly]);
  }
}

function createPieceImg(piece, rank, file) {
  const img = document.createElement('img');
  img.className = 'piece';
  img.src = PIECE_SVG_BASE + PIECE_FILES[piece];
  img.alt = piece;
  img.draggable = false;
  positionPieceImg(img, rank, file);
  return img;
}

function positionPieceImg(img, rank, file) {
  const { displayRow, displayCol } = toDisplayPos(rank, file);
  img.style.left = (displayCol * 12.5) + '%';
  img.style.top = (displayRow * 12.5) + '%';
}

function squareToRankFile(sq) {
  const file = 'abcdefgh'.indexOf(sq[0]);
  const rank = parseInt(sq[1], 10) - 1;
  return { rank, file };
}

// Aplica un movimiento (verbose de chess.js) avanzando un ply: mueve el
// elemento DOM de origen a destino, gestionando capturas, enroque y al paso.
function applyMoveForward(move) {
  if (!move) return;
  const layer = document.getElementById('pieces-layer');

  // Captura al paso: el peón capturado no está en la casilla destino.
  if (move.flags.includes('e')) {
    const capturedFile = move.to[0];
    const capturedRank = move.color === 'w' ? move.to[1] - 1 : Number(move.to[1]) + 1;
    const capturedSquare = capturedFile + capturedRank;
    if (squareToPiece[capturedSquare]) {
      squareToPiece[capturedSquare].remove();
      delete squareToPiece[capturedSquare];
    }
  }

  // Captura normal: quitar la pieza que estaba en la casilla destino.
  if (squareToPiece[move.to] && move.to !== move.from) {
    squareToPiece[move.to].remove();
    delete squareToPiece[move.to];
  }

  // Mover la pieza de origen a destino.
  const img = squareToPiece[move.from];
  delete squareToPiece[move.from];
  if (img) {
    const { rank, file } = squareToRankFile(move.to);
    positionPieceImg(img, rank, file);
    // Promoción: cambiar el sprite por la nueva pieza.
    if (move.promotion) {
      const newPiece = move.color + move.promotion;
      img.src = PIECE_SVG_BASE + PIECE_FILES[newPiece];
      img.alt = newPiece;
    }
    squareToPiece[move.to] = img;
  }

  // Enroque: mover también la torre correspondiente.
  if (move.flags.includes('k') || move.flags.includes('q')) {
    const rank = move.color === 'w' ? '1' : '8';
    const rookFrom = move.flags.includes('k') ? 'h' + rank : 'a' + rank;
    const rookTo = move.flags.includes('k') ? 'f' + rank : 'd' + rank;
    const rookImg = squareToPiece[rookFrom];
    delete squareToPiece[rookFrom];
    if (rookImg) {
      const { rank: rr, file: rf } = squareToRankFile(rookTo);
      positionPieceImg(rookImg, rr, rf);
      squareToPiece[rookTo] = rookImg;
    }
  }
}

// Deshace un movimiento retrocediendo un ply (recreando lo que hiciera falta).
function applyMoveBackward(move) {
  if (!move) return;
  const layer = document.getElementById('pieces-layer');

  // Deshacer enroque: devolver la torre a su casilla original.
  if (move.flags.includes('k') || move.flags.includes('q')) {
    const rank = move.color === 'w' ? '1' : '8';
    const rookFrom = move.flags.includes('k') ? 'h' + rank : 'a' + rank;
    const rookTo = move.flags.includes('k') ? 'f' + rank : 'd' + rank;
    const rookImg = squareToPiece[rookTo];
    delete squareToPiece[rookTo];
    if (rookImg) {
      const { rank: rr, file: rf } = squareToRankFile(rookFrom);
      positionPieceImg(rookImg, rr, rf);
      squareToPiece[rookFrom] = rookImg;
    }
  }

  // Deshacer promoción: volver al peón original antes de mover hacia atrás.
  const img = squareToPiece[move.to];
  delete squareToPiece[move.to];
  if (img) {
    if (move.promotion) {
      const pawnPiece = move.color + 'p';
      img.src = PIECE_SVG_BASE + PIECE_FILES[pawnPiece];
      img.alt = pawnPiece;
    }
    const { rank, file } = squareToRankFile(move.from);
    positionPieceImg(img, rank, file);
    squareToPiece[move.from] = img;
  }

  // Restaurar la pieza capturada (normal o al paso).
  if (move.captured) {
    let capturedSquare = move.to;
    if (move.flags.includes('e')) {
      const capturedFile = move.to[0];
      const capturedRank = move.color === 'w' ? move.to[1] - 1 : Number(move.to[1]) + 1;
      capturedSquare = capturedFile + capturedRank;
    }
    const capturedColor = move.color === 'w' ? 'b' : 'w';
    const capturedPiece = capturedColor + move.captured;
    const { rank, file } = squareToRankFile(capturedSquare);
    const restoredImg = createPieceImg(capturedPiece, rank, file);
    layer.appendChild(restoredImg);
    squareToPiece[capturedSquare] = restoredImg;
  }
}

function fenToBoardArray(fen) {
  const rows = fen.split(' ')[0].split('/');
  const board = [];
  for (let r = 0; r < 8; r++) {
    const rowStr = rows[r];
    const rank = 7 - r;
    board[rank] = board[rank] || [];
    let file = 0;
    for (const ch of rowStr) {
      if (/\d/.test(ch)) {
        file += parseInt(ch, 10);
      } else {
        const color = ch === ch.toUpperCase() ? 'w' : 'b';
        const type = ch.toLowerCase();
        board[rank][file] = color + type;
        file++;
      }
    }
  }
  return board;
}

function getLastMoveSquares() {
  if (state.ply === 0) return {};
  // Recalcular con chess.js verbose history usando una réplica hasta ese ply
  const replay = new Chess();
  let verbose = null;
  for (let i = 0; i < state.ply; i++) {
    verbose = replay.move(state.history[i]);
  }
  return verbose ? { from: verbose.from, to: verbose.to } : {};
}

document.getElementById('ctrl-flip').addEventListener('click', () => {
  state.boardFlipped = !state.boardFlipped;
  boardSquaresPainted = false; // forzar repintado de casillas con la nueva orientación
  piecesRenderedForPly = -1; // las piezas existentes quedan obsoletas (saltan sin animar)
  renderBoard();
});

/* ============================================================
   CONTROLES DE NAVEGACIÓN DE JUGADAS
   ============================================================ */
function goToPly(ply) {
  ply = Math.max(0, Math.min(state.positions.length - 1, ply));
  state.ply = ply;
  renderBoard();
  highlightActiveMove();
  requestLiveEval();
  updateGraphCursor();
  renderMoveComment();
  drawBestMoveArrow();
  updateMoveBadge();
}

document.getElementById('ctrl-start').addEventListener('click', () => { stopPlayback(); goToPly(0); });
document.getElementById('ctrl-end').addEventListener('click', () => { stopPlayback(); goToPly(state.positions.length - 1); });
document.getElementById('ctrl-prev').addEventListener('click', () => { stopPlayback(); goToPly(state.ply - 1); });
document.getElementById('ctrl-next').addEventListener('click', () => { stopPlayback(); goToPly(state.ply + 1); });

document.getElementById('ctrl-play').addEventListener('click', (e) => {
  if (state.playing) {
    stopPlayback();
  } else {
    state.playing = true;
    e.target.textContent = '⏸';
    state.playTimer = setInterval(() => {
      if (state.ply >= state.positions.length - 1) {
        stopPlayback();
        return;
      }
      goToPly(state.ply + 1);
    }, 800);
  }
});

function stopPlayback() {
  state.playing = false;
  document.getElementById('ctrl-play').textContent = '▶';
  if (state.playTimer) clearInterval(state.playTimer);
  state.playTimer = null;
}

document.addEventListener('keydown', (e) => {
  if (document.getElementById('screen-analysis').hidden) return;
  if (e.key === 'ArrowLeft') { stopPlayback(); goToPly(state.ply - 1); }
  if (e.key === 'ArrowRight') { stopPlayback(); goToPly(state.ply + 1); }
});

/* ============================================================
   LISTA DE JUGADAS (panel lateral)
   ============================================================ */
function renderMovesList() {
  const list = document.getElementById('moves-list');
  list.innerHTML = '';

  for (let i = 0; i < state.history.length; i++) {
    const moveNum = Math.floor(i / 2) + 1;
    const isWhiteMove = i % 2 === 0;

    const cell = document.createElement('div');
    cell.className = 'move-cell';
    cell.dataset.ply = i + 1;

    const numLabel = isWhiteMove ? `${moveNum}.` : '';
    cell.innerHTML = `
      <span class="move-num">${numLabel}</span>
      <span class="move-san">${state.history[i]}</span>
      <span class="move-tag" id="tag-${i + 1}"></span>
    `;

    cell.addEventListener('click', () => { stopPlayback(); goToPly(i + 1); });
    list.appendChild(cell);
  }
}

function highlightActiveMove() {
  document.querySelectorAll('.move-cell').forEach((el) => {
    el.classList.toggle('active', parseInt(el.dataset.ply, 10) === state.ply);
  });
  const active = document.querySelector('.move-cell.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

/* ============================================================
   MOTOR STOCKFISH (WASM, Web Worker, corre en el navegador)
   ============================================================ */
// Servido por cdnjs (Cloudflare) — fuente oficial y muy fiable. Stockfish 10,
// variante WASM. Es una versión sin red neuronal (NNUE) por ser anterior a su
// introducción, pero sigue jugando muy por encima del nivel humano.
const SF_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/';
const SF_FILE = 'stockfish.wasm.js';

/* --- Panel de registro visible del motor (diagnóstico en la propia UI) --- */
function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000; // procesar en bloques para no reventar el stack con apply()
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function engineLog(text, kind) {
  const body = document.getElementById('engine-log-body');
  if (!body) return;
  const line = document.createElement('div');
  if (kind) line.className = 'log-' + kind;
  const time = new Date().toLocaleTimeString('es-ES', { hour12: false });
  line.textContent = `[${time}] ${text}`;
  body.appendChild(line);
  body.scrollTop = body.scrollHeight;
  if (kind === 'error') {
    document.getElementById('engine-log-panel').hidden = false;
  }
}

document.getElementById('engine-log-toggle').addEventListener('click', () => {
  const panel = document.getElementById('engine-log-panel');
  panel.hidden = !panel.hidden;
});
document.getElementById('engine-log-close').addEventListener('click', () => {
  document.getElementById('engine-log-panel').hidden = true;
});

async function ensureEngine() {
  if (state.engine) return;
  setEngineStatus('loading', 'Cargando motor…');
  engineLog('Iniciando carga del motor Stockfish…');

  try {
    const scriptUrl = SF_BASE + SF_FILE;
    const wasmUrl = SF_BASE + 'stockfish.wasm';
    engineLog('Script: ' + scriptUrl);
    engineLog('Wasm: ' + wasmUrl);

    // Descargamos el .wasm nosotros mismos y se lo pasamos al motor ya listo
    // vía Module.wasmBinary (soportado explícitamente por el loader). Esto
    // evita que el script tenga que "adivinar" dónde está su .wasm a partir
    // de self.location — algo que falla dentro de un worker creado desde un
    // Blob, porque ahí self.location sigue apuntando al blob, no al CDN.
    const wasmBuffer = await fetch(wasmUrl).then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' al descargar stockfish.wasm');
      return r.arrayBuffer();
    });
    engineLog('Wasm descargado (' + (wasmBuffer.byteLength / 1024 / 1024).toFixed(1) + ' MB)');

    const sfCode = await fetch(scriptUrl).then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' al descargar el script del motor');
      return r.text();
    });
    engineLog('Script del motor descargado (' + sfCode.length + ' caracteres)');

    // Los navegadores bloquean crear un Worker directamente desde una URL de
    // otro dominio, así que lo empaquetamos todo (wasm incluido, como base64)
    // en un único Blob del mismo origen.
    const wasmBase64 = arrayBufferToBase64(wasmBuffer);
    const bootstrap = `
var Module = {};
var __wasmBufferGlobal = null;
self.onunhandledrejection = function(e) {
  postMessage('__BOOT_ERROR__ promesa rechazada sin capturar: ' + (e.reason && e.reason.message ? e.reason.message : e.reason));
};
try {
  var __bin = atob(${JSON.stringify(wasmBase64)});
  var __bytes = new Uint8Array(__bin.length);
  for (var __i = 0; __i < __bin.length; __i++) __bytes[__i] = __bin.charCodeAt(__i);
  __wasmBufferGlobal = __bytes.buffer;
  Module.wasmBinary = __wasmBufferGlobal;
  postMessage('__DEBUG__ wasmBinary preparado, ' + __wasmBufferGlobal.byteLength + ' bytes');

  // El worker vive en un origen "blob:" opaco: cualquier fetch() con ruta
  // relativa ('stockfish.wasm') no tiene base URL contra la que resolverse y
  // falla con "is not a valid URL". Interceptamos fetch() para servir ese
  // archivo concreto directamente desde el buffer ya descargado. Usamos una
  // variable independiente de Module porque el propio script de Stockfish
  // reemplaza "Module" entero por su objeto interno de worker más adelante.
  var __realFetch = self.fetch ? self.fetch.bind(self) : null;
  self.fetch = function(url, opts) {
    if (typeof url === 'string' && url.indexOf('stockfish.wasm') !== -1) {
      postMessage('__DEBUG__ fetch interceptado para: ' + url);
      return Promise.resolve(new Response(__wasmBufferGlobal.slice(0), {
        status: 200,
        headers: { 'Content-Type': 'application/wasm' }
      }));
    }
    if (__realFetch) return __realFetch(url, opts);
    return Promise.reject(new Error('fetch no disponible para: ' + url));
  };
} catch (e) {
  postMessage('__BOOT_ERROR__ fallo decodificando el wasm: ' + e.message);
}
${sfCode}
postMessage('__DEBUG__ script del motor ejecutado hasta el final, ENVIRONMENT_IS_WORKER=' + (typeof ENVIRONMENT_IS_WORKER !== 'undefined' ? ENVIRONMENT_IS_WORKER : 'undefined'));
setTimeout(function() {
  postMessage('__DEBUG__ 3s después: Module.calledRun=' + (typeof Module !== 'undefined' && Module.calledRun));
}, 3000);
`;
    const blob = new Blob([bootstrap], { type: 'application/javascript' });
    const blobUrl = URL.createObjectURL(blob);
    engineLog('Worker preparado con el motor y el wasm embebidos…');

    const worker = new Worker(blobUrl);
    state.engine = worker;

    worker.onmessage = (e) => handleEngineMessage(typeof e.data === 'string' ? e.data : '');
    worker.onerror = (err) => {
      const msg = err && err.message ? err.message : 'error desconocido';
      engineLog('ERROR del worker: ' + msg + (err && err.filename ? ' (' + err.filename + ':' + err.lineno + ')' : ''), 'error');
      setEngineStatus('error', 'No se pudo cargar el motor');
    };

    worker.postMessage('uci');
    engineLog('Handshake UCI enviado, esperando respuesta…');

    setTimeout(() => {
      if (!state.engineReady) {
        engineLog('Aún sin respuesta del motor tras 12s.', 'error');
      }
    }, 12000);
  } catch (err) {
    engineLog('EXCEPCIÓN al crear el worker: ' + err.message, 'error');
    setEngineStatus('error', 'No se pudo cargar el motor');
  }
}

let pendingLiveEvalPly = null;

function handleEngineMessage(line) {
  if (typeof line === 'string' && line.startsWith('__BOOT_ERROR__')) {
    engineLog('FALLO al cargar el script del motor: ' + line.replace('__BOOT_ERROR__', ''), 'error');
    setEngineStatus('error', 'No se pudo cargar el motor');
    return;
  }
  engineLog(line);
  if (line === 'uciok') {
    state.engine.postMessage('isready');
    return;
  }
  if (line === 'readyok') {
    state.engineReady = true;
    engineLog('Motor listo ✓', 'ok');
    setEngineStatus('ready', 'Motor listo (Stockfish NNUE)');
    requestLiveEval();
    return;
  }

  if (line.startsWith('info') && line.includes('score')) {
    const info = parseInfoLine(line);
    if (info && pendingLiveEvalPly === state.ply) {
      updateEvalDisplay(info);
    }
    if (info && state._batchTarget !== undefined) {
      state._batchLatestInfo = info;
    }
  }

  if (line.startsWith('bestmove')) {
    if (state._batchResolve) {
      const resolve = state._batchResolve;
      const info = state._batchLatestInfo;
      state._batchResolve = null;
      state._batchLatestInfo = null;
      resolve(info);
    }
  }
}

function parseInfoLine(line) {
  const depthMatch = line.match(/depth (\d+)/);
  const cpMatch = line.match(/score cp (-?\d+)/);
  const mateMatch = line.match(/score mate (-?\d+)/);
  const pvMatch = line.match(/ pv (.+)$/);

  if (!cpMatch && !mateMatch) return null;

  return {
    depth: depthMatch ? parseInt(depthMatch[1], 10) : null,
    cp: cpMatch ? parseInt(cpMatch[1], 10) : null,
    mate: mateMatch ? parseInt(mateMatch[1], 10) : null,
    pv: pvMatch ? pvMatch[1].trim().split(' ') : [],
  };
}

function setEngineStatus(kind, text) {
  const dot = document.getElementById('engine-dot');
  dot.className = 'engine-dot' + (kind === 'ready' ? ' ready' : kind === 'thinking' ? ' thinking' : '');
  document.getElementById('engine-status-text').textContent = text;
}

/* --- Evaluación en vivo de la posición actual (mientras navegas) --- */
function requestLiveEval() {
  if (!state.engineReady || !state.engine) return;
  const fen = state.positions[state.ply];
  const depth = parseInt(document.getElementById('depth-slider').value, 10);

  pendingLiveEvalPly = state.ply;
  setEngineStatus('thinking', 'Evaluando posición…');
  state.engine.postMessage('stop');
  state.engine.postMessage(`position fen ${fen}`);
  state.engine.postMessage(`go depth ${depth}`);
}

function updateEvalDisplay(info) {
  setEngineStatus('ready', 'Motor listo (Stockfish NNUE)');

  const fill = document.getElementById('eval-bar-fill');
  const label = document.getElementById('eval-bar-label');

  if (!info) {
    fill.style.height = '50%';
    label.textContent = '0.0';
    return;
  }

  // Orientar el signo: cp/mate vienen desde la perspectiva del que mueve.
  const turnIsWhite = state.positions[state.ply].split(' ')[1] === 'w';

  let displayCp = info.cp;
  let mateIn = info.mate;
  if (!turnIsWhite) {
    if (displayCp !== null) displayCp = -displayCp;
    if (mateIn !== null) mateIn = -mateIn;
  }

  let pct = 50;
  let labelText = '0.0';

  if (mateIn !== null) {
    pct = mateIn > 0 ? 97 : 3;
    labelText = `M${Math.abs(mateIn)}`;
  } else if (displayCp !== null) {
    const clamped = Math.max(-1000, Math.min(1000, displayCp));
    pct = 50 + (clamped / 1000) * 48;
    labelText = (displayCp / 100).toFixed(1);
    if (displayCp > 0) labelText = '+' + labelText;
  }

  fill.style.height = pct + '%';
  label.textContent = labelText;
  label.style.color = pct > 50 ? '#14130f' : '#ece7d8';
  label.style.bottom = pct > 15 ? '4px' : 'auto';
  label.style.top = pct <= 15 ? '4px' : 'auto';
}

document.getElementById('depth-slider').addEventListener('input', (e) => {
  document.getElementById('depth-value').textContent = e.target.value;
});
document.getElementById('depth-slider').addEventListener('change', () => requestLiveEval());

/* ============================================================
   ANÁLISIS COMPLETO DE LA PARTIDA (batch, jugada a jugada)
   ============================================================ */
document.getElementById('analyze-btn').addEventListener('click', () => {
  if (state.analyzing) return;
  runFullAnalysis();
});

// Profundidad/tiempo adaptativos por posición, imitando cómo Chess.com y
// Lichess mantienen el análisis rápido: posiciones con muchas piezas (medio
// juego complejo) tienen un árbol de búsqueda mucho más ancho, así que se
// limita el tiempo por jugada; con pocas piezas (finales) el motor calcula
// mucho más rápido, así que se le da más profundidad, que sale gratis.
function adaptiveSearchParams(fen) {
  const pieceCount = (fen.split(' ')[0].match(/[a-zA-Z]/g) || []).length;
  if (pieceCount > 24) return { depth: 14, movetime: 350 };
  if (pieceCount > 14) return { depth: 16, movetime: 500 };
  if (pieceCount > 8) return { depth: 18, movetime: 600 };
  return { depth: 20, movetime: 700 };
}

async function runFullAnalysis() {
  if (!state.engine) ensureEngine();
  if (!state.engineReady) {
    setEngineStatus('loading', 'Esperando al motor…');
    await waitForEngineReady();
  }

  state.analyzing = true;
  document.getElementById('analyze-btn').disabled = true;
  document.getElementById('analyze-btn').textContent = 'Analizando…';
  document.getElementById('progress-wrap').hidden = false;

  const total = state.positions.length;

  for (let i = 0; i < total; i++) {
    const fen = state.positions[i];
    const { depth, movetime } = adaptiveSearchParams(fen);
    const info = await evaluatePositionOnce(fen, depth, movetime);
    annotateWhiteCp(i, info);
    state.analysis[i] = info;

    const pct = Math.round(((i + 1) / total) * 100);
    document.getElementById('progress-fill').style.width = pct + '%';
    document.getElementById('progress-text').textContent = `Analizando… ${i + 1}/${total}`;

    if (i % 3 === 0) drawEvalGraph();
  }

  classifyMoves();
  computeAccuracy();
  drawEvalGraph();
  renderMoveComment();
  drawBestMoveArrow();
  updateMoveBadge();

  document.getElementById('progress-text').textContent = 'Análisis completo';
  document.getElementById('analyze-btn').disabled = false;
  document.getElementById('analyze-btn').textContent = 'Volver a analizar';
  state.analyzing = false;
}

function waitForEngineReady() {
  return new Promise((resolve) => {
    const check = () => {
      if (state.engineReady) resolve();
      else setTimeout(check, 150);
    };
    check();
  });
}

function evaluatePositionOnce(fen, depth, movetime) {
  return new Promise((resolve) => {
    state._batchResolve = resolve;
    state._batchLatestInfo = null;
    state._batchTarget = fen;
    state.engine.postMessage('stop');
    state.engine.postMessage(`position fen ${fen}`);
    const goCmd = movetime
      ? `go depth ${depth} movetime ${movetime}`
      : `go depth ${depth}`;
    state.engine.postMessage(goCmd);

    // Salvaguarda: si por lo que sea el motor no manda "bestmove" a tiempo
    // (Stockfish 10 a veces ignora movetime en posiciones triviales), forzamos
    // el corte para que el análisis nunca se quede colgado en una jugada.
    const safetyMs = (movetime || 4000) + 2000;
    setTimeout(() => {
      if (state._batchResolve === resolve) {
        state.engine.postMessage('stop');
      }
    }, safetyMs);
  });
}
/* --- Clasificación de jugadas en función de la caída de evaluación --- */
const TAG_LABELS = {
  best: { label: 'Mejor jugada', cls: 'best', icon: '<img src="icons/best.png" alt="Mejor jugada">' },
  good: { label: 'Buena', cls: 'good', icon: '<img src="icons/good.png" alt="Buena">' },
  inaccuracy: { label: 'Imprecisión', cls: 'inaccuracy', icon: '<img src="icons/inaccuracy.png" alt="Imprecisión">' },
  mistake: { label: 'Error', cls: 'mistake', icon: '<img src="icons/mistake.png" alt="Error">' },
  blunder: { label: 'Error grave', cls: 'blunder', icon: '<img src="icons/blunder.png" alt="Error grave">' },
};

function classifyMoves() {
  state.moveTags = new Array(state.analysis.length).fill(null);

  for (let i = 1; i < state.analysis.length; i++) {
    const prev = state.analysis[i - 1];
    const curr = state.analysis[i];
    const tagEl = document.getElementById(`tag-${i}`);
    if (!prev || !curr) continue;

    const whiteJustMoved = (i - 1) % 2 === 0; // ply i-1 -> i, quien movió

    const prevWhiteCp = toWhiteCp(prev);
    const currWhiteCp = toWhiteCp(curr);
    if (prevWhiteCp === null || currWhiteCp === null) continue;

    // Pérdida desde el punto de vista de quien acaba de mover
    const loss = whiteJustMoved ? (prevWhiteCp - currWhiteCp) : (currWhiteCp - prevWhiteCp);

    const playedBest = prev.pv && prev.pv[0] &&
      moveToUci(state.verboseHistory[i - 1]) === prev.pv[0];

    let key;
    if (playedBest) {
      // Si jugaste la jugada que el motor considera la mejor posible, nunca es
      // un error, aunque la evaluación siga bajando (por ejemplo, si ya ibas
      // perdiendo material de antes: no había nada mejor que hacer).
      key = 'best';
    } else if (loss >= 300) key = 'blunder';
    else if (loss >= 120) key = 'mistake';
    else if (loss >= 50) key = 'inaccuracy';
    else key = 'good';

    state.moveTags[i] = key;

    if (tagEl) {
      const info = TAG_LABELS[key];
      // Solo marcamos visualmente en la lista los casos que llaman la atención,
      // para no saturar de símbolos una lista larga de jugadas correctas.
      if (key === 'blunder' || key === 'mistake' || key === 'inaccuracy' || key === 'best') {
        tagEl.innerHTML = info.icon;
        tagEl.className = `move-tag ${info.cls}`;
      } else {
        tagEl.innerHTML = '';
        tagEl.className = 'move-tag';
      }
    }
  }

  renderTagSummary();
}

function moveToUci(move) {
  if (!move) return null;
  return move.from + move.to + (move.promotion || '');
}

function renderTagSummary() {
  const wrap = document.getElementById('tag-summary');
  if (!state.moveTags) { wrap.hidden = true; return; }

  const counts = { best: [0, 0], good: [0, 0], inaccuracy: [0, 0], mistake: [0, 0], blunder: [0, 0] };
  state.moveTags.forEach((key, i) => {
    if (!key) return;
    const whiteJustMoved = (i - 1) % 2 === 0;
    counts[key][whiteJustMoved ? 0 : 1]++;
  });

  wrap.innerHTML = Object.keys(TAG_LABELS).map((key) => {
    const info = TAG_LABELS[key];
    return `
      <div class="tag-summary-row">
        <span class="tag-summary-label"><span class="tag-summary-dot ${info.cls}"></span>${info.label}</span>
        <span class="tag-summary-counts">
          <span class="count-white">${counts[key][0]}</span>
          <span class="count-black">${counts[key][1]}</span>
        </span>
      </div>
    `;
  }).join('');
  wrap.hidden = false;

  renderCoachMessage(counts);
}

/* --- Mensaje breve del "coach" resumiendo cómo fue la partida --- */
function renderCoachMessage(counts) {
  const card = document.getElementById('coach-card');
  const bubble = document.getElementById('coach-bubble');

  const totalBlunders = counts.blunder[0] + counts.blunder[1];
  const totalMistakes = counts.mistake[0] + counts.mistake[1];
  const totalBest = counts.best[0] + counts.best[1];

  let msg;
  if (totalBlunders >= 2) {
    msg = `Ha sido una partida con altibajos: hubo ${totalBlunders} errores graves que cambiaron el curso del juego. Revisa esas jugadas para aprender de ellas.`;
  } else if (totalBlunders === 1) {
    msg = 'Partida sólida en general, con un único error grave que marcó la diferencia.';
  } else if (totalMistakes >= 2) {
    msg = `Buen nivel general, aunque hubo ${totalMistakes} errores que se podrían haber evitado.`;
  } else if (totalBest >= 5) {
    msg = 'Muy buena partida — encontraste la mejor jugada del motor muchas veces.';
  } else {
    msg = 'Partida consistente, sin grandes sobresaltos en ningún momento.';
  }

  bubble.textContent = msg;
  card.hidden = false;
}

/* --- Comentario de texto para la jugada actualmente mostrada --- */
function sanToDisplay(san) {
  // Traduce notación de piezas SAN (letras inglesas) a símbolos, más legible
  // en prosa. Aquí simplemente devolvemos el SAN tal cual, que ya es estándar.
  return san;
}

function renderMoveComment() {
  const tagEl = document.getElementById('move-comment-tag');
  const textEl = document.getElementById('move-comment-text');
  const altsEl = document.getElementById('move-comment-alts');

  const ply = state.ply;
  if (ply === 0) {
    tagEl.textContent = '';
    tagEl.className = 'move-comment-tag';
    textEl.textContent = 'Posición inicial. Analiza la partida completa para ver un comentario de cada jugada.';
    altsEl.innerHTML = '';
    return;
  }

  const sanPlayed = state.history[ply - 1];
  const key = state.moveTags ? state.moveTags[ply] : null;

  if (!key) {
    tagEl.textContent = '';
    tagEl.className = 'move-comment-tag';
    textEl.textContent = `${sanPlayed} — analiza la partida completa para ver el comentario de esta jugada.`;
    altsEl.innerHTML = '';
    return;
  }

  const info = TAG_LABELS[key];
  tagEl.textContent = info.label;
  tagEl.className = `move-comment-tag ${info.cls}`;

  const prevInfo = state.analysis[ply - 1];
  const bestUci = prevInfo && prevInfo.pv ? prevInfo.pv[0] : null;
  const bestSan = bestUci ? uciToSan(bestUci, state.positions[ply - 1]) : null;

  let text;
  switch (key) {
    case 'best':
      text = `${sanPlayed} es la mejor jugada en esta posición. Difícil hacerlo mejor.`;
      break;
    case 'good':
      text = `${sanPlayed} es una jugada sólida, aunque no la única buena opción aquí.`;
      break;
    case 'inaccuracy':
      text = `${sanPlayed} es una ligera imprecisión.` + (bestSan ? ` ${bestSan} mantenía mejor la posición.` : '');
      break;
    case 'mistake':
      text = `${sanPlayed} es un error que cede ventaja.` + (bestSan ? ` ${bestSan} era claramente mejor.` : '');
      break;
    case 'blunder':
      text = `${sanPlayed} es un error grave que cambia el curso de la partida.` + (bestSan ? ` ${bestSan} era la jugada a seguir.` : '');
      break;
  }
  textEl.textContent = text;

  altsEl.innerHTML = '';
  if ((key === 'mistake' || key === 'blunder' || key === 'inaccuracy') && bestSan) {
    const evalText = formatEvalForDisplay(prevInfo, ply - 1);
    altsEl.innerHTML = `<div class="move-comment-alt"><span class="alt-eval">${evalText}</span> ${bestSan}</div>`;
  }
}

// Convierte un movimiento UCI (e2e4, e7e8q...) a notación SAN legible,
// reproduciéndolo sobre la posición dada.
function uciToSan(uci, fen) {
  try {
    const c = new Chess(fen);
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.length > 4 ? uci[4] : undefined;
    const move = c.move({ from, to, promotion });
    return move ? move.san : null;
  } catch (e) {
    return null;
  }
}

function formatEvalForDisplay(info, index) {
  if (!info) return '';
  const turnIsWhite = state.positions[index].split(' ')[1] === 'w';
  if (info.mate !== null) {
    const m = turnIsWhite ? info.mate : -info.mate;
    return 'M' + Math.abs(m);
  }
  if (info.cp === null) return '';
  const cpWhite = turnIsWhite ? info.cp : -info.cp;
  return (cpWhite > 0 ? '+' : '') + (cpWhite / 100).toFixed(1);
}

function toWhiteCp(info) {
  if (!info) return null;
  // El fen en el que se evaluó determina de quién es el turno; usamos el índice
  // implícito: info corresponde a positions[i], cuyo turno alterna empezando en blancas.
  return info._whiteCp !== undefined ? info._whiteCp : null;
}

/* Anotar cp desde perspectiva blanca en cada resultado, en el momento de guardarlo */
function annotateWhiteCp(index, info) {
  if (!info) return info;
  const turnIsWhite = state.positions[index].split(' ')[1] === 'w';
  let cp = info.cp;
  if (info.mate !== null) {
    cp = info.mate > 0 ? 10000 - info.mate : -10000 - info.mate;
  }
  if (cp === null) cp = 0;
  info._whiteCp = turnIsWhite ? cp : -cp;
  return info;
}

/* --- Precisión aproximada por bando (heurística tipo "accuracy") --- */
/* --- Precisión por bando, siguiendo el método público de Lichess:
   1) convertir cada evaluación a "% de victoria esperado" con una curva
      logística (mucho más realista que promediar centipawns directamente:
      perder 100cp en una posición igualada duele mucho más que perder 100cp
      cuando ya vas ganando por mucho);
   2) la precisión de cada jugada es función de cuánto cae ese % tras jugarla;
   3) el resultado final es la media (ponderada hacia abajo por las peores
      jugadas, como hace Lichess) de la precisión de todas las jugadas. --- */
function cpToWinPercent(cpWhite) {
  const k = -0.00368208;
  return 50 + 50 * (2 / (1 + Math.exp(k * cpWhite)) - 1);
}

function moveAccuracyFromWinPercentDrop(dropPercent) {
  // Fórmula pública de Lichess: accuracy = 103.1668 * exp(-0.04354 * drop) - 3.1669
  const acc = 103.1668 * Math.exp(-0.04354 * dropPercent) - 3.1669;
  return Math.max(0, Math.min(100, acc));
}

function computeAccuracy() {
  const whiteAccs = [];
  const blackAccs = [];

  for (let i = 1; i < state.analysis.length; i++) {
    const prev = state.analysis[i - 1];
    const curr = state.analysis[i];
    if (!prev || !curr) continue;
    const prevWhiteCp = toWhiteCp(prev);
    const currWhiteCp = toWhiteCp(curr);
    if (prevWhiteCp === null || currWhiteCp === null) continue;

    const whiteJustMoved = (i - 1) % 2 === 0;

    // % de victoria del bando que mueve, antes y después de su jugada.
    const prevWin = whiteJustMoved ? cpToWinPercent(prevWhiteCp) : 100 - cpToWinPercent(prevWhiteCp);
    const currWin = whiteJustMoved ? cpToWinPercent(currWhiteCp) : 100 - cpToWinPercent(currWhiteCp);
    const drop = Math.max(0, prevWin - currWin);

    const acc = moveAccuracyFromWinPercentDrop(drop);
    if (whiteJustMoved) whiteAccs.push(acc);
    else blackAccs.push(acc);
  }

  // Media armónica ponderada hacia las jugadas más flojas, como hace Lichess,
  // en vez de una media aritmética simple que diluye demasiado los errores.
  const weightedAverage = (accs) => {
    if (!accs.length) return null;
    const mean = accs.reduce((a, b) => a + b, 0) / accs.length;
    const variance = accs.reduce((a, b) => a + (b - mean) ** 2, 0) / accs.length;
    const stdev = Math.sqrt(variance);
    // Media aritmética y media armónica combinadas al 50%, aproximando el
    // comportamiento publicado por Lichess sin depender de su código exacto.
    const harmonic = accs.length / accs.reduce((a, b) => a + 1 / Math.max(b, 0.1), 0);
    return (mean + harmonic) / 2;
  };

  const whiteFinal = weightedAverage(whiteAccs);
  const blackFinal = weightedAverage(blackAccs);

  document.getElementById('accuracy-white-value').textContent = whiteFinal !== null ? whiteFinal.toFixed(1) + '%' : '—';
  document.getElementById('accuracy-black-value').textContent = blackFinal !== null ? blackFinal.toFixed(1) + '%' : '—';
  document.getElementById('accuracy-panel').hidden = false;
}

/* ============================================================
   GRÁFICA DE EVALUACIÓN
   ============================================================ */
function drawEvalGraph() {
  const svg = document.getElementById('eval-graph');
  const w = 400, h = 100;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

  const n = state.analysis.length;
  if (n < 2) { svg.innerHTML = ''; return; }

  // Solo dibujamos hasta la última posición ya analizada; el resto (aún sin
  // datos, con analysis[i] === null) no debe rellenarse con ceros, o la
  // gráfica muestra una caída falsa a "posición igualada" que no es real.
  let lastAnalyzed = -1;
  for (let i = 0; i < n; i++) if (state.analysis[i]) lastAnalyzed = i;
  if (lastAnalyzed < 1) { svg.innerHTML = ''; return; }

  const points = [];
  for (let i = 0; i <= lastAnalyzed; i++) {
    const info = state.analysis[i];
    let whiteCp = 0;
    if (info) {
      annotateWhiteCp(i, info);
      whiteCp = toWhiteCp(info) || 0;
    }
    const clamped = Math.max(-800, Math.min(800, whiteCp));
    const y = h / 2 - (clamped / 800) * (h / 2 - 4);
    const x = (i / (n - 1)) * w;
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }

  const lastX = (lastAnalyzed / (n - 1)) * w;
  const areaPoints = `0,${h} ` + points.join(' ') + ` ${lastX.toFixed(1)},${h}`;

  svg.innerHTML = `
    <line x1="0" y1="${h/2}" x2="${w}" y2="${h/2}" stroke="#3a3527" stroke-width="1" stroke-dasharray="3,3" />
    <polygon points="${areaPoints}" fill="rgba(217,154,61,0.12)" />
    <polyline points="${points.join(' ')}" fill="none" stroke="#d99a3d" stroke-width="1.6" />
    <line id="graph-cursor" x1="0" y1="0" x2="0" y2="${h}" stroke="#f0b25c" stroke-width="1.2" />
  `;

  updateGraphCursor();
}

function updateGraphCursor() {
  const svg = document.getElementById('eval-graph');
  const cursor = document.getElementById('graph-cursor');
  if (!cursor) return;
  const n = state.analysis.length;
  if (n < 2) return;
  const x = (state.ply / (n - 1)) * 400;
  cursor.setAttribute('x1', x);
  cursor.setAttribute('x2', x);
}

/* ============================================================
   PESTAÑAS DEL PANEL LATERAL
   ============================================================ */
document.querySelectorAll('.side-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.side-tab').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.getElementById('tab-report').hidden = tab !== 'report';
    document.getElementById('tab-analysis').hidden = tab !== 'analysis';
    if (tab === 'analysis') renderMoveComment();
  });
});

/* ============================================================
   INICIALIZACIÓN
   ============================================================ */
showScreen('home');
usernameInput.focus();
