// ============================================
// API - BUSCA
// ============================================

const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');

// ===== GET /api/search =====
router.get('/', async (req, res) => {
    try {
        const { q, category, limit = 20, page = 1 } = req.query;

        if (!q || q.length < 2) {
            return res.status(400).json({
                success: false,
                error: 'Termo de busca muito curto. Mínimo 2 caracteres.'
            });
        }

        const searchTerms = q.toLowerCase().split(' ').filter(t => t.length > 1);
        const results = [];
        let total = 0;

        // Buscar por título e conteúdo
        const articles = await admin.firestore().collection('articles')
            .where('status', '==', 'published')
            .limit(100)
            .get();

        articles.forEach(doc => {
            const data = doc.data();
            const title = data.title.toLowerCase();
            const content = data.content.toLowerCase();
            const summary = (data.summary || '').toLowerCase();

            // Calcular score
            let score = 0;
            searchTerms.forEach(term => {
                if (title.includes(term)) score += 10;
                if (content.includes(term)) score += 3;
                if (summary.includes(term)) score += 2;
                
                // Bônus para termos no início
                if (title.startsWith(term)) score += 5;
                if (summary.startsWith(term)) score += 3;
            });

            if (score > 0) {
                results.push({
                    id: doc.id,
                    ...data,
                    score: score
                });
            }
        });

        // Ordenar por score
        results.sort((a, b) => b.score - a.score);

        // Aplicar filtro de categoria
        let filtered = results;
        if (category) {
            filtered = results.filter(r => 
                r.categories && r.categories.includes(category)
            );
        }

        // Paginação
        const start = (parseInt(page) - 1) * parseInt(limit);
        const paginated = filtered.slice(start, start + parseInt(limit));

        res.json({
            success: true,
            data: paginated,
            pagination: {
                limit: parseInt(limit),
                page: parseInt(page),
                total: filtered.length,
                pages: Math.ceil(filtered.length / parseInt(limit))
            },
            query: q
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ===== GET /api/search/suggestions =====
router.get('/suggestions', async (req, res) => {
    try {
        const { q, limit = 10 } = req.query;

        if (!q || q.length < 1) {
            return res.json({
                success: true,
                data: []
            });
        }

        const articles = await admin.firestore().collection('articles')
            .where('status', '==', 'published')
            .limit(50)
            .get();

        const suggestions = [];
        const term = q.toLowerCase();

        articles.forEach(doc => {
            const data = doc.data();
            const title = data.title.toLowerCase();
            
            if (title.includes(term)) {
                suggestions.push({
                    title: data.title,
                    slug: data.slug,
                    score: title.indexOf(term) === 0 ? 2 : 1
                });
            }
        });

        // Ordenar por relevância
        suggestions.sort((a, b) => b.score - a.score);

        res.json({
            success: true,
            data: suggestions.slice(0, parseInt(limit))
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
