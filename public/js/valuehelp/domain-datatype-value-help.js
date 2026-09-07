class DomainDatatypeValueHelp extends ValueHelp {
    constructor() {
        super({
            id: 'domainDatatypeValueHelpModal',
            title: 'Selecionar tipo de dados',
            columns: [
                { label: 'Tipo', value: item => item.code },
                { label: 'Descrição', value: item => item.description }
            ],
            loadItems: async query => {
                const items = [
                    { code: 'CHAR', description: 'Character' },
                    { code: 'NUMC', description: 'Numeric text' },
                    { code: 'DATS', description: 'Date' },
                    { code: 'TIMS', description: 'Time' },
                    { code: 'INT1', description: '1-byte integer' },
                    { code: 'INT2', description: '2-byte integer' },
                    { code: 'INT4', description: '4-byte integer' },
                    { code: 'INT8', description: '8-byte integer' },
                    { code: 'DEC', description: 'Packed number' },
                    { code: 'CURR', description: 'Currency amount' },
                    { code: 'QUAN', description: 'Quantity' },
                    { code: 'FLTP', description: 'Floating point number' },
                    { code: 'DECFLOAT16', description: 'Decimal floating point 16' },
                    { code: 'DECFLOAT34', description: 'Decimal floating point 34' },
                    { code: 'STRING', description: 'Character string' },
                    { code: 'SSTRING', description: 'Short character string' },
                    { code: 'RAW', description: 'Byte sequence' },
                    { code: 'RAWSTRING', description: 'Byte string' }
                ];
                const text = String(query || '').trim().toUpperCase();
                return items.filter(item => !text || `${item.code} ${item.description}`.toUpperCase().includes(text));
            }
        });
    }
}

window.domainDatatypeValueHelp = new DomainDatatypeValueHelp();
