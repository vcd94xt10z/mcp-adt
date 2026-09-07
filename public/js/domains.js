class DomainsPage {
    constructor(app) {
        this.app = app;
        this.current = null;
        this.pendingDelete = null;
        this.bound = false;
        this.resourcesLoaded = false;
    }

    async activate() {
        await this.loadResources();
        if (!this.bound) {
            this.bind();
            this.bound = true;
        }
        if (!$('#domainResults').children().length) await this.search();
    }

    async loadResources() {
        if (this.resourcesLoaded) return;
        if (!window.ValueHelp) await $.getScript('/js/valuehelp/value-help.js');
        if (!window.packageValueHelp) await $.getScript('/js/valuehelp/package-value-help.js');
        if (!window.requestValueHelp) await $.getScript('/js/valuehelp/request-value-help.js');
        if (!window.languageValueHelp) await $.getScript('/js/valuehelp/language-value-help.js');
        if (!window.domainDataTypeValueHelp) await $.getScript('/js/valuehelp/domain-data-type-value-help.js');
        this.resourcesLoaded = true;
    }

    bind() {
        $('#domainSearchForm').on('submit', event => {
            event.preventDefault();
            this.search();
        });
        $('#domainCreate').on('click', () => this.openCreate());
        $('#domainForm').on('submit', event => {
            event.preventDefault();
            this.save();
        });
        $('#domainResults').on('click', '[data-action]', event => this.action(event));
        $('#domainAddFix').on('click', () => this.addFix());
        $('#domainFixValues').on('click', '.domain-fix-remove', event => $(event.currentTarget).closest('tr').remove());
        $('#domainActivate').on('click', () => this.activateDomain());
        $('#domainDeleteConfirm').on('click', () => this.deleteDomain());

        $(document).on('click', '#domainsPage .value-help-button', event => {
            this.openValueHelp($(event.currentTarget).data('value-help'));
        });

        $(document).on('keydown', '#domainsPage input', event => {
            if (event.key === 'F8') {
                event.preventDefault();
                this.search();
            }
            if (event.key === 'F4') {
                const button = $(event.currentTarget).closest('.input-group').find('.value-help-button');
                if (button.length && !button.prop('disabled')) {
                    event.preventDefault();
                    this.openValueHelp(button.data('value-help'));
                }
            }
        });
    }

    openValueHelp(type) {
        if (type === 'package') return window.packageValueHelp.open(item => $('#domainPackage').val(item.name));
        if (type === 'request') return window.requestValueHelp.open(item => $('#domainTransport').val(item.number));
        if (type === 'language') return window.languageValueHelp.open(item => $('#domainLanguage').val(item.code || item));
        if (type === 'datatype') return window.domainDataTypeValueHelp.open(item => $('#domainDatatype').val(item.code));
    }

    // Abre o formulário para criação e restaura todos os campos após uma visualização.
    openCreate() {
        this.current = null;
        const form = $('#domainForm');
        form[0].reset();
        form.find('input, button, select, textarea').prop('disabled', false);
        form.find('input, select, textarea').prop('readonly', false);
        $('#domainFormTitle').text('Novo domínio');
        $('#domainLanguage').val('EN');
        $('#domainFixValues').empty();
        $('#domainActivate').hide();
        this.modal('domainModal').show();
    }

    addFix(value = {}) {
        $('#domainFixValues').append(`<tr><td><input class="form-control domain-fix-low" value="${this.attr(value.low || '')}"></td><td><input class="form-control domain-fix-high" value="${this.attr(value.high || '')}"></td><td><input class="form-control domain-fix-text" value="${this.attr(value.text || '')}"></td><td><button type="button" class="btn btn-sm btn-outline-danger domain-fix-remove">Excluir</button></td></tr>`);
    }

    async action(event) {
        const button = $(event.currentTarget);
        const name = button.data('name');
        const action = button.data('action');
        if (action === 'delete') return this.confirmDelete(name);
        if (action === 'activate') return this.activateResult(name);

        try {
            const data = await this.execute('domain_get', { name });
            this.current = data.result;
            this.fill(data.result, action === 'view');
            this.modal('domainModal').show();
        } catch (error) {
            this.app.showError(error.data || { error: error.message });
        }
    }

    fill(domain, view) {
        $('#domainForm')[0].reset();
        $('#domainFormTitle').text(`Domínio ${domain.name}${view ? ' (Visualização)' : ''}`);

        const fields = {
            domainName: domain.name,
            domainDescription: domain.description,
            domainPackage: domain.packageName,
            domainLanguage: domain.language || 'EN',
            domainDatatype: domain.datatype,
            domainLength: domain.length,
            domainDecimals: domain.decimals,
            domainOutputLength: domain.outputLength,
            domainConversionExit: domain.conversionExit,
            domainValueTable: domain.valueTable
        };
        Object.entries(fields).forEach(([id, value]) => $(`#${id}`).val(value ?? ''));
        $('#domainLowercase').prop('checked', !!domain.lowercase);
        $('#domainSignExists').prop('checked', !!domain.signExists);
        $('#domainFixValues').empty();
        (domain.fixValues || []).forEach(value => this.addFix(value));

        $('#domainName,#domainPackage,#domainLanguage,#domainTransport').prop('readonly', true);
        if (view) {
            $('#domainForm').find('input,button').prop('disabled', true);
            $('#domainForm .btn-close,#domainForm [data-bs-dismiss]').prop('disabled', false);
        } else {
            $('#domainForm').find('input,button').prop('disabled', false);
            $('#domainName,#domainPackage,#domainLanguage,#domainTransport').prop('readonly', true);
        }
        $('#domainActivate').toggle(!view);
    }

    values() {
        return $('#domainFixValues tr').map((_, row) => ({
            low: $(row).find('.domain-fix-low').val().trim(),
            high: $(row).find('.domain-fix-high').val().trim(),
            text: $(row).find('.domain-fix-text').val().trim()
        })).get().filter(item => item.low || item.text);
    }

    async save() {
        try {
            const input = {
                name: $('#domainName').val().trim(),
                description: $('#domainDescription').val().trim(),
                packageName: $('#domainPackage').val().trim(),
                transport: $('#domainTransport').val().trim(),
                language: $('#domainLanguage').val().trim() || 'EN',
                datatype: $('#domainDatatype').val().trim().toUpperCase(),
                length: Number($('#domainLength').val()),
                decimals: Number($('#domainDecimals').val() || 0),
                outputLength: Number($('#domainOutputLength').val() || 0),
                conversionExit: $('#domainConversionExit').val().trim().toUpperCase(),
                valueTable: $('#domainValueTable').val().trim().toUpperCase(),
                lowercase: $('#domainLowercase').prop('checked'),
                signExists: $('#domainSignExists').prop('checked'),
                fixValues: this.values()
            };
            if (this.current) await this.execute('domain_update', input);
            else await this.execute('domain_create', input);
            this.app.showToast('Sucesso', this.current ? 'Domínio atualizado.' : 'Domínio criado.');
            this.modal('domainModal').hide();
            await this.search();
        } catch (error) {
            this.app.showError(error.data || { error: error.message });
        }
    }

    async activateDomain() {
        try {
            await this.execute('domain_activate', { name: $('#domainName').val().trim() });
            this.app.showToast('Sucesso', 'Domínio ativado.');
        } catch (error) {
            this.app.showError(error.data || { error: error.message });
        }
    }

    async activateResult(name) {
        try {
            await this.execute('domain_activate', { name });
            this.app.showToast('Sucesso', `Domínio ${name} ativado.`);
        } catch (error) {
            this.app.showError(error.data || { error: error.message });
        }
    }

    async confirmDelete(name) {
        this.pendingDelete = name;
        $('#domainDeleteText').text(`Deseja realmente excluir o domínio '${name}'?`);
        $('#domainDeleteTransport').val('');
        this.modal('domainDeleteModal').show();
        try {
            const data = await this.execute('domain_delete_check', { name });
            $('#domainDeleteTransport').val(data.result.transport || '');
        } catch (error) {
            this.app.showError(error.data || { error: error.message });
        }
    }

    async deleteDomain() {
        try {
            await this.execute('domain_delete', {
                name: this.pendingDelete,
                transport: $('#domainDeleteTransport').val().trim()
            });
            this.modal('domainDeleteModal').hide();
            this.app.showToast('Sucesso', 'Domínio excluído.');
            await this.search();
        } catch (error) {
            this.app.showError(error.data || { error: error.message });
        }
    }

    // Pesquisa domínios usando o padrão e o máximo informados no formulário.
    async search() {
        try {
            const query = ($('#domainSearchQuery').val() || '*').trim() || '*';
            const maxResults = Math.max(1, Number($('#domainSearchMax').val()) || 100);
            const data = await this.execute('domain_list', { query, maxResults });
            const items = data.result?.items || [];
            const rows = items.map(item => `<tr>
                <td>${this.esc(item.name)}</td>
                <td>${this.esc(item.description || '')}</td>
                <td>${this.esc(item.packageName || '')}</td>
                <td class="text-nowrap">
                    <button type="button" class="btn btn-sm btn-outline-secondary" data-action="view" data-name="${this.attr(item.name)}">Visualizar</button>
                    <button type="button" class="btn btn-sm btn-outline-primary" data-action="edit" data-name="${this.attr(item.name)}">Editar</button>
                    <button type="button" class="btn btn-sm btn-outline-success" data-action="activate" data-name="${this.attr(item.name)}">Ativar</button>
                    <button type="button" class="btn btn-sm btn-outline-danger" data-action="delete" data-name="${this.attr(item.name)}">Excluir</button>
                </td>
            </tr>`).join('');
            $('#domainResults').html(`<table class="table table-hover align-middle mb-0"><thead><tr><th>Nome</th><th>Descrição</th><th>Pacote</th><th>Ações</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="text-center text-secondary">Nenhum domínio encontrado.</td></tr>'}</tbody></table>`);
        } catch (error) {
            this.app.showError(error.data || { error: error.message });
        }
    }

    execute(operation, input) {
        return this.app.executeOperation(operation, input);
    }

    modal(id) {
        return bootstrap.Modal.getOrCreateInstance(document.getElementById(id));
    }

    esc(value) {
        return $('<div>').text(value ?? '').html();
    }

    attr(value) {
        return this.esc(value).replaceAll('"', '&quot;');
    }
}

window.domainsPage = new DomainsPage(window.app);
