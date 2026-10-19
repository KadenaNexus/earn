// Kadena Nexus Games: puzzle generators and checkers shared by the browser
// (practice mode) and the server (paid rounds). Pure functions, no DOM.
// The server always generates the puzzle a player is paid for and checks the
// finished play itself; the browser copy only powers practice and feedback.

export const TILE_SIZE = 4;

// ---------- Sliding tiles (4×4, numbers 1–15 and one gap) ----------
export function tilesSolved(size = TILE_SIZE) {
  return [...Array(size * size - 1)].map((_, i) => i + 1).concat(0);
}
export function tileNeighbors(index, size = TILE_SIZE) {
  const r = Math.floor(index / size), c = index % size, out = [];
  if (r > 0) out.push(index - size);
  if (r < size - 1) out.push(index + size);
  if (c > 0) out.push(index - 1);
  if (c < size - 1) out.push(index + 1);
  return out;
}
// A random walk from the solved board is always solvable.
export function tilesGenerate(rand, { size = TILE_SIZE, steps = 50 } = {}) {
  const board = tilesSolved(size);
  let gap = board.indexOf(0), previous = -1;
  for (let i = 0; i < steps; i++) {
    const options = tileNeighbors(gap, size).filter(n => n !== previous);
    const next = options[Math.floor(rand() * options.length)];
    [board[gap], board[next]] = [board[next], board[gap]];
    previous = gap; gap = next;
  }
  if (board.every((v, i) => v === tilesSolved(size)[i])) return tilesGenerate(rand, { size, steps });
  return { size, board };
}
// moves: tile numbers in the order they were slid into the gap.
export function tilesCheck(puzzle, moves) {
  const size = puzzle.size, board = [...puzzle.board];
  if (!Array.isArray(moves) || moves.length < 1 || moves.length > 3000) return { solved: false, error: 'Invalid move list' };
  for (const tile of moves) {
    if (!Number.isInteger(tile) || tile < 1 || tile >= size * size) return { solved: false, error: 'Invalid move' };
    const at = board.indexOf(tile), gap = board.indexOf(0);
    if (!tileNeighbors(gap, size).includes(at)) return { solved: false, error: 'A move was not next to the gap' };
    [board[gap], board[at]] = [board[at], board[gap]];
  }
  const solved = board.every((v, i) => v === tilesSolved(size)[i]);
  return { solved, board, moves: moves.length };
}

// ---------- Logic grid (6×6 Sudoku-style, boxes of 2 rows × 3 columns) ----------
export const GRID = { n: 6, br: 2, bc: 3 };
const fits = (g, i, v, { n, br, bc } = GRID) => {
  const r = Math.floor(i / n), c = i % n;
  for (let k = 0; k < n; k++) if (g[r * n + k] === v || g[k * n + c] === v) return false;
  const r0 = r - r % br, c0 = c - c % bc;
  for (let a = 0; a < br; a++) for (let b = 0; b < bc; b++) if (g[(r0 + a) * n + c0 + b] === v) return false;
  return true;
};
function shuffled(list, rand) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function fill(g, rand) {
  const i = g.indexOf(0);
  if (i < 0) return true;
  for (const v of shuffled([1, 2, 3, 4, 5, 6], rand)) {
    if (fits(g, i, v)) { g[i] = v; if (fill(g, rand)) return true; g[i] = 0; }
  }
  return false;
}
export function countSolutions(g, limit = 2) {
  const i = g.indexOf(0);
  if (i < 0) return 1;
  let count = 0;
  for (let v = 1; v <= GRID.n; v++) {
    if (fits(g, i, v)) { g[i] = v; count += countSolutions(g, limit - count); g[i] = 0; if (count >= limit) break; }
  }
  return count;
}
// Removes clues while the answer stays unique, down to `clues` givens.
export function logicGenerate(rand, { clues = 14 } = {}) {
  const solution = Array(36).fill(0);
  fill(solution, rand);
  const givens = [...solution];
  let left = 36;
  for (const i of shuffled([...Array(36).keys()], rand)) {
    if (left <= clues) break;
    const keep = givens[i]; givens[i] = 0;
    if (countSolutions([...givens]) !== 1) givens[i] = keep; else left--;
  }
  return { puzzle: { n: 6, br: 2, bc: 3, givens }, solution };
}
// Any complete grid that keeps the givens and follows the rules is accepted.
export function logicCheck(puzzle, grid) {
  if (!Array.isArray(grid) || grid.length !== 36 || !grid.every(v => Number.isInteger(v) && v >= 1 && v <= 6)) return { solved: false, error: 'Fill every square with a number from 1 to 6' };
  if (puzzle.givens.some((v, i) => v && grid[i] !== v)) return { solved: false, error: 'A starting number was changed' };
  for (let i = 0; i < 36; i++) {
    const g = [...grid]; const v = g[i]; g[i] = 0;
    if (!fits(g, i, v)) return { solved: false, error: 'A row, column or box repeats a number' };
  }
  return { solved: true };
}

// ---------- Timing helpers (used to describe how a puzzle was played) ----------
export function intervalStats(times) {
  if (!Array.isArray(times) || times.length < 3) return null;
  const gaps = [];
  for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
  const sorted = [...gaps].sort((a, b) => a - b);
  const mean = gaps.reduce((s, x) => s + x, 0) / gaps.length;
  const sd = Math.sqrt(gaps.reduce((s, x) => s + (x - mean) ** 2, 0) / gaps.length);
  return { median_ms: Math.round(sorted[Math.floor(sorted.length / 2)]), min_ms: Math.round(sorted[0]), sd_ms: Math.round(sd) };
}

// ---------- Answer matching for riddles ----------
export function normalizeAnswer(text) {
  return String(text || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\b(a|an|the|my|your|its|it is|it's)\b/g, ' ').replace(/\s+/g, ' ').trim();
}
const singular = w => w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w;
export function answerMatches(given, accepted) {
  const g = normalizeAnswer(given);
  if (!g || g.split(' ').length > 5) return false;
  const words = g.split(' ').map(singular);
  return accepted.some(a => {
    const n = normalizeAnswer(a).split(' ').map(singular).join(' ');
    return words.join(' ') === n || (` ${words.join(' ')} `).includes(` ${n} `);
  });
}
