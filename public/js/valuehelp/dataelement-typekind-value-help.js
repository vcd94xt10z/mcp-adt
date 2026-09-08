class DataElementTypeKindValueHelp extends ValueHelp {
    constructor() {
        super({
            id: 'dataElementTypeKindValueHelpModal',
            title: 'Selecionar tipo',
            columns: [
                { label: 'Tipo', value: item => item.code },
                { label: 'Descrição', value: item => item.description }
            ],
            loadItems: async query => {
                const items = [
                    { code: 'domain', description: 'Domínio' },
                    { code: 'predefined', description: 'Tipo ABAP predefinido' }
                ];
                const text = String(query ?? '').trim().toUpperCase();
                return items.filter(item => !text || `${item.code} ${item.description}`.toUpperCase().includes(text));
            }
        });
    }
}

window.dataElementTypeKindValueHelp = new DataElementTypeKindValueHelp();
