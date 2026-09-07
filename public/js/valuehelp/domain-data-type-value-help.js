class DomainDataTypeValueHelp extends ValueHelp {
    constructor() {
        super({
            id: 'domainDataTypeValueHelpModal',
            title: 'Selecionar tipo de dados',
            columns: [
                { label: 'Tipo', value: item => item.code },
                { label: 'Descrição', value: item => item.description }
            ],
            loadItems: async query => {
                const types = [
                    { code: 'CHAR', description: 'Campo de caracteres' },
                    { code: 'CLNT', description: 'Cliente SAP' },
                    { code: 'CUKY', description: 'Chave de moeda' },
                    { code: 'CURR', description: 'Campo de moeda' },
                    { code: 'DATS', description: 'Data' },
                    { code: 'DEC', description: 'Número decimal compactado' },
                    { code: 'FLTP', description: 'Ponto flutuante' },
                    { code: 'INT1', description: 'Inteiro de 1 byte' },
                    { code: 'INT2', description: 'Inteiro de 2 bytes' },
                    { code: 'INT4', description: 'Inteiro de 4 bytes' },
                    { code: 'INT8', description: 'Inteiro de 8 bytes' },
                    { code: 'LANG', description: 'Chave de idioma' },
                    { code: 'NUMC', description: 'Texto numérico' },
                    { code: 'QUAN', description: 'Campo de quantidade' },
                    { code: 'RAW', description: 'Dados binários' },
                    { code: 'SSTRING', description: 'String curta' },
                    { code: 'STRING', description: 'String' },
                    { code: 'TIMS', description: 'Hora' },
                    { code: 'UNIT', description: 'Unidade de medida' },
                    { code: 'UTCLONG', description: 'Timestamp UTC longo' }
                ];
                const text = String(query ?? '').trim().toUpperCase();
                return types.filter(item => !text || `${item.code} ${item.description}`.toUpperCase().includes(text));
            }
        });
    }
}

window.domainDataTypeValueHelp = new DomainDataTypeValueHelp();
