const assert=require('node:assert/strict');
const core=require('../principal-revision-core.js');
const strategy=require('../strategy-core.js');

const executed={id:'c1',scheduledDate:'2026-09-10',plannedAmountCent:10000,actualAmountCent:10000,cashPoolFundingCent:0,externalFundingCent:10000,executionStatus:'EXECUTED',revisionStatus:'ORIGINAL',countsAsCycle:true};

assert.deepEqual(core.validateFunding({executionStatus:'EXECUTED',actualAmountCent:20000,cashPoolFundingCent:5000,externalFundingCent:15000}),{actualAmountCent:20000,cashPoolFundingCent:5000,externalFundingCent:15000});
assert.throws(()=>core.validateFunding({executionStatus:'EXECUTED',actualAmountCent:20000,cashPoolFundingCent:0,externalFundingCent:10000}),/FUNDING_SUM_MISMATCH/);
assert.throws(()=>core.validateFunding({executionStatus:'PENDING',actualAmountCent:10000,cashPoolFundingCent:0,externalFundingCent:10000}),/NON_EXECUTED_MUST_BE_ZERO/);

let result=core.prepareRecordRevision(executed,{actualAmountCent:20000,externalFundingCent:20000},{currentPrincipalCent:100000,currentCashPoolCent:0,hardLimitCent:3000000,today:'2026-09-14'});
assert.equal(result.after.actualAmountCent,20000);
assert.equal(result.after.plannedAmountCent,10000);
assert.throws(()=>core.prepareRecordRevision(executed,{plannedAmountCent:20000},{currentCashPoolCent:0,currentPrincipalCent:2188000,hardLimitCent:3000000,today:'2026-09-14'}),/PLANNED_AMOUNT_IMMUTABLE/);
assert.equal(result.after.manualExtraAmountCent,10000);
assert.equal(result.after.revisionStatus,'MODIFIED');
assert.equal(result.prospectivePrincipal,110000);
assert.equal(result.after.countsAsCycle,true);

result=core.prepareRecordRevision(executed,{actualAmountCent:60000,externalFundingCent:60000},{currentPrincipalCent:100000,currentCashPoolCent:0,hardLimitCent:3000000,today:'2026-09-14'});
assert.equal(result.after.plannedAmountCent,10000);
assert.equal(result.after.manualExtraAmountCent,50000);

result=core.prepareRecordRevision(executed,{executionStatus:'NOT_EXECUTED',actualAmountCent:0,cashPoolFundingCent:0,externalFundingCent:0},{currentPrincipalCent:100000,currentCashPoolCent:0,hardLimitCent:3000000,today:'2026-09-14'});
assert.equal(result.after.countsAsCycle,false);
assert.equal(result.prospectivePrincipal,90000);

const pending={...executed,id:'c2',executionStatus:'PENDING',status:'PENDING',actualAmountCent:0,externalFundingCent:0,countsAsCycle:false};
result=core.prepareRecordRevision(pending,{executionStatus:'EXECUTED',actualAmountCent:10000,externalFundingCent:10000},{currentPrincipalCent:100000,currentCashPoolCent:0,hardLimitCent:3000000,today:'2026-09-14'});
assert.equal(result.after.executionStatus,'EXECUTED');
result=core.prepareRecordRevision(pending,{executionStatus:'NOT_EXECUTED',actualAmountCent:0,externalFundingCent:0},{currentPrincipalCent:100000,currentCashPoolCent:0,hardLimitCent:3000000,today:'2026-09-14'});
assert.equal(result.after.executionStatus,'NOT_EXECUTED');

const blocked={...pending,executionStatus:'BLOCKED_HARD_LIMIT',status:'BLOCKED_HARD_LIMIT'};
assert.throws(()=>core.prepareRecordRevision(blocked,{executionStatus:'EXECUTED',actualAmountCent:10000,externalFundingCent:10000},{currentPrincipalCent:3000000,currentCashPoolCent:0,hardLimitCent:3000000,today:'2026-09-14'}),/HARD_LIMIT_EXCEEDED/);

