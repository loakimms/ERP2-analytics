// Compare keyword term totals between API rows (powerlink/non_powerlink).
// Usage:
//   node analytics/tools/compareKeywordTerm.js --base http://localhost:5189 --date 2026-01-23 --term 헤나염색약
//
// 출력은 "DB에 term으로 저장된 합" vs "키워드가 비어(-) 저장된 합"을 보여줍니다.

function arg(name, def) {
  const i = process.argv.indexOf(name);
  if (i >= 0 && i + 1 < process.argv.length) return String(process.argv[i + 1]);
  return def;
}

const base = arg('--base', 'http://localhost:5189').replace(/\/$/, '');
const date = arg('--date', '2026-01-23');
const term = arg('--term', '헤나염색약');

function qs(params) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && String(v) !== '')
    .map(([k, v]) => k + '=' + encodeURIComponent(String(v)))
    .join('&');
}

async function get(path, params) {
  const url = base + path + '?' + qs(params);
  const r = await fetch(url);
  const txt = await r.text();
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url + ' ' + txt.slice(0, 300));
  try {
    return JSON.parse(txt);
  } catch {
    throw new Error('Non-JSON ' + url + ' ' + txt.slice(0, 300));
  }
}

function sum(rows, pred) {
  const s = { impr: 0, clk: 0, cost: 0, conv: 0, rev: 0 };
  for (const r of rows || []) {
    if (pred && !pred(r)) continue;
    s.impr += Number(r.impressions) || 0;
    s.clk += Number(r.clicks) || 0;
    s.cost += Number(r.cost) || 0;
    s.conv += Number(r.conversions) || 0;
    s.rev += Number(r.revenue) || 0;
  }
  return s;
}

function fmt(s) {
  return (
    'impr=' +
    s.impr +
    ' clk=' +
    s.clk +
    ' cost=' +
    s.cost +
    ' conv=' +
    s.conv +
    ' rev=' +
    s.rev
  );
}

function isDashKeyword(k) {
  const x = String(k || '').trim();
  return x === '' || x === '-' || x === 'UNKNOWN_KEYWORD' || x === 'UNKNOWN_KEYWORD_ID';
}

async function main() {
  const kwPower = await get('/keywords/daily', {
    date_from: date,
    date_to: date,
    campaign_kind: 'powerlink',
    limit: 5000,
    offset: 0,
  });
  const kwNon = await get('/keywords/daily', {
    date_from: date,
    date_to: date,
    campaign_kind: 'non_powerlink',
    limit: 5000,
    offset: 0,
  });

  console.log('[date]', date, '[term]', term);
  console.log('powerlink rows', kwPower.length);
  console.log('non_powerlink rows', kwNon.length);

  const pAll = sum(kwPower);
  const pTerm = sum(kwPower, (r) => String(r.keyword || '').trim() === term);
  const pDash = sum(kwPower, (r) => isDashKeyword(r.keyword));
  console.log('powerlink all ', fmt(pAll));
  console.log('powerlink term', fmt(pTerm));
  console.log('powerlink dash', fmt(pDash));

  const npAll = sum(kwNon);
  const npTerm = sum(kwNon, (r) => String(r.keyword || '').trim() === term);
  const npDash = sum(kwNon, (r) => isDashKeyword(r.keyword));
  console.log('non_powerlink all ', fmt(npAll));
  console.log('non_powerlink term', fmt(npTerm));
  console.log('non_powerlink dash', fmt(npDash));

  const byDev = {};
  for (const r of kwPower || []) {
    if (String(r.keyword || '').trim() !== term) continue;
    const d = String(r.device || '').trim() || '(empty)';
    byDev[d] = byDev[d] || { impr: 0, clk: 0, cost: 0, conv: 0, rev: 0 };
    byDev[d].impr += Number(r.impressions) || 0;
    byDev[d].clk += Number(r.clicks) || 0;
    byDev[d].cost += Number(r.cost) || 0;
    byDev[d].conv += Number(r.conversions) || 0;
    byDev[d].rev += Number(r.revenue) || 0;
  }
  console.log('powerlink term by device', byDev);
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});

