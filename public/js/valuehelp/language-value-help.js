class LanguageValueHelp extends ValueHelp {
    constructor() {
        super({
            id: 'languageValueHelpModal',
            title: 'Selecionar idioma',
            columns: [
                { label: 'Idioma', value: item => item.code || item },
                { label: 'Descrição', value: item => item.description || '' }
            ],
            loadItems: async query => {
                const connection = window.app.currentConnection();
                const response = await window.app.api(`/api/languages?connection=${encodeURIComponent(connection)}`);
                const text = query.toUpperCase();
                return (response.languages || []).map(item => typeof item === 'string' ? { code: item } : item)
                    .filter(item => !text || `${item.code} ${item.description || ''}`.toUpperCase().includes(text));
            }
        });
    }
}
window.languageValueHelp = new LanguageValueHelp();
