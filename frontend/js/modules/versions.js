// ============================================
// SISTEMA DE VERSÕES E HISTÓRICO
// ============================================

export class VersionSystem {
    constructor(articleId) {
        this.articleId = articleId;
        this.versions = [];
    }
    
    async loadVersions() {
        const snapshot = await db
            .collection('revisions')
            .doc(this.articleId)
            .collection('versions')
            .orderBy('version', 'desc')
            .get();
        
        this.versions = [];
        snapshot.forEach(doc => {
            this.versions.push({
                id: doc.id,
                ...doc.data()
            });
        });
        
        return this.versions;
    }
    
    async getVersion(versionNumber) {
        const snapshot = await db
            .collection('revisions')
            .doc(this.articleId)
            .collection('versions')
            .where('version', '==', versionNumber)
            .get();
        
        if (snapshot.empty) return null;
        
        const doc = snapshot.docs[0];
        return {
            id: doc.id,
            ...doc.data()
        };
    }
    
    async restoreVersion(versionNumber, user) {
        const version = await this.getVersion(versionNumber);
        if (!version) {
            throw new Error('Versão não encontrada');
        }
        
        // Criar nova versão com conteúdo restaurado
        const current = await this.getLatestVersion();
        const newVersion = current ? current.version + 1 : 1;
        
        await db
            .collection('revisions')
            .doc(this.articleId)
            .collection('versions')
            .add({
                version: newVersion,
                content: version.content,
                changes_summary: `Restaurado para versão ${versionNumber}`,
                editor: {
                    uid: user.uid,
                    name: user.displayName
                },
                timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                restored_from: versionNumber
            });
        
        // Atualizar artigo principal
        await db.collection('articles').doc(this.articleId).update({
            content: version.content,
            version: newVersion,
            updated_at: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        return newVersion;
    }
    
    async getDiff(version1, version2) {
        const v1 = await this.getVersion(version1);
        const v2 = await this.getVersion(version2);
        
        if (!v1 || !v2) {
            throw new Error('Versões não encontradas');
        }
        
        return this.diffStrings(v1.content, v2.content);
    }
    
    diffStrings(oldText, newText) {
        const lines1 = oldText.split('\n');
        const lines2 = newText.split('\n');
        
        const diff = [];
        let i = 0, j = 0;
        
        while (i < lines1.length || j < lines2.length) {
            if (i < lines1.length && j < lines2.length && lines1[i] === lines2[j]) {
                diff.push({
                    type: 'same',
                    content: lines1[i]
                });
                i++;
                j++;
            } else if (i < lines1.length && (j >= lines2.length || lines1[i] !== lines2[j])) {
                diff.push({
                    type: 'removed',
                    content: lines1[i]
                });
                i++;
            } else if (j < lines2.length && (i >= lines1.length || lines1[i] !== lines2[j])) {
                diff.push({
                    type: 'added',
                    content: lines2[j]
                });
                j++;
            }
        }
        
        return diff;
    }
}
