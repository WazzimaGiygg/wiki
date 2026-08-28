// ============================================
// MÓDULO DE MODERAÇÃO
// ============================================

import { DatabaseService } from '../core/database.js';
import { Validator } from '../utils/validator.js';
import * as Helpers from '../utils/helpers.js';

export class ModerationModule {
    constructor() {
        this.db = new DatabaseService();
        this.validator = new Validator();
        this.reports = [];
        this.pendingArticles = [];
    }

    async init() {
        await this.loadReports();
        await this.loadPendingArticles();
    }

    async loadReports() {
        try {
            const snapshot = await this.db.collection('reports')
                .where('status', '==', 'pending')
                .orderBy('created_at', 'desc')
                .get();

            this.reports = [];
            snapshot.forEach(doc => {
                this.reports.push({ id: doc.id, ...doc.data() });
            });

            return this.reports;
        } catch (error) {
            console.error('Erro ao carregar reports:', error);
            return [];
        }
    }

    async loadPendingArticles() {
        try {
            const articles = await this.db.getArticles({
                status: 'draft',
                limit: 100
            });

            this.pendingArticles = articles;
            return articles;
        } catch (error) {
            console.error('Erro ao carregar artigos pendentes:', error);
            return [];
        }
    }

    async reportArticle(articleId, reason, user) {
        try {
            // Verificar se já foi reportado
            const existing = await this.db.collection('reports')
                .where('articleId', '==', articleId)
                .where('reportedBy', '==', user.uid)
                .where('status', '==', 'pending')
                .get();

            if (!existing.empty) {
                throw new Error('Você já reportou este artigo');
            }

            const reportData = {
                articleId: articleId,
                reason: reason,
                reportedBy: user.uid,
                reporterName: user.displayName,
                status: 'pending',
                created_at: new Date().toISOString()
            };

            const docRef = await this.db.collection('reports').add(reportData);
            
            // Notificar moderadores
            await this.notifyModerators('Novo report', `Um artigo foi reportado: ${reason}`);

            this.reports.push({ id: docRef.id, ...reportData });
            
            return { id: docRef.id, ...reportData };
        } catch (error) {
            console.error('Erro ao reportar artigo:', error);
            throw error;
        }
    }

    async moderateReport(reportId, action, moderator, notes = '') {
        try {
            const report = this.reports.find(r => r.id === reportId);
            if (!report) {
                throw new Error('Report não encontrado');
            }

            const updateData = {
                status: action === 'approve' ? 'approved' : 'rejected',
                moderatedBy: moderator.uid,
                moderatorName: moderator.displayName,
                moderatedAt: new Date().toISOString(),
                notes: notes
            };

            await this.db.collection('reports').doc(reportId).update(updateData);

            // Ações baseadas no report
            if (action === 'approve') {
                await this.db.collection('articles').doc(report.articleId).update({
                    flagged: true,
                    flag_reason: report.reason,
                    flagged_at: new Date().toISOString()
                });
            }

            // Remover da lista
            this.reports = this.reports.filter(r => r.id !== reportId);

            return { success: true, action: action };
        } catch (error) {
            console.error('Erro ao moderar report:', error);
            throw error;
        }
    }

    async approveArticle(articleId, moderator) {
        try {
            const article = await this.db.getArticle(articleId);
            if (!article) {
                throw new Error('Artigo não encontrado');
            }

            await this.db.collection('articles').doc(articleId).update({
                status: 'published',
                verified: true,
                moderated_by: moderator.uid,
                moderated_at: new Date().toISOString(),
                published_at: new Date().toISOString()
            });

            // Remover da lista de pendentes
            this.pendingArticles = this.pendingArticles.filter(a => a.id !== articleId);

            // Notificar autor
            await this.notifyUser(article.author.uid, 
                'Artigo aprovado',
                `Seu artigo "${article.title}" foi aprovado e publicado!`
            );

            return { success: true };
        } catch (error) {
            console.error('Erro ao aprovar artigo:', error);
            throw error;
        }
    }

