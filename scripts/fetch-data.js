#!/usr/bin/env node
// Fetches RTS's four live Arbor "data-export" links and writes data/live.json,
// which index.html reads at run time. The links themselves are never written
// to disk here - they come in as environment variables (GitHub Actions
// repository secrets), and only the parsed, aggregated results are committed.

import * as cheerio from 'cheerio';
import { writeFileSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const URLS = {
  behaviour: process.env.ARBOR_BEHAVIOUR_URL,
  late: process.env.ARBOR_LATE_URL,
  detentions: process.env.ARBOR_DETENTIONS_URL,
  suspensions: process.env.ARBOR_SUSPENSIONS_URL,
};

const behaviourValues = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'data', 'behaviour-values.json'), 'utf8')
);
const valueLookup = {};
behaviourValues.forEach(v => { valueLookup[v.incident.trim().toLowerCase()] = v; });

// ---------------------------------------------------------------------------
// Generic Arbor export parser: every one of these "format/html" links is a
// plain table (one header row + data rows). We read whatever headers Arbor
// actually sends rather than hard-coding column positions, so this same
// function works for Behaviour, Late, Detentions and Suspensions alike.
// ---------------------------------------------------------------------------
async function fetchTable(url, label) {
  if (!url) {
    console.warn(`[${label}] no URL configured (secret missing) - skipping.`);
    return [];
  }
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`[${label}] HTTP ${res.status} - skipping.`);
    return [];
  }
  const html = await res.text();
  const $ = cheerio.load(html);
  const table = $('table').first();
  const headerCells = table.find('tr').first().find('th,td');
  const headers = [];
  headerCells.each((i, el) => headers.push($(el).text().trim() || `col${i}`));

  const rows = [];
  table.find('tr').slice(1).each((i, tr) => {
    const cells = $(tr).find('td');
    if (cells.length === 0) return;
    const row = {};
    cells.each((j, td) => { row[headers[j] || `col${j}`] = $(td).text().trim(); });
    rows.push(row);
  });
  console.log(`[${label}] parsed ${rows.length} rows (columns: ${headers.join(', ')})`);
  return rows;
}

