// ============================================
// SERVIÇO DE BANCO DE DADOS
// ============================================

export class DatabaseService {
    constructor() {
        this.db = db;
        this.cache = new Map();
        this.cacheExpiry = 5 * 60 * 1000; // 5 minutos
    }

    // ===== ARTIGOS =====
    
    async getArticle(articleId) {
        const cacheKey = `article_${articleId}`;
        const cached = this.getCache(cacheKey);
        if (cached) return cached;
        
        try {
            const doc = await this.db.collection('articles').doc(articleId).get();
            if (!doc.exists) return null;
            
            const data = { id: doc.id, ...doc.data() };
            this.setCache(cacheKey, data);
            return data;
            
        } catch (error) {
            console.error('Erro ao buscar artigo:', error);
            throw error;
        }
    }

    async getArticleBySlug(slug) {
        try {
            const snapshot = await this.db.collection('articles')
                .where('slug', '==', slug)
                .limit(1)
                .get();
            
            if (snapshot.empty) return null;
            
            const doc = snapshot.docs[0];
            return { id: doc.id, ...doc.data() };
            
        } catch (error) {
            console.error('Erro ao buscar artigo por slug:', error);
            throw error;
        }
    }

    async getArticles(options = {}) {
        try {
            let query = this.db.collection('articles');
            
            // Filtros
            if (options.status) {
                query = query.where('status', '==', options.status);
            } else {
                query = query.where('status', '==', 'published');
            }
            
            if (options.category) {
                query = query.where('categories', 'array-contains', options.category);
            }
            
            if (options.author) {
                query = query.where('author.uid', '==', options.author);
            }
            
            // Ordenação
            if (options.sortBy) {
                query = query.orderBy(options.sortBy, options.sortOrder || 'desc');
            } else {
                query = query.orderBy('created_at', 'desc');
            }
            
            // Limite
            if (options.limit) {
                query = query.limit(options.limit);
            }
            
            const snapshot = await query.get();
            const articles = [];
            snapshot.forEach(doc => {
                articles.push({ id: doc.id, ...doc.data() });
            });
            
            return articles;
            
        } catch (error) {
            console.error('Erro ao buscar artigos:', error);
            throw error;
        }
    }

    async createArticle(data) {
        try {
            // Gerar slug
            const slug = this.generateSlug(data.title);
            
            // Verificar slug único
            const existing = await this.getArticleBySlug(slug);
            if (existing) {
                throw new Error('Já existe um artigo com este título. Por favor, escolha outro.');
            }
            
            const articleData = {
                ...data,
                slug: slug,
                status: data.status || 'draft',
                version: 1,
                views: 0,
                likes: 0,
                shares: 0,
                created_at: firebase.firestore.FieldValue.serverTimestamp(),
                updated_at: firebase.firestore.FieldValue.serverTimestamp()
            };
            
            const docRef = await this.db.collection('articles').add(articleData);
            
            // Criar revisão inicial
            await this.createRevision(docRef.id, {
                content: data.content,
                changes_summary: 'Criação do artigo',
                editor: data.author
            });
            
            // Atualizar contagem do autor
            await this.incrementUserContributions(data.author.uid);
            
            return { id: docRef.id, ...articleData };
            
        } catch (error) {
            console.error('Erro ao criar artigo:', error);
            throw error;
        }
    }

    async updateArticle(articleId, data) {
        try {
            // Buscar artigo atual
            const current = await this.getArticle(articleId);
            if (!current) {
                throw new Error('Artigo não encontrado');
            }
            
            // Se mudou o título, atualizar slug
            let updateData = { ...data };
            if (data.title && data.title !== current.title) {
                const newSlug = this.generateSlug(data.title);
                const existing = await this.getArticleBySlug(newSlug);
                if (existing && existing.id !== articleId) {
                    throw new Error('Já existe um artigo com este título.');
                }
                updateData.slug = newSlug;
            }
            
            updateData.updated_at = firebase.firestore.FieldValue.serverTimestamp();
            updateData.version = (current.version || 0) + 1;
            
            await this.db.collection('articles').doc(articleId).update(updateData);
            
            // Criar nova revisão
            if (data.content && data.content !== current.content) {
                await this.createRevision(articleId, {
                    content: data.content,
                    changes_summary: data.edit_summary || 'Edição',
                    editor: data.last_editor || data.author
                });
            }
            
            // Limpar cache
            this.clearCache(`article_${articleId}`);
            
            return await this.getArticle(articleId);
            
        } catch (error) {
            console.error('Erro ao atualizar artigo:', error);
            throw error;
        }
    }

