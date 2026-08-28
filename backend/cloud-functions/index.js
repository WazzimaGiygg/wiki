// ============================================
// CLOUD FUNCTIONS - WIKIZERO 2.0
// ============================================

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { parseWikiText } = require('./parsers');
const { indexArticle } = require('./search');
const { sendNotification } = require('./notifications');

admin.initializeApp();
const db = admin.firestore();

// ============================================
// 1. CRIAÇÃO DE ARTIGO
// ============================================
exports.onCreateArticle = functions.firestore
    .document('articles/{articleId}')
    .onCreate(async (snap, context) => {
        const data = snap.data();
        const articleId = context.params.articleId;
        
        try {
            // 1. Gerar HTML a partir do wikitext
            const html = await parseWikiText(data.content);
            
            // 2. Gerar slug SEO
            const slug = data.title
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-|-$/g, '');
            
            // 3. Atualizar contagem de categorias
            if (data.categories && data.categories.length > 0) {
                await updateCategoryCounts(data.categories);
            }
            
            // 4. Atualizar contagem de contribuições do usuário
            await updateUserContributions(data.author.uid);
            
            // 5. Indexar para busca
            await indexArticle(articleId, {
                title: data.title,
                content: data.content,
                summary: data.summary,
                categories: data.categories,
                tags: data.tags
            });
            
            // 6. Atualizar estatísticas
            await db.collection('stats').doc('global').update({
                total_articles: admin.firestore.FieldValue.increment(1)
            });
            
            // 7. Salvar versão inicial
            await db.collection('revisions').doc(articleId).collection('versions').add({
                version: 1,
                content: data.content,
                changes_summary: 'Criação do artigo',
                editor: data.author,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });
            
            // 8. Notificar usuários interessados
            await notifyInterestedUsers(articleId, 'new_article');
            
            console.log(`✅ Artigo ${articleId} processado com sucesso!`);
            
        } catch (error) {
            console.error(`❌ Erro ao processar artigo ${articleId}:`, error);
        }
    });

// ============================================
// 2. EDIÇÃO DE ARTIGO
// ============================================
exports.onUpdateArticle = functions.firestore
    .document('articles/{articleId}')
    .onUpdate(async (change, context) => {
        const before = change.before.data();
        const after = change.after.data();
        const articleId = context.params.articleId;
        
        try {
            // 1. Verificar se houve mudança no conteúdo
            if (before.content !== after.content) {
                // 2. Salvar nova revisão
                const version = (after.version || 0) + 1;
                await change.after.ref.update({
                    version: version,
                    updated_at: admin.firestore.FieldValue.serverTimestamp()
                });
                
                // 3. Registrar revisão
                await db.collection('revisions').doc(articleId).collection('versions').add({
                    version: version,
                    content: after.content,
                    changes_summary: after.edit_summary || 'Edição',
                    editor: after.last_editor || after.author,
                    timestamp: admin.firestore.FieldValue.serverTimestamp()
                });
                
                // 4. Reindexar busca
                await indexArticle(articleId, {
                    title: after.title,
                    content: after.content,
                    summary: after.summary,
                    categories: after.categories,
                    tags: after.tags
                });
                
                // 5. Notificar usuários que seguem o artigo
                await notifyArticleWatchers(articleId, 'edit');
            }
            
            console.log(`✅ Artigo ${articleId} atualizado!`);
            
        } catch (error) {
            console.error(`❌ Erro ao atualizar artigo ${articleId}:`, error);
        }
    });

