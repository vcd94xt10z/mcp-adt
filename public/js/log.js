class LogPage {
    constructor(app) {
        this.app = app;
        this.entries = [];
        this.filteredEntries = [];
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

    // Registra os eventos dos controles da tela de log.
    bindEvents() {
        $('#logEnabled').on('change', () => this.setEnabled());
        $('#logRefresh').on('click', () => this.refresh());
        $('#logClear').on('click', () => this.clear());
        $('#confirmLogClear').on('click', () => this.confirmClear());
        $('#logFilter').on('click', () => this.applyFilters());
        $('#logDate, #logMethod, #logStatus').on('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                this.applyFilters();
            }
        });
        $('#logResults').on('click', '[data-log-index]', event => this.view(Number($(event.currentTarget).data('log-index'))));
        $('#copyLogJson').on('click', () => this.copyCurrentLog());
    }

    // Atualiza a lista de entradas do log e reaplica os filtros atuais.
    async refresh() {
        try {
            const data = await this.app.api('/api/log');
            this.entries = Array.isArray(data.entries) ? data.entries : [];
            $('#logEnabled').prop('checked', data.enabled === true);
            this.populateStatusFilter();
            this.applyFilters();
        } catch (error) {
            this.app.showError(error.data || { ok: false, error: error.message });
        }
    }

    // Preenche o filtro de status com os códigos HTTP existentes no log.
    populateStatusFilter() {
        const current = $('#logStatus').val();
        const statuses = [...new Set(this.entries.map(entry => this.getHttpStatus(entry)).filter(status => status !== ''))]
            .sort((a, b) => Number(a) - Number(b));
        const options = ['<option value="">Todos</option>']
            .concat(statuses.map(status => `<option value="${this.app.escapeHtml(status)}">${this.app.escapeHtml(status)}</option>`));
        $('#logStatus').html(options.join('')).val(current);
    }

    // Aplica os filtros selecionados e ordena os resultados por data e hora decrescentes.
    applyFilters() {
        const date = $('#logDate').val();
        const method = $('#logMethod').val();
        const status = $('#logStatus').val();

        this.filteredEntries = this.entries
            .map((entry, index) => ({ entry, index }))
            .filter(({ entry }) => {
                const entryDate = this.getDateFilterValue(entry);
                const entryMethod = String(entry.method || '').toUpperCase();
                const entryStatus = this.getHttpStatus(entry);
                return (!date || entryDate === date)
                    && (!method || entryMethod === method)
                    && (!status || entryStatus === status);
            })
            .sort((a, b) => this.getTimestamp(b.entry) - this.getTimestamp(a.entry));

        this.render();
    }

    // Renderiza a tabela de registros do log já filtrados e ordenados.
    render() {
        if (!this.filteredEntries.length) {
            $('#logResults').html('<div class="alert alert-secondary">Nenhum registro encontrado para os filtros informados.</div>');
            return;
        }

        const rows = this.filteredEntries.map(({ entry, index }) => `
            <tr>
                <td>${this.app.escapeHtml(this.formatDisplayDate(entry))}</td>
                <td>${this.app.escapeHtml(entry.time || '')}</td>
                <td>${this.app.escapeHtml(this.getHttpStatus(entry))}</td>
                <td>${this.app.escapeHtml(entry.method || '')}</td>
                <td class="log-uri" title="${this.app.escapeHtml(entry.uri || '')}">${this.app.escapeHtml(entry.uri || '')}</td>
                <td><button class="btn btn-sm btn-outline-secondary" type="button" data-log-index="${index}">Visualizar</button></td>
            </tr>`).join('');

        $('#logResults').html(`
            <table class="table table-hover align-middle mb-0">
                <thead>
                    <tr>
                        <th>Data</th>
                        <th>Hora</th>
                        <th>Status HTTP</th>
                        <th>Método HTTP</th>
                        <th>URL</th>
                        <th>Ação</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>`);
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

    // Copia para a área de transferência o JSON exibido no popup do log atual.
    async copyCurrentLog() {
        const json = $('#logViewContent').val();
        if (!json) {
            this.app.showToast('Log vazio', 'Não há conteúdo de log para copiar.', false);
            return;
        }

        try {
            await navigator.clipboard.writeText(json);
            this.app.showToast('JSON copiado', 'O JSON do log atual foi copiado para a área de transferência.');
        } catch {
            this.app.showToast('Clipboard indisponível', 'Não foi possível copiar o JSON do log.', false);
        }
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

    // Abre o modal Bootstrap para confirmar a limpeza do arquivo de log.
    clear() {
        bootstrap.Modal.getOrCreateInstance(document.getElementById('logClearModal')).show();
    }

    // Apaga o arquivo de log após a confirmação no modal Bootstrap.
    async confirmClear() {
        bootstrap.Modal.getOrCreateInstance(document.getElementById('logClearModal')).hide();
        try {
            await this.app.api('/api/log', { method: 'DELETE' });
            this.entries = [];
            this.filteredEntries = [];
            this.populateStatusFilter();
            this.render();
            this.app.showToast('Log limpo', 'O arquivo mcp.log foi apagado.');
        } catch (error) {
            this.app.showError(error.data || { ok: false, error: error.message });
        }
    }

    // Retorna o status HTTP da resposta como texto para uso na tabela e no filtro.
    getHttpStatus(entry) {
        const status = entry?.response?.status;
        return status === undefined || status === null || status === '' ? '' : String(status);
    }

    // Converte a data do log para o valor ISO usado pelo filtro de data.
    getDateFilterValue(entry) {
        const timestamp = this.getTimestamp(entry);
        if (Number.isFinite(timestamp) && timestamp > 0) {
            const date = new Date(timestamp);
            const pad = value => String(value).padStart(2, '0');
            return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
        }

        const date = String(entry?.date || '');
        if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
        if (/^\d{2}[./-]\d{2}[./-]\d{4}$/.test(date)) {
            const [day, month, year] = date.split(/[./-]/);
            return `${year}-${month}-${day}`;
        }
        return '';
    }

    // Formata a data exibida na tabela no padrão brasileiro dd/mm/YYYY.
    formatDisplayDate(entry) {
        const date = this.getDateFilterValue(entry);
        if (!date) return String(entry?.date || '');
        const [year, month, day] = date.split('-');
        return `${day}/${month}/${year}`;
    }

    // Retorna o timestamp da entrada usando timestamp ou a combinação de data e hora.
    getTimestamp(entry) {
        const timestamp = Date.parse(String(entry?.timestamp || ''));
        if (Number.isFinite(timestamp)) return timestamp;

        const date = this.getDateFilterValue(entry);
        const time = String(entry?.time || '00:00:00');
        if (!date) return 0;
        const value = Date.parse(`${date}T${time}`);
        return Number.isFinite(value) ? value : 0;
    }
}

window.logPage = new LogPage(window.app);
