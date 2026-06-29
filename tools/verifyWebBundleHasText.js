// Verify the deployed analytics-web bundle contains specific text.
//
// Usage:
//   node analytics/tools/verifyWebBundleHasText.js http://localhost:5188 "검색어 보고서 업로드"

const base = String(process.argv[2] || 'http://localhost:5188').replace(/\/$/, '');
const needle = String(process.argv[3] || '').trim();

if (!needle) {
  console.error('Needle text is required. Example: node verifyWebBundleHasText.js http://localhost:5188 "검색어 보고서 업로드"');
  process.exit(2);
}

async function main() {
  const idx = await fetch(base + '/index.html', { headers: { 'Cache-Control': 'no-cache' } });
  const cc = idx.headers.get('cache-control');
  const html = await idx.text();
  const m = html.match(/src="(\/assets\/index-[^"]+)"/);
  const asset = m ? m[1] : null;
  console.log('index.status', idx.status, 'cache-control', cc);
  console.log('asset', asset);
  if (!asset) process.exit(3);
  const jsResp = await fetch(base + asset, { headers: { 'Cache-Control': 'no-cache' } });
  const js = await jsResp.text();
  console.log('bundle.status', jsResp.status, 'size', js.length);
  console.log('bundle.hasNeedle', js.includes(needle));
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});

