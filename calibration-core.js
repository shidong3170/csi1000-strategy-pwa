(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  root.CalibrationCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  function snapshotTime(x){return String(x?.snapshotAt||x?.snapshotDate||'')}
  function sortNewestFirst(rows){return [...(rows||[])].sort((a,b)=>snapshotTime(b).localeCompare(snapshotTime(a)))}
  function latestValidCalibration(rows){return sortNewestFirst(rows).find(x=>!x.voided)||null}
  function daysBetween(a,b){
    const start=Date.parse(String(a).slice(0,10)+'T00:00:00Z');
    const end=Date.parse(String(b).slice(0,10)+'T00:00:00Z');
    return Number.isFinite(start)&&Number.isFinite(end)?Math.max(0,Math.floor((end-start)/86400000)):null;
  }
  function freshness(snapshotDate,asOfDate){
    if(!snapshotDate)return {code:'MISSING',days:null,label:'待人工校准'};
    const days=daysBetween(snapshotDate,asOfDate);
    if(days===null)return {code:'UNKNOWN',days:null,label:'日期异常'};
    if(days<=7)return {code:'FRESH',days,label:'数据新鲜'};
    if(days<=14)return {code:'DUE',days,label:'建议更新'};
    return {code:'STALE',days,label:'数据过期'};
  }
  function impliedNav(snapshot){
    if(!snapshot||!Number.isFinite(snapshot.fundMarketValueCent)||snapshot.fundMarketValueCent<0)return null;
    if(!Number.isFinite(snapshot.totalSharesMicro)||snapshot.totalSharesMicro<=0)return null;
    return Math.round((snapshot.fundMarketValueCent/100)/(snapshot.totalSharesMicro/1e6)*1e6);
  }
  function buildBasis(rows,options={}){
    const snapshot=latestValidCalibration(rows),fresh=freshness(snapshot?.snapshotDate,options.today);
    if(!snapshot)return {status:'MISSING',snapshot:null,freshness:fresh,marketAsOfDate:options.marketAsOfDate||null};
    const navScaled=impliedNav(snapshot),abnormal=navScaled===null;
    const cashPoolCent=Number(options.cashPoolCent)||0;
    return {status:abnormal?'ABNORMAL':'OK',snapshot,freshness:fresh,
      fundMarketValueCent:snapshot.fundMarketValueCent,totalSharesMicro:snapshot.totalSharesMicro,
      impliedNavScaled:navScaled,strategyTotalAssetsCent:snapshot.fundMarketValueCent+cashPoolCent,
      cashPoolCent,marketAsOfDate:options.marketAsOfDate||null};
  }
  function buildPrincipalChanges(baseline,cycles,trades){
    const events=[];
    if(baseline&&Number.isFinite(baseline.takeoverInMarketPrincipalCent))events.push({
      id:'baseline',date:baseline.takeoverDate||baseline.strategyStartDate,type:'TAKEOVER_OPENING',label:'接管期初本金',
      deltaCent:baseline.takeoverInMarketPrincipalCent,createdAt:baseline.createdAt||'',order:0
    });
    for(const x of cycles||[])if(!x.voided&&x.status==='EXECUTED')events.push({
      id:x.id,date:x.scheduledDate,type:'INVESTMENT_CYCLE',label:'定投执行',deltaCent:Number(x.actualAmountCent)||0,createdAt:x.createdAt||'',order:1
    });
    for(const x of trades||[])if(!x.voided&&x.type==='MANUAL_BUY')events.push({
      id:x.id,date:x.tradeDate,type:x.type,label:'手动买入',deltaCent:Number(x.amountCent)||0,createdAt:x.createdAt||'',order:2
    });
    for(const x of trades||[])if(!x.voided&&x.type==='MANUAL_REDEEM')events.push({
      id:x.id,date:x.tradeDate,type:x.type,label:'止盈赎回退出本金',deltaCent:-(Number(x.exitedPrincipalCent)||0),createdAt:x.createdAt||'',order:3
    });
    events.sort((a,b)=>String(a.date).localeCompare(String(b.date))||a.order-b.order||a.createdAt.localeCompare(b.createdAt)||String(a.id).localeCompare(String(b.id)));
    let running=0;
    for(const x of events){running+=x.deltaCent;x.principalAfterCent=running}
    return events.reverse();
  }
  return {sortNewestFirst,latestValidCalibration,daysBetween,freshness,impliedNav,buildBasis,buildPrincipalChanges};
});
