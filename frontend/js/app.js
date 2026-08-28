// ============================================
// WIKIZERO 2.0 - APLICAÇÃO PRINCIPAL
// ============================================

import { AuthService } from './core/auth.js';
import { DatabaseService } from './core/database.js';
import { Router } from './core/router.js';
import { StateManager } from './core/state.js';
import { ArticleModule } from './modules/articles.js';
import { CategoryModule } from './modules/categories.js';
import { ModerationModule } from './modules/moderation.js';
import { EditorModule } from './modules/editor.js';
import { WikiParser } from './utils/parser.js';
import * as Helpers from './utils/helpers.js';

class WikiZeroApp {
    constructor() {
        // Core
        this.auth = new AuthService();
        this.db = new DatabaseService();
        this.router = new Router();
        this.state = new StateManager();
        this.parser = new WikiParser();
        
        // Modules
        this.articles = new ArticleModule();
        this.categories = new CategoryModule();
        this.moderation = new ModerationModule();
        this.editor = new EditorModule();
        
        // UI
        this.currentView = null;
        this.isLoading = false;
        
        // Bind
        this.render = this.render.bind(this);
        this.handleAuthChange = this.handleAuthChange.bind(this);
    }

    async init() {
        console.log('📚 WikiZero 2.0 - Inicializando...');
        
        try {
            // 1. Inicializar autenticação
            await this.auth.init();
            this.auth.addListener(this.handleAuthChange);
            
            // 2. Configurar rotas
            this.setupRoutes();
            
            // 3. Carregar dados iniciais
            await this.loadInitialData();
            
            // 4. Iniciar roteador
            this.router.init();
            
            // 5. Renderizar página atual
            const path = window.location.pathname;
            await this.router.navigate(path);
            
            // 6. Configurar eventos globais
            this.setupGlobalEvents();
            
            // 7. Atualizar UI
            this.updateUI();
            
            console.log('✅ WikiZero 2.0 iniciada com sucesso!');
            
        } catch (error) {
            console.error('❌ Erro ao iniciar WikiZero:', error);
            this.showError('Erro ao carregar a aplicação. Tente recarregar a página.');
        }
    }

    setupRoutes() {
        // Páginas principais
        this.router.register('/', () => this.renderHome());
        this.router.register('/home', () => this.renderHome());
        
        // Artigos
        this.router.register('/article/:slug', (params) => this.renderArticle(params.slug));
        this.router.register('/edit/:slug', (params) => this.renderEditor(params.slug));
        this.router.register('/create', () => this.renderEditor());
        this.router.register('/history/:id', (params) => this.renderHistory(params.id));
        
        // Categorias
        this.router.register('/category/:slug', (params) => this.renderCategory(params.slug));
        this.router.register('/categories', () => this.renderCategories());
        
        // Usuários
        this.router.register('/user/:uid', (params) => this.renderUserProfile(params.uid));
        this.router.register('/users', () => this.renderUsers());
        
        // Moderação
        this.router.register('/moderation', () => this.renderModeration());
        this.router.register('/reports', () => this.renderReports());
        
        // Busca
        this.router.register('/search', () => this.renderSearch());
        
        // Outros
        this.router.register('/random', () => this.renderRandom());
        this.router.register('/about', () => this.renderAbout());
        this.router.register('/contribute', () => this.renderContribute());
        this.router.register('/privacy', () => this.renderPrivacy());
        this.router.register('/terms', () => this.renderTerms());
        
        // 404
        this.router.register('/404', () => this.render404());
        this.router.register('/error', () => this.renderError());
    }

    async loadInitialData() {
        try {
            this.state.setLoading(true);
            
            // Carregar categorias
            await this.categories.loadCategories();
            this.state.set('categories', this.categories.categories);
            
            // Carregar estatísticas
            const stats = await this.getStats();
            this.state.set('stats', stats);
            
            // Carregar artigos em destaque
            const featured = await this.db.getArticles({
                featured: true,
                limit: 6
            });
            this.state.set('featuredArticles', featured);
            
            // Carregar artigos recentes
            const recent = await this.db.getArticles({
                limit: 10
            });
            this.state.set('recentArticles', recent);
            
        } catch (error) {
            console.error('Erro ao carregar dados iniciais:', error);
        } finally {
            this.state.setLoading(false);
        }
    }

