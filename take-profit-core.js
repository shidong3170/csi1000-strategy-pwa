(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.TakeProfitCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const DEFAULT_BANDS=[
    {minXirr:0.10,maxXirr:0.12,targetMin:0.10,targetMax:0.20},
    {minXirr:0.12,maxXirr:0.15,targetMin:0.20,targetMax:0.35},
    {minXirr:0.15,maxXirr:null,targetMin:0.35,targetMax:0.50}
  ];
  const DAY_MS=86400000;
  function day(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value||''))||Number.isNaN(Date.parse(value+'T00:00:00Z')))throw new Error('INVALID_DATE');return value}
  function ageDays(from,to){return Math.floor((Date.parse(day(to)+'T00:00:00Z')-Date.parse(day(from)+'T00:00:00Z'))/DAY_MS)}
  function holdingYears(from,to){
    const start=day(from),end=day(to),anniversary=years=>{
      const d=new Date(start+'T00:00:00Z');d.setUTCFullYear(d.getUTCFullYear()+years);return d.toISOString().slice(0,10);
    };
    if(end>=anniversary(5))return 5;
    if(end>=anniversary(3))return 3;
    return ageDays(start,end)/365.2425;
  }
  function integer(value,name){if(!Number.isSafeInteger(value)||value<0)throw new Error('INVALID_'+name);return value}
  function defaultPolicy(effectiveFrom,createdAt){return {id:'tp-policy-v1',scope:'TAKE_PROFIT',previousVersionId:null,versionLabel:'TP-V1',effectiveFrom:day(effectiveFrom),createdAt:createdAt||new Date().toISOString(),reason:'V1.2 Frozen 默认止盈策略',bands:DEFAULT_BANDS.map(x=>({...x}))}}
  function validatePolicy(policy,creationDate){
    day(policy.effectiveFrom);
    if(creationDate&&policy.effectiveFrom<day(creationDate))throw new Error('POLICY_RETROACTIVE');
    if(!String(policy.reason||'').trim())throw new Error('POLICY_REASON_REQUIRED');
    const bands=policy.bands;
    if(!Array.isArray(bands)||bands.length!==3)throw new Error('INVALID_POLICY_BANDS');
    let previousMin=0,previousMax=null;
    for(let i=0;i<bands.length;i++){
      const b=bands[i];
      if(!Number.isFinite(b.minXirr)||b.minXirr<0.06||b.minXirr<=previousMin)throw new Error('INVALID_XIRR_THRESHOLD');
      if(i===0&&b.minXirr<0.10)throw new Error('INVALID_XIRR_THRESHOLD');
      if(i>0&&b.minXirr!==previousMax)throw new Error('XIRR_BANDS_GAP');
      if(i<bands.length-1&&(!Number.isFinite(b.maxXirr)||b.maxXirr<=b.minXirr))throw new Error('INVALID_XIRR_THRESHOLD');
      if(i===bands.length-1&&b.maxXirr!==null)throw new Error('LAST_BAND_MUST_BE_OPEN');
      if(!Number.isFinite(b.targetMin)||!Number.isFinite(b.targetMax)||b.targetMin<0||b.targetMin>b.targetMax||b.targetMax>1)throw new Error('INVALID_TARGET_RATIO');
      previousMin=b.minXirr;previousMax=b.maxXirr;
    }
    return true;
  }
  function effectivePolicy(policies,asOfDate){return [...(policies||[])].filter(x=>!x.voided&&x.effectiveFrom<=day(asOfDate)).sort((a,b)=>b.effectiveFrom.localeCompare(a.effectiveFrom)||String(b.createdAt).localeCompare(String(a.createdAt)))[0]||null}
  function bandFor(policy,xirr){return policy?.bands?.find(b=>xirr>=b.minXirr&&(b.maxXirr===null||xirr<b.maxXirr))||null}
  function deriveStage({startDate,asOfDate,formalXirr,calibrationDate,policy}){
    const years=holdingYears(startDate,asOfDate),age=calibrationDate?ageDays(calibrationDate,asOfDate):Infinity;
    const freshness=age<=7?'FRESH':age<=14?'AGING':'STALE';
    if(formalXirr==null||!Number.isFinite(formalXirr))return {stage:'DATA_UNAVAILABLE',years,freshness,band:null};
    if(years>=5)return {stage:freshness==='STALE'?'DATA_UNAVAILABLE':formalXirr>=0.06?'EXIT_DE_RISK':'REASSESS_STRATEGY',years,freshness,band:null};
    if(years<3)return {stage:formalXirr<0.06?'ACCUMULATE':'AHEAD_NO_TAKE_PROFIT',years,freshness,band:null};
    if(formalXirr<0.08)return {stage:formalXirr<0.06?'ACCUMULATE':'AHEAD_NO_TAKE_PROFIT',years,freshness,band:null};
    const band=bandFor(policy,formalXirr);
    if(!band)return {stage:'TAKE_PROFIT_WATCH',years,freshness,band:null};
    const index=policy.bands.indexOf(band);
    return {stage:['TAKE_PROFIT_PARTIAL','TAKE_PROFIT_HIGHER_LOCK','TAKE_PROFIT_STRONG_LOCK'][index],years,freshness,band};
  }
  function baselineCandidate({existing,stage,calibration,formalXirr,asOfDate,policy}){
    if(existing)return null;
    if(!stage||stage.years<3||formalXirr==null||formalXirr<0.10||stage.freshness==='STALE'||!calibration||!integer(calibration.fundMarketValueCent,'BASE_MARKET_VALUE'))return null;
    if(calibration.fundMarketValueCent<=0)return null;
    return {id:'tp-base-main',policyVersionId:policy.id,triggerDate:day(asOfDate),baseMarketValueCent:calibration.fundMarketValueCent,sourceCalibrationId:calibration.id,formalXirrAtTrigger:formalXirr,lockedAt:new Date().toISOString(),voided:false};
  }
  function progress(events,baseline,band){
    const settled=(events||[]).filter(x=>!x.voided&&x.settlementStatus==='SETTLED'&&Number.isSafeInteger(x.grossRedemptionAmountCent));
    const gross=settled.reduce((n,x)=>n+x.grossRedemptionAmountCent,0);
    const principal=settled.reduce((n,x)=>n+(x.principalReleasedCent||0),0);
    const profit=settled.reduce((n,x)=>n+(x.netCashReceivedCent||0)-(x.principalReleasedCent||0),0);
    const base=baseline?.baseMarketValueCent;
    return {count:settled.length,grossCent:gross,principalCent:principal,realizedProfitCent:profit,ratio:base>0?gross/base:null,targetMin:band?.targetMin??null,targetMax:band?.targetMax??null,toLowerCent:base>0&&band?Math.max(0,targetAmount(base,band.targetMin)-gross):null,toUpperCent:base>0&&band?Math.max(0,targetAmount(base,band.targetMax)-gross):null};
  }
  function targetAmount(baseCent,ratio){const scaled=Math.round(ratio*1000000);return Number((BigInt(baseCent)*BigInt(scaled)+500000n)/1000000n)}
  function previewSettlement(input){
    const gross=integer(input.grossCent,'GROSS'),fee=integer(input.feeCent,'FEE'),net=integer(input.netCent,'NET'),value=integer(input.marketValueCent,'MARKET_VALUE'),principal=integer(input.principalCent,'PRINCIPAL');
    if(value<=0||gross<=0||gross>value||gross!==fee+net)throw new Error('INVALID_SETTLEMENT');
    const released=Number((BigInt(principal)*BigInt(gross)+BigInt(Math.floor(value/2)))/BigInt(value));
    return {grossCent:gross,feeCent:fee,netCent:net,ratio:gross/value,principalReleasedCent:released,postPrincipalCent:principal-released,realizedProfitCent:net-released,cashIncreaseCent:net,externalCashflowCent:0};
  }
  function completeAmounts({grossCent,feeCent,netCent}){
    if(feeCent==null)return {grossCent:grossCent??null,feeCent:null,netCent:netCent??null,complete:false};
    const fee=integer(feeCent,'FEE');
    let gross=grossCent==null?null:integer(grossCent,'GROSS'),net=netCent==null?null:integer(netCent,'NET');
    if(gross==null&&net!=null)gross=net+fee;
    if(net==null&&gross!=null)net=gross-fee;
    if(gross==null||net==null)return {grossCent:gross,feeCent:fee,netCent:net,complete:false};
    if(gross<=0||net<0||gross!==fee+net)throw new Error('INVALID_SETTLEMENT');
    return {grossCent:gross,feeCent:fee,netCent:net,complete:true};
  }
  function isOverride(grossCent,baseline,band,priorGrossCent){
    if(!baseline||!band)return false;
    const next=priorGrossCent+grossCent;
    return next<targetAmount(baseline.baseMarketValueCent,band.targetMin)||next>targetAmount(baseline.baseMarketValueCent,band.targetMax);
  }
  return {DEFAULT_BANDS,ageDays,holdingYears,defaultPolicy,validatePolicy,effectivePolicy,bandFor,deriveStage,baselineCandidate,progress,previewSettlement,completeAmounts,isOverride};
});
