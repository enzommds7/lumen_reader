const CACHE='lumen-reader-shell-v1.1.0';
const APP=['./','./index.html','./style.css','./manifest.webmanifest','./js/app.js','./js/db.js','./js/pdf.js','./assets/icon-192.png','./assets/icon-180.png','./assets/icon-512.png','./assets/icon.svg','./demo/lumen-demonstracao.pdf'];
const PDF_CDN=['https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs','https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs'];
self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);
    await cache.addAll(APP);
    await Promise.allSettled(PDF_CDN.map(url=>cache.add(url)));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{for(const key of await caches.keys())if(key!==CACHE)await caches.delete(key);await self.clients.claim();})());});
self.addEventListener('fetch',event=>{
  const req=event.request;if(req.method!=='GET')return;
  const url=new URL(req.url);const isOurOrigin=url.origin===self.location.origin;
  if(!isOurOrigin && !PDF_CDN.includes(req.url))return;
  if(isOurOrigin && url.pathname.startsWith('/api/'))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    const existing=await cache.match(req);if(existing)return existing;
    try{const response=await fetch(req);if(response.ok)cache.put(req,response.clone());return response;}
    catch(e){if(req.mode==='navigate')return (await cache.match('./index.html'))||Response.error();throw e;}
  })());
});
