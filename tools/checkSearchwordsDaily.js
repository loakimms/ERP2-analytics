// Summarize /searchwords/daily for a date by campaign_kind filter.
//
// Usage:
//   node analytics/tools/checkSearchwordsDaily.js --base http://localhost:5189 --date 2026-01-23

function arg(name, def) {
  const i = process.argv.indexOf(name);
  if (i >= 0 && i + 1 < process.argv.length) return String(process.argv[i + 1]);
  return def;
}

const base = arg('--base', 'http://localhost:5189').replace(/\/$/, '');
const date = arg('--date', '2026-01-23');

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

function sum(list) {
  const s = { impr: 0, clk: 0, cost: 0, conv: 0, rev: 0 };
  const bySource = {};
  const byStoredKind = {};
  for (const x of list || []) {
    s.impr += Number(x.impressions) || 0;
    s.clk += Number(x.clicks) || 0;
    s.cost += Number(x.cost) || 0;
    s.conv += Number(x.conversions) || 0;
    s.rev += Number(x.revenue) || 0;
    const src = String(x.source || '');
    bySource[src] = (bySource[src] || 0) + 1;
    const ck = String(x.campaign_kind || '').trim();
    if (ck) byStoredKind[ck] = (byStoredKind[ck] || 0) + 1;
  }
  return { s, bySource, byStoredKind };
}

async function main() {
  const filters = ['powerlink', 'non_powerlink', 'shopping', ''];
  for (const ck of filters) {
    const rows = await get('/searchwords/daily', {
      date_from: date,
      date_to: date,
      campaign_kind: ck || undefined,
      limit: 5000,
      offset: 0,
    });
    const list = Array.isArray(rows) ? rows : [];
    const { s, bySource, byStoredKind } = sum(list);
    console.log('campaign_kind', ck || '(none)', 'rows', list.length);
    console.log('sum', s);
    console.log('bySource', bySource);
    const topKinds = Object.entries(byStoredKind)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    console.log('byStoredKindTop', topKinds);
    console.log('---');
  }
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});