    async rejectArticle(articleId, moderator, reason = '') {
        try {
            const article = await this.db.getArticle(articleId);
            if (!article) {
                throw new Error('Artigo não encontrado');
            }

            await this.db.collection('articles').doc(articleId).update({
                status: 'draft',
                rejection_reason: reason,
                moderated_by: moderator.uid,
                moderated_at: new Date().toISOString()
            });

            // Notificar autor
            await this.notifyUser(article.author.uid,
                'Artigo rejeitado',
                `Seu artigo "${article.title}" foi rejeitado. Motivo: ${reason || 'Não especificado'}`
            );

            return { success: true };
        } catch (error) {
            console.error('Erro ao rejeitar artigo:', error);
            throw error;
        }
    }

    async banUser(userId, moderator, reason, duration = 'permanent') {
        try {
            const userProfile = await this.db.getUserProfile(userId);
            if (!userProfile) {
                throw new Error('Usuário não encontrado');
            }

            const banData = {
                banned: true,
                ban_reason: reason,
                banned_by: moderator.uid,
                banned_at: new Date().toISOString(),
                ban_duration: duration
            };

            if (duration !== 'permanent') {
                const days = parseInt(duration);
                banData.ban_expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
            }

            await this.db.collection('users').doc(userId).update(banData);

            // Notificar usuário
            await this.notifyUser(userId,
                'Conta banida',
                `Sua conta foi banida. Motivo: ${reason}${duration !== 'permanent' ? ` Duração: ${duration} dias` : ''}`
            );

            return { success: true };
        } catch (error) {
            console.error('Erro ao banir usuário:', error);
            throw error;
        }
    }

    async unbanUser(userId, moderator) {
        try {
            await this.db.collection('users').doc(userId).update({
                banned: false,
                ban_reason: null,
                unbanned_by: moderator.uid,
                unbanned_at: new Date().toISOString()
            });

            // Notificar usuário
            await this.notifyUser(userId,
                'Conta desbanida',
                'Sua conta foi desbanida. Você já pode acessar o sistema novamente.'
            );

            return { success: true };
        } catch (error) {
            console.error('Erro ao desbanir usuário:', error);
            throw error;
        }
    }

    async lockArticle(articleId, moderator, reason = '') {
        try {
            await this.db.collection('articles').doc(articleId).update({
                locked: true,
                lock_reason: reason,
                locked_by: moderator.uid,
                locked_at: new Date().toISOString()
            });

            return { success: true };
        } catch (error) {
            console.error('Erro ao bloquear artigo:', error);
            throw error;
        }
    }

    async unlockArticle(articleId, moderator) {
        try {
            await this.db.collection('articles').doc(articleId).update({
                locked: false,
                lock_reason: null,
                unlocked_by: moderator.uid,
                unlocked_at: new Date().toISOString()
            });

            return { success: true };
        } catch (error) {
            console.error('Erro ao desbloquear artigo:', error);
            throw error;
        }
    }

    async notifyModerators(title, message) {
        try {
            const moderators = await this.db.collection('users')
                .where('role', 'in', ['moderator', 'admin'])
                .get();

            const batch = this.db.batch();
            
            moderators.forEach(doc => {
                const notifRef = this.db.collection('notifications').doc();
                batch.set(notifRef, {
                    userId: doc.id,
                    title: title,
                    message: message,
                    type: 'moderation',
                    read: false,
                    created_at: new Date().toISOString()
                });
            });

            await batch.commit();
        } catch (error) {
            console.error('Erro ao notificar moderadores:', error);
        }
    }

    async notifyUser(userId, title, message) {
        try {
            await this.db.collection('notifications').add({
                userId: userId,
                title: title,
                message: message,
                type: 'system',
                read: false,
                created_at: new Date().toISOString()
            });
        } catch (error) {
            console.error('Erro ao notificar usuário:', error);
        }
    }

    getPendingCount() {
        return this.pendingArticles.length;
    }

