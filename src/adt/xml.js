// Escapa caracteres reservados para uso seguro em atributos XML.
export function xmlEscape(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll("'", '&apos;');
}

// Obtém um atributo XML pelo nome local, aceitando namespace e aspas simples ou duplas.
export function xmlAttr(xml, name) {
    const source = String(xml ?? '');
    const expected = String(name ?? '').split(':').pop().toLowerCase();
    const pattern = /([A-Za-z_][\w:.-]*)\s*=\s*(["'])(.*?)\2/g;
    for (const match of source.matchAll(pattern)) {
        const localName = match[1].split(':').pop().toLowerCase();
        if (localName === expected) return xmlUnescape(match[3]);
    }
    return '';
}

// Analisa os dados completos de um pacote retornados pelo endpoint de packages.
export function parsePackage(xml) {
    const root = parseXmlTree(xml);
    const packageNode = findNode(root, node => node.localName === 'package') || root;
    const superPackage = findNode(packageNode, node => node.localName === 'superpackage');
    const softwareComponent = findNode(packageNode, node => node.localName === 'softwarecomponent');
    const transportLayer = findNode(packageNode, node => node.localName === 'transportlayer');
    const attributes = findNode(packageNode, node => node.localName === 'attributes');

    return {
        name: firstAttribute(packageNode, ['name']),
        type: firstAttribute(packageNode, ['type']),
        description: firstAttribute(packageNode, ['description']),
        responsible: firstAttribute(packageNode, ['responsible']),
        language: firstAttribute(packageNode, ['masterLanguage', 'language']),
        superPackage: firstAttribute(superPackage, ['name']),
        softwareComponent: firstAttribute(softwareComponent, ['name']),
        transportLayer: firstAttribute(transportLayer, ['name']),
        packageType: firstAttribute(attributes, ['packageType']),
        recordChanges: firstAttribute(attributes, ['recordChanges']).toLowerCase() === 'true'
    };
}

// Analisa resultados de busca de pacotes, incluindo valores em atributos ou elementos filhos.
export function parsePackageSearch(xml) {
    const root = parseXmlTree(xml);
    const candidates = [];
    walkNodes(root, node => {
        if (['objectreference', 'object', 'result', 'item'].includes(node.localName)) candidates.push(node);
    });

    const items = [];
    const seen = new Set();
    candidates.forEach(node => {
        const type = firstValue(node, ['type', 'objectType', 'object_type']);
        const name = firstValue(node, ['name', 'objectName', 'object_name']);
        if (!name || !/^DEVC(?:\/K)?$/i.test(type)) return;

        const normalizedName = xmlUnescape(name);
        if (seen.has(normalizedName)) return;
        seen.add(normalizedName);

        items.push({
            name: normalizedName,
            type: type.toUpperCase(),
            description: xmlUnescape(firstValue(node, ['description', 'desc'])),
            superPackage: xmlUnescape(firstValue(node, ['superPackage', 'packageName', 'package', 'DEVCLASS', 'SUPERPACKAGE']) || firstNodeAttributeValue(node, ['superPackage'], ['name'])),
            softwareComponent: xmlUnescape(firstValue(node, ['softwareComponent', 'SOFTWARE_COMPONENT']) || firstNodeAttributeValue(node, ['softwareComponent'], ['name'])),
            transportLayer: xmlUnescape(firstValue(node, ['transportLayer', 'TRANSPORT_LAYER']) || firstNodeAttributeValue(node, ['transportLayer'], ['name']))
        });
    });

    return items;
}

// Extrai o lock handle e o número da request de uma resposta de lock ADT.
export function parseLockHandle(xml) {
    const handle = xmlAttr(xml, 'LOCK_HANDLE') || xmlAttr(xml, 'lockHandle') || xmlTagText(xml, 'LOCK_HANDLE') || xmlTagText(xml, 'LOCKHANDLE');
    const corrNr = xmlAttr(xml, 'CORRNR') || xmlAttr(xml, 'corrNr') || xmlTagText(xml, 'CORRNR') || xmlTagText(xml, 'CORR_NR');
    return { lockHandle: handle.trim(), corrNr: corrNr.trim() };
}

// Analisa uma transport request individual e identifica seu tipo, número, descrição, owner e target.
export function parseTransportRequest(xml) {
    const root = parseXmlTree(xml);
    const requestNode = findNode(root, node => node.localName === 'request') || root;
    const type = firstValue(requestNode, ['type', 'category', 'requestType', 'TRFUNCTION', 'TRTYPE']) || xmlAttr(xml, 'type') || xmlAttr(xml, 'category');
    const category = normalizeRequestCategory(type);

    return {
        number: firstValue(requestNode, ['number', 'TRKORR', 'TRNUMBER', 'id']) || xmlTagText(xml, 'TRKORR') || xmlTagText(xml, 'TRNUMBER'),
        description: firstValue(requestNode, ['description', 'desc', 'AS4TEXT', 'DESCRIPTION', 'REQUEST_TEXT', 'text']) || xmlTagText(xml, 'AS4TEXT') || xmlTagText(xml, 'DESCRIPTION'),
        owner: firstValue(requestNode, ['owner', 'OWNER', 'AS4USER', 'user']) || xmlTagText(xml, 'OWNER'),
        target: firstValue(requestNode, ['target', 'TARGET']) || findDescendantValue(requestNode, 'target'),
        category,
        type: type || category,
        status: firstValue(requestNode, ['status', 'TRSTATUS']) || xmlTagText(xml, 'TRSTATUS')
    };
}

// Converte K/W e seus nomes textuais para a representação interna do MCP.
export function normalizeRequestCategory(type) {
    const value = String(type ?? '').trim().toUpperCase();
    if (value === 'K' || value === 'WORKBENCH') return 'K';
    if (value === 'W' || value === 'CUSTOMIZING') return 'W';
    return '';
}

// Retorna o texto de uma tag simples, tolerando namespaces.
function xmlTagText(xml, tag) {
    const escaped = String(tag).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = String(xml ?? '').match(new RegExp(`<([A-Za-z_][\\w:.-]*:)?${escaped}\\b[^>]*>([\\s\\S]*?)<\\/([A-Za-z_][\\w:.-]*:)?${escaped}\\s*>`, 'i'));
    return match ? xmlUnescape(match[2].replace(/<[^>]+>/g, '').trim()) : '';
}

// Constrói uma árvore XML pequena para leitura tolerante dos payloads ADT.
function parseXmlTree(xml) {
    const root = { localName: '#root', attrs: {}, children: [], text: '' };
    const stack = [root];
    const source = String(xml ?? '');
    const tokenPattern = /<\/?([A-Za-z_][\w:.-]*)([^>]*)>/g;
    let lastIndex = 0;

    for (const match of source.matchAll(tokenPattern)) {
        const text = source.slice(lastIndex, match.index).trim();
        if (text) stack[stack.length - 1].text += xmlUnescape(text);
        lastIndex = match.index + match[0].length;

        const full = match[0];
        const rawName = match[1];
        const localName = rawName.split(':').pop().toLowerCase();

        if (full.startsWith('</')) {
            if (stack.length > 1) stack.pop();
            continue;
        }

        const node = {
            localName,
            attrs: parseAttributes(match[2] ?? ''),
            children: [],
            text: ''
        };
        stack[stack.length - 1].children.push(node);
        if (!/\/\s*>$/.test(full)) stack.push(node);
    }

    const tail = source.slice(lastIndex).trim();
    if (tail) stack[stack.length - 1].text += xmlUnescape(tail);
    return root;
}

// Converte os atributos de uma tag XML em um mapa indexado pelo nome local.
function parseAttributes(text) {
    const attrs = {};
    const pattern = /([A-Za-z_][\w:.-]*)\s*=\s*(["'])(.*?)\2/g;
    for (const match of String(text ?? '').matchAll(pattern)) {
        attrs[match[1].split(':').pop().toLowerCase()] = xmlUnescape(match[3]);
    }
    return attrs;
}

// Procura recursivamente o primeiro nó que satisfaz o predicado informado.
function findNode(node, predicate) {
    if (!node) return null;
    if (predicate(node)) return node;
    for (const child of node.children || []) {
        const found = findNode(child, predicate);
        if (found) return found;
    }
    return null;
}

// Percorre todos os nós de uma árvore XML e executa uma função para cada um.
function walkNodes(node, callback) {
    if (!node) return;
    callback(node);
    for (const child of node.children || []) walkNodes(child, callback);
}

// Obtém um atributo ou valor filho usando uma lista de nomes alternativos.
function firstValue(node, names) {
    if (!node) return '';
    const expected = new Set(names.map(name => String(name).split(':').pop().toLowerCase()));
    for (const name of expected) {
        if (node.attrs?.[name]) return node.attrs[name];
    }
    for (const child of node.children || []) {
        if (expected.has(child.localName) && child.text.trim()) return child.text.trim();
    }
    for (const child of node.children || []) {
        const value = firstValue(child, names);
        if (value) return value;
    }
    return '';
}

// Obtém um atributo de um descendente específico do nó XML.
function firstNodeAttributeValue(node, nodeNames, attributeNames) {
    const expectedNodes = new Set(nodeNames.map(name => String(name).split(':').pop().toLowerCase()));
    const found = findNode(node, child => child !== node && expectedNodes.has(child.localName));
    return firstAttribute(found, attributeNames);
}

// Obtém um atributo específico de um nó XML.
function firstAttribute(node, names) {
    if (!node) return '';
    for (const name of names) {
        const value = node.attrs?.[String(name).split(':').pop().toLowerCase()];
        if (value) return value;
    }
    return '';
}

// Procura o texto de um descendente pelo nome local da tag.
function findDescendantValue(node, localName) {
    const found = findNode(node, child => child.localName === String(localName).toLowerCase() && child !== node);
    return found?.text?.trim() || firstAttribute(found, ['name', 'value', 'code', 'id']);
}

// Decodifica as entidades XML mais comuns encontradas nas respostas ADT.
function xmlUnescape(value) {
    return String(value ?? '')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}
