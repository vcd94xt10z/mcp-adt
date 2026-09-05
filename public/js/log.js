class LogPage {
    constructor(app) {
        this.app = app;
        this.entries = [];
        this.bound = false;
    }

    // Inicializa a tela de log e carrega suas configurações.
    async activate() {
        if (!this.bound) {
            this.bindEvents();
            this.bound = true;
        }
        await this.refresh();
    }

    // Registra os eventos de controle do log.
    bindEvents() {
        $('#logEnabled').on('change', () => this.setEnabled());
        $('#logRefresh').on('click', () => this.refresh());
        $('#logClear').on('click', () => this.clear());
        $('#logResults').on('click', '[data-log-index]', event => this.view(Number($(event.currentTarget).data('log-index'))));
    }

    // Atualiza a lista de entradas do log.
    async refresh() {
        try {
            const data = await this.app.api('/api/log');
            this.entries = data.entries || [];
            $('#logEnabled').prop('checked', data.enabled === true);
            this.render();
        } catch (error) {
            this.app.showError(error.data || { ok: false, error: error.message });
        }
    }

    // Renderiza a tabela de registros do log.
    render() {
        if (!this.entries.length) {
            $('#logResults').html('<div class="alert alert-secondary">Nenhum registro no log.</div>');
            return;
        }
        const rows = this.entries.map((entry, index) => `
            <tr>
                <td>${this.app.escapeHtml(entry.date || '')}</td>
                <td>${this.app.escapeHtml(entry.time || '')}</td>
                <td>${this.app.escapeHtml(entry.method || '')}</td>
                <td class="log-uri" title="${this.app.escapeHtml(entry.uri || '')}">${this.app.escapeHtml(entry.uri || '')}</td>
                <td><button class="btn btn-sm btn-outline-secondary" type="button" data-log-index="${index}">Visualizar</button></td>
            </tr>`).join('');
        $('#logResults').html(`<table class="table table-hover align-middle mb-0"><thead><tr><th>Data</th><th>Hora</th><th>Método HTTP</th><th>URI</th><th>Ação</th></tr></thead><tbody>${rows}</tbody></table>`);
    }

    // Exibe os detalhes completos de uma entrada do log.
    view(index) {
        const entry = this.entries[index];
        if (!entry) {
            this.app.showToast('Log não localizado', 'Atualize a lista de logs.', false);
            return;
        }
        $('#logViewContent').val(JSON.stringify(entry, null, 2));
        bootstrap.Modal.getOrCreateInstance(document.getElementById('logViewModal')).show();
    }

    // Habilita ou desabilita a gravação das chamadas ao SAP.
    async setEnabled() {
        const enabled = $('#logEnabled').is(':checked');
        try {
            const data = await this.app.api('/api/log', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled })
            });
            $('#logEnabled').prop('checked', data.enabled === true);
            this.app.showToast(data.enabled ? 'Log habilitado' : 'Log desabilitado', data.enabled ? 'As chamadas ao SAP serão registradas em mcp.log.' : 'Novas chamadas ao SAP não serão registradas.');
        } catch (error) {
            $('#logEnabled').prop('checked', !enabled);
            this.app.showError(error.data || { ok: false, error: error.message });
        }
    }

    // Apaga o arquivo de log após confirmação do usuário.
    async clear() {
        if (!window.confirm('Deseja apagar o arquivo mcp.log?')) return;
        try {
            await this.app.api('/api/log', { method: 'DELETE' });
            this.entries = [];
            this.render();
            this.app.showToast('Log limpo', 'O arquivo mcp.log foi apagado.');
        } catch (error) {
            this.app.showError(error.data || { ok: false, error: error.message });
        }
    }
}

window.logPage = new LogPage(window.app);
