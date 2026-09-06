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
                const options = await window.app.loadEnvironmentOptions();
                const text = query.toUpperCase();
                return (options.languages || []).map(item => typeof item === 'string' ? { code: item } : item)
                    .filter(item => !text || `${item.code} ${item.description || ''}`.toUpperCase().includes(text));
            }
        });
    }
}
window.languageValueHelp = new LanguageValueHelp();
