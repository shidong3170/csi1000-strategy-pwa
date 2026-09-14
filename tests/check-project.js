const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');

const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const readme=fs.readFileSync(path.join(root,'README.md'),'utf8');
const githubReadme=fs.readFileSync(path.join(root,'README_GITHUB.md'),'utf8');
for(const file of ['V1.1实现差异分析.md','V1.1开发变更清单.md','V1.1数据迁移说明.md','V1.1测试报告.md','V1.1发布报告.md','V1.1待确认事项.md']) assert.ok(fs.existsSync(path.join(root,file)),file);
const inline=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).filter(Boolean);
for(const source of inline) new Function(source);
assert.match(html,/\.\/strategy-core\.js/);
assert.match(html,/\.\/market-data-core\.js/);
assert.match(html,/\.\/calibration-core\.js/);
assert.match(html,/\.\/principal-revision-core\.js/);
assert.match(html,/\.\/fund-share-core\.js/);
assert.match(html,/id="recommendCard"/);
assert.match(html,/id="btnMarketRefresh"/);
assert.match(html,/openRecommendationDetails/);
assert.match(html,/近250日高点回撤/);
assert.match(html,/id="fundValueCard"/);
assert.match(html,/id="page-fund-basis"/);
assert.match(html,/id="page-principal-history"/);
assert.match(html,/本金变化记录/);
assert.match(html,/PWA V1\.0\.8/);
assert.match(html,/id="principalCard"/);
assert.match(html,/id="page-principal-basis"/);
assert.match(html,/id="page-baseline-detail"/);
assert.match(html,/id="page-revision-history"/);
assert.match(html,/executionStatus/);
assert.match(html,/revisionStatus/);
assert.match(html,/PENDING_NAV/);
assert.match(html,/MANUAL_CORRECTED/);
assert.match(html,/id="page-fund-nav"/);
assert.match(html,/id="mSimulatedValue"/);
assert.match(html,/当前递推份额/);
assert.match(html,/正式XIRR/);
assert.match(html,/模拟XIRR/);
assert.match(html,/id="realtimePoint"/);
assert.match(html,/id="marketClose"/);
assert.match(html,/实时行情仅供市场观察/);
assert.match(readme,/PWA V1\.0\.8/);
assert.match(githubReadme,/V1\.0\.8/);
assert.doesNotMatch(html,/else\s*\{\s*const dow=d\.getDay\(\);\s*isTrading=/);
assert.match(html,/setUTCDate\(d\.getUTCDate\(\)\+days\)/);
assert.match(html,/DB_VERSION=4/);
for(const store of ['fund_profiles','fund_nav_daily','share_confirmation_events']) assert.ok(html.includes(`'${store}'`));
assert.match(html,/schemaVersion:3,appVersion:'1\.0\.8',databaseVersion:4/);
assert.match(html,/keyPath:s==='market_daily'\?'date':'id'/);
assert.match(html,/closeScaled:Math\.round/);

for(const file of ['strategy-core.js','market-data-core.js','market-provider.js','calibration-core.js','principal-revision-core.js','fund-share-core.js']) {
  new Function(fs.readFileSync(path.join(root,file),'utf8'));
}

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
assert.match(sw,/csi1000-pwa-v1\.0\.8/);
assert.match(sw,/url\.origin!==self\.location\.origin/);
for(const asset of ['./strategy-core.js','./market-data-core.js','./market-provider.js','./calibration-core.js','./principal-revision-core.js','./fund-share-core.js','./data/csi1000-history.json']) assert.ok(sw.includes(asset));
new Function(sw);

console.log(`project checks passed: ${market.items.length} market rows, ${Object.keys(calendar.closures).length} weekday closures`);