    async deleteArticle(articleId, hardDelete = false) {
        try {
            if (hardDelete) {
                // Excluir permanentemente
                await this.db.collection('articles').doc(articleId).delete();
                
                // Excluir revisões
                const revisions = await this.db.collection('revisions')
                    .doc(articleId)
                    .collection('versions')
                    .get();
                
                const batch = this.db.batch();
                revisions.forEach(doc => batch.delete(doc.ref));
                await batch.commit();
                
            } else {
                // Soft delete - apenas arquivar
                await this.db.collection('articles').doc(articleId).update({
                    status: 'deleted',
                    deleted_at: firebase.firestore.FieldValue.serverTimestamp()
                });
            }
            
            this.clearCache(`article_${articleId}`);
            
        } catch (error) {
            console.error('Erro ao excluir artigo:', error);
            throw error;
        }
    }

    // ===== REVISÕES =====

    async createRevision(articleId, data) {
        try {
            const version = await this.getNextVersion(articleId);
            
            await this.db.collection('revisions')
                .doc(articleId)
                .collection('versions')
                .add({
                    version: version,
                    ...data,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp()
                });
            
            return version;
            
        } catch (error) {
            console.error('Erro ao criar revisão:', error);
            throw error;
        }
    }

    async getNextVersion(articleId) {
        try {
            const snapshot = await this.db.collection('revisions')
                .doc(articleId)
                .collection('versions')
                .orderBy('version', 'desc')
                .limit(1)
                .get();
            
            if (snapshot.empty) return 1;
            return snapshot.docs[0].data().version + 1;
            
        } catch (error) {
            console.error('Erro ao obter próxima versão:', error);
            return 1;
        }
    }

    async getRevisions(articleId, limit = 50) {
        try {
            const snapshot = await this.db.collection('revisions')
                .doc(articleId)
                .collection('versions')
                .orderBy('version', 'desc')
                .limit(limit)
                .get();
            
            const revisions = [];
            snapshot.forEach(doc => {
                revisions.push({ id: doc.id, ...doc.data() });
            });
            
            return revisions;
            
        } catch (error) {
            console.error('Erro ao buscar revisões:', error);
            throw error;
        }
    }

    // ===== CATEGORIAS =====

    async getCategories() {
        try {
            const snapshot = await this.db.collection('categories')
                .orderBy('name')
                .get();
            
            const categories = [];
            snapshot.forEach(doc => {
                categories.push({ id: doc.id, ...doc.data() });
            });
            
            return categories;
            
        } catch (error) {
            console.error('Erro ao buscar categorias:', error);
            throw error;
        }
    }

    async createCategory(data) {
        try {
            const slug = this.generateSlug(data.name);
            
            const categoryData = {
                ...data,
                slug: slug,
                articles_count: 0,
                created_at: firebase.firestore.FieldValue.serverTimestamp()
            };
            
            const docRef = await this.db.collection('categories').add(categoryData);
            return { id: docRef.id, ...categoryData };
            
        } catch (error) {
            console.error('Erro ao criar categoria:', error);
            throw error;
        }
    }

    // ===== USUÁRIOS =====

    async getUserProfile(uid) {
        try {
            const doc = await this.db.collection('users').doc(uid).get();
            if (!doc.exists) return null;
            return { uid, ...doc.data() };
            
        } catch (error) {
            console.error('Erro ao buscar perfil:', error);
            throw error;
        }
    }

