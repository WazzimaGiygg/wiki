// ============================================
// API - USUÁRIOS
// ============================================

const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');

// ===== GET /api/users/:uid =====
router.get('/:uid', async (req, res) => {
    try {
        const { uid } = req.params;
        
        const doc = await admin.firestore().collection('users').doc(uid).get();
        if (!doc.exists) {
            return res.status(404).json({
                success: false,
                error: 'Usuário não encontrado'
            });
        }

        const user = {
            uid: doc.id,
            ...doc.data()
        };

        // Não enviar dados sensíveis
        delete user.email;
        delete user.banned;
        delete user.ban_reason;

        res.json({
            success: true,
            data: user
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ===== GET /api/users/:uid/contributions =====
router.get('/:uid/contributions', async (req, res) => {
    try {
        const { uid } = req.params;
        const { limit = 50 } = req.query;

        const articles = await admin.firestore().collection('articles')
            .where('author.uid', '==', uid)
            .where('status', '==', 'published')
            .orderBy('created_at', 'desc')
            .limit(parseInt(limit))
            .get();

        const contributions = [];
        articles.forEach(doc => {
            contributions.push({
                id: doc.id,
                ...doc.data()
            });
        });

        res.json({
            success: true,
            data: contributions,
            total: contributions.length
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ===== PUT /api/users/:uid =====
router.put('/:uid', async (req, res) => {
    try {
        const { uid } = req.params;
        const { displayName, bio, website, socialLinks, preferences } = req.body;

        const updateData = {
            display_name: displayName,
            bio: bio || '',
            website: website || '',
            social_links: socialLinks || {},
            preferences: preferences || {},
            updated_at: admin.firestore.FieldValue.serverTimestamp()
        };

        await admin.firestore().collection('users').doc(uid).update(updateData);

        res.json({
            success: true,
            data: { uid, ...updateData }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ===== GET /api/users/stats =====
router.get('/stats', async (req, res) => {
    try {
        const users = await admin.firestore().collection('users').get();
        
        let total = 0;
        let active = 0;
        let banned = 0;
        let roles = {};

        users.forEach(doc => {
            const data = doc.data();
            total++;
            
            if (data.banned) banned++;
            
            if (data.last_active) {
                const lastActive = data.last_active.toDate();
                const days = (Date.now() - lastActive.getTime()) / (1000 * 60 * 60 * 24);
                if (days < 30) active++;
            }

            const role = data.role || 'user';
            roles[role] = (roles[role] || 0) + 1;
        });

        res.json({
            success: true,
            data: {
                total,
                active,
                banned,
                roles
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
