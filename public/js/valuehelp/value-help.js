class ValueHelp {
    constructor(options = {}) {
        this.id = options.id;
        this.title = options.title || 'Selecionar valor';
        this.columns = options.columns || [];
        this.loadItems = options.loadItems;
        this.modal = null;
        this.selectedCallback = null;
    }

    async open(callback) {
        this.selectedCallback = callback;
        this.ensureModal();
        this.modal.show();
        await this.search();
    }

    ensureModal() {
        if ($(`#${this.id}`).length) {
            this.modal = bootstrap.Modal.getOrCreateInstance(document.getElementById(this.id));
            return;
        }

        const headers = this.columns.map(column => `<th>${window.app.escapeHtml(column.label)}</th>`).join('');
        $('#sharedContent').append(`
            <div class="modal fade" id="${this.id}" tabindex="-1" aria-hidden="true">
                <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable resizable-modal">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">${window.app.escapeHtml(this.title)}</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
                        </div>
                        <div class="modal-body">
                            <div class="input-group mb-3">
                                <input class="form-control value-help-search" placeholder="Pesquisar">
                                <button class="btn btn-outline-primary value-help-search-button" type="button">Pesquisar</button>
                            </div>
                            <div class="table-responsive">
                                <table class="table table-hover align-middle value-help-table">
                                    <thead><tr>${headers}</tr></thead>
                                    <tbody></tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `);

        const root = $(`#${this.id}`);
        root.on('click', '.value-help-search-button', () => this.search());
        root.on('keydown', '.value-help-search', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                this.search();
            }
        });
        root.on('click', '[data-value-help-index]', event => this.select(Number($(event.currentTarget).data('value-help-index'))));
        this.modal = bootstrap.Modal.getOrCreateInstance(root[0]);
    }

    async search() {
        const root = $(`#${this.id}`);
        const query = root.find('.value-help-search').val().trim();
        const body = root.find('tbody');
        body.html('<tr><td colspan="100" class="text-center text-secondary">Carregando...</td></tr>');
        try {
            this.items = await this.loadItems(query);
            if (!this.items.length) {
                body.html('<tr><td colspan="100" class="text-center text-secondary">Nenhum valor encontrado.</td></tr>');
                return;
            }
            body.html(this.items.map((item, index) => `<tr class="value-help-row" data-value-help-index="${index}">${this.columns.map(column => `<td>${window.app.escapeHtml(column.value(item) ?? '')}</td>`).join('')}</tr>`).join(''));
        } catch (error) {
            body.html('<tr><td colspan="100" class="text-center text-danger">Erro ao carregar valores.</td></tr>');
            window.app.showError(error.data || { error: error.message });
        }
    }

    select(index) {
        const item = this.items?.[index];
        if (!item) return;
        this.selectedCallback?.(item);
        this.modal.hide();
    }
}

window.ValueHelp = ValueHelp;