    async updateUserProfile(uid, data) {
        try {
            await this.db.collection('users').doc(uid).update({
                ...data,
                updated_at: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            this.clearCache(`user_${uid}`);
            
        } catch (error) {
            console.error('Erro ao atualizar perfil:', error);
            throw error;
        }
    }

    async incrementUserContributions(uid) {
        try {
            await this.db.collection('users').doc(uid).update({
                contributions: firebase.firestore.FieldValue.increment(1),
                last_active: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch (error) {
            console.error('Erro ao incrementar contribuições:', error);
        }
    }

    async incrementArticleViews(articleId) {
        try {
            await this.db.collection('articles').doc(articleId).update({
                views: firebase.firestore.FieldValue.increment(1)
            });
            
            this.clearCache(`article_${articleId}`);
            
        } catch (error) {
            console.error('Erro ao incrementar visualizações:', error);
        }
    }

    // ===== BUSCA =====

    async searchArticles(query, options = {}) {
        try {
            // Busca básica usando Firebase
            let results = [];
            const searchTerms = query.toLowerCase().split(' ').filter(t => t.length > 1);
            
            if (searchTerms.length === 0) return [];
            
            // Buscar por título
            const titleQuery = this.db.collection('articles')
                .where('status', '==', 'published');
            
            const snapshot = await titleQuery.get();
            
            snapshot.forEach(doc => {
                const data = doc.data();
                const title = data.title.toLowerCase();
                const content = data.content.toLowerCase();
                
                // Pontuação de relevância
                let score = 0;
                searchTerms.forEach(term => {
                    if (title.includes(term)) score += 10;
                    if (content.includes(term)) score += 1;
                });
                
                if (score > 0) {
                    results.push({
                        id: doc.id,
                        ...data,
                        score: score
                    });
                }
            });
            
            // Ordenar por pontuação
            results.sort((a, b) => b.score - a.score);
            
            // Aplicar limite
            const limit = options.limit || 20;
            return results.slice(0, limit);
            
        } catch (error) {
            console.error('Erro na busca:', error);
            throw error;
        }
    }

    // ===== UTILIDADES =====

    generateSlug(text) {
        return text
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
    }

    getCache(key) {
        const cached = this.cache.get(key);
        if (cached) {
            const now = Date.now();
            if (now - cached.timestamp < this.cacheExpiry) {
                return cached.data;
            }
            this.cache.delete(key);
        }
        return null;
    }

    setCache(key, data) {
        this.cache.set(key, {
            data: data,
            timestamp: Date.now()
        });
    }

    clearCache(key) {
        if (key) {
            this.cache.delete(key);
        } else {
            this.cache.clear();
        }
    }

    // ===== MIGRAÇÃO =====

    async migrateFromOldStructure() {
        try {
            console.log('🔄 Iniciando migração de dados...');
            
            // Buscar dados antigos
            const oldDocs = await this.db.collection('documentos').get();
            let migrated = 0;
            
            for (const doc of oldDocs.docs) {
                const oldData = doc.data();
                const articles = await doc.ref.collection('inevitavel').get();
                
                // Criar novo artigo para cada artigo antigo
                for (const article of articles.docs) {
                    const articleData = article.data();
                    
                    const newArticle = {
                        title: articleData.titulo || oldData.titulo || 'Sem título',
                        slug: this.generateSlug(articleData.titulo || oldData.titulo || 'sem-titulo'),
                        content: articleData.descricao || '',
                        summary: articleData.resumo || '',
                        categories: [oldData.categoria || 'Geral'],
                        tags: [],
                        status: 'published',
                        author: {
                            uid: articleData.criadorUid || 'unknown',
                            name: articleData.criadorNome || 'Desconhecido',
                            email: articleData.criadorEmail || ''
                        },
                        created_at: articleData.dataCriacao || firebase.firestore.FieldValue.serverTimestamp(),
                        updated_at: articleData.ultimaEdicao || firebase.firestore.FieldValue.serverTimestamp()
                    };
                    
                    await this.createArticle(newArticle);
                    migrated++;
                }
            }
            
            console.log(`✅ Migração concluída! ${migrated} artigos migrados.`);
            return { migrated };
            
        } catch (error) {
            console.error('❌ Erro na migração:', error);
            throw error;
        }
    }
}
