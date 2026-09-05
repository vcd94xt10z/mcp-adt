class ConnectionsPage {
    constructor(app) {
        this.app = app;
        this.editingConnection = null;
        this.bound = false;
    }

    // Inicializa a tela de conexões e carrega seus dados.
    async activate() {
        if (!this.bound) {
            this.bindEvents();
            this.bound = true;
        }
        this.render();
    }

    // Registra os eventos dos botões e do formulário de conexões.
    bindEvents() {
        $('#newConnection').on('click', () => this.openNew());
        $('#reloadConnections').on('click', () => this.reload());
        $('#connectionForm').on('submit', event => this.save(event));
    }

    // Renderiza a tabela com as conexões cadastradas.
    render() {
        const connections = this.app.connectionData;
        if (!connections.length) {
            $('#connectionList').html('<div class="alert alert-secondary">Nenhuma conexão cadastrada.</div>');
            return;
        }
        const rows = connections.map(connection => `
            <tr>
                <td><strong>${this.app.escapeHtml(connection.name)}</strong></td>
                <td>${this.app.escapeHtml(connection.url)}</td>
                <td>${this.app.escapeHtml(connection.client)}</td>
                <td>${this.app.escapeHtml(connection.user)}</td>
                <td class="connection-actions">
                    <button class="btn btn-sm btn-outline-secondary" data-action="test" data-name="${this.app.escapeHtml(connection.name)}">Testar</button>
                    <button class="btn btn-sm btn-outline-primary" data-action="edit" data-name="${this.app.escapeHtml(connection.name)}">Editar</button>
                    <button class="btn btn-sm btn-outline-danger" data-action="delete" data-name="${this.app.escapeHtml(connection.name)}">Excluir</button>
                </td>
            </tr>`).join('');
        $('#connectionList').html(`<table class="table table-hover align-middle mb-0"><thead><tr><th>Nome</th><th>URL</th><th>Client</th><th>Usuário</th><th>Ações</th></tr></thead><tbody>${rows}</tbody></table>`);
        $('#connectionList [data-action="test"]').on('click', event => this.test($(event.currentTarget).data('name')));
        $('#connectionList [data-action="edit"]').on('click', event => this.openEdit($(event.currentTarget).data('name')));
        $('#connectionList [data-action="delete"]').on('click', event => this.remove($(event.currentTarget).data('name')));
    }

    // Recarrega as conexões do arquivo de configuração.
    async reload() {
        try {
            await this.app.loadConnections();
            this.render();
        } catch (error) {
            this.app.showError(error.data || { ok: false, error: error.message });
        }
    }

    // Abre o formulário vazio para criação de uma conexão.
    openNew() {
        this.editingConnection = null;
        $('#connectionFormTitle').text('Nova conexão');
        $('#connectionForm')[0].reset();
        $('#connName').prop('disabled', false).trigger('focus');
        this.modal().show();
    }

    // Abre o formulário preenchido para edição de uma conexão existente.
    openEdit(name) {
        const connection = this.app.connectionData.find(item => item.name === name);
        if (!connection) return;
        this.editingConnection = name;
        $('#connectionFormTitle').text('Editar conexão');
        $('#connName').val(connection.name).prop('disabled', true);
        $('#connUrl').val(connection.url);
        $('#connClient').val(connection.client);
        $('#connUser').val(connection.user);
        $('#connPassword').val('');
        $('#connLanguage').val(connection.language || '');
        $('#connRejectUnauthorized').prop('checked', connection.rejectUnauthorized === true);
        this.modal().show();
        $('#connUrl').trigger('focus');
    }

    // Salva uma conexão nova ou altera a conexão selecionada.
    async save(event) {
        event.preventDefault();
        const name = $('#connName').val().trim();
        const payload = {
            name,
            url: $('#connUrl').val().trim(),
            client: $('#connClient').val().trim(),
            user: $('#connUser').val().trim(),
            password: $('#connPassword').val(),
            language: $('#connLanguage').val().trim(),
            rejectUnauthorized: $('#connRejectUnauthorized').is(':checked')
        };
        const editing = Boolean(this.editingConnection);
        try {
            await this.app.api(editing ? `/api/connections/${encodeURIComponent(this.editingConnection)}` : '/api/connections', {
                method: editing ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            this.modal().hide();
            await this.app.loadConnections(name);
            this.render();
            this.app.showToast(editing ? 'Conexão alterada' : 'Conexão criada', `A conexão '${name}' foi salva.`);
        } catch (error) {
            this.app.showError(error.data || { ok: false, error: error.message });
        }
    }

    // Testa uma conexão SAP e apresenta somente uma mensagem amigável ao usuário.
    async test(name) {
        try {
            await this.app.api(`/api/connections/${encodeURIComponent(name)}/test`, { method: 'POST' });
            this.app.showToast('Conexão funcionando', `A conexão '${name}' está funcionando.`);
        } catch (error) {
            this.app.showToast('Erro na conexão', this.app.connectionErrorReason(error), false);
        }
    }

    // Exclui uma conexão após confirmação do usuário.
    async remove(name) {
        if (!window.confirm(`Excluir a conexão '${name}'?`)) return;
        try {
            await this.app.api(`/api/connections/${encodeURIComponent(name)}`, { method: 'DELETE' });
            await this.app.loadConnections();
            this.render();
            this.app.showToast('Conexão excluída', `A conexão '${name}' foi excluída.`);
        } catch (error) {
            this.app.showError(error.data || { ok: false, error: error.message });
        }
    }

    // Retorna a instância Bootstrap do modal de conexão.
    modal() {
        return bootstrap.Modal.getOrCreateInstance(document.getElementById('connectionModal'));
    }
}

window.connectionsPage = new ConnectionsPage(window.app);
