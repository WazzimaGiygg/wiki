// ============================================
// SISTEMA DE ROTEAMENTO
// ============================================

export class Router {
    constructor() {
        this.routes = new Map();
        this.currentPath = window.location.pathname;
        this.params = {};
        this.initialized = false;
    }

    register(path, handler) {
        this.routes.set(path, handler);
        return this;
    }

    async navigate(path) {
        // Extrair parâmetros da URL
        const { route, params } = this.matchRoute(path);
        
        if (!route) {
            this.navigate('/404');
            return;
        }
        
        this.currentPath = path;
        this.params = params;
        
        // Atualizar URL
        if (window.location.pathname !== path) {
            window.history.pushState({ path }, '', path);
        }
        
        // Executar handler
        try {
            await route(params);
        } catch (error) {
            console.error('Erro ao navegar:', error);
            this.navigate('/error');
        }
    }

    matchRoute(path) {
        for (const [route, handler] of this.routes) {
            const pattern = this.routeToRegex(route);
            const match = path.match(pattern);
            
            if (match) {
                const params = {};
                const paramNames = this.getParamNames(route);
                
                paramNames.forEach((name, index) => {
                    params[name] = match[index + 1];
                });
                
                return { route: handler, params };
            }
        }
        
        return { route: this.routes.get('/404'), params: {} };
    }

    routeToRegex(route) {
        return new RegExp('^' + route
            .replace(/:[^\s/]+/g, '([^/]+)')
            .replace(/\//g, '\\/') + '$');
    }

    getParamNames(route) {
        const matches = route.match(/:[^\s/]+/g);
        return matches ? matches.map(m => m.substring(1)) : [];
    }

    init() {
        if (this.initialized) return;
        
        // Listen para navegação
        window.addEventListener('popstate', (event) => {
            const path = event.state?.path || window.location.pathname;
            this.navigate(path);
        });
        
        // Capturar cliques em links
        document.addEventListener('click', (event) => {
            const link = event.target.closest('a');
            if (!link) return;
            
            const href = link.getAttribute('href');
            if (!href || href.startsWith('http') || href.startsWith('#')) return;
            
            event.preventDefault();
            this.navigate(href);
        });
        
        this.initialized = true;
    }

    getCurrentPath() {
        return this.currentPath;
    }

    getParams() {
        return this.params;
    }

    linkTo(path, text, options = {}) {
        const a = document.createElement('a');
        a.href = path;
        a.textContent = text;
        
        if (options.class) a.className = options.class;
        if (options.target) a.target = options.target;
        if (options.title) a.title = options.title;
        
        return a;
    }
}
