// Service Worker — кэширует все файлы приложения при первом открытии.
// После этого приложение работает полностью без интернета.

const CACHE_NAME = 'montazh-cache-v1';
const FILES_TO_CACHE = [
  './',
  './index.html',
  './app.js',
  './manifest.json'
];

self.addEventListener('install', (event)=>{
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache=>cache.addAll(FILES_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event)=>{
  event.waitUntil(
    caches.keys().then(keys=>
      Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event)=>{
  event.respondWith(
    caches.match(event.request).then(cached=>{
      if(cached) return cached;
      return fetch(event.request).then(response=>{
        // cache new resources on the fly (e.g. engine files added later)
        if(response && response.status === 200 && event.request.method === 'GET'){
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache=>cache.put(event.request, clone));
        }
        return response;
      }).catch(()=>cached);
    })
  );
});