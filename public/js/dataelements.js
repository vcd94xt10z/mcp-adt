class DataElementsPage {
    constructor() {
        this.app = window.app;
        this.current = null;
        this.ready = false;
        this.resourcesLoaded = false;
    }

    async activate() {
        await this.loadResources();
        if (!this.ready) this.init();
        if (!$('#dataelementResults').children().length) await this.search();
    }

    async loadResources() {
        if (this.resourcesLoaded) return;
        if (!window.ValueHelp) await $.getScript('/js/valuehelp/value-help.js');
        if (!window.packageValueHelp) await $.getScript('/js/valuehelp/package-value-help.js');
        if (!window.requestValueHelp) await $.getScript('/js/valuehelp/request-value-help.js');
        if (!window.domainDataTypeValueHelp) await $.getScript('/js/valuehelp/domain-data-type-value-help.js');
        this.resourcesLoaded = true;
    }

    init() {
        this.ready = true;
        $('#dataelementSearchForm').on('submit', event => {
            event.preventDefault();
            this.search();
        });
        $('#dataelementCreate').on('click', () => this.openCreate());
        $('#dataelementForm').on('submit', event => {
            event.preventDefault();
            this.save();
        });
        $('#dataelementResults').on('click', '[data-action]', event => this.action(event));
        $('#dataelementActivate').on('click', () => this.activateObject());
        $('#dataelementDeleteConfirm').on('click', () => this.remove());

        $(document).on('click', '#dataelementsPage .value-help-button', event => {
            const button = $(event.currentTarget);
            if (!button.prop('disabled')) this.openValueHelp(button.data('value-help'));
        });

        $(document).on('keydown', '#dataelementsPage input', event => {
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

        $('#dataelementPackageName').on('input change', () => this.updateTransportState());
        $('#dataelementTypeKind').on('change', () => this.updateTypeState());
    }

    openValueHelp(type) {
        if (type === 'package') return window.packageValueHelp.open(item => {
            $('#dataelementPackageName').val(item.name);
            this.updateTransportState();
        });
        if (type === 'request') return window.requestValueHelp.open(item => $('#dataelementTransport').val(item.number));
        if (type === 'datatype') return window.domainDataTypeValueHelp.open(item => $('#dataelementDataType').val(item.code));
    }

    async search() {
        try {
            const response = await this.execute('dataelement_list', {
                query: $('#dataelementSearch').val().trim() || 'Z*'
            });
            const data = response.result || response;
            const items = data.items || [];
            const rows = items.map(item => `
                <tr>
                    <td>${this.esc(item.name)}</td>
                    <td>${this.esc(item.description)}</td>
                    <td>${this.esc(item.packageName)}</td>
                    <td class="table-actions">
                        <button type="button" class="btn btn-sm btn-outline-secondary" data-action="view" data-name="${this.attr(item.name)}">Visualizar</button>
                        <button type="button" class="btn btn-sm btn-outline-primary" data-action="edit" data-name="${this.attr(item.name)}">Editar</button>
                        <button type="button" class="btn btn-sm btn-outline-success" data-action="activate" data-name="${this.attr(item.name)}">Ativar</button>
                        <button type="button" class="btn btn-sm btn-outline-danger" data-action="delete" data-name="${this.attr(item.name)}">Excluir</button>
                    </td>
                </tr>`).join('');
            $('#dataelementResults').html(rows || '<tr><td colspan="4" class="text-center text-secondary">Nenhum elemento de dados encontrado.</td></tr>');
        } catch (error) {
            this.app.showError(error.data || { error: error.message });
        }
    }

    async openCreate() {
        try {
            this.current = null;
            const form = $('#dataelementForm');
            form[0].reset();
            form.find('input, button, select, textarea').prop('disabled', false);
            form.find('input, select, textarea').prop('readonly', false);
            $('#dataelementFormTitle').text('Novo elemento de dados');
            $('#dataelementLanguage').val(await this.app.currentConnectionLanguage()).prop('readonly', true).addClass('readonly-field');
            $('#dataelementTypeKind').val('domain');
            $('#dataelementDataTypeDecimals').val(0);
            $('#dataelementShortFieldLength').val(10);
            $('#dataelementMediumFieldLength').val(20);
            $('#dataelementLongFieldLength').val(40);
            $('#dataelementHeadingFieldLength').val(55);
            this.updateTransportState();
            this.updateTypeState();
            $('#dataelementActivate').hide();
            this.modal('dataelementModal').show();
        } catch (error) {
            this.app.showError(error.data || { error: error.message });
        }
    }

    async open(name, view = false) {
        try {
            const response = await this.execute('dataelement_get', { name });
            const data = response.result || response;
            this.current = data;
            $('#dataelementForm')[0].reset();
            $('#dataelementFormTitle').text(`Elemento de Dados ${data.name}${view ? ' (Visualização)' : ''}`);

            const fields = {
                dataelementName: data.name,
                dataelementDescription: data.description,
                dataelementLanguage: await this.app.currentConnectionLanguage(),
                dataelementPackageName: data.packageName,
                dataelementTransport: data.transport?.number || data.transport || '',
                dataelementTypeKind: data.typeKind,
                dataelementTypeName: data.typeName,
                dataelementDataType: data.dataType,
                dataelementDataTypeLength: data.dataTypeLength,
                dataelementDataTypeDecimals: data.dataTypeDecimals,
                dataelementShortFieldLabel: data.shortFieldLabel,
                dataelementShortFieldLength: data.shortFieldLength,
                dataelementMediumFieldLabel: data.mediumFieldLabel,
                dataelementMediumFieldLength: data.mediumFieldLength,
                dataelementLongFieldLabel: data.longFieldLabel,
                dataelementLongFieldLength: data.longFieldLength,
                dataelementHeadingFieldLabel: data.headingFieldLabel,
                dataelementHeadingFieldLength: data.headingFieldLength,
            };
            Object.entries(fields).forEach(([id, value]) => $(`#${id}`).val(value ?? ''));
            this.updateTypeState();

            const form = $('#dataelementForm');
            if (view) {
                form.find('input, button, select, textarea').prop('disabled', true);
                $('#dataelementModal .btn-close,#dataelementForm [data-bs-dismiss]').prop('disabled', false);
                $('#dataelementSave,#dataelementActivate').hide();
            } else {
                form.find('input, button, select, textarea').prop('disabled', false);
                $('#dataelementName,#dataelementPackageName,#dataelementTransport,#dataelementLanguage').prop('readonly', true);
                $('#dataelementLanguage').addClass('readonly-field');
                $('#dataelementForm .value-help-button[data-value-help="package"],#dataelementForm .value-help-button[data-value-help="request"]').prop('disabled', true);
                $('#dataelementSave,#dataelementActivate').show();
            }
            this.modal('dataelementModal').show();
        } catch (error) {
            this.app.showError(error.data || { error: error.message });
        }
    }

    async action(event) {
        const button = $(event.currentTarget);
        const name = button.data('name');
        const action = button.data('action');
        if (action === 'view') return this.open(name, true);
        if (action === 'edit') return this.open(name, false);
        if (action === 'activate') return this.activateResult(name);
        if (action === 'delete') {
            this.current = { name };
            $('#dataelementDeleteText').text(`Deseja realmente excluir o elemento de dados '${name}'?`);
            this.modal('dataelementDeleteModal').show();
        }
    }

    values() {
        const input = {};
        $('#dataelementForm').serializeArray().forEach(field => input[field.name] = field.value.trim());
        const numericFields = ['dataTypeLength', 'dataTypeDecimals', 'shortFieldLength', 'mediumFieldLength', 'longFieldLength', 'headingFieldLength'];
        numericFields.forEach(field => input[field] = Number(input[field] || 0));
        input.name = String(input.name || '').toUpperCase();
        input.packageName = String(input.packageName || '').toUpperCase();
        input.typeKind = String(input.typeKind || '').toLowerCase();
        input.typeName = String(input.typeName || '').toUpperCase();
        input.dataType = String(input.dataType || '').toUpperCase();
        return input;
    }

    async save() {
        try {
            const input = this.values();
            if (!input.name || !input.description || !input.packageName || !input.typeKind || (input.typeKind === 'domain' && !input.typeName)) {
                this.app.showToast('Atenção', 'Preencha os campos obrigatórios.', false);
                return;
            }
            const operation = this.current?.name ? 'dataelement_update' : 'dataelement_create';
            await this.execute(operation, input);
            this.app.showToast('Sucesso', operation === 'dataelement_create' ? 'Elemento de dados criado.' : 'Elemento de dados atualizado.');
            this.modal('dataelementModal').hide();
            await this.search();
        } catch (error) {
            this.app.showError(error.data || { error: error.message });
        }
    }

    async activateObject() {
        try {
            await this.execute('dataelement_activate', { name: this.current?.name || $('#dataelementName').val().trim() });
            this.app.showToast('Sucesso', 'Elemento de dados ativado.');
        } catch (error) {
            this.app.showError(error.data || { error: error.message });
        }
    }

    async activateResult(name) {
        try {
            await this.execute('dataelement_activate', { name });
            this.app.showToast('Sucesso', `Elemento de dados ${name} ativado.`);
        } catch (error) {
            this.app.showError(error.data || { error: error.message });
        }
    }

    async remove() {
        try {
            await this.execute('dataelement_delete', { name: this.current?.name });
            this.modal('dataelementDeleteModal').hide();
            this.app.showToast('Sucesso', 'Elemento de dados excluído.');
            await this.search();
        } catch (error) {
            this.app.showError(error.data || { error: error.message });
        }
    }

    // Ajusta o campo de domínio conforme o tipo selecionado.
    updateTypeState() {
        const predefined = $('#dataelementTypeKind').val() === 'predefined';
        const typeName = $('#dataelementTypeName');
        typeName.prop('disabled', predefined).prop('required', !predefined).toggleClass('readonly-field', predefined);
        $('#dataelementTypeNameRequired').toggle(!predefined);
        if (predefined) typeName.val('');
    }

    updateTransportState() {
        if (this.current?.name) return;
        const local = $('#dataelementPackageName').val().trim().startsWith('$');
        $('#dataelementTransport').prop('readonly', local).toggleClass('readonly-field', local);
        $('#dataelementForm .value-help-button[data-value-help="request"]').prop('disabled', local);
        if (local) $('#dataelementTransport').val('');
    }

    execute(operation, input = {}) {
        return this.app.executeOperation(operation, input);
    }

    modal(id) {
        return bootstrap.Modal.getOrCreateInstance(document.getElementById(id));
    }

    esc(value) {
        return this.app.escapeHtml(value);
    }

    attr(value) {
        return String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    }
}

window.dataelementsPage = new DataElementsPage();
