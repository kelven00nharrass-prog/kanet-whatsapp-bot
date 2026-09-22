/**
 * KaNet SaaS — Módulo de Validação de Licença (REST API Edition)
 * =============================================================
 * Valida a licença do revendedor contra o Firebase Firestore usando a API REST oficial.
 * Isto elimina a dependência do SDK pesado do Firebase, prevenindo erros de gRPC/Socket
 * e timeouts de rede comuns em ambientes de revenda (firewalls, proxies, etc.).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const https = require('https');

// Firebase Config — Projeto KaNet SaaS Licensing
const PROJECT_ID = "kanet-saas-licensing";
const API_KEY = "AIzaSyCsBsNrLoKagDakoYPzh26B66gJeGy_nZg";

const OWNER_KEY = 'KANET-OWNER-KELVEN-2026';

class KaNetLicense {
    constructor() {
        this.chave = null;
        this.licenca = null;
        this.licencaDocId = null;
        this.valida = false;
        this.intervaloValidacao = null;
        this._intervaloComandos = null;
        this.onExpirar = null;          // callback quando licença expira
        this.onBloquear = null;         // callback quando admin bloqueia
        this.onComandoRemoto = null;    // callback para comandos remotos
        this.onAvisoValidade = null;    // callback para avisos de expiração
    }

    /**
     * Helper: Executa pedidos HTTPS à API REST do Firebase
     */
    _makeRequest(url, method, body = null) {
        return new Promise((resolve, reject) => {
            const u = new URL(url);
            const options = {
                hostname: u.hostname,
                path: u.pathname + u.search,
                method: method,
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 30000 // 30s timeout para redes móveis/instáveis
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        if (res.statusCode >= 400) {
                            reject(new Error(parsed.error?.message || `HTTP ${res.statusCode}`));
                        } else {
                            resolve(parsed);
                        }
                    } catch (e) {
                        if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}`));
                        else resolve(data);
                    }
                });
            });

            req.on('error', err => reject(err));
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Timeout de rede com o servidor de licenças'));
            });

            if (body) {
                req.write(JSON.stringify(body));
            }
            req.end();
        });
    }

    /**
     * Helper: Converte campos da API REST do Firestore em objetos JS nativos
     */
    _parseFields(fields) {
        const obj = {};
        if (!fields) return obj;
        for (const [key, value] of Object.entries(fields)) {
            if (!value) continue;
            if (value.nullValue !== undefined) obj[key] = null;
            else if (value.stringValue !== undefined) obj[key] = value.stringValue;
            else if (value.integerValue !== undefined) obj[key] = parseInt(value.integerValue, 10);
            else if (value.doubleValue !== undefined) obj[key] = parseFloat(value.doubleValue);
            else if (value.booleanValue !== undefined) obj[key] = value.booleanValue;
            else if (value.timestampValue !== undefined) obj[key] = value.timestampValue; // string ISO
            else if (value.arrayValue !== undefined) {
                obj[key] = (value.arrayValue.values || []).map(v => {
                    if (v.stringValue !== undefined) return v.stringValue;
                    if (v.integerValue !== undefined) return parseInt(v.integerValue, 10);
                    return v;
                });
            }
            else obj[key] = null;
        }
        return obj;
    }

    /**
     * Helper: Converte objetos JS em campos compatíveis com a API REST do Firestore
     */
    _toFirestoreFields(obj) {
        const fields = {};
        for (const [key, value] of Object.entries(obj)) {
            if (value === null || value === undefined) continue;
            if (typeof value === 'string') {
                fields[key] = { stringValue: value };
            } else if (typeof value === 'number') {
                if (Number.isInteger(value)) {
                    fields[key] = { integerValue: value.toString() };
                } else {
                    fields[key] = { doubleValue: value };
                }
            } else if (typeof value === 'boolean') {
                fields[key] = { booleanValue: value };
            } else if (value instanceof Date) {
                fields[key] = { timestampValue: value.toISOString() };
            } else if (Array.isArray(value)) {
                fields[key] = {
                    arrayValue: {
                        values: value.map(v => {
                            if (typeof v === 'string') return { stringValue: v };
                            if (typeof v === 'number') return { integerValue: v.toString() };
                            return v;
                        })
                    }
                };
            }
        }
        return fields;
    }

    /**
     * Verifica se está a correr no modo proprietário (Kelven)
     */
    _isOwnerMode() {
        return this.chave === OWNER_KEY;
    }

    /**
     * Retorna uma licença local de proprietário com validade infinita
     */
    _licencaProprietario() {
        return {
            nome_vendedor: 'Kelven (Proprietário)',
            pacote: 'proprietario',
            status: 'ativo',
            grupos_max: 9999,
            celulares_max: 9999,
            grupos_ativos: [],
            data_fim: new Date('2099-12-31').toISOString(),
            hardware_id: null,
            _owner: true
        };
    }

    /**
     * Inicializa o módulo de licença
     */
    async init(options = {}) {
        this.onExpirar = options.onExpirar || null;
        this.onBloquear = options.onBloquear || null;
        this.onComandoRemoto = options.onComandoRemoto || null;
        this.onAvisoValidade = options.onAvisoValidade || null;
        this.log = options.log || console.log;

        // 1. Ler chave do ficheiro licenca.key
        this.chave = this._lerChave();
        if (!this.chave) {
            this.log('❌ [LICENÇA] Ficheiro licenca.key não encontrado ou vazio.');
            this.log('❌ [LICENÇA] Coloque o ficheiro licenca.key na pasta raiz com a chave fornecida pelo administrador.');
            return null;
        }
        this.log(`🔑 [LICENÇA] Chave lida: ${this.chave.substring(0, 10)}...`);

        // ── MODO PROPRIETÁRIO (Kelven) ─────────────────────────────────
        if (this._isOwnerMode()) {
            this.licenca = this._licencaProprietario();
            this.valida = true;
            global['licencaVendedor'] = this.licenca.nome_vendedor || 'Kelven';
            this.log('👑 [LICENÇA] Modo Proprietário activado — Validade INFINITA.');
            return this.licenca;
        }

        // 2. Validar licença usando API REST
        const resultado = await this._validarLicenca();
        if (!resultado && !this.valida) {
            return null;
        }

        // 3. Verificar avisos de expiração
        this._verificarAvisos();

        // 4. Agendar re-validação a cada 30 minutos
        this.intervaloValidacao = setInterval(async () => {
            this.log('🔄 [LICENÇA] Re-validando licença...');
            const valid = await this._validarLicenca();
            if (!valid) {
                this.log('🚫 [LICENÇA] Licença inválida na re-validação!');
                if (this.onExpirar) this.onExpirar();
            } else {
                this._verificarAvisos();
            }
        }, 30 * 60 * 1000); // 30 minutos

        // 5. Ouvir comandos remotos do admin (via polling REST a cada 3 minutos)
        this._ouvirComandosRemotos();

        return this.licenca;
    }

    /**
     * Lê a chave do ficheiro licenca.key
     */
    _lerChave() {
        const baseDir = process.pkg ? path.dirname(process.execPath) : __dirname;
        const caminhos = [
            path.join(baseDir, 'licenca.key'),
            path.join(process.cwd(), 'licenca.key'),
            path.join(process.cwd(), '..', 'licenca.key')
        ];

        for (const caminho of caminhos) {
            try {
                if (fs.existsSync(caminho)) {
                    const chave = fs.readFileSync(caminho, 'utf8').trim();
                    if (chave && chave.startsWith('KANET-')) {
                        return chave;
                    }
                }
            } catch (e) { }
        }
        return null;
    }

    _obterMachineGuid() {
        if (os.platform() !== 'win32') return null;
        try {
            const { execSync } = require('child_process');
            const regBin = process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32', 'reg.exe') : 'reg.exe';
            const out = execSync(`"${regBin}" query "HKLM\\Software\\Microsoft\\Cryptography" /v MachineGuid`, { timeout: 3000 }).toString();
            const match = out.match(/MachineGuid\s+REG_SZ\s+(\S+)/i);
            if (match && match[1]) {
                return crypto.createHash('sha256').update(match[1]).digest('hex').substring(0, 32);
            }
        } catch (e) { }
        return null;
    }

    /**
     * Método legível de fallback baseado no hostname e modelo do CPU (imune a alterações de rede/Wi-Fi/VPN).
     */
    _obterHardwareIdLegacy() {
        try {
            const hostname = os.hostname();
            const cpu = os.cpus().length > 0 ? os.cpus()[0].model : 'no-cpu';
            const raw = `${hostname}::${cpu}`;
            return crypto.createHash('sha256').update(raw).digest('hex').substring(0, 32);
        } catch (e) {
            return 'unknown-hardware';
        }
    }

    _obterHardwareIds() {
        const novo = this._obterMachineGuid();
        const antigo = this._obterHardwareIdLegacy();
        return {
            primario: novo || antigo,
            secundario: antigo
        };
    }

    /**
     * Valida a licença contra o Firestore via API REST
     */
    async _validarLicenca() {
        try {
            const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery?key=${API_KEY}`;
            const queryBody = {
                structuredQuery: {
                    from: [{ collectionId: "licencas" }],
                    where: {
                        fieldFilter: {
                            field: { fieldPath: "chave" },
                            op: "EQUAL",
                            value: { stringValue: this.chave }
                        }
                    },
                    limit: 1
                }
            };

            let results = null;
            let lastErr = null;
            for (let tent = 1; tent <= 3; tent++) {
                try {
                    if (tent > 1) {
                        this.log(`🔄 [LICENÇA] Tentativa ${tent}/3 de ligação ao servidor de licenças...`);
                        await new Promise(r => setTimeout(r, 2000));
                    }
                    results = await this._makeRequest(url, 'POST', queryBody);
                    if (results) break;
                } catch(errReq) {
                    lastErr = errReq;
                }
            }

            if (!results) {
                throw lastErr || new Error('Falha ao comunicar com o servidor de licenças após 3 tentativas.');
            }
            
            if (!results || results.length === 0 || !results[0].document) {
                this.log('❌ [LICENÇA] Chave não encontrada no servidor.');
                this.valida = false;
                return false;
            }

            const docObj = results[0].document;
            this.licencaDocId = docObj.name.split('/').pop();
            const rawLic = this._parseFields(docObj.fields);

            // Mapear limites e funcionalidades baseado no pacote
            let pacote = (rawLic.pacote || 'basico').toLowerCase().trim();
            let celulares_max = 2;
            let grupos_max = 2;
            let permite_saldo = false;

            if (pacote === 'standard') {
                celulares_max = 4;
                grupos_max = 4;
                permite_saldo = true;
            } else if (pacote === 'pro') {
                celulares_max = 6;
                grupos_max = 10;
                permite_saldo = true;
            } else if (pacote === 'pro_standard' || pacote === 'pro-standard' || pacote === 'pro standard' || pacote === 'vip' || pacote === 'ilimitado') {
                celulares_max = 9999;
                grupos_max = 9999;
                permite_saldo = true;
                pacote = 'pro_standard'; // Normalizar
            } else if (pacote === 'standard_infinity' || pacote === 'standard-infinity' || pacote === 'standard infinity' || pacote === 'infinity') {
                celulares_max = 9999;
                grupos_max = 9999;
                permite_saldo = true;
                pacote = 'standard_infinity'; // Normalizar
            } else {
                pacote = 'basico'; // Fallback
            }

            // Aplicar limites calculados se não estiverem explícitos na licença
            rawLic.pacote = pacote;
            rawLic.celulares_max = rawLic.celulares_max !== undefined ? rawLic.celulares_max : celulares_max;
            rawLic.grupos_max = rawLic.grupos_max !== undefined ? rawLic.grupos_max : grupos_max;
            rawLic.permite_saldo = rawLic.permite_saldo !== undefined ? rawLic.permite_saldo : permite_saldo;

            this.licenca = rawLic;

            // Verificar status
            if (this.licenca.status === 'bloqueado') {
                this.log('⛔ [LICENÇA] Licença BLOQUEADA pelo administrador.');
                this.valida = false;
                if (this.onBloquear) this.onBloquear();
                return false;
            }

            // Verificar validade
            const agora = new Date();
            const dataFim = new Date(this.licenca.data_fim);
            
            if (agora > dataFim) {
                this.log(`⏰ [LICENÇA] Licença EXPIRADA em ${dataFim.toLocaleDateString('pt-PT')}.`);
                this.valida = false;
                
                // Atualizar status no Firestore
                try {
                    const updateUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/licencas/${this.licencaDocId}?updateMask.fieldPaths=status&key=${API_KEY}`;
                    await this._makeRequest(updateUrl, 'PATCH', {
                        fields: { status: { stringValue: 'expirado' } }
                    });
                } catch (e) { }

                if (this.onExpirar) this.onExpirar();
                return false;
            }

            // ── Verificação de Hardware ID ─────────────────────────────
            const { primario: hwId, secundario: hwIdLegacy } = this._obterHardwareIds();
            const hwGuardado = this.licenca.hardware_id;

            if (!hwGuardado) {
                this.log(`🖥️  [LICENÇA] Primeira activação. A vincular ao PC (ID estável: ${hwId.substring(0, 8)}...)`);
                try {
                    const updateUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/licencas/${this.licencaDocId}?updateMask.fieldPaths=hardware_id&updateMask.fieldPaths=pc_activacao&updateMask.fieldPaths=data_activacao&key=${API_KEY}`;
                    await this._makeRequest(updateUrl, 'PATCH', {
                        fields: {
                            hardware_id: { stringValue: hwId },
                            pc_activacao: { stringValue: os.hostname() },
                            data_activacao: { timestampValue: new Date().toISOString() }
                        }
                    });
                    this.licenca.hardware_id = hwId;
                } catch (e) {
                    this.log(`⚠️  [LICENÇA] Não foi possível registar o PC: ${e.message}`);
                }
            } else if (hwGuardado !== hwId && hwGuardado !== hwIdLegacy) {
                const hwGuardadoStr = String(hwGuardado || '');
                this.log(`🚨 [LICENÇA] ACESSO NEGADO! Esta chave está vinculada a outro PC.`);
                this.log(`🚨 [LICENÇA] PC actual: ${hwId.substring(0,8)}... | PC registado: ${hwGuardadoStr.substring(0,8)}...`);
                this.valida = false;
                
                // Registar tentativa no Firestore
                try {
                    const logUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/logs?key=${API_KEY}`;
                    await this._makeRequest(logUrl, 'POST', {
                        fields: {
                            vendedor_id: { stringValue: this.licencaDocId },
                            tipo: { stringValue: 'erro' },
                            nivel: { stringValue: 'critico' },
                            mensagem: { stringValue: `🚨 Tentativa de uso em PC não autorizado! HW actual: ${hwId.substring(0,8)}` },
                            pc_tentativa: { stringValue: os.hostname() },
                            hardware_id_tentativa: { stringValue: hwId },
                            timestamp: { timestampValue: new Date().toISOString() }
                        }
                    });
                } catch (_e) { }
                
                if (this.onBloquear) this.onBloquear();
                return false;
            } else if (hwGuardado === hwIdLegacy && hwGuardado !== hwId) {
                this.log(`🖥️  [LICENÇA] A migrar ID de hardware legado para ID estável...`);
                try {
                    const updateUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/licencas/${this.licencaDocId}?updateMask.fieldPaths=hardware_id&key=${API_KEY}`;
                    await this._makeRequest(updateUrl, 'PATCH', {
                        fields: { hardware_id: { stringValue: hwId } }
                    });
                    this.licenca.hardware_id = hwId;
                } catch (e) {
                    this.log(`⚠️  [LICENÇA] Não foi possível atualizar o ID de hardware: ${e.message}`);
                }
            }

            // Sincronizar grupos ativos/permitidos vindos do Firebase com o grupos_autorizados.json local
            try {
                const gruposFirebase = this.licenca.grupos_ativos || this.licenca.grupos_permitidos || [];
                if (Array.isArray(gruposFirebase) && gruposFirebase.length > 0) {
                    const _grpFile = path.join(process.cwd(), 'grupos_autorizados.json');
                    let _grpsLocais = [];
                    try { if (fs.existsSync(_grpFile)) _grpsLocais = JSON.parse(fs.readFileSync(_grpFile, 'utf8')); } catch(e) {}
                    let alterou = false;
                    for (const g of gruposFirebase) {
                        const gId = typeof g === 'object' ? (g.id || g.jid || g.grupo_id) : g;
                        if (gId && typeof gId === 'string' && gId.includes('@g.us') && !_grpsLocais.includes(gId)) {
                            _grpsLocais.push(gId);
                            alterou = true;
                        }
                    }
                    if (alterou) {
                        fs.writeFileSync(_grpFile, JSON.stringify(_grpsLocais, null, 2), 'utf8');
                        this.log(`✅ [LICENÇA] Sincronizados ${gruposFirebase.length} grupo(s) autorizados do SaaS no grupos_autorizados.json`);
                    }
                }
            } catch(_syncErr) {}

            this.valida = true;
            try {
                const cacheData = {
                    licenca: this.licenca,
                    docId: this.licencaDocId,
                    chave: this.chave,
                    guardadoEm: new Date().toISOString()
                };
                fs.writeFileSync(path.join(process.cwd(), '.licenca_cache'), JSON.stringify(cacheData), 'utf8');
            } catch(eCache) {}
            return true;

        } catch (e) {
            this.log(`⚠️ [LICENÇA] Erro ao validar (rede?): ${e.message}.`);

            try {
                const cacheFile = path.join(process.cwd(), '.licenca_cache');
                if (fs.existsSync(cacheFile)) {
                    const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
                    if (cache && cache.licenca && cache.chave === this.chave) {
                        const dataFim = new Date(cache.licenca.data_fim);
                        if (new Date() < dataFim && cache.licenca.status === 'ativo') {
                            this.licenca = cache.licenca;
                            this.licencaDocId = cache.docId;
                            this.valida = true;
                            this.log(`✅ [LICENÇA] Validação offline ativada via cache local (Vendedor: ${this.licenca.nome_vendedor || 'Revendedor'}).`);
                            return true;
                        }
                    }
                }
            } catch(_cErr) {}

            if (this.licenca && (this.licenca.status === 'ativo' || this.licenca._owner)) {
                this.valida = true;
            }
            return this.valida ? this.licenca : null;
        }
    }

    /**
     * Verifica se deve enviar avisos de expiração
     */
    _verificarAvisos() {
        if (!this.licenca || !this.valida) return;

        const agora = new Date();
        const dataFim = new Date(this.licenca.data_fim);
        const diasRestantes = Math.ceil((dataFim - agora) / (1000 * 60 * 60 * 24));

        // Aviso de 7 dias
        if (diasRestantes <= 7 && !this.licenca.aviso_7dias_enviado) {
            this.log(`⏰ [LICENÇA] Aviso: Licença expira em ${diasRestantes} dias!`);
            if (this.onAvisoValidade) {
                this.onAvisoValidade({ diasRestantes, dataFim });
            }
            try {
                const updateUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/licencas/${this.licencaDocId}?updateMask.fieldPaths=aviso_7dias_enviado&key=${API_KEY}`;
                this._makeRequest(updateUrl, 'PATCH', {
                    fields: { aviso_7dias_enviado: { booleanValue: true } }
                });
            } catch (e) { }
        }

        // Aviso de 1 dia
        if (diasRestantes <= 1 && !this.licenca.aviso_1dia_enviado) {
            this.log(`🚨 [LICENÇA] URGENTE: Licença expira AMANHÃ!`);
            if (this.onAvisoValidade) {
                this.onAvisoValidade({ diasRestantes, dataFim, urgente: true });
            }
            try {
                const updateUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/licencas/${this.licencaDocId}?updateMask.fieldPaths=aviso_1dia_enviado&key=${API_KEY}`;
                this._makeRequest(updateUrl, 'PATCH', {
                    fields: { aviso_1dia_enviado: { booleanValue: true } }
                });
            } catch (e) { }
        }
    }

    /**
     * Ouve comandos remotos do admin via REST Polling
     */
    _ouvirComandosRemotos() {
        if (!this.licencaDocId) return;

        const checkComandos = async () => {
            try {
                const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery?key=${API_KEY}`;
                const queryBody = {
                    structuredQuery: {
                        from: [{ collectionId: "comandos_remotos" }],
                        where: {
                            compositeFilter: {
                                op: "AND",
                                filters: [
                                    {
                                        fieldFilter: {
                                            field: { fieldPath: "vendedor_id" },
                                            op: "EQUAL",
                                            value: { stringValue: this.licencaDocId }
                                        }
                                    },
                                    {
                                        fieldFilter: {
                                            field: { fieldPath: "status" },
                                            op: "EQUAL",
                                            value: { stringValue: "pendente" }
                                        }
                                    }
                                ]
                            }
                        }
                    }
                };

                const results = await this._makeRequest(url, 'POST', queryBody);
                if (results && results.length > 0) {
                    for (const item of results) {
                        if (item.document) {
                            const docObj = item.document;
                            const cmdId = docObj.name.split('/').pop();
                            const cmdFields = this._parseFields(docObj.fields);

                            this.log(`⚡ [LICENÇA] Comando remoto recebido: ${cmdFields.tipo}`);
                            
                            if (this.onComandoRemoto) {
                                this.onComandoRemoto({
                                    tipo: cmdFields.tipo,
                                    dados: cmdFields.dados ? JSON.parse(cmdFields.dados) : {}
                                });
                            }

                            // Marcar como executado
                            try {
                                const updateUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/comandos_remotos/${cmdId}?updateMask.fieldPaths=status&updateMask.fieldPaths=executado_em&key=${API_KEY}`;
                                await this._makeRequest(updateUrl, 'PATCH', {
                                    fields: {
                                        status: { stringValue: 'executado' },
                                        executado_em: { timestampValue: new Date().toISOString() }
                                    }
                                });
                            } catch (e) { }
                        }
                    }
                }
            } catch (e) {
                // Falha silenciosa de rede temporária
            }
        };

        // Correr a primeira vez
        checkComandos();
        // Polling a cada 3 minutos
        this._intervaloComandos = setInterval(checkComandos, 3 * 60 * 1000);
    }

    /**
     * Envia log de erro para o Firestore via REST
     */
    async enviarLog(tipo, mensagem, detalhes = {}) {
        if (!this.licencaDocId) return;

        try {
            const logUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/logs?key=${API_KEY}`;
            const fieldsObj = {
                vendedor_id: this.licencaDocId,
                nome_vendedor: this.licenca?.nome_vendedor || 'desconhecido',
                tipo: tipo,
                mensagem: mensagem,
                timestamp: new Date().toISOString()
            };
            
            if (detalhes && Object.keys(detalhes).length > 0) {
                fieldsObj.detalhes = JSON.stringify(detalhes);
            }

            await this._makeRequest(logUrl, 'POST', {
                fields: this._toFirestoreFields(fieldsObj)
            });
        } catch (e) { }
    }

    isGrupoAutorizado(grupoId) {
        if (!this.licenca || !this.valida) return false;
        const grupos = this.licenca.grupos_ativos || this.licenca.grupos_permitidos || [];
        return grupos.includes(grupoId);
    }

    getMasterNumber() {
        return this.licenca?.master_number || null;
    }

    getNomeSistema() {
        return this.licenca?.nome_sistema || 'KaNet Bot';
    }

    getGruposAtivos() {
        return this.licenca?.grupos_ativos || this.licenca?.grupos_permitidos || [];
    }

    getLimites() {
        return {
            grupos_max: this.licenca?.grupos_max || 1,
            celulares_max: this.licenca?.celulares_max || 2,
            pacote: this.licenca?.pacote || 'basico'
        };
    }

    isValida() {
        return this.valida;
    }

    destroy() {
        if (this.intervaloValidacao) {
            clearInterval(this.intervaloValidacao);
            this.intervaloValidacao = null;
        }
        if (this._intervaloComandos) {
            clearInterval(this._intervaloComandos);
            this._intervaloComandos = null;
        }
    }
}

module.exports = KaNetLicense;
