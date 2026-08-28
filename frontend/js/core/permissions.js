// ============================================
// SISTEMA DE PERMISSÕES
// ============================================

export class PermissionSystem {
    constructor() {
        this.roles = {
            'user': {
                permissions: [
                    'read_articles',
                    'create_article',
                    'edit_own_articles',
                    'comment',
                    'upload_image'
                ]
            },
            'editor': {
                permissions: [
                    'read_articles',
                    'create_article',
                    'edit_any_article',
                    'delete_own_articles',
                    'comment',
                    'upload_image',
                    'edit_categories'
                ]
            },
            'moderator': {
                permissions: [
                    'read_articles',
                    'create_article',
                    'edit_any_article',
                    'delete_any_article',
                    'comment',
                    'upload_image',
                    'edit_categories',
                    'moderate_content',
                    'ban_users',
                    'lock_articles',
                    'review_articles'
                ]
            },
            'admin': {
                permissions: [
                    'read_articles',
                    'create_article',
                    'edit_any_article',
                    'delete_any_article',
                    'comment',
                    'upload_image',
                    'edit_categories',
                    'moderate_content',
                    'ban_users',
                    'lock_articles',
                    'review_articles',
                    'manage_users',
                    'manage_system',
                    'view_logs',
                    'configure_site'
                ]
            }
        };
    }
    
    async getUserRole(uid) {
        try {
            const userDoc = await db.collection('users').doc(uid).get();
            if (!userDoc.exists) return 'user';
            
            const data = userDoc.data();
            return data.role || 'user';
        } catch (error) {
            console.error('Erro ao buscar role:', error);
            return 'user';
        }
    }
    
    async hasPermission(uid, permission) {
        const role = await this.getUserRole(uid);
        const rolePermissions = this.roles[role]?.permissions || [];
        
        // Admin tem todas as permissões
        if (role === 'admin') return true;
        
        return rolePermissions.includes(permission);
    }
    
    async canEditArticle(uid, article) {
        // Verificar se artigo está bloqueado
        if (article.locked) return false;
        
        // Verificar permissões
        const role = await this.getUserRole(uid);
        
        if (role === 'admin' || role === 'moderator' || role === 'editor') {
            return true;
        }
        
        // Usuário comum só pode editar seus próprios artigos
        return article.author.uid === uid;
    }
    
    async canDeleteArticle(uid, article) {
        const role = await this.getUserRole(uid);
        
        if (role === 'admin' || role === 'moderator') {
            return true;
        }
        
        return role === 'editor' && article.author.uid === uid;
    }
    
    async requirePermission(uid, permission) {
        const has = await this.hasPermission(uid, permission);
        if (!has) {
            throw new Error('Permissão negada. Você não tem autorização para realizar esta ação.');
        }
        return true;
    }
}
