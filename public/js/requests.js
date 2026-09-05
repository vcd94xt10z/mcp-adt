class RequestsPage {
    constructor(app) {
        this.app = app;
        this.editingNumber = null;
        this.pendingDeleteNumber = null;
        this.bound = false;
    }

    // Inicializa a tela de requests e registra seus eventos uma única vez.
    async activate() {
        if (!this.bound) {
            this.bindEvents();
            this.bound = true;
        }
        await this.populateTargetFilter();
    }

    // Registra os eventos dos filtros, formulário e ações da tabela.
    bindEvents() {
        $('#requestSearch').on('click', () => this.search());
        $('#newRequest').on('click', () => this.openNew());
        $('#requestForm').on('submit', event => this.submit(event));
        $('#requestDeleteConfirm').on('click', () => this.confirmDelete());
        $('#requestFilterNumber, #requestFilterDescription, #requestFilterType, #requestFilterTarget, #requestFilterOwner, #requestFilterMax').on('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                this.search();
            }
        });
    }

    // Executa a pesquisa de requests no SAP e aplica os filtros da tela.
    async search() {
        const box = $('#requestResults');
        box.html('<div class="alert alert-info">Pesquisando…</div>');
        try {
            const data = await this.execute('request_list', {});
            const items = this.parseRequestList(data.result?.raw || '');
            this.renderResults(items);
        } catch (error) {
            box.html('<div class="alert alert-danger">Erro na pesquisa.</div>');
            this.app.showError(error.data || { ok: false, error: error.message });
        }
    }

    // Renderiza a tabela usando somente os campos relevantes para requests.
    renderResults(items) {
        const number = String($('#requestFilterNumber').val() || '').trim().toUpperCase();
        const description = String($('#requestFilterDescription').val() || '').trim().toUpperCase();
        const type = this.normalizeCategory($('#requestFilterType').val());
        const target = String($('#requestFilterTarget').val() || '').trim().toUpperCase();
        const owner = String($('#requestFilterOwner').val() || '').trim().toUpperCase();
        const max = Math.max(1, Math.min(500, Number($('#requestFilterMax').val()) || 100));
        const filtered = items.filter(item => {
            const itemNumber = String(item.number || '').toUpperCase();
            const itemDescription = String(item.description || '').toUpperCase();
            const itemTarget = String(item.target || '').toUpperCase();
            const itemOwner = String(item.owner || '').toUpperCase();
            const itemType = this.normalizeCategory(item.category || item.type);
            return (!number || itemNumber.includes(number))
                && (!description || itemDescription.includes(description))
                && (!type || itemType === type)
                && (!target || itemTarget === target)
                && (!owner || itemOwner.includes(owner));
        }).slice(0, max);

        if (!filtered.length) {
            $('#requestResults').html('<div class="alert alert-secondary">Nenhum request encontrado com os filtros informados.</div>');
            return;
        }

        const rows = filtered.map(item => `
            <tr>
                <td><strong>${this.app.escapeHtml(item.number)}</strong></td>
                <td>${this.app.escapeHtml(this.typeLabel(item))}</td>
                <td>${this.app.escapeHtml(item.target)}</td>
                <td>${this.app.escapeHtml(item.description)}</td>
                <td>${this.app.escapeHtml(item.owner)}</td>
                <td class="table-actions">
                    <button class="btn btn-sm btn-outline-secondary" data-action="view" data-number="${this.app.escapeHtml(item.number)}">Visualizar</button>
                    <button class="btn btn-sm btn-outline-primary" data-action="edit" data-number="${this.app.escapeHtml(item.number)}">Editar</button>
                    <button class="btn btn-sm btn-outline-danger" data-action="delete" data-number="${this.app.escapeHtml(item.number)}">Deletar</button>
                </td>
            </tr>`).join('');

        $('#requestResults').html(`<table class="table table-hover align-middle mb-0"><thead><tr><th>Número</th><th>Tipo</th><th>Target</th><th>Descrição</th><th>Owner</th><th>Ações</th></tr></thead><tbody>${rows}</tbody></table>`);
        $('#requestResults [data-action="view"]').on('click', event => this.rowAction('view', $(event.currentTarget).data('number')));
        $('#requestResults [data-action="edit"]').on('click', event => this.rowAction('edit', $(event.currentTarget).data('number')));
        $('#requestResults [data-action="delete"]').on('click', event => this.rowAction('delete', $(event.currentTarget).data('number')));
    }

    // Abre o formulário para criar uma nova request, deixando o tipo editável.
    async openNew() {
        try {
            this.editingNumber = null;
            $('#requestFormTitle').text('Criar Request');
            $('#requestSubmit').text('Criar');
            $('#requestCategory').prop('disabled', false).val('K');
            $('#requestCategoryHelp').text('O tipo é definido somente na criação.');
            $('#requestDescription').val('');
            $('#requestTarget').prop('disabled', false);
            await this.populateTargets();
            this.modal('requestModal').show();
            $('#requestDescription').trigger('focus');
        } catch (error) {
            this.app.showError(error.data || { ok: false, error: error.message });
        }
    }

    // Abre o formulário de edição com o tipo bloqueado e os demais campos permitidos.
    async openEdit(request) {
        this.editingNumber = request.number;
        $('#requestFormTitle').text('Editar request');
        $('#requestSubmit').text('Salvar');
        $('#requestCategory').prop('disabled', true);
        $('#requestCategoryHelp').text('O tipo da request não pode ser alterado após a criação.');
        $('#requestTarget').prop('disabled', false);
        let current = request;

        try {
            const data = await this.execute('request_get', { number: request.number });
            if (data?.result) current = data.result;
        } catch {
            // Mantém os dados já obtidos na listagem caso a consulta individual falhe.
        }

        const category = this.normalizeCategory(current.category || current.type);
        if (category) $('#requestCategory').val(category);
        await this.populateTargets(current.target || '');
        $('#requestDescription').val(current.description || '');
        this.modal('requestModal').show();
        $('#requestDescription').trigger('focus');
    }

    // Exibe os dados da request em modo somente leitura, sem mostrar Status.
    openView(request) {
        const category = this.normalizeCategory(request.category || request.type);
        const type = category === 'K' ? 'Workbench' : category === 'W' ? 'Customizing' : String(request.type || request.category || '');
        const fields = [
            ['Número', request.number],
            ['Tipo', type],
            ['Target', request.target],
            ['Descrição', request.description],
            ['Owner', request.owner]
        ];
        $('#requestViewFields').html(fields.map(([label, value]) => `
            <div class="col-md-6">
                <label class="form-label">${this.app.escapeHtml(label)}</label>
                <div class="modal-value">${this.app.escapeHtml(value || '')}</div>
            </div>`).join(''));
        this.modal('requestViewModal').show();
    }

    // Processa a ação solicitada para uma linha da tabela.
    async rowAction(action, number) {
        try {
            const data = await this.execute('request_get', { number });
            const request = data?.result;
            if (!request) return;
            if (action === 'view') {
                this.openView(request);
                return;
            }
            if (action === 'edit') {
                await this.openEdit(request);
                return;
            }
            this.openDeleteConfirm(number);
        } catch (error) {
            this.app.showError(error.data || { ok: false, error: error.message });
        }
    }


    // Abre o modal Bootstrap para confirmar a exclusão da request selecionada.
    openDeleteConfirm(number) {
        this.pendingDeleteNumber = number;
        $('#requestDeleteNumber').text(number);
        this.modal('requestDeleteModal').show();
    }

    // Confirma a exclusão da request após a confirmação no modal Bootstrap.
    async confirmDelete() {
        const number = this.pendingDeleteNumber;
        if (!number) return;

        const button = $('#requestDeleteConfirm');
        button.prop('disabled', true);

        try {
            await this.execute('request_delete', { number });
            this.modal('requestDeleteModal').hide();
            this.app.showToast('Request excluída', `O request '${number}' foi excluído.`);
            this.pendingDeleteNumber = null;
            await this.search();
        } catch (error) {
            this.app.showError(error.data || { ok: false, error: error.message });
        } finally {
            button.prop('disabled', false);
        }
    }

    // Envia a criação ou alteração da request, sem permitir alteração do tipo em edição.
    async submit(event) {
        event.preventDefault();
        const description = String($('#requestDescription').val() || '').trim();
        if (!description) {
            this.app.showToast('Campos obrigatórios', 'Informe a descrição.', false);
            return;
        }

        const operation = this.editingNumber ? 'request_update' : 'request_create';
        const input = { description };
        if (this.editingNumber) {
            input.number = this.editingNumber;
            input.target = String($('#requestTarget').val() || '').trim();
        } else {
            input.target = String($('#requestTarget').val() || '').trim();
            input.category = String($('#requestCategory').val() || 'K').toUpperCase();
        }

        try {
            await this.execute(operation, input);
            this.modal('requestModal').hide();
            this.app.showToast(operation === 'request_create' ? 'Request criada' : 'Request alterada', 'Operação concluída com sucesso.');
            await this.search();
        } catch (error) {
            this.app.showError(error.data || { ok: false, error: error.message });
        }
    }

    // Carrega os targets disponíveis no ambiente SAP para o filtro e inclui a opção Todos.
    async populateTargetFilter() {
        const currentValue = String($('#requestFilterTarget').val() || '').trim();
        try {
            const options = await this.app.loadEnvironmentOptions();
            this.app.setSelectOptions('#requestFilterTarget', options.targets, 'Todos', currentValue);
        } catch (error) {
            this.app.setSelectOptions('#requestFilterTarget', [], 'Todos');
            throw error;
        }
    }

    // Carrega os targets disponíveis no ambiente SAP e mantém a seleção solicitada.
    async populateTargets(selected = '') {
        const options = await this.app.loadEnvironmentOptions();
        this.app.setSelectOptions('#requestTarget', options.targets, 'Selecione um target', selected);
    }

    // Executa uma operação da API web usando a conexão SAP ativa.
    async execute(operation, input) {
        return this.app.api('/api/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ operation, connection: this.app.currentConnection(), input })
        });
    }

    // Converte as representações possíveis do tipo para K ou W.
    normalizeCategory(type) {
        const value = String(type ?? '').trim().toUpperCase();
        if (value === 'K' || value === 'WORKBENCH') return 'K';
        if (value === 'W' || value === 'CUSTOMIZING') return 'W';
        return '';
    }

    // Retorna o texto de apresentação do tipo da request.
    typeLabel(request) {
        const category = this.normalizeCategory(request.category || request.type);
        return category === 'K' ? 'Workbench' : category === 'W' ? 'Customizing' : String(request.type || request.category || '');
    }

    // Lê o XML de requests de forma tolerante a namespaces e variações de atributos.
    parseRequestList(raw) {
        try {
            const document = new DOMParser().parseFromString(String(raw || ''), 'application/xml');
            if (document.querySelector('parsererror')) return [];
            const nodes = [...document.getElementsByTagNameNS('*', 'request')];
            const seen = new Set();
            const items = [];

            nodes.forEach(element => {
                const type = this.xmlValue(element, ['type', 'category', 'requestType', 'TRFUNCTION', 'TRTYPE']);
                const item = {
                    number: this.xmlValue(element, ['number', 'TRKORR', 'TRNUMBER', 'id']),
                    description: this.xmlValue(element, ['description', 'desc', 'AS4TEXT', 'DESCRIPTION', 'REQUEST_TEXT', 'text']),
                    owner: this.xmlValue(element, ['owner', 'OWNER', 'AS4USER', 'user']),
                    target: this.xmlValue(element, ['target', 'TARGET']),
                    type,
                    category: this.normalizeCategory(type)
                };

                let parent = element.parentElement;
                while (parent) {
                    const localName = String(parent.localName || parent.tagName || '').toLowerCase();
                    if (localName === 'workbench') item.category = 'K';
                    if (localName === 'customizing') item.category = 'W';
                    if (localName === 'target' && !item.target) item.target = this.xmlValue(parent, ['name', 'target', 'id', 'code']);
                    parent = parent.parentElement;
                }

                if (!item.number || seen.has(item.number)) return;
                seen.add(item.number);
                items.push(item);
            });
            return items;
        } catch {
            return [];
        }
    }

    // Obtém um atributo ou elemento filho considerando seu localName e namespace.
    xmlValue(element, names) {
        for (const name of names) {
            const attribute = [...element.attributes].find(item => item.localName === name || item.name === name);
            if (attribute?.value) return attribute.value.trim();
            const child = [...element.children].find(item => item.localName === name || item.tagName === name);
            if (child?.textContent?.trim()) return child.textContent.trim();
        }
        return '';
    }

    // Retorna a instância Bootstrap do modal solicitado.
    modal(id) {
        return bootstrap.Modal.getOrCreateInstance(document.getElementById(id));
    }
}

window.requestsPage = new RequestsPage(window.app);