function col(row, name) {
  const key = Object.keys(row).find(k => k.toLowerCase() === name.toLowerCase());
  return key ? row[key] : '';
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dayLabel(d) {
  // Matches the dashboard's own "1 Sep" style exactly (day.toLocaleDateString
  // renders September as "Sept" in en-GB, which would look inconsistent).
  return d.getUTCDate() + ' ' + MONTH_ABBR[d.getUTCMonth()];
}

// Arbor renders dates in more than one style across its exports (e.g. the
// unambiguous "Wed, 09 Sep 2026, 11:20" on the Late export, but possibly a
// bare "01/09/2026 12:47" elsewhere). JavaScript's native Date() reads
// slash-separated dates as US-style MM/DD/YYYY, which silently turns 1
// September into 9 January - so DD/MM/YYYY is parsed explicitly here rather
// than trusted to new Date(), and everything else falls back to native
// parsing (safe once a month name is spelled out, as UK school systems do).
function parseArborDate(str) {
  if (!str) return null;
  const s = str.trim();
  const m = s.match(/^(?:\w{3},\s*)?(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,)?\s*(\d{1,2}):(\d{2})/);
  if (m) {
    const [, dd, mm, yyyy, hh, min] = m;
    const d = new Date(Date.UTC(+yyyy, +mm - 1, +dd, +hh, +min));
    return isNaN(d) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

// ---------------------------------------------------------------------------
// Behaviour export -> everything the dashboard's "This week" panels need.
// Positive/Negative/Neutral comes from data/behaviour-values.json (RTS's own
// 44 real incident names), not from Arbor directly - Arbor's export doesn't
// carry that classification itself.
// ---------------------------------------------------------------------------
function aggregateBehaviour(rows) {
  const dayTotals = {};   // 'YYYY-MM-DD' -> {pos,neg,neu}
  const catTotals = {};   // category -> {pos,neg,neu}
  const incidentCounts = {}; // incident name -> {count, bucket}
  const studentTotals = {};  // student name -> {pos,neg,neu,last,when,_date}
  let resolvedCount = 0;
  let unknownNames = new Set();

  rows.forEach(row => {
    const name = col(row, 'Behaviour').trim();
    const dtRaw = col(row, 'Date/Time');
    const status = col(row, 'Status');
    const studentsRaw = col(row, 'Students Involved');
    if (!name) return;
    if (name.toLowerCase().includes('bogus')) return; // Arbor's own test row
    if (studentsRaw && studentsRaw.toLowerCase().includes('bogus student')) return;

    const meta = valueLookup[name.toLowerCase()];
    if (!meta) unknownNames.add(name);
    const type = meta ? meta.type : 'Neutral';
    const category = meta ? meta.category : 'Uncategorised';
    const bucket = type === 'Positive' ? 'pos' : type === 'Negative' ? 'neg' : 'neu';

    const date = parseArborDate(dtRaw);
    const dayKey = date ? date.toISOString().slice(0, 10) : 'unknown';
    dayTotals[dayKey] = dayTotals[dayKey] || { pos: 0, neg: 0, neu: 0 };
    dayTotals[dayKey][bucket]++;

    catTotals[category] = catTotals[category] || { pos: 0, neg: 0, neu: 0 };
    catTotals[category][bucket]++;

    incidentCounts[name] = incidentCounts[name] || { count: 0, bucket };
    incidentCounts[name].count++;

    if (status && status.toLowerCase() === 'resolved') resolvedCount++;

    const students = studentsRaw
      ? studentsRaw.split(',').map(s => s.trim()).filter(Boolean)
      : [];
    students.forEach(student => {
      const s = studentTotals[student] = studentTotals[student] || {
        pos: 0, neg: 0, neu: 0, last: name, when: dayKey, _date: date,
      };
      s[bucket]++;
      if (date && (!s._date || date > s._date)) {
        s.last = name;
        s.when = dayKey;
        s._date = date;
      }
    });
  });

  if (unknownNames.size) {
    console.warn(
      `[Behaviour] ${unknownNames.size} incident name(s) not found in behaviour-values.json ` +
      `(counted as Neutral/Uncategorised): ${[...unknownNames].join('; ')}`
    );
  }

  const dayKeys = Object.keys(dayTotals).filter(k => k !== 'unknown').sort();
  const weekLabels = dayKeys.map(k => dayLabel(new Date(k)));
  const posWeek = dayKeys.map(k => dayTotals[k].pos);
  const negWeek = dayKeys.map(k => dayTotals[k].neg);
  const neuWeek = dayKeys.map(k => dayTotals[k].neu);

  const categoriesWeek = Object.keys(catTotals)
    .map(label => ({ label, pos: catTotals[label].pos, neg: catTotals[label].neg, neu: catTotals[label].neu }))
    .sort((a, b) => (b.pos + b.neg + b.neu) - (a.pos + a.neg + a.neu));

  const incidentTypesWeek = Object.keys(incidentCounts)
    .map(name => ({
      name,
      count: incidentCounts[name].count,
      type: incidentCounts[name].bucket === 'pos' ? 'good' : incidentCounts[name].bucket === 'neg' ? 'critical' : 'neutral',
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const studentsWeekRaw = Object.keys(studentTotals)
    .map(name => {
      const s = studentTotals[name];
      return { name, total: s.pos + s.neg + s.neu, pos: s.pos, neg: s.neg, neu: s.neu, last: s.last, when: 'This week' };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 40);

  return {
    weekLabels, posWeek, negWeek, neuWeek,
    categoriesWeek, incidentTypesWeek, studentsWeekRaw,
    REAL_TOTAL_INCIDENTS: rows.length,
    REAL_RESOLVED_PCT: rows.length ? Math.round((100 * resolvedCount) / rows.length) : 0,
  };
}

async function main() {
  const behaviourRows = await fetchTable(URLS.behaviour, 'Behaviour');
  const lateRows = await fetchTable(URLS.late, 'Late to lesson');
  const detentionRows = await fetchTable(URLS.detentions, 'Detentions');
  const suspensionRows = await fetchTable(URLS.suspensions, 'Suspensions');

  const out = {
    generatedAt: new Date().toISOString(),
    ...aggregateBehaviour(behaviourRows),
    // Late/Detentions/Suspensions aren't wired into a chart yet - they're
    // captured here (raw rows, capped) so nothing is lost, ready for the
    // next round of dashboard panels once we agree what each should show.
    late: { rowCount: lateRows.length, rows: lateRows.slice(0, 500) },
    detentions: { rowCount: detentionRows.length, rows: detentionRows.slice(0, 500) },
    suspensions: { rowCount: suspensionRows.length, rows: suspensionRows.slice(0, 500) },
  };

  writeFileSync(path.join(__dirname, '..', 'data', 'live.json'), JSON.stringify(out, null, 2));
  console.log(`Wrote data/live.json (${behaviourRows.length} behaviour rows, ${lateRows.length} late, ${detentionRows.length} detentions, ${suspensionRows.length} suspensions)`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
