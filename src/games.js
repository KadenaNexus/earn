// Server side of Kadena Nexus Games: builds each paid puzzle and checks the
// finished play. The browser never sees answers, and a win is decided here,
// from server timestamps, before the AI agent reviews how it was played.
import { randomInt } from 'node:crypto';
import { tilesGenerate, tilesCheck, logicGenerate, logicCheck, intervalStats, answerMatches, wordScore, WORD_TRIES, memoryGenerate, memoryFlip, MINES, minesPlace, minesReveal, minesAround } from '../public/games-core.js';
import { QUIZ, WRITTEN, RIDDLES, WORDS, PACT_BUGS } from './game-content.js';

export const GAME_KINDS = ['tiles', 'quiz', 'logic', 'riddle', 'word', 'memory', 'mines', 'pactbug'];
// Games played move by move against the server, which keeps the hidden part.
export const INTERACTIVE = ['word', 'memory', 'mines'];
export const GAMES = {
  tiles: { name: 'Sliding Tiles', blurb: 'Slide the numbered tiles back into order, 1 to 15.', minSeconds: 15, minutes: 15 },
  quiz: { name: 'Kadena Quiz', blurb: 'Five questions about Kadena and one short answer in your own words.', minSeconds: 30, minutes: 15 },
  logic: { name: 'Logic Grid', blurb: 'Fill the 6×6 grid so every row, column and box has 1 to 6.', minSeconds: 40, minutes: 20 },
  riddle: { name: 'Riddles', blurb: 'Answer three riddles. Short answers are fine.', minSeconds: 15, minutes: 10 },
  word: { name: 'Kadena Word', blurb: 'Guess the hidden 5-letter word in 6 tries. Colors show how close you are.', minSeconds: 20, minutes: 10 },
  memory: { name: 'Memory Match', blurb: 'Flip cards two at a time and find all 8 pairs.', minSeconds: 20, minutes: 10 },
  mines: { name: 'Minesweeper', blurb: 'Open every safe square on an 8×8 board without hitting one of the 10 mines.', minSeconds: 25, minutes: 15 },
  pactbug: { name: 'Spot the Pact Bug', blurb: 'Find the security mistake in a short Pact contract and explain it.', minSeconds: 30, minutes: 15 },
};
export const QUIZ_QUESTIONS = 5, QUIZ_PASS = 4, RIDDLE_COUNT = 3;

export const secureRand = () => randomInt(0, 2 ** 32) / 2 ** 32;
function pick(list, n, rand) {
  const idx = [...list.keys()];
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  return idx.slice(0, n);
}

// Returns { puzzle } for the player and { secret } kept on the server.
export function newRound(game, rand = secureRand) {
  if (game === 'tiles') return { puzzle: tilesGenerate(rand), secret: {} };
  if (game === 'logic') { const { puzzle, solution } = logicGenerate(rand); return { puzzle, secret: { solution } }; }
  if (game === 'quiz') {
    const ids = pick(QUIZ, QUIZ_QUESTIONS, rand);
    const questions = [], answers = [];
    for (const id of ids) {
      const order = pick(QUIZ[id].o, QUIZ[id].o.length, rand);
      questions.push({ q: QUIZ[id].q, o: order.map(i => QUIZ[id].o[i]) });
      answers.push(order.indexOf(QUIZ[id].a));
    }
    const w = WRITTEN[Math.floor(rand() * WRITTEN.length)];
    return { puzzle: { questions, written: w.q }, secret: { ids, answers, written: w } };
  }
  if (game === 'riddle') {
    const ids = pick(RIDDLES, RIDDLE_COUNT, rand);
    return { puzzle: { riddles: ids.map(id => ({ q: RIDDLES[id].q })) }, secret: { ids } };
  }
  if (game === 'word') return { puzzle: { letters: 5, tries: WORD_TRIES }, secret: { word: WORDS[Math.floor(rand() * WORDS.length)] }, state: { guesses: [], times: [] } };
  if (game === 'memory') return { puzzle: { cards: 16, columns: 4 }, secret: { cards: memoryGenerate(rand) }, state: { flips: 0, matched: [], times: [] } };
  if (game === 'mines') return { puzzle: { ...MINES }, secret: { mines: null }, state: { revealed: [], moves: 0, times: [] } };
  if (game === 'pactbug') {
    const id = Math.floor(rand() * PACT_BUGS.length), b = PACT_BUGS[id];
    const order = pick(b.o, b.o.length, rand);
    return { puzzle: { code: b.code, options: order.map(i => b.o[i]) }, secret: { id, answer: order.indexOf(b.a) } };
  }
  throw new Error('Unknown game');
}

// What the player may see of a round in progress (for resuming): never the hidden word, cards or mines.
export function publicState(game, secret, state) {
  if (!state) return null;
  if (game === 'word') return { guesses: state.guesses };
  if (game === 'memory') return { flips: state.flips, matched: state.matched.map(i => [i, secret.cards[i]]), open: Number.isInteger(state.open) ? [state.open, secret.cards[state.open]] : null };
  if (game === 'mines') {
    const set = new Set(secret.mines || []);
    return { moves: state.moves, revealed: state.revealed.map(i => [i, minesAround(i).filter(x => set.has(x)).length]) };
  }
  return null;
}

