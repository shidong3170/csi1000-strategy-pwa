const assert=require('node:assert/strict');
const core=require('../fund-share-core.js');

assert.equal(core.parseScaledDecimal('1.25'),1250000);
assert.equal(core.parseScaledDecimal('1.234567'),1234567);
assert.throws(()=>core.parseScaledDecimal('1.2345678'),/DECIMAL_PRECISION_EXCEEDED/);
assert.equal(core.calcConfirmedShares(10000,1250000),80000000);
assert.equal(core.calcConfirmedShares(60000,1250000),480000000);
assert.equal(core.calcMarketValueCent(80000000,1250000),10000);
assert.equal(core.calcImpliedNavScaled(10000,80000000),1250000);
assert.equal(core.calcProportionalShares(80000000,2500,10000),20000000);

const profiles=[{id:'fund-1',fundCode:'014202',effectiveFrom:'2026-09-01',createdAt:'2026-09-01T00:00:00Z'}];
assert.equal(core.getFundProfile(profiles,'2026-09-15').fundCode,'014202');
assert.equal(core.getFundProfile([{...profiles[0],fundCode:'000852'}],'2026-09-15'),null);
const navT={id:'014202-2026-09-15',fundCode:'014202',navDate:'2026-09-15',unitNavScaled:1250000,source:'MANUAL'};
const navT1={id:'014202-2026-09-16',fundCode:'014202',navDate:'2026-09-16',unitNavScaled:1260000,source:'MANUAL'};
assert.equal(core.getFundNav([navT1],'014202','2026-09-15'),null);
assert.equal(core.getFundNav([navT,navT1],'014202','2026-09-15'),navT);

const pending={id:'cycle-1',scheduledDate:'2026-09-15',actualAmountCent:10000,executionStatus:'EXECUTED',createdAt:'2026-09-15T08:00:00Z'};
assert.equal(core.shareFields(pending,profiles[0],null).shareConfirmationStatus,'PENDING_NAV');
const confirmed={...pending,...core.shareFields(pending,profiles[0],navT,{confirmedAt:'2026-09-16T08:00:00Z'})};
assert.equal(confirmed.shareConfirmationStatus,'CONFIRMED');
assert.equal(confirmed.confirmedSharesMicro,80000000);
assert.equal(core.shareFields({...pending,executionStatus:'NOT_EXECUTED'},profiles[0],navT).shareConfirmationStatus,'NOT_APPLICABLE');
assert.equal(core.shareFields({...pending,executionStatus:'BLOCKED_HARD_LIMIT'},profiles[0],navT).shareConfirmationStatus,'NOT_APPLICABLE');
assert.equal(core.shareFields(pending,profiles[0],navT,{corrected:true}).shareConfirmationStatus,'MANUAL_CORRECTED');

const anchor=core.applyCalibrationAnchor({id:'cal-1',source:'MANUAL_CALIBRATION',snapshotDate:'2026-09-14',snapshotAt:'2026-09-14T10:00:00Z',fundMarketValueCent:125000,totalSharesMicro:1000000000},990000000);
assert.equal(anchor.anchorSharesMicro,1000000000);
assert.equal(anchor.shareCorrectionMicro,10000000);
const manualBuy={id:'buy-1',type:'MANUAL_BUY',tradeDate:'2026-09-16',actualAmountCent:10000,executionStatus:'EXECUTED',shareConfirmationStatus:'CONFIRMED',confirmedSharesMicro:80000000,createdAt:'2026-09-16T08:00:00Z'};
const redeem={id:'red-1',type:'MANUAL_REDEEM',tradeDate:'2026-09-17',executionStatus:'EXECUTED',shareConfirmationStatus:'CONFIRMED',redeemedSharesMicro:20000000,createdAt:'2026-09-17T08:00:00Z'};
const derived=core.calcDerivedShares([anchor],[confirmed],[manualBuy,redeem],'2026-09-17');
assert.equal(derived.derivedSharesMicro,1140000000);
assert.equal(core.calcSimulation(derived,navT1).marketValueCent,143640);
assert.equal(core.calcSimulation(derived,null).status,'PENDING_NAV');
assert.equal(core.calcDerivedShares([],[],[]).status,'PENDING_SHARES');

const sameDayAfter={...confirmed,scheduledDate:'2026-09-14',createdAt:'2026-09-14T09:00:00Z',confirmedAt:'2026-09-14T11:00:00Z'};
assert.equal(core.calcDerivedShares([anchor],[sameDayAfter],[],'2026-09-14').confirmedBuySharesMicro,80000000);
const autoSnapshot={id:'auto',source:'TAKE_PROFIT',snapshotDate:'2026-09-17',snapshotAt:'2026-09-17T10:00:00Z',fundMarketValueCent:5000};
assert.equal(core.latestRealCalibration([anchor,autoSnapshot]),anchor);

const legacyExecuted=core.normalizeLegacyRecord({scheduledDate:'2026-09-10',status:'EXECUTED',actualAmountCent:10000});
assert.equal(legacyExecuted.shareConfirmationStatus,'PENDING_NAV');
assert.equal(legacyExecuted.confirmedSharesMicro,null);
assert.equal(core.normalizeLegacyRecord({scheduledDate:'2026-09-11',status:'NOT_EXECUTED'}).shareConfirmationStatus,'NOT_APPLICABLE');

const oldBackup=core.normalizeBackupStores({schemaVersion:2,stores:{record_revisions:[],investment_cycles:[{id:'old',scheduledDate:'2026-09-10',status:'EXECUTED',actualAmountCent:10000}],calibration_snapshots:[{id:'old-cal',source:'INITIALIZATION',snapshotAt:'2026-09-01T00:00:00Z',snapshotDate:'2026-09-01',totalSharesMicro:1000000}],app_meta:[{id:'app',schemaVersion:3}]}},['record_revisions','investment_cycles','manual_trades','calibration_snapshots','app_meta','fund_profiles','fund_nav_daily']);
assert.equal(oldBackup.investment_cycles[0].shareConfirmationStatus,'PENDING_NAV');
assert.equal(oldBackup.calibration_snapshots[0].isShareAnchor,true);
assert.equal(oldBackup.app_meta[0].schemaVersion,4);
assert.throws(()=>core.normalizeBackupStores({schemaVersion:3,stores:{record_revisions:[],fund_profiles:[{fundCode:'000852'}]}},['record_revisions','fund_profiles','fund_nav_daily','investment_cycles','manual_trades','calibration_snapshots','app_meta']),/INDEX_AS_FUND/);
assert.throws(()=>core.normalizeBackupStores({schemaVersion:3,stores:{record_revisions:[],investment_cycles:[{fundCode:'000852',shareConfirmationStatus:'CONFIRMED'}]}},['record_revisions','fund_profiles','fund_nav_daily','investment_cycles','manual_trades','share_confirmation_events','calibration_snapshots','app_meta']),/INDEX_AS_FUND/);

console.log('fund share core tests passed');
