// ============================================
// MÓDULO DE CATEGORIAS
// ============================================

import { DatabaseService } from '../core/database.js';
import * as Helpers from '../utils/helpers.js';

export class CategoryModule {
    constructor() {
        this.db = new DatabaseService();
        this.categories = [];
        this.categoryTree = [];
    }

    async loadCategories() {
        try {
            this.categories = await this.db.getCategories();
            this.buildCategoryTree();
            return this.categories;
        } catch (error) {
            console.error('Erro ao carregar categorias:', error);
            throw error;
        }
    }

    buildCategoryTree() {
        const map = {};
        const roots = [];

        // Criar mapa de categorias
        this.categories.forEach(cat => {
            map[cat.id] = { ...cat, children: [] };
        });

        // Construir árvore
        this.categories.forEach(cat => {
            if (cat.parent_category && map[cat.parent_category]) {
                map[cat.parent_category].children.push(map[cat.id]);
            } else {
                roots.push(map[cat.id]);
            }
        });

        this.categoryTree = roots;
        return roots;
    }

    async getCategory(slug) {
        try {
            const category = this.categories.find(c => c.slug === slug);
            if (!category) return null;

            // Buscar artigos da categoria
            const articles = await this.db.getArticles({
                category: category.name,
                limit: 50
            });

            return {
                category: category,
                articles: articles,
                subcategories: this.getSubcategories(category.id)
            };
        } catch (error) {
            console.error('Erro ao buscar categoria:', error);
            throw error;
        }
    }

    getSubcategories(categoryId) {
        const result = [];
        const findChildren = (id) => {
            const children = this.categoryTree
                .flatMap(root => this.flattenTree(root))
                .filter(cat => cat.parent_category === id);
            
            children.forEach(child => {
                result.push(child);
                findChildren(child.id);
            });
        };

        findChildren(categoryId);
        return result;
    }

    flattenTree(node) {
        const result = [node];
        node.children.forEach(child => {
            result.push(...this.flattenTree(child));
        });
        return result;
    }

    async createCategory(data, user) {
        try {
            // Verificar se já existe
            const existing = this.categories.find(c => 
                c.name.toLowerCase() === data.name.toLowerCase()
            );
            
            if (existing) {
                throw new Error('Já existe uma categoria com este nome');
            }

            const categoryData = {
                name: data.name,
                slug: Helpers.slugify(data.name),
                description: data.description || '',
                parent_category: data.parent_category || null,
                icon: data.icon || '📁',
                color: data.color || Helpers.getRandomColor(),
                created_by: user.uid,
                created_at: new Date().toISOString()
            };

            const result = await this.db.createCategory(categoryData);
            
            // Recarregar categorias
            await this.loadCategories();
            
            return result;
        } catch (error) {
            console.error('Erro ao criar categoria:', error);
            throw error;
        }
    }

    async updateCategory(categoryId, data) {
        try {
            const category = this.categories.find(c => c.id === categoryId);
            if (!category) {
                throw new Error('Categoria não encontrada');
            }

            const updateData = {
                ...data,
                updated_at: new Date().toISOString()
            };

            if (data.name) {
                updateData.slug = Helpers.slugify(data.name);
            }

            await this.db.collection('categories').doc(categoryId).update(updateData);
            
            // Recarregar categorias
            await this.loadCategories();
            
            return { ...category, ...updateData };
        } catch (error) {
            console.error('Erro ao atualizar categoria:', error);
            throw error;
        }
    }

    async deleteCategory(categoryId) {
        try {
            // Verificar se tem subcategorias
            const subcategories = this.getSubcategories(categoryId);
            if (subcategories.length > 0) {
                throw new Error('Não é possível excluir uma categoria que tem subcategorias');
            }

            // Verificar se tem artigos
            const articles = await this.db.getArticles({
                category: this.categories.find(c => c.id === categoryId)?.name,
                limit: 1
            });

            if (articles.length > 0) {
                throw new Error('Não é possível excluir uma categoria que tem artigos');
            }

            await this.db.collection('categories').doc(categoryId).delete();
            
            // Recarregar categorias
            await this.loadCategories();
            
            return { success: true };
        } catch (error) {
            console.error('Erro ao excluir categoria:', error);
            throw error;
        }
    }

    getCategoryBreadcrumbs(categoryId) {
        const breadcrumbs = [];
        let current = this.categories.find(c => c.id === categoryId);
        
        while (current) {
            breadcrumbs.unshift(current);
            current = this.categories.find(c => c.id === current.parent_category);
        }
        
        return breadcrumbs;
    }

    renderCategoryTree(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const renderTree = (nodes, level = 0) => {
            let html = '<ul class="category-tree">';
            
            nodes.forEach(node => {
                const hasChildren = node.children && node.children.length > 0;
                html += `
                    <li class="category-tree-item level-${level}" data-category="${node.id}">
                        <div class="category-tree-node">
                            <span class="category-icon">${node.icon || '📁'}</span>
                            <a href="/category/${node.slug}">${node.name}</a>
                            <span class="category-count">(${node.articles_count || 0})</span>
                            ${hasChildren ? `<button class="toggle-children" onclick="window.categories.toggleChildren('${node.id}')">▼</button>` : ''}
                        </div>
                        ${hasChildren ? `<div class="category-children" id="children-${node.id}">${renderTree(node.children, level + 1)}</div>` : ''}
                    </li>
                `;
            });
            
            html += '</ul>';
            return html;
        };

        container.innerHTML = renderTree(this.categoryTree);
    }

    toggleChildren(categoryId) {
        const children = document.getElementById(`children-${categoryId}`);
        if (children) {
            children.style.display = children.style.display === 'none' ? 'block' : 'none';
        }
    }

    async getCategoryStats() {
        const stats = {
            total: this.categories.length,
            withArticles: 0,
            empty: 0,
            topCategories: []
        };

        this.categories.forEach(cat => {
            if (cat.articles_count > 0) {
                stats.withArticles++;
            } else {
                stats.empty++;
            }
        });

        // Top 5 categorias com mais artigos
        stats.topCategories = this.categories
            .filter(c => c.articles_count > 0)
            .sort((a, b) => b.articles_count - a.articles_count)
            .slice(0, 5)
            .map(c => ({
                name: c.name,
                count: c.articles_count,
                slug: c.slug
            }));

        return stats;
    }
}
