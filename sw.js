const CACHE='csi1000-pwa-v1.0.3';
const ASSETS=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./strategy-core.js','./market-provider.js','./trading-calendar-2026.json','./data/csi1000-history.json'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET') return;
  const url=new URL(e.request.url);
  if(e.request.mode==='navigate'){
    e.respondWith(fetch(e.request).then(resp=>{if(resp.ok)caches.open(CACHE).then(c=>c.put('./index.html',resp.clone()));return resp}).catch(()=>caches.match('./index.html')));
    return;
  }
  if(url.pathname.endsWith('/data/csi1000-history.json')){
    e.respondWith(fetch(e.request).then(resp=>{if(resp.ok)caches.open(CACHE).then(c=>c.put(e.request,resp.clone()));return resp}).catch(()=>caches.match(e.request)));
    return;
  }
  e.respondWith(caches.match(e.request).then(cached=>cached||fetch(e.request).then(resp=>{if(resp.ok)caches.open(CACHE).then(c=>c.put(e.request,resp.clone()));return resp})));
});