// ============================================
// 3. MODERAÇÃO
// ============================================
exports.moderateArticle = functions.https.onCall(async (data, context) => {
    // Verificar se usuário é moderador
    const userDoc = await db.collection('users').doc(context.auth.uid).get();
    const user = userDoc.data();
    
    if (!user || !['moderator', 'admin', 'bureaucrat'].includes(user.role)) {
        throw new functions.https.HttpsError(
            'permission-denied',
            'Apenas moderadores podem realizar esta ação.'
        );
    }
    
    const { articleId, action, notes } = data;
    
    switch(action) {
        case 'approve':
            await db.collection('articles').doc(articleId).update({
                status: 'published',
                verified: true,
                moderated_by: context.auth.uid,
                moderation_notes: notes,
                published_at: admin.firestore.FieldValue.serverTimestamp()
            });
            break;
            
        case 'reject':
            await db.collection('articles').doc(articleId).update({
                status: 'draft',
                moderated_by: context.auth.uid,
                moderation_notes: notes
            });
            break;
            
        case 'delete':
            await db.collection('articles').doc(articleId).update({
                status: 'deleted',
                moderated_by: context.auth.uid,
                moderation_notes: notes
            });
            break;
            
        default:
            throw new functions.https.HttpsError(
                'invalid-argument',
                'Ação inválida'
            );
    }
    
    // Notificar autor
    const article = await db.collection('articles').doc(articleId).get();
    await sendNotification(article.data().author.uid, {
        type: 'moderation',
        title: `Artigo ${action === 'approve' ? 'aprovado' : 'revisado'}`,
        message: `Seu artigo "${article.data().title}" foi ${action === 'approve' ? 'aprovado' : 'revisado'}.`,
        link: `/article/${articleId}`
    });
    
    return { success: true };
});

// ============================================
// 4. SISTEMA DE BUSCA
// ============================================
// functions/search.js
const { SearchClient } = require('@algolia/client-search');

const searchClient = new SearchClient({
    appId: process.env.ALGOLIA_APP_ID,
    apiKey: process.env.ALGOLIA_API_KEY
});

async function indexArticle(articleId, data) {
    try {
        await searchClient.saveObject({
            indexName: 'articles',
            objectID: articleId,
            ...data,
            _timestamp: new Date().toISOString()
        });
        console.log(`📝 Artigo ${articleId} indexado no Algolia`);
    } catch (error) {
        console.error('Erro ao indexar:', error);
    }
}

// ============================================
// 5. LIMPEZA DE CONTEÚDO
// ============================================
async function updateCategoryCounts(categories) {
    const batch = db.batch();
    
    for (const category of categories) {
        const catRef = db.collection('categories').doc(category);
        batch.update(catRef, {
            articles_count: admin.firestore.FieldValue.increment(1)
        });
    }
    
    await batch.commit();
}

async function updateUserContributions(uid) {
    await db.collection('users').doc(uid).update({
        contributions: admin.firestore.FieldValue.increment(1),
        last_active: admin.firestore.FieldValue.serverTimestamp()
    });
}

async function notifyInterestedUsers(articleId, eventType) {
    // Implementar notificação para usuários que seguem tópicos
    // ou que têm interesse no assunto
    const article = await db.collection('articles').doc(articleId).get();
    const data = article.data();
    
    // Buscar usuários que seguem categorias relacionadas
    const usersSnapshot = await db.collection('users')
        .where('interests', 'array-contains-any', data.categories || [])
        .get();
    
    const batch = db.batch();
    usersSnapshot.forEach(doc => {
        const notifRef = db.collection('notifications').doc();
        batch.set(notifRef, {
            user_id: doc.id,
            type: 'new_article',
            title: `Novo artigo: ${data.title}`,
            message: `Um novo artigo foi publicado na categoria ${data.categories[0]}`,
            link: `/article/${articleId}`,
            read: false,
            created_at: admin.firestore.FieldValue.serverTimestamp()
        });
    });
    
    await batch.commit();
}

async function notifyArticleWatchers(articleId, eventType) {
    // Buscar usuários que seguem este artigo
    const watchersSnapshot = await db.collection('article_watchers')
        .where('article_id', '==', articleId)
        .get();
    
    const batch = db.batch();
    watchersSnapshot.forEach(doc => {
        const notifRef = db.collection('notifications').doc();
        batch.set(notifRef, {
            user_id: doc.data().user_id,
            type: 'edit',
            title: `Artigo atualizado`,
            message: `O artigo foi editado por ${doc.data().editor_name}`,
            link: `/article/${articleId}`,
            read: false,
            created_at: admin.firestore.FieldValue.serverTimestamp()
        });
    });
    
    await batch.commit();
}
