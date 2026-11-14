// Quick test of the scheduling logic inside index.html.
// Run with:  node tests/test-scheduler.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const match = html.match(/<script id="scheduler">([\s\S]*?)<\/script>/);
if (!match) throw new Error('Could not find the scheduler script in index.html');
const sandbox = { module: { exports: {} }, performance, globalThis: {} };
vm.runInNewContext(match[1], sandbox);
const S = sandbox.module.exports;

const NAMES = ['Ann', 'Bob', 'Cal', 'Dee', 'Eve', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jo',
  'Kim', 'Lou', 'Max', 'Ned', 'Oli', 'Pat', 'Quin', 'Roy'];

const cases = [
  { players: 18, courts: 4 },
  { players: 16, courts: 4 },
  { players: 13, courts: 3 },
  { players: 8, courts: 2 },
];

let allPassed = true;
function check(ok, msg) {
  if (!ok) { allPassed = false; console.log('   ❌ FAIL: ' + msg); }
}

for (const c of cases) {
  const names = NAMES.slice(0, c.players);
  const courts = Array.from({ length: c.courts }, (_, i) => String(i + 3));
  const rounds = S.suggestRounds(c.players, c.courts);
  const t0 = Date.now();
  const res = S.generate(names, courts, rounds, { timeLimitMs: 1500 });
  const ms = Date.now() - t0;
  console.log(`\n=== ${c.players} players, ${c.courts} courts, ${rounds} rounds (took ${ms} ms, ${res.stats.attempts} tries) ===`);

  // Recount everything independently from the raw schedule
  const partner = {}, opp = {}, sits = Object.fromEntries(names.map(n => [n, 0]));
  const key = (a, b) => [a, b].sort().join('+');
  let consecutive = 0, prevSit = new Set();
  res.rounds.forEach((rd, r) => {
    const seen = [];
    rd.courts.forEach(g => { g.teams.forEach(t => seen.push(...t)); });
    seen.push(...rd.sitOut);
    check(seen.length === names.length, `round ${r + 1} has ${seen.length} slots, expected ${names.length}`);
    check(new Set(seen).size === seen.length, `round ${r + 1}: someone is double-booked`);
    check(names.every(n => seen.includes(n)), `round ${r + 1}: someone is missing`);
    check(rd.courts.length === Math.min(c.courts, Math.floor(c.players / 4)), `round ${r + 1}: wrong number of courts`);
    rd.courts.forEach(g => {
      const [[a, b], [x, y]] = g.teams;
      partner[key(a, b)] = (partner[key(a, b)] || 0) + 1;
      partner[key(x, y)] = (partner[key(x, y)] || 0) + 1;
      for (const p of [a, b]) for (const q of [x, y]) opp[key(p, q)] = (opp[key(p, q)] || 0) + 1;
    });
    rd.sitOut.forEach(n => { sits[n]++; if (prevSit.has(n)) consecutive++; });
    prevSit = new Set(rd.sitOut);
  });

  const maxPartner = Math.max(...Object.values(partner));
  const maxOpp = Math.max(...Object.values(opp));
  const repeatPartners = Object.values(partner).reduce((s, v) => s + Math.max(0, v - 1), 0);
  const sitVals = Object.values(sits);
  const sitSpread = Math.max(...sitVals) - Math.min(...sitVals);
  // Best possible: each player plays (rounds - their sit-outs) games, can't exceed players-1 partners
  const gamesEach = names.map(n => rounds - sits[n]);
  const repeatsForced = gamesEach.some(g => g > c.players - 1);

  console.log(`   Double-booking check: OK (every player exactly once per round)`);
  console.log(`   Most times any pair partnered: ${maxPartner}   (repeat partnerships: ${repeatPartners})`);
  console.log(`   Most times any pair were opponents: ${maxOpp}`);
  console.log(`   Same people on a court back-to-back: ${res.stats.backToBack}`);
  console.log(`   Sit-outs per player: min ${Math.min(...sitVals)}, max ${Math.max(...sitVals)}; sat out twice in a row: ${consecutive}`);

  check(sitSpread <= 1, 'sit-outs uneven (spread > 1)');
  check(consecutive === 0, 'someone sat out two rounds in a row');
  if (!repeatsForced) check(maxPartner <= 1, 'repeat partners even though avoidable');
  check(maxOpp <= 3, 'too many repeat opponents');
  check(ms < 3000, 'too slow');

  // Also check the stats the app shows match our independent count
  check(res.stats.maxPartner === maxPartner && res.stats.maxOpponent === maxOpp, 'app stats disagree with recount');
}

// Extra: longer sessions and edge cases
for (const [p, c, r] of [[18, 4, 17], [9, 2, 12], [5, 1, 5], [4, 3, 3], [22, 4, 10]]) {
  const res = S.generate(NAMES.concat(['S1','S2','S3','S4']).slice(0, p), Array.from({ length: c }, (_, i) => 'C' + i), r, { timeLimitMs: 1500 });
  const s = res.stats;
  console.log(`\n(extra) ${p} players / ${c} courts / ${r} rounds → max partner ${s.maxPartner}, max opp ${s.maxOpponent}, sit-outs ${s.minSit}-${s.maxSit}, back-to-back sits ${s.consecutiveSits}, courts used ${s.courtsUsed}`);
  check(s.maxSit - s.minSit <= 1, 'uneven sit-outs in extra case');
}

console.log('\n' + (allPassed ? '✅ ALL CHECKS PASSED' : '❌ SOME CHECKS FAILED'));
process.exit(allPassed ? 0 : 1);
