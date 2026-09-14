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
  const expression=`(async()=>{
    const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    if(document.querySelector('#initCard:not(.hidden)')){
      document.querySelector('#initMarketValue').value='21647';
      document.querySelector('#initShares').value='10000';
      document.querySelector('#btnInitialize').click();
      await delay(500);
    }
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
      separationNotice:[...document.querySelectorAll('.notice')].some(node=>node.textContent.includes('不作为策略计算依据'))
    };
  })()`;
  const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
  socket.close();
  if(result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  const value=result.result.value;
  console.log(JSON.stringify(value,null,2));
  assert.match(value.version,/V1\.0\.6/);
  assert.equal(value.realtimeTitle,'实时市场');
  assert.equal(value.separationNotice,true);
  if(value.realtimePoint!=='—') assert.match(value.realtimeSource,/MANUAL_DIRECT_REALTIME/);
  else assert.match(value.updateResult,/实时指数不可用/);
  assert.notEqual(value.marketClose,'—');
}

main().catch(error=>{console.error(error);process.exitCode=1});
