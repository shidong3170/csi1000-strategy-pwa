(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  root.FundShareCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const SHARE_STATUS={PENDING_NAV:'PENDING_NAV',CONFIRMED:'CONFIRMED',MANUAL_CORRECTED:'MANUAL_CORRECTED',NOT_APPLICABLE:'NOT_APPLICABLE'};
  const SHARE_LABELS={PENDING_NAV:'待净值确认',CONFIRMED:'已确认',MANUAL_CORRECTED:'人工修正确认',NOT_APPLICABLE:'不适用'};
  const SIMULATION_STATUS={AVAILABLE:'AVAILABLE',PENDING_SHARES:'PENDING_SHARES',PENDING_NAV:'PENDING_NAV',UNAVAILABLE:'UNAVAILABLE'};
  const SIMULATION_LABELS={AVAILABLE:'可用',PENDING_SHARES:'等待份额',PENDING_NAV:'等待净值',UNAVAILABLE:'不可用'};

  function asSafeNumber(value,name){
    const number=Number(value);
    if(!Number.isSafeInteger(number)) throw new Error(`INVALID_${name}`);
    return number;
  }
  function parseScaledDecimal(value,scale=6){
    const text=String(value??'').trim();
    if(!/^\d+(?:\.\d+)?$/.test(text)) throw new Error('INVALID_DECIMAL');
    const [whole,fraction='']=text.split('.');
    if(fraction.length>scale) throw new Error('DECIMAL_PRECISION_EXCEEDED');
    const factor=10n**BigInt(scale);
    const result=BigInt(whole)*factor+BigInt((fraction+'0'.repeat(scale)).slice(0,scale));
    if(result<=0n||result>BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('INVALID_DECIMAL');
    return Number(result);
  }
  function roundDivide(numerator,denominator){
    if(denominator<=0n) throw new Error('DIVIDE_BY_ZERO');
    return (numerator+denominator/2n)/denominator;
  }
  function calcConfirmedShares(actualAmountCent,unitNavScaled){
    const amount=asSafeNumber(actualAmountCent,'ACTUAL_AMOUNT'),nav=asSafeNumber(unitNavScaled,'UNIT_NAV');
    if(amount<=0||nav<=0) throw new Error('INVALID_SHARE_INPUT');
    const result=roundDivide(BigInt(amount)*10000000000n,BigInt(nav));
    return asSafeNumber(result,'CONFIRMED_SHARES');
  }
  function calcMarketValueCent(sharesMicro,unitNavScaled){
    const shares=asSafeNumber(sharesMicro,'SHARES'),nav=asSafeNumber(unitNavScaled,'UNIT_NAV');
    if(shares<0||nav<=0) throw new Error('INVALID_MARKET_VALUE_INPUT');
    return asSafeNumber(roundDivide(BigInt(shares)*BigInt(nav),10000000000n),'MARKET_VALUE');
  }
  function calcImpliedNavScaled(marketValueCent,sharesMicro){
    const value=asSafeNumber(marketValueCent,'MARKET_VALUE'),shares=asSafeNumber(sharesMicro,'SHARES');
    if(value<0||shares<=0)throw new Error('INVALID_IMPLIED_NAV_INPUT');
    return asSafeNumber(roundDivide(BigInt(value)*10000000000n,BigInt(shares)),'IMPLIED_NAV');
  }
  function calcProportionalShares(sharesMicro,partCent,totalCent){
    const shares=asSafeNumber(sharesMicro,'SHARES'),part=asSafeNumber(partCent,'PART_VALUE'),total=asSafeNumber(totalCent,'TOTAL_VALUE');
    if(shares<0||part<0||total<=0||part>total)throw new Error('INVALID_PROPORTION_INPUT');
    return asSafeNumber(roundDivide(BigInt(shares)*BigInt(part),BigInt(total)),'PROPORTIONAL_SHARES');
  }
  function recordDate(record){return record?.scheduledDate||record?.tradeDate||''}
  function executionStatus(record){return record?.executionStatus||record?.status||null}
  function isConfirmed(record){return !record?.voided&&executionStatus(record)==='EXECUTED'&&[SHARE_STATUS.CONFIRMED,SHARE_STATUS.MANUAL_CORRECTED].includes(record?.shareConfirmationStatus)}
  function statusForExecution(status,hasNav){return status==='EXECUTED'?(hasNav?SHARE_STATUS.CONFIRMED:SHARE_STATUS.PENDING_NAV):SHARE_STATUS.NOT_APPLICABLE}
  function getFundProfile(profiles,asOfDate){
    return [...(profiles||[])].filter(x=>!x.voided&&x.fundCode!=='000852'&&x.effectiveFrom<=asOfDate&&(!x.effectiveTo||x.effectiveTo>=asOfDate)).sort((a,b)=>String(b.effectiveFrom).localeCompare(String(a.effectiveFrom))||String(b.createdAt||'').localeCompare(String(a.createdAt||'')))[0]||null;
  }
  function getFundNav(rows,fundCode,navDate){return (rows||[]).find(x=>!x.voided&&x.fundCode===fundCode&&x.navDate===navDate)||null}
  function latestFundNav(rows,fundCode,asOfDate){return [...(rows||[])].filter(x=>!x.voided&&x.fundCode===fundCode&&x.navDate<=asOfDate&&Number(x.unitNavScaled)>0).sort((a,b)=>String(b.navDate).localeCompare(String(a.navDate))||String(b.recordedAt||b.fetchedAt||'').localeCompare(String(a.recordedAt||a.fetchedAt||'')))[0]||null}
  function shareFields(record,profile,nav,options={}){
    const status=executionStatus(record),date=recordDate(record);
    if(status!=='EXECUTED')return {fundProfileId:profile?.id||record?.fundProfileId||null,fundCode:profile?.fundCode||record?.fundCode||null,navDate:null,unitNavScaled:null,confirmedSharesMicro:null,shareConfirmedAt:null,shareSource:null,shareConfirmationStatus:SHARE_STATUS.NOT_APPLICABLE};
    if(!profile||!nav||nav.fundCode!==profile.fundCode||nav.navDate!==date)return {fundProfileId:profile?.id||record?.fundProfileId||null,fundCode:profile?.fundCode||record?.fundCode||null,navDate:date,unitNavScaled:null,confirmedSharesMicro:null,shareConfirmedAt:null,shareSource:null,shareConfirmationStatus:SHARE_STATUS.PENDING_NAV};
    return {fundProfileId:profile.id,fundCode:profile.fundCode,navDate:date,unitNavScaled:nav.unitNavScaled,confirmedSharesMicro:calcConfirmedShares(record.actualAmountCent??record.amountCent,nav.unitNavScaled),shareConfirmedAt:options.confirmedAt||new Date().toISOString(),shareSource:nav.source,shareConfirmationStatus:options.corrected?SHARE_STATUS.MANUAL_CORRECTED:SHARE_STATUS.CONFIRMED};
  }
  function afterAnchor(record,anchor){
    const date=recordDate(record),anchorDate=anchor.snapshotDate||String(anchor.anchorEffectiveAt||'').slice(0,10);
    if(date!==anchorDate)return date>anchorDate;
    return String(record.confirmedAt||record.createdAt||'')>String(anchor.anchorEffectiveAt||anchor.snapshotAt||anchor.createdAt||'');
  }
  function latestRealCalibration(calibrations){
    return [...(calibrations||[])].filter(x=>!x.voided&&['INITIALIZATION','MANUAL_CALIBRATION'].includes(x.source)&&String(x.snapshotDate||'')&&Number.isFinite(Number(x.fundMarketValueCent))&&Number(x.fundMarketValueCent)>=0&&Number.isSafeInteger(Number(x.totalSharesMicro))&&Number(x.totalSharesMicro)>0).sort((a,b)=>String(b.snapshotAt||b.createdAt||b.snapshotDate||'').localeCompare(String(a.snapshotAt||a.createdAt||a.snapshotDate||'')))[0]||null;
  }
  function calcDerivedShares(calibrations,cycles,trades,asOfDate='9999-12-31'){
    const anchor=[...(calibrations||[])].filter(x=>!x.voided&&x.isShareAnchor!==false&&(!x.source||['INITIALIZATION','MANUAL_CALIBRATION'].includes(x.source))&&(x.snapshotDate||'')<=asOfDate&&Number.isSafeInteger(Number(x.anchorSharesMicro??x.totalSharesMicro))).sort((a,b)=>String(b.anchorEffectiveAt||b.snapshotAt||b.snapshotDate||'').localeCompare(String(a.anchorEffectiveAt||a.snapshotAt||a.snapshotDate||'')))[0];
    if(!anchor)return {status:SIMULATION_STATUS.PENDING_SHARES,anchor:null,derivedSharesMicro:null,confirmedBuySharesMicro:0,confirmedRedeemSharesMicro:0};
    let buys=0n,redeems=0n;
    for(const record of [...(cycles||[]),...(trades||[]).filter(x=>x.type==='MANUAL_BUY')])if(isConfirmed(record)&&recordDate(record)<=asOfDate&&afterAnchor(record,anchor))buys+=BigInt(asSafeNumber(record.confirmedSharesMicro,'CONFIRMED_SHARES'));
    for(const record of (trades||[]).filter(x=>x.type==='MANUAL_REDEEM'))if(!record.voided&&recordDate(record)<=asOfDate&&afterAnchor(record,anchor)&&[SHARE_STATUS.CONFIRMED,SHARE_STATUS.MANUAL_CORRECTED].includes(record.shareConfirmationStatus))redeems+=BigInt(asSafeNumber(record.redeemedSharesMicro||0,'REDEEMED_SHARES'));
    const derivedBig=BigInt(asSafeNumber(anchor.anchorSharesMicro??anchor.totalSharesMicro,'ANCHOR_SHARES'))+buys-redeems;
    if(derivedBig<0n)throw new Error('DERIVED_SHARES_NEGATIVE');
    const derived=asSafeNumber(derivedBig,'DERIVED_SHARES'),buyNumber=asSafeNumber(buys,'CONFIRMED_BUY_SHARES'),redeemNumber=asSafeNumber(redeems,'CONFIRMED_REDEEM_SHARES');
    return {status:SIMULATION_STATUS.AVAILABLE,anchor,derivedSharesMicro:derived,confirmedBuySharesMicro:buyNumber,confirmedRedeemSharesMicro:redeemNumber};
  }
  function buildShareTimeline(calibrations,cycles,trades,shareEvents=[],revisions=[],asOfDate='9999-12-31'){
    const derived=calcDerivedShares(calibrations,cycles,trades,asOfDate),pendingCount=[...(cycles||[]),...(trades||[]).filter(x=>x.type==='MANUAL_BUY')].filter(x=>!x.voided&&executionStatus(x)==='EXECUTED'&&x.shareConfirmationStatus===SHARE_STATUS.PENDING_NAV&&recordDate(x)<=asOfDate).length;
    if(!derived.anchor)return {status:SIMULATION_STATUS.PENDING_SHARES,anchor:null,currentSharesMicro:null,pendingCount,events:[],historyComplete:false};
    const anchor=derived.anchor,anchorShares=asSafeNumber(anchor.anchorSharesMicro??anchor.totalSharesMicro,'ANCHOR_SHARES'),events=[{eventType:'CALIBRATION_ANCHOR',eventName:anchor.source==='INITIALIZATION'?'首次接管校准锚点':'人工校准锚点',date:anchor.snapshotDate,occurredAt:anchor.anchorEffectiveAt||anchor.snapshotAt||anchor.createdAt||anchor.snapshotDate,beforeSharesMicro:Number.isSafeInteger(Number(anchor.derivedSharesBeforeCalibrationMicro))?Number(anchor.derivedSharesBeforeCalibrationMicro):null,deltaSharesMicro:Number.isSafeInteger(Number(anchor.shareCorrectionMicro))?Number(anchor.shareCorrectionMicro):null,afterSharesMicro:anchorShares,sourceType:'calibration_snapshot',sourceId:anchor.id,amountCent:anchor.fundMarketValueCent??null,unitNavScaled:anchor.impliedNavScaled??null,reconstructable:true}];
    const candidates=[];
    const addBuy=(record,entityType)=>{
      if(!isConfirmed(record)||recordDate(record)>asOfDate||!afterAnchor(record,anchor))return;
      const current=asSafeNumber(record.confirmedSharesMicro,'CONFIRMED_SHARES'),audits=(shareEvents||[]).filter(x=>x.entityType===entityType&&x.entityId===record.id&&Number.isSafeInteger(Number(x.confirmedSharesMicro))&&String(x.tradeDate||recordDate(record))<=asOfDate).sort((a,b)=>String(a.confirmedAt||'').localeCompare(String(b.confirmedAt||'')));
      if(!audits.length){candidates.push({eventType:record.shareConfirmationStatus===SHARE_STATUS.MANUAL_CORRECTED?'MANUAL_SHARE_CORRECTION':'BUY_CONFIRMED',eventName:record.shareConfirmationStatus===SHARE_STATUS.MANUAL_CORRECTED?'人工份额纠偏':'买入份额确认',date:recordDate(record),occurredAt:record.shareConfirmedAt||record.createdAt||recordDate(record),deltaSharesMicro:current,sourceType:entityType,sourceId:record.id,amountCent:Number(record.actualAmountCent??record.amountCent)||0,unitNavScaled:record.unitNavScaled??null,reconstructable:true});return}
      let previous=0;
      for(let index=0;index<audits.length;index++){
        const audit=audits[index],value=asSafeNumber(audit.confirmedSharesMicro,'CONFIRMED_SHARES'),revision=index>0||audit.source==='NAV_MANUAL_CORRECTION'||audit.source==='RECORD_REVISION';
        candidates.push({eventType:revision?'NAV_REVISION_RECALC':'BUY_CONFIRMED',eventName:revision?'净值修正重算':'买入份额确认',date:audit.tradeDate||recordDate(record),occurredAt:audit.confirmedAt||record.shareConfirmedAt||record.createdAt||recordDate(record),deltaSharesMicro:value-previous,sourceType:entityType,sourceId:record.id,amountCent:audit.actualAmountCent??(Number(record.actualAmountCent??record.amountCent)||0),unitNavScaled:audit.unitNavScaled??record.unitNavScaled??null,reconstructable:true});previous=value;
      }
      if(previous!==current)candidates.push({eventType:'MANUAL_SHARE_CORRECTION',eventName:'人工份额纠偏',date:recordDate(record),occurredAt:record.shareConfirmedAt||record.modifiedAt||record.createdAt||recordDate(record),deltaSharesMicro:current-previous,sourceType:entityType,sourceId:record.id,amountCent:Number(record.actualAmountCent??record.amountCent)||0,unitNavScaled:record.unitNavScaled??null,reconstructable:true});
    };
    for(const record of cycles||[])addBuy(record,'investment_cycle');
    for(const record of (trades||[]).filter(x=>x.type==='MANUAL_BUY'))addBuy(record,'manual_trade');
    for(const record of (trades||[]).filter(x=>x.type==='MANUAL_REDEEM'))if(!record.voided&&recordDate(record)<=asOfDate&&afterAnchor(record,anchor)&&[SHARE_STATUS.CONFIRMED,SHARE_STATUS.MANUAL_CORRECTED].includes(record.shareConfirmationStatus)){const value=asSafeNumber(record.redeemedSharesMicro||0,'REDEEMED_SHARES');candidates.push({eventType:'REDEEM_CONFIRMED',eventName:'赎回份额确认',date:recordDate(record),occurredAt:record.shareConfirmedAt||record.createdAt||recordDate(record),deltaSharesMicro:-value,sourceType:'manual_trade',sourceId:record.id,amountCent:Number(record.redeemAmountCent??record.amountCent)||0,unitNavScaled:record.unitNavScaled??null,reconstructable:true})}
    candidates.sort((a,b)=>String(a.occurredAt||a.date).localeCompare(String(b.occurredAt||b.date))||String(a.sourceId).localeCompare(String(b.sourceId)));
    let running=anchorShares;
    for(const event of candidates){event.beforeSharesMicro=running;running+=event.deltaSharesMicro;event.afterSharesMicro=running;events.push(event)}
    if(running!==derived.derivedSharesMicro){events.push({eventType:'NAV_REVISION_RECALC',eventName:'当前事实重算',date:asOfDate,occurredAt:asOfDate,beforeSharesMicro:running,deltaSharesMicro:derived.derivedSharesMicro-running,afterSharesMicro:derived.derivedSharesMicro,sourceType:'derived_facts',sourceId:null,amountCent:null,unitNavScaled:null,reconstructable:false});running=derived.derivedSharesMicro}
    return {status:SIMULATION_STATUS.AVAILABLE,anchor,currentSharesMicro:running,pendingCount,events,historyComplete:true,revisionCount:(revisions||[]).filter(x=>['fund_nav','investment_cycle','manual_trade'].includes(x.entityType)).length};
  }
  function calcSimulation(derivedResult,nav){
    if(!derivedResult||derivedResult.derivedSharesMicro==null)return {status:SIMULATION_STATUS.PENDING_SHARES,marketValueCent:null,nav:null};
    if(!nav)return {status:SIMULATION_STATUS.PENDING_NAV,marketValueCent:null,nav:null};
    return {status:SIMULATION_STATUS.AVAILABLE,marketValueCent:calcMarketValueCent(derivedResult.derivedSharesMicro,nav.unitNavScaled),nav};
  }
  function applyCalibrationAnchor(snapshot,derivedSharesMicro){
    const real=asSafeNumber(snapshot.totalSharesMicro,'REAL_SHARES');
    if(real<=0)throw new Error('INVALID_REAL_SHARES');
    const derived=derivedSharesMicro==null?real:asSafeNumber(derivedSharesMicro,'DERIVED_SHARES');
    return {...snapshot,isShareAnchor:true,anchorSharesMicro:real,derivedSharesBeforeCalibrationMicro:derived,shareCorrectionMicro:real-derived,anchorEffectiveAt:snapshot.snapshotAt||snapshot.createdAt};
  }
  function normalizeLegacyRecord(record){
    const status=executionStatus(record);
    return {...record,shareConfirmationStatus:record.shareConfirmationStatus||statusForExecution(status,false),fundProfileId:record.fundProfileId??null,fundCode:record.fundCode??null,navDate:record.navDate??(status==='EXECUTED'?recordDate(record):null),unitNavScaled:record.unitNavScaled??null,confirmedSharesMicro:record.confirmedSharesMicro??null,shareConfirmedAt:record.shareConfirmedAt??null,shareSource:record.shareSource??null};
  }
  function normalizeBackupStores(data,storeNames){
    if(![1,2,3,4].includes(data?.schemaVersion)||!data.stores||typeof data.stores!=='object'||!Array.isArray(data.stores.record_revisions||[]))throw new Error('INCOMPATIBLE_BACKUP');
    const normalized={};
    for(const name of storeNames)normalized[name]=Array.isArray(data.stores[name])?data.stores[name].map(x=>({...x})):[];
    normalized.investment_cycles=(normalized.investment_cycles||[]).map(normalizeLegacyRecord);
    normalized.manual_trades=(normalized.manual_trades||[]).map(x=>x.type==='MANUAL_BUY'?normalizeLegacyRecord(x):x.type==='MANUAL_REDEEM'?{...x,shareConfirmationStatus:x.shareConfirmationStatus||SHARE_STATUS.NOT_APPLICABLE,redeemedSharesMicro:x.redeemedSharesMicro??null}:x);
    normalized.calibration_snapshots=(normalized.calibration_snapshots||[]).map(x=>{const isAnchor=x.isShareAnchor??['INITIALIZATION','MANUAL_CALIBRATION'].includes(x.source);return {...x,isShareAnchor:isAnchor,anchorSharesMicro:x.anchorSharesMicro??(isAnchor?x.totalSharesMicro:null),derivedSharesBeforeCalibrationMicro:x.derivedSharesBeforeCalibrationMicro??null,shareCorrectionMicro:x.shareCorrectionMicro??null,anchorEffectiveAt:x.anchorEffectiveAt||(isAnchor?(x.snapshotAt||x.createdAt||null):null)}});
    normalized.app_meta=(normalized.app_meta||[]).map(x=>({...x,schemaVersion:5}));
    if(['fund_profiles','fund_nav_daily','investment_cycles','manual_trades','share_confirmation_events'].some(name=>(normalized[name]||[]).some(x=>x.fundCode==='000852')))throw new Error('INDEX_AS_FUND');
    return normalized;
  }
  return {SHARE_STATUS,SHARE_LABELS,SIMULATION_STATUS,SIMULATION_LABELS,parseScaledDecimal,calcConfirmedShares,calcMarketValueCent,calcImpliedNavScaled,calcProportionalShares,recordDate,executionStatus,isConfirmed,statusForExecution,getFundProfile,getFundNav,latestFundNav,shareFields,latestRealCalibration,calcDerivedShares,buildShareTimeline,calcSimulation,applyCalibrationAnchor,normalizeLegacyRecord,normalizeBackupStores};
});