// One move in an interactive round. Mutates secret/state; returns what the player sees.
// { lost: true } ends the round as a miss; { solved: true } lets the player finish.
export function moveRound(game, secret, state, move, rand = secureRand) {
  const t = Number(move?.t);
  const stamp = () => { if (Number.isFinite(t) && t >= 0) state.times.push(Math.round(t)); };
  if (game === 'word') {
    const guess = String(move?.guess || '').toLowerCase();
    if (!/^[a-z]{5}$/.test(guess)) return { error: 'Type a 5-letter word' };
    if (state.guesses.length >= WORD_TRIES || state.guesses.at(-1)?.g === secret.word) return { error: 'This round is over' };
    const score = wordScore(guess, secret.word);
    state.guesses.push({ g: guess, score }); stamp();
    const solved = guess === secret.word, lost = !solved && state.guesses.length >= WORD_TRIES;
    return { score, solved, lost, ...(lost ? { word: secret.word } : {}) };
  }
  if (game === 'memory') {
    // Cards turn one at a time: the first shows its symbol, the second resolves the pair.
    if (state.flips >= 200) return { error: 'Too many flips in this round' };
    const i = Number(move?.card);
    if (!Number.isInteger(i) || i < 0 || i >= secret.cards.length || state.matched.includes(i) || i === state.open) return { error: 'Pick a face-down card' };
    stamp();
    if (state.open === undefined || state.open === null) { state.open = i; return { card: { i, s: secret.cards[i] } }; }
    const r = memoryFlip(secret.cards, state, state.open, i); state.open = null;
    return r;
  }
  if (game === 'mines') {
    const i = Number(move?.cell);
    if (!Number.isInteger(i) || i < 0 || i >= MINES.w * MINES.h) return { error: 'Invalid square' };
    if (state.revealed.includes(i)) return { opened: [], solved: false };
    if (!secret.mines) secret.mines = minesPlace(rand, i);
    state.moves++; stamp();
    const r = minesReveal(secret.mines, state.revealed, i);
    return r.boom ? { lost: true, mines: secret.mines } : r;
  }
  return { error: 'This game has no moves' };
}

const clock = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const str = (v, max) => typeof v === 'string' ? v.slice(0, max) : '';

