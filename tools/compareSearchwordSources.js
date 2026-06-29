// Compare /searchwords/daily rows between sources (ui_csv_upload vs searchad_api)
// and report per-searchword differences.
//
// Usage:
//   node analytics/tools/compareSearchwordSources.js --base http://localhost:5189 --date 2026-01-23
// Optional:
//   --mode searchword|strict
//   - searchword: aggregate by searchword only (default)
//   - strict: aggregate by (searchword + campaign_name + adgroup_name)
//
// Output:
// - overlap/missing counts
// - top diffs by cost, conversions, revenue

function arg(name, def) {
  const i = process.argv.indexOf(name);
  if (i >= 0 && i + 1 < process.argv.length) return String(process.argv[i + 1]);
  return def;
}

const base = arg('--base', 'http://localhost:5189').replace(/\/$/, '');
const date = arg('--date', '2026-01-23');
const mode = arg('--mode', 'searchword'); // searchword | strict

async function get(path, params) {
  const u = new URL(base + path);
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || String(v) === '') continue;
    u.searchParams.set(k, String(v));
  }
  const r = await fetch(u.toString());
  const txt = await r.text();
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + u.toString() + ' ' + txt.slice(0, 300));
  return JSON.parse(txt);
}

function keyOf(row) {
  const q = String(row.searchword || '').trim();
  if (mode === 'strict') {
    const c = String(row.campaign_name || '').trim();
    const g = String(row.adgroup_name || '').trim();
    return q + '||' + c + '||' + g;
  }
  return q;
}

function addAgg(m, row) {
  const k = keyOf(row);
  if (!k) return;
  const cur = m.get(k) || { impr: 0, clk: 0, cost: 0, conv: 0, rev: 0, n: 0 };
  cur.impr += Number(row.impressions) || 0;
  cur.clk += Number(row.clicks) || 0;
  cur.cost += Number(row.cost) || 0;
  cur.conv += Number(row.conversions) || 0;
  cur.rev += Number(row.revenue) || 0;
  cur.n += 1;
  m.set(k, cur);
}

function diff(a, b) {
  const A = a || { impr: 0, clk: 0, cost: 0, conv: 0, rev: 0 };
  const B = b || { impr: 0, clk: 0, cost: 0, conv: 0, rev: 0 };
  return {
    impr: A.impr - B.impr,
    clk: A.clk - B.clk,
    cost: A.cost - B.cost,
    conv: A.conv - B.conv,
    rev: A.rev - B.rev,
  };
}

function abs(v) {
  return Math.abs(Number(v) || 0);
}

async function main() {
  const rows = await get('/searchwords/daily', {
    date_from: date,
    date_to: date,
    limit: 5000,
    offset: 0,
  });
  const list = Array.isArray(rows) ? rows : [];
  const upRows = list.filter((x) => String(x.source || '') === 'ui_csv_upload');
  const apiRows = list.filter((x) => String(x.source || '') === 'searchad_api');

  const up = new Map();
  const api = new Map();
  for (const r of upRows) addAgg(up, r);
  for (const r of apiRows) addAgg(api, r);

  const keys = new Set([...up.keys(), ...api.keys()]);
  let overlap = 0;
  let onlyUp = 0;
  let onlyApi = 0;

  const diffs = [];
  for (const k of keys) {
    const a = up.get(k);
    const b = api.get(k);
    if (a && b) overlap += 1;
    else if (a) onlyUp += 1;
    else onlyApi += 1;
    diffs.push({ key: k, up: a || null, api: b || null, d: diff(a, b) });
  }

  const topBy = (field, n) =>
    diffs
      .slice()
      .sort((x, y) => abs(y.d[field]) - abs(x.d[field]))
      .slice(0, n)
      .map((x) => ({
        key: x.key,
        d: x.d[field],
        up: x.up ? x.up[field] : 0,
        api: x.api ? x.api[field] : 0,
      }));

  console.log('[date]', date, '[mode]', mode);
  console.log('upload rows', upRows.length, 'unique', up.size);
  console.log('api rows', apiRows.length, 'unique', api.size);
  console.log('overlap', overlap, 'onlyUpload', onlyUp, 'onlyApi', onlyApi, 'union', keys.size);

  console.log('topDiff.cost', topBy('cost', 15));
  console.log('topDiff.rev', topBy('rev', 15));
  console.log('topDiff.conv', topBy('conv', 15));
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});