const fromCash={...executed,cashPoolFundingCent:10000,externalFundingCent:0};
result=core.prepareRecordRevision(fromCash,{cashPoolFundingCent:0,externalFundingCent:10000},{currentPrincipalCent:100000,currentCashPoolCent:0,hardLimitCent:3000000,today:'2026-09-14'});
assert.equal(result.prospectivePrincipal,100000);
assert.equal(result.prospectiveCash,10000);
assert.throws(()=>core.prepareRecordRevision(executed,{cashPoolFundingCent:10000,externalFundingCent:0},{currentPrincipalCent:100000,currentCashPoolCent:0,hardLimitCent:3000000,today:'2026-09-14'}),/CASH_POOL_WOULD_BE_NEGATIVE/);

result=core.prepareRecordRevision(executed,{actualAmountCent:20000,externalFundingCent:20000},{currentPrincipalCent:2995000,currentCashPoolCent:0,hardLimitCent:3000000,today:'2026-09-14'});
assert.equal(result.auditConflict,true);
assert.ok(result.after.auditFlags.includes('HISTORICAL_HARD_LIMIT_CONFLICT'));

const first=core.revisionEntries('investment_cycle','c1',executed,result.after,'首次核对','2026-09-14T07:20:00.000Z');
const second=core.revisionEntries('investment_cycle','c1',result.after,{...result.after,notes:'再次核对'},'再次核对','2026-09-14T07:30:00.000Z');
const sameTimestamp=core.revisionEntries('investment_cycle','c1',executed,result.after,'同毫秒核对','2026-09-14T07:20:00.000Z');
assert.ok(first.length>=1);
assert.equal(second.length,1);
assert.notEqual(first[0].id,second[0].id);
assert.notEqual(first[0].id,sameTimestamp[0].id);
assert.throws(()=>core.revisionEntries('investment_cycle','c1',executed,result.after,'','2026-09-14T07:20:00.000Z'),/CHANGE_REASON_REQUIRED/);

const baseline={takeoverInMarketPrincipalCent:2118000,historicalInvestedPrincipalCent:2138000,historicalExecutedCycles:171};
const cycles=[{...executed,actualAmountCent:60000,externalFundingCent:50000,cashPoolFundingCent:10000,manualExtraAmountCent:50000},{...pending}];
const trades=[{id:'m1',tradeDate:'2026-09-11',type:'MANUAL_BUY',amountCent:20000,cashPoolFundingCent:0,externalFundingCent:20000,executionStatus:'EXECUTED'},{id:'r1',tradeDate:'2026-09-12',type:'MANUAL_REDEEM',exitedPrincipalCent:30000}];
const breakdown=core.principalBreakdown(baseline,cycles,trades,[{type:'TAKEOVER_OPENING',amountCent:-2118000},{type:'EXTERNAL_CONTRIBUTION',amountCent:-50000},{type:'EXTERNAL_CONTRIBUTION',amountCent:-20000}],[{amountCent:30000},{amountCent:-10000}]);
assert.equal(breakdown.currentPrincipalCent,2168000);
assert.equal(breakdown.historicalExternalInvestmentCent,2208000);
assert.equal(breakdown.cashPoolCent,20000);
assert.equal(breakdown.effectiveCycleCount,172);

const baselineRevisions=core.revisionEntries('initialization_baseline','baseline',{strategyStartDate:'2025-12-14',historicalExecutedCycles:171,historicalInvestedPrincipalCent:2138000,takeoverInMarketPrincipalCent:2138000},{strategyStartDate:'2025-12-14',historicalExecutedCycles:171,historicalInvestedPrincipalCent:2138000,takeoverInMarketPrincipalCent:2118000},'与实际核对','2026-09-14T07:20:00.000Z');
assert.equal(baselineRevisions.length,1);
assert.equal(baselineRevisions[0].before,2138000);
assert.equal(baselineRevisions[0].after,2118000);

assert.notEqual(strategy.principalPositionBp(2138000,15000000),strategy.principalPositionBp(2118000,15000000));
assert.equal(strategy.remainingHardLimit(2118000,3000000)-strategy.remainingHardLimit(2138000,3000000),20000);
const oldXirr=strategy.xirr([{date:'2026-09-01',amountCent:-2138000}],2164700,'2027-09-01');
const newXirr=strategy.xirr([{date:'2026-09-01',amountCent:-2118000}],2164700,'2027-09-01');
assert.ok(newXirr>oldXirr);

console.log('principal revision core tests passed');
