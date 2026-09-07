class PackagesPage {
    constructor(app) {
        this.app = app;
        this.editingName = null;
        this.pendingDelete = null;
        this.pendingDeleteTransport = '';
        this.bound = false;
    }

    // Inicializa a tela de pacotes e registra seus eventos uma única vez.
    async activate() {
        if (!this.bound) {
            this.bindEvents();
            this.bound = true;
        }
    }

    // Registra os eventos dos filtros, formulário e ações da tabela.
    bindEvents() {
        $('#packageSearch').on('click', () => this.search());
        $('#newPackage').on('click', () => this.openNew());
        $('#packageForm').on('submit', event => this.submit(event));
        $('#packageName').on('input', () => {
            $('#packageName').val(String($('#packageName').val() || '').toUpperCase());
            this.updateMode();
        });
        $('#transportSubmit').on('click', () => this.confirmDelete());
        $('#packageDeleteConfirm').on('click', () => this.confirmDeleteAction());
        $('#packageSearchQuery, #packageSearchMax').on('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                this.search();
            }
        });
    }

    // Executa a pesquisa de pacotes no SAP e renderiza o resultado.
    async search() {
        const box = $('#packageResults');
        box.html('<div class="alert alert-info">Pesquisando…</div>');
        const query = String($('#packageSearchQuery').val() || '').trim() || '*';
        const maxResults = Math.max(1, Math.min(500, Number($('#packageSearchMax').val()) || 100));
        try {
            const data = await this.execute('package_list', { query, maxResults });
            this.renderResults(data.result?.items || []);
        } catch (error) {
            box.html('<div class="alert alert-danger">Erro na pesquisa.</div>');
            this.app.showError(error.data || { ok: false, error: error.message });
        }
    }

    // Renderiza os pacotes encontrados e associa as ações de cada linha.
    renderResults(items) {
        const filtered = items;

        if (!filtered.length) {
            $('#packageResults').html('<div class="alert alert-secondary">Nenhum pacote encontrado.</div>');
            return;
        }

        const rows = filtered.map(item => `
            <tr>
                <td><strong>${this.app.escapeHtml(item.name)}</strong></td>
                <td>${this.app.escapeHtml(item.description || '')}</td>
                <td>${this.app.escapeHtml(item.type || '')}</td>
                <td>${this.app.escapeHtml(item.superPackage || '')}</td>
                <td class="table-actions">
                    <button class="btn btn-sm btn-outline-secondary" data-action="view" data-name="${this.app.escapeHtml(item.name)}">Visualizar</button>
                    <button class="btn btn-sm btn-outline-primary" data-action="edit" data-name="${this.app.escapeHtml(item.name)}">Editar</button>
                    <button class="btn btn-sm btn-outline-danger" data-action="delete" data-name="${this.app.escapeHtml(item.name)}">Deletar</button>
                </td>
            </tr>`).join('');

        $('#packageResults').html(`<table class="table table-hover align-middle mb-0"><thead><tr><th>Nome</th><th>Descrição</th><th>Tipo</th><th>Superpackage</th><th>Ações</th></tr></thead><tbody>${rows}</tbody></table>`);
        $('#packageResults [data-action="view"]').on('click', event => this.rowAction('view', $(event.currentTarget).data('name')));
        $('#packageResults [data-action="edit"]').on('click', event => this.rowAction('edit', $(event.currentTarget).data('name')));
        $('#packageResults [data-action="delete"]').on('click', event => this.rowAction('delete', $(event.currentTarget).data('name')));
    }

    // Abre o formulário limpo para criação e deixa o superpackage como texto livre.
    async openNew() {
        try {
            this.editingName = null;
            $('#packageForm').removeClass('edit-mode');
            $('#packageFormTitle').text('Novo pacote');
            $('#packageSubmit').text('Criar');
            $('#packageForm')[0].reset();
            $('#packageName').prop('readonly', false).removeClass('readonly-field');
            $('#packageDescription').prop('readonly', false);
            $('#packageType, #packageSoftware, #packageLayer').prop('disabled', false);
            $('#packageLanguage').prop('readonly', true).addClass('readonly-field');
            $('#packageRecordChanges').prop('disabled', false).prop('checked', true);
            $('#packageSuper').prop('readonly', false).removeClass('readonly-field').val('');
            $('#packageModeHint').removeClass('alert-secondary').addClass('alert-info').text('Pacote não-local: selecione uma request Workbench. O console não cria requests automaticamente.');
            await this.populateCreateOptions();
            this.updateMode();
            this.modal('packageModal').show();
            $('#packageName').trigger('focus');
        } catch (error) {
            this.app.showError(error.data || { ok: false, error: error.message });
        }
    }

    // Abre o formulário de edição mantendo somente descrição e transport layer editáveis.
    async openEdit(packageData) {
        try {
            this.editingName = String(packageData.name || '').toUpperCase();
            $('#packageForm').addClass('edit-mode');
            $('#packageFormTitle').text('Editar pacote');
            $('#packageSubmit').text('Salvar');
            $('#packageName').val(this.editingName).prop('readonly', true).addClass('readonly-field');
            $('#packageDescription').val(packageData.description || '').prop('readonly', false);
            $('#packageLanguage').val(await this.app.currentConnectionLanguage()).prop('readonly', true).addClass('readonly-field');
            $('#packageType').val(packageData.packageType || packageData.type || '').prop('disabled', true);
            $('#packageSoftware').empty().append($('<option>', { value: packageData.softwareComponent || '', text: packageData.softwareComponent || '' })).prop('disabled', true);
            $('#packageSuper').val(packageData.superPackage || '').prop('readonly', true).addClass('readonly-field');
            $('#packageRecordChanges').prop('checked', packageData.recordChanges === true).prop('disabled', true);
            await this.populateEditTransportLayers(packageData.transportLayer || '');
            $('#packageTransport').empty();
            $('#packageModeHint').removeClass('alert-info').addClass('alert-secondary').text('Em edição, somente Descrição e Transport Layer alteram os dados do pacote. A request Workbench é apenas o contexto de transporte da operação.');
            await this.populateTransportRequests(this.editingName);
            this.modal('packageModal').show();
            $('#packageDescription').trigger('focus');
        } catch (error) {
            this.app.showError(error.data || { ok: false, error: error.message });
        }
    }

    // Carrega idiomas, software components e transport layers disponíveis para criação.
    async populateCreateOptions() {
        const options = await this.app.loadEnvironmentOptions();
        $('#packageLanguage').val(await this.app.currentConnectionLanguage()).prop('readonly', true).addClass('readonly-field');
        this.app.setSelectOptions('#packageSoftware', options.softwareComponents, 'Selecione um software component', 'HOME');
        this.app.setSelectOptions('#packageLayer', options.transportLayers, 'Selecione um transport layer', 'SAP');
        $('#packageTransport').empty().append($('<option>', { value: '', text: 'Selecione uma request Workbench' }));
        (options.modifiableWorkbenchRequests || []).forEach(item => $('#packageTransport').append($('<option>', { value: item.number, text: `${item.number} — ${item.description || ''}` })));
    }

    // Carrega os transport layers disponíveis e mantém o valor atual do pacote.
    async populateEditTransportLayers(selected) {
        const options = await this.app.loadEnvironmentOptions();
        this.app.setSelectOptions('#packageLayer', options.transportLayers, 'Selecione um transport layer', selected);
        $('#packageLayer').prop('disabled', false);
    }

    // Carrega requests Workbench modificáveis para fornecer o contexto da alteração.
    async populateTransportRequests(selectedPackage = '') {
        const options = await this.app.loadEnvironmentOptions(true);
        $('#packageTransport').empty().append($('<option>', { value: '', text: 'Selecione uma request Workbench' }));
        const requests = options.modifiableWorkbenchRequests || [];
        requests.forEach(item => $('#packageTransport').append($('<option>', { value: item.number, text: `${item.number} — ${item.description || ''}` })));
        const packageName = String(selectedPackage || '').trim().toUpperCase();
        if (packageName) {
            const linkedRequest = requests.find(item => {
                const packages = Array.isArray(item.packages) ? item.packages : [];
                return String(item.package || '').trim().toUpperCase() === packageName
                    || packages.some(value => String(value || '').trim().toUpperCase() === packageName);
            });
            $('#packageTransport').val(linkedRequest?.number || '');
        }
    }

    // Atualiza o comportamento de transporte de acordo com o nome do pacote.
    updateMode() {
        if (this.editingName) return;
        const local = String($('#packageName').val() || '').trim().startsWith('$');
        $('#packageTransport').prop('disabled', local);
        $('#packageRecordChanges').prop('disabled', local);
        if (local) {
            $('#packageTransport').val('');
            $('#packageRecordChanges').prop('checked', false);
        } else {
            $('#packageRecordChanges').prop('checked', true);
        }
        $('#packageModeHint').text(local
            ? 'Pacote local: não precisa de request Workbench nem gravação de alterações em transportes.'
            : 'Pacote não-local: selecione uma request Workbench. O console não cria requests automaticamente.');
    }

    // Monta os dados permitidos para criação de um pacote.
    createInput() {
        return {
            name: String($('#packageName').val() || '').trim().toUpperCase(),
            description: String($('#packageDescription').val() || '').trim(),
            language: String($('#packageLanguage').val() || '').trim().toUpperCase(),
            superPackage: String($('#packageSuper').val() || '').trim().toUpperCase(),
            packageType: String($('#packageType').val() || 'development'),
            softwareComponent: String($('#packageSoftware').val() || '').trim(),
            transportLayer: String($('#packageLayer').val() || '').trim(),
            transport: String($('#packageTransport').val() || '').trim(),
            recordChanges: $('#packageRecordChanges').is(':checked')
        };
    }

    // Monta exclusivamente os campos permitidos para alteração de um pacote.
    updateInput() {
        return {
            name: this.editingName,
            description: String($('#packageDescription').val() || '').trim(),
            transportLayer: String($('#packageLayer').val() || '').trim(),
            transport: String($('#packageTransport').val() || '').trim()
        };
    }

    // Envia criação ou alteração sem transmitir campos somente leitura na edição.
    async submit(event) {
        event.preventDefault();
        const input = this.editingName ? this.updateInput() : this.createInput();
        if (!input.name || !input.description) {
            this.app.showToast('Campos obrigatórios', 'Informe nome e descrição.', false);
            return;
        }
        if (!this.editingName && !input.language) {
            this.app.showToast('Campos obrigatórios', 'Selecione o idioma original.', false);
            return;
        }
        if (!input.name.startsWith('$') && !input.transport) {
            this.app.showToast('Request obrigatória', 'Selecione uma request Workbench para o pacote não-local.', false);
            return;
        }

        const operation = this.editingName ? 'package_update' : 'package_create';
        try {
            await this.execute(operation, input);
            this.modal('packageModal').hide();
            this.app.showToast(operation === 'package_create' ? 'Pacote criado' : 'Pacote alterado', `O pacote '${input.name}' foi processado com sucesso.`);
            await this.search();
        } catch (error) {
            this.app.showError(error.data || { ok: false, error: error.message });
        }
    }

    // Executa a ação selecionada para uma linha de pacote.
    async rowAction(action, name) {
        try {
            const data = await this.execute('package_get', { name });
            const packageData = data?.result;
            if (!packageData) return;
            if (action === 'view') {
                this.openView(packageData);
                return;
            }
            if (action === 'edit') {
                await this.openEdit(packageData);
                return;
            }
            await this.delete(name);
        } catch (error) {
            this.app.showError(error.data || { ok: false, error: error.message });
        }
    }

    // Exibe todos os dados do pacote em modo somente leitura.
    openView(packageData) {
        const fields = [
            ['Nome', packageData.name],
            ['Descrição', packageData.description],
            ['Idioma original', packageData.language],
            ['Tipo', packageData.packageType || packageData.type],
            ['Responsável', packageData.responsible],
            ['Superpackage', packageData.superPackage],
            ['Software Component', packageData.softwareComponent],
            ['Transport Layer', packageData.transportLayer],
            ['Record changes', packageData.recordChanges ? 'Sim' : 'Não']
        ];
        $('#packageViewFields').html(fields.map(([label, value]) => `
            <div class="col-md-6">
                <label class="form-label">${this.app.escapeHtml(label)}</label>
                <div class="modal-value">${this.app.escapeHtml(value ?? '')}</div>
            </div>`).join(''));
        this.modal('packageViewModal').show();
    }

    // Abre o fluxo de exclusão solicitando uma request Workbench para pacotes não locais.
    async delete(name) {
        const normalized = String(name || '').toUpperCase();
        this.pendingDelete = normalized;
        this.pendingDeleteTransport = '';
        if (normalized.startsWith('$')) {
            this.openDeleteConfirmation(normalized, '');
            return;
        }
        $('#transportFormTitle').text('Selecionar request Workbench');
        $('#transportModalText').text(`O pacote '${normalized}' não é local. Selecione uma request Workbench modificável para registrar a exclusão.`);
        $('#transportSubmit').prop('disabled', true);
        await this.populateTransportRequests();
        this.modal('packageTransportModal').show();
        this.renderTransportSelection();
    }

    // Abre o modal Bootstrap de confirmação final da exclusão do pacote.
    openDeleteConfirmation(name, transport) {
        this.pendingDelete = name;
        this.pendingDeleteTransport = transport || '';
        const suffix = transport ? ` usando a request '${transport}'` : '';
        $('#packageDeleteText').text(`Deseja realmente excluir o pacote '${name}'${suffix}?`);
        $('#packageDeleteConfirm').prop('disabled', false);
        this.modal('packageDeleteModal').show();
    }

    // Habilita a confirmação quando uma request Workbench é selecionada para exclusão.
    renderTransportSelection() {
        const box = $('#transportRequestList');
        const options = this.app.environmentOptions?.modifiableWorkbenchRequests || [];
        if (!options.length) {
            box.html('<div class="alert alert-secondary">Nenhuma request Workbench modificável encontrada para o usuário atual.</div>');
            return;
        }
        const rows = options.map(item => `
            <tr class="selectable-row">
                <td><input class="form-check-input" type="radio" name="packageTransportSelect" value="${this.app.escapeHtml(item.number)}"></td>
                <td><strong>${this.app.escapeHtml(item.number)}</strong></td>
                <td>${this.app.escapeHtml(item.owner)}</td>
                <td>${this.app.escapeHtml(item.description)}</td>
            </tr>`).join('');
        box.html(`<table class="table table-hover align-middle mb-0"><thead><tr><th>Selecionar</th><th>Código</th><th>Usuário</th><th>Descrição</th></tr></thead><tbody>${rows}</tbody></table>`);
        box.find('tbody tr').on('click', event => {
            const radio = $(event.currentTarget).find('input[type="radio"]');
            radio.prop('checked', true);
            box.find('tbody tr').removeClass('selected');
            $(event.currentTarget).addClass('selected');
            $('#transportSubmit').prop('disabled', false);
        });
    }

    // Confirma a exclusão usando a request Workbench selecionada.
    async confirmDelete() {
        const transport = $('input[name="packageTransportSelect"]:checked').val();
        if (!transport || !this.pendingDelete) return;
        const name = this.pendingDelete;
        this.pendingDeleteTransport = transport;
        this.modal('packageTransportModal').hide();
        this.openDeleteConfirmation(name, transport);
    }

    // Executa a exclusão depois da confirmação no modal Bootstrap.
    async confirmDeleteAction() {
        if (!this.pendingDelete) return;
        const name = this.pendingDelete;
        const transport = this.pendingDeleteTransport || '';
        this.pendingDelete = null;
        this.pendingDeleteTransport = '';
        $('#packageDeleteConfirm').prop('disabled', true);
        this.modal('packageDeleteModal').hide();
        await this.executeDelete(name, transport);
    }

    // Exclui um pacote no SAP e atualiza a tabela de resultados.
    async executeDelete(name, transport) {
        try {
            await this.execute('package_delete', { name, transport });
            this.app.showToast('Pacote excluído', `O pacote '${name}' foi excluído.`);
            await this.search();
        } catch (error) {
            this.app.showError(error.data || { ok: false, error: error.message });
        }
    }

    // Executa uma operação da API web usando a conexão SAP ativa.
    async execute(operation, input) {
        return this.app.api('/api/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ operation, connection: this.app.currentConnection(), input })
        });
    }

    // Retorna a instância Bootstrap do modal solicitado.
    modal(id) {
        return bootstrap.Modal.getOrCreateInstance(document.getElementById(id));
    }
}

window.packagesPage = new PackagesPage(window.app);
