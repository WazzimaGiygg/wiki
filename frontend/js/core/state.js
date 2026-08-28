// ============================================
// GERENCIADOR DE ESTADO GLOBAL
// ============================================

export class StateManager {
    constructor() {
        this.state = {
            user: null,
            theme: 'light',
            language: 'pt-BR',
            notifications: [],
            unreadCount: 0,
            currentArticle: null,
            categories: [],
            loading: false,
            error: null
        };
        
        this.listeners = new Map();
        this.persistentKeys = ['theme', 'language'];
        this.loadPersistentState();
    }

    get(key) {
        return this.state[key];
    }

    set(key, value, persist = false) {
        const oldValue = this.state[key];
        this.state[key] = value;
        
        if (persist || this.persistentKeys.includes(key)) {
            this.saveToStorage(key, value);
        }
        
        this.notify(key, value, oldValue);
    }

    update(updates) {
        const oldState = { ...this.state };
        this.state = { ...this.state, ...updates };
        
        // Salvar persistentes
        this.persistentKeys.forEach(key => {
            if (updates[key] !== undefined) {
                this.saveToStorage(key, updates[key]);
            }
        });
        
        // Notificar mudanças
        Object.keys(updates).forEach(key => {
            this.notify(key, updates[key], oldState[key]);
        });
    }

    subscribe(key, callback) {
        if (!this.listeners.has(key)) {
            this.listeners.set(key, []);
        }
        this.listeners.get(key).push(callback);
        
        // Retornar função para unsubscribe
        return () => {
            const callbacks = this.listeners.get(key);
            const index = callbacks.indexOf(callback);
            if (index > -1) {
                callbacks.splice(index, 1);
            }
        };
    }

    notify(key, newValue, oldValue) {
        const callbacks = this.listeners.get(key);
        if (callbacks) {
            callbacks.forEach(callback => {
                try {
                    callback(newValue, oldValue);
                } catch (error) {
                    console.error(`Erro no listener para ${key}:`, error);
                }
            });
        }
    }

    saveToStorage(key, value) {
        try {
            localStorage.setItem(`wikizero_${key}`, JSON.stringify(value));
        } catch (error) {
            console.error('Erro ao salvar estado:', error);
        }
    }

    loadPersistentState() {
        this.persistentKeys.forEach(key => {
            try {
                const stored = localStorage.getItem(`wikizero_${key}`);
                if (stored) {
                    this.state[key] = JSON.parse(stored);
                }
            } catch (error) {
                console.error('Erro ao carregar estado persistente:', error);
            }
        });
    }

    reset() {
        const persistentState = {};
        this.persistentKeys.forEach(key => {
            persistentState[key] = this.state[key];
        });
        
        this.state = {
            user: null,
            theme: persistentState.theme || 'light',
            language: persistentState.language || 'pt-BR',
            notifications: [],
            unreadCount: 0,
            currentArticle: null,
            categories: [],
            loading: false,
            error: null
        };
    }

    // Helpers específicos
    setLoading(loading) {
        this.set('loading', loading);
    }

    setError(error) {
        this.set('error', error);
    }

    addNotification(notification) {
        const notifications = this.get('notifications');
        notifications.unshift(notification);
        this.set('notifications', notifications);
        this.set('unreadCount', this.get('unreadCount') + 1);
    }

    markNotificationRead(notificationId) {
        const notifications = this.get('notifications');
        const index = notifications.findIndex(n => n.id === notificationId);
        if (index > -1 && !notifications[index].read) {
            notifications[index].read = true;
            this.set('notifications', notifications);
            this.set('unreadCount', this.get('unreadCount') - 1);
        }
    }

    markAllNotificationsRead() {
        const notifications = this.get('notifications');
        notifications.forEach(n => n.read = true);
        this.set('notifications', notifications);
        this.set('unreadCount', 0);
    }
}
