(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  root.MarketDataCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const INDEX_CODE='000852';
  const INDEX_NAME='中证1000';
  const MARKET_CLOSE_MINUTES=15*60;
  const CUT_OFF_MINUTES=18*60+30;

  function isoDate(value){
    const text=String(value||'');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
    const parsed=new Date(text+'T00:00:00Z');
    return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===text;
  }

  function normalizeItems(items){
    if(!Array.isArray(items)||items.length<200) throw new Error('INSUFFICIENT_HISTORY');
    const out=items.map((item,index)=>{
      const date=String(item?.date||'');
      const close=Number(item?.close);
      if(!isoDate(date)) throw new Error(`INVALID_DATE_${index}`);
      if(!Number.isFinite(close)||close<=0) throw new Error(`INVALID_CLOSE_${index}`);
      return {date,close};
    });
    for(let i=1;i<out.length;i++) if(out[i-1].date>=out[i].date) throw new Error('DATES_NOT_STRICTLY_INCREASING');
    return out;
  }

  function validateDataset(payload,source){
    if(String(payload?.indexCode)!==INDEX_CODE) throw new Error('UNEXPECTED_INDEX_CODE');
    const items=normalizeItems(payload.items);
    return {
      indexCode:INDEX_CODE,
      indexName:payload.indexName||INDEX_NAME,
      source:source||payload.source||'LOCAL_CACHE',
      fetchedAt:payload.fetchedAt||new Date().toISOString(),
      items
    };
  }

  function parseEastmoneyResponse(raw,fetchedAt=new Date().toISOString()){
    const data=raw?.data;
    if(!data||String(data.code)!==INDEX_CODE) throw new Error('UNEXPECTED_INDEX_CODE');
    if(!String(data.name||'').includes(INDEX_NAME)) throw new Error('UNEXPECTED_INDEX_NAME');
    if(!Array.isArray(data.klines)) throw new Error('INVALID_KLINES');
    const items=data.klines.map((line,index)=>{
      const fields=String(line).split(',');
      if(fields.length<3) throw new Error(`INVALID_KLINE_${index}`);
      return {date:fields[0],close:Number(fields[2])};
    });
    return validateDataset({indexCode:INDEX_CODE,indexName:data.name,fetchedAt,items},'MANUAL_DIRECT');
  }

  function parseEastmoneyRealtime(raw,fetchedAt=new Date().toISOString()){
    const data=raw?.data;
    if(!data||String(data.f57)!==INDEX_CODE) throw new Error('UNEXPECTED_REALTIME_INDEX_CODE');
    if(!String(data.f58||'').includes(INDEX_NAME)) throw new Error('UNEXPECTED_REALTIME_INDEX_NAME');
    const current=Number(data.f43)/100,change=Number(data.f169)/100,changePercent=Number(data.f170)/100;
    if(!Number.isFinite(current)||current<=0) throw new Error('INVALID_REALTIME_CURRENT');
    if(!Number.isFinite(change)||!Number.isFinite(changePercent)) throw new Error('INVALID_REALTIME_CHANGE');
    const marketTimestamp=Number(data.f86),marketTime=Number.isFinite(marketTimestamp)&&marketTimestamp>0?new Date(marketTimestamp*1000):null;
    const clock=beijingClock(marketTime||fetchedAt);
    return {indexCode:INDEX_CODE,indexName:data.f58,current,previousClose:Number(data.f60)/100,change,changePercent,
      quoteDate:clock.date,quoteAt:marketTime?marketTime.toISOString():fetchedAt,fetchedAt,source:'MANUAL_DIRECT_REALTIME'};
  }

  function latestDate(dataset){
    return dataset?.items?.length?dataset.items[dataset.items.length-1].date:null;
  }

  function mergeDatasets(existing,incoming){
    const next=validateDataset(incoming,incoming.source);
    if(!existing) return next;
    const current=validateDataset(existing,existing.source||'LOCAL_CACHE');
    if(latestDate(next)<latestDate(current)) throw new Error('MARKET_DATA_ROLLBACK');
    const byDate=new Map(current.items.map(x=>[x.date,x]));
    for(const item of next.items) byDate.set(item.date,item);
    return validateDataset({...next,items:[...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date))},next.source);
  }

  function calculateMetrics(dataset){
    const valid=validateDataset(dataset,dataset.source);
    const items=valid.items,cur=items[items.length-1];
    const last250=items.slice(-250);
    const max250=Math.max(...last250.map(x=>x.close));
    const approx3y=items.slice(-756);
    const min3=Math.min(...approx3y.map(x=>x.close));
    const max3=Math.max(...approx3y.map(x=>x.close));
    if(max3===min3) throw new Error('INVALID_THREE_YEAR_RANGE');
    const ma200=items.slice(-200).reduce((sum,x)=>sum+x.close,0)/200;
    return {
      asOfDate:cur.date,
      close:cur.close,
      drawdownBp:Math.round((1-cur.close/max250)*10000),
      threeYearPositionBp:Math.round((cur.close-min3)/(max3-min3)*10000),
      ma200,
      belowMA200:cur.close<ma200
    };
  }

  function addDays(date,days){
    const value=new Date(date+'T00:00:00Z');
    value.setUTCDate(value.getUTCDate()+days);
    return value.toISOString().slice(0,10);
  }

  function beijingClock(now=new Date()){
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now)).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
    return {date:`${parts.year}-${parts.month}-${parts.day}`,minutes:Number(parts.hour)*60+Number(parts.minute)};
  }

  async function previousTradingDay(date,isTradingDay){
    let cursor=addDays(date,-1);
    for(let i=0;i<370;i++,cursor=addDays(cursor,-1)){
      const trading=await isTradingDay(cursor);
      if(trading===null) return null;
      if(trading) return cursor;
    }
    return null;
  }

  async function nextTradingDay(date,isTradingDay){
    let cursor=addDays(date,1);
    for(let i=0;i<370;i++,cursor=addDays(cursor,1)){
      const trading=await isTradingDay(cursor);
      if(trading===null) return null;
      if(trading) return cursor;
    }
    return null;
  }

  async function expectedLatestTradingDate(now,isTradingDay){
    const clock=beijingClock(now);
    const todayTrading=await isTradingDay(clock.date);
    if(todayTrading===null) return null;
    if(todayTrading&&clock.minutes>=MARKET_CLOSE_MINUTES) return clock.date;
    return previousTradingDay(clock.date,isTradingDay);
  }

  async function marketPhase(now,isTradingDay){
    const clock=beijingClock(now),todayTrading=await isTradingDay(clock.date);
    if(todayTrading===null) return {clock,todayTrading,phase:'UNKNOWN'};
    if(!todayTrading) return {clock,todayTrading,phase:'NON_TRADING'};
    if(clock.minutes<9*60+30) return {clock,todayTrading,phase:'BEFORE_OPEN'};
    if(clock.minutes<MARKET_CLOSE_MINUTES) return {clock,todayTrading,phase:'INTRADAY'};
    if(clock.minutes<CUT_OFF_MINUTES) return {clock,todayTrading,phase:'WAITING_CLOSE'};
    return {clock,todayTrading,phase:'AFTER_CUTOFF'};
  }

  function completedDataset(dataset,latestCompleteDate){
    const valid=validateDataset(dataset,dataset.source);
    if(!isoDate(latestCompleteDate)) throw new Error('INVALID_COMPLETED_CUTOFF');
    return validateDataset({...valid,items:valid.items.filter(x=>x.date<=latestCompleteDate)},valid.source);
  }

  async function tradingDayDistance(fromDate,toDate,isTradingDay){
    if(!isoDate(fromDate)||!isoDate(toDate)||fromDate>toDate) return null;
    let cursor=addDays(fromDate,1),count=0;
    while(cursor<=toDate){
      const trading=await isTradingDay(cursor);
      if(trading===null) return null;
      if(trading) count++;
      cursor=addDays(cursor,1);
    }
    return count;
  }

  function marketStatus(distance,asOfDate,expectedDate,phase='NON_TRADING'){
    if(!Number.isInteger(distance)||distance<0||!expectedDate||phase==='UNKNOWN') return {freshness:'UNKNOWN',latestStatus:'MARKET_DATA_STALE',strategyStatus:'MARKET_DATA_STALE',latestStatusText:'无法可靠判断完整收盘状态',decisionReady:false};
    if(distance>7) return {freshness:'STALE',latestStatus:'MARKET_DATA_STALE',strategyStatus:'MARKET_DATA_STALE',latestStatusText:`行情已过期（${distance}个交易日）`,decisionReady:false};
    if(phase==='WAITING_CLOSE'&&distance===1) return {freshness:'FRESH',latestStatus:'WAITING_TODAY_CLOSE',strategyStatus:'WAITING_TODAY_CLOSE',latestStatusText:'等待今日完整收盘数据',decisionReady:true};
    if(distance>0) return {freshness:distance<=3?'FRESH':'AGING',latestStatus:'MARKET_DATA_DELAYED',strategyStatus:'MARKET_DATA_DELAYED',latestStatusText:`行情更新延迟${distance}个交易日`,decisionReady:false};
    if(phase==='BEFORE_OPEN'||phase==='INTRADAY') return {freshness:'FRESH',latestStatus:'VALID_USING_LAST_COMPLETE_CLOSE',strategyStatus:'VALID_USING_LAST_COMPLETE_CLOSE',latestStatusText:'沿用上一完整交易日收盘',decisionReady:true};
    return {freshness:'FRESH',latestStatus:'VALID',strategyStatus:'VALID',latestStatusText:'最新完整收盘',decisionReady:true};
  }

  return {INDEX_CODE,INDEX_NAME,MARKET_CLOSE_MINUTES,CUT_OFF_MINUTES,normalizeItems,validateDataset,parseEastmoneyResponse,parseEastmoneyRealtime,latestDate,mergeDatasets,calculateMetrics,addDays,beijingClock,previousTradingDay,nextTradingDay,expectedLatestTradingDate,marketPhase,completedDataset,tradingDayDistance,marketStatus};
});