// Checks a finished round. `seconds` is measured by the server (start to finish).
// Returns what the player sees, the public summary, and what the AI agent reviews.
export function checkRound(game, puzzle, secret, play, seconds, state = null) {
  const meta = GAMES[game], flags = [];
  if (seconds < meta.minSeconds) flags.push(`finished in ${Math.round(seconds)} s, under the ${meta.minSeconds} s minimum for a person`);
  play = play && typeof play === 'object' ? play : {};
  if (game === 'tiles') {
    const moves = Array.isArray(play.moves) ? play.moves.slice(0, 3001) : [];
    const r = tilesCheck(puzzle, moves);
    if (!r.solved) return { solved: false, message: r.error || 'The tiles are not in order yet.' };
    const times = Array.isArray(play.times) && play.times.length === moves.length && play.times.every((t, i, a) => Number.isFinite(t) && t >= 0 && (i === 0 || t >= a[i - 1])) ? play.times : null;
    const timing = intervalStats(times);
    if (!times) flags.push('move times missing or out of order');
    else if (times.at(-1) > seconds * 1000 + 5000) flags.push('move times longer than the server-measured round');
    if (timing && moves.length >= 15 && (timing.median_ms < 150 || timing.sd_ms < 30)) flags.push(`machine-like move timing (median ${timing.median_ms} ms, spread ${timing.sd_ms} ms)`);
    return { solved: true, summary: `Solved the Sliding Tiles puzzle in ${clock(seconds)} with ${moves.length} moves.`,
      review: { game: 'Sliding Tiles (4×4)', seconds: Math.round(seconds), moves: moves.length, move_timing: timing }, flags };
  }
  if (game === 'logic') {
    const grid = Array.isArray(play.grid) ? play.grid.slice(0, 36).map(Number) : [];
    const r = logicCheck(puzzle, grid);
    if (!r.solved) return { solved: false, message: r.error };
    const blanks = puzzle.givens.filter(v => !v).length, entries = Number.isInteger(play.entries) ? play.entries : 0;
    if (entries < blanks) flags.push(`only ${entries} number entries for ${blanks} empty squares (pasted?)`);
    return { solved: true, summary: `Solved the 6×6 Logic Grid in ${clock(seconds)}.`,
      review: { game: 'Logic Grid (6×6)', seconds: Math.round(seconds), empty_squares: blanks, entries }, flags };
  }
  if (game === 'quiz') {
    const choices = Array.isArray(play.choices) ? play.choices.slice(0, QUIZ_QUESTIONS) : [];
    const correct = secret.answers.filter((a, i) => choices[i] === a).length;
    const written = str(play.written, 1200).trim();
    if (correct < QUIZ_PASS) return { solved: false, message: `${correct} of ${QUIZ_QUESTIONS} correct. You need ${QUIZ_PASS} to pass.` };
    if (written.length < 20) return { solved: false, message: `${correct} of ${QUIZ_QUESTIONS} correct. Write at least a sentence for the last question.` };
    return { solved: true, summary: `Passed the Kadena Quiz: ${correct} of ${QUIZ_QUESTIONS} correct, plus a written answer.`,
      review: { game: 'Kadena Quiz', seconds: Math.round(seconds), correct: `${correct} of ${QUIZ_QUESTIONS}`, written_question: secret.written.q,
        what_a_good_answer_says: secret.written.guide, written_answer: written }, flags };
  }
  if (game === 'riddle') {
    const answers = Array.isArray(play.answers) ? play.answers.slice(0, RIDDLE_COUNT).map(a => str(a, 100)) : [];
    const results = secret.ids.map((id, i) => answerMatches(answers[i], RIDDLES[id].answers));
    const right = results.filter(Boolean).length;
    if (right < RIDDLE_COUNT) return { solved: false, message: `${right} of ${RIDDLE_COUNT} riddles right. Try again with new riddles.` };
    return { solved: true, summary: `Solved ${right} of ${RIDDLE_COUNT} riddles in ${clock(seconds)}.`,
      review: { game: 'Riddles', seconds: Math.round(seconds), riddles: secret.ids.map((id, i) => ({ riddle: RIDDLES[id].q, accepted: RIDDLES[id].answers, player: answers[i] })) }, flags };
  }
  const timing = intervalStats(state?.times);
  if (game === 'word') {
    const won = state?.guesses.at(-1)?.g === secret.word;
    if (!won) return { solved: false, message: 'The word has not been guessed yet.' };
    const n = state.guesses.length;
    if (n === 1) flags.push('guessed the hidden word on the first try');
    return { solved: true, summary: `Guessed the hidden word in ${n} ${n === 1 ? 'try' : 'tries'}.`,
      review: { game: 'Kadena Word (5 letters, 6 tries)', seconds: Math.round(seconds), guesses: state.guesses.map(x => x.g), tries: n, guess_timing: timing }, flags };
  }
  if (game === 'memory') {
    if (state?.matched.length !== secret.cards.length) return { solved: false, message: 'Some pairs are still face down.' };
    if (state.flips < 10) flags.push(`found all 8 pairs in ${state.flips} flips (near-perfect luck or knowledge of the layout)`);
    if (timing && timing.median_ms < 250) flags.push(`machine-like flip timing (median ${timing.median_ms} ms)`);
    return { solved: true, summary: `Found all 8 pairs in ${clock(seconds)} with ${state.flips} flips.`,
      review: { game: 'Memory Match (8 pairs)', seconds: Math.round(seconds), flips: state.flips, flip_timing: timing }, flags };
  }
  if (game === 'mines') {
    if (!secret.mines || state?.revealed.length !== MINES.w * MINES.h - MINES.n) return { solved: false, message: 'Some safe squares are still closed.' };
    if (timing && state.moves >= 8 && timing.median_ms < 200) flags.push(`machine-like click timing (median ${timing.median_ms} ms)`);
    return { solved: true, summary: `Cleared the 8×8 Minesweeper board in ${clock(seconds)}.`,
      review: { game: 'Minesweeper (8×8, 10 mines)', seconds: Math.round(seconds), clicks: state.moves, click_timing: timing }, flags };
  }
  if (game === 'pactbug') {
    const choice = Number(play.choice), written = str(play.written, 1200).trim(), b = PACT_BUGS[secret.id];
    if (choice !== secret.answer) return { solved: false, message: 'That is not the bug. Try again with a new contract.' };
    if (written.length < 20) return { solved: false, message: 'Right bug. Write at least a sentence on why it is dangerous.' };
    return { solved: true, summary: 'Found the bug in a Pact contract and explained it.',
      review: { game: 'Spot the Pact Bug', seconds: Math.round(seconds), contract: b.code, bug: b.o[b.a], what_a_good_answer_says: b.guide, written_answer: written }, flags };
  }
  throw new Error('Unknown game');
}

// Proof fields for a game round: the public line, and the private play record
// the AI agent reviews. Both are written by the server, never by the player.
export const GAME_PROOF_SCHEMA = [
  { key: 'result', label: 'Game result', type: 'text', min_len: 0, required: true, private: false },
  { key: 'play', label: 'How it was played', type: 'text', min_len: 0, required: true, private: true },
];
export function gameSteps(game) {
  const g = GAMES[game];
  return [`Open Games and press Play for KDA on ${g.name}.`, g.blurb, 'Finish within the time limit. The puzzle is checked as soon as you finish.', 'The AI agent reviews how the round was played and pays the reward from escrow.'];
}
