class AbapEditor {
    constructor(textarea) {
        this.textarea = $(textarea);
        this.id = this.textarea.attr('id');
        this.textarea.wrap('<div class="abap-editor"></div>');
        this.container = this.textarea.parent();
        this.lineNumbers = $('<pre class="abap-editor-lines" aria-hidden="true"></pre>');
        this.highlight = $('<pre class="abap-editor-highlight" aria-hidden="true"><code></code></pre>');
        this.container.prepend(this.highlight);
        this.container.prepend(this.lineNumbers);
        this.bind();
        this.refresh();
    }

    bind() {
        this.textarea.on('input', () => this.refresh());
        this.textarea.on('scroll', () => {
            const top = this.textarea.scrollTop();
            this.highlight.scrollTop(top);
            this.lineNumbers.scrollTop(top);
            this.highlight.scrollLeft(this.textarea.scrollLeft());
        });
        this.textarea.on('keydown', event => {
            if (event.key !== 'Tab') return;
            event.preventDefault();
            const element = this.textarea[0];
            const start = element.selectionStart;
            const end = element.selectionEnd;
            const value = element.value;
            element.value = `${value.slice(0, start)}  ${value.slice(end)}`;
            element.selectionStart = element.selectionEnd = start + 2;
            this.refresh();
        });
    }

    setValue(value) { this.textarea.val(value ?? ''); this.refresh(); }
    getValue() { return this.textarea.val(); }

    refresh() {
        const source = this.getValue();
        const lineCount = Math.max(1, source.split('\n').length);
        this.lineNumbers.text(Array.from({ length: lineCount }, (_, index) => index + 1).join('\n'));
        this.highlight.find('code').html(this.highlightAbap(source));
    }

    highlightAbap(source) {
        const escaped = String(source ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const tokens = /(\*.*$|".*$|'(?:''|[^'])*')/gim;
        const keywords = /\b(ABSTRACT|ALIAS|ALIASES|APPEND|ASSIGN|AT|AUTHORITY-CHECK|BREAK-POINT|CALL|CASE|CATCH|CLASS|CLASS-DATA|CLASS-EVENTS|CLASS-METHODS|CLEAR|CONCATENATE|CONSTANTS|CONTINUE|CREATE|DATA|DELETE|DO|ELSE|ELSEIF|ENDCASE|ENDCLASS|ENDDO|ENDMETHOD|ENDIF|ENDLOOP|ENDSELECT|ENDTRY|ENDWHILE|FIELD-SYMBOLS|FINAL|FOR|FORM|FUNCTION|IF|IMPORTING|INCLUDE|INITIALIZATION|INTERFACE|LOOP|METHOD|METHODS|MODIFY|MOVE|NEW|OBJECT|OF|PARAMETERS|PRIVATE|PROTECTED|PUBLIC|RAISE|READ|RECEIVING|RETURN|RETURNING|SELECT|SECTION|SET|START-OF-SELECTION|STATICS|SUBMIT|SUPER|TABLES|THROW|TRY|TYPES|UPDATE|USING|VALUE|WHEN|WHILE|WITH|WRITE)\b/gi;
        const numbers = /\b\d+(?:\.\d+)?\b/g;
        return escaped.split(tokens).map(part => {
            if (!part) return '';
            if (/^(\*|"|'|&quot;)/.test(part)) return `<span class="abap-token-comment">${part}</span>`;
            return part.replace(keywords, '<span class="abap-token-keyword">$1</span>').replace(numbers, '<span class="abap-token-number">$&</span>');
        }).join('');
    }
}
window.AbapEditor = AbapEditor;
