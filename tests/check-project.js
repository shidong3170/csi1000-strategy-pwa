const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');

const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const readme=fs.readFileSync(path.join(root,'README.md'),'utf8');
const githubReadme=fs.readFileSync(path.join(root,'README_GITHUB.md'),'utf8');
const inline=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).filter(Boolean);
for(const source of inline) new Function(source);
assert.match(html,/\.\/strategy-core\.js/);
assert.match(html,/id="recommendCard"/);
assert.match(html,/openRecommendationDetails/);
assert.match(html,/近250日高点回撤/);
assert.match(html,/PWA V1\.0\.3/);
assert.match(readme,/PWA V1\.0\.3/);
assert.match(githubReadme,/V1\.0\.3/);
assert.doesNotMatch(html,/else\s*\{\s*const dow=d\.getDay\(\);\s*isTrading=/);

const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.webmanifest'),'utf8'));
assert.equal(manifest.start_url,'./index.html');
assert.equal(manifest.scope,'./');
for(const icon of manifest.icons) assert.ok(fs.existsSync(path.join(root,icon.src.replace(/^\.\//,''))));

const calendar=JSON.parse(fs.readFileSync(path.join(root,'trading-calendar-2026.json'),'utf8'));
assert.equal(calendar.calendarYear,2026);
for(const date of ['2026-01-01','2026-01-02','2026-02-16','2026-02-17','2026-02-18','2026-02-19','2026-02-20','2026-02-23','2026-04-06','2026-05-01','2026-05-04','2026-05-05','2026-06-19','2026-09-25','2026-10-01','2026-10-02','2026-10-05','2026-10-06','2026-10-07']) assert.ok(calendar.closures[date],date);

const market=JSON.parse(fs.readFileSync(path.join(root,'data','csi1000-history.json'),'utf8'));
assert.equal(market.indexCode,'000852');
assert.ok(market.items.length>=200);
const dates=market.items.map(x=>x.date);
assert.deepEqual(dates,[...dates].sort());
assert.equal(new Set(dates).size,dates.length);
assert.ok(market.items.every(x=>Number(x.close)>0));

const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
assert.match(sw,/csi1000-pwa-v1\.0\.3/);
for(const asset of ['./strategy-core.js','./market-provider.js','./data/csi1000-history.json']) assert.ok(sw.includes(asset));
new Function(sw);

console.log(`project checks passed: ${market.items.length} market rows, ${Object.keys(calendar.closures).length} weekday closures`);
