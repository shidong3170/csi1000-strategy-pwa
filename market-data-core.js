(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  root.MarketDataCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const INDEX_CODE='000852';
  const INDEX_NAME='中证1000';
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
    if(todayTrading&&clock.minutes>=CUT_OFF_MINUTES) return clock.date;
    return previousTradingDay(clock.date,isTradingDay);
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

  function marketStatus(distance,asOfDate,expectedDate){
    if(!Number.isInteger(distance)||distance<0||!expectedDate) return {freshness:'UNKNOWN',latestStatus:'UNKNOWN',latestStatusText:'无法判断',decisionReady:false};
    if(distance===0) return {freshness:'FRESH',latestStatus:'LATEST',latestStatusText:'行情最新',decisionReady:true};
    if(distance<=3) return {freshness:'FRESH',latestStatus:'DELAYED',latestStatusText:`更新延迟${distance}个交易日`,decisionReady:false};
    if(distance<=7) return {freshness:'AGING',latestStatus:'AGING',latestStatusText:`行情偏旧（${distance}个交易日）`,decisionReady:false};
    return {freshness:'STALE',latestStatus:'STALE',latestStatusText:`行情已过期（${distance}个交易日）`,decisionReady:false};
  }

  return {INDEX_CODE,INDEX_NAME,CUT_OFF_MINUTES,normalizeItems,validateDataset,parseEastmoneyResponse,latestDate,mergeDatasets,calculateMetrics,addDays,beijingClock,previousTradingDay,nextTradingDay,expectedLatestTradingDate,tradingDayDistance,marketStatus};
});
