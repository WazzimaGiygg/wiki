// ============================================
// MÓDULO DO EDITOR
// ============================================

import { WikiParser } from '../utils/parser.js';
import * as Helpers from '../utils/helpers.js';

export class EditorModule {
    constructor() {
        this.parser = new WikiParser();
        this.savedContent = '';
        this.autoSaveInterval = null;
        this.lastAutoSave = null;
    }

    initEditor(containerId, options = {}) {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        const editorHtml = this.createEditorHtml(options);
        container.innerHTML = editorHtml;
        
        this.setupEventListeners(container, options);
        
        if (options.initialContent) {
            this.setContent(options.initialContent);
        }
        
        // Iniciar auto-save
        if (options.autoSave) {
            this.startAutoSave(options.articleId, options.onAutoSave);
        }
        
        return container;
    }

    createEditorHtml(options = {}) {
        return `
            <div class="wiki-editor">
                <div class="toolbar">
                    <button type="button" onclick="window.editor.insertText('**', '**')">B</button>
                    <button type="button" onclick="window.editor.insertText('*', '*')">I</button>
                    <button type="button" onclick="window.editor.insertText('~~', '~~')">S</button>
                    <button type="button" onclick="window.editor.insertText('= ', ' =')">H1</button>
                    <button type="button" onclick="window.editor.insertText('== ', ' ==')">H2</button>
                    <button type="button" onclick="window.editor.insertText('=== ', ' ===')">H3</button>
                    <button type="button" onclick="window.editor.insertText('* ', '')">UL</button>
                    <button type="button" onclick="window.editor.insertText('# ', '')">OL</button>
                    <button type="button" onclick="window.editor.insertText('[', '](url)')">Link</button>
                    <button type="button" onclick="window.editor.insertText('[[', ']]')">WikiLink</button>
                    <button type="button" onclick="window.editor.insertText('```\n', '\n```')">Code</button>
                    <button type="button" onclick="window.editor.togglePreview()">Preview</button>
                </div>
                
                <div class="editor-split">
                    <div class="editor-area">
                        <textarea id="editor-content" class="editor-textarea" 
                                  placeholder="Digite o conteúdo do artigo..."></textarea>
                    </div>
                    <div class="preview-area" id="editor-preview" style="display: none;">
                        <div class="preview-content"></div>
                    </div>
                </div>
                
                <div class="editor-footer">
                    <div class="editor-status">
                        <span id="word-count">0 palavras</span>
                        <span id="char-count">0 caracteres</span>
                        ${options.autoSave ? '<span id="auto-save-status">💾 Salvando...</span>' : ''}
                    </div>
                    <div class="editor-actions">
                        <button class="btn-secondary" onclick="window.editor.cancel()">Cancelar</button>
                        <button class="btn-primary" onclick="window.editor.save()">📝 Salvar</button>
                    </div>
                </div>
            </div>
        `;
    }

    setupEventListeners(container, options) {
        const textarea = container.querySelector('#editor-content');
        const preview = container.querySelector('#editor-preview');
        const previewContent = container.querySelector('.preview-content');
        
        // Atualizar preview em tempo real
        let updatePreview = Helpers.debounce(() => {
            if (preview && preview.style.display !== 'none') {
                const content = textarea.value;
                previewContent.innerHTML = this.parser.parse(content);
            }
            
            // Atualizar contadores
            this.updateCounters(textarea);
        }, 300);
        
        textarea.addEventListener('input', updatePreview);
        
        // Atalhos de teclado
        textarea.addEventListener('keydown', (e) => {
            // Ctrl+S para salvar
            if (e.ctrlKey && e.key === 's') {
                e.preventDefault();
                this.save();
            }
            
            // Tab para indentação
            if (e.key === 'Tab') {
                e.preventDefault();
                this.insertTab(textarea);
            }
        });
    }

    togglePreview() {
        const textarea = document.getElementById('editor-content');
        const preview = document.getElementById('editor-preview');
        const previewContent = document.querySelector('.preview-content');
        
        if (preview.style.display === 'none') {
            preview.style.display = 'block';
            textarea.style.display = 'none';
            previewContent.innerHTML = this.parser.parse(textarea.value);
        } else {
            preview.style.display = 'none';
            textarea.style.display = 'block';
        }
    }

    getContent() {
        const textarea = document.getElementById('editor-content');
        return textarea ? textarea.value : '';
    }

    setContent(content) {
        const textarea = document.getElementById('editor-content');
        if (textarea) {
            textarea.value = content;
            this.savedContent = content;
        }
    }

    insertText(before, after) {
        const textarea = document.getElementById('editor-content');
        if (!textarea) return;
        
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const selected = textarea.value.substring(start, end);
        
        const newText = before + selected + after;
        textarea.value = textarea.value.substring(0, start) + newText + textarea.value.substring(end);
        
        // Restaurar seleção
        const newStart = start + before.length;
        const newEnd = newStart + selected.length;
        textarea.selectionStart = newStart;
        textarea.selectionEnd = newEnd;
        
        textarea.focus();
        
        // Disparar evento de input para atualizar preview
        textarea.dispatchEvent(new Event('input'));
    }

    insertTab(textarea) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        
        textarea.value = textarea.value.substring(0, start) + '  ' + textarea.value.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + 2;
        
        textarea.focus();
    }

    updateCounters(textarea) {
        const content = textarea.value;
        const words = content.trim() ? content.trim().split(/\s+/).length : 0;
        const chars = content.length;
        
        const wordCount = document.getElementById('word-count');
        const charCount = document.getElementById('char-count');
        
        if (wordCount) wordCount.textContent = `${words} palavra${words !== 1 ? 's' : ''}`;
        if (charCount) charCount.textContent = `${chars} caracteres`;
    }

    startAutoSave(articleId, onSave) {
        if (this.autoSaveInterval) {
            clearInterval(this.autoSaveInterval);
        }
        
        this.autoSaveInterval = setInterval(() => {
            const content = this.getContent();
            
            if (content !== this.savedContent) {
                this.savedContent = content;
                this.lastAutoSave = new Date();
                
                const status = document.getElementById('auto-save-status');
                if (status) {
                    status.textContent = '💾 Salvando...';
                    status.style.color = '#ff9800';
                }
                
                if (onSave) {
                    onSave(content);
                }
                
                setTimeout(() => {
                    if (status) {
                        status.textContent = '✅ Salvo';
                        status.style.color = '#4CAF50';
                    }
                }, 500);
            }
        }, 30000); // Auto-save a cada 30 segundos
    }

    stopAutoSave() {
        if (this.autoSaveInterval) {
            clearInterval(this.autoSaveInterval);
            this.autoSaveInterval = null;
        }
    }

    async save() {
        // Será implementado pelo controller
        if (window.onEditorSave) {
            window.onEditorSave();
        }
    }

    async cancel() {
        // Será implementado pelo controller
        if (window.onEditorCancel) {
            window.onEditorCancel();
        }
    }

    destroy() {
        this.stopAutoSave();
        this.savedContent = '';
        this.lastAutoSave = null;
    }
}
