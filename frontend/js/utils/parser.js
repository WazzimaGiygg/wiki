// ============================================
// PARSER DE TEXTO WIKI
// ============================================

export class WikiParser {
    constructor() {
        this.parsers = {
            headers: this.parseHeaders.bind(this),
            formatting: this.parseFormatting.bind(this),
            lists: this.parseLists.bind(this),
            links: this.parseLinks.bind(this),
            tables: this.parseTables.bind(this),
            quotes: this.parseQuotes.bind(this),
            code: this.parseCode.bind(this)
        };
    }

    parse(wikitext) {
        if (!wikitext || typeof wikitext !== 'string') {
            return '';
        }
        
        let html = wikitext;
        
        // Aplicar parsers em ordem
        html = this.parseHeaders(html);
        html = this.parseFormatting(html);
        html = this.parseLinks(html);
        html = this.parseLists(html);
        html = this.parseTables(html);
        html = this.parseQuotes(html);
        html = this.parseCode(html);
        
        // Processar parágrafos
        html = this.processParagraphs(html);
        
        return html;
    }

    parseHeaders(text) {
        // Headers de nível 1 a 6
        const headerMap = [
            { regex: /^======(.+?)======/gm, level: 6 },
            { regex: /^=====(.+?)=====/gm, level: 5 },
            { regex: /^====(.+?)====/gm, level: 4 },
            { regex: /^===(.+?)===/gm, level: 3 },
            { regex: /^==(.+?)==/gm, level: 2 },
            { regex: /^=(.+?)=/gm, level: 1 }
        ];
        
        headerMap.forEach(({ regex, level }) => {
            text = text.replace(regex, (match, content) => {
                const id = this.generateId(content);
                return `<h${level} id="${id}">${content.trim()}</h${level}>`;
            });
        });
        
        return text;
    }

    parseFormatting(text) {
        // Negrito e itálico
        text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
        text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
        
        // Tachado
        text = text.replace(/~~(.+?)~~/g, '<del>$1</del>');
        
        // Sublinhado
        text = text.replace(/__(.+?)__/g, '<u>$1</u>');
        
        return text;
    }