    getReportsCount() {
        return this.reports.length;
    }

    async getModerationStats() {
        const stats = {
            pendingArticles: this.pendingArticles.length,
            pendingReports: this.reports.length,
            totalBanned: 0,
            totalLocked: 0
        };

        // Usuários banidos
        const bannedUsers = await this.db.collection('users')
            .where('banned', '==', true)
            .get();
        stats.totalBanned = bannedUsers.size;

        // Artigos bloqueados
        const lockedArticles = await this.db.collection('articles')
            .where('locked', '==', true)
            .get();
        stats.totalLocked = lockedArticles.size;

        return stats;
    }

    renderModerationPanel(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const renderReports = () => {
            if (this.reports.length === 0) {
                return '<p class="empty-state">🎉 Nenhum report pendente</p>';
            }

            return this.reports.map(report => `
                <div class="report-item" data-report="${report.id}">
                    <div class="report-header">
                        <strong>${report.reporterName}</strong>
                        <span class="report-date">${Helpers.formatRelativeTime(report.created_at)}</span>
                    </div>
                    <div class="report-content">
                        <p><strong>Artigo:</strong> <a href="/article/${report.articleId}">${report.articleTitle || 'Carregando...'}</a></p>
                        <p><strong>Motivo:</strong> ${report.reason}</p>
                    </div>
                    <div class="report-actions">
                        <button onclick="window.moderation.moderateReport('${report.id}', 'approve')" class="btn-success">✅ Aprovar</button>
                        <button onclick="window.moderation.moderateReport('${report.id}', 'reject')" class="btn-danger">❌ Rejeitar</button>
                    </div>
                </div>
            `).join('');
        };

        const renderPending = () => {
            if (this.pendingArticles.length === 0) {
                return '<p class="empty-state">📝 Nenhum artigo pendente</p>';
            }

            return this.pendingArticles.map(article => `
                <div class="pending-item" data-article="${article.id}">
                    <div class="pending-header">
                        <a href="/article/${article.slug}">${article.title}</a>
                        <span class="pending-author">por ${article.author.name}</span>
                    </div>
                    <div class="pending-content">
                        <p>${article.summary || 'Sem resumo'}</p>
                    </div>
                    <div class="pending-actions">
                        <button onclick="window.moderation.approveArticle('${article.id}')" class="btn-success">✅ Aprovar</button>
                        <button onclick="window.moderation.rejectArticle('${article.id}')" class="btn-danger">❌ Rejeitar</button>
                        <button onclick="window.moderation.openArticle('${article.id}')" class="btn-secondary">👁️ Ver</button>
                    </div>
                </div>
            `).join('');
        };

        container.innerHTML = `
            <div class="moderation-panel">
                <div class="moderation-tabs">
                    <button class="tab-btn active" data-tab="pending">📝 Pendentes (${this.pendingArticles.length})</button>
                    <button class="tab-btn" data-tab="reports">🚨 Reports (${this.reports.length})</button>
                    <button class="tab-btn" data-tab="stats">📊 Estatísticas</button>
                </div>
                
                <div class="tab-content active" id="tab-pending">
                    <h3>Artigos aguardando aprovação</h3>
                    <div class="pending-list">${renderPending()}</div>
                </div>
                
                <div class="tab-content" id="tab-reports">
                    <h3>Reports pendentes</h3>
                    <div class="reports-list">${renderReports()}</div>
                </div>
                
                <div class="tab-content" id="tab-stats">
                    <h3>Estatísticas de moderação</h3>
                    <div class="stats-grid">
                        <div class="stat-card">
                            <span class="stat-value">${this.pendingArticles.length}</span>
                            <span class="stat-label">📝 Pendentes</span>
                        </div>
                        <div class="stat-card">
                            <span class="stat-value">${this.reports.length}</span>
                            <span class="stat-label">🚨 Reports</span>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Tab switching
        container.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.tab;
                container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                container.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById(`tab-${tab}`).classList.add('active');
            });
        });
    }
}
