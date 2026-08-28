// ============================================
// SISTEMA DE AUTENTICAÇÃO
// ============================================

export class AuthService {
    constructor() {
        this.currentUser = null;
        this.userProfile = null;
        this.isGuest = false;
        this.listeners = [];
        this.initialized = false;
    }

    async init() {
        if (this.initialized) return;
        
        return new Promise((resolve) => {
            firebase.auth().onAuthStateChanged(async (user) => {
                if (user) {
                    this.currentUser = user;
                    this.isGuest = false;
                    this.userProfile = await this.loadUserProfile(user.uid);
                    
                    // Verificar banimento
                    if (this.userProfile?.banned) {
                        this.showBannedScreen(this.userProfile.ban_reason);
                        await this.logout();
                        resolve();
                        return;
                    }
                    
                    this.notifyListeners('login', this.currentUser);
                } else {
                    // Verificar usuário convidado
                    const guest = this.getGuestUser();
                    if (guest) {
                        this.currentUser = guest;
                        this.isGuest = true;
                        this.userProfile = null;
                        this.notifyListeners('guest', guest);
                    } else {
                        this.currentUser = null;
                        this.isGuest = false;
                        this.userProfile = null;
                        this.notifyListeners('logout');
                    }
                }
                
                this.initialized = true;
                resolve();
            });
        });
    }

    async loadUserProfile(uid) {
        try {
            const doc = await db.collection('users').doc(uid).get();
            if (doc.exists) {
                return { uid, ...doc.data() };
            }
            
            // Criar perfil se não existir
            const user = firebase.auth().currentUser;
            const newProfile = {
                uid: uid,
                username: user?.displayName || `user_${uid.substring(0, 8)}`,
                display_name: user?.displayName || 'Usuário',
                email: user?.email || '',
                avatar: user?.photoURL || '',
                role: 'user',
                reputation: 0,
                contributions: 0,
                join_date: firebase.firestore.FieldValue.serverTimestamp(),
                last_active: firebase.firestore.FieldValue.serverTimestamp(),
                preferences: {
                    theme: 'light',
                    language: 'pt-BR'
                }
            };
            
            await db.collection('users').doc(uid).set(newProfile);
            return newProfile;
            
        } catch (error) {
            console.error('Erro ao carregar perfil:', error);
            return null;
        }
    }

    async loginWithGoogle() {
        try {
            const provider = new firebase.auth.GoogleAuthProvider();
            provider.setCustomParameters({
                prompt: 'select_account'
            });
            
            const result = await firebase.auth().signInWithPopup(provider);
            this.currentUser = result.user;
            
            // Atualizar perfil
            this.userProfile = await this.loadUserProfile(result.user.uid);
            this.isGuest = false;
            
            this.notifyListeners('login', this.currentUser);
            return result.user;
            
        } catch (error) {
            console.error('Erro no login Google:', error);
            throw error;
        }
    }

    async loginWithEmail(email, password) {
        try {
            const result = await firebase.auth().signInWithEmailAndPassword(email, password);
            this.currentUser = result.user;
            this.userProfile = await this.loadUserProfile(result.user.uid);
            this.isGuest = false;
            
            this.notifyListeners('login', this.currentUser);
            return result.user;
            
        } catch (error) {
            console.error('Erro no login com email:', error);
            throw error;
        }
    }

    async registerWithEmail(email, password, displayName) {
        try {
            const result = await firebase.auth().createUserWithEmailAndPassword(email, password);
            
            // Atualizar display name
            await result.user.updateProfile({
                displayName: displayName
            });
            
            this.currentUser = result.user;
            this.userProfile = await this.loadUserProfile(result.user.uid);
            this.isGuest = false;
            
            this.notifyListeners('login', this.currentUser);
            return result.user;
            
        } catch (error) {
            console.error('Erro no registro:', error);
            throw error;
        }
    }

    async logout() {
        try {
            if (this.isGuest) {
                this.clearGuestUser();
                this.currentUser = null;
                this.isGuest = false;
                this.userProfile = null;
                this.notifyListeners('logout');
                return;
            }
            
            await firebase.auth().signOut();
            this.currentUser = null;
            this.isGuest = false;
            this.userProfile = null;
            this.notifyListeners('logout');
            
        } catch (error) {
            console.error('Erro no logout:', error);
            throw error;
        }
    }

    createGuestUser() {
        const guestId = 'guest_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
        const guest = {
            uid: guestId,
            displayName: 'Convidado',
            email: `${guestId}@guest.wikizero.local`,
            isGuest: true,
            photoURL: null,
            createdAt: new Date().toISOString()
        };
        
        localStorage.setItem('wikizero_guest', JSON.stringify(guest));
        return guest;
    }

    getGuestUser() {
        const stored = localStorage.getItem('wikizero_guest');
        if (stored) {
            try {
                const guest = JSON.parse(stored);
                // Validar se não expirou (24h)
                const createdAt = new Date(guest.createdAt);
                const now = new Date();
                const diff = (now - createdAt) / (1000 * 60 * 60);
                
                if (diff < 24) {
                    return guest;
                } else {
                    this.clearGuestUser();
                }
            } catch (e) {
                this.clearGuestUser();
            }
        }
        return null;
    }

    clearGuestUser() {
        localStorage.removeItem('wikizero_guest');
    }

    showBannedScreen(reason = 'Violação das políticas de uso') {
        const overlay = document.createElement('div');
        overlay.id = 'bannedOverlay';
        overlay.className = 'banned-overlay show';
        overlay.innerHTML = `
            <div class="banned-box">
                <div class="icon">🚫</div>
                <h2>⚠️ Conta Banida</h2>
                <p>Sua conta foi banida permanentemente do sistema.</p>
                <div class="ban-details">Motivo: ${reason}</div>
                <button class="btn-logout-banned" onclick="window.WikiZero?.auth?.logout()">🚪 Sair da conta</button>
            </div>
        `;
        document.body.appendChild(overlay);
    }

    addListener(callback) {
        this.listeners.push(callback);
    }

    notifyListeners(event, data) {
        this.listeners.forEach(callback => callback(event, data));
    }

    async isAuthenticated() {
        return !!this.currentUser && !this.isGuest;
    }

    async getCurrentUser() {
        return this.currentUser;
    }

    async getCurrentProfile() {
        if (this.userProfile) return this.userProfile;
        if (this.currentUser) {
            this.userProfile = await this.loadUserProfile(this.currentUser.uid);
            return this.userProfile;
        }
        return null;
    }

    async hasRole(requiredRole) {
        const profile = await this.getCurrentProfile();
        if (!profile) return false;
        
        const roles = ['user', 'editor', 'moderator', 'admin', 'bureaucrat'];
        const userLevel = roles.indexOf(profile.role);
        const requiredLevel = roles.indexOf(requiredRole);
        
        return userLevel >= requiredLevel;
    }

    async hasPermission(permission) {
        const profile = await this.getCurrentProfile();
        if (!profile) return false;
        
        // Admin tem todas as permissões
        if (profile.role === 'admin' || profile.role === 'bureaucrat') {
            return true;
        }
        
        // Definir permissões por role
        const permissions = {
            'user': ['read', 'comment', 'create_article', 'edit_own'],
            'editor': ['read', 'comment', 'create_article', 'edit_any', 'delete_own'],
            'moderator': ['read', 'comment', 'create_article', 'edit_any', 'delete_any', 'moderate']
        };
        
        return permissions[profile.role]?.includes(permission) || false;
    }
}
