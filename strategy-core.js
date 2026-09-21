(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  root.StrategyCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const DAYS_PER_YEAR=365.2425;

  function annualHardLimit(strategy,asOfDate){
    const year=Number(String(asOfDate).slice(0,4));
    const effectiveYear=Number(String(strategy.effectiveFrom).slice(0,4));
    return strategy.baseHardLimitCent+Math.max(0,year-effectiveYear)*strategy.annualHardLimitIncrementCent;
  }

  function principalPositionBp(principalCent,totalInvestmentBaseCent){
    return totalInvestmentBaseCent>0?Math.round(principalCent/totalInvestmentBaseCent*10000):0;
  }

  function remainingHardLimit(principalCent,hardLimitCent){
    return Math.max(0,hardLimitCent-principalCent);
  }

  function marketCandidateCent(drawdownBp,position3yBp,belowMA200){
    if(drawdownBp>=3000&&position3yBp<=2000&&belowMA200) return 30000;
    if(drawdownBp>=2000&&position3yBp<=3000) return 20000;
    if(drawdownBp>=1000&&(position3yBp<=4000||belowMA200)) return 15000;
    return 10000;
  }

  function marketFreshness(tradingDayDistance){
    if(!Number.isInteger(tradingDayDistance)||tradingDayDistance<0) return 'UNKNOWN';
    if(tradingDayDistance<=3) return 'FRESH';
    if(tradingDayDistance<=7) return 'AGING';
    return 'STALE';
  }

  function applyPositionGuardrails(candidateCent,positionBp,remainingCent,baseCent=10000){
    if(remainingCent<=0) return 0;
    let amount=candidateCent;
    if(positionBp>=1900) amount=5000;
    else if(positionBp>=1800) amount=Math.min(amount,10000);
    if(!Number.isFinite(amount)||amount<=0) amount=baseCent;
    return Math.max(0,Math.min(Math.round(amount),remainingCent));
  }

  function fundingSourceSplit(investmentCent,cashPoolBalanceCent){
    const cashPoolCent=Math.min(Math.max(0,investmentCent),Math.max(0,cashPoolBalanceCent));
    return {cashPoolCent,externalCent:Math.max(0,investmentCent-cashPoolCent)};
  }

  function takeProfitCostAllocation(fundValueCent,principalCent,redeemCent){
    if(fundValueCent<=0||principalCent<0||redeemCent<=0||redeemCent>fundValueCent) throw new Error('INVALID_REDEMPTION');
    const exitedPrincipalCent=redeemCent===fundValueCent?principalCent:Math.min(principalCent,Math.round(principalCent*redeemCent/fundValueCent));
    return {
      exitedPrincipalCent,
      realizedGainCent:redeemCent-exitedPrincipalCent,
      remainingPrincipalCent:principalCent-exitedPrincipalCent
    };
  }

  function xnpv(rate,flows){
    if(rate<=-1) return Number.POSITIVE_INFINITY;
    const t0=Date.parse(flows[0].date+'T00:00:00Z');
    return flows.reduce((sum,flow)=>sum+flow.amountCent/Math.pow(1+rate,(Date.parse(flow.date+'T00:00:00Z')-t0)/86400000/DAYS_PER_YEAR),0);
  }

  function xirr(cashflows,terminalCent,terminalDate){
    const flows=cashflows.filter(x=>!x.voided&&Number.isFinite(x.amountCent)).map(x=>({date:x.date,amountCent:x.amountCent}));
    flows.push({date:terminalDate,amountCent:terminalCent});
    flows.sort((a,b)=>a.date.localeCompare(b.date));
    if(!flows.some(x=>x.amountCent<0)||!flows.some(x=>x.amountCent>0)) return null;
    let rate=0.1;
    for(let i=0;i<50;i++){
      const value=xnpv(rate,flows);
      if(Math.abs(value)<0.01) return rate;
      const epsilon=1e-7;
      const derivative=(xnpv(rate+epsilon,flows)-value)/epsilon;
      if(!Number.isFinite(derivative)||Math.abs(derivative)<1e-12) break;
      const next=rate-value/derivative;
      if(!Number.isFinite(next)||next<=-0.9999||next>10) break;
      if(Math.abs(next-rate)<1e-10) return next;
      rate=next;
    }
    let lo=-0.9999,hi=10,flo=xnpv(lo,flows),fhi=xnpv(hi,flows);
    if(!Number.isFinite(flo)||!Number.isFinite(fhi)||flo*fhi>0) return null;
    for(let i=0;i<250;i++){
      const mid=(lo+hi)/2,fmid=xnpv(mid,flows);
      if(Math.abs(fmid)<0.01) return mid;
      if(flo*fmid<=0){hi=mid;fhi=fmid}else{lo=mid;flo=fmid}
    }
    return (lo+hi)/2;
  }

  function recommend(input){
    const {strategy,principalCent,positionBp,remainingCent,cashPoolCent,holdingYears,xirrRate,calibrationStatus,market}=input;
    const takeProfitMinXirr=Number.isFinite(input.takeProfitMinXirr)?input.takeProfitMinXirr:0.10;
    if(remainingCent<=0) return {action:'STOP_NEW_INVESTMENT',amountCent:0,reasonCodes:['HARD_LIMIT_REACHED'],funding:fundingSourceSplit(0,cashPoolCent)};
    if(holdingYears>=5){
      if(xirrRate==null||calibrationStatus==='STALE'||calibrationStatus==='MISSING')return {action:'REASSESS_STRATEGY',amountCent:0,reasonCodes:['MAX_TERM_DATA_UNAVAILABLE'],funding:fundingSourceSplit(0,cashPoolCent)};
      const achieved=xirrRate!=null&&xirrRate>=strategy.targetXirrBp/10000;
      return {action:achieved?'EXIT_OR_DE_RISK':'REASSESS_STRATEGY',amountCent:0,reasonCodes:[achieved?'MAX_TERM_TARGET_REACHED':'MAX_TERM_REASSESS'],funding:fundingSourceSplit(0,cashPoolCent)};
    }
    const canUseXirr=calibrationStatus!=='STALE'&&calibrationStatus!=='MISSING'&&xirrRate!=null;
    if(holdingYears>=3&&canUseXirr&&xirrRate>=takeProfitMinXirr) return {action:'TAKE_PROFIT_TO_CASH_POOL',amountCent:0,reasonCodes:['XIRR_TAKE_PROFIT'],funding:fundingSourceSplit(0,cashPoolCent)};
    let candidate=strategy.baseRecurringAmountCent;
    const reasons=[];
    if(market&&market.available&&market.decisionReady!==false&&market.freshness!=='STALE'&&market.freshness!=='UNKNOWN'){
      candidate=market.candidateCent;
      reasons.push('MARKET_THREE_FACTOR');
    }else reasons.push('MARKET_BASE_ONLY');
    const amountCent=applyPositionGuardrails(candidate,positionBp,remainingCent,strategy.baseRecurringAmountCent);
    if(positionBp>=1900) reasons.push('POSITION_19_SLOWDOWN');
    else if(positionBp>=1800) reasons.push('POSITION_18_CAP');
    return {
      action:amountCent>strategy.baseRecurringAmountCent?'INCREASE_RECURRING':amountCent<strategy.baseRecurringAmountCent?'REDUCE_RECURRING':'MAINTAIN_RECURRING',
      amountCent,
      reasonCodes:reasons,
      funding:fundingSourceSplit(amountCent,cashPoolCent),
      principalCent
    };
  }

  return {annualHardLimit,principalPositionBp,remainingHardLimit,marketCandidateCent,marketFreshness,applyPositionGuardrails,fundingSourceSplit,takeProfitCostAllocation,xirr,recommend};
});
