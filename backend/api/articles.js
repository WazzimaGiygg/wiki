// ============================================
// API - ARTIGOS
// ============================================

const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { WikiParser } = require('../utils/parser');

const parser = new WikiParser();

// ===== GET /api/articles =====
router.get('/', async (req, res) => {
    try {
        const { limit = 20, page = 1, category, author, status = 'published' } = req.query;
        
        let query = admin.firestore().collection('articles')
            .where('status', '==', status)
            .orderBy('created_at', 'desc')
            .limit(parseInt(limit))
            .offset((parseInt(page) - 1) * parseInt(limit));

        if (category) {
            query = query.where('categories', 'array-contains', category);
        }

        if (author) {
            query = query.where('author.uid', '==', author);
        }

        const snapshot = await query.get();
        const articles = [];
        
        snapshot.forEach(doc => {
            articles.push({
                id: doc.id,
                ...doc.data()
            });
        });

        res.json({
            success: true,
            data: articles,
            pagination: {
                limit: parseInt(limit),
                page: parseInt(page),
                total: articles.length
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ===== GET /api/articles/:id =====
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Tentar buscar por slug ou ID
        let doc;
        if (id.includes('-')) {
            // Buscar por slug
            const snapshot = await admin.firestore().collection('articles')
                .where('slug', '==', id)
                .limit(1)
                .get();
            
            if (snapshot.empty) {
                return res.status(404).json({
                    success: false,
                    error: 'Artigo não encontrado'
                });
            }
            
            doc = snapshot.docs[0];
        } else {
            // Buscar por ID
            const ref = await admin.firestore().collection('articles').doc(id).get();
            if (!ref.exists) {
                return res.status(404).json({
                    success: false,
                    error: 'Artigo não encontrado'
                });
            }
            doc = ref;
        }

        const article = {
            id: doc.id,
            ...doc.data()
        };

        // Incrementar visualizações
        await admin.firestore().collection('articles').doc(doc.id).update({
            views: admin.firestore.FieldValue.increment(1)
        });

        // Processar conteúdo
        article.renderedContent = parser.parse(article.content);
        article.toc = parser.generateTOC(article.renderedContent);

        res.json({
            success: true,
            data: article
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ===== POST /api/articles =====
router.post('/', async (req, res) => {
    try {
        const { title, content, summary, categories, tags, author } = req.body;

        // Validar
        if (!title || !content) {
            return res.status(400).json({
                success: false,
                error: 'Título e conteúdo são obrigatórios'
            });
        }

        // Gerar slug
        const slug = title
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');

        // Verificar slug único
        const existing = await admin.firestore().collection('articles')
            .where('slug', '==', slug)
            .get();

        if (!existing.empty) {
            return res.status(409).json({
                success: false,
                error: 'Já existe um artigo com este título'
            });
        }

        const articleData = {
            title,
            slug,
            content,
            summary: summary || '',
            categories: categories || [],
            tags: tags || [],
            author: {
                uid: author.uid,
                name: author.name,
                email: author.email
            },
            status: 'published',
            version: 1,
            views: 0,
            likes: 0,
            shares: 0,
            created_at: admin.firestore.FieldValue.serverTimestamp(),
            updated_at: admin.firestore.FieldValue.serverTimestamp()
        };

        const docRef = await admin.firestore().collection('articles').add(articleData);

        // Criar revisão inicial
        await admin.firestore()
            .collection('revisions')
            .doc(docRef.id)
            .collection('versions')
            .add({
                version: 1,
                content: content,
                changes_summary: 'Criação do artigo',
                editor: author,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });

        // Atualizar contagem do autor
        await admin.firestore().collection('users').doc(author.uid).update({
            contributions: admin.firestore.FieldValue.increment(1),
            last_active: admin.firestore.FieldValue.serverTimestamp()
        });

        res.status(201).json({
            success: true,
            data: {
                id: docRef.id,
                ...articleData
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ===== PUT /api/articles/:id =====
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { title, content, summary, categories, tags, edit_summary, author } = req.body;

        const article = await admin.firestore().collection('articles').doc(id).get();
        if (!article.exists) {
            return res.status(404).json({
                success: false,
                error: 'Artigo não encontrado'
            });
        }

        const current = article.data();

        // Verificar permissões
        if (current.author.uid !== author.uid) {
            return res.status(403).json({
                success: false,
                error: 'Você não tem permissão para editar este artigo'
            });
        }

        let updateData = {
            updated_at: admin.firestore.FieldValue.serverTimestamp()
        };

        if (title && title !== current.title) {
            const newSlug = title
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-|-$/g, '');

            const existing = await admin.firestore().collection('articles')
                .where('slug', '==', newSlug)
                .get();

            if (!existing.empty && existing.docs[0].id !== id) {
                return res.status(409).json({
                    success: false,
                    error: 'Já existe um artigo com este título'
                });
            }

            updateData.title = title;
            updateData.slug = newSlug;
        }

        if (content) {
            updateData.content = content;
            updateData.version = (current.version || 0) + 1;

            // Criar nova revisão
            await admin.firestore()
                .collection('revisions')
                .doc(id)
                .collection('versions')
                .add({
                    version: updateData.version,
                    content: content,
                    changes_summary: edit_summary || 'Edição',
                    editor: {
                        uid: author.uid,
                        name: author.name
                    },
                    timestamp: admin.firestore.FieldValue.serverTimestamp()
                });
        }

        if (summary !== undefined) updateData.summary = summary;
        if (categories) updateData.categories = categories;
        if (tags) updateData.tags = tags;

        await admin.firestore().collection('articles').doc(id).update(updateData);

        res.json({
            success: true,
            data: { id, ...current, ...updateData }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ===== DELETE /api/articles/:id =====
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { hardDelete } = req.query;

        if (hardDelete === 'true') {
            // Exclusão permanente
            await admin.firestore().collection('articles').doc(id).delete();

            // Excluir revisões
            const revisions = await admin.firestore()
                .collection('revisions')
                .doc(id)
                .collection('versions')
                .get();

            const batch = admin.firestore().batch();
            revisions.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
        } else {
            // Soft delete
            await admin.firestore().collection('articles').doc(id).update({
                status: 'deleted',
                deleted_at: admin.firestore.FieldValue.serverTimestamp()
            });
        }

        res.json({
            success: true,
            message: 'Artigo excluído com sucesso'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
