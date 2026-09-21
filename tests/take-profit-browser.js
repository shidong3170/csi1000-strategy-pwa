const assert=require('node:assert/strict');
const endpoint=process.env.CDP_ENDPOINT||'http://127.0.0.1:9223';
const pageUrl=process.env.PWA_URL||'http://127.0.0.1:8765/index.html';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function main(){
  const tabs=await fetch(`${endpoint}/json`).then(r=>r.json());
  const target=tabs.find(x=>x.type==='page'&&x.url.startsWith(pageUrl));
  if(!target)throw new Error('PWA_BROWSER_TAB_NOT_FOUND');
  const socket=new WebSocket(target.webSocketDebuggerUrl),pending=new Map();let nextId=0;
  socket.onmessage=event=>{const message=JSON.parse(event.data),waiter=pending.get(message.id);if(!waiter)return;pending.delete(message.id);message.error?waiter.reject(new Error(message.error.message)):waiter.resolve(message.result)};
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++nextId;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}))});
  const evaluate=async expression=>{const response=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(response.exceptionDetails)throw new Error(response.exceptionDetails.exception?.description||response.exceptionDetails.text);return response.result.value};
  await call('Page.enable');await call('Runtime.enable');
  try{
    await evaluate(`(async()=>{if(DB.db){DB.db.close();DB.db=null}await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase(DB_NAME);r.onsuccess=resolve;r.onerror=()=>reject(r.error);r.onblocked=()=>reject(new Error('DELETE_BLOCKED'))});return true})()`);
    await call('Page.reload',{ignoreCache:true});await delay(1500);
    const result=await evaluate(`(async()=>{
      window.alert=()=>{};window.confirm=()=>true;
      $('initMarketValue').value='12000';$('initShares').value='10000';$('initPrincipal').value='10000';$('initStartDate').value='2023-01-01';$('initCycles').value='171';await App.initialize();
      const opening=await DB.get('external_cashflows','opening'),baseline=await DB.get('initialization_baseline','baseline'),takeover='2025-09-21';
      await DB.put('external_cashflows',{...opening,date:takeover});await DB.put('initialization_baseline',{...baseline,takeoverDate:takeover});
      const before=await Calc.metrics(),ctx=await TakeProfit.context(before),initialShares=(await Fund.derived()).derivedSharesMicro;
      const first=await TakeProfit.settle({tradeDate:today(),grossCent:200000,feeCent:1000,netCent:199000,note:'浏览器隔离回归'});
      const afterFirst=await Calc.metrics(),pendingShares=(await Fund.derived()).derivedSharesMicro;
      await TakeProfit.confirmShares(first.id,1000000000);
      const confirmedShares=(await Fund.derived()).derivedSharesMicro;
      const second=await TakeProfit.settle({tradeDate:today(),grossCent:100000,feeCent:null,netCent:null,note:'费用待确认'});
      const afterPending=await Calc.metrics();
      let pendingBlocked=false;try{await TakeProfit.settlePending(second.id,500,99500)}catch(e){pendingBlocked=/真实市值与本金依据/.test(e.message)}
      await TakeProfit.reviseSettlement(first.id,{grossCent:200000,feeCent:2000,netCent:198000},'费用单据修正');
      const revised=await DB.get('take_profit_events',first.id),afterRevision=await Calc.metrics(),revisions=(await DB.all('record_revisions')).filter(x=>x.entityId===first.id);
      const calAt=new Date().toISOString(),newCal=FundShareCore.applyCalibrationAnchor({id:'tp-browser-cal-2',snapshotDate:today(),snapshotAt:calAt,fundMarketValueCent:1000000,totalSharesMicro:9000000000,inMarketPrincipalCent:afterRevision.principal,cashPoolBalanceCent:afterRevision.cash,strategyTotalAssetsCent:1000000+afterRevision.cash,source:'MANUAL_CALIBRATION',reason:'第二笔止盈前真实校准',createdAt:calAt},9000000000);await DB.put('calibration_snapshots',newCal);
      const third=await TakeProfit.settle({tradeDate:today(),grossCent:100000,feeCent:null,netCent:null,note:'第二笔费用待确认'}),beforeThirdSettlement=await Calc.metrics();
      const thirdSettled=await TakeProfit.settlePending(third.id,500,99500),afterThirdSettlement=await Calc.metrics();
      let earlierRevisionBlocked=false;try{await TakeProfit.reviseSettlement(first.id,{grossCent:200000,feeCent:3000,netCent:197000},'尝试修改前笔')}catch(e){earlierRevisionBlocked=/后续止盈/.test(e.message)}
      App.openTakeProfitBackfill();$('tpBackDate').value='2024-01-02';$('tpBackGross').value='500';$('tpBackFee').value='5';$('tpBackNet').value='495';$('tpBackShares').value='10';$('tpBackNote').value='真实历史单据';await $('tpBackSave').onclick();
      const backfill=(await DB.all('take_profit_events')).find(x=>x.recordType==='HISTORICAL_BACKFILL');await App.openTakeProfitBackfill(backfill.id);$('tpBackFee').value='6';$('tpBackNet').value='494';$('tpBackReason').value='历史单据更正';await $('tpBackSave').onclick();
      const revisedBackfill=await DB.get('take_profit_events',backfill.id),backfillRevisions=(await DB.all('record_revisions')).filter(x=>x.entityId===backfill.id),afterBackfill=await Calc.metrics(),progress=TakeProfitCore.progress(await DB.all('take_profit_events'),ctx.base,ctx.stage.band);
      return {xirr:before.xirr,baseline:ctx.base?.baseMarketValueCent,first:{status:first.settlementStatus,released:first.principalReleasedCent,profit:first.realizedProfitCent},principalBefore:before.principal,principalAfterFirst:afterFirst.principal,cashAfterFirst:afterFirst.cash,fundAfterFirst:afterFirst.fund,shares:{initial:initialShares,pending:pendingShares,confirmed:confirmedShares},secondStatus:second.settlementStatus,afterPending:{principal:afterPending.principal,cash:afterPending.cash},pendingBlocked,revised:{fee:revised.redemptionFeeCent,net:revised.netCashReceivedCent,status:revised.revisionStatus},afterRevision:{principal:afterRevision.principal,cash:afterRevision.cash},revisionCount:revisions.length,third:{pending:third.settlementStatus,beforePrincipal:beforeThirdSettlement.principal,beforeCash:beforeThirdSettlement.cash,status:thirdSettled.settlementStatus,released:thirdSettled.principalReleasedCent,afterPrincipal:afterThirdSettlement.principal,afterCash:afterThirdSettlement.cash,afterFund:afterThirdSettlement.fund},earlierRevisionBlocked,backfill:{status:revisedBackfill?.settlementStatus,fee:revisedBackfill?.redemptionFeeCent,net:revisedBackfill?.netCashReceivedCent,shares:revisedBackfill?.redeemedSharesMicro,revisionStatus:revisedBackfill?.revisionStatus,revisionCount:backfillRevisions.length},afterBackfill:{principal:afterBackfill.principal,cash:afterBackfill.cash},progress:{count:progress.count,gross:progress.grossCent}};
    })()`);
    console.log(JSON.stringify(result,null,2));
    assert.ok(result.xirr>=0.10);assert.equal(result.baseline,1200000);
    assert.equal(result.first.status,'SETTLED');assert.equal(result.first.released,166667);assert.equal(result.first.profit,32333);
    assert.equal(result.principalBefore,1000000);assert.equal(result.principalAfterFirst,833333);assert.equal(result.cashAfterFirst,199000);assert.equal(result.fundAfterFirst,1000000);
    assert.equal(result.shares.initial,10000000000);assert.equal(result.shares.pending,10000000000);assert.equal(result.shares.confirmed,9000000000);
    assert.equal(result.secondStatus,'PENDING_SETTLEMENT');assert.equal(result.afterPending.principal,833333);assert.equal(result.afterPending.cash,199000);assert.equal(result.pendingBlocked,true);
    assert.equal(result.revised.fee,2000);assert.equal(result.revised.net,198000);assert.equal(result.revised.status,'MODIFIED');assert.equal(result.afterRevision.principal,833333);assert.equal(result.afterRevision.cash,198000);assert.ok(result.revisionCount>=2);
    assert.equal(result.third.pending,'PENDING_SETTLEMENT');assert.equal(result.third.beforePrincipal,833333);assert.equal(result.third.beforeCash,198000);assert.equal(result.third.status,'SETTLED');assert.equal(result.third.released,83333);assert.equal(result.third.afterPrincipal,750000);assert.equal(result.third.afterCash,297500);assert.equal(result.third.afterFund,900000);assert.equal(result.earlierRevisionBlocked,true);
    assert.equal(result.backfill.status,'PENDING_SETTLEMENT');assert.equal(result.backfill.fee,600);assert.equal(result.backfill.net,49400);assert.equal(result.backfill.shares,10000000);assert.equal(result.backfill.revisionStatus,'MODIFIED');assert.ok(result.backfill.revisionCount>=2);assert.equal(result.afterBackfill.principal,750000);assert.equal(result.afterBackfill.cash,297500);
    assert.equal(result.progress.count,2);assert.equal(result.progress.gross,300000);
    console.log('take-profit-browser: settlement, pending, shares, revision, backfill passed');
  }finally{socket.close()}
}

main().catch(error=>{console.error(error);process.exitCode=1});