    parseLinks(text) {
        // Links internos [[Página]] ou [[Página|Texto]]
        text = text.replace(/\[\[([^|\]]+)(?:\|([^\]]+))?\]\]/g, (match, target, display) => {
            const slug = this.generateSlug(target);
            const text = display || target;
            return `<a href="/article/${slug}" class="wiki-internal-link">${text}</a>`;
        });
        
        // Links externos [http://exemplo.com Texto]
        text = text.replace(/\[(https?:\/\/[^\s\]]+)\s+([^\]]+)\]/g, 
            '<a href="$1" target="_blank" rel="noopener noreferrer">$2</a>');
        
        // Links externos simples [http://exemplo.com]
        text = text.replace(/\[(https?:\/\/[^\s\]]+)\]/g, 
            '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
        
        return text;
    }

    parseLists(text) {
        const lines = text.split('\n');
        const result = [];
        let inList = false;
        let listType = null;
        
        for (let line of lines) {
            const trimmed = line;
            
            // Lista não ordenada
            if (trimmed.match(/^\* /)) {
                if (!inList) {
                    result.push('<ul>');
                    inList = true;
                    listType = 'ul';
                }
                result.push(`<li>${trimmed.replace(/^\* /, '')}</li>`);
            }
            // Lista ordenada
            else if (trimmed.match(/^# /)) {
                if (!inList) {
                    result.push('<ol>');
                    inList = true;
                    listType = 'ol';
                }
                result.push(`<li>${trimmed.replace(/^# /, '')}</li>`);
            }
            // Lista de definição
            else if (trimmed.match(/^; /)) {
                if (!inList) {
                    result.push('<dl>');
                    inList = true;
                    listType = 'dl';
                }
                result.push(`<dt>${trimmed.replace(/^; /, '')}</dt>`);
            }
            else if (trimmed.match(/^: /)) {
                if (inList && listType === 'dl') {
                    result.push(`<dd>${trimmed.replace(/^: /, '')}</dd>`);
                }
            }
            else {
                if (inList) {
                    result.push(listType === 'ul' ? '</ul>' : 
                              listType === 'ol' ? '</ol>' : '</dl>');
                    inList = false;
                    listType = null;
                }
                result.push(line);
            }
        }
        
        if (inList) {
            result.push(listType === 'ul' ? '</ul>' : 
                       listType === 'ol' ? '</ol>' : '</dl>');
        }
        
        return result.join('\n');
    }

    parseTables(text) {
        let inTable = false;
        const lines = text.split('\n');
        const result = [];
        let tableRows = [];
        
        for (let line of lines) {
            if (line.startsWith('{|')) {
                inTable = true;
                result.push('<table class="wikitable">');
                continue;
            }
            
            if (line.startsWith('|}')) {
                inTable = false;
                // Processar tabela
                if (tableRows.length > 0) {
                    // Cabeçalho
                    const headerRow = tableRows.findIndex(row => row.includes('!'));
                    if (headerRow !== -1) {
                        const headerCells = tableRows[headerRow]
                            .split('!!')
                            .map(cell => cell.replace(/^!/, '').trim());
                        result.push(`<thead><tr>${headerCells.map(c => `<th>${c}</th>`).join('')}</tr></thead>`);
                        tableRows.splice(headerRow, 1);
                    }
                    
                    // Corpo
                    if (tableRows.length > 0) {
                        result.push('<tbody>');
                        tableRows.forEach(row => {
                            const cells = row
                                .split('||')
                                .map(cell => cell.replace(/^\|/, '').trim());
                            result.push(`<tr>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`);
                        });
                        result.push('</tbody>');
                    }
                }
                result.push('</table>');
                tableRows = [];
                continue;
            }
            
            if (inTable) {
                tableRows.push(line);
            } else {
                result.push(line);
            }
        }
        
        return result.join('\n');
    }

    parseQuotes(text) {
        // Citações em bloco
        text = text.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
        text = text.replace(/^&gt;(.+)$/gm, '<blockquote>$1</blockquote>');
        
        return text;
    }

    parseCode(text) {
        // Código inline
        text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
        
        // Bloco de código
        text = text.replace(/```(\w+)?\n([\s\S]+?)\n```/g, (match, lang, code) => {
            const language = lang || 'text';
            return `<pre><code class="language-${language}">${this.escapeHtml(code.trim())}</code></pre>`;
        });
        
        return text;
    }

    processParagraphs(text) {
        const paragraphs = text.split('\n\n');
        return paragraphs.map(para => {
            const trimmed = para.trim();
            if (!trimmed) return '';
            
            // Verificar se já está encapsulado em tags
            if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
                return trimmed;
            }
            
            return `<p>${trimmed}</p>`;
        }).join('\n');
    }

    generateId(text) {
        return text
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
    }

    generateSlug(text) {
        return this.generateId(text);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ===== MÉTODOS ADICIONAIS =====

    extractTOC(html) {
        const headings = html.match(/<h[1-6][^>]*>.*?<\/h[1-6]>/g);
        if (!headings) return [];
        
        return headings.map(heading => {
            const text = heading.replace(/<[^>]*>/g, '').trim();
            const level = parseInt(heading.match(/h([1-6])/)[1]);
            const id = this.generateId(text);
            
            return { text, level, id };
        });
    }

    generateTOC(html) {
        const toc = this.extractTOC(html);
        if (toc.length === 0) return '';
        
        let tocHtml = '<div class="toc"><h2>Índice</h2><ul>';
        
        toc.forEach(item => {
            const indent = '  '.repeat(item.level - 1);
            tocHtml += `${indent}<li><a href="#${item.id}">${item.text}</a></li>`;
        });
        
        tocHtml += '</ul></div>';
        
        return tocHtml;
    }

    stripHTML(html) {
        return html.replace(/<[^>]*>/g, '');
    }

    truncate(text, maxLength = 300, suffix = '...') {
        if (text.length <= maxLength) return text;
        
        const truncated = text.substring(0, maxLength);
        const lastSpace = truncated.lastIndexOf(' ');
        
        if (lastSpace > 0) {
            return truncated.substring(0, lastSpace) + suffix;
        }
        
        return truncated + suffix;
    }
}
