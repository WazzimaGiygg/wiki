// ============================================
// SISTEMA DE BUSCA AVANÇADA
// ============================================

class SearchEngine {
    constructor() {
        this.initialized = false;
        this.index = null;
        this.workers = [];
    }
    
    async init() {
        if (this.initialized) return;
        
        // Usar IndexedDB para busca local
        this.index = await this.initIndexedDB();
        this.initialized = true;
        
        console.log('🔍 Motor de busca inicializado');
    }
    
    async initIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('WikiZeroSearch', 1);
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                const store = db.createObjectStore('articles', { keyPath: 'id' });
                store.createIndex('title', 'title', { unique: false });
                store.createIndex('content', 'content', { unique: false });
                store.createIndex('category', 'categories', { unique: false });
            };
            
            request.onsuccess = (event) => {
                resolve(event.target.result);
            };
            
            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }
    
    async indexArticle(article) {
        const transaction = this.index.transaction('articles', 'readwrite');
        const store = transaction.objectStore('articles');
        
        // Processar texto para busca
        const processed = {
            id: article.id,
            title: article.title,
            content: this.processText(article.content),
            categories: article.categories,
            tags: article.tags,
            summary: article.summary
        };
        
        store.put(processed);
        return transaction.complete;
    }
    
    async search(query, options = {}) {
        if (!query || query.length < 2) {
            return [];
        }
        
        const processedQuery = this.processText(query);
        const results = [];
        
        const transaction = this.index.transaction('articles', 'readonly');
        const store = transaction.objectStore('articles');
        
        // Buscar por título e conteúdo
        const titleIndex = store.index('title');
        const contentIndex = store.index('content');
        
        // Buscar por título (prioridade alta)
        let titleResults = [];
        const titleRange = IDBKeyRange.bound(
            processedQuery,
            processedQuery + '\uffff'
        );
        
        for await (const cursor of titleIndex.iterate(titleRange)) {
            titleResults.push({
                ...cursor.value,
                score: 100 - (cursor.value.title.toLowerCase().indexOf(processedQuery) * 2)
            });
        }
        
        // Buscar por conteúdo
        let contentResults = [];
        const contentRange = IDBKeyRange.bound(
            processedQuery,
            processedQuery + '\uffff'
        );
        
        for await (const cursor of contentIndex.iterate(contentRange)) {
            const existing = contentResults.find(r => r.id === cursor.value.id);
            if (!existing) {
                contentResults.push({
                    ...cursor.value,
                    score: 50
                });
            }
        }
        
        // Mesclar e ordenar resultados
        const allResults = [...titleResults, ...contentResults];
        const uniqueResults = this.deduplicateResults(allResults);
        
        // Aplicar filtros
        let filtered = uniqueResults;
        if (options.category) {
            filtered = filtered.filter(r => 
                r.categories && r.categories.includes(options.category)
            );
        }
        
        if (options.tags) {
            filtered = filtered.filter(r => 
                r.tags && options.tags.some(tag => r.tags.includes(tag))
            );
        }
        
        // Ordenar por relevância
        filtered.sort((a, b) => (b.score || 0) - (a.score || 0));
        
        // Limitar resultados
        const limit = options.limit || 20;
        return filtered.slice(0, limit);
    }
    
    processText(text) {
        return text
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }
    
    deduplicateResults(results) {
        const seen = new Set();
        return results.filter(r => {
            if (seen.has(r.id)) return false;
            seen.add(r.id);
            return true;
        });
    }
}

// Exportar singleton
export const searchEngine = new SearchEngine();
