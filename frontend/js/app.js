// ============================================
// WIKIZERO 2.0 - SPA APPLICATION
// ============================================

import { AuthService } from './core/auth.js';
import { DatabaseService } from './core/database.js';
import { Router } from './core/router.js';
import { StateManager } from './core/state.js';
import { WikiParser } from './utils/parser.js';

class WikiZeroApp {
    constructor() {
        this.auth = new AuthService();
        this.db = new DatabaseService();
        this.router = new Router();
        this.state = new StateManager();
        this.parser = new WikiParser();
        
        this.init();
    }
    
    async init() {
        console.log('📚 WikiZero 2.0 - Inicializando...');
        
        // 1. Configurar rotas
        this.setupRoutes();
        
        // 2. Inicializar autenticação
        await this.auth.init();
        
        // 3. Carregar estado global
        await this.loadGlobalState();
        
        // 4. Renderizar página inicial
        this.router.navigate(window.location.pathname);
        
        // 5. Configurar event listeners
        this.setupEventListeners();
        
        console.log('✅ WikiZero 2.0 carregada com sucesso!');
    }
    
    setupRoutes() {
        this.router.register('/', () => this.renderHome());
        this.router.register('/article/:slug', (params) => this.renderArticle(params.slug));
        this.router.register('/edit/:slug', (params) => this.renderEditor(params.slug));
        this.router.register('/create', () => this.renderEditor());
        this.router.register('/search', () => this.renderSearch());
        this.router.register('/category/:category', (params) => this.renderCategory(params.category));
        this.router.register('/user/:uid', (params) => this.renderUserProfile(params.uid));
        this.router.register('/talk/:articleId', (params) => this.renderTalkPage(params.articleId));
        this.router.register('/history/:articleId', (params) => this.renderHistory(params.articleId));
        this.router.register('/random', () => this.renderRandom());
        this.router.register('/about', () => this.renderAbout());
        this.router.register('/contribute', () => this.renderContribute());
    }
    
    async renderHome() {
        console.log('🏠 Renderizando página inicial...');
        
        const container = document.getElementById('app');
        container.innerHTML = await this.loadTemplate('home');
        
        // Carregar artigos em destaque
        const featured = await this.db.getFeaturedArticles();
        this.renderFeaturedArticles(featured);
        
        // Carregar categorias
        const categories = await this.db.getCategories();
        this.renderCategories(categories);
        
        // Carregar artigos recentes
        const recent = await this.db.getRecentArticles();
        this.renderRecentArticles(recent);
    }
    
    async renderArticle(slug) {
        console.log(`📄 Renderizando artigo: ${slug}`);
        
        try {
            const article = await this.db.getArticleBySlug(slug);
            
            if (!article) {
                this.renderNotFound();
                return;
            }
            
            const container = document.getElementById('app');
            container.innerHTML = await this.loadTemplate('article', article);
            
            // Renderizar conteúdo com parser wiki
            const content = document.getElementById('article-content');
            content.innerHTML = this.parser.parse(article.content);
            
            // Atualizar metadados
            document.title = `${article.title} - WikiZero`;
            
            // Incrementar contador de visualizações
            await this.db.incrementArticleViews(article.id);
            
            // Carregar discussões
            const discussions = await this.db.getArticleDiscussions(article.id);
            this.renderDiscussions(discussions);
            
        } catch (error) {
            console.error('Erro ao renderizar artigo:', error);
            this.renderError(error);
        }
    }
    
    async renderEditor(slug = null) {
        console.log(`✏️ Abrindo editor para: ${slug || 'novo artigo'}`);
        
        const isEdit = slug !== null;
        const article = isEdit ? await this.db.getArticleBySlug(slug) : null;
        
        const container = document.getElementById('app');
        container.innerHTML = await this.loadTemplate('editor', { isEdit, article });
        
        // Inicializar editor
        this.initEditor(article);
    }
    
    setupEventListeners() {
        // Navegação com popstate
        window.addEventListener('popstate', () => {
            this.router.navigate(window.location.pathname);
        });
        
        // Busca em tempo real
        document.addEventListener('searchInput', async (e) => {
            const query = e.detail.query;
            const results = await this.db.searchArticles(query);
            this.renderSearchResults(results);
        });
        
        // Salvar rascunho automático
        document.addEventListener('autoSave', async (e) => {
            await this.db.saveDraft(e.detail.data);
        });
    }
}

// Inicializar aplicação
const app = new WikiZeroApp();

// Exportar para uso global
window.WikiZero = app;
