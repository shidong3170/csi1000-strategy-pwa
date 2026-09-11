const assert=require('node:assert/strict');
const core=require('../strategy-core.js');

const strategy={effectiveFrom:'2026-09-10',baseHardLimitCent:3000000,annualHardLimitIncrementCent:600000,totalInvestmentBaseCent:15000000,baseRecurringAmountCent:10000,targetXirrBp:600};

assert.equal(core.annualHardLimit(strategy,'2026-12-31'),3000000);
assert.equal(core.annualHardLimit(strategy,'2027-01-01'),3600000);

let split=core.fundingSourceSplit(10000,0);
assert.deepEqual(split,{cashPoolCent:0,externalCent:10000});
split=core.fundingSourceSplit(10000,6000);
assert.deepEqual(split,{cashPoolCent:6000,externalCent:4000});

assert.equal(10000+50000,60000); // 计划100元、实际600元，追加500元。
assert.equal(2138000+10000-10000,2138000); // 已执行改未执行撤销本金。
assert.equal(core.applyPositionGuardrails(10000,1999,2000),2000);
assert.equal(core.applyPositionGuardrails(30000,1820,100000),10000);
assert.equal(core.applyPositionGuardrails(30000,1920,100000),5000);
assert.equal(core.applyPositionGuardrails(30000,1700,0),0);

const redeem=core.takeProfitCostAllocation(3600000,3000000,600000);
assert.deepEqual(redeem,{exitedPrincipalCent:500000,realizedGainCent:100000,remainingPrincipalCent:2500000});
assert.deepEqual(core.fundingSourceSplit(0,500000),{cashPoolCent:0,externalCent:0});

assert.equal(core.marketCandidateCent(3000,2000,true),30000);
assert.equal(core.marketCandidateCent(2000,3000,false),20000);
assert.equal(core.marketCandidateCent(1000,4000,false),15000);
assert.equal(core.marketFreshness(8),'STALE');
assert.equal(core.marketFreshness(null),'UNKNOWN');

const rec=core.recommend({strategy,principalCent:2730000,positionBp:1820,remainingCent:270000,cashPoolCent:6000,holdingYears:1,xirrRate:null,calibrationStatus:'FRESH',market:{available:true,freshness:'FRESH',candidateCent:30000}});
assert.equal(rec.amountCent,10000);
assert.deepEqual(rec.funding,{cashPoolCent:6000,externalCent:4000});

const delayed=core.recommend({strategy,principalCent:2138000,positionBp:1425,remainingCent:862000,cashPoolCent:0,holdingYears:1,xirrRate:null,calibrationStatus:'FRESH',market:{available:true,freshness:'FRESH',decisionReady:false,candidateCent:30000}});
assert.equal(delayed.amountCent,10000);
assert.deepEqual(delayed.reasonCodes,['MARKET_BASE_ONLY']);

const exitFlows=[{date:'2026-09-10',amountCent:-2138000},{date:'2027-09-10',amountCent:2238000}];
assert.ok(core.xirr(exitFlows,0,'2027-09-10')>0);

console.log('strategy-core: all regression checks passed');
