class ClassesPage {
    constructor(app) { this.app = app; this.current = null; this.pendingDelete = null; this.bound = false; }
    async activate() { if (!this.bound) this.bind(); }
    bind() {
        this.bound = true;
        $('#classSearch').on('click', () => this.search());
        $('#newClass').on('click', () => this.openCreate());
        $('#classForm').on('submit', event => { event.preventDefault(); this.save(); });
        $('#classActivate').on('click', () => this.activateClass());
        $('#classDeleteConfirm').on('click', () => this.deleteClass());
        $('#classResults').on('click', '[data-action]', event => this.action(event));
    }
    async search() {
        try {
            const result = await this.execute('class_list', { query: $('#classSearchQuery').val(), maxResults: Number($('#classSearchMax').val()) || 100 });
            const items = result.result.items || [];
            const rows = items.map(item => `<tr><td>${this.escape(item.name)}</td><td>${this.escape(item.description || '')}</td><td>${this.escape(item.packageName || '')}</td><td><div class="btn-group btn-group-sm"><button class="btn btn-outline-primary" data-action="open" data-name="${this.escapeAttr(item.name)}">Abrir</button><button class="btn btn-outline-danger" data-action="delete" data-name="${this.escapeAttr(item.name)}">Excluir</button></div></td></tr>`).join('');
            $('#classResults').html(`<table class="table table-hover align-middle"><thead><tr><th>Nome</th><th>Descrição</th><th>Pacote</th><th>Ações</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="text-center text-secondary">Nenhuma classe encontrada.</td></tr>'}</tbody></table>`);
        } catch (error) { this.app.showError(error.data || { error: error.message }); }
    }
    openCreate() {
        this.current = null; $('#classForm')[0].reset(); $('#classFormTitle').text('Nova classe'); $('#className,#classPackage,#classDescription,#classLanguage,#classVisibility').prop('readonly', false); $('#classActivate').hide(); this.modal('classModal').show();
    }
    async action(event) {
        const button = $(event.currentTarget); const name = button.data('name');
        if (button.data('action') === 'delete') return this.confirmDelete(name);
        try { const data = await this.execute('class_get', { name }); this.current = data.result; const item = data.result.class; $('#classForm')[0].reset(); $('#classFormTitle').text(`Classe ${item.name}`); $('#className').val(item.name).prop('readonly', true); $('#classDescription').val(item.description); $('#classPackage').val(item.packageName).prop('readonly', true); $('#classLanguage').val(item.language || 'EN').prop('readonly', true); $('#classVisibility').val(item.visibility || 'public').prop('disabled', true); $('#classSource').val(data.result.source.source || ''); $('#classActivate').show(); this.modal('classModal').show(); } catch (error) { this.app.showError(error.data || { error: error.message }); }
    }
    async save() {
        try {
            const name = $('#className').val().trim(); const source = $('#classSource').val(); const transport = $('#classTransport').val().trim();
            if (this.current) await this.execute('class_update_source', { name, source, transport });
            else await this.execute('class_create', { name, description: $('#classDescription').val().trim(), packageName: $('#classPackage').val().trim(), transport, language: $('#classLanguage').val().trim() || 'EN', visibility: $('#classVisibility').val(), source });
            this.modal('classModal').hide(); this.app.showToast('Sucesso', this.current ? 'Classe atualizada.' : 'Classe criada.'); await this.search();
        } catch (error) { this.app.showError(error.data || { error: error.message }); }
    }
    async activateClass() { try { await this.execute('class_activate', { name: $('#className').val().trim() }); this.app.showToast('Sucesso', 'Classe ativada.'); } catch (error) { this.app.showError(error.data || { error: error.message }); } }
    confirmDelete(name) { this.pendingDelete = name; $('#classDeleteText').text(`Deseja realmente excluir a classe '${name}'?`); $('#classDeleteTransport').val(''); this.modal('classDeleteModal').show(); }
    async deleteClass() { try { await this.execute('class_delete', { name: this.pendingDelete, transport: $('#classDeleteTransport').val().trim() }); this.modal('classDeleteModal').hide(); this.app.showToast('Sucesso', 'Classe excluída.'); await this.search(); } catch (error) { this.app.showError(error.data || { error: error.message }); } }
    async execute(operation, input) { return this.app.api('/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation, connection: this.app.currentConnection(), input }) }); }
    modal(id) { return bootstrap.Modal.getOrCreateInstance(document.getElementById(id)); }
    escape(value) { return $('<div>').text(value ?? '').html(); }
    escapeAttr(value) { return this.escape(value).replaceAll('"', '&quot;'); }
}
window.classesPage = new ClassesPage(window.app);
