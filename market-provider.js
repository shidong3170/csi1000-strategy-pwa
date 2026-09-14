/*
 * Market channels:
 * - MANUAL_DIRECT: user-triggered Eastmoney request.
 * - GITHUB_AUTO: same-origin static JSON maintained by GitHub Actions.
 * - LOCAL_CACHE: last valid dataset persisted in IndexedDB.
 * No investment records or strategy parameters are sent to market providers.
 */
(function(){
  const Core=window.MarketDataCore;
  const STORAGE_ID='csi1000-history';
  const REQUEST_TIMEOUT_MS=Number(window.MARKET_REQUEST_TIMEOUT_MS)||12000;
  const SOURCE_LABELS={MANUAL_DIRECT:'MANUAL_DIRECT · 东方财富手动直连',GITHUB_AUTO:'GITHUB_AUTO · GitHub自动行情',LOCAL_CACHE:'LOCAL_CACHE · 手机本地缓存',MANUAL_DIRECT_REALTIME:'MANUAL_DIRECT_REALTIME · 东方财富实时直连'};
  let sessionDataset=null;
  let sessionRealtimeQuote=null;
  let staticAttempted=false;
  const calendars=new Map();

  async function loadCalendar(year){
    if(calendars.has(year)) return calendars.get(year);
    try{
      const response=await fetch(`./trading-calendar-${year}.json`,{cache:'no-store'});
      if(!response.ok) throw new Error('CALENDAR_UNAVAILABLE');
      const calendar=await response.json();
      if(Number(calendar.calendarYear)!==Number(year)) throw new Error('CALENDAR_YEAR_MISMATCH');
      calendars.set(year,calendar);
      return calendar;
    }catch(error){
      calendars.set(year,null);
      return null;
    }
  }

  async function isTradingDay(date){
    const value=new Date(date+'T00:00:00Z');
    const calendar=await loadCalendar(value.getUTCFullYear());
    if(!calendar) return null;
    const weekday=value.getUTCDay();
    if(weekday===0||weekday===6) return false;
    return !Object.prototype.hasOwnProperty.call(calendar.closures||{},date);
  }

  window.TradingCalendarProvider={isTradingDay};

  function storage(){return window.MarketStorage||null}

  async function readLocal(){
    const adapter=storage();
    if(!adapter) return null;
    try{
      const record=await adapter.get(STORAGE_ID);
      if(!record) return null;
      return Core.validateDataset(record,'LOCAL_CACHE');
    }catch(error){
      return null;
    }
  }

  async function persist(dataset){
    const valid=Core.validateDataset(dataset,dataset.source);
    const adapter=storage();
    if(adapter) await adapter.put({id:STORAGE_ID,...valid,asOfDate:Core.latestDate(valid)});
    sessionDataset=valid;
    return valid;
  }

  async function fetchStatic(){
    const response=await fetchWithTimeout(`./data/csi1000-history.json?refresh=${Date.now()}`,{cache:'no-store'});
    if(!response.ok) throw new Error(`GITHUB_STATIC_HTTP_${response.status}`);
    return Core.validateDataset(await response.json(),'GITHUB_AUTO');
  }

  function eastmoneyUrl(){
    const params=new URLSearchParams({secid:'1.000852',fields1:'f1,f2,f3',fields2:'f51,f52,f53,f54,f55,f56,f57',klt:'101',fqt:'0',end:'20500101',lmt:'1200',ut:'fa5fd1943c7b386f172d6893dbbd1d0c'});
    return `https://push2his.eastmoney.com/api/qt/stock/kline/get?${params}`;
  }

  function eastmoneyRealtimeUrl(){
    const params=new URLSearchParams({secid:'1.000852',fields:'f43,f57,f58,f60,f86,f169,f170',ut:'fa5fd1943c7b386f172d6893dbbd1d0c'});
    return `https://push2.eastmoney.com/api/qt/stock/get?${params}`;
  }

  async function fetchWithTimeout(url,options={}){
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);
    try{return await fetch(url,{...options,signal:controller.signal})}
    finally{clearTimeout(timeout)}
  }

  async function fetchDirect(){
    const response=await fetchWithTimeout(eastmoneyUrl(),{method:'GET',mode:'cors',cache:'no-store',credentials:'omit'});
    if(!response.ok) throw new Error(`MANUAL_DIRECT_HTTP_${response.status}`);
    return Core.parseEastmoneyResponse(await response.json());
  }

  async function fetchRealtime(){
    const response=await fetchWithTimeout(eastmoneyRealtimeUrl(),{method:'GET',mode:'cors',cache:'no-store',credentials:'omit'});
    if(!response.ok) throw new Error(`MANUAL_DIRECT_REALTIME_HTTP_${response.status}`);
    return Core.parseEastmoneyRealtime(await response.json());
  }

  async function onlyCompleted(dataset,now=new Date()){
    const expected=await Core.expectedLatestTradingDate(now,isTradingDay);
    if(!expected) throw new Error('COMPLETED_MARKET_DATE_UNKNOWN');
    return Core.completedDataset(dataset,expected);
  }

  async function syncStatic(local,force=false,now=new Date()){
    if(staticAttempted&&!force) return local;
    staticAttempted=true;
    const incoming=await onlyCompleted(await fetchStatic(),now);
    const merged=Core.mergeDatasets(local,incoming);
    return persist(merged);
  }

  async function resolveDataset(now=new Date()){
    const stored=sessionDataset||await readLocal();
    const local=stored?await onlyCompleted(stored,now):null;
    try{
      const synced=await syncStatic(local,false,now);
      if(synced) return synced;
    }catch(error){
      // A failed or older static payload never replaces a valid local cache.
    }
    if(local) return {...local,source:'LOCAL_CACHE'};
    throw new Error('NO_VALID_MARKET_DATA');
  }

  async function refreshDaily(now=new Date()){
    const stored=sessionDataset||await readLocal();
    const local=stored?await onlyCompleted(stored,now):null;
    try{
      const direct=Core.mergeDatasets(local,await onlyCompleted(await fetchDirect(),now));
      const saved=await persist(direct);
      staticAttempted=true;
      return {outcome:'MANUAL_DIRECT',dataset:saved,message:`已更新至${Core.latestDate(saved)}收盘数据。`};
    }catch(directError){
      try{
        const fallback=await syncStatic(local,true,now);
        return {outcome:'GITHUB_AUTO',dataset:fallback,message:'手动直连失败，已使用GitHub自动行情。',error:directError.message};
      }catch(staticError){
        if(local){
          sessionDataset={...local,source:'LOCAL_CACHE'};
          return {outcome:'LOCAL_CACHE',dataset:sessionDataset,message:'联网行情不可用，已保留本地缓存。',error:`${directError.message}; ${staticError.message}`};
        }
        throw new Error(`NO_VALID_MARKET_DATA: ${directError.message}; ${staticError.message}`);
      }
    }
  }

  async function refresh(options={}){
    const now=options.now||new Date();
    const [quoteResult,dailyResult]=await Promise.allSettled([fetchRealtime(),refreshDaily(now)]);
    const realtime=quoteResult.status==='fulfilled'?(sessionRealtimeQuote=quoteResult.value):(sessionRealtimeQuote=null);
    if(dailyResult.status==='rejected'){
      return {outcome:'DAILY_UNAVAILABLE',dataset:null,message:realtime?'实时指数已更新，但没有可用的完整日K。':'实时指数和完整日K均不可用。',error:dailyResult.reason?.message,realtime:{available:!!realtime,quote:realtime,error:quoteResult.reason?.message}};
    }
    return {...dailyResult.value,realtime:{available:!!realtime,quote:realtime,error:quoteResult.status==='rejected'?quoteResult.reason?.message:null}};
  }

  function getRealtimeQuote(){return sessionRealtimeQuote?{available:true,quote:sessionRealtimeQuote}:{available:false,quote:null,reason:'尚未手动刷新实时指数'}}

  async function getThreeFactorStatus(options={}){
    let dataset;
    const now=options.now||new Date();
    try{dataset=await resolveDataset(now)}
    catch(error){return {available:false,freshness:'MISSING',latestStatus:'MISSING',decisionReady:false,candidateCent:null,reason:'没有可用的中证1000行情'}}
    const expected=await Core.expectedLatestTradingDate(now,isTradingDay);
    const completed=Core.completedDataset(dataset,expected);
    const metrics=Core.calculateMetrics(completed);
    const phase=await Core.marketPhase(now,isTradingDay);
    const distance=await Core.tradingDayDistance(metrics.asOfDate,expected,isTradingDay);
    const status=Core.marketStatus(distance,metrics.asOfDate,expected,phase.phase);
    const rawCandidate=window.StrategyCore.marketCandidateCent(metrics.drawdownBp,metrics.threeYearPositionBp,metrics.belowMA200);
    const recommendationDate=status.decisionReady?await Core.nextTradingDay(metrics.asOfDate,isTradingDay):null;
    return {
      available:true,
      ...metrics,
      ...status,
      candidateCent:status.decisionReady?rawCandidate:10000,
      rawCandidateCent:rawCandidate,
      expectedLatestTradingDate:expected,
      recommendationDate,
      marketPhase:phase.phase,
      indexCode:Core.INDEX_CODE,
      indexName:Core.INDEX_NAME,
      source:dataset.source,
      sourceLabel:SOURCE_LABELS[dataset.source]||dataset.source,
      fetchedAt:dataset.fetchedAt
    };
  }

  window.MarketProvider={getThreeFactorStatus,getRealtimeQuote,refresh,SOURCE_LABELS};
})();
