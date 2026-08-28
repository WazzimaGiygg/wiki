// ============================================
// SERVICE WORKER - WIKIZERO 2.0
// ============================================

const CACHE_NAME = 'wikizero-v2';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/css/main.css',
    '/css/themes/light.css',
    '/css/themes/dark.css',
    '/css/themes/sepia.css',
    '/js/app.js',
    '/js/core/auth.js',
    '/js/core/database.js',
    '/js/core/router.js',
    '/js/core/state.js',
    '/js/modules/articles.js',
    '/js/modules/categories.js',
    '/js/modules/moderation.js',
    '/js/modules/editor.js',
    '/js/utils/parser.js',
    '/js/utils/validator.js',
    '/js/utils/helpers.js',
    '/images/logo.svg',
    '/favicon.ico'
];

const API_ROUTES = [
    '/api/articles',
    '/api/categories',
    '/api/users',
    '/api/search'
];

// ===== INSTALAÇÃO =====
self.addEventListener('install', (event) => {
    console.log('📦 Service Worker: Instalando...');
    
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('📦 Cacheando assets...');
                return cache.addAll(STATIC_ASSETS);
            })
            .then(() => {
                console.log('✅ Assets cacheados com sucesso!');
                return self.skipWaiting();
            })
    );
});

// ===== ATIVAÇÃO =====
self.addEventListener('activate', (event) => {
    console.log('⚡ Service Worker: Ativando...');
    
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames
                        .filter((name) => name !== CACHE_NAME)
                        .map((name) => {
                            console.log(`🗑️ Removendo cache antigo: ${name}`);
                            return caches.delete(name);
                        })
                );
            })
            .then(() => {
                console.log('✅ Service Worker ativado!');
                return self.clients.claim();
            })
    );
});

// ===== INTERCEPTAÇÃO DE REQUISIÇÕES =====
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    
    // Estratégia: Cache First para assets estáticos
    if (STATIC_ASSETS.some(asset => url.pathname === asset)) {
        event.respondWith(
            caches.match(event.request)
                .then((response) => {
                    if (response) {
                        return response;
                    }
                    
                    // Fallback para network
                    return fetch(event.request)
                        .then((response) => {
                            const responseClone = response.clone();
                            caches.open(CACHE_NAME)
                                .then((cache) => {
                                    cache.put(event.request, responseClone);
                                });
                            return response;
                        });
                })
                .catch(() => {
                    // Fallback para offline
                    if (url.pathname === '/') {
                        return caches.match('/offline.html');
                    }
                })
        );
        return;
    }
    
    // Estratégia: Network First para API
    if (API_ROUTES.some(route => url.pathname.startsWith(route))) {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME)
                        .then((cache) => {
                            cache.put(event.request, responseClone);
                        });
                    return response;
                })
                .catch(() => {
                    return caches.match(event.request);
                })
        );
        return;
    }
    
    // Estratégia: Network Only para o resto
    event.respondWith(
        fetch(event.request)
            .catch(() => {
                return new Response('Offline', {
                    status: 503,
                    statusText: 'Service Unavailable'
                });
            })
    );
});

// ===== GERENCIAMENTO DE NOTIFICAÇÕES =====
self.addEventListener('push', (event) => {
    const data = event.data.json();
    
    const options = {
        body: data.body || 'Nova notificação da WikiZero',
        icon: '/images/icon-192.png',
        badge: '/images/badge-72.png',
        vibrate: [200, 100, 200],
        data: {
            url: data.url || '/',
            articleId: data.articleId || null
        },
        actions: [
            {
                action: 'open',
                title: '🔍 Ver agora'
            },
            {
                action: 'close',
                title: '❌ Fechar'
            }
        ]
    };
    
    event.waitUntil(
        self.registration.showNotification(
            data.title || 'WikiZero',
            options
        )
    );
});

// ===== CLIQUE EM NOTIFICAÇÃO =====
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    
    if (event.action === 'close') {
        return;
    }
    
    const url = event.notification.data?.url || '/';
    
    event.waitUntil(
        clients.matchAll({ type: 'window' })
            .then((windowClients) => {
                // Verificar se já existe uma janela aberta
                for (const client of windowClients) {
                    if (client.url === url && 'focus' in client) {
                        return client.focus();
                    }
                }
                
                // Abrir nova janela
                if (clients.openWindow) {
                    return clients.openWindow(url);
                }
            })
    );
});

// ===== SINCERONIZAÇÃO EM BACKGROUND =====
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-articles') {
        event.waitUntil(
            // Sincronizar artigos pendentes
            syncPendingArticles()
        );
    }
});

async function syncPendingArticles() {
    try {
        const cache = await caches.open(CACHE_NAME);
        const requests = await cache.keys();
        
        for (const request of requests) {
            if (request.url.includes('/api/articles')) {
                const response = await cache.match(request);
                if (response) {
                    const data = await response.json();
                    // Enviar para o servidor
                    await fetch(request.url, {
                        method: request.method,
                        headers: request.headers,
                        body: JSON.stringify(data)
                    });
                    await cache.delete(request);
                }
            }
        }
    } catch (error) {
        console.error('Erro na sincronização:', error);
    }
}

console.log('📱 Service Worker carregado!');
