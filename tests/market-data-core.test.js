const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const core=require('../market-data-core.js');
const strategy=require('../strategy-core.js');

function items(count=200,end='2026-09-11'){
  const endDate=new Date(end+'T00:00:00Z'),out=[];
  for(let i=count-1;i>=0;i--){const d=new Date(endDate);d.setUTCDate(d.getUTCDate()-i);out.push({date:d.toISOString().slice(0,10),close:5000+(count-i)})}
  return out;
}

function eastmoneyPayload(rows=items()){
  return {data:{code:'000852',name:'中证1000',klines:rows.map(x=>`${x.date},${x.close-1},${x.close},0,0,0,0`)}};
}

const parsed=core.parseEastmoneyResponse(eastmoneyPayload(),'2026-09-11T10:30:00Z');
assert.equal(parsed.source,'MANUAL_DIRECT');
assert.equal(core.latestDate(parsed),'2026-09-11');
assert.throws(()=>core.parseEastmoneyResponse({data:{code:'000300',name:'沪深300',klines:eastmoneyPayload().data.klines}}),/UNEXPECTED_INDEX_CODE/);
assert.throws(()=>core.parseEastmoneyResponse({data:{code:'000852',name:'错误标的',klines:eastmoneyPayload().data.klines}}),/UNEXPECTED_INDEX_NAME/);
assert.throws(()=>core.validateDataset({indexCode:'000852',items:items(199)}),/INSUFFICIENT_HISTORY/);
const duplicate=items();duplicate[199]={...duplicate[198]};
assert.throws(()=>core.validateDataset({indexCode:'000852',items:duplicate}),/DATES_NOT_STRICTLY_INCREASING/);
const invalidClose=items();invalidClose[199].close=0;
assert.throws(()=>core.validateDataset({indexCode:'000852',items:invalidClose}),/INVALID_CLOSE/);
const invalidDate=items();invalidDate[199].date='2026-99-99';
assert.throws(()=>core.validateDataset({indexCode:'000852',items:invalidDate}),/INVALID_DATE/);
const impossibleDate=items();impossibleDate[199].date='2026-02-30';
assert.throws(()=>core.validateDataset({indexCode:'000852',items:impossibleDate}),/INVALID_DATE/);

const newer=core.validateDataset({indexCode:'000852',source:'MANUAL_DIRECT',items:items(200,'2026-09-11')});
const older=core.validateDataset({indexCode:'000852',source:'GITHUB_AUTO',items:items(200,'2026-09-10')});
assert.throws(()=>core.mergeDatasets(newer,older),/MARKET_DATA_ROLLBACK/);
assert.equal(core.latestDate(core.mergeDatasets(older,newer)),'2026-09-11');

const closures=new Set(['2026-09-25']);
const isTradingDay=async date=>{const d=new Date(date+'T00:00:00Z').getUTCDay();return d!==0&&d!==6&&!closures.has(date)};

(async()=>{
  assert.equal(await core.expectedLatestTradingDate('2026-09-11T09:00:00+08:00',isTradingDay),'2026-09-10');
  assert.equal(await core.expectedLatestTradingDate('2026-09-11T18:30:00+08:00',isTradingDay),'2026-09-11');
  assert.equal(await core.expectedLatestTradingDate('2026-09-12T12:00:00+08:00',isTradingDay),'2026-09-11');
  assert.equal(await core.expectedLatestTradingDate('2026-09-25T20:00:00+08:00',isTradingDay),'2026-09-24');
  assert.equal(await core.nextTradingDay('2026-09-11',isTradingDay),'2026-09-14');
  assert.deepEqual(core.marketStatus(0,'2026-09-11','2026-09-11'),{freshness:'FRESH',latestStatus:'LATEST',latestStatusText:'行情最新',decisionReady:true});
  assert.deepEqual(core.marketStatus(1,'2026-09-10','2026-09-11'),{freshness:'FRESH',latestStatus:'DELAYED',latestStatusText:'更新延迟1个交易日',decisionReady:false});

  const providerSource=fs.readFileSync(path.join(__dirname,'..','market-provider.js'),'utf8');
assert.match(providerSource,/method:'GET'/);
assert.match(providerSource,/credentials:'omit'/);
assert.match(providerSource,/csi1000-history\.json\?refresh=/);
assert.doesNotMatch(providerSource,/body\s*:/);
for(const source of ['MANUAL_DIRECT','GITHUB_AUTO','LOCAL_CACHE']) assert.match(providerSource,new RegExp(source));

  async function runProvider({directOk,staticOk,initial,directHangs=false}){
    let saved=initial?{id:'csi1000-history',...initial}:null;
    const sandbox={console,URLSearchParams,Date,Intl,Map,Error,AbortController,setTimeout,clearTimeout,window:{MARKET_REQUEST_TIMEOUT_MS:5,MarketDataCore:core,StrategyCore:strategy,MarketStorage:{get:async()=>saved,put:async value=>{saved=value}}}};
    sandbox.fetch=async (url,options={})=>{
      const direct=String(url).includes('push2his.eastmoney.com');
      if(direct&&directHangs)return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('ABORTED')),{once:true}));
      if((direct&&!directOk)||(!direct&&!staticOk)) throw new Error('NETWORK_FAIL');
      return {ok:true,json:async()=>direct?eastmoneyPayload():({indexCode:'000852',fetchedAt:'2026-09-11T10:00:00Z',items:items()})};
    };
    vm.runInNewContext(providerSource,sandbox);
    return {result:await sandbox.window.MarketProvider.refresh(),saved};
  }

  let scenario=await runProvider({directOk:true,staticOk:true,initial:older});
  assert.equal(scenario.result.outcome,'MANUAL_DIRECT');
  assert.equal(scenario.saved.source,'MANUAL_DIRECT');
  scenario=await runProvider({directOk:false,staticOk:true,initial:older});
  assert.equal(scenario.result.outcome,'GITHUB_AUTO');
  assert.equal(scenario.saved.source,'GITHUB_AUTO');
  scenario=await runProvider({directOk:false,staticOk:false,initial:newer});
  assert.equal(scenario.result.outcome,'LOCAL_CACHE');
  assert.equal(scenario.saved.source,'MANUAL_DIRECT');
  scenario=await runProvider({directOk:false,directHangs:true,staticOk:true,initial:older});
  assert.equal(scenario.result.outcome,'GITHUB_AUTO');

  console.log('market-data-core: all channel and calendar checks passed');
})().catch(error=>{console.error(error);process.exitCode=1});
