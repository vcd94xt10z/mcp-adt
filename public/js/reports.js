class ReportsPage {
    constructor(app) { this.app = app; this.current = null; this.pendingDelete = null; this.bound = false; this.editor = null; this.resourcesLoaded = false; }

    async activate() { await this.loadResources(); if (!this.bound) this.bind(); }

    async loadResources() {
        if (this.resourcesLoaded) return;
        await $.getScript('/js/valuehelp/value-help.js');
        await $.getScript('/js/valuehelp/package-value-help.js');
        await $.getScript('/js/valuehelp/request-value-help.js');
        await $.getScript('/js/valuehelp/language-value-help.js');
        if (!window.AbapEditor) await $.getScript('/js/abap-editor.js');
        this.editor = new AbapEditor('#reportSource');
        this.resourcesLoaded = true;
    }

    bind() {
        this.bound = true;
        $('#reportSearch').on('click', () => this.search());
        $('#reportSearchQuery,#reportSearchMax').on('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); this.search(); } });
        $('#newReport').on('click', () => this.openCreate());
        $('#reportGenerateSkeleton').on('click', () => this.generateSkeleton());
        $('#reportForm').on('submit', event => { event.preventDefault(); this.save(); });
        $('#reportCheckSyntax').on('click', () => this.checkSyntax());
        $('#reportActivate').on('click', () => this.activateReport());
        $('#reportDeleteConfirm').on('click', () => this.deleteReport());
        $('#reportResults').on('click', '[data-action]', event => this.action(event));
        $(document).on('click', '#reportsPage .value-help-button', event => this.openValueHelp($(event.currentTarget).data('value-help')));
    }

    openValueHelp(type) {
        if (type === 'package') return window.packageValueHelp.open(async item => {
            const validation = await this.execute('package_validate_object', { name: item.name, objectType: 'PROG/P' });
            if (!validation.result.compatible) {
                this.app.showToast('Pacote não pode ser usado para Report', validation.result.details, false);
                return false;
            }
            $('#reportPackage').val(item.name);
            return true;
        });
        if (type === 'request') return window.requestValueHelp.open(item => $('#reportTransport').val(item.number));
        if (type === 'language') return window.languageValueHelp.open(item => $('#reportLanguage').val(item.code || item));
    }

    generateSkeleton() {
        const name = $('#reportName').val().trim().toUpperCase();
        if (!name) { this.app.showToast('Nome obrigatório', 'Informe o nome do report antes de gerar o esboço.', false); $('#reportName').trigger('focus'); return; }
        this.editor.setValue(`*&---------------------------------------------------------------------*\n*& Report ${name}\n*&---------------------------------------------------------------------*\n*&\n*&---------------------------------------------------------------------*\nREPORT ${name}.\n\n`);
    }

    async search() {
        try {
            const data = await this.execute('report_list', { query: $('#reportSearchQuery').val(), maxResults: Number($('#reportSearchMax').val()) || 100 });
            const rows = (data.result.items || []).map(item => `<tr><td>${this.escape(item.name)}</td><td>${this.escape(item.description || '')}</td><td>${this.escape(item.packageName || '')}</td><td class="table-actions"><button class="btn btn-sm btn-outline-primary" data-action="edit" data-name="${this.escapeAttr(item.name)}">Editar</button><button class="btn btn-sm btn-outline-success" data-action="activate" data-name="${this.escapeAttr(item.name)}">Ativar</button><button class="btn btn-sm btn-outline-danger" data-action="delete" data-name="${this.escapeAttr(item.name)}">Excluir</button></td></tr>`).join('');
            $('#reportResults').html(`<table class="table table-hover align-middle"><thead><tr><th>Nome</th><th>Descrição</th><th>Pacote</th><th>Ações</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="text-center text-secondary">Nenhum report encontrado.</td></tr>'}</tbody></table>`);
        } catch (error) { this.app.showError(error.data || { error: error.message }); }
    }

    openCreate() {
        this.current = null; $('#reportForm')[0].reset(); $('#reportLanguage').val('EN'); $('#reportFormTitle').text('Novo report');
        $('#reportName,#reportDescription,#reportPackage,#reportLanguage,#reportTransport').prop('readonly', false);
        $('#reportsPage .value-help-button').prop('disabled', false); $('#reportCheckSyntax,#reportActivate').hide(); this.editor.setValue(''); this.modal('reportModal').show();
    }

    async action(event) {
        const button = $(event.currentTarget); const name = button.data('name'); const action = button.data('action');
        if (action === 'delete') return this.confirmDelete(name);
        if (action === 'activate') return this.activateResult(name);
        try {
            const data = await this.execute('report_get', { name }); this.current = data.result; const item = data.result.report;
            $('#reportForm')[0].reset(); $('#reportFormTitle').text(`Report ${item.name}`); $('#reportName').val(item.name).prop('readonly', true);
            $('#reportDescription').val(item.description).prop('readonly', false); $('#reportPackage').val(item.packageName).prop('readonly', true);
            $('#reportLanguage').val(item.language || 'EN').prop('readonly', true); $('#reportTransport').val(data.result.transport?.number || '').prop('readonly', true);
            $('#reportsPage .value-help-button[data-value-help="package"],#reportsPage .value-help-button[data-value-help="language"],#reportsPage .value-help-button[data-value-help="request"]').prop('disabled', true);
            this.editor.setValue(data.result.source.source || ''); $('#reportCheckSyntax,#reportActivate').show(); this.modal('reportModal').show();
        } catch (error) { this.app.showError(error.data || { error: error.message }); }
    }

    async save() {
        try {
            const input = { name: $('#reportName').val().trim(), description: $('#reportDescription').val().trim(), packageName: $('#reportPackage').val().trim(), transport: $('#reportTransport').val().trim(), language: $('#reportLanguage').val().trim() || 'EN', source: this.editor.getValue() };
            if (this.current) await this.execute('report_update', { ...input, responsible: this.current.report?.responsible || '' }); else await this.execute('report_create', input);
            this.app.showToast('Sucesso', this.current ? 'Report atualizado.' : 'Report criado.'); await this.search();
        } catch (error) { this.app.showError(error.data || { error: error.message }); }
    }

    // Executa a verificação de sintaxe no SAP usando o ABAP Check Run do Eclipse ADT.
    async checkSyntax() {
        const name = $('#reportName').val().trim();
        if (!name) {
            this.app.showToast('Nome obrigatório', 'Informe ou salve o report antes de verificar a sintaxe.', false);
            return;
        }
        try {
            const source = this.editor ? this.editor.getValue() : '';
            const version = this.current?.version || 'active';
            const data = await this.execute('report_check_syntax', { name, source, version });
            this.showSyntaxResult(name, data.result);
        } catch (error) {
            this.app.showError(error.data || { error: error.message });
        }
    }

    // Exibe as mensagens de sintaxe retornadas pelo SAP com linha e coluna.
    showSyntaxResult(name, result) {
        const messages = result.messages || [];
        $('#reportSyntaxName').text(name);
        const errors = messages.filter(message => message.type === 'E').length;
        const warnings = messages.filter(message => message.type === 'W').length;
        const summary = messages.length === 0
            ? { css: 'alert-success', text: 'Nenhum erro de sintaxe encontrado.' }
            : { css: errors ? 'alert-danger' : warnings ? 'alert-warning' : 'alert-info', text: `${messages.length} mensagem(ns) encontrada(s): ${errors} erro(s), ${warnings} aviso(s).` };
        $('#reportSyntaxSummary').removeClass('alert-success alert-danger alert-warning alert-info').addClass(summary.css).text(summary.text);
        $('#reportSyntaxMessages').html(messages.map(message => `<tr><td>${this.escape(message.type)}</td><td>${message.line || '-'}</td><td>${message.column || '-'}</td><td>${this.escape(message.shortText || '')}</td></tr>`).join('') || '<tr><td colspan="4" class="text-center text-secondary">Nenhuma mensagem retornada.</td></tr>');
        this.modal('reportSyntaxModal').show();
    }

    async activateResult(name) { try { await this.execute('report_activate', { name }); this.app.showToast('Sucesso', `Report ${name} ativado.`); } catch (error) { this.app.showError(error.data || { error: error.message }); } }
    async activateReport() { return this.activateResult($('#reportName').val().trim()); }

    async confirmDelete(name) {
        this.pendingDelete = name; $('#reportDeleteText').text(`Deseja realmente excluir o report '${name}'?`); $('#reportDeleteTransport').val(''); this.modal('reportDeleteModal').show();
        try { const data = await this.execute('report_delete_check', { name }); $('#reportDeleteTransport').val(data.result.transport || ''); } catch (error) { this.app.showError(error.data || { error: error.message }); }
    }

    async deleteReport() {
        try { await this.execute('report_delete', { name: this.pendingDelete, transport: $('#reportDeleteTransport').val().trim() }); this.modal('reportDeleteModal').hide(); this.app.showToast('Sucesso', 'Report excluído.'); await this.search(); }
        catch (error) { this.app.showError(error.data || { error: error.message }); }
    }

    async execute(operation, input) { return this.app.executeOperation(operation, input); }
    modal(id) { return bootstrap.Modal.getOrCreateInstance(document.getElementById(id)); }
    escape(value) { return $('<div>').text(value ?? '').html(); }
    escapeAttr(value) { return this.escape(value).replaceAll('"', '&quot;'); }
}
window.reportsPage = new ReportsPage(window.app);
