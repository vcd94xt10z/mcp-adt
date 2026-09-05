# mcp-adt

MCP em Node.js com JavaScript puro para SAP ABAP Development Tools (ADT), com servidor MCP via STDIO e console web local para testes sem Claude.

## Configuração

As conexões ficam na raiz em `connections.json`:

```json
{
  "connections": {
    "DEV": {
      "url": "http://127.0.0.1:50000",
      "client": "001",
      "user": "DEVELOPER",
      "password": "SUA_SENHA",
      "language": "EN",
      "rejectUnauthorized": true
    }
  }
}
```

A senha é armazenada diretamente no arquivo, conforme a configuração atual do projeto.

## Console web

```powershell
npm install
npm run web
```

O navegador padrão é aberto automaticamente em `http://127.0.0.1:3100`.

A interface usa três blocos exclusivos, inicialmente fechados:

- Conexões
- Requests
- Pacotes

Ao abrir um bloco, os demais são ocultados. Os formulários de criação/edição aparecem somente em popups modais.

## Pacotes

A criação de pacote segue a lógica do ADT/Eclipse:

- Nome iniciado por `$`: pacote local; não usa Workbench request.
- Pacote não-local: precisa de Workbench request.
- Para pacotes não-locais, a Workbench request deve ser informada pelo usuário; o console nunca cria uma request automaticamente.
- No console web, idioma, superpackage, software component, transport layer e requests são carregados do ambiente SAP; o responsável é o usuário da conexão ativa.

## MCP via STDIO

```powershell
npm start
```

Ferramentas atuais:

- `package_list`
- `package_get`
- `package_create`
- `package_update`
- `package_delete`
- `request_list`
- `request_get`
- `request_create` — cria uma Workbench (K) via `/sap/bc/adt/cts/transports`; target é opcional na UI e o número é gerado pelo SAP
- `request_update`
- `request_delete`


## Interface web

A interface de testes é organizada por categoria para evitar que alterações em uma funcionalidade afetem as demais.

```text
public/
├── index.html
├── header.html
├── css/
│   ├── default.css
│   ├── connections.css
│   ├── requests.css
│   ├── packages.css
│   └── log.css
├── js/
│   ├── default.js
│   ├── connections.js
│   ├── requests.js
│   ├── packages.js
│   └── log.js
└── views/
    ├── connections.html
    ├── requests.html
    ├── packages.html
    └── log.html
```

A aplicação utiliza jQuery e Bootstrap 5 com o tema padrão. `default.js` concentra a API web, conexão ativa, carregamento das telas, tratamento de erros, loader e notificações. Cada categoria possui sua própria classe JavaScript e seus arquivos HTML/CSS.
