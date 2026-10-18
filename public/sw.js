// 홈 화면·바탕화면 설치용 최소 서비스워커
// 화면을 따로 저장(캐시)하지 않고 항상 최신 버전을 서버에서 받아옴
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {})
