(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  root.PrincipalRevisionCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const EXECUTION={PENDING:'PENDING',EXECUTED:'EXECUTED',NOT_EXECUTED:'NOT_EXECUTED',BLOCKED_HARD_LIMIT:'BLOCKED_HARD_LIMIT'};
  const REVISION={ORIGINAL:'ORIGINAL',MODIFIED:'MODIFIED'};
  const EXECUTION_LABELS={PENDING:'待执行',EXECUTED:'已执行',NOT_EXECUTED:'未执行',BLOCKED_HARD_LIMIT:'因硬上限停止'};
  const REVISION_LABELS={ORIGINAL:'原始',MODIFIED:'已修改'};
  const EDITABLE_FIELDS=['scheduledDate','tradeDate','actualAmountCent','amountCent','cashPoolFundingCent','externalFundingCent','executionStatus','notes'];
  const FIELD_LABELS={strategyStartDate:'策略开始日期',historicalExecutedCycles:'历史有效定投期数',historicalInvestedPrincipalCent:'历史累计投入本金',takeoverInMarketPrincipalCent:'接管日在场本金',scheduledDate:'日期',tradeDate:'日期',actualAmountCent:'实际投入',amountCent:'实际投入',cashPoolFundingCent:'现金池出资',externalFundingCent:'外部资金',executionStatus:'执行状态',notes:'备注'};
  let revisionSequence=0;

  function integer(value,name){
    const number=Number(value);
    if(!Number.isInteger(number)||number<0) throw new Error(`INVALID_${name}`);
    return number;
  }

  function statusOf(record){
    if(record?.executionStatus) return record.executionStatus;
    if(record?.status) return record.status;
    return record?.type==='MANUAL_BUY'?EXECUTION.EXECUTED:null;
  }

  function revisionStatusOf(record){return record?.revisionStatus||REVISION.ORIGINAL}
  function isExecuted(record){return !record?.voided&&statusOf(record)===EXECUTION.EXECUTED}
  function actualOf(record){return Number(record?.actualAmountCent??record?.amountCent??0)||0}
  function recordDate(record){return record?.scheduledDate||record?.tradeDate||''}
  function manualExtra(planned,actual){return Math.max(0,integer(actual,'ACTUAL_AMOUNT')-integer(planned,'PLANNED_AMOUNT'))}

  function pendingRecords(records=[]){
    return [...records].filter(record=>!record?.voided&&statusOf(record)===EXECUTION.PENDING).sort((a,b)=>recordDate(b).localeCompare(recordDate(a))||String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
  }

  function validateFunding(input){
    const status=input.executionStatus;
    if(!Object.values(EXECUTION).includes(status)) throw new Error('INVALID_EXECUTION_STATUS');
    const actual=integer(input.actualAmountCent,'ACTUAL_AMOUNT');
    const cash=integer(input.cashPoolFundingCent,'CASH_POOL_FUNDING');
    const external=integer(input.externalFundingCent,'EXTERNAL_FUNDING');
    if(status!==EXECUTION.EXECUTED&&(actual!==0||cash!==0||external!==0)) throw new Error('NON_EXECUTED_MUST_BE_ZERO');
    if(actual!==cash+external) throw new Error('FUNDING_SUM_MISMATCH');
    if(status===EXECUTION.EXECUTED&&actual<=0) throw new Error('EXECUTED_AMOUNT_REQUIRED');
    return {actualAmountCent:actual,cashPoolFundingCent:cash,externalFundingCent:external};
  }

  function prepareRecordRevision(before,changes,context={}){
    const after={...before,...changes};
    after.executionStatus=changes.executionStatus||statusOf(before);
    const amounts=validateFunding({executionStatus:after.executionStatus,actualAmountCent:actualOf(after),cashPoolFundingCent:after.cashPoolFundingCent||0,externalFundingCent:after.externalFundingCent||0});
    const planned=Number(before.plannedAmountCent||0);
    if(changes.plannedAmountCent!=null&&Number(changes.plannedAmountCent)!==planned) throw new Error('PLANNED_AMOUNT_IMMUTABLE');
    const date=recordDate(after);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('INVALID_RECORD_DATE');
    const oldContribution=isExecuted(before)?actualOf(before):0,newContribution=after.executionStatus===EXECUTION.EXECUTED?amounts.actualAmountCent:0;
    const prospectiveCash=integer(context.currentCashPoolCent||0,'CURRENT_CASH')+Number(before.cashPoolFundingCent||0)-amounts.cashPoolFundingCent;
    const prospectivePrincipal=integer(context.currentPrincipalCent||0,'CURRENT_PRINCIPAL')-oldContribution+newContribution;
    if(prospectiveCash<0) throw new Error('CASH_POOL_WOULD_BE_NEGATIVE');
    if(prospectivePrincipal<0) throw new Error('PRINCIPAL_WOULD_BE_NEGATIVE');
    const hardLimit=Number(context.hardLimitCent);
    const exceeds=Number.isFinite(hardLimit)&&prospectivePrincipal>hardLimit;
    const oldStatus=statusOf(before);
    if(exceeds&&(oldStatus===EXECUTION.BLOCKED_HARD_LIMIT||oldStatus===EXECUTION.PENDING||date>=String(context.today||''))) throw new Error('HARD_LIMIT_EXCEEDED');
    after.actualAmountCent=amounts.actualAmountCent;
    if(Object.prototype.hasOwnProperty.call(after,'amountCent')) after.amountCent=amounts.actualAmountCent;
    after.cashPoolFundingCent=amounts.cashPoolFundingCent;
    after.externalFundingCent=amounts.externalFundingCent;
    if(Object.prototype.hasOwnProperty.call(after,'plannedAmountCent')) after.manualExtraAmountCent=manualExtra(planned,amounts.actualAmountCent);
    after.status=after.executionStatus;
    after.countsAsCycle=after.executionStatus===EXECUTION.EXECUTED&&before.type!=='MANUAL_BUY';
    after.revisionStatus=REVISION.MODIFIED;
    after.auditFlags=exceeds?[...new Set([...(before.auditFlags||[]),'HISTORICAL_HARD_LIMIT_CONFLICT'])]:(before.auditFlags||[]);
    return {after,prospectiveCash,prospectivePrincipal,auditConflict:exceeds};
  }

  function revisionEntries(entityType,entityId,before,after,reason,changedAt,source='USER_EDIT'){
    if(!String(reason||'').trim()) throw new Error('CHANGE_REASON_REQUIRED');
    const fields=entityType==='initialization_baseline'?['strategyStartDate','historicalExecutedCycles','historicalInvestedPrincipalCent','takeoverInMarketPrincipalCent']:entityType==='manual_trade'?['tradeDate','amountCent','cashPoolFundingCent','externalFundingCent','executionStatus','notes']:EDITABLE_FIELDS;
    return fields.filter(field=>JSON.stringify(before?.[field]??null)!==JSON.stringify(after?.[field]??null)).map((field,index)=>({
      id:`rev-${changedAt.replace(/\D/g,'')}-${index}-${entityId}-${++revisionSequence}`,
      entityType,entityId,fieldName:field,fieldLabel:FIELD_LABELS[field]||field,changeType:'FIELD_CORRECTION',
      before:before?.[field]??null,after:after?.[field]??null,changedAt,changeReason:String(reason).trim(),source
    }));
  }

  function executionTransitionEntry(entityType,before,after,changedAt,notes=''){
    const from=statusOf(before),to=statusOf(after);
    if(from!==EXECUTION.PENDING||![EXECUTION.EXECUTED,EXECUTION.NOT_EXECUTED].includes(to))throw new Error('INVALID_PENDING_TRANSITION');
    return {id:`rev-${changedAt.replace(/\D/g,'')}-execution-${before.id}-${++revisionSequence}`,entityType,entityId:before.id,fieldName:'executionStatus',fieldLabel:FIELD_LABELS.executionStatus,changeType:'EXECUTION_CONFIRMATION',before:from,after:to,changedAt,changeReason:String(notes||'').trim()||(to===EXECUTION.EXECUTED?'确认已执行':'确认未执行'),source:'PENDING_ACTION'};
  }

  function formalPeriodReturn({baseline,cashflows=[],formalFundMarketValueCent,cashPoolCent,asOfDate}){
    const datePattern=/^\d{4}-\d{2}-\d{2}$/;
    const takeoverDate=baseline?.takeoverDate;
    const days=datePattern.test(String(takeoverDate||''))&&datePattern.test(String(asOfDate||''))?Math.floor((new Date(`${asOfDate}T00:00:00Z`)-new Date(`${takeoverDate}T00:00:00Z`))/86400000):null;
    const unavailable=reason=>({status:'UNAVAILABLE',reason,rate:null,netExternalContributionCent:null,formalEndingAssetsCent:null,formalPeriodProfitCent:null,daysSinceTakeover:days,shortTakeover:Number.isInteger(days)&&days>=0&&days<30});
    if(!datePattern.test(String(takeoverDate||''))||!datePattern.test(String(asOfDate||''))||days<0)return unavailable('TAKEOVER_DATE_MISSING');
    const openingPrincipal=Number(baseline?.takeoverInMarketPrincipalCent);
    if(!Number.isSafeInteger(openingPrincipal)||openingPrincipal<0)return unavailable('CASHFLOW_FACTS_INCOMPLETE');
    const active=(cashflows||[]).filter(flow=>!flow?.voided),allowed=new Set(['TAKEOVER_OPENING','EXTERNAL_CONTRIBUTION','STRATEGY_WITHDRAWAL']);
    if(active.some(flow=>!allowed.has(flow.type)||!datePattern.test(String(flow.date||''))||!Number.isSafeInteger(Number(flow.amountCent))||flow.date<takeoverDate||flow.date>asOfDate))return unavailable('CASHFLOW_FACTS_INCOMPLETE');
    const openings=active.filter(flow=>flow.type==='TAKEOVER_OPENING');
    if(openings.length!==1||openings[0].date!==takeoverDate||Number(openings[0].amountCent)!==-openingPrincipal)return unavailable('CASHFLOW_FACTS_INCOMPLETE');
    if(formalFundMarketValueCent==null||cashPoolCent==null)return unavailable('FORMAL_ENDING_ASSETS_UNAVAILABLE');
    const fund=Number(formalFundMarketValueCent),cash=Number(cashPoolCent);
    if(!Number.isSafeInteger(fund)||fund<0||!Number.isSafeInteger(cash)||cash<0)return unavailable('FORMAL_ENDING_ASSETS_UNAVAILABLE');
    const net=-active.reduce((sum,flow)=>sum+Number(flow.amountCent),0);
    if(!Number.isSafeInteger(net)||net<=0)return unavailable('NET_EXTERNAL_CONTRIBUTION_NON_POSITIVE');
    const ending=fund+cash,profit=ending-net;
    return {status:'AVAILABLE',reason:null,rate:profit/net,netExternalContributionCent:net,formalEndingAssetsCent:ending,formalPeriodProfitCent:profit,daysSinceTakeover:days,shortTakeover:days<30};
  }

  function principalBreakdown(baseline,cycles=[],trades=[],externalCashflows=[],cashLedger=[]){
    const takeover=integer(baseline?.takeoverInMarketPrincipalCent||0,'TAKEOVER_PRINCIPAL');
    let recurring=0,manual=0,cashReinvest=0;
    for(const record of cycles.filter(isExecuted)){
      const actual=actualOf(record),cash=Math.min(actual,Number(record.cashPoolFundingCent)||0),external=actual-cash;
      const scheduledExternal=Math.min(external,Math.max(0,Number(record.plannedAmountCent)||0));
      cashReinvest+=cash;recurring+=scheduledExternal;manual+=external-scheduledExternal;
    }
    for(const record of trades.filter(record=>record.type==='MANUAL_BUY'&&isExecuted(record))){
      const actual=actualOf(record),cash=Math.min(actual,Number(record.cashPoolFundingCent)||0);
      cashReinvest+=cash;manual+=actual-cash;
    }
    const exits=trades.filter(record=>!record.voided&&record.type==='MANUAL_REDEEM').reduce((sum,record)=>sum+(Number(record.exitedPrincipalCent)||0),0);
    const principal=takeover+recurring+manual+cashReinvest-exits;
    const externalAfterTakeover=externalCashflows.filter(flow=>!flow.voided&&flow.type==='EXTERNAL_CONTRIBUTION').reduce((sum,flow)=>sum+Math.max(0,-Number(flow.amountCent||0)),0);
    const cashPool=cashLedger.filter(flow=>!flow.voided).reduce((sum,flow)=>sum+Number(flow.amountCent||0),0);
    const cycleCount=integer(baseline?.historicalExecutedCycles||0,'HISTORICAL_CYCLES')+cycles.filter(record=>isExecuted(record)&&record.countsAsCycle!==false).length;
    return {takeoverInMarketPrincipalCent:takeover,recurringInvestmentCent:recurring,manualExtraCent:manual,cashPoolReinvestCent:cashReinvest,exitedPrincipalCent:exits,currentPrincipalCent:principal,historicalExternalInvestmentCent:integer(baseline?.historicalInvestedPrincipalCent||0,'HISTORICAL_INVESTED')+externalAfterTakeover,cashPoolCent:cashPool,effectiveCycleCount:cycleCount};
  }

  return {EXECUTION,REVISION,EXECUTION_LABELS,REVISION_LABELS,FIELD_LABELS,statusOf,revisionStatusOf,isExecuted,actualOf,recordDate,manualExtra,pendingRecords,validateFunding,prepareRecordRevision,revisionEntries,executionTransitionEntry,formalPeriodReturn,principalBreakdown};
});
