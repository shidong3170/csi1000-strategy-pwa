const assert=require('node:assert/strict');
const Core=require('../calibration-core.js');

const snap=(id,date,value=2164700,shares=200000000000,extra={})=>({id,snapshotDate:date,snapshotAt:`${date}T01:00:00.000Z`,fundMarketValueCent:value,totalSharesMicro:shares,...extra});

{
  const one=snap('a','2026-09-10');
  const basis=Core.buildBasis([one],{today:'2026-09-14',marketAsOfDate:'2026-09-11',cashPoolCent:15000});
  assert.equal(basis.snapshot,one);
  assert.equal(basis.fundMarketValueCent,one.fundMarketValueCent);
  assert.equal(basis.totalSharesMicro,one.totalSharesMicro);
  assert.equal(basis.impliedNavScaled,Core.impliedNav(one));
  assert.equal(basis.strategyTotalAssetsCent,2179700);
  assert.equal(basis.marketAsOfDate,'2026-09-11');
}
{
  const old=snap('old','2026-09-01'),newest=snap('new','2026-09-12');
  assert.equal(Core.latestValidCalibration([old,newest]),newest);
  newest.voided=true;
  assert.equal(Core.latestValidCalibration([old,newest]),old);
}
assert.equal(Core.impliedNav(snap('z','2026-09-10',10000,0)),null);
assert.equal(Core.buildBasis([snap('z','2026-09-10',10000,0)],{today:'2026-09-14'}).status,'ABNORMAL');
assert.equal(Core.buildBasis([],{today:'2026-09-14'}).status,'MISSING');
assert.equal(Core.freshness('2026-09-06','2026-09-14').code,'DUE');
assert.equal(Core.freshness('2026-08-30','2026-09-14').code,'STALE');

{
  const baseline={takeoverDate:'2026-09-01',takeoverInMarketPrincipalCent:100000,createdAt:'2026-09-01T00:00:00Z'};
  const cycles=[
    {id:'c1',scheduledDate:'2026-09-02',status:'EXECUTED',actualAmountCent:10000},
    {id:'c2',scheduledDate:'2026-09-03',status:'NOT_EXECUTED',actualAmountCent:20000},
    {id:'c3',scheduledDate:'2026-09-04',status:'EXECUTED',actualAmountCent:30000,voided:true}
  ];
  const trades=[
    {id:'b1',tradeDate:'2026-09-05',type:'MANUAL_BUY',amountCent:50000},
    {id:'r1',tradeDate:'2026-09-06',type:'MANUAL_REDEEM',amountCent:40000,exitedPrincipalCent:20000},
    {id:'b2',tradeDate:'2026-09-07',type:'MANUAL_BUY',amountCent:90000,voided:true}
  ];
  const rows=Core.buildPrincipalChanges(baseline,cycles,trades);
  assert.equal(rows.length,4);
  assert.deepEqual(rows.map(x=>x.id),['r1','b1','c1','baseline']);
  assert.equal(rows[0].principalAfterCent,140000);
  assert.equal(rows[0].deltaCent,-20000);
  assert.equal(rows[1].principalAfterCent,160000);
}

console.log('calibration core tests passed');
