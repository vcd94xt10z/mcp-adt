class InterfacesPage {
    constructor(app) {
        this.app = app;
        this.current = null;
        this.pendingDelete = null;
        this.bound = false;
        this.editor = null;
        this.resourcesLoaded = false;
    }

    async activate() {
        await this.loadResources();
        if (!this.bound) this.bind();
    }

    async loadResources() {
        if (this.resourcesLoaded) return;
        if (!window.ValueHelp) await $.getScript('/js/valuehelp/value-help.js');
        if (!window.packageValueHelp) await $.getScript('/js/valuehelp/package-value-help.js');
        if (!window.requestValueHelp) await $.getScript('/js/valuehelp/request-value-help.js');
        if (!window.AbapEditor) await $.getScript('/js/abap-editor.js');
        this.editor = new AbapEditor('#interfaceSource');
        this.resourcesLoaded = true;
    }

    bind() {
        this.bound = true;
        $('#interfaceSearch').on('click', () => this.search());
        $('#interfaceSearchQuery, #interfaceSearchMax').on('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                this.search();
            }
        });
        $('#newInterface').on('click', () => this.openCreate());
        $('#interfaceGenerateSkeleton').on('click', () => this.generateSkeleton());
        $('#interfaceForm').on('submit', event => { event.preventDefault(); this.save(); });
        $('#interfaceCheckSyntax').on('click', () => this.checkSyntax());
        $('#interfaceActivate').on('click', () => this.activateInterface());
        $('#interfaceDeleteConfirm').on('click', () => this.deleteInterface());
        $('#interfaceResults').on('click', '[data-action]', event => this.action(event));
        $(document).on('click', '#interfacesPage .value-help-button', event => this.openValueHelp($(event.currentTarget).data('value-help')));
    }

    openValueHelp(type) {
        if (type === 'package') return window.packageValueHelp.open(item => $('#interfacePackage').val(item.name));
        if (type === 'request') return window.requestValueHelp.open(item => $('#interfaceTransport').val(item.number));
        if (type === 'delete-request') return window.requestValueHelp.open(item => $('#interfaceDeleteTransport').val(item.number));
    }

    generateSkeleton() {
        const name = $('#interfaceName').val().trim().toUpperCase();
        if (!name) {
            this.app.showToast('Nome obrigatório', 'Informe o nome da interface antes de gerar o esboço.', false);
            $('#interfaceName').trigger('focus');
            return;
        }
        this.editor.setValue(`INTERFACE ${name} PUBLIC.\n\n  METHODS example.\n\nENDINTERFACE.`);
    }

    async search() {
        try {
            const result = await this.execute('interface_list', { query: $('#interfaceSearchQuery').val(), maxResults: Number($('#interfaceSearchMax').val()) || 100 });
            const items = result.result.items || [];
            const rows = items.map(item => `<tr><td>${this.escape(item.name)}</td><td>${this.escape(item.description || '')}</td><td>${this.escape(item.packageName || '')}</td><td class="table-actions"><button class="btn btn-sm btn-outline-primary" data-action="open" data-name="${this.escapeAttr(item.name)}">Editar</button><button class="btn btn-sm btn-outline-success" data-action="activate" data-name="${this.escapeAttr(item.name)}">Ativar</button><button class="btn btn-sm btn-outline-danger" data-action="delete" data-name="${this.escapeAttr(item.name)}">Excluir</button></td></tr>`).join('');
            $('#interfaceResults').html(`<table class="table table-hover align-middle"><thead><tr><th>Nome</th><th>Descrição</th><th>Pacote</th><th>Ações</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="text-center text-secondary">Nenhuma interface encontrada.</td></tr>'}</tbody></table>`);
        } catch (error) { this.app.showError(error.data || { error: error.message }); }
    }

    async openCreate() {
        this.current = null;
        $('#interfaceForm')[0].reset();
        $('#interfaceLanguage').val(await this.app.currentConnectionLanguage()).prop('readonly', true).addClass('readonly-field');
        $('#interfaceFormTitle').text('Nova interface');
        $('#interfaceName,#interfacePackage,#interfaceDescription,#interfaceTransport').prop('readonly', false);
        $('#interfaceVisibility').prop('disabled', false);
        $('.value-help-button').prop('disabled', false);
        $('#interfaceCheckSyntax,#interfaceActivate').hide();
        this.editor.setValue('');
        this.modal('interfaceModal').show();
    }

    async action(event) {
        const button = $(event.currentTarget);
        const name = button.data('name');
        if (button.data('action') === 'delete') return this.confirmDelete(name);
        if (button.data('action') === 'activate') return this.activateResult(name);
        try {
            const data = await this.execute('interface_get', { name });
            this.current = data.result;
            const item = data.result.interface;
            $('#interfaceForm')[0].reset();
            $('#interfaceFormTitle').text(`Interface ${item.name}`);
            $('#interfaceName').val(item.name).prop('readonly', true);
            $('#interfaceDescription').val(item.description);
            $('#interfacePackage').val(item.packageName).prop('readonly', true);
            $('#interfaceLanguage').val(await this.app.currentConnectionLanguage()).prop('readonly', true).addClass('readonly-field');
            $('#interfaceTransport').val(data.result.transport?.number || '').prop('readonly', true);
            $('#interfaceVisibility').val(item.visibility || 'public').prop('disabled', true);
            $('.value-help-button[data-value-help="package"],.value-help-button[data-value-help="request"]').prop('disabled', true);
            this.editor.setValue(data.result.source.source || '');
            $('#interfaceCheckSyntax,#interfaceActivate').show();
            this.modal('interfaceModal').show();
        } catch (error) { this.app.showError(error.data || { error: error.message }); }
    }

    async activateResult(name) {
        try {
            await this.execute('interface_activate', { name });
            this.app.showToast('Sucesso', `Interface ${name} ativada.`);
        } catch (error) {
            this.app.showError(error.data || { error: error.message });
        }
    }

    async save() {
        try {
            const name = $('#interfaceName').val().trim();
            const source = this.editor.getValue();
            const transport = $('#interfaceTransport').val().trim();
            if (this.current) await this.execute('interface_update', {
                name,
                description: $('#interfaceDescription').val().trim(),
                packageName: $('#interfacePackage').val().trim(),
                transport,
                language: $('#interfaceLanguage').val().trim(),
                responsible: this.current.interface?.responsible || '',
                final: this.current.interface?.final !== false,
                visibility: this.current.interface?.visibility || 'public',
                source
            });
            else await this.execute('interface_create', { name, description: $('#interfaceDescription').val().trim(), packageName: $('#interfacePackage').val().trim(), transport, language: $('#interfaceLanguage').val().trim(), visibility: $('#interfaceVisibility').val(), source });
            this.app.showToast('Sucesso', this.current ? 'Interface atualizada.' : 'Interface criada.');
            await this.search();
        } catch (error) { this.app.showError(error.data || { error: error.message }); }
    }

    // Executa a verificação de sintaxe no SAP usando o ABAP Check Run do Eclipse ADT.
    async checkSyntax() {
        const name = $('#interfaceName').val().trim();
        if (!name) {
            this.app.showToast('Nome obrigatório', 'Informe ou salve a interface antes de verificar a sintaxe.', false);
            return;
        }
        try {
            const source = this.editor ? this.editor.getValue() : '';
            const version = this.current?.version || 'active';
            const data = await this.execute('interface_check_syntax', { name, source, version });
            this.showSyntaxResult(name, data.result);
        } catch (error) {
            this.app.showError(error.data || { error: error.message });
        }
    }

    // Exibe as mensagens de sintaxe retornadas pelo SAP com linha e coluna.
    showSyntaxResult(name, result) {
        const messages = result.messages || [];
        $('#interfaceSyntaxName').text(name);
        const errors = messages.filter(message => message.type === 'E').length;
        const warnings = messages.filter(message => message.type === 'W').length;
        const summary = messages.length === 0
            ? { css: 'alert-success', text: 'Nenhum erro de sintaxe encontrado.' }
            : { css: errors ? 'alert-danger' : warnings ? 'alert-warning' : 'alert-info', text: `${messages.length} mensagem(ns) encontrada(s): ${errors} erro(s), ${warnings} aviso(s).` };
        $('#interfaceSyntaxSummary').removeClass('alert-success alert-danger alert-warning alert-info').addClass(summary.css).text(summary.text);
        $('#interfaceSyntaxMessages').html(messages.map(message => `<tr><td>${this.escape(message.type)}</td><td>${message.line || '-'}</td><td>${message.column || '-'}</td><td>${this.escape(message.shortText || '')}</td></tr>`).join('') || '<tr><td colspan="4" class="text-center text-secondary">Nenhuma mensagem retornada.</td></tr>');
        this.modal('interfaceSyntaxModal').show();
    }

    async activateInterface() { try { await this.execute('interface_activate', { name: $('#interfaceName').val().trim() }); this.app.showToast('Sucesso', 'Interface ativada.'); } catch (error) { this.app.showError(error.data || { error: error.message }); } }

    async confirmDelete(name) {
        this.pendingDelete = name;
        $('#interfaceDeleteText').text(`Deseja realmente excluir a interface '${name}'?`);
        $('#interfaceDeleteTransport').val('').prop('readonly', true);
        $('#interfaceDeleteModal .value-help-button[data-value-help="delete-request"]').prop('disabled', true);
        this.modal('interfaceDeleteModal').show();
        try {
            const data = await this.execute('interface_delete_check', { name });
            const transport = data.result.transport || '';
            $('#interfaceDeleteTransport').val(transport);
        } catch (error) {
            this.app.showError(error.data || { error: error.message });
        }
    }

    async deleteInterface() {
        try {
            await this.execute('interface_delete', { name: this.pendingDelete, transport: $('#interfaceDeleteTransport').val().trim() });
            this.modal('interfaceDeleteModal').hide();
            this.app.showToast('Sucesso', 'Interface excluída.');
            await this.search();
        } catch (error) { this.app.showError(error.data || { error: error.message }); }
    }

    async execute(operation, input) { return this.app.executeOperation(operation, input); }
    modal(id) { return bootstrap.Modal.getOrCreateInstance(document.getElementById(id)); }
    escape(value) { return $('<div>').text(value ?? '').html(); }
    escapeAttr(value) { return this.escape(value).replaceAll('"', '&quot;'); }
}
window.interfacesPage = new InterfacesPage(window.app);
