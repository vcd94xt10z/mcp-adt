class RequestValueHelp extends ValueHelp {
    constructor() {
        super({
            id: 'requestValueHelpModal',
            title: 'Selecionar request Workbench',
            columns: [
                { label: 'Request', value: item => item.number },
                { label: 'Descrição', value: item => item.description },
                { label: 'Owner', value: item => item.owner }
            ],
            loadItems: async query => {
                const result = await window.app.executeOperation('request_modifiable_workbench_list', {});
                const text = query.toUpperCase();
                return (result.result.items || []).filter(item => !text || `${item.number} ${item.description}`.toUpperCase().includes(text));
            }
        });
    }
}
window.requestValueHelp = new RequestValueHelp();
