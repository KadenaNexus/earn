// Server side of Kadena Nexus Games: builds each paid puzzle and checks the
// finished play. The browser never sees answers, and a win is decided here,
// from server timestamps, before the AI agent reviews how it was played.
import { randomInt } from 'node:crypto';
import { tilesGenerate, tilesCheck, logicGenerate, logicCheck, intervalStats, answerMatches } from '../public/games-core.js';
import { QUIZ, WRITTEN, RIDDLES } from './game-content.js';

export const GAME_KINDS = ['tiles', 'quiz', 'logic', 'riddle'];
export const GAMES = {
  tiles: { name: 'Sliding Tiles', blurb: 'Slide the numbered tiles back into order, 1 to 15.', minSeconds: 15, minutes: 15 },
  quiz: { name: 'Kadena Quiz', blurb: 'Five questions about Kadena and one short answer in your own words.', minSeconds: 30, minutes: 15 },
  logic: { name: 'Logic Grid', blurb: 'Fill the 6×6 grid so every row, column and box has 1 to 6.', minSeconds: 40, minutes: 20 },
  riddle: { name: 'Riddles', blurb: 'Answer three riddles. Short answers are fine.', minSeconds: 15, minutes: 10 },
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
  throw new Error('Unknown game');
}

const clock = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const str = (v, max) => typeof v === 'string' ? v.slice(0, max) : '';

// Checks a finished round. `seconds` is measured by the server (start to finish).
// Returns what the player sees, the public summary, and what the AI agent reviews.
export function checkRound(game, puzzle, secret, play, seconds) {
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