    async getStats() {
        try {
            const articles = await this.db.getArticles({ limit: 1000 });
            const users = await this.db.collection('users').get();
            
            let totalEdits = 0;
            articles.forEach(a => {
                totalEdits += a.version || 1;
            });
            
            return {
                totalArticles: articles.length,
                totalUsers: users.size,
                totalEdits: totalEdits
            };
        } catch (error) {
            return {
                totalArticles: 0,
                totalUsers: 0,
                totalEdits: 0
            };
        }
    }

    // ===== MÉTODOS DE RENDERIZAÇÃO =====
    
    async renderHome() {
        this.currentView = 'home';
        
        const container = document.getElementById('app');
        container.innerHTML = await this.loadTemplate('home', {
            totalArticles: this.state.get('stats')?.totalArticles || 0,
            totalUsers: this.state.get('stats')?.totalUsers || 0,
            totalEdits: this.state.get('stats')?.totalEdits || 0,
            featuredArticles: this.state.get('featuredArticles') || [],
            categories: this.state.get('categories') || [],
            recentArticles: this.state.get('recentArticles') || []
        });
        
        // Adicionar eventos
        this.setupHomeEvents(container);
    }

    async renderArticle(slug) {
        this.currentView = 'article';
        this.state.setLoading(true);
        
        try {
            const result = await this.articles.loadArticle(slug);
            
            if (result.error) {
                await this.router.navigate('/404');
                return;
            }
            
            const { article } = result;
            
            // Verificar se o usuário pode editar
            const user = this.auth.currentUser;
            const canEdit = user && (
                (article.author.uid === user.uid && !article.locked) ||
                await this.auth.hasRole('editor')
            );
            
            const container = document.getElementById('app');
            container.innerHTML = await this.loadTemplate('article', {
                ...article,
                canEdit,
                canModerate: await this.auth.hasRole('moderator')
            });
            
            // Configurar eventos
            this.setupArticleEvents(container, article);
            
            // Atualizar título
            document.title = `${article.title} - WikiZero`;
            
        } catch (error) {
            console.error('Erro ao renderizar artigo:', error);
            this.showError('Erro ao carregar o artigo');
        } finally {
            this.state.setLoading(false);
        }
    }

