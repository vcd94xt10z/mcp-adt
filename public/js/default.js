class AppShell {
    constructor() {
        this.connectionData = [];
        this.environmentOptions = null;
        this.environmentOptionsConnection = null;
        this.loadedPages = new Set();
        this.pendingHttpRequests = 0;
    }

    // Inicializa a aplicação, carrega o cabeçalho, os recursos compartilhados e a primeira tela.
    async init() {
        this.createSharedUi();
        await this.loadHeader();
        this.bindNavigation();
        await this.loadConnections();
        await this.openPage('connections');
    }

    // Cria os componentes compartilhados usados por todas as telas.
    createSharedUi() {
        $('#sharedContent').html(`
            <div id="httpLoader" class="app-loader" hidden aria-hidden="true" role="status" aria-live="polite">
                <div class="app-loader-box">
                    <div class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></div>
                    <span>Aguarde, processando...</span>
                </div>
            </div>
            <div class="toast-container position-fixed top-0 end-0 p-3" id="toastContainer"></div>
            <div class="modal fade" id="errorLogModal" tabindex="-1" aria-hidden="true">
                <div class="modal-dialog modal-lg modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">Erro na operação</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
                        </div>
                        <div class="modal-body">
                            <div id="errorLogMessage" class="alert alert-warning"></div>
                            <pre id="errorLog" class="bg-body-tertiary border rounded p-3 mb-0"></pre>
                        </div>
                        <div class="modal-footer">
                            <button id="copyErrorLog" type="button" class="btn btn-primary">Copiar log</button>
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
                        </div>
                    </div>
                </div>
            </div>
        `);

        $('#copyErrorLog').on('click', async () => {
            try {
                await navigator.clipboard.writeText($('#errorLog').text());
                this.showToast('Log copiado', 'O conteúdo do erro foi copiado.', true);
            } catch {
                this.showToast('Clipboard indisponível', 'Não foi possível copiar o log.', false);
            }
        });
    }

    // Carrega o cabeçalho comum a todas as telas.
    async loadHeader() {
        const html = await $.get('/header.html');
        $('#appHeader').html(html);
    }

    // Registra a navegação entre as telas e a troca de conexão SAP.
    bindNavigation() {
        $(document).on('click', '[data-page]', async event => {
            event.preventDefault();
            await this.openPage($(event.currentTarget).data('page'));
        });

        $(document).on('change', '#connection', () => {
            this.environmentOptions = null;
            this.environmentOptionsConnection = null;
            $(document).trigger('sap:connectionChanged');
        });
    }

    // Abre uma categoria, carregando seu HTML, CSS e JavaScript apenas uma vez.
    async openPage(page) {
        const pages = ['connections', 'requests', 'packages', 'log'];
        if (!pages.includes(page)) return;

        $('[data-page]').removeClass('active');
        $(`[data-page="${page}"]`).addClass('active');

        if (!this.loadedPages.has(page)) {
            await this.loadPageResources(page);
            this.loadedPages.add(page);
        }

        $('.app-page').addClass('d-none');
        $(`#${page}Page`).removeClass('d-none');

        if (window[`${page}Page`]?.activate) {
            await window[`${page}Page`].activate();
        }
    }

    // Carrega os três arquivos exclusivos de uma categoria.
    async loadPageResources(page) {
        const cssId = `page-css-${page}`;
        if (!$(`#${cssId}`).length) {
            $('<link>', { id: cssId, rel: 'stylesheet', href: `/css/${page}.css` }).appendTo('head');
        }

        const html = await $.get(`/views/${page}.html`);
        $('#appContent').append(html);
        await $.getScript(`/js/${page}.js`);
    }

    // Retorna o nome da conexão SAP atualmente selecionada.
    currentConnection() {
        return $('#connection').val() || '';
    }

    // Carrega as conexões cadastradas e preserva a seleção atual quando possível.
    async loadConnections(selected) {
        const data = await this.api('/api/connections');
        this.connectionData = data.connections || [];
        const previous = selected || this.currentConnection();
        const select = $('#connection');
        select.empty();
        this.connectionData.forEach(connection => {
            $('<option>', { value: connection.name, text: connection.name }).appendTo(select);
        });
        if (this.connectionData.length) {
            select.val(this.connectionData.some(item => item.name === previous) ? previous : this.connectionData[0].name);
        }
        this.environmentOptions = null;
        this.environmentOptionsConnection = null;
        $(document).trigger('connections:loaded');
    }

    // Retorna as opções dependentes do ambiente SAP e utiliza cache por conexão.
    async loadEnvironmentOptions(force = false) {
        const connection = this.currentConnection();
        if (!connection) throw new Error('Selecione uma conexão SAP.');
        if (!force && this.environmentOptions && this.environmentOptionsConnection === connection) {
            return this.environmentOptions;
        }
        const data = await this.api(`/api/environment-options?connection=${encodeURIComponent(connection)}`);
        this.environmentOptions = data;
        this.environmentOptionsConnection = connection;
        return data;
    }

    // Executa uma chamada à API web e converte respostas JSON para um objeto JavaScript.
    async api(url, options = {}) {
        this.pendingHttpRequests += 1;
        this.setHttpLoader(true);
        try {
            const response = await fetch(url, options);
            const text = await response.text();
            let data;
            try {
                data = text ? JSON.parse(text) : {};
            } catch {
                data = { raw: text };
            }
            if (!response.ok) {
                throw Object.assign(new Error(data?.error?.message || data?.error || `HTTP ${response.status}`), {
                    data,
                    status: response.status
                });
            }
            return data;
        } finally {
            this.pendingHttpRequests = Math.max(0, this.pendingHttpRequests - 1);
            this.setHttpLoader(this.pendingHttpRequests > 0);
        }
    }

    // Controla o indicador visual de processamento das chamadas HTTP.
    setHttpLoader(visible) {
        $('#httpLoader').prop('hidden', !visible).attr('aria-hidden', String(!visible));
    }

    // Exibe um erro técnico em uma janela compartilhada entre as telas.
    showError(value) {
        const data = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        $('#errorLog').text(data);
        $('#errorLogMessage').text(this.connectionErrorReason({ data: value }));
        bootstrap.Modal.getOrCreateInstance(document.getElementById('errorLogModal')).show();
    }

    // Extrai uma mensagem amigável dos erros de conexão sem exibir o retorno técnico do SAP.
    connectionErrorReason(error) {
        const data = error?.data;
        if (data?.error?.userMessage) return data.error.userMessage;
        const response = data?.error?.response;
        const status = Number(response?.status ?? error?.status ?? 0);
        const body = String(response?.body ?? '');
        const message = String(data?.error?.message ?? error?.message ?? '');
        const source = `${message} ${body}`.toLowerCase();
        const adtMessage = this.extractAdtMessage(body);
        if (adtMessage) return adtMessage;

        if (/self[- ]signed certificate|unable to verify|certificate|err_tls|depth_zero_self_signed|tls/i.test(source)) {
            return "Certificado TLS inválido ou não confiável. Desmarque 'Rejeitar certificados TLS inválidos' para ignorá-lo.";
        }

        if (status === 0 || /fetch failed|enotfound|econnrefused|etimedout|ehostunreach|network request/i.test(source)) {
            return 'Host inacessível ou não foi possível conectar ao SAP.';
        }

        if (status === 401 || /logon failed|invalid user|unknown user|user .*not found/i.test(source)) {
            return 'Usuário ou senha incorretos.';
        }

        if (/client .*not found|client .*does not exist|invalid client|mandante .*inv[aá]lido/i.test(source)) {
            return 'Mandante inválido.';
        }

        if (/invalid password|incorrect password|password .*invalid|senha .*inv[aá]lida/i.test(source)) {
            return 'Senha inválida.';
        }

        if (status === 403) {
            return 'Usuário sem autorização para acessar o SAP.';
        }

        if (status === 404) {
            return 'Endpoint do SAP não encontrado. Verifique a URL da conexão.';
        }

        if (status === 408 || /timeout|timed out/i.test(source)) {
            return 'Tempo limite excedido ao conectar ao SAP.';
        }

        if (status >= 500) {
            return 'O SAP está indisponível ou retornou um erro interno.';
        }

        return 'Não foi possível estabelecer a conexão com o SAP. Verifique os dados da conexão.';
    }

    // Extrai a mensagem retornada pelo ADT em respostas XML de erro.
    extractAdtMessage(body) {
        const xml = String(body ?? '').trim();
        if (!xml || !/<(?:[A-Za-z_][\w.-]*:)?(?:localizedMessage|message)\b/i.test(xml)) return '';

        try {
            const document = new DOMParser().parseFromString(xml, 'application/xml');
            if (!document.querySelector('parsererror')) {
                const localized = [...document.getElementsByTagNameNS('*', 'localizedMessage')].find(node => node.textContent.trim());
                if (localized) return localized.textContent.trim();
                const message = [...document.getElementsByTagNameNS('*', 'message')].find(node => node.textContent.trim());
                if (message) return message.textContent.trim();
            }
        } catch {
        }

        const localizedMatch = xml.match(/<(?:[A-Za-z_][\w.-]*:)?localizedMessage\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?localizedMessage>/i);
        const messageMatch = xml.match(/<(?:[A-Za-z_][\w.-]*:)?message\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?message>/i);
        const value = localizedMatch?.[1] || messageMatch?.[1] || '';
        return value.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '\"').replace(/&#39;/g, "'").trim();
    }

    // Exibe uma notificação curta de sucesso ou erro para o usuário.
    showToast(title, message, ok = true) {
        const toast = $(`
            <div class="toast" role="alert" aria-live="assertive" aria-atomic="true">
                <div class="toast-header">
                    <strong class="me-auto">${this.escapeHtml(title)}</strong>
                    <button type="button" class="btn-close" data-bs-dismiss="toast" aria-label="Fechar"></button>
                </div>
                <div class="toast-body"></div>
            </div>
        `);
        toast.find('.toast-body').text(message);
        toast.addClass(ok ? 'border border-success' : 'border border-danger');
        if (ok) toast.find('.toast-header strong').addClass('text-success');
        $('#toastContainer').append(toast);
        const instance = bootstrap.Toast.getOrCreateInstance(toast[0], { delay: 5000 });
        instance.show();
        toast.on('hidden.bs.toast', () => toast.remove());
    }

    // Escapa texto antes de inseri-lo em HTML criado dinamicamente.
    escapeHtml(value) {
        return String(value ?? '').replace(/[&<>'"]/g, character => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[character]));
    }

    // Preenche um select Bootstrap com itens simples ou objetos de value/label.
    setSelectOptions(selector, items, placeholder, value) {
        const select = $(selector);
        select.empty();
        if (placeholder !== undefined) {
            $('<option>', { value: '', text: placeholder }).appendTo(select);
        }
        (Array.isArray(items) ? items : []).forEach(item => {
            const code = typeof item === 'string' ? item : (item.code || item.number || '');
            const description = typeof item === 'string' ? '' : item.description;
            $('<option>', {
                value: code,
                text: description ? `${code} — ${description}` : code
            }).appendTo(select);
        });
        if (value && select.find(`option[value="${CSS.escape(value)}"]`).length) {
            select.val(value);
        }
    }
}

window.app = new AppShell();

$(async () => {
    try {
        await window.app.init();
    } catch (error) {
        window.app.showError(error.data || { ok: false, error: error.message });
    }
});
