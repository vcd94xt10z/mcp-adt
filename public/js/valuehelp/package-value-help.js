class PackageValueHelp extends ValueHelp {
    constructor() {
        super({
            id: 'packageValueHelpModal',
            title: 'Selecionar pacote',
            columns: [
                { label: 'Pacote', value: item => item.name },
                { label: 'Descrição', value: item => item.description }
            ],
            loadItems: async query => {
                const pattern = query || 'Z*';
                const result = await window.classesPage.execute('package_list', { query: pattern.includes('*') ? pattern : `${pattern}*`, maxResults: 200 });
                return result.result.items || [];
            }
        });
    }
}
window.packageValueHelp = new PackageValueHelp();
