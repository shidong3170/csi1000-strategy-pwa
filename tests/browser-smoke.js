const assert=require('node:assert/strict');

const endpoint=process.env.CDP_ENDPOINT||'http://127.0.0.1:9223';
const pageUrl=process.env.PWA_URL||'http://127.0.0.1:8765/index.html';

async function main(){
  const tabs=await fetch(`${endpoint}/json` ).then(response=>response.json());
  const target=tabs.find(tab=>tab.type==='page'&&tab.url.startsWith(pageUrl));
  if(!target) throw new Error('PWA_BROWSER_TAB_NOT_FOUND');
  const socket=new WebSocket(target.webSocketDebuggerUrl),pending=new Map();
  let nextId=0;
  socket.onmessage=event=>{
    const message=JSON.parse(event.data);
    if(!message.id) return;
    const waiter=pending.get(message.id);
    if(!waiter) return;
    pending.delete(message.id);
    message.error?waiter.reject(new Error(message.error.message)):waiter.resolve(message.result);
  };
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});
  const call=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++nextId;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));
  });
  await call('Page.enable');
  await call('Runtime.enable');
  await call('Page.reload',{ignoreCache:true});
  await new Promise(resolve=>setTimeout(resolve,1200));
  const setupExpression=`(async()=>{
    const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    window.alert=()=>{};window.confirm=()=>true;
    if(document.querySelector('#initCard:not(.hidden)')){
      document.querySelector('#initMarketValue').value='21647';
      document.querySelector('#initShares').value='10000';
      document.querySelector('#btnInitialize').click();
      await delay(500);
    }
    const date=today(),strategy=await App.strategyForDate(date);
    let record=await DB.get('investment_cycles','cycle-'+date);
    if(!record){await App.ensurePendingCycle(date,strategy);await App.saveCycle(date,10000,strategy,'EXECUTED');record=await DB.get('investment_cycles','cycle-'+date)}
    if(PrincipalRevisionCore.actualOf(record)!==20000){
      App.openRecordEdit(record,'investment_cycle');
      document.querySelector('#erActual').value='200';document.querySelector('#erCash').value='0';document.querySelector('#erExternal').value='200';document.querySelector('#erReason').value='浏览器回归：与实际成交核对';document.querySelector('#erSave').click();
      await delay(700);
    }
    const baseline=await DB.get('initialization_baseline','baseline');
    if(baseline.takeoverInMarketPrincipalCent!==2118000){
      App.openBaselineEdit(baseline);document.querySelector('#beTakeoverPrincipal').value='21180';document.querySelector('#beReason').value='浏览器回归：修正接管本金';document.querySelector('#beSave').click();await delay(700);
    }
    const metrics=await Calc.metrics(),cycle=await DB.get('investment_cycles','cycle-'+date),opening=await DB.get('external_cashflows','opening'),revisions=await DB.all('record_revisions');
    await DB.clear('record_revisions');await DB.atomic(['record_revisions'],tx=>{for(const revision of revisions)tx.objectStore('record_revisions').put(revision)});const restoredRevisions=(await DB.all('record_revisions')).length;
    return {principal:metrics.principal,cycleAmount:cycle.actualAmountCent,cyclePlanned:cycle.plannedAmountCent,cycleExecution:cycle.executionStatus,cycleRevision:cycle.revisionStatus,openingAmount:opening.amountCent,revisionCount:revisions.length,restoredRevisions};
  })()`;
  const setupResult=await call('Runtime.evaluate',{expression:setupExpression,awaitPromise:true,returnByValue:true});
  if(setupResult.exceptionDetails) throw new Error(setupResult.exceptionDetails.text);
  await call('Page.reload',{ignoreCache:true});await new Promise(resolve=>setTimeout(resolve,1200));
  const expression=`(async()=>{
    const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    window.alert=()=>{};window.confirm=()=>true;
    App.showPage('principal-basis');await delay(300);
    const basisText=document.querySelector('#principalBasisContent').textContent;
    App.showPage('records');await delay(300);
    const recordsText=document.querySelector('#recordsList').textContent;
    [...document.querySelectorAll('nav button')].find(button=>button.textContent.includes('分析')).click();
    await delay(500);
    document.querySelector('#btnMarketRefresh').click();
    await delay(15000);
    return {
      version:document.querySelector('#headerSub').textContent,
      realtimeTitle:document.querySelector('#realtimePoint').closest('.card').querySelector('h2').textContent,
      realtimePoint:document.querySelector('#realtimePoint').textContent,
      realtimeStatus:document.querySelector('#realtimeStatus').textContent,
      realtimeSource:document.querySelector('#realtimeSource').textContent,
      marketClose:document.querySelector('#marketClose').textContent,
      marketState:document.querySelector('#marketFresh').textContent,
      updateResult:document.querySelector('#marketUpdateResult').textContent,
      separationNotice:[...document.querySelectorAll('.notice')].some(node=>node.textContent.includes('不作为策略计算依据')),
      basisText,recordsText,
      persistedPrincipal:(await Calc.metrics()).principal,
      persistedRevisions:(await DB.all('record_revisions')).length,
      databaseVersion:(await DB.open()).version
    };
  })()`;
  const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
  if(result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  const value=result.result.value;
  await call('Network.enable');
  await call('Runtime.evaluate',{expression:`navigator.serviceWorker.ready.then(()=>true)`,awaitPromise:true,returnByValue:true});
  await call('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0,connectionType:'none'});
  await call('Page.reload');await new Promise(resolve=>setTimeout(resolve,1500));
  const offlineResult=await call('Runtime.evaluate',{expression:`(async()=>({version:document.querySelector('#headerSub')?.textContent||'',principal:(await Calc.metrics()).principal,controlled:!!navigator.serviceWorker.controller}))()`,awaitPromise:true,returnByValue:true});
  await call('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1,connectionType:'none'});
  socket.close();
  if(offlineResult.exceptionDetails) throw new Error(offlineResult.exceptionDetails.text);
  const offline=offlineResult.result.value;
  console.log(JSON.stringify(value,null,2));
  const setup=setupResult.result.value;
  assert.equal(setup.principal,2138000);
  assert.equal(setup.cycleAmount,20000);
  assert.equal(setup.cyclePlanned,10000);
  assert.equal(setup.cycleExecution,'EXECUTED');
  assert.equal(setup.cycleRevision,'MODIFIED');
  assert.equal(setup.openingAmount,-2118000);
  assert.ok(setup.revisionCount>=2);
  assert.equal(setup.restoredRevisions,setup.revisionCount);
  assert.match(value.version,/V1\.0\.7/);
  assert.equal(value.databaseVersion,3);
  assert.equal(value.persistedPrincipal,2138000);
  assert.equal(value.persistedRevisions,setup.revisionCount);
  assert.match(offline.version,/V1\.0\.7/);
  assert.equal(offline.principal,2138000);
  assert.equal(offline.controlled,true);
  assert.match(value.basisText,/历史累计外部投入/);
  assert.match(value.recordsText,/已执行/);
  assert.match(value.recordsText,/已修改/);
  assert.equal(value.realtimeTitle,'实时市场');
  assert.equal(value.separationNotice,true);
  if(value.realtimePoint!=='—') assert.match(value.realtimeSource,/MANUAL_DIRECT_REALTIME/);
  else assert.match(value.updateResult,/实时指数不可用/);
  assert.notEqual(value.marketClose,'—');
}

main().catch(error=>{console.error(error);process.exitCode=1});