    async renderEditor(slug = null) {
        this.currentView = 'editor';
        
        const isEdit = !!slug;
        let article = null;
        
        if (isEdit) {
            const result = await this.articles.loadArticle(slug);
            if (!result.error) {
                article = result.article;
            }
        }
        
        const container = document.getElementById('app');
        container.innerHTML = await this.loadTemplate('editor', {
            isEdit,
            article
        });
        
        // Inicializar editor
        const editorContainer = document.getElementById('editor-container');
        if (editorContainer) {
            this.editor.initEditor('editor-container', {
                initialContent: article?.content || '',
                articleId: article?.id,
                autoSave: true,
                onAutoSave: this.handleAutoSave.bind(this)
            });
            
            // Configurar eventos do editor
            this.setupEditorEvents(container, article);
        }
        
        // Configurar formulário
        const form = document.getElementById('article-form');
        if (form) {
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                this.saveArticle(article?.id);
            });
        }
    }

    async renderCategory(slug) {
        this.currentView = 'category';
        this.state.setLoading(true);
        
        try {
            const result = await this.categories.getCategory(slug);
            
            if (!result) {
                await this.router.navigate('/404');
                return;
            }
            
            const container = document.getElementById('app');
            container.innerHTML = await this.loadTemplate('category', result);
            
            document.title = `${result.category.name} - WikiZero`;
            
        } catch (error) {
            console.error('Erro ao renderizar categoria:', error);
            this.showError('Erro ao carregar a categoria');
        } finally {
            this.state.setLoading(false);
        }
    }

    async renderCategories() {
        this.currentView = 'categories';
        
        const container = document.getElementById('app');
        container.innerHTML = await this.loadTemplate('categories', {
            categories: this.categories.categories,
            tree: this.categories.categoryTree,
            stats: await this.categories.getCategoryStats()
        });
        
        // Renderizar árvore
        this.categories.renderCategoryTree('category-tree');
    }

    async renderModeration() {
        this.currentView = 'moderation';
        
        // Verificar permissões
        if (!await this.auth.hasRole('moderator')) {
            this.router.navigate('/');
            return;
        }
        
        await this.moderation.init();
        
        const container = document.getElementById('app');
        container.innerHTML = await this.loadTemplate('moderation', {
            pendingCount: this.moderation.getPendingCount(),
            reportsCount: this.moderation.getReportsCount()
        });
        
        // Renderizar painel
        this.moderation.renderModerationPanel('moderation-panel');
        
        // Configurar eventos
        this.setupModerationEvents(container);
    }

    async renderSearch() {
        this.currentView = 'search';
        
        const params = new URLSearchParams(window.location.search);
        const query = params.get('q') || '';
        
        const container = document.getElementById('app');
        container.innerHTML = await this.loadTemplate('search', { query });
        
        if (query) {
            await this.performSearch(query);
        }
    }

    // ===== EVENTOS =====
    
    handleAuthChange(event, data) {
        switch(event) {
            case 'login':
            case 'guest':
                this.updateUI();
                this.loadInitialData();
                break;
            case 'logout':
                this.updateUI();
                this.loadInitialData();
                break;
        }
    }

    setupGlobalEvents() {
        // Busca
        const searchInput = document.querySelector('.wiki-search input');
        if (searchInput) {
            searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    const query = e.target.value.trim();
                    if (query) {
                        window.location.href = `/search?q=${encodeURIComponent(query)}`;
                    }
                }
            });
        }
        
        // Tema
        const themeToggle = document.getElementById('theme-toggle');
        if (themeToggle) {
            themeToggle.addEventListener('click', () => {
                this.toggleTheme();
            });
        }
        
        // Scroll to top
        window.addEventListener('scroll', () => {
            const scrollBtn = document.getElementById('scroll-top');
            if (scrollBtn) {
                scrollBtn.style.display = window.scrollY > 500 ? 'block' : 'none';
            }
        });
    }

    setupHomeEvents(container) {
        // Artigos em destaque
        container.querySelectorAll('.article-card a').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                this.router.navigate(link.getAttribute('href'));
            });
        });
    }

    setupArticleEvents(container, article) {
        // Links internos
        container.querySelectorAll('.wiki-internal-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const href = link.getAttribute('href');
                if (href) {
                    this.router.navigate(href);
                }
            });
        });
        
        // Comentários
        const commentForm = container.querySelector('#comment-form');
        if (commentForm) {
            commentForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                await this.addComment(article.id, commentForm);
            });
        }
    }

    setupEditorEvents(container, article) {
        // Salvar
        window.onEditorSave = () => {
            this.saveArticle(article?.id);
        };
        
        // Cancelar
        window.onEditorCancel = () => {
            this.router.navigate(article ? `/article/${article.slug}` : '/');
        };
        
        // Categorias
        const categoryInput = document.getElementById('category-input');
        const categoryTags = document.getElementById('category-tags');
        
        if (categoryInput) {
            // Sugestões de categorias
            const suggestions = this.categories.categories.map(c => c.name);
            const datalist = document.getElementById('category-suggestions');
            if (datalist) {
                suggestions.forEach(cat => {
                    const option = document.createElement('option');
                    option.value = cat;
                    datalist.appendChild(option);
                });
            }
            
            categoryInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const value = categoryInput.value.trim();
                    if (value) {
                        this.addCategory(value);
                        categoryInput.value = '';
                    }
                }
            });
        }
        
        // Tags
        const tagInput = document.getElementById('tag-input');
        if (tagInput) {
            tagInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const value = tagInput.value.trim();
                    if (value) {
                        this.addTag(value);
                        tagInput.value = '';
                    }
                }
            });
        }
    }

    setupModerationEvents(container) {
        // Expor módulo para o window
        window.moderation = this.moderation;
    }

    // ===== AÇÕES =====
    
    async saveArticle(articleId) {
        const form = document.getElementById('article-form');
        if (!form) return;
        
        const title = document.getElementById('article-title').value.trim();
        const content = this.editor.getContent();
        const summary = document.getElementById('article-summary').value.trim();
        const editSummary = document.getElementById('edit-summary').value.trim();
        const categories = this.getSelectedCategories();
        const tags = this.getSelectedTags();
        const user = this.auth.currentUser;
        
        if (!user) {
            this.showError('Você precisa estar logado para salvar um artigo');
            return;
        }
        
        if (!title) {
            this.showError('O título é obrigatório');
            return;
        }
        
        if (!content) {
            this.showError('O conteúdo é obrigatório');
            return;
        }
        
        const data = {
            title,
            content,
            summary,
            categories,
            tags,
            edit_summary: editSummary,
            author: {
                uid: user.uid,
                name: user.displayName || 'Usuário',
                email: user.email || ''
            }
        };
        
        try {
            let result;
            
            if (articleId) {
                result = await this.articles.updateArticle(articleId, data, user);
            } else {
                result = await this.articles.createArticle(data, user);
            }
            
            if (result.error) {
                this.showError(result.error);
                return;
            }
            
            if (result.errors) {
                const errors = Object.values(result.errors).flat().join('\n');
                this.showError(errors);
                return;
            }
            
            // Redirecionar para o artigo
            const slug = result.article.slug;
            this.router.navigate(`/article/${slug}`);
            
        } catch (error) {
            console.error('Erro ao salvar artigo:', error);
            this.showError('Erro ao salvar o artigo. Tente novamente.');
        }
    }

    async addComment(articleId, form) {
        const content = form.querySelector('textarea').value.trim();
        const user = this.auth.currentUser;
        
        if (!user) {
            this.showError('Você precisa estar logado para comentar');
            return;
        }
        
        if (!content) {
            this.showError('Digite um comentário');
            return;
        }
        
        try {
            const commentData = {
                articleId: articleId,
                content: content,
                author: {
                    uid: user.uid,
                    name: user.displayName || 'Usuário'
                },
                created_at: new Date().toISOString()
            };
            
            const docRef = await this.db.collection('comments').add(commentData);
            
            // Adicionar à UI
            const container = document.getElementById('discussion-container');
            const commentHtml = `
                <div class="comment" data-id="${docRef.id}">
                    <div class="comment-header">
                        <strong>${commentData.author.name}</strong>
                        <span>agora</span>
                    </div>
                    <div class="comment-body">${Helpers.escapeHtml(content)}</div>
                </div>
            `;
            container.insertAdjacentHTML('beforeend', commentHtml);
            
            form.reset();
            
        } catch (error) {
            console.error('Erro ao adicionar comentário:', error);
            this.showError('Erro ao adicionar comentário');
        }
    }

    async performSearch(query) {
        const container = document.getElementById('search-results');
        if (!container) return;
        
        container.innerHTML = '<div class="loading">🔍 Buscando...</div>';
        
        try {
            const results = await this.db.searchArticles(query);
            
            if (results.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <p>🔍 Nenhum resultado encontrado para "${Helpers.escapeHtml(query)}"</p>
                        <p>Sugestões:</p>
                        <ul>
                            <li>Verifique a ortografia</li>
                            <li>Tente termos mais gerais</li>
                            <li>Tente termos relacionados</li>
                        </ul>
                    </div>
                `;
                return;
            }
            
            container.innerHTML = results.map(result => `
                <div class="search-result">
                    <h3><a href="/article/${result.slug}">${Helpers.escapeHtml(result.title)}</a></h3>
                    <p>${Helpers.escapeHtml(result.summary || result.content.substring(0, 200))}...</p>
                    <div class="result-meta">
                        <span>📄 ${result.categories?.join(', ') || 'Sem categoria'}</span>
                        <span>${result.author?.name || 'Autor desconhecido'}</span>
                    </div>
                </div>
            `).join('');
            
        } catch (error) {
            console.error('Erro na busca:', error);
            container.innerHTML = '<div class="error-state">Erro ao realizar a busca</div>';
        }
    }

    // ===== UTILIDADES =====
    
    async loadTemplate(name, data = {}) {
        try {
            const response = await fetch(`/templates/${name}.html`);
            if (!response.ok) {
                throw new Error(`Template ${name} não encontrado`);
            }
            
            let html = await response.text();
            
            // Substituir variáveis
            for (const [key, value] of Object.entries(data)) {
                const regex = new RegExp(`{{${key}}}`, 'g');
                html = html.replace(regex, value || '');
            }
            
            return html;
        } catch (error) {
            console.error('Erro ao carregar template:', error);
            return `<div class="error">Erro ao carregar template: ${name}</div>`;
        }
    }

    updateUI() {
        const user = this.auth.currentUser;
        const isAuthenticated = this.auth.isAuthenticated();
        
        const avatar = document.getElementById('user-avatar');
        const name = document.getElementById('user-name');
        const email = document.getElementById('user-email');
        const loginBtn = document.getElementById('login-btn');
        const logoutBtn = document.getElementById('logout-btn');
        
        if (user) {
            if (user.photoURL) {
                avatar.innerHTML = `<img src="${user.photoURL}" alt="Avatar">`;
            } else {
                avatar.textContent = Helpers.getInitials(user.displayName || 'U');
            }
            name.textContent = user.displayName || 'Usuário';
            email.textContent = user.email || '';
            loginBtn.style.display = 'none';
            logoutBtn.style.display = 'inline-block';
        } else {
            avatar.textContent = '👤';
            name.textContent = 'Visitante';
            email.textContent = '';
            loginBtn.style.display = 'inline-block';
            logoutBtn.style.display = 'none';
        }
    }

    toggleTheme() {
        const current = this.state.get('theme');
        const themes = ['light', 'dark', 'sepia'];
        const next = themes[(themes.indexOf(current) + 1) % themes.length];
        
        this.state.set('theme', next, true);
        
        // Aplicar tema
        document.documentElement.setAttribute('data-theme', next);
        
        // Atualizar ícone
        const themeBtn = document.getElementById('theme-toggle');
        if (themeBtn) {
            const icons = {
                light: '🌙',
                dark: '☀️',
                sepia: '📖'
            };
            themeBtn.textContent = icons[next];
        }
    }

    showError(message) {
        const container = document.getElementById('app');
        if (container) {
            container.innerHTML = `
                <div class="error-container">
                    <div class="error-icon">❌</div>
                    <h2>Oops! Algo deu errado</h2>
                    <p>${Helpers.escapeHtml(message)}</p>
                    <button onclick="window.WikiZero.router.navigate('/')" class="btn-primary">
                        Voltar para o início
                    </button>
                </div>
            `;
        }
    }

    showNotification(message, type = 'info') {
        const container = document.createElement('div');
        container.className = `notification notification-${type}`;
        container.innerHTML = `
            <span class="notification-icon">${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span>
            <span class="notification-message">${message}</span>
            <button class="notification-close">×</button>
        `;
        
        document.body.appendChild(container);
        
        setTimeout(() => {
            container.classList.add('show');
        }, 100);
        
        container.querySelector('.notification-close').addEventListener('click', () => {
            container.remove();
        });
        
        setTimeout(() => {
            container.remove();
        }, 5000);
    }

    // ===== HANDLERS =====
    
    handleAutoSave(content) {
        // Salvar rascunho automaticamente
        if (this.auth.currentUser) {
            const key = `draft_${this.auth.currentUser.uid}`;
            localStorage.setItem(key, JSON.stringify({
                content: content,
                timestamp: Date.now()
            }));
        }
    }

    getSelectedCategories() {
        const tags = document.querySelectorAll('#category-tags .category-tag');
        return Array.from(tags).map(tag => tag.textContent.trim().replace('×', '').trim());
    }

    getSelectedTags() {
        const tags = document.querySelectorAll('#tag-tags .tag-tag');
        return Array.from(tags).map(tag => tag.textContent.trim().replace('×', '').trim());
    }

    addCategory(category) {
        const container = document.getElementById('category-tags');
        const tag = document.createElement('span');
        tag.className = 'category-tag';
        tag.innerHTML = `${Helpers.escapeHtml(category)} <button type="button" onclick="this.parentElement.remove()">×</button>`;
        container.appendChild(tag);
    }

    addTag(tag) {
        const container = document.getElementById('tag-tags');
        const tagEl = document.createElement('span');
        tagEl.className = 'tag-tag';
        tagEl.innerHTML = `${Helpers.escapeHtml(tag)} <button type="button" onclick="this.parentElement.remove()">×</button>`;
        container.appendChild(tagEl);
    }

    // ===== RENDERIZAÇÕES ADICIONAIS =====
    
    async renderHistory(id) {
        this.currentView = 'history';
        this.state.setLoading(true);
        
        try {
            const result = await this.articles.getArticleHistory(id);
            
            if (result.error) {
                this.showError(result.error);
                return;
            }
            
            const container = document.getElementById('app');
            container.innerHTML = await this.loadTemplate('history', {
                history: result.history
            });
            
            document.title = 'Histórico - WikiZero';
            
        } catch (error) {
            console.error('Erro ao renderizar histórico:', error);
            this.showError('Erro ao carregar o histórico');
        } finally {
            this.state.setLoading(false);
        }
    }

    async renderUserProfile(uid) {
        this.currentView = 'user';
        this.state.setLoading(true);
        
        try {
            const user = await this.db.getUserProfile(uid);
            if (!user) {
                await this.router.navigate('/404');
                return;
            }
            
            const contributions = await this.db.getArticles({
                author: uid,
                limit: 20
            });
            
            const container = document.getElementById('app');
            container.innerHTML = await this.loadTemplate('user', {
                user,
                contributions
            });
            
            document.title = `${user.display_name} - WikiZero`;
            
        } catch (error) {
            console.error('Erro ao renderizar perfil:', error);
            this.showError('Erro ao carregar o perfil');
        } finally {
            this.state.setLoading(false);
        }
    }

    async renderUsers() {
        this.currentView = 'users';
        
        const container = document.getElementById('app');
        container.innerHTML = await this.loadTemplate('users', {
            stats: await this.getStats()
        });
    }

    async renderRandom() {
        try {
            const articles = await this.db.getArticles({ limit: 100 });
            if (articles.length === 0) {
                this.router.navigate('/');
                return;
            }
            
            const random = articles[Math.floor(Math.random() * articles.length)];
            this.router.navigate(`/article/${random.slug}`);
        } catch (error) {
            console.error('Erro ao carregar artigo aleatório:', error);
            this.router.navigate('/');
        }
    }

    async renderAbout() {
        this.currentView = 'about';
        const container = document.getElementById('app');
        container.innerHTML = await this.loadTemplate('about');
        document.title = 'Sobre - WikiZero';
    }

    async renderContribute() {
        this.currentView = 'contribute';
        const container = document.getElementById('app');
        container.innerHTML = await this.loadTemplate('contribute');
        document.title = 'Contribuir - WikiZero';
    }

    async renderPrivacy() {
        this.currentView = 'privacy';
        const container = document.getElementById('app');
        container.innerHTML = await this.loadTemplate('privacy');
        document.title = 'Privacidade - WikiZero';
    }

    async renderTerms() {
        this.currentView = 'terms';
        const container = document.getElementById('app');
        container.innerHTML = await this.loadTemplate('terms');
        document.title = 'Termos - WikiZero';
    }

    async render404() {
        this.currentView = '404';
        const container = document.getElementById('app');
        container.innerHTML = await this.loadTemplate('404');
        document.title = '404 - Página não encontrada - WikiZero';
    }

    async renderError() {
        this.currentView = 'error';
        const container = document.getElementById('app');
        container.innerHTML = await this.loadTemplate('error');
        document.title = 'Erro - WikiZero';
    }
}

// ===== INICIALIZAR =====
const app = new WikiZeroApp();
app.init();

// Exportar para uso global
window.WikiZero = app;
window.WikiZeroApp = app;

console.log('🚀 WikiZero 2.0 carregada com sucesso!');
console.log('📚 Documentação: https://wikizero.com/docs');
console.log('💡 Contribua: https://wikizero.com/contribute');
