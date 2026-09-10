
/*
 * GitHub Pages edition:
 * - Trading calendar: local annual JSON.
 * - Market data: ./data/csi1000-history.json updated by GitHub Actions.
 * - All three-factor calculations happen locally in the browser.
 * - No user investment data is uploaded.
 */
(function(){
  const INDEX_CODE='000852';

  async function loadCalendar(year){
    try{
      const r=await fetch(`./trading-calendar-${year}.json`,{cache:'no-cache'});
      if(!r.ok) throw new Error('calendar unavailable');
      return await r.json();
    }catch(e){
      return null;
    }
  }

  window.TradingCalendarProvider={
    async isTradingDay(date){
      const d=new Date(date+'T00:00:00');
      const cal=await loadCalendar(d.getFullYear());
      if(!cal) return null; // Frozen rule: no reliable calendar => unknown, never guess.
      const dow=d.getDay();
      if(dow===0||dow===6) return false;
      return !Object.prototype.hasOwnProperty.call(cal.closures||{},date);
    }
  };

  function candidate(drawdownBp,posBp,belowMA){
    if(drawdownBp>=3000 && posBp<=2000 && belowMA) return 30000;
    if(drawdownBp>=2000 && posBp<=3000) return 20000;
    if(drawdownBp>=1000 && (posBp<=4000 || belowMA)) return 15000;
    return 10000;
  }

  async function getTradingDayDistance(lastDate){
    // Prefer the local official calendar for the latest known year.
    const today = new Date().toISOString().slice(0,10);
    const start = new Date(lastDate+'T00:00:00');
    const end = new Date(today+'T00:00:00');
    let d = new Date(start), count = 0;
    d.setDate(d.getDate()+1);
    while(d<=end){
      const iso=d.toISOString().slice(0,10);
      const trading=await window.TradingCalendarProvider.isTradingDay(iso);
      if(trading===null) return null;
      if(trading) count++;
      d.setDate(d.getDate()+1);
    }
    return count;
  }

  window.MarketProvider={
    async getThreeFactorStatus(){
      let data;
      try{
        const r=await fetch('./data/csi1000-history.json',{cache:'no-cache'});
        if(!r.ok) throw new Error('history '+r.status);
        data=await r.json();
      }catch(e){
        return {available:false,freshness:'MISSING',candidateCent:null,reason:'本地公开行情JSON不可用'};
      }

      const items=(data.items||[])
        .filter(x=>x.date&&Number(x.close)>0)
        .sort((a,b)=>a.date.localeCompare(b.date));

      if(items.length<200){
        return {available:false,freshness:'MISSING',candidateCent:null,reason:'历史行情不足200个交易日'};
      }

      const cur=items[items.length-1];
      const last250=items.slice(-250);
      const max250=Math.max(...last250.map(x=>Number(x.close)));
      const drawdownBp=Math.round((1-Number(cur.close)/max250)*10000);

      // Approximately 3 trading years; if more exists, use latest 756 observations.
      const approx3y=items.slice(-756);
      const min3=Math.min(...approx3y.map(x=>Number(x.close)));
      const max3=Math.max(...approx3y.map(x=>Number(x.close)));
      if(max3===min3){
        return {available:false,freshness:'MISSING',candidateCent:null,reason:'3年区间异常'};
      }
      const posBp=Math.round((Number(cur.close)-min3)/(max3-min3)*10000);

      const ma200=items.slice(-200).reduce((s,x)=>s+Number(x.close),0)/200;
      const belowMA200=Number(cur.close)<ma200;

      let dist;
      try{ dist=await getTradingDayDistance(cur.date); }
      catch(e){ dist=999; }

      const freshness=window.StrategyCore?window.StrategyCore.marketFreshness(dist):(dist==null?'UNKNOWN':dist<=3?'FRESH':dist<=7?'AGING':'STALE');

      return {
        available:true,
        freshness,
        candidateCent:(freshness==='STALE'||freshness==='UNKNOWN')?10000:candidate(drawdownBp,posBp,belowMA200),
        drawdownBp,
        threeYearPositionBp:posBp,
        belowMA200,
        asOfDate:cur.date,
        indexCode:INDEX_CODE,
        source:data.source||'eastmoney'
      };
    }
  };
})();
