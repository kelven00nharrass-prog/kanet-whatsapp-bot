
(function () {
    'use strict';

    // ============================================================
    // HANDLERS GLOBAIS — evita crash por erros nao tratados
    // (ex: ECONNRESET do adbkit quando dispositivo Wi-Fi cai)
    // ============================================================
    process.on('uncaughtException', function(err) {
        const ignorar = ['ECONNRESET', 'EPIPE', 'ECONNREFUSED', 'ETIMEDOUT'];
        if (ignorar.some(function(c) { return err.code === c || (err.message && err.message.includes(c)); })) {
            console.warn('[WARN] Erro de rede ignorado (adbkit/socket):', err.code || err.message);
            return; // nao derrubar o processo
        }
        // Porta já em uso: ignorar, o bot pode funcionar sem o servidor HTTP de SMS
        if (err.code === 'EADDRINUSE') {
            console.warn('[WARN] Porta já em uso (EADDRINUSE). Servidor HTTP de SMS ignorado. Bot continua activo.');
            return;
        }
        console.error('[FATAL] uncaughtException:', err);
        process.exit(1);
    });
    process.on('unhandledRejection', function(reason) {
        const msg = reason && (reason.message || String(reason));
        const ignorar = ['ECONNRESET', 'EPIPE', 'ECONNREFUSED', 'ETIMEDOUT', 'fetch failed'];
        if (ignorar.some(function(c) { return msg && msg.includes(c); })) {
            console.warn('[WARN] Promise rejeitada ignorada (rede):', msg);
            return;
        }
        console.error('[WARN] unhandledRejection:', reason);
    });
    // ------------------------------------------------------------

    let _DYN_CFG = null; try { _DYN_CFG = require('./bot_config.js'); } catch (_e) { }

    // ── Recarga de configurações em tempo real (via painel local) ──
    const { EventEmitter: _CfgEventEmitter } = require('events');
    global._configEventEmitter = new _CfgEventEmitter();
    global.recarregarBotConfig = function(novaCfg) {
        try {
            const _fs2 = require('fs');
            const _path2 = require('path');
            const _cfgPath2 = _path2.join(global._kanetBase || __dirname, 'bot_config.js');
            if (_fs2.existsSync(_cfgPath2)) {
                delete require.cache[require.resolve(_cfgPath2)];
                _DYN_CFG = require(_cfgPath2);
                console.log('🔄 [CONFIG] Configurações recarregadas a partir do disco!');
            }
        } catch (_e2) {
            console.warn('⚠️  [CONFIG] Erro ao recarregar bot_config.js:', _e2.message);
        }
    };
    global._configEventEmitter.on('config-updated', global.recarregarBotConfig);
    // ──────────────────────────────────────────────────────────────

    const _getPaymentDetails = () => {
        let mpesa_num = (_DYN_CFG && (_DYN_CFG.MPESA_NUMBER || _DYN_CFG.mpesa_number)) || '856268811';
        let mpesa_name = (_DYN_CFG && (_DYN_CFG.MPESA_NAME || _DYN_CFG.mpesa_name)) || 'Kelven Junior';
        let emola_num = (_DYN_CFG && (_DYN_CFG.EMOLA_NUMBER || _DYN_CFG.emola_number)) || '864882152';
        let emola_name = (_DYN_CFG && (_DYN_CFG.EMOLA_NAME || _DYN_CFG.emola_name)) || 'Catia Anabela';
        try {
            const _fs = require('fs');
            const _path = require('path');
            const _cfgPath = _path.join(global._kanetBase || __dirname, 'local_config.json');
            if (_fs.existsSync(_cfgPath)) {
                const _cfg = JSON.parse(_fs.readFileSync(_cfgPath, 'utf8'));
                if (_cfg.mpesa_number) mpesa_num = _cfg.mpesa_number;
                if (_cfg.mpesa_name) mpesa_name = _cfg.mpesa_name;
                if (_cfg.emola_number) emola_num = _cfg.emola_number;
                if (_cfg.emola_name) emola_name = _cfg.emola_name;
            }
        } catch (e) {}
        return { mpesa_num, mpesa_name, emola_num, emola_name };
    };

    const _checkIsMaster = (_sender) => {
        if (!_sender) return false;

        // Se for o sistema do proprietário (Kelven / Modo OWNER), autorizar comandos master sempre!
        if (global.licencaObj && typeof global.licencaObj._isOwnerMode === 'function' && global.licencaObj._isOwnerMode()) {
            return true;
        }

        let s = String(_sender).replace(/\D/g, '');
        if (!s) return false;

        const sClean = s.startsWith('258') && s.length >= 11 ? s.substring(3) : s;

        // 1. SAAS Admin / Criador (Kelven) — SEMPRE MASTER EM TODOS OS BOTS!
        if (s.includes('850401416') || s.includes('856116039') || s.includes('856268811') || s.includes('841636072')) return true;

        // Helper para comparar números com ou sem prefixo 258
        const matchesMaster = (mNum) => {
            if (!mNum) return false;
            const masterList = String(mNum).split(',').map(n => n.replace(/\D/g, '')).filter(Boolean);
            return masterList.some(m => {
                const mClean = m.startsWith('258') && m.length >= 11 ? m.substring(3) : m;
                return mClean && (s.includes(mClean) || sClean.includes(mClean) || m.includes(s) || mClean.includes(sClean));
            });
        };

        // 2. Master do Revendedor em local_config.json (Prioridade do Revendedor)
        try {
            const _fs = require('fs');
            const _path = require('path');
            const _cfgPath = _path.join(global._kanetBase || __dirname, 'local_config.json');
            if (_fs.existsSync(_cfgPath)) {
                const _cfg = JSON.parse(_fs.readFileSync(_cfgPath, 'utf8'));
                const mNum = _cfg.master_number || _cfg.admin_number || _cfg.ADMIN_NUMBER || '';
                if (matchesMaster(mNum)) return true;
            }
        } catch(e) {}

        // 3. Master do Revendedor em bot_config.js (_DYN_CFG)
        try {
            const dynMaster = (_DYN_CFG && (_DYN_CFG.ADMIN_NUMBER || _DYN_CFG.master_number || _DYN_CFG.admin_number)) || '';
            if (matchesMaster(dynMaster)) return true;
        } catch(e) {}

        // 4. Licença master se disponível na licença ativada
        try {
            if (global.licencaObj && typeof global.licencaObj.getMasterNumber === 'function') {
                const lMaster = global.licencaObj.getMasterNumber();
                if (matchesMaster(lMaster)) return true;
            }
        } catch(e) {}

        return false;
    };

    // SaaS Admin: apenas para aprovacao/rejeicao de grupos. NAO da acesso a outros comandos do revendedor.
    const _isSaasAdmin = (_sender) => {
        if (!_sender) return false;
        const _s = String(_sender).replace(/\D/g, '');
        return _s.includes('850401416') || _s.includes('856116039') || _s.includes('856268811');
    };

    const _isGrupoSistema = (_jid) => {
        if (!_jid || typeof _jid !== 'string' || !_jid.includes('@g.us')) return false;
        const cleanNum = _jid.split('@')[0];
        try {
            const _fs = require('fs');
            const _path = require('path');
            const _lcPath = _path.join(global._kanetBase || __dirname, 'local_config.json');
            if (_fs.existsSync(_lcPath)) {
                const _lc = JSON.parse(_fs.readFileSync(_lcPath, 'utf8'));
                const sysJids = [
                    _lc.grupo_fornecimento,
                    _lc.grupo_notificacoes,
                    _lc.grupo_notificacoes_fornecimento,
                    _lc.grupo_erros,
                    _lc.grupo_erros_fornecimento
                ].filter(Boolean).map(j => String(j).trim());

                for (const sj of sysJids) {
                    if (_jid === sj || (cleanNum && cleanNum === sj.split('@')[0])) return true;
                }
            }
        } catch(e) {}

        try {
            if (_DYN_CFG) {
                const sysJids = [
                    _DYN_CFG.GRUPO_ERROS,
                    _DYN_CFG.GRUPO_NOTIFICACOES,
                    _DYN_CFG.grupo_fornecimento
                ].filter(Boolean).map(j => String(j).trim());

                for (const sj of sysJids) {
                    if (_jid === sj || (cleanNum && cleanNum === sj.split('@')[0])) return true;
                }
            }
        } catch(e) {}

        return false;
    };

    const _getSupportDetails = () => {
        let supportName = 'Suporte';
        let supportNum = '';
        let callsNum = '';
        let sysName = 'Ka-Net';

        // 1. Prioridade Máxima: local_config.json (master_number do Revendedor)
        try {
            const _fs = require('fs');
            const _path = require('path');
            const _cfgPath = _path.join(global._kanetBase || __dirname, 'local_config.json');
            if (_fs.existsSync(_cfgPath)) {
                const _cfg = JSON.parse(_fs.readFileSync(_cfgPath, 'utf8'));
                if (_cfg.nome_sistema) sysName = _cfg.nome_sistema;
                const mNum = _cfg.master_number || _cfg.admin_number || _cfg.ADMIN_NUMBER || '';
                if (mNum) {
                    const splitNum = String(mNum).split(',');
                    supportNum = splitNum[0].trim();
                    callsNum = splitNum[1] ? splitNum[1].trim() : supportNum;
                }
            }
        } catch (e) {}

        // 2. Segunda Prioridade: bot_config.js (_DYN_CFG)
        try {
            if (!supportNum && typeof _DYN_CFG !== 'undefined' && _DYN_CFG) {
                const dynMaster = _DYN_CFG.master_number || _DYN_CFG.admin_number || _DYN_CFG.ADMIN_NUMBER;
                if (dynMaster) {
                    const splitNum = String(dynMaster).split(',');
                    supportNum = splitNum[0].trim();
                    callsNum = splitNum[1] ? splitNum[1].trim() : supportNum;
                }
            }
        } catch(e) {}

        // 3. Terceira Prioridade: Licença SaaS
        try {
            if (!supportNum && global.licencaObj && typeof global.licencaObj.getMasterNumber === 'function') {
                const lMaster = global.licencaObj.getMasterNumber();
                if (lMaster) {
                    const splitNum = String(lMaster).split(',');
                    supportNum = splitNum[0].trim();
                    callsNum = splitNum[1] ? splitNum[1].trim() : supportNum;
                }
            }
        } catch(e) {}

        // 4. Fallback de Desenvolvedor (Apenas em Modo Owner se nenhum master estiver definido)
        if (!supportNum) {
            try {
                if (global.licencaObj && typeof global.licencaObj._isOwnerMode === 'function' && global.licencaObj._isOwnerMode()) {
                    supportNum = '856116039';
                }
            } catch(e) {}
        }
        if (!callsNum) callsNum = supportNum;

        if (global.licencaObj && global.licencaObj.licenca && global.licencaObj.licenca.nome_vendedor) {
            supportName = global.licencaObj.licenca.nome_vendedor.replace(/\s*\(.*?\)\s*/g, '').trim();
        }
        return { supportName, supportNum, callsNum, sysName };
    };
    // --- KA-NET SAAS LICENCIAMENTO ---
    const KaNetLicense = require('./kanet-license');
    const licencaObj = new KaNetLicense();
    global.licencaObj = licencaObj;
    let licencaValida = false;
    // ── Painel Local do Revendedor ─────────────────────────
    try {
        const { iniciarPainelLocal } = require('./kanet-local-panel');
        iniciarPainelLocal();
    } catch (_ePainel) {
        console.warn('⚠️  [PAINEL LOCAL] Não foi possível iniciar o painel local:', _ePainel.message);
    }
    // ---------------------------------
    var _0x43130f = {}
    const {
        create: _0x15c3fe
    } = require('@open-wa/wa-automate'), _0x4b9ef8 = require('sqlite3')['verbose'](), _0x32d49c = require('fs'), _0x3d65f9 = require('adbkit'), _0x267794 = require('express'), _0x2b00ac = require('body-parser'), {
        EventEmitter: _0x4ad789
    } = require('events'), _0x4ccc8d = require('crypto');
    let Tesseract = null; try { Tesseract = require('tesseract.js'); } catch (e) { }
    let GoogleGenerativeAI = null; try { GoogleGenerativeAI = require('@google/generative-ai').GoogleGenerativeAI; } catch(e) { }
    const _GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyBw3VDRTXR87aRIi74LjtqgvRR97RJxblw';
    const _OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
    const _geminiHistories = {}; // Histórico de conversa por JID
    const _chatgptHistories = {};
    // Modelos em ordem de preferência (tentativa automática se um falhar)
    const _GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash', 'gemini-1.5-pro'];
    let _geminiModelCache = {};
    let _geminiQuotaCooldown = {}; // { model: timestamp }
    function _getGeminiModel(modelName) {
        if (!GoogleGenerativeAI) return null;
        if (!_geminiModelCache[modelName]) {
            const genAI = new GoogleGenerativeAI(_GEMINI_API_KEY);
            _geminiModelCache[modelName] = genAI.getGenerativeModel({
                model: modelName,
                systemInstruction: `Você é o *KaNet 2.0*, o assistente virtual PREMIUM, extremamente carismático, ultra-eficiente e 100% focado em vendas e atendimento da *Ka-Net*, o melhor serviço automático de pacotes de internet de Moçambique.

REGRAS CRÍTICAS DE CONVERSAÇÃO:
1. VOCÊ NUNCA DEVE FILOSOFAR, DEBATER TEMAS ABSTRATOS, DISCUTIR CÓDIGO DE PROGRAMAÇÃO OU ASSUNTOS FORA DE VENDAS E INTERNET.
2. Se o cliente perguntar algo filosófico, estranho, técnico de informática ou fora do escopo, responda com extremo carisma e traga o foco de volta para a internet de forma curta.
   Exemplo: "Adoro uma boa conversa, mas o meu super-poder hoje é garantir que tens a internet mais rápida de Moçambique! 📶✨ Que tal vermos os nossos pacotes agora? Digita *Menu* ou diz-me quantos megas precisas! 🚀"
3. Mantenha as respostas curtas, profissionais, magnéticas e repletas de energia positiva. Use português de Moçambique com simpatia natural.

SOBRE A KA-Net 2.0:
- Especialistas em pacotes rápidos e baratos (*Vodacom* e *Movitel*).
- O processo de entrega é 100% automático e em poucos segundos.
- Métodos de Pagamento: M-Pesa (856268811 - Kelven Junior) e E-Mola (864882152 - Catia Anabela).
- Como comprar: 1. Ver Menu -> 2. Pagar -> 3. Enviar Comprovativo + Número de destino na última linha.

Seja prestativo, use emojis elegantes e feche vendas!`
            });
        }
        return _geminiModelCache[modelName];
    }
    const _premiumFormatter = (msg) => {
        if (typeof msg !== 'string' || msg.includes('𝗞𝗔𝗡𝗘𝗧 𝗝𝗥') || msg.length < 5) return msg;
        let title = '𝗡𝗢𝗧𝗜𝗙𝗜𝗖𝗔𝗖̧𝗔̃𝗢';
        if (msg.toUpperCase().includes('APROVADO')) title = '𝗣𝗘𝗗𝗜𝗗𝗢 𝗔𝗣𝗥𝗢𝗩𝗔𝗗𝗢';
        else if (msg.toUpperCase().includes('VALIDADO')) title = '𝗣𝗘𝗗𝗜𝗗𝗢 𝗩𝗔𝗟𝗜𝗗𝗔𝗗𝗢';
        else if (msg.toUpperCase().includes('RELATÓRIO')) title = '𝗥𝗘𝗟𝗔𝗧𝗢́𝗥𝗜𝗢';
        else if (msg.toUpperCase().includes('ERRO') || msg.toUpperCase().includes('FALHOU')) title = '𝗔𝗩𝗜𝗦𝗢 𝗗𝗘 𝗘𝗥𝗥𝗢';
        else if (msg.toUpperCase().includes('SUCESSO') || msg.toUpperCase().includes('ENVIADOS')) title = '𝗦𝗨𝗖𝗘𝗦𝗦𝗢';
        else if (msg.toUpperCase().includes('MENU') || msg.toUpperCase().includes('PACOTES')) title = '𝗦𝗘𝗥𝗩𝗜𝗖̧𝗢𝗦';
        else if (msg.toUpperCase().includes('COMANDOS') || msg.toUpperCase().includes('ESTATÍSTICAS')) title = '𝗖𝗢𝗠𝗔𝗡𝗗𝗢𝗦';
        
        const cleanMsg = msg.replace(/[❓?]/g, '🔹').replace(/━━━━━━━━━━━━━━━━━━━━/g, '').replace(/━━━━━━━━━━━━━━━━━━/g, '').replace(/━+/g, '').replace(/\n{3,}/g, '\n\n').trim();
        return `✨ *𝗞𝗔𝗡𝗘𝗧 𝟮.𝟬 • ${title}* ✨\n━━━━━━━━━━━━━━━━━━━\n\n${cleanMsg}\n\n━━━━━━━━━━━━━━━━━━━\n🚀 *Internet rápida em segundos!*`;
    };

    async function _enviarGemini(_texto, _from) {
        for (const _modelName of _GEMINI_MODELS) {
            // Verificar cooldown individual do modelo
            if (_geminiQuotaCooldown[_modelName] && Date.now() < _geminiQuotaCooldown[_modelName]) continue;
            const model = _getGeminiModel(_modelName);
            if (!model) continue;
            try {
                if (!_geminiHistories[_from]) _geminiHistories[_from] = [];
                const history = _geminiHistories[_from];
                const chat = model.startChat({ history });
                const result = await chat.sendMessage(_texto);
                const _resposta = result.response.text();
                history.push({ role: 'user', parts: [{ text: _texto }] });
                history.push({ role: 'model', parts: [{ text: _resposta }] });
                if (history.length > 40) history.splice(0, 2);
                return { ok: true, resposta: _resposta, model: _modelName };
            } catch (_err) {
                if (_err.message && (_err.message.includes('429') || _err.message.includes('quota'))) {
                    // Cooldown de 23h (reset diário)
                    _geminiQuotaCooldown[_modelName] = Date.now() + 23 * 60 * 60 * 1000;
                    _0x1ca1fd('⚠️ Quota esgotada para ' + _modelName + ', cooldown 23h. Tentando próximo modelo...', 'warning');
                } else if (_err.message && _err.message.includes('404')) {
                    _geminiQuotaCooldown[_modelName] = Date.now() + 24 * 60 * 60 * 1000; // modelo não existe
                    _0x1ca1fd('❌ Modelo ' + _modelName + ' não encontrado, desactivado.', 'error');
                } else {
                    _0x1ca1fd('❌ Erro Gemini (' + _modelName + '): ' + _err.message, 'error');
                }
            }
        }
        return { ok: false };
    }

    async function _enviarChatGPT(_texto, _from) {
        if (!_OPENAI_API_KEY) return { ok: false };
        try {
            if (!_chatgptHistories[_from]) _chatgptHistories[_from] = [];
            const history = _chatgptHistories[_from];
            const _systemPrompt = `Você é o *KaNet 2.0*, o assistente virtual PREMIUM, extremamente carismático, ultra-eficiente e 100% focado em vendas e atendimento da *Ka-Net* em Moçambique.

REGRAS CRÍTICAS DE CONVERSAÇÃO:
1. VOCÊ NUNCA DEVE FILOSOFAR, DEBATER TEMAS ABSTRATOS, DISCUTIR CÓDIGO DE PROGRAMAÇÃO OU ASSUNTOS FORA DE VENDAS E INTERNET.
2. Se o cliente perguntar algo filosófico ou estranho, recuse educadamente de forma carismática e traga o foco de volta para internet: "Adoro bater papo, mas meu foco é garantir que tens internet rápida hoje! 📶✨ Digita *Menu* para ver os pacotes ou diz-me quantos megas precisas! 🚀"
3. Mantenha as respostas muito curtas, diretas e use emojis elegantes (✨, 🚀, 📶).

SOBRE A KA-NET 2.0:
- Venda automática de pacotes Vodacom e Movitel.
- Métodos: M-Pesa (856268811 - Kelven Junior) e E-Mola (864882152 - Catia Anabela).
- Para comprar: Ver Menu -> Pagar -> Enviar comprovativo + número de destino na última linha.`;
            const messages = [
                { role: 'system', content: _systemPrompt },
                ...history.map(h => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.parts && h.parts[0] ? h.parts[0].text : '' })),
                { role: 'user', content: _texto }
            ];
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${_OPENAI_API_KEY}`
                },
                body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    messages: messages,
                    max_tokens: 200,
                    temperature: 0.7
                })
            });
            const data = await response.json();
            if (data.choices && data.choices[0]) {
                const _resposta = data.choices[0].message.content;
                history.push({ role: 'user', parts: [{ text: _texto }] });
                history.push({ role: 'model', parts: [{ text: _resposta }] });
                if (history.length > 20) history.splice(0, 2);
                return { ok: true, resposta: _resposta, model: 'gpt-4o-mini' };
            }
            return { ok: false };
        } catch (_err) {
            _0x1ca1fd('❌ Erro ChatGPT: ' + _err.message, 'error');
            return { ok: false };
        }
    }


    async function _obterPiadaInedita(_from) {
        const _temas = [
            'transporte de chapa em Maputo', 'saldo de megas que some rápido', 'rede lenta das operadoras',
            'sogra moçambicana', 'escola primária', 'policial de trânsito pedindo refresco', 'festa de casamento tradicional',
            'mercado de Xipamanine', 'praia da Costa do Sol com calor', 'futebol local moçambicano',
            'megas da internet acabando na melhor hora', 'grupos de WhatsApp da família', 'mensagens de bom dia no Facebook',
            'carregar saldo na loja da esquina', 'computador antigo da escola', 'celular chinês de duas antenas',
            'conversa de comadres moçambicanas', 'viajar para a Beira de machibombo', 'vida em Nampula',
            'calor de Tete', 'dicas de namoro moçambicano', 'pechinchar no mercado', 'cozinhar caril de amendoim',
            'comer matapa', 'comprar roupa de fardo', 'fazer fila no banco', 'esperar transferência de M-Pesa',
            'erro de envio no E-Mola', 'ligação caindo no meio da fofoca', 'promessas de político local',
            'vendedor ambulante na paragem', 'vizinho cusco que sabe de tudo', 'pedir dinheiro emprestado',
            'tentar engatar no WhatsApp', 'esquecer a senha do celular', 'chuva inundando a estrada',
            'bateria do celular durando 5 minutos', 'crianças brincando na rua de terra', 'pescaria no mar de Inhambane',
            'comer peixe na praia do Bilene', 'turista tentando falar changana', 'aprender línguas locais',
            'trabalho de escritório com ar condicionado avariado', 'ir ao barbeiro local', 'fazer tranças no salão',
            'comprar pão quente de manhã', 'perder o chinelo na lama', 'correr atrás do chapa',
            'cobrador de chapa sem troco', 'aparelho de televisão antigo'
        ];

        const _fallbacks = [
            "Sabe por que o computador foi preso? 💻\nPorque ele executou um programa! 😂",
            "Por que o livro de matemática se suicidou? 📚\nPorque tinha muitos problemas! 😂",
            "O que a impressora disse para a outra? 🖨️\nEssa folha é sua ou é impressão minha? 😂",
            "Como o técnico de informática dorme? 🛌\nCom o Caps Lock ativado para não ter pesadelos em letras grandes! 😂",
            "Por que o smartphone foi ao médico? 📱\nPorque estava com vírus e com a tela cheia de manchas! 😂",
            "Por que o jacaré tirou o jacarezinho da escola? 🐊\nPorque ele só tirava nota ré! 😂",
            "O que um ponto diz para o outro no chapa? 🚌\n'Aperte-se mais aí, ainda cabe mais um!' 😂",
            "O que o carregador portátil disse para o celular? 🔋\n'Sem mim você não é nada, fica logo sem bateria!' 😂",
            "Por que a aranha é o animal mais tecnológico de Moçambique? 🕷️\nPorque ela vive na rede (web) e passa o dia todo criando conexões! 😂",
            "Por que o cliente da Ka-Net não fica triste? 🚀\nPorque a internet é tão rápida que não dá tempo de carregar a tristeza! 😂"
        ];

        let _piadaSelecionada = '';
        let _sucesso = false;

        // Tentar gerar com IA até 5 vezes para garantir que é inédita
        for (let i = 0; i < 5; i++) {
            const _tema = _temas[Math.floor(Math.random() * _temas.length)];
            const _seed = Math.floor(Math.random() * 1000000);
            
            try {
                const _prompt = `Conte uma piada nova, super criativa, engraçada e muito curta sobre Moçambique, especificamente sobre o tema '${_tema}'. Use um estilo surpreendente e o seed randomizado de variação: ${_seed}. Evite clichês e piadas repetidas. Responda apenas com a piada e alguns emojis de riso no final.`;
                const _geminiJoke = await _enviarGemini(_prompt, _from);
                
                if (_geminiJoke && _geminiJoke.ok && _geminiJoke.resposta) {
                    const _texto = _geminiJoke.resposta.trim();
                    // Normalizar o texto para hash (letras minúsculas, sem espaços e símbolos)
                    const _limpo = _texto.toLowerCase().replace(/[^a-z0-9áéíóúâêôãõç]/gi, '');
                    const _hash = _0x4ccc8d.createHash('sha256').update(_limpo).digest('hex');

                    // Verificar se o hash já foi usado
                    const _check = await _0x3c2652('SELECT id FROM piadas_usadas WHERE joke_hash = ?', [_hash]);
                    if (!_check || _check.length === 0) {
                        // Gravar no histórico de piadas usadas
                        await _0x2c5e52('INSERT INTO piadas_usadas (joke_hash, joke_text) VALUES (?, ?)', [_hash, _texto]);
                        _piadaSelecionada = _texto;
                        _sucesso = true;
                        break;
                    }
                }
            } catch (err) {
                _0x1ca1fd('⚠️ Erro ao tentar obter piada via IA (Tentativa ' + (i+1) + '): ' + err.message, 'warning');
            }
        }

        // Se falhar ou repetir 5 vezes, escolhemos uma do fallback que também seja inédita
        if (!_sucesso) {
            for (const _fb of _fallbacks) {
                const _limpo = _fb.toLowerCase().replace(/[^a-z0-9áéíóúâêôãõç]/gi, '');
                const _hash = _0x4ccc8d.createHash('sha256').update(_limpo).digest('hex');

                const _check = await _0x3c2652('SELECT id FROM piadas_usadas WHERE joke_hash = ?', [_hash]);
                if (!_check || _check.length === 0) {
                    await _0x2c5e52('INSERT INTO piadas_usadas (joke_hash, joke_text) VALUES (?, ?)', [_hash, _fb]);
                    _piadaSelecionada = _fb;
                    _sucesso = true;
                    break;
                }
            }
        }

        // Se até os fallbacks já foram todos usados (o que significa que já usou 10 piadas clássicas),
        // limpamos o histórico para reiniciar as clássicas ou retornamos a última gerada pela IA
        if (!_piadaSelecionada) {
            _piadaSelecionada = _fallbacks[Math.floor(Math.random() * _fallbacks.length)];
        }

        return _piadaSelecionada;
    }


    function _0x59d82f() {
        console['log']('🚀\x20MONITOR'), setInterval(async () => {
            let _0x1dc830 = [],
                _0x2b1dcd = 0x0,
                _0x189bc3 = 0x0;
            for (const _0x2edf50 of _0x13e11b) {
                const _0x140619 = _0x2edf50['online'];
                let _success = ![];
                try {
                    const _0x5a47fe = new AbortController();
                    const tm = setTimeout(() => _0x5a47fe['abort'](), 12000);
                    const _0x3f10f7 = await fetch('http://127.0.0.1:' + _0x2edf50['id'] + '/health', {
                        'signal': _0x5a47fe['signal']
                    });
                    clearTimeout(tm);
                    if (_0x3f10f7['ok']) {
                        const _0xd2a510 = await _0x3f10f7['json']();
                        if (_0xd2a510['status'] === 'online' || _0xd2a510['status'] === 'ok') {
                            _success = !![];
                        }
                    }
                } catch (e) {
                    _success = ![];
                }

                if (_success) {
                    _0x2edf50['falhas'] = 0;
                    if (!_0x140619) {
                        _0x2edf50['online'] = !![];
                        _0x2edf50['livre'] = !![];
                        _0x2edf50['sem_saldo'] = ![];
                        if (typeof _semSaldoTracker !== 'undefined') _semSaldoTracker.set(_0x2edf50['id'], 0);
                        _0x1ca1fd('✅\x20' + _0x2edf50['nome'] + '\x20está\x20ONLINE', 'success');
                    }
                    _0x2b1dcd++;
                    if (_0x2edf50['livre']) _0x189bc3++;
                } else {
                    _0x2edf50['falhas'] = (_0x2edf50['falhas'] || 0) + 1;
                    if (_0x2edf50['falhas'] >= 5) {
                        if (_0x140619) {
                            _0x2edf50['online'] = ![];
                            _0x2edf50['livre'] = ![];
                            _0x1ca1fd('❌\x20' + _0x2edf50['nome'] + '\x20está\x20OFFLINE\x20(3\x20falhas\x20consecutivas)', 'error');
                        }
                    } else {
                        if (_0x2edf50['online']) {
                            _0x2b1dcd++;
                            if (_0x2edf50['livre']) _0x189bc3++;
                        }
                    }
                }
                _0x140619 !== _0x2edf50['online'] && _0x1dc830['push'](_0x2edf50['online'] ? '✅' + _0x2edf50['id'] : '❌' + _0x2edf50['id']);
            }
        }, 0xea60);

        // --- AUTOMOÇÃO DE PLANOS ESPECIAIS (A cada 5 minutos) ---
        setInterval(async () => {
            const _waClient = global['client']; // Usa o cliente global do bot
            if (_waClient) {
                await _processarEntregasPlanos(_waClient);
            }
        }, 300000); 
    }

    function _0x740a4c(_0x5404c6) {
        const _0x5a7a4c = global['ultimoUsoPortas'] || new Map();
        _0x5a7a4c['set'](_0x5404c6, Date['now']()), global['ultimoUsoPortas'] = _0x5a7a4c;
        const _0x1b1e62 = _0x13e11b['find'](_0x876579 => _0x876579['id'] === _0x5404c6);
        _0x1b1e62 && (_0x1b1e62['livre'] = ![], console['log']('📝\x20Porta\x20' + _0x5404c6 + '\x20marcada\x20como\x20OCUPADA\x20(em\x20uso)'));
    }
    setTimeout(async () => {
        try {
            await _0x2c5e52('CREATE TABLE IF NOT EXISTS bot_tasks (task_name TEXT PRIMARY KEY, last_run DATETIME)');
            await _0x2c5e52('CREATE TABLE IF NOT EXISTS assinaturas_planos (id INTEGER PRIMARY KEY AUTOINCREMENT, jid TEXT, numero TEXT, tipo TEXT, total_mb INTEGER, entregue_mb INTEGER, valor_entrega_diaria INTEGER, data_ultima_entrega DATETIME, data_proxima_entrega DATETIME, referencia_original TEXT, status TEXT)');
            await _0x2c5e52('CREATE TABLE IF NOT EXISTS bonus_referencia (jid TEXT PRIMARY KEY, parent_jid TEXT, total_convidados INTEGER DEFAULT 0)');
            await _0x2c5e52('CREATE TABLE IF NOT EXISTS bonus_contribuicoes (id INTEGER PRIMARY KEY AUTOINCREMENT, parent_jid TEXT, indicado_jid TEXT, mb INTEGER, status TEXT DEFAULT "pendente", created_at DATETIME DEFAULT CURRENT_TIMESTAMP)');
            await _0x2c5e52('CREATE TABLE IF NOT EXISTS piadas_usadas (id INTEGER PRIMARY KEY AUTOINCREMENT, joke_hash TEXT UNIQUE, joke_text TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)');
            await _0x2c5e52('CREATE TABLE IF NOT EXISTS bot_settings (key TEXT PRIMARY KEY, value TEXT)');

            // Inicializar ou rotacionar a temporada do ranking a cada 30 dias
            try {
                let seasonRow = await _0x3c2652('SELECT value FROM bot_settings WHERE key = "ranking_season_start"');
                let now = new Date();
                let nowStr = now.toISOString().split('T')[0] + ' 00:00:00';
                
                if (!seasonRow || seasonRow.length === 0) {
                    await _0x2c5e52('INSERT INTO bot_settings (key, value) VALUES ("ranking_season_start", ?)', [nowStr]);
                    console.log('🏆 [RANKING] Temporada de 30 dias iniciada hoje: ' + nowStr);
                } else {
                    let seasonStart = new Date(seasonRow[0].value);
                    let diffDays = Math.floor((now - seasonStart) / (1000 * 60 * 60 * 24));
                    if (diffDays >= 30) {
                        await _0x2c5e52('UPDATE bot_settings SET value = ? WHERE key = "ranking_season_start"', [nowStr]);
                        console.log('🏆 [RANKING] Nova temporada iniciada! Passaram-se ' + diffDays + ' dias. Temporada resetada hoje: ' + nowStr);
                    } else {
                        console.log('🏆 [RANKING] Temporada ativa. Iniciada em: ' + seasonRow[0].value + ' (' + diffDays + '/30 dias decorridos)');
                    }
                }
            } catch (errSeason) {
                console.log('⚠️ [RANKING] Erro ao gerir ciclo da temporada: ' + errSeason.message);
            }
            
            // Migration: Strip suffixes from existing referral tables to support JID normalization
            try {
                const rowsRef = await _0x3c2652('SELECT rowid, jid, parent_jid FROM bonus_referencia');
                if (rowsRef) {
                    for (const row of rowsRef) {
                        const newJid = row.jid ? row.jid.split('@')[0] : null;
                        const newParent = row.parent_jid ? row.parent_jid.split('@')[0] : null;
                        if (newJid !== row.jid || newParent !== row.parent_jid) {
                            await _0x2c5e52('UPDATE bonus_referencia SET jid=?, parent_jid=? WHERE rowid=?', [newJid, newParent, row.rowid]);
                        }
                    }
                }
                const rowsCont = await _0x3c2652('SELECT rowid, parent_jid, indicado_jid FROM bonus_contribuicoes');
                if (rowsCont) {
                    for (const row of rowsCont) {
                        const newParent = row.parent_jid ? row.parent_jid.split('@')[0] : null;
                        const newInd = row.indicado_jid ? row.indicado_jid.split('@')[0] : null;
                        if (newParent !== row.parent_jid || newInd !== row.indicado_jid) {
                            await _0x2c5e52('UPDATE bonus_contribuicoes SET parent_jid=?, indicado_jid=? WHERE rowid=?', [newParent, newInd, row.rowid]);
                        }
                    }
                }
                console.log('✅ Migration: Referral JIDs successfully migrated to normalized formats!');
            } catch(e) {
                console.log('⚠️ Migration error: ' + e.message);
            }

            console.log('✅\x20Tabelas\x20do\x20banco\x20de\x20dados\x20verificadas/criadas\x20com\x20sucesso.');
        } catch (e) {
            console.log('❌\x20Erro\x20ao\x20criar\x20tabelas:\x20' + e.message);
        }
        _0x59d82f(), console['log']('✅\x20Monitor\x20de\x20portas\x20ATIVO');
    }, 0x1388), process['setMaxListeners'](0x1e), require('events')['EventEmitter']['defaultMaxListeners'] = 0x1e;
    global['gc'] && setInterval(() => {
        const _0x2d591a = process['memoryUsage']();
        _0x2d591a['heapUsed'] > 0x29b92700 && (console['log']('🧹\x20GC:\x20Limpando\x20' + Math['round'](_0x2d591a['heapUsed'] / 0x400 / 0x400) + 'MB'), global['gc']());
    }, 0xafc8);
    (function () {
        'use strict';
        const _0x3d2d2c = {
            'isRealNode': () => {
                return typeof process !== 'undefined' && process['versions'] && process['versions']['node'] && process['release'] && process['release']['name'] === 'node';
            },
            'isBeingDebugged': () => {
                return process['execArgv'] && process['execArgv']['some'](_0x15cf28 => _0x15cf28['includes']('--inspect-brk'));
            }
        };
        if (!_0x3d2d2c['isRealNode']()) {
            console['log']('🚫\x20Ambiente\x20Node.js\x20inválido');
            typeof process !== 'undefined' && process['exit'] && process['exit'](0x1);
            return;
        }
        _0x3d2d2c['isBeingDebugged']() && console['log']('⚠️\x20\x20Modo\x20debug\x20detectado\x20-\x20Algumas\x20funções\x20podem\x20não\x20funcionar');
        const _0x52330b = console['log'];
        console['log'] = function (..._0x216455) {
            const _0x1e3514 = _0x216455['map'](_0x536db7 => {
                if (typeof _0x536db7 === 'string') return _0x536db7['replace'](/TESTE\.js/g, 'APP.js')['replace'](/C:\\Ussd\\.idea\\caches\\chave\.sec/g, '[LICENSE_FILE]');
                return _0x536db7;
            });
            _0x52330b['apply'](console, _0x1e3514);
        };
    }()), console['log']('🔐\x20Sistema\x20seguro\x20-\x20Iniciando\x20bot\x20WhatsApp...');
    const _0x3c21ac = _DYN_CFG ? _DYN_CFG.BOT_EXPIRACAO_DIAS : 0x7fffff,
        _0x1393f2 = '2026-04-07',
        _0x330e5a = ['/hoje', '!hoje', '/amanha', '!amanha', '/executar', '!executar', '/schedules', '!schedules', '/addschedule', '!addschedule', '/removeschedule', '!removeschedule', '/alterarhora', '!alterarhora', '/debugschedules', '!debugschedules', '/forcetodos', '!forcetodos', '/apagarschedules', '!apagarschedules', '.apagarschedules', '/limparschedules', '!limparschedules', '.enviar', '!enviar', '/enviarmegas', '!enviarmegas', '/diasrestantes', '!diasrestantes', '.diasrestantes', '/dias', '!dias', '.dias', '/validade', '!validade', '.validade', '/statusbot', '!statusbot', '.statusbot', '.idgrupo', '!idgrupo', '.autorizar', '!autorizar', '.desautorizar', '!desautorizar'],
        _0x16260a = (() => {
            try {
                const _cfgAdm = JSON.parse(require('fs').readFileSync(require('path').join(global._kanetBase || __dirname, 'local_config.json'), 'utf8'));
                const _num = (_cfgAdm.admin_number || _cfgAdm.ADMIN_NUMBER || _cfgAdm.master_number || '856116039').toString().replace(/\D/g, '');
                // Normalizar: se não começar com 258, adicionar
                const _normalized = _num.startsWith('258') ? _num : '258' + _num;
                return _normalized + '@c.us';
            } catch(_e) { return '258856116039@c.us'; }
        })();


    // --- GRUPOS AUTORIZADOS (persistente) ---
    const _isOwnerEnv = () => global.licencaObj && typeof global.licencaObj._isOwnerMode === 'function' && global.licencaObj._isOwnerMode();
    const _GRUPOS_FIXOS = _isOwnerEnv() ? ['120363402302455817@g.us', '120363393317092134@g.us', '120363424022382579@g.us', '120363419928278893@g.us', '120363424819563179@g.us', '120363405936793106@g.us', '120363426787478258@g.us'] : [];
    const _GRUPOS_FILE = './grupos_autorizados.json';
    let _gruposExtras = [];
    try {
        if (fs.existsSync(_GRUPOS_FILE)) {
            _gruposExtras = JSON.parse(fs.readFileSync(_GRUPOS_FILE, 'utf8'));
            console.log(`✅ Grupos autorizados carregados: ${_gruposExtras.length} grupo(s) extra(s)`);
        }
    } catch(_e) { _gruposExtras = []; }
    // Lista final: fixos + dinâmicos (sem duplicatas)
    let _0x18020a = [...new Set([..._GRUPOS_FIXOS, ..._gruposExtras])];

    function _salvarGrupos() {
        // Persiste apenas os grupos dinâmicos (não fixos)
        const dinamicos = _0x18020a.filter(g => !_GRUPOS_FIXOS.includes(g));
        try { fs.writeFileSync(_GRUPOS_FILE, JSON.stringify(dinamicos, null, 2), 'utf8'); } catch(_e) {}
    }
    async function _0x1f8704(_0x5ed9e1, _0x31aef7, _0x1b00ff, _0x54fc1f, _0x5e6e29, _tipoManual = '24hrs') {
        try {
            const _0x5cd20c = _0x5e6e29['includes']('@c.us') ? _0x5e6e29 : _0x5e6e29 + '@c.us';
            if (!_checkIsMaster(_0x5cd20c)) {
                await _0x461461(_0x5ed9e1, _0x31aef7, '🔒 *𝗣𝗥𝗢𝗧𝗘𝗖̧𝗔̃𝗢 𝗞𝗔-𝗡𝗘𝗧*\n━━━━━━━━━━━━━━━━━━━\n⚠️ *ACESSO NEGADO*\nEste comando é restrito ao número Master do bot.\n━━━━━━━━━━━━━━━━━━━', _0x54fc1f);
                return;
            }
            const _0x50b1df = _0x1b00ff['split']('\x20');
            const _cmdName = _0x50b1df[0x0].toLowerCase();

            // --- VALIDAÇÃO DE ARGUMENTOS ---
            if (_0x50b1df['length'] < 0x3) {
                let _exMsg, _fmt;
                if (_tipoManual === 'semanal') {
                    _exMsg = '.semanal 850000000 47';
                    _fmt = '.semanal [número] [preço em MT]';
                } else if (_tipoManual === 'mensal') {
                    _exMsg = '.mensal 850000000 95';
                    _fmt = '.mensal [número] [preço em MT]';
                } else {
                    _exMsg = '.enviar 850000000 1024';
                    _fmt = '.enviar [número] [MB]';
                }
                await _0x461461(_0x5ed9e1, _0x31aef7, '🔥 *COMO USAR ' + _cmdName.toUpperCase() + '*\n━━━━━━━━━━━━━━━━━━━━━━━━\n📝 Formato: ' + _fmt + '\n📝 Exemplo: ' + _exMsg + '\n━━━━━━━━━━━━━━━━━━━━━━━━', _0x54fc1f);
                return;
            }
            let _0x181aad = _0x50b1df[0x1];
            const _argVal = parseInt(_0x50b1df[0x2]);
            if (/^8[2-7]\d{7}$/['test'](_0x181aad)) _0x181aad = '258' + _0x181aad;

            // --- VALIDAÇÃO DE OPERADORA (VODACOM) ---
            const cleanNumAdmin = _0x181aad.startsWith('258') ? _0x181aad.substring(3) : _0x181aad;
            const isVodacomAdmin = cleanNumAdmin.startsWith('84') || cleanNumAdmin.startsWith('85');
            if (!isVodacomAdmin) {
                await _0x461461(_0x5ed9e1, _0x31aef7, '❌ *ERRO: NÚMERO NÃO PERTENCE À VODACOM*\n━━━━━━━━━━━━━━━━━━━\n⚠️ O número *' + _0x181aad + '* não pertence à rede Vodacom.\n\nPor favor, utilize um número válido da Vodacom (prefixos *84* ou *85*).', _0x54fc1f);
                return;
            }

            let _qtdSolicitada = _argVal;
            let _pacoteInfo = null;

            if (_tipoManual === 'semanal' || _tipoManual === 'mensal') {
                // --- VALIDAÇÃO POR PREÇO (TABELA DO BOT_CONFIG) ---
                const _tabela = (_DYN_CFG && _DYN_CFG.PACOTES && _DYN_CFG.PACOTES[_tipoManual]) || {};
                _pacoteInfo = _tabela[String(_argVal)];

                if (!_pacoteInfo) {
                    // Mostrar tabela de preços válidos
                    const _opcoes = Object.entries(_tabela)
                        .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
                        .map(([preco, p]) => `  *${preco} MT* → ${p.nome}`)
                        .join('\n');
                    const _label = _tipoManual === 'semanal' ? 'SEMANAL' : 'MENSAL';
                    await _0x461461(_0x5ed9e1, _0x31aef7,
                        '❌ *PREÇO INVÁLIDO PARA ' + _label + '*\n━━━━━━━━━━━━━━━━━━━\n⚠️ O preço *' + _argVal + ' MT* não existe na tabela.\n\n📋 *PREÇOS VÁLIDOS (' + _label + '):*\n' + _opcoes + '\n━━━━━━━━━━━━━━━━━━━\n📝 Exemplo: .' + _tipoManual + ' ' + _0x181aad.replace('258','') + ' ' + Object.keys(_tabela)[0],
                        _0x54fc1f);
                    return;
                }
                _qtdSolicitada = _pacoteInfo.quantidade_mb || _pacoteInfo.quantidade;
            } else {
                // --- VALIDAÇÃO DE MB PARA .enviar ---
                if (isNaN(_qtdSolicitada) || _qtdSolicitada <= 100 || _qtdSolicitada > 10240) {
                    await _0x461461(_0x5ed9e1, _0x31aef7, '❌ *𝗤𝗨𝗔𝗡𝗧𝗜𝗗𝗔𝗗𝗘 𝗜𝗡𝗩Á𝗟𝗜𝗗𝗔*\n━━━━━━━━━━━━━━━━━━━\n⚠️ O valor *' + _qtdSolicitada + 'MB* não é permitido.\n\n✅ *Intervalo aceite:* mais de *100MB* até *10240MB*\n📝 Exemplo: .enviar 850000000 1024\n━━━━━━━━━━━━━━━━━━━', _0x54fc1f);
                    return;
                }
            }

            const _tipoEtiqueta = _tipoManual === 'mensal' ? '📅 MENSAL' : _tipoManual === 'semanal' ? '📅 SEMANAL' : '⏳ 24 HORAS';
            const _nomePacote = _pacoteInfo ? _pacoteInfo.nome : (_qtdSolicitada + ' MB');
            const _0x3b18ab = 'CMD-' + Date['now']() + '-' + Math['random']()['toString'](0x24)['substring'](0x2, 0x6)['toUpperCase']();
            
            _0x1ca1fd('✅ Comando Direto (' + _tipoManual + '): ' + _0x181aad + ', ' + _qtdSolicitada + 'MB' + (_pacoteInfo ? ' [' + _nomePacote + ']' : ''), 'info');
            
            await _0x461461(_0x5ed9e1, _0x31aef7, '✅ *𝗣𝗘𝗗𝗜𝗗𝗢 𝗥𝗘𝗖𝗘𝗕𝗜𝗗𝗢!*\n━━━━━━━━━━━━━━━━━━━\n📱 *Número:* ' + _0x181aad + '\n📊 *Tipo:* ' + _tipoEtiqueta + '\n📦 *Pacote:* ' + _nomePacote + '\n🔖 *Ref:* `' + _0x3b18ab + '`\n━━━━━━━━━━━━━━━━━━━\n⏳ A processar o envio automaticamente...', _0x54fc1f);
            
            await _0x51dcba('INSERT INTO referencias (ref, numero, quantidade, status, jid, remetente, tipo, comprovativo_msg_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)', [_0x3b18ab, _0x181aad, _qtdSolicitada, 'na_fila', _0x31aef7, _0x5e6e29, _tipoManual, _0x54fc1f]);
            
            _0x149dcd({
                'ref': _0x3b18ab,
                'jid': _0x31aef7,
                'numero': _0x181aad,
                'quantidade': _qtdSolicitada,
                'remetente': _0x5e6e29,
                'tipo': _tipoManual
            });
        } catch (_0x2236df) {
            _0x1ca1fd('❌\x20Erro\x20manual:\x20' + _0x2236df['message'], 'error');
        }
    }

    function _0x4f8b5d() {
        try {
            const _0x3acbde = new Date(_0x1393f2),
                _0x42be3c = new Date(),
                _0x5ae44a = Math['floor']((_0x42be3c - _0x3acbde) / (0x3e8 * 0x3c * 0x3c * 0x18)),
                _0xa5aee9 = _0x3c21ac - _0x5ae44a;
            return {
                'diasUsados': _0x5ae44a,
                'diasRestantes': _0xa5aee9 > 0x0 ? _0xa5aee9 : 0x0,
                'expirado': _0x5ae44a > _0x3c21ac,
                'dataInicio': _0x1393f2,
                'limiteDias': _0x3c21ac,
                'dataExpiracao': new Date(_0x3acbde['getTime']() + _0x3c21ac * 0x18 * 0x3c * 0x3c * 0x3e8)
            };
        } catch (_0x40e690) {
            return console.error('❌\x20Erro\x20ao\x20calcular\x20dias\x20restantes:\x20' + _0x40e690['message']), null;
        }
    }

    async function _iniciarPlanoEspecial(client, ref, jid, numero, valor, tipoPlano) {
        try {
            const cfgEspeciais = (_DYN_CFG && _DYN_CFG.PLANOS_ESPECIAIS) || {};
            const config = cfgEspeciais[valor];
            
            if (!config) {
                _0x1ca1fd(`❌ Configuração não encontrada para plano especial de ${valor}MT`, 'error');
                return;
            }

            const totalMB = config.total;
            const entregaInicial = config.inicial;
            const entregaDiaria = config.diaria;
            const tipoReal = config.tipo; // renovacao ou faseado

            // Registrar no Banco de Dados
            const refRow = await _0x3c2652('SELECT remetente, jid FROM referencias WHERE ref=?', [ref]);
            let clienteJid = jid;
            if (refRow && refRow[0]) {
                clienteJid = refRow[0].remetente || refRow[0].jid || jid;
            }

            const dataProxima = new Date(Date.now() + 22 * 60 * 60 * 1000);
            const dataProximaISO = dataProxima.toISOString().replace('T', ' ').split('.')[0];

            await _0x2c5e52('INSERT INTO assinaturas_planos (jid, numero, tipo, total_mb, entregue_mb, valor_entrega_diaria, data_ultima_entrega, data_proxima_entrega, referencia_original, status) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?)',
                [clienteJid, numero, tipoReal, totalMB, entregaInicial, entregaDiaria, dataProximaISO, ref, 'ativo']);

            // Primeiro envio (Imediato)
            _0x1ca1fd(`📦 Ativando ${tipoReal.toUpperCase()}: ${entregaInicial}MB inicial para ${numero}`, 'info');
            _0x149dcd({ 'ref': ref, 'jid': clienteJid, 'numero': numero, 'quantidade': entregaInicial, 'remetente': 'SISTEMA_PLANOS', 'tipo': '24hrs' });

            const formatarMB = (mb) => {
                if (mb >= 1024) {
                    const gb = mb / 1024;
                    return Number.isInteger(gb) ? `${gb} GB` : `${gb.toFixed(1)} GB`;
                }
                return `${mb} MB`;
            };

            const totalFormatado = formatarMB(totalMB);
            const inicialFormatado = formatarMB(entregaInicial);
            const diariaFormatado = formatarMB(entregaDiaria);

            const msgAtivacao = `🎉 *PLANO ESPECIAL ATIVADO!* 🚀\n━━━━━━━━━━━━━━━━━━━\n📍 *Pacote:* ${config.nome}\n📱 *Número de Destino:* ${numero.replace('258', '')}\n\n📊 *DIVISÃO DO PACOTE:*\n📦 *Franquia Total:* ${totalFormatado}\n⚡ *Enviado Agora:* ${inicialFormatado}\n📅 *Entregas Diárias:* ${diariaFormatado} por dia\n\n⏳ *PRÓXIMO ENVIO:*\nO seu próximo lote diário de ${diariaFormatado} será enviado automaticamente amanhã (22h de intervalo para garantir que sua internet nunca caia).\n\n📥 *SAQUE MANUAL (AUTO-SERVIÇO):*\nSe precisar de mais megas antes da hora, não se preocupe! Você está no controle:\n👉 Digite *.meuplano* para ver seu saldo pendente.\n👉 Digite *.sacar* ou *.sacar [quantidade]* no meu privado para resgatar megas instantaneamente!\n━━━━━━━━━━━━━━━━━━━\n🤖 *KaNet 2.0 - Sempre Conectado!*`;
            
            await _0x461461(client, jid, msgAtivacao, null);

            await _0x2c5e52('UPDATE referencias SET status="processada" WHERE ref=?', [ref]);
        } catch (e) {
            _0x1ca1fd('❌ Erro ao iniciar plano especial: ' + e.message, 'error');
        }
    }

    async function _processarImagemOCR(_client, _msg) {
        if (!Tesseract) {
            try { Tesseract = require('tesseract.js'); } catch (e) {
                _0x1ca1fd('⚠️ OCR indisponível: ' + e.message, 'warning');
                return null;
            }
        }
        try {
            const _waClient = global['client'] || _client;
            _0x1ca1fd('🔍 Analisando imagem...', 'info');

            // 1. Coleta de todos os métodos possíveis (Cliente + Protótipo + WAPI)
            let _metodos = new Set();
            let _fAlvos = ['decrypt', 'download', 'file', 'media', 'getfile'];
            
            const _scan = (_obj, _prefix = '') => {
                if (!_obj) return;
                try {
                    // Propriedades próprias e protótipo
                    let _curr = _obj;
                    while (_curr && _curr !== Object.prototype) {
                        Object.getOwnPropertyNames(_curr).forEach(_p => {
                            if (_fAlvos.some(_a => _p.toLowerCase().includes(_a))) _metodos.add(_prefix + _p);
                        });
                        _curr = Object.getPrototypeOf(_curr);
                    }
                } catch (e) {}
            };

            _scan(_waClient);
            _scan(_waClient.WAPI, 'WAPI.');
            _scan(_waClient.media, 'media.');

            const _listaMetodos = Array.from(_metodos);
            _0x1ca1fd('🧪 Candidatos encontrados: ' + (_listaMetodos.length > 0 ? _listaMetodos.join(', ') : 'Nenhum'), 'info');

            // 2. Tentativa de download
            let _buffer = null;
            const _ordemTentativa = [..._listaMetodos, 'decryptFile', 'downloadFile', 'downloadMedia', 'media.decryptFile', 'WAPI.downloadFile'];

            for (const _path of _ordemTentativa) {
                try {
                    let _fn = null;
                    if (_path.includes('.')) {
                        const [_p1, _p2] = _path.split('.');
                        if (_waClient[_p1] && typeof _waClient[_p1][_p2] === 'function') _fn = _waClient[_p1][_p2].bind(_waClient[_p1]);
                    } else {
                        if (typeof _waClient[_path] === 'function') _fn = _waClient[_path].bind(_waClient);
                    }

                    if (_fn) {
                        _buffer = await _fn(_msg);
                        if (_buffer) {
                            _0x1ca1fd('✅ Sucesso via: ' + _path, 'success');
                            
                            // Bloco isolado para o Tesseract para evitar que erros do Worker crashem o processo principal
                            try {
                                let text = '';
                                try {
                                    const res = await Tesseract.recognize(_buffer, 'eng+por');
                                    text = res && res.data ? res.data.text : '';
                                } catch (e1) {
                                    const res = await Tesseract.recognize(_buffer, 'eng');
                                    text = res && res.data ? res.data.text : '';
                                }

                                if (text && text.trim().length > 0) {
                                    _0x1ca1fd('🎯 OCR Concluído: ' + text.substring(0, 50).replace(/\n/g, ' '), 'success');
                                    return text;
                                }
                                return null;
                            } catch (tessErr) {
                                _0x1ca1fd('⚠️ Erro no Tesseract OCR: ' + tessErr.message, 'error');
                                return null;
                            }
                            break;
                        }
                    }
                } catch (e) {}
            }

            if (!_buffer) {
                _0x1ca1fd('⚠️ Falha ao obter imagem após ' + _ordemTentativa.length + ' tentativas.', 'warning');
                return null;
            }

            // Validar se o buffer é um Buffer válido do Node e tem dados
            if (!Buffer.isBuffer(_buffer) && !(typeof _buffer === 'string' && _buffer.startsWith('data:image'))) {
                // Se for um objeto com base64 ou dados, extrair
                if (_buffer && typeof _buffer === 'object' && _buffer.data) {
                    _buffer = Buffer.from(_buffer.data);
                } else if (_buffer && typeof _buffer === 'string') {
                    _buffer = Buffer.from(_buffer, 'base64');
                } else {
                    _0x1ca1fd('⚠️ O buffer obtido não tem um formato de imagem reconhecido pelo Node.', 'warning');
                    return null;
                }
            }

            // Bloco isolado para o Tesseract para evitar que erros do Worker crashem o processo principal
            try {
                const { data: { text } } = await Tesseract.recognize(_buffer, 'eng+por');
                const _refRegex = /\b([A-Z0-9]{8,15}\.[0-9]{5,}\.[0-9]{4,}|[A-Z0-9]{10,})\b/gi;
                const _match = text.match(_refRegex);
                
                if (_match) {
                    _0x1ca1fd('🎯 ID Detectado: ' + _match[0].toUpperCase(), 'success');
                    return text;
                }
                return text;
            } catch (tessErr) {
                _0x1ca1fd('⚠️ Erro interno do Tesseract ao analisar a imagem: ' + tessErr.message, 'warning');
                return null;
            }
        } catch (_err) {
            _0x1ca1fd('❌ Erro OCR: ' + _err.message, 'error');
            return null;
        }
    }
    async function _0x2a9611(_0x5caad9, _0x11f121, _0x4d95bc = null) {
        try {
            const _0x4e17f2 = _0x4f8b5d();
            if (!_0x4e17f2) {
                await _0x461461(_0x5caad9, _0x11f121, '❌\x20Não\x20foi\x20possível\x20verificar\x20a\x20validade\x20do\x20bot.', _0x4d95bc);
                return;
            }
            const _0x41a81b = _0x4e17f2['dataExpiracao']['toLocaleDateString']('pt-PT', {
                'day': '2-digit',
                'month': '2-digit',
                'year': 'numeric'
            }),
                _0x43e3c3 = new Date(_0x1393f2)['toLocaleDateString']('pt-PT', {
                    'day': '2-digit',
                    'month': '2-digit',
                    'year': 'numeric'
                });
            let _0x13f7be = '';
            _0x4e17f2['expirado'] ? _0x13f7be = '⚠️\x20*BOT\x20EXPIRADO*\x20⚠️\x0a━━━━━━━━━━━━━━━━━━━━━━━━\x0a📅\x20*Data\x20de\x20Início:*\x20' + _0x43e3c3 + '\x0a⏳\x20*Dias\x20de\x20Uso:*\x20' + _0x4e17f2['diasUsados'] + '\x20dias\x0a🚫\x20*Limite\x20de\x20Dias:*\x20' + _0x4e17f2['limiteDias'] + '\x20dias\x0a📆\x20*Data\x20de\x20Expiração:*\x20' + _0x41a81b + '\x0a━━━━━━━━━━━━━━━━━━━━━━━━\x0a❌\x20*Status:*\x20**EXPIRADO**\x0a⚠️\x20*Ação:*\x20Bot\x20será\x20encerrado\x20automaticamente\x0a━━━━━━━━━━━━━━━━━━━━━━━━\x0a📞\x20Contate\x20o\x20suporte\x20para\x20renovação.' : _0x13f7be = '✅\x20*VALIDADE\x20DO\x20BOT*\x20✅\x0a━━━━━━━━━━━━━━━━━━━━━━━━\x0a📅\x20*Data\x20de\x20Início:*\x20' + _0x43e3c3 + '\x0a⏳\x20*Dias\x20de\x20Uso:*\x20' + _0x4e17f2['diasUsados'] + '\x20dias\x0a⏰\x20*Dias\x20Restantes:*\x20' + _0x4e17f2['diasRestantes'] + '\x20dias\x0a📊\x20*Limite\x20de\x20Dias:*\x20' + _0x4e17f2['limiteDias'] + '\x20dias\x0a📆\x20*Data\x20de\x20Expiração:*\x20' + _0x41a81b + '\x0a━━━━━━━━━━━━━━━━━━━━━━━━\x0a✅\x20*Status:*\x20**ATIVO**\x0a📈\x20*Porcentagem:*\x20' + Math['round'](_0x4e17f2['diasUsados'] / _0x4e17f2['limiteDias'] * 0x64) + '%\x20usado\x0a━━━━━━━━━━━━━━━━━━━━━━━━\x0a💡\x20O\x20bot\x20expira\x20automaticamente\x20após\x20' + _0x4e17f2['limiteDias'] + '\x20dias\x20de\x20uso.', await _0x461461(_0x5caad9, _0x11f121, _0x13f7be, _0x4d95bc), _0x1ca1fd('📊\x20Informações\x20de\x20validade\x20exibidas:\x20' + _0x4e17f2['diasUsados'] + '/' + _0x4e17f2['limiteDias'] + '\x20dias', 'info');
        } catch (_0x2d1c3f) {
            _0x1ca1fd('❌\x20Erro\x20ao\x20exibir\x20dias\x20restantes:\x20' + _0x2d1c3f['message'], 'error'), await _0x461461(_0x5caad9, _0x11f121, '❌\x20Erro\x20ao\x20verificar\x20validade\x20do\x20bot:\x20' + _0x2d1c3f['message'], _0x4d95bc);
        }
    }

    // --- MOTOR DE BUSCA INTERATIVO DE PACOTES KA-NET ---
    function _pesquisarPacotes(texto) {
        const txt = texto.toLowerCase().trim();
        const resultados = [];
        
        // Obter todos os pacotes das configurações
        const _todosPacotes = [];
        if (_DYN_CFG && _DYN_CFG.TABELAS) {
            for (const [categoria, itens] of Object.entries(_DYN_CFG.TABELAS)) {
                for (const [precoStr, info] of Object.entries(itens)) {
                    const preco = parseFloat(precoStr);
                    _todosPacotes.push({
                        origem: 'tabela',
                        categoria: categoria,
                        preco: preco,
                        quantidade_mb: info.quantidade_mb || info.quantidade || 0,
                        nome: info.nome,
                        infoCompleta: info
                    });
                }
            }
        }
        if (_DYN_CFG && _DYN_CFG.PLANOS_ESPECIAIS) {
            for (const [precoStr, info] of Object.entries(_DYN_CFG.PLANOS_ESPECIAIS)) {
                const preco = parseFloat(precoStr);
                _todosPacotes.push({
                    origem: 'especial',
                    categoria: info.tipo,
                    preco: preco,
                    quantidade_mb: info.total,
                    nome: info.nome,
                    infoCompleta: info
                });
            }
        }

        // Extrair todos os números do texto
        const numeros = [];
        const rxNumeros = /\b(\d+)\b/g;
        let match;
        while ((match = rxNumeros.exec(txt)) !== null) {
            numeros.push(parseInt(match[1]));
        }
        
        const temIlimitado = txt.includes('ilimitado') || txt.includes('unlimited') || txt.includes('ilimitada');
        const temRenovacao = txt.includes('renovacao') || txt.includes('renovação') || txt.includes('renova');
        const temFaseado = txt.includes('faseado') || txt.includes('faseada');
        const temMensal = txt.includes('mensal') || txt.includes('mes') || txt.includes('mês') || txt.includes('30 dias');
        const temSemanal = txt.includes('semanal') || txt.includes('semana') || txt.includes('7 dias');
        const temDiario = txt.includes('diario') || txt.includes('diário') || txt.includes('24h') || txt.includes('24hrs') || txt.includes('24 hrs') || txt.includes('dia');

        let categoriaFiltro = null;
        if (temIlimitado) categoriaFiltro = 'ilimitado';
        else if (temRenovacao) categoriaFiltro = 'renovacao';
        else if (temFaseado) categoriaFiltro = 'faseado';
        else if (temMensal) categoriaFiltro = 'mensal';
        else if (temSemanal) categoriaFiltro = 'semanal';
        else if (temDiario) categoriaFiltro = '24hrs';

        // 1. Busca por números extraídos
        for (const num of numeros) {
            const regexMt = new RegExp('\\b' + num + '\\s*(?:mt|meticais|metical|mzn|prata)\\b', 'i');
            const regexGb = new RegExp('\\b' + num + '\\s*(?:gb|giga|gigas|gigabytes)\\b', 'i');
            const regexMb = new RegExp('\\b' + num + '\\s*(?:mb|mega|megas|megabytes)\\b', 'i');
            
            const expressaMt = regexMt.test(txt);
            const expressaGb = regexGb.test(txt);
            const expressaMb = regexMb.test(txt);
            
            for (const p of _todosPacotes) {
                let matches = false;
                
                if (expressaMt) {
                    if (p.preco === num) matches = true;
                } else if (expressaGb) {
                    const gb = Math.round(p.quantidade_mb / 1024);
                    if (gb === num || Math.abs(p.quantidade_mb - (num * 1024)) < 200) matches = true;
                } else if (expressaMb) {
                    if (p.quantidade_mb === num) matches = true;
                } else {
                    const gb = Math.round(p.quantidade_mb / 1024);
                    if (p.preco === num) {
                        matches = true;
                    } else if (gb === num && num > 0 && num < 200) {
                        matches = true;
                    } else if (p.quantidade_mb === num && num >= 200) {
                        matches = true;
                    }
                }
                
                if (matches) {
                    if (categoriaFiltro) {
                        if (p.categoria === categoriaFiltro) {
                            resultados.push(p);
                        }
                    } else {
                        resultados.push(p);
                    }
                }
            }
        }
        
        // Se nenhum número foi mencionado, mas categorias foram mencionadas
        if (resultados.length === 0 && categoriaFiltro) {
            for (const p of _todosPacotes) {
                if (p.categoria === categoriaFiltro) {
                    resultados.push(p);
                }
            }
        }
        
        // Remover duplicados
        const unique = [];
        const seen = new Set();
        for (const r of resultados) {
            const key = r.nome + '-' + r.preco;
            if (!seen.has(key)) {
                seen.add(key);
                unique.push(r);
            }
        }
        
        return {
            resultados: unique,
            categoriaFiltro: categoriaFiltro,
            numeros: numeros
        };
    }

    async function _gerarExplicacaoPacote(p) {
        let explicacao = '';
        let duracao = '';
        
        if (p.categoria === '24hrs') {
            duracao = '24 Horas ⏳';
            explicacao = 'Este pacote é ativado directamente no seu número da Vodacom e é válido por **24 horas** a partir do momento da activação. Ideal para uso diário intenso!';
        } else if (p.categoria === 'semanal') {
            duracao = '7 Dias (Semanal) 📅';
            explicacao = 'Este pacote oferece uma excelente franquia de internet válida por **7 dias inteiros**, ideal para quem usa a internet de forma regular ao longo da semana.';
        } else if (p.categoria === 'mensal') {
            duracao = '30 Dias (Mensal) 📅';
            explicacao = 'Pacote premium ideal para uso a longo prazo, com validade de **30 dias**. Perfeito para garantir que esteja sempre conectado sem preocupações diárias.';
        } else if (p.categoria === 'ilimitado') {
            duracao = 'Ilimitado ♾️';
            const franquia = p.nome.match(/(\d+GB)/i)?.[0] || '11GB';
            explicacao = `Este é o nosso pacote **Ilimitado**. Ele activa uma franquia inicial de **${franquia}** de altíssima velocidade. Após esgotar essa franquia, a internet continua activa e **totalmente ilimitada** a uma velocidade reduzida, garantindo que nunca fique sem acesso e sem gastar mais por isso! 🚀`;
        } else if (p.categoria === 'renovacao') {
            duracao = 'Renovação Diária 📅';
            const inicial = Math.round(p.infoCompleta.inicial / 1024);
            explicacao = `O plano de **Renovação** é incrível! Ele activa uma franquia inicial generosa de **${inicial}GB** de alta velocidade no primeiro dia, e depois renova automaticamente adicionando mais **100MB extras todos os dias** ao longo de 6 dias, totalizando ${Math.round(p.quantidade_mb/1024)}GB. É perfeito para manter o saldo sempre ativo!`;
        } else if (p.categoria === 'faseado') {
            duracao = 'Faseado Diário 📅';
            const inicial = Math.round(p.infoCompleta.inicial / 1024);
            const diaria = Math.round(p.infoCompleta.diaria / 1024);
            const dias = Math.ceil(p.infoCompleta.total / p.infoCompleta.diaria);
            explicacao = `O plano **Faseado** é o campeão de economia! Ele distribui a franquia total em envios automáticos diários ao longo de ${dias} dias (ex: recebe **${inicial}GB no primeiro dia** e depois mais **${diaria}GB por dia** nos dias seguintes). Isso evita que você gaste todos os seus megas no primeiro dia e garante internet ativa!`;
        }
        
        const { mpesa_num, mpesa_name, emola_num, emola_name } = _getPaymentDetails();
        return `📦 *DETALHES DO PACOTE* 📦\n━━━━━━━━━━━━━━━━━━━━\n🌟 *Nome:* ${p.nome}\n💰 *Preço:* *${p.preco} MT*\n⏳ *Validade/Duração:* ${duracao}\n\n💡 *Como funciona?*\n${explicacao}\n\n━━━━━━━━━━━━━━━━━━━━\n💳 *Como Comprar/Ativar?*\n1️⃣ Efectue o pagamento de *${p.preco} MT*:\n   📱 *M-Pesa:* ${mpesa_num} (${mpesa_name})\n   📱 *E-Mola:* ${emola_num} (${emola_name})\n2️⃣ Envie o comprovativo de pagamento aqui no chat.\n3️⃣ Envie o número de destino na última linha!\n\n⚡ *O nosso sistema automático ativará o seu pacote em segundos!*`;
    }

    function _obterExplicacaoCategoria(categoria) {
        let titulo = '';
        let explicacao = '';
        
        if (categoria === 'ilimitado') {
            titulo = 'PLANOS ILIMITADOS ♾️';
            explicacao = `Os pacotes **Ilimitados** da Vodacom/Movitel são fantásticos!\n\nFunciona assim:\n1. Você escolhe uma franquia de gigas de alta velocidade (por exemplo, 11GB por 280 MT ou 15GB por 570 MT).\n2. O sistema ativa essa franquia no seu número.\n3. Você navega com velocidade máxima enquanto tiver essa franquia.\n4. Quando os gigas de velocidade máxima terminarem, você **continua com internet ativa de forma ilimitada** em velocidade reduzida até o pacote expirar, sem descontar do seu saldo principal!\n\nIdeal para quem não quer ficar sem comunicação sob nenhuma circunstância.`;
        } else if (categoria === 'faseado') {
            titulo = 'PLANOS FASEADOS 📅';
            explicacao = `Os pacotes **Faseados** são ideais para quem quer economizar!\n\nFunciona assim:\n1. Em vez de receber todos os gigas de uma vez e correr o risco de consumi-los rapidamente, a internet é entregue de forma controlada ao longo de vários dias.\n2. Por exemplo, no plano de **5GB Faseado (130 MT)**, você recebe **1GB no primeiro dia** e mais **1GB por dia** nos 4 dias seguintes de forma 100% automática!\n3. Isso garante que você tenha gigas novos e frescos todos os dias e internet garantida por muito mais tempo!`;
        } else if (categoria === 'renovacao') {
            titulo = 'PLANOS DE RENOVAÇÃO 📅';
            explicacao = `Os pacotes de **Renovação** são excelentes para quem usa internet constantemente!\n\nFunciona assim:\n1. Ao ativar, você recebe uma franquia inicial muito grande (ex: no plano de **5GB+700 (145 MT)**, você recebe **5GB na hora**!).\n2. Além dessa franquia inicial, o sistema **renova a sua internet todos os dias** enviando mais **100MB extras por dia** durante os 6 dias seguintes!\n3. É ideal para garantir que seu plano não expire e você sempre tenha megas adicionais caindo na sua conta diariamente.`;
        } else {
            return `Temos pacotes diários (24h), semanais (7 dias), mensais (30 dias) e ilimitados! Digite *Menu* para visualizar a tabela de preços completa e encontrar o pacote ideal para si!`;
        }
        
        return `ℹ️ *COMO FUNCIONA: ${titulo}*\n━━━━━━━━━━━━━━━━━━━━\n${explicacao}\n\n👉 Para ver os preços e comprar, digite *Menu* ou escolha o seu pacote e faça o pagamento!`;
    }

    async function _responderConversaIA(_client, _msg, _texto, _from, _isFornecMsg = false) {
        const _isFornec = !!(_isFornecMsg || _msg?._isFornecimento);
        if (_texto) _texto = _texto.replace(/^([.!])\s+/, '$1');
        let _txt = _texto.toLowerCase().trim();
        const _R = (arr) => arr[Math.floor(Math.random() * arr.length)];
        const _inc = (kws) => kws.some(k => _txt.includes(k));
        const _is = (kws) => kws.some(k => _txt === k || _txt.startsWith(k + ' ') || _txt.startsWith(k + '!'));

        // Extrair o nome do cliente
        const _nomeCliente = _msg.sender?.pushname || _msg.sender?.formattedName || _msg.sender?.name || 'amigo(a)';

        if (!global['_kanetUsers']) global['_kanetUsers'] = {};
        if (!global['_kanetUsers'][_from]) global['_kanetUsers'][_from] = { step: 'init', msgCount: 0 };
        const _user = global['_kanetUsers'][_from];
        _user.msgCount++;

        const { sysName: _sN, supportNum: _supNum } = _getSupportDetails();
        const _isOwner = global.licencaObj && typeof global.licencaObj._isOwnerMode === 'function' && global.licencaObj._isOwnerMode();

        const _reply = async (txt, titulo = 'ASSISTENTE') => { 
            const _msgPremium = `✨ *${_sN.toUpperCase()} • ${titulo}* ✨\n━━━━━━━━━━━━━━━━━━━\n\n${txt}\n\n━━━━━━━━━━━━━━━━━━━\n🚀 *Internet rápida em segundos!*`;
            try { await _0x461461(_client, _from, _msgPremium, _msg.id); } catch(e) {} 
        };

        // TRATAMENTO DE OPÇÕES DIRETAS (1, 2, 3)
        if (_is(['1', '1️⃣', 'opcao 1', 'opção 1'])) {
            const _menuTextStr = typeof _0x47e76d === 'function' ? _0x47e76d(_from, _isFornec) : null;
            if (_menuTextStr) {
                if (_isFornec) {
                    try { await _0x461461(_client, _from, _menuTextStr, _msg.id); } catch(e) {}
                    return;
                }
                return await _reply(_menuTextStr, 'TABELA DE PACOTES');
            }
            return await _reply(`Temos as melhores tarifas do mercado, *${_nomeCliente}*! 💸\n\nDigita *Menu* para visualizar nossa tabela completa de pacotes diários, semanais e mensais.`, 'PREÇOS');
        }
        if (_is(['2', '2️⃣', 'opcao 2', 'opção 2'])) {
            const { mpesa_num, mpesa_name, emola_num, emola_name } = _getPaymentDetails();
            return await _reply(`Pode efectuar o seu pagamento nestas contas, *${_nomeCliente}*: 💳\n\n📱 *M-Pesa:* ${mpesa_num} (${mpesa_name})\n📱 *E-Mola:* ${emola_num} (${emola_name})\n\nApós o pagamento, envie o recibo e o número!`, 'PAGAMENTO');
        }
        if (_is(['3', '3️⃣', 'opcao 3', 'opção 3'])) {
            _txt = '!fidelidade';
        }

        // --- SISTEMA DE INDICAÇÃO (Convites) ---
        if (_is(['convite', '!convite', 'codigo', '!codigo'])) {
            const _meuJid = _0x31d398(_from);
            const _msgBonus = `🎁 *GANHE BÓNUS INDICANDO AMIGOS*\n\nGanhe *200MB* em cada compra feita por amigos que usarem o seu código!\n\n🔗 *O Seu Código:* ${_meuJid}\n\n💡 *Como funciona?*\n1. Envie o seu código para um amigo.\n2. Peça para ele enviar: *!indicado ${_meuJid}*\n3. Pronto! O bónus cai automaticamente.`;
            return await _reply(_msgBonus, 'BÓNUS');
        }

        if (_txt.match(/^([\.!])?indicado\s+\d+/i)) {
            const _parentNum = _txt.split(/\s+/)[1];
            if (!_parentNum || _parentNum.length < 8) return await _reply('❌ Código inválido. Use: *!indicado [código/número]*', 'ERRO');
            const _parentJidNorm = _parentNum.split('@')[0];
            const _fromJidNorm = _from.split('@')[0];
            if (_parentJidNorm === _fromJidNorm) return await _reply('❌ Você não pode se indicar a si mesmo!', 'ERRO');
            
            const _check = await _0x3c2652('SELECT * FROM bonus_referencia WHERE jid=?', [_fromJidNorm]);
            if (_check && _check.length > 0 && _check[0].parent_jid) {
                return await _reply('⚠️ Você já foi indicado por alguém!', 'AVISO');
            }

            if (_check && _check.length > 0) {
                await _0x2c5e52('UPDATE bonus_referencia SET parent_jid=? WHERE jid=?', [_parentJidNorm, _fromJidNorm]);
            } else {
                await _0x2c5e52('INSERT INTO bonus_referencia (jid, parent_jid) VALUES (?, ?)', [_fromJidNorm, _parentJidNorm]);
            }
            await _0x2c5e52('INSERT OR IGNORE INTO bonus_referencia (jid, total_convidados) VALUES (?, 0)', [_parentJidNorm]);
            await _0x2c5e52('UPDATE bonus_referencia SET total_convidados = IFNULL(total_convidados, 0) + 1 WHERE jid=?', [_parentJidNorm]);

            return await _reply(`✅ Sucesso! Agora você é indicado de *${_parentNum}*. Seu amigo ganhará bónus nas suas compras!`, 'SUCESSO');
        }

        if (_is(['bonus', '!bonus', 'saldo bonus', 'saldo bónus'])) {
            const _fromJidNorm = _from.split('@')[0];
            const _res = await _0x3c2652('SELECT SUM(mb) as total FROM bonus_contribuicoes WHERE parent_jid=? AND status="pendente"', [_fromJidNorm]);
            const _saldo = (_res && _res.length > 0) ? (_res[0].total || 0) : 0;
            const _conv = await _0x3c2652('SELECT total_convidados FROM bonus_referencia WHERE jid=?', [_fromJidNorm]);
            const _convidados = (_conv && _conv.length > 0) ? _conv[0].total_convidados : 0;
            const _progressBarMsg = await _obterProgressBarFidelidade(_fromJidNorm);
            let finalMsg = `👥 *Amigos Convidados:* ${_convidados}\n💰 *Saldo Acumulado:* ${_saldo}MB`;
            if (_progressBarMsg) {
                finalMsg += `\n\n${_progressBarMsg}`;
            }
            finalMsg += `\n\n🚀 Digite *!resgatar* quando atingir 1000MB!`;
            return await _reply(finalMsg, 'MEU SALDO');
        }

        if (_is(['voltou', '!voltou', '.voltou'])) {
            const _fromJidNorm = _from.split('@')[0];
            try {
                const checkCoupon = await _0x3c2652('SELECT status FROM cupons_clientes WHERE jid = ? AND cupom = "VOLTOU"', [_fromJidNorm]);
                if (checkCoupon && checkCoupon.length > 0) {
                    if (checkCoupon[0].status === 'usado') {
                        return await _reply('❌ *CUPOM JÁ UTILIZADO*\n━━━━━━━━━━━━━━━━━━━\nVocê já usou este cupom de reativação anteriormente.', 'CUPOM');
                    } else {
                        return await _reply('🎉 *CUPOM JÁ ATIVO!* 🚀\n━━━━━━━━━━━━━━━━━━━\nO cupom *VOLTOU* já está ativo na sua conta!\n\nVocê ganhará *+20% de bónus* na sua próxima compra de qualquer pacote. Basta pagar e enviar o comprovativo normalmente.', 'CUPOM');
                    }
                }
                await _0x2c5e52('INSERT INTO cupons_clientes (jid, cupom, status) VALUES (?, "VOLTOU", "ativo")', [_fromJidNorm]);
                return await _reply('🎉 *CUPOM VOLTOU ATIVADO!* 🚀\n━━━━━━━━━━━━━━━━━━━\nVocê ganhou *+20% de bónus* na sua próxima compra de qualquer pacote!\n\n💡 Basta fazer o pagamento e enviar o comprovativo normalmente.', 'CUPOM');
            } catch (e) {
                _0x1ca1fd('❌ Erro ao ativar cupom: ' + e.message, 'error');
                return await _reply('❌ Erro ao ativar o cupom. Tente novamente mais tarde.', 'ERRO');
            }
        }

        if (_is(['sacar', '!sacar', 'resgatar', '!resgatar', 'resgastar', '!resgastar'])) {
            const _fromJidNorm = _from.split('@')[0];
            const _res = await _0x3c2652('SELECT id, mb FROM bonus_contribuicoes WHERE parent_jid=? AND status="pendente" LIMIT 10', [_fromJidNorm]);
            let _soma = 0; let _ids = [];
            if (_res) { for (const _c of _res) { _soma += _c.mb; _ids.push(_c.id); if (_soma >= 1000) break; } }

            if (_soma < 1000) {
                return await _reply(`❌ *SALDO INSUFICIENTE*\n\n💰 Você tem: ${_soma}MB\n🎯 Necessário: 1000MB\n\nContinue convidando para ganhar mais!`, 'RESGATE');
            }
            
            const parts = _texto.trim().split(/\s+/);
            let _num = '';
            if (parts.length >= 2) {
                let potentialNum = parts[1].trim();
                if (/^(?:258)?8[2-7]\d{7}$/.test(potentialNum)) {
                    if (!potentialNum.startsWith('258')) {
                        potentialNum = '258' + potentialNum;
                    }
                    _num = potentialNum;
                }
            }
            if (!_num) {
                return await _reply(`❌ *NÚMERO DE DESTINO OBRIGATÓRIO*\n━━━━━━━━━━━━━━━━━━━\n⚠️ Por favor, escolha para qual número enviar o bônus, digitando o comando junto com o número de destino:\n\n👉 *!resgatar [número]*\nExemplo: *!resgatar ${_supNum}*`, 'RESGATE');
            }

            const _placeholders = _ids.map(() => '?').join(',');
            await _0x2c5e52(`UPDATE bonus_contribuicoes SET status="resgatado" WHERE id IN (${_placeholders})`, _ids);
            
            await _reply(`🎉 *RESGATE CONCLUÍDO!*\n\n✅ 1000MB foram resgatados com sucesso para o número *${_num}*!`, 'RESGATE');
            _0x149dcd({ 'ref': 'BONUS-' + Date.now(), 'jid': _from, 'numero': _num, 'quantidade': 1024, 'remetente': 'SISTEMA_BONUS', 'tipo': '24hrs' });
            return;
        }

        if (_is(['fidelidade', '!fidelidade', 'nivel', '!nivel', 'loyalty', '!loyalty'])) {
            const _fromJidNorm = _from.split('@')[0];
            try {
                const _res = await _0x3c2652('SELECT COUNT(*) as total FROM referencias WHERE (jid=? OR jid LIKE ? OR remetente=? OR remetente LIKE ?) AND status IN ("finalizado", "processada")', [_fromJidNorm, _fromJidNorm + '@%', _fromJidNorm, _fromJidNorm + '@%']);
                const _totalCompras = (_res && _res.length > 0) ? (_res[0].total || 0) : 0;
                
                let _nivel = 'Bronze 🥉';
                let _perk = 'Nenhum benefício ativo ainda. Ative mais pacotes!';
                let _proxNivel = 'Prata 🥈';
                let _proxNivelFaltam = 3 - _totalCompras;
                let _pct = Math.round((_totalCompras / 3) * 100);
                
                if (_totalCompras >= 16) {
                    _nivel = 'Platina 💎';
                    _perk = '🔥 *15% de bónus adicional* nas indicações + *Fila de entrega prioritária*!';
                    _proxNivel = 'Nível Máximo Atingido! 🚀';
                    _proxNivelFaltam = 0;
                    _pct = 100;
                } else if (_totalCompras >= 8) {
                    _nivel = 'Ouro 🥇';
                    _perk = '🔥 *10% de bónus adicional* nas indicações!';
                    _proxNivel = 'Platina 💎';
                    _proxNivelFaltam = 16 - _totalCompras;
                    _pct = Math.round(((_totalCompras - 8) / 8) * 100);
                } else if (_totalCompras >= 3) {
                    _nivel = 'Prata 🥈';
                    _perk = '🔥 *5% de bónus adicional* nas indicações!';
                    _proxNivel = 'Ouro 🥇';
                    _proxNivelFaltam = 8 - _totalCompras;
                    _pct = Math.round(((_totalCompras - 3) / 5) * 100);
                }
                
                if (_pct > 100) _pct = 100;
                if (_pct < 0) _pct = 0;
                
                const _charsTotal = 10;
                const _charsFilled = Math.round((_pct / 100) * _charsTotal);
                const _charsEmpty = _charsTotal - _charsFilled;
                const _progressBar = '█'.repeat(_charsFilled) + '░'.repeat(_charsEmpty);
                
                const _fidelityMsg = `✨ *FIDELIDADE ${_sN.toUpperCase()}* ✨\n━━━━━━━━━━━━━━━━━━━━\n👤 *Cliente:* ${_nomeCliente}\n📊 *Nível Ativo:* ${_nivel}\n\n🎯 *Estatísticas de Compra:*\n• Pacotes Ativados: *${_totalCompras}* pacote(s)\n${_proxNivelFaltam > 0 ? `• Próximo Nível: *${_proxNivel}* (Faltam *${_proxNivelFaltam}*)\n` : '• *Nível Máximo Atingido!*\n'}\n📈 *Barra de Progresso:*\n[${_progressBar}] ${_pct}%\n\n🎁 *Seus Benefícios Ativos:*\n${_perk}\n━━━━━━━━━━━━━━━━━━━━\n⚡ *Obrigado pela sua preferência! O seu saldo está seguro com a ${_sN}.*`;
                
                return await _reply(_fidelityMsg, 'FIDELIDADE');
            } catch (e) {
                _0x1ca1fd('❌ Erro ao buscar fidelidade: ' + e.message, 'error');
                return await _reply('❌ Erro ao consultar o nível de fidelidade. Tente novamente mais tarde.', 'ERRO');
            }
        }

        // SAUDAÇÕES
        if (_is(['oi','olá','ola','bom dia','boa tarde','boa noite','hey','hi','hello','boa','salve','alô','alo','opa','fala tu','eae','fala','tudo bem','tudo bom','como estás','como estas','como vai','como esta','ta bom','tá bom'])) {
            const _hora = new Date().getHours();
            const _sd = _hora < 12 ? 'Bom dia' : _hora < 19 ? 'Boa tarde' : 'Boa noite';
            _user.step = 'saudado';
            return await _reply(`${_sd}, *${_nomeCliente}*! 🌟\n\nBem-vindo(a) à *${_sN}*!\n\n1️⃣ *Menu* — Ver Pacotes\n2️⃣ *Pagamento* — Contas\n3️⃣ *Fidelidade* — Bónus 🏆\n\nOu envie o *comprovativo M-Pesa* para comprar! ⚡`, 'SAUDAÇÃO');
        }

        // PREÇOS / TABELA / QUERO MEGAS / POSSO COMPRAR
        if (_inc(['preço','preco','valor','quanto','custo','tabela','planos','pacotes','opções','quanto custa','quero megas','posso comprar','quero comprar','peco megas','peço megas','preciso de megas','preciso megas','quero internet','preciso internet'])) {
            const _menuTextStr = typeof _0x47e76d === 'function' ? _0x47e76d(_from, _isFornec) : null;
            if (_menuTextStr) {
                if (_isFornec) {
                    try { await _0x461461(_client, _from, _menuTextStr, _msg.id); } catch(e) {}
                    return;
                }
                return await _reply(_menuTextStr, 'TABELA DE PACOTES');
            }
            return await _reply(`Temos as melhores tarifas! 💸\n\nDigite *Menu* para ver a tabela completa de pacotes.`, 'PREÇOS');
        }

        // COMO COMPRAR / COMO FUNCIONA
        if (_inc(['como funciona','como comprar','como faço','como faz','como ativar','ativar internet','carregar internet','fazer recarga','como se usa'])) {
            const { mpesa_num, mpesa_name } = _getPaymentDetails();
            return await _reply(`É simples! 😊\n\n1️⃣ Digite *Menu* para ver os preços\n2️⃣ Pague via M-Pesa para *${mpesa_num}* (${mpesa_name})\n3️⃣ Envie o *comprovativo* aqui\n4️⃣ Envie o *número* de destino\n\nO pacote é ativado automaticamente! ⚡`, 'COMO COMPRAR');
        }

        // PAGAMENTO
        if (_inc(['pagar','mpesa','emola','e-mola','m-pesa','pagamento','conta','pra onde','transferir'])) {
            const { mpesa_num, mpesa_name, emola_num, emola_name } = _getPaymentDetails();
            return await _reply(`Faça o pagamento aqui: 💳\n\n📱 *M-Pesa:* ${mpesa_num} (${mpesa_name})\n📱 *E-Mola:* ${emola_num} (${emola_name})\n\nApós pagar, envie o comprovativo e o número de destino!`, 'PAGAMENTO');
        }

        // AGRADECIMENTO
        if (_inc(['obrigado','obrigada','valeu','thanks','grato','grata','muito obrigado','muito obrigada','fixe','xobana'])) {
            return await _reply(`De nada, *${_nomeCliente}*! 😊\n\nSempre que precisar de megas, é só enviar o comprovativo! 🚀`, 'OBRIGADO');
        }

        // DESPEDIDA
        if (_inc(['tchau','xau','até logo','até já','ate logo','ate ja','adeus','bye','vou saindo','até amanhã'])) {
            return await _reply(`Até à próxima, *${_nomeCliente}*! 👋\n\nSempre que precisar de internet, estamos aqui!`, 'DESPEDIDA');
        }

        // SUPORTE / PROBLEMA
        if (_inc(['problema','não recebi','nao recebi','não chegou','nao chegou','demora','não funciona','nao funciona','erro','suporte','ajuda'])) {
            return await _reply(`Lamentamos o inconveniente! ⚠️\n\nEnvie a *referência* (ex: DEBxxxx) e o *número* de destino para resolvermos.\n\nOu contacte o suporte: *${_supNum}* 📞`, 'SUPORTE');
        }

        // === SISTEMA OWNER (Desenvolvedor): IA completa ===
        if (_isOwner) {
            // CRIADOR
            if (_inc(['criador','quem te criou','quem te fez','quem te programou','dono','programador','desenvolvedor'])) {
                return await _reply(`Fui desenvolvido com tecnologia de ponta pelo mestre *Kelven Junior Anabela Nharrave*.\n\n💎 *Contactos do Criador:*\n📞 856116039\n📞 850401416`, 'CRIADOR');
            }

            // NOME / É BOT?
            if (_inc(['seu nome','teu nome','como te chamas','quem és','quem es','como te chamar','és humano','es humano','és um bot','es um bot','és ia','es ia'])) {
                return await _reply(`O meu nome é *KaNet 2.0*! 🤖 Sou a inteligência artificial oficial da *Ka-Net*.\n\nEmbora eu não seja humano, estou aqui para garantir que você nunca fique sem internet! 📶`, 'IDENTIDADE');
            }

            // O QUE É A KA-NET
            if (_inc(['o que é a ka','o que e a ka','o que é kanet','o que e kanet','me fala sobre','fala sobre','o que é isso','o que e isso','o que fazes'])) {
                return await _reply(`A *Ka-Net* é a sua melhor parceira de internet em Moçambique! 🇲🇿\n\nOferecemos pacotes da Vodacom de forma *100% automática*. Você paga, envia o comprovativo e os megas chegam em segundos! ⚡`, 'SOBRE NÓS');
            }

            // HUMOR (IA)
            if (_inc(['piada','brincadeira','engraçado','faz rir','te odeio','burro','estúpido'])) {
                try {
                    const _piada = await _obterPiadaInedita(_from);
                    return await _reply(`${_piada}\n\n😂 Brincadeiras à parte, a nossa internet é coisa séria! Digita *Menu* para conferir os pacotes.`, 'HUMOR (IA)');
                } catch(e) {
                    _0x1ca1fd('❌ Erro no fluxo de humor: ' + e.message, 'error');
                }
                return await _reply(`Sabe por que o computador foi preso? 💻\nPorque ele executou um programa! 😂\n\nBrincadeiras à parte, meus megas são coisa séria! Digita *Menu* para conferir.`, 'HUMOR');
            }

            // ELOGIOS
            if (_inc(['és bom','es bom','és ótimo','es otimo','boa resposta','excelente','és inteligente','es inteligente','és fixe','es fixe'])) {
                return await _reply(`Fico lisonjeado! 😊 Trabalho duro para ser o melhor assistente de Moçambique.\n\nQue tal aproveitar essa energia positiva e garantir seus megas agora?`, 'ELOGIO');
            }

            // --- ATENDIMENTO INTELIGENTE DE DETALHES DE PACOTES (Owner) ---
            if (_inc(['quero pacote', 'pacote de', 'quero o de', 'como funciona o pacote', 'me explica o de', 'me explica o pacote', 'como funciona o ilimitado', 'como funciona o faseado', 'como funciona a renovação'])) {
                try {
                    const search = _pesquisarPacotes(_texto);
                    if (search.resultados.length === 1) {
                        const explicacao = await _gerarExplicacaoPacote(search.resultados[0]);
                        return await _reply(explicacao, 'DETALHES DO PACOTE');
                    } else if (search.resultados.length > 1) {
                        if (!search.numeros.length && search.categoriaFiltro) {
                            const explicacao = _obterExplicacaoCategoria(search.categoriaFiltro);
                            return await _reply(explicacao, 'COMO FUNCIONA');
                        }
                        let msg = `Encontrei mais do que um pacote que corresponde à sua pesquisa: 🤔\n\n`;
                        search.resultados.slice(0, 6).forEach((p, idx) => {
                            msg += `${idx + 1}️⃣ *${p.nome}* — *${p.preco} MT*\n`;
                        });
                        msg += `\n💡 Para saber mais sobre um deles, digite por exemplo: *Como funciona o de ${search.resultados[0].preco}mt* ou faça o pagamento para o ativar!`;
                        return await _reply(msg, 'PACOTES ENCONTRADOS');
                    } else if (search.categoriaFiltro) {
                        const explicacao = _obterExplicacaoCategoria(search.categoriaFiltro);
                        return await _reply(explicacao, 'COMO FUNCIONA');
                    }
                } catch (err) {
                    _0x1ca1fd('❌ Erro no atendimento inteligente de pacotes: ' + err.message, 'error');
                }
            }

            // Tentar Gemini (IA Principal) — APENAS Owner
            try {
                const _geminiResult = await _enviarGemini(_texto, _from);
                if (_geminiResult.ok) {
                    _0x1ca1fd('✅ KaNet Jr (Gemini) respondeu para ' + _from, 'success');
                    return await _0x461461(_client, _from, _geminiResult.resposta, _msg.id);
                }
            } catch (e) {
                _0x1ca1fd('⚠️ Falha Gemini, tentando ChatGPT...', 'warning');
            }

            // Tentar ChatGPT (IA Secundária) — APENAS Owner
            try {
                const _chatgptResult = await _enviarChatGPT(_texto, _from);
                if (_chatgptResult.ok) {
                    _0x1ca1fd('✅ KaNet Jr (ChatGPT) respondeu para ' + _from, 'success');
                    return await _0x461461(_client, _from, _chatgptResult.resposta, _msg.id);
                }
            } catch (e) {
                _0x1ca1fd('⚠️ Todas as IAs falharam para ' + _from, 'error');
            }
        }

        // Fallback básico (Revendedores: sem IA / Owner: IA falhou)
        return await _reply(`Olá, *${_nomeCliente}*! 😊\n\nPosso ajudar com:\n\n📋 *Menu* — Ver pacotes e preços\n💳 *Pagamento* — Contas para pagar\n🎁 *Convite* — Ganhe bónus grátis\n🏆 *Fidelidade* — Veja o seu nível\n\nOu envie o *comprovativo M-Pesa* para comprar agora! ⚡`, 'AJUDA');
    }


    function _0x433465() {
        return licencaValida;
    }

    function _0x221164(_0x5ece9c) {
        // Bot opera em qualquer grupo ou privado — sem restrições
        return true;
    }
    async function _0x33581b(_0x498874, _0x4298f7) {
        const _0x34d96f = _0x4298f7['from'];
        const _0xSender = _0x4298f7['sender'] ? _0x4298f7['sender']['id'] : '';
        
        // --- PROPRIETÁRIO (Kelven): LIBERAR TODOS OS GRUPOS E COMANDOS EM QUALQUER LUGAR ---
        const _isOwnerLic = global.licencaObj && (
            (typeof global.licencaObj._isOwnerMode === 'function' && global.licencaObj._isOwnerMode()) ||
            (global.licencaObj.licenca && global.licencaObj.licenca._owner === true)
        );
        if (_isOwnerLic) return !![];
        
        // --- BLOQUEAR GRUPOS NÃO AUTORIZADOS (sistemas de revendedores e fornecedores) ---
        if (_0x34d96f && _0x34d96f.includes('@g.us')) {
            let _fornecJid = '';
            try {
                const _lc = JSON.parse(require('fs').readFileSync(require('path').join(global._kanetBase || __dirname, 'local_config.json'), 'utf8'));
                _fornecJid = (_lc.grupo_fornecimento || '').trim();
            } catch(e) {}

            const _numJid = (_0x34d96f || '').split('@')[0];
            const _numFornec = (_fornecJid || '').split('@')[0];
            const _autorizadoNaLicenca = global.licencaObj && global.licencaObj.isGrupoAutorizado ? global.licencaObj.isGrupoAutorizado(_0x34d96f) : false;
            const _isSysGrp = _isGrupoSistema(_0x34d96f);
            const _isFornecGrp = !!(_fornecJid && (_0x34d96f === _fornecJid || (_numJid && _numJid === _numFornec)));
            const _isGrpTab = !!(_DYN_CFG && _DYN_CFG.TABELAS_GRUPO && _DYN_CFG.TABELAS_GRUPO[_0x34d96f]);

            if ((_autorizadoNaLicenca || _isSysGrp || _isFornecGrp || _isGrpTab) && !_0x18020a.includes(_0x34d96f)) {
                _0x18020a.push(_0x34d96f);
                _salvarGrupos();
                if (global['_gruposNaoAutorizadosNotificados']) global['_gruposNaoAutorizadosNotificados'].delete(_0x34d96f);
                _0x1ca1fd('✅ Grupo autorizado/sistema sincronizado: ' + _0x34d96f, 'success');
            }

            const _bodyLower = (_0x4298f7['body'] || _0x4298f7['caption'] || '').toLowerCase().trim();
            const _isSaasAdminNum = (_s) => {
                if (!_s) return false;
                const clean = String(_s).replace(/\D/g, '');
                return clean.includes('856116039') || clean.includes('850401416');
            };
            const _isCmdAutorizar = (_checkIsMaster(_0xSender) || _isSaasAdminNum(_0xSender)) && (
                _bodyLower.startsWith('.autorizargrupo') || _bodyLower.startsWith('!autorizargrupo') ||
                _bodyLower.startsWith('.addgrupo') || _bodyLower.startsWith('!addgrupo') ||
                _bodyLower.startsWith('.autorizar') || _bodyLower.startsWith('!autorizar') ||
                _bodyLower.startsWith('.desautorizar') || _bodyLower.startsWith('!desautorizar') ||
                _bodyLower.startsWith('.desautorizargrupo') || _bodyLower.startsWith('!desautorizargrupo') ||
                _bodyLower.startsWith('.removergrupo') || _bodyLower.startsWith('!removergrupo') ||
                _bodyLower.startsWith('.aprovar') || _bodyLower.startsWith('!aprovar') ||
                _bodyLower.startsWith('.rejeitar') || _bodyLower.startsWith('!rejeitar')
            );

            if (!_0x18020a.includes(_0x34d96f) && !_isSysGrp && !_isFornecGrp && !_autorizadoNaLicenca && !_isGrpTab && !_isCmdAutorizar) {
                // Grupo não autorizado no sistema do revendedor/fornecedor — ignorar e bloquear interação
                if (!global['_gruposNaoAutorizadosNotificados']) global['_gruposNaoAutorizadosNotificados'] = new Set();
                if (!global['_gruposNaoAutorizadosNotificados'].has(_0x34d96f)) {
                    global['_gruposNaoAutorizadosNotificados'].add(_0x34d96f);
                    _0x1ca1fd('🚫 Grupo NÃO autorizado bloqueado: ' + _0x34d96f, 'warning');
                    try {
                        const _msgNaoAut = `🔒 *𝗣𝗥𝗢𝗧𝗘𝗖̧𝗔̃𝗢 𝗞𝗔-𝗡𝗘𝗧* 🔒\n━━━━━━━━━━━━━━━━━━━\n⚠️ *Este grupo ainda não está autorizado para este Bot.*\n\nPara ativar o bot neste grupo:\n👉 O número Administrador/Master deve enviar o comando: *.autorizar*\n\n🆔 *Grupo ID:* \`${_0x34d96f}\`\n━━━━━━━━━━━━━━━━━━━`;
                        _0x25f8ef.sendText(_0x34d96f, _msgNaoAut).catch(() => {});
                    } catch(eNotif) {}
                }
                return ![];
            }
        }
        
        // --- VERIFICAR LICENÇA ---
        if (!_0x433465()) {
            const statusLic = global.licencaObj && global.licencaObj.licenca ? global.licencaObj.licenca.status : 'desconhecido';
            let msgAviso = '⚠️ *SISTEMA SUSPENSO*\n━━━━━━━━━━━━━━━━━━━\nA licença deste bot de vendas está expirada ou inativa.\n\n';
            if (statusLic === 'bloqueado') {
                msgAviso += '⛔ O sistema foi bloqueado temporariamente pelo administrador.';
            } else {
                msgAviso += '⏰ A validade do serviço terminou. Para reativar, o proprietário deve efetuar o pagamento e enviar o comprovativo.';
            }
            msgAviso += '\n\n👉 Envie *!renovar [comprovativo]* para reativar o sistema.';
            await _0x461461(_0x498874, _0x34d96f, msgAviso, _0x4298f7['id']);
            return ![];
        }
        return !![];
    }
    const _0x1504fd = 'ef899e175352493cb04b799b2ee25975',
        _0x16875e = 'c8b59ceced5c4538a0eb03f46e4cd2e0',
        _0x2bd9ef = './referencias.db',
        _0xc025ef = './bot_log.txt',
        _0x1f3baf = 'KaNetKelven2026Secure',
        _0x23fc97 = '',
        _0xdda68c = 0x12c,
        _0x56fa8d = '12680154CD000297',
        _0x57353c = (() => { try { const _fs=require('fs'),_p=require('path'),_c=_p.join(global._kanetBase||__dirname,'bot_config.js'); if(_fs.existsSync(_c)){delete require.cache[require.resolve(_c)];const _b=require(_c);if(_b.GRUPO_ERROS)return _b.GRUPO_ERROS;} const _lc=_p.join(global._kanetBase||__dirname,'local_config.json'); if(_fs.existsSync(_lc)){const _j=JSON.parse(_fs.readFileSync(_lc,'utf8'));if(_j.grupo_erros)return _j.grupo_erros;} } catch(e){} return ''; })(),
        _0x40b822 = (() => { try { const _fs=require('fs'),_p=require('path'),_c=_p.join(global._kanetBase||__dirname,'bot_config.js'); if(_fs.existsSync(_c)){delete require.cache[require.resolve(_c)];const _b=require(_c);if(_b.GRUPO_NOTIFICACOES)return _b.GRUPO_NOTIFICACOES;} const _lc=_p.join(global._kanetBase||__dirname,'local_config.json'); if(_fs.existsSync(_lc)){const _j=JSON.parse(_fs.readFileSync(_lc,'utf8'));if(_j.grupo_notificacoes)return _j.grupo_notificacoes;} } catch(e){} return ''; })(),
        _0x3d41a5 = 'BOT_1',
        _0x538ae4 = [0x1f55, 0x1f56, 0x1f57, 0x1f58, 0x1f59, 0x1f5a, 0x1f5b, 0x1f5c, 0x1f5d, 0x1f5e, 0x1f5f, 0x1f60, 0x1f61, 0x1f62, 0x1f63, 0x2249],
        _0x31ff38 = 0x14,
        _0x888e43 = new Map(),
        _0x5b9308 = 0x493e0;
    
    // Inicialização da lista de banidos
    if (!global['numerosBanidos']) global['numerosBanidos'] = new Set();

    function _0x5da780(_0x544b37) {
        if (!_0x544b37) return ![];
        const _0x3b730b = _0x544b37['toUpperCase']();
        if (_0x888e43['has'](_0x3b730b)) {
            const _0xaaffde = _0x888e43['get'](_0x3b730b);
            if (Date['now']() - _0xaaffde < _0x5b9308) return !![];
            _0x888e43['delete'](_0x3b730b);
        }
        return ![];
    }

    function _0x1f44da(_0x203aab) {
        if (!_0x203aab) return;
        const _0x1f5252 = _0x203aab['toUpperCase']();
        _0x888e43['set'](_0x1f5252, Date['now']()), setTimeout(() => {
            _0x888e43['delete'](_0x1f5252);
        }, _0x5b9308);
    }
    setInterval(() => {
        const _0x2f7e2c = Date['now']();
        for (const [_0x2ce37a, _0x297467] of _0x888e43['entries']()) {
            _0x2f7e2c - _0x297467 > _0x5b9308 && _0x888e43['delete'](_0x2ce37a);
        }
    }, 0xea60);
    const _0x43e3f6 = {
        'verificacaoSaldo': ![],
        'transferencias': new Set(),
        'verificarSaldoBloqueado': ![]
    },
        _0x536ba5 = new Set(),
        _0x330084 = 0x7530;

    function _0x23e66() {
        return _0x43e3f6['verificacaoSaldo'] || _0x43e3f6['transferencias']['size'] > 0x0 || _0x43e3f6['verificarSaldoBloqueado'];
    }
    async function _0x51d99b(_0x16bc07 = 0x1d4c0) {
        const _0x3aed39 = Date['now']();
        return new Promise((_0x49cc88, _0x223589) => {
            const _0x1e2e48 = () => {
                if (!_0x23e66()) {
                    _0x49cc88(!![]);
                    return;
                }
                if (Date['now']() - _0x3aed39 > _0x16bc07) {
                    _0x1ca1fd('⏱️ Timeout aguardando processos ativos', 'warning');
                    _0x49cc88(![]);
                    return;
                }
                setTimeout(_0x1e2e48, 0x3e8);
            };
            setTimeout(_0x1e2e48, 0x3e8);
        });
    }
    let _0x13e11b = _DYN_CFG && _DYN_CFG.PORTAS && _DYN_CFG.PORTAS.length > 0 ? _DYN_CFG.PORTAS : [{
        'id': 0x1f55,
        'livre': !![],
        'nome': 'Porta\x208021',
        'online': ![],
        'ultimaVerificacao': null,
        'saldo_mb': 0x0
    }, {
        'id': 0x1f56,
        'livre': !![],
        'nome': 'Porta\x208022',
        'online': ![],
        'ultimaVerificacao': null,
        'saldo_mb': 0x0
    }, {
        'id': 0x1f57,
        'livre': !![],
        'nome': 'Porta\x208023',
        'online': ![],
        'ultimaVerificacao': null,
        'saldo_mb': 0x0
    }, {
        'id': 0x1f58,
        'livre': !![],
        'nome': 'Porta\x208024',
        'online': ![],
        'ultimaVerificacao': null,
        'saldo_mb': 0x0
    }, {
        'id': 0x1f59,
        'livre': !![],
        'nome': 'Porta\x208025',
        'online': ![],
        'ultimaVerificacao': null,
        'saldo_mb': 0x0
    }, {
        'id': 0x1f5a,
        'livre': !![],
        'nome': 'Porta\x208026',
        'online': ![],
        'ultimaVerificacao': null,
        'saldo_mb': 0x0
    }, {
        'id': 0x1f5b,
        'livre': !![],
        'nome': 'Porta\x208027',
        'online': ![],
        'ultimaVerificacao': null,
        'saldo_mb': 0x0
    }, {
        'id': 0x1f5c,
        'livre': !![],
        'nome': 'Porta\x208028',
        'online': ![],
        'ultimaVerificacao': null,
        'saldo_mb': 0x0
    }, {
        'id': 0x1f5d,
        'livre': !![],
        'nome': 'Porta\x208029',
        'online': ![],
        'ultimaVerificacao': null,
        'saldo_mb': 0x0
    }, {
        'id': 0x1f5e,
        'livre': !![],
        'nome': 'Porta\x208030',
        'online': ![],
        'ultimaVerificacao': null,
        'saldo_mb': 0x0
    }, {
        'id': 0x1f5f,
        'livre': !![],
        'nome': 'Porta\x208031',
        'online': ![],
        'ultimaVerificacao': null,
        'saldo_mb': 0x0
    }, {
        'id': 0x1f60,
        'livre': !![],
        'nome': 'Porta\x208032',
        'online': ![],
        'ultimaVerificacao': null,
        'saldo_mb': 0x0
    }, {
        'id': 0x1f61,
        'livre': !![],
        'nome': 'Porta\x208033',
        'online': ![],
        'ultimaVerificacao': null
    }, {
        'id': 0x1f62,
        'livre': !![],
        'nome': 'Porta\x208034',
        'online': ![],
        'ultimaVerificacao': null
    }, {
        'id': 0x1f63,
        'livre': !![],
        'nome': 'Porta\x208035',
        'online': ![],
        'ultimaVerificacao': null
    }, {
        'id': 0x2249,
        'livre': !![],
        'nome': 'Porta 8777 (Ilimitados/Mensais)',
        'online': ![],
        'ultimaVerificacao': null,
        'saldo_mb': 0x0,
        'sem_saldo': ![]
    }, {
        'id': 8077,
        'livre': !![],
        'nome': 'Porta 8077 (Ilimitados/Mensais)',
        'online': ![],
        'ultimaVerificacao': null,
        'saldo_mb': 0x0,
        'sem_saldo': ![]
    }];
    let _0x4ef91a = [];
    global.filaTransferencias = _0x4ef91a;
    let _isQueueProcessing = false;
    let _queueTimeoutId = null;

    const _MAX_RETRY_FILA = 10; // FIX: aumentado de 5 para 10 para tolerar falhas temporárias de porta
    const _retryTracker = new Map();
    // Tracker de falhas de saldo por porta (portaId -> número de falhas)
    const _semSaldoTracker = new Map();
    const _MAX_FALHAS_SALDO = 3; // Fechar porta após 3 falhas de saldo consecutivas

    // --- SISTEMA DE ISOLAMENTO RIGOROSO DE PORTAS (REVENDA vs FORNECIMENTO) ---
    const _isPedidoFornecimento = (itemOrRef, jidOverride = null) => {
        let ref = '';
        let jid = jidOverride || '';
        let isFornecFlag = false;
        let remetente = '';
        let origem = '';

        if (typeof itemOrRef === 'object' && itemOrRef !== null) {
            ref = itemOrRef.ref || itemOrRef.request_id || '';
            jid = itemOrRef.jid || jid;
            isFornecFlag = !!(itemOrRef.isFornecimento || itemOrRef._isFornecimento);
            remetente = itemOrRef.remetente || '';
            origem = itemOrRef.origem || '';
        } else if (typeof itemOrRef === 'string') {
            ref = itemOrRef;
        }

        if (isFornecFlag) return true;
        if (ref.startsWith('FORNEC-') || ref.startsWith('FORN-') || ref.startsWith('SALDO-')) return true;
        if (remetente === 'SISTEMA_FORNECIMENTO' || remetente === 'FORNECIMENTO') return true;
        if (origem === 'grupo_fornecimento' || origem === 'fornecimento') return true;

        try {
            const _fs = require('fs');
            const _path = require('path');
            const _cfgPath = _path.join(global._kanetBase || __dirname, 'local_config.json');
            if (_fs.existsSync(_cfgPath)) {
                const _cfg = JSON.parse(_fs.readFileSync(_cfgPath, 'utf8'));
                const gFornec = (_cfg.grupo_fornecimento || '').split('@')[0].trim();
                const itemJidNorm = (jid || '').split('@')[0].trim();
                if (gFornec && itemJidNorm && gFornec === itemJidNorm) return true;
            }
        } catch (e) {}

        return false;
    };

    const _obterPortasPermitidasParaPedido = (itemOrRef, jidOverride = null) => {
        const isFornec = _isPedidoFornecimento(itemOrRef, jidOverride);
        let allowedPorts = [];
        let bannedPorts = [];

        try {
            const _fs = require('fs');
            const _path = require('path');
            const _cfgPath = _path.join(global._kanetBase || __dirname, 'local_config.json');
            if (_fs.existsSync(_cfgPath)) {
                const _cfg = JSON.parse(_fs.readFileSync(_cfgPath, 'utf8'));
                const tNormais = (_cfg.telefones || []).map(t => parseInt(t.porta)).filter(p => !isNaN(p));
                const tFornec = (_cfg.telefones_fornecimento || []).map(t => parseInt(t.porta)).filter(p => !isNaN(p));

                if (isFornec) {
                    allowedPorts = tFornec;
                    bannedPorts = tNormais;
                } else {
                    allowedPorts = tNormais;
                    bannedPorts = tFornec;
                }
            }
        } catch (e) {}

        return { isFornec, allowedPorts, bannedPorts };
    };

    const filterPortForRequest = (port, itemOrRef, jidOverride = null) => {
        if (!port) return false;
        const portId = port.id || port.porta;
        const { isFornec, allowedPorts, bannedPorts } = _obterPortasPermitidasParaPedido(itemOrRef, jidOverride);

        let tipo = '';
        let portaObrigatoria = null;
        if (typeof itemOrRef === 'object' && itemOrRef !== null) {
            tipo = itemOrRef.tipo || itemOrRef.periodo || '';
            portaObrigatoria = itemOrRef.porta_obrigatoria;
        }

        // 1. REGRA RIGOROSA PARA PORTA OBRIGATÓRIA ESPECÍFICA (8777 / 8077):
        if (portaObrigatoria === 8777 || portaObrigatoria === 0x2249) {
            return portId === 8777 || portId === 0x2249;
        }
        if (portaObrigatoria === 8077) {
            return portId === 8077;
        }

        // 2. REGRA RIGOROSA PARA PEDIDOS DE SALDO (CRÉDITO EM METICAIS):
        if (tipo === 'saldo' || tipo === 'credito' || tipo === 'sms_saldo') {
            return portId === 8777 || portId === 8077 || portId === 0x2249;
        }

        // 3. REGRA RIGOROSA DE ISOLAMENTO (REVENDA vs FORNECIMENTO):
        // NUNCA permitir que porta do fornecimento processe pedido normal de revenda
        // NUNCA permitir que porta normal de revenda processe pedido do fornecimento
        if (bannedPorts.includes(portId)) return false;

        // Portas 8777 e 8077 são exclusivas de Saldo/Fornecimento e NUNCA aceitam pacotes normais de revenda
        if ((portId === 8777 || portId === 8077 || portId === 0x2249) && !isFornec) {
            return false;
        }

        if (allowedPorts.length > 0) {
            return allowedPorts.includes(portId);
        }

        return true;
    };

    function _0x149dcd(_0x26f432) {
        if (!_0x26f432) return;
        const _0x5c2ee7 = _0x26f432['ref'] || ('REF-' + Date['now']());

        // --- TRAVA ANTI-FILA-DUPLICADA ---
        if (_0x4ef91a.some(item => item.ref === _0x5c2ee7)) {
            _0x1ca1fd('⚠️ KaNet Guard: Ref ' + _0x5c2ee7 + ' já está na fila. Bloqueando duplicata.', 'warning');
            return;
        }
        // ---------------------------------

        // --- TRAVA ANTI-RETRY-INFINITO ---
        const _retryCount = (_retryTracker.get(_0x5c2ee7) || 0) + 1;
        _retryTracker.set(_0x5c2ee7, _retryCount);
        if (_retryCount > _MAX_RETRY_FILA) {
            _0x1ca1fd('\u{1F6D1} LIMITE DE RETRY ATINGIDO (' + _retryCount + '/' + _MAX_RETRY_FILA + '): ref=' + _0x5c2ee7 + '. Removendo da fila.', 'error');
            _0x2372f4('\u{1F6D1} Pacote REMOVIDO da fila (limite de retry)\n\u{1F4CB} Ref: ' + _0x5c2ee7 + '\n\u{1F4DE} N\u00famero: ' + (_0x26f432['numero'] || 'N/A') + '\n\u{1F504} Tentativas: ' + _retryCount + '\n\u274C Motivo: Excedeu o limite de ' + _MAX_RETRY_FILA + ' tentativas');
            _0x2c5e52("UPDATE referencias SET status='erro_max_retry' WHERE ref=?", [_0x5c2ee7]);
            _retryTracker.delete(_0x5c2ee7);
            return;
        }
        // ---------------------------------

        const _0x1c27f3 = {
            ..._0x26f432,
            'ref': _0x5c2ee7,
            'status': _0x26f432['status'] || 'na_fila',
            'tentativas': _0x26f432['tentativas'] || 0x1,
            'timestamp': _0x26f432['timestamp'] || Date['now'](),
            'prioridade': _0x26f432['prioridade'] || 0x1
        };
        _0x4ef91a['push'](_0x1c27f3);
        _0x4ef91a['sort']((_0x48e33d, _0xb8d224) => (_0xb8d224['prioridade'] || 0x0) - (_0x48e33d['prioridade'] || 0x0));
        const _0x18dd97 = _0x1c27f3['tipo'] === 'ilimitado' ? '♾️ ILIMITADO' : _0x1c27f3['tipo'] === 'mensal' ? '📅 MENSAL' : _0x1c27f3['tipo'] === 'semanal' ? '📅 SEMANAL' : '⏳ 24 HORAS';
        _0x1ca1fd('📥 Item adicionado à fila: ref=' + _0x5c2ee7 + ', numero=' + _0x1c27f3['numero'] + ', tipo=' + _0x18dd97 + ', tentativas=' + _0x1c27f3['tentativas'] + ', fila_tamanho=' + _0x4ef91a['length'], 'queue');
        // Notificar painel em tempo real
        if (typeof global._broadcastFilaUpdate === 'function') global._broadcastFilaUpdate();
        _0x5044bc();
    }


    // =====================================================
    // HELPER: Colocar item na fila SEM incrementar retryTracker
    // Usado quando a porta 8777 está offline — aguarda sem gastar tentativas
    // =====================================================
    function _enqueueOfflineWait(_item, _delayMs) {
        if (!_item || !_item.ref) return;
        const _delayFinal = _delayMs || 20000;
        setTimeout(() => {
            // Verifica se o item já está na fila para evitar duplicatas
            if (_0x4ef91a.some(_x => _x.ref === _item.ref)) {
                _0x1ca1fd('⚠️ [OfflineWait] Ref ' + _item.ref + ' já está na fila. Ignorando duplicata.', 'warning');
                _0x5044bc();
                return;
            }
            // Verificar se foi cancelado enquanto esperava
            _0x3c2652('SELECT status FROM referencias WHERE ref=?', [_item.ref]).then(_rows => {
                if (_rows && _rows.length > 0 && _rows[0].status === 'cancelado') {
                    _0x1ca1fd('🚫 [OfflineWait] Pedido cancelado — não recolocar na fila: ref=' + _item.ref, 'warning');
                    return;
                }
                // Atualiza o banco para 'na_fila' para que possa ser processado novamente
                _0x2c5e52("UPDATE referencias SET status='na_fila' WHERE ref=?", [_item.ref]).catch(err => {
                    _0x1ca1fd('⚠️ Erro ao atualizar status para na_fila no DB: ' + err.message, 'warning');
                });

                const _qItem = {
                    ..._item,
                    'status': 'na_fila',
                    'tentativas': _item.tentativas || 1,
                    'timestamp': _item.timestamp || Date.now(),
                    'prioridade': _item.prioridade || 15
                };
                _0x4ef91a.push(_qItem);
                _0x4ef91a.sort((_a, _b) => (_b.prioridade || 0) - (_a.prioridade || 0));
                _0x1ca1fd('⏳ [OfflineWait] Item recolocado na fila (SEM gastar retry): ref=' + _item.ref + ', tipo=' + _item.tipo + ', fila=' + _0x4ef91a.length, 'queue');
                _0x5044bc();
            }).catch(() => {
                // Se não conseguiu verificar, recoloca para não perder o pedido
                _0x2c5e52("UPDATE referencias SET status='na_fila' WHERE ref=?", [_item.ref]).catch(() => {});
                const _qItem = { ..._item, 'status': 'na_fila', 'tentativas': _item.tentativas || 1, 'timestamp': _item.timestamp || Date.now(), 'prioridade': _item.prioridade || 15 };
                _0x4ef91a.push(_qItem);
                _0x5044bc();
            });
        }, _delayFinal);
    }


    const _0x2b714a = new Set(),
        _0x557233 = new _0x4ad789(),
        _0x9ae02b = new Set();
    let _0x5b3974 = new Map();
    const _0x1d9355 = 0x2710;
    let _0x449b1a = -0x1;
    const _0x3899c3 = new Set(),
        _0x843ce5 = new Set(),
        _0x139d0c = new Map(),
        _0x250ac9 = 0x1388;
    async function _0x461461(_0x2b1058, _0xcb69c9, _0x38a430, _0x2f7b29 = null) {
        _0x38a430 = _premiumFormatter(_0x38a430);
        try {
            if (typeof _0xcb69c9 === 'string') {
                if (!_0xcb69c9.includes('@')) {
                    _0xcb69c9 = _0xcb69c9 + '@c.us';
                }
            }
            const _0x493bad = async () => {
                try {
                    _0x2f7b29 ? await _0x2b1058['reply'](_0xcb69c9, _0x38a430, _0x2f7b29) : await _0x2b1058['sendText'](_0xcb69c9, _0x38a430);
                } catch (_0x1c6df5) {
                    !_0x1c6df5['message']['includes']('Message\x20already\x20sent') && console['log']('📤\x20Erro\x20envio:\x20' + _0x1c6df5['message']['substring'](0x0, 0x32));
                }
            };
            _0x493bad();
        } catch (_0x4b4721) {
            console['log']('⚠️\x20Erro\x20rápido:\x20' + _0x4b4721['message']['substring'](0x0, 0x1e));
        }
    }
    async function _0x423469(_0x49c269, _0x27454d, _0x424eef) {
        try {
            if (typeof _0x27454d === 'string' && !_0x27454d.includes('@')) {
                _0x27454d = _0x27454d + '@c.us';
            }
            _0x49c269['sendText'](_0x27454d, _0x424eef)['catch'](() => { });
        } catch (_0x4a208d) { }
    }
    function _resolveGrupoConfig(keyConfig, keyFornec, defaultVal, isFornec = false) {
        try {
            const _fs = require('fs'), _p = require('path');
            const _lc = _p.join(global._kanetBase || __dirname, 'local_config.json');
            if (_fs.existsSync(_lc)) {
                const _j = JSON.parse(_fs.readFileSync(_lc, 'utf8'));
                if (isFornec && keyFornec && _j[keyFornec]) return _j[keyFornec].trim();
                if (isFornec && _j.grupo_fornecimento) return _j.grupo_fornecimento.trim();
                if (_j[keyConfig]) return _j[keyConfig].trim();
            }
        } catch(e) {}
        return defaultVal || '';
    }

    async function _0x2372f4(_0x93fc0d, _0x41a684 = 'info', _isFornecCtx = false) {
        try {
            const _activeClient = _isFornecCtx ? (global['clientFornecimento'] || global['client']) : (global['client'] || global['clientFornecimento']);
            if (!_activeClient || typeof _activeClient['sendText'] !== 'function') {
                _0x1ca1fd('❌ Cliente WhatsApp não disponível para enviar notificação', 'error');
                return;
            }
            const _targetNotifGroup = _resolveGrupoConfig('grupo_notificacoes', 'grupo_notificacoes_fornecimento', _0x40b822, _isFornecCtx);
            try {
                if (_0x23fc97) await _activeClient['sendText'](_0x23fc97, _0x93fc0d), _0x1ca1fd('🔔 Notificação enviada ao admin: ' + _0x93fc0d['substring'](0x0, 0x64) + '...', _0x41a684);
            } catch (_0x2d0326) {
                console['log']('🔔 [SIMULAÇÃO] Notificação para admin: ' + _0x93fc0d['substring'](0x0, 0x64) + '...');
            }
            try {
                if (_targetNotifGroup) await _activeClient['sendText'](_targetNotifGroup, _0x93fc0d), _0x1ca1fd(`🔔 Notificação [${_isFornecCtx ? 'FORNECIMENTO' : 'NORMAL'}] enviada ao grupo: ` + _0x93fc0d['substring'](0x0, 0x64) + '...', _0x41a684);
            } catch (_0x2f85e8) {
                console['log']('🔔 [SIMULAÇÃO] Notificação para grupo: ' + _0x93fc0d['substring'](0x0, 0x64) + '...');
            }
        } catch (_0x1e3dd3) {
            _0x1ca1fd('❌ Erro ao enviar notificação dupla: ' + _0x1e3dd3['message'], 'error');
        }
    }

    async function _0x5a1f53(_0x48a4bd, _0x4fd6c3, _0x45e54f, _0x20b527, _0x1a6456 = 'normal', _0x2ff482 = ![], _0x574113 = null, _isFornecCtx = false) {
        try {
            const _isFornecErr = _isFornecCtx || _0x1a6456 === 'saldo' || (_0x20b527 && (_0x20b527.id === 8777 || _0x20b527.porta === 8777));
            const _activeClient = _isFornecErr ? (global['clientFornecimento'] || global['client']) : (global['client'] || global['clientFornecimento']);
            const _targetErroGroup = _resolveGrupoConfig('grupo_erros', 'grupo_erros_fornecimento', _0x57353c, _isFornecErr);

            if (!_activeClient || typeof _activeClient['sendText'] !== 'function') {
                _0x1ca1fd('❌ Cliente WhatsApp não disponível para enviar erro ao grupo', 'error');
                return;
            }
            const _0x29f376 = new Date()['toLocaleString']('pt-PT', {
                'day': '2-digit',
                'month': '2-digit',
                'year': 'numeric',
                'hour': '2-digit',
                'minute': '2-digit',
                'hour12': ![]
            });
            let _0x2306ba = (_0x45e54f['toLowerCase']()['includes']('fetch\x20failed') || _0x45e54f['toLowerCase']()['includes']('fetch failed')) ? 'Instabilidade no terminal/servidor (FastAPI offline)' : _0x45e54f;
            const _0x51c4e3 = _0x2ff482 ? '🔄 SERÁ FEITO RETRY automático' : '⚠️ NÃO será feito RETRY automático',
                _0x18dd97 = _0x1a6456 === 'saldo' ? '💰 SALDO / FORNECIMENTO' : _0x1a6456 === 'ilimitado' ? '♾️ ILIMITADO' : _0x1a6456 === 'ilimitado_com_extra' ? '♾️+ ILIMITADO COM EXTRAS' : _0x1a6456 === 'mensal' ? '📅 MENSAL' : _0x1a6456 === '24hrs' ? '⏳ 24 HORAS' : _0x1a6456 === 'semanal' ? '📅 SEMANAL' : '📦 NORMAL',
                _0x4066d = `🚨 *ERRO DETECTADO [${_isFornecErr ? 'FORNECIMENTO' : 'NORMAL'}]* 🚨\n━━━━━━━━━━━━━━━━━━\n📋 *Referência:* ` + _0x48a4bd + '\n📞 *Número:* ' + _0x4fd6c3 + '\n📊 *Tipo:* ' + _0x18dd97 + '\n🔌 *Porta:* ' + ((_0x20b527 && (_0x20b527['nome'] || _0x20b527['id'] || _0x20b527)) || '8077') + '\n' + (_0x574113 !== null ? '🔢 *Input Val:* ' + _0x574113 + '\n' : '') + '\n🕒 *Data/Hora:* ' + _0x29f376 + '\n❌ *Erro:* ' + _0x2306ba + '\n━━━━━━━━━━━━━━━━━━\n' + _0x51c4e3 + '\n📝 *Status:* ' + (_0x2ff482 ? 'Tentando outra porta...' : 'Aguardando intervenção manual'),
                _0x291e39 = '@2588@c.us ' + _0x4066d;
            
            if (_targetErroGroup) {
                await _activeClient['sendText'](_targetErroGroup, _0x291e39);
                _0x1ca1fd(`📨 Erro [${_isFornecErr ? 'FORNECIMENTO' : 'NORMAL'}] enviado para o grupo: ` + _0x2306ba + ' (Retry: ' + _0x2ff482 + ')', 'error');
            }
            await _0x2372f4(_0x4066d, 'error', _isFornecErr);
        } catch (_0x14d719) {
            _0x1ca1fd('❌ Erro ao enviar mensagem de erro para o grupo: ' + _0x14d719['message'], 'error');
        }
    }

    function _0x3ddcbe(_0x128f23) {
        const _0x28267b = _0x128f23['toLowerCase'](),
            _0x24869e = _0x28267b['replace']('fetch\x20failed', 'instabilidade\x20no\x20terminal'),
            _0x1d9c97 = ['limite\x20diário', 'limite\x20diario', 'daily\x20limit', 'saldo\x20insuficiente', 'insufficient\x20balance', 'número\x20inválido', 'numero\x20invalido', 'invalid\x20number', 'fora\x20de\x20cobertura', 'out\x20of\x20coverage', 'cartão\x20bloqueado', 'sim\x20bloqueado', 'bloqueado\x20permanentemente', 'erro\x20de\x20rede', 'network\x20error', 'telefone\x20atingiu\x20limite', 'aborterror', 'abort\x20error', 'timeout', 'timed\x20out'];
        return _0x1d9c97['some'](_0x1f4355 => _0x24869e['includes'](_0x1f4355));
    }
    const _0x422180 = new Set();

    function _0x2386a7(_0x39745d) {
        if (!_0x39745d) return null;
        const _0x4cbdcd = _0x39745d['toUpperCase'](),
            _0x40c585 = _0x4cbdcd['includes']('.') || _0x4cbdcd['match'](/PP\d+/) || _0x4cbdcd['match'](/\d{6}\.\d{4}/) || _0x4cbdcd['includes']('.M') || _0x4cbdcd['length'] > 0xf && _0x4cbdcd['match'](/[A-Z]{2}\d+/),
            _0xf0a309 = _0x4cbdcd['match'](/^[A-Z0-9]{8,12}$/) && !_0x4cbdcd['includes']('.') && !_0x4cbdcd['includes']('\x20');
        if (_0x40c585) return {
            'operadora': 'movitel',
            'slot': '2'
        };
        else {
            if (_0xf0a309) return {
                'operadora': 'vodacom',
                'slot': '1'
            };
        }
        return _0x4cbdcd['length'] > 0xf || _0x4cbdcd['includes']('.') ? {
            'operadora': 'movitel',
            'slot': '2'
        } : {
            'operadora': 'vodacom',
            'slot': '1'
        };
    }
    let _0x9a616a = {
        0x1c2: {
            'nome': '\ud83d\udc8e\x2011GB\x20+\x20Chamadas\x20Ilimitadas\x20(Vodacom)',
            'tipo': 'ilimitado',
            'periodo': '30\x20dias',
            'input_val': 0x1,
            'porta_obrigatoria': 0x2249,
            'permite_retry': ![],
            'ativacao_mb': 11264,
            'extras': 0x0,
            'quantidade_mb': 11264
        },
        0x23a: {
            'nome': '\ud83d\udc8e\x2015GB\x20+\x20Chamadas\x20Ilimitadas\x20(Vodacom)',
            'tipo': 'ilimitado',
            'periodo': '30\x20dias',
            'input_val': 0x1,
            'porta_obrigatoria': 0x2249,
            'permite_retry': ![],
            'ativacao_mb': 15360,
            'extras': 0x0,
            'quantidade_mb': 15360
        },
        0x352: {
            'nome': '\ud83d\udc8e\x2025GB\x20+\x20Chamadas\x20Ilimitadas\x20(Vodacom)',
            'tipo': 'ilimitado',
            'periodo': '30\x20dias',
            'input_val': 0x1,
            'porta_obrigatoria': 0x2249,
            'permite_retry': ![],
            'ativacao_mb': 25600,
            'extras': 0x0,
            'quantidade_mb': 25600
        },
        0x1d5: {
            'nome': '\ud83d\udc8e\x209GB\x20+\x20Chamadas\x20Ilimitadas\x20(Movitel)',
            'tipo': 'ilimitado',
            'periodo': '30\x20dias',
            'input_val': 0x1,
            'porta_obrigatoria': 0x2249,
            'permite_retry': ![],
            'ativacao_mb': 9216,
            'extras': 0x0,
            'quantidade_mb': 9216
        },
        0x3b6: {
            'nome': '\ud83d\udc8e\x2023GB\x20+\x20Chamadas\x20Ilimitadas\x20(Movitel)',
            'tipo': 'ilimitado',
            'periodo': '30\x20dias',
            'input_val': 0x1,
            'porta_obrigatoria': 0x2249,
            'permite_retry': ![],
            'ativacao_mb': 23552,
            'extras': 0x0,
            'quantidade_mb': 23552
        },
        0x5aa: {
            'nome': '\ud83d\udc8e\x2038GB\x20+\x20Chamadas\x20Ilimitadas\x20(Movitel)',
            'tipo': 'ilimitado',
            'periodo': '30\x20dias',
            'input_val': 0x1,
            'porta_obrigatoria': 0x2249,
            'permite_retry': ![],
            'ativacao_mb': 38912,
            'extras': 0x0,
            'quantidade_mb': 38912
        }
    };
    let _0x17ff51 = _DYN_CFG ? _DYN_CFG.TABELAS['mensal'] : {
            0x5f: {
                'nome': '2.8GB Mensal',
                'tipo': 'mensal',
                'periodo': '30\x20dias',
                'input_val': 0x1,
                'porta_obrigatoria': 0x2249,
                'permite_retry': ![],
                'quantidade_mb': 2867
            },
            0xaa: {
                'nome': '5GB Mensal',
                'tipo': 'mensal',
                'periodo': '30\x20dias',
                'input_val': 0x1,
                'porta_obrigatoria': 0x2249,
                'permite_retry': ![],
                'quantidade_mb': 5120
            },
            0xfa: {
                'nome': '8GB Mensal',
                'tipo': 'mensal',
                'periodo': '30\x20dias',
                'input_val': 0x1,
                'porta_obrigatoria': 0x2249,
                'permite_retry': ![],
                'quantidade_mb': 8192
            },
            0x11d: {
                'nome': '10GB Mensal',
                'tipo': 'mensal',
                'periodo': '30\x20dias',
                'input_val': 0x1,
                'porta_obrigatoria': 0x2249,
                'permite_retry': ![],
                'quantidade_mb': 10240
            },
            0x186: {
                'nome': '13GB Mensal',
                'tipo': 'mensal',
                'periodo': '30\x20dias',
                'input_val': 0x1,
                'porta_obrigatoria': 0x2249,
                'permite_retry': ![],
                'quantidade_mb': 13312
            },
            0x226: {
                'nome': '15GB Mensal',
                'tipo': 'mensal',
                'periodo': '30\x20dias',
                'input_val': 0x1,
                'porta_obrigatoria': 0x2249,
                'permite_retry': ![],
                'quantidade_mb': 15360
            },
            0x249: {
                'nome': '20GB Mensal',
                'tipo': 'mensal',
                'periodo': '30\x20dias',
                'input_val': 0x1,
                'porta_obrigatoria': 0x2249,
                'permite_retry': ![],
                'quantidade_mb': 20480
            },
            0x320: {
                'nome': '25GB Mensal',
                'tipo': 'mensal',
                'periodo': '30\x20dias',
                'input_val': 0x1,
                'porta_obrigatoria': 0x2249,
                'permite_retry': ![],
                'quantidade_mb': 25600
            },
            0x37a: {
                'nome': '30GB Mensal',
                'tipo': 'mensal',
                'periodo': '30\x20dias',
                'input_val': 0x1,
                'porta_obrigatoria': 0x2249,
                'permite_retry': ![],
                'quantidade_mb': 30720
            },
            0x5aa: {
                'nome': '51GB Mensal',
                'tipo': 'mensal',
                'periodo': '30\x20dias',
                'input_val': 0x1,
                'porta_obrigatoria': 0x2249,
                'permite_retry': ![],
                'quantidade_mb': 52224
            },
            0xb4a: {
                'nome': '102GB Mensal',
                'tipo': 'mensal',
                'periodo': '30\x20dias',
                'input_val': 0x1,
                'porta_obrigatoria': 0x2249,
                'permite_retry': ![],
                'quantidade_mb': 104448
            }
    };
    let _0x29d1af = _DYN_CFG ? _DYN_CFG.TABELAS['24hrs'] : {
        0xa: {
            'quantidade_mb': 350,
            'nome': '350MB\x2024\x20Horas',
            'periodo': '24\x20horas'
        },
        0xe: {
            'quantidade_mb': 550,
            'nome': '550MB\x2024\x20Horas',
            'periodo': '24\x20horas'
        },
        0x11: {
            'quantidade_mb': 696,
            'nome': '696MB\x2024\x20Horas',
            'periodo': '24\x20horas'
        },
        0x12: {
            'quantidade_mb': 800,
            'nome': '800MB\x2024\x20Horas',
            'periodo': '24\x20horas'
        },
        0x16: {
            'quantidade_mb': 1024,
            'nome': '1GB\x2024\x20Horas',
            'periodo': '24\x20horas'
        },
        0x1b: {
            'quantidade_mb': 1229,
            'nome': '1.2GB\x2024\x20Horas',
            'periodo': '24\x20horas'
        },
        0x1d: {
            'quantidade_mb': 1331,
            'nome': '1.3GB\x2024\x20Horas',
            'periodo': '24\x20horas'
        },
        0x24: {
            'quantidade_mb': 1638,
            'nome': '1.6GB\x2024\x20Horas',
            'periodo': '24\x20horas'
        },
        0x2c: {
            'quantidade_mb': 2048,
            'nome': '2GB\x2024\x20Horas',
            'periodo': '24\x20horas'
        },
        0x42: {
            'quantidade_mb': 3072,
            'nome': '3GB\x2024\x20Horas',
            'periodo': '24\x20horas'
        },
        0x58: {
            'quantidade_mb': 4096,
            'nome': '4GB\x2024\x20Horas',
            'periodo': '24\x20horas'
        },
        0x6e: {
            'quantidade_mb': 5120,
            'nome': '5GB\x2024\x20Horas',
            'periodo': '24\x20horas'
        },
        0x84: {
            'quantidade_mb': 6144,
            'nome': '6GB\x2024\x20Horas',
            'periodo': '24\x20horas'
        },
        0x9a: {
            'quantidade_mb': 7168,
            'nome': '7GB\x2024\x20Horas',
            'periodo': '24\x20horas'
        },
        0xb0: {
            'quantidade_mb': 8192,
            'nome': '8GB\x2024\x20Horas',
            'periodo': '24\x20horas'
        },
        0xc6: {
            'quantidade_mb': 9216,
            'nome': '9GB\x2024\x20Horas',
            'periodo': '24\x20horas'
        },
        0xdc: {
            'quantidade_mb': 10240,
            'nome': '10GB\x2024\x20Horas',
            'periodo': '24\x20horas'
        }
    };

        // --- PROMOÇÃO DINÂMICA (12H) ---
        // Expira em: 16/05/2026 07:00 AM (Timestamp: 1778918400000)
        if (Date.now() < 1778918400000) {
            _0x29d1af = {
                0x8: { 'quantidade_mb': 350, 'nome': '350MB 24h', 'periodo': '24 horas' },
                0xd: { 'quantidade_mb': 550, 'nome': '550MB 24h', 'periodo': '24 horas' },
                0x10: { 'quantidade_mb': 696, 'nome': '696MB 24h', 'periodo': '24 horas' },
                0x13: { 'quantidade_mb': 800, 'nome': '800MB 24h', 'periodo': '24 horas' },
                0x18: { 'quantidade_mb': 1024, 'nome': '1GB 24h', 'periodo': '24 horas' },
                0x30: { 'quantidade_mb': 2048, 'nome': '2GB 24h', 'periodo': '24 horas' },
                0x48: { 'quantidade_mb': 3072, 'nome': '3GB 24h', 'periodo': '24 horas' },
                0x60: { 'quantidade_mb': 4096, 'nome': '4GB 24h', 'periodo': '24 horas' },
                0x78: { 'quantidade_mb': 5120, 'nome': '5GB 24h', 'periodo': '24 horas' },
                0x90: { 'quantidade_mb': 6144, 'nome': '6GB 24h', 'periodo': '24 horas' },
                0xa8: { 'quantidade_mb': 7168, 'nome': '7GB 24h', 'periodo': '24 horas' },
                0xc0: { 'quantidade_mb': 8192, 'nome': '8GB 24h', 'periodo': '24 horas' },
                0xd8: { 'quantidade_mb': 9216, 'nome': '9GB 24h', 'periodo': '24 horas' },
                0xf0: { 'quantidade_mb': 10240, 'nome': '10GB 24h', 'periodo': '24 horas' }
            };
        }
    
    let _0x39a69d = _DYN_CFG ? _DYN_CFG.TABELAS['semanal'] : {

            0x2f: {
                'nome': '1.7GB\x207\x20Dias',
                'tipo': 'semanal',
                'periodo': '7\x20dias',
                'input_val': 0x2,
                'porta_obrigatoria': 0x2249,
                'permite_retry': ![],
                'quantidade_mb': 1741
            },
            0x50: {
                'nome': '2.9GB\x207\x20Dias',
                'tipo': 'semanal',
                'periodo': '7\x20dias',
                'input_val': 0x3,
                'porta_obrigatoria': 0x2249,
                'permite_retry': ![],
                'quantidade_mb': 2970
            },
            0x5a: {
                'nome': '3.4GB\x207\x20Dias',
                'tipo': 'semanal',
                'periodo': '7\x20dias',
                'input_val': 0x4,
                'porta_obrigatoria': 0x2249,
                'permite_retry': ![],
                'quantidade_mb': 3482
            },
            0x8c: {
                'nome': '5.3GB\x207\x20Dias',
                'tipo': 'semanal',
                'periodo': '7\x20dias',
                'input_val': 0x5,
                'porta_obrigatoria': 0x2249,
                'permite_retry': ![],
                'quantidade_mb': 5427
            },
            0xbe: {
                'nome': '7.2GB\x207\x20Dias',
                'tipo': 'semanal',
                'periodo': '7\x20dias',
                'input_val': 0x6,
                'porta_obrigatoria': 0x2249,
                'permite_retry': ![],
                'quantidade_mb': 7373
            },
            0x122: {
                'nome': '10.7GB\x207\x20Dias',
                'tipo': 'semanal',
                'periodo': '7\x20dias',
                'input_val': 0x7,
                'porta_obrigatoria': 0x2249,
                'permite_retry': ![],
                'quantidade_mb': 10957
            },
            0x17c: {
                'nome': '14.1GB\x207\x20Dias',
                'tipo': 'semanal',
                'periodo': '7\x20dias',
                'input_val': 0x8,
                'porta_obrigatoria': 0x2249,
                'permite_retry': ![],
                'quantidade_mb': 14438
            },
            0x1d6: {
                'nome': '17.6GB\x207\x20Dias',
                'tipo': 'semanal',
                'periodo': '7\x20dias',
                'input_val': 0x9,
                'porta_obrigatoria': 0x2249,
                'permite_retry': ![],
                'quantidade_mb': 18022
            }
    };
        // Tabela de diários: lê SEMPRE do bot_config.js em tempo real (nunca fixa no código)
        let _0x48e9aa = (() => {
            try {
                const _cfgLive = _DYN_CFG && _DYN_CFG.TABELAS && _DYN_CFG.TABELAS['24hrs']
                    ? _DYN_CFG.TABELAS['24hrs']
                    : (() => {
                        try {
                            const _cfgPath = require('path').join(global._kanetBase || __dirname, 'bot_config.js');
                            delete require.cache[require.resolve(_cfgPath)];
                            return require(_cfgPath).TABELAS['24hrs'] || {};
                        } catch(_e) { return {}; }
                    })();
                return _cfgLive;
            } catch(_e2) { return {}; }
        })();
    // Grupo estudantes usa a tabela de estudantes do bot_config.js se existir
    let _0x48e9aa_estudantes = (_DYN_CFG && _DYN_CFG.TABELAS && _DYN_CFG.TABELAS['estudantes']) || {};
    let _0x7d9007 = _0x48e9aa_estudantes;

    function _0x31d398(_0x47bc09) {
        if (!_0x47bc09) return 'desconhecido';
        const _0x31b814 = _0x47bc09['match'](/(\d+)@g\.us/);
        if (_0x31b814 && _0x31b814[0x1]) return _0x31b814[0x1];
        return _0x47bc09['split']('@')[0x0] || 'desconhecido';
    }
    const _0x3676ca = {};

    function _0x213394(_0x4c576c) {
        const _0x411e64 = parseInt(_0x4c576c);
        if (isNaN(_0x411e64)) return null;

        // --- DETECÇÃO DE PLANOS ESPECIAIS (RENOVAÇÃO / FASEADO) ---
        if (_DYN_CFG && _DYN_CFG.PLANOS_ESPECIAIS && _DYN_CFG.PLANOS_ESPECIAIS[_0x411e64]) {
            const specPlan = _DYN_CFG.PLANOS_ESPECIAIS[_0x411e64];
            return {
                'quantidade': specPlan.total,
                'tipo': specPlan.tipo,
                'descricao': specPlan.nome,
                'periodo': 'assinatura',
                'input_val': null,
                'porta_obrigatoria': null,
                'permite_retry': false,
                'origem': 'especial'
            };
        }

        // --- SMS: usar tabelas dinâmicas (atualizadas em tempo real via .addtabela) ---
        const _sms24hrs = (_DYN_CFG && _DYN_CFG.TABELAS && _DYN_CFG.TABELAS['24hrs']) || _0x29d1af;
        const _smsIlimitado = (_DYN_CFG && _DYN_CFG.TABELAS && _DYN_CFG.TABELAS['ilimitado']) || _0x9a616a;
        const _smsMensal = (_DYN_CFG && _DYN_CFG.TABELAS && _DYN_CFG.TABELAS['mensal']) || _0x17ff51;
        const _smsSemanal = (_DYN_CFG && _DYN_CFG.TABELAS && _DYN_CFG.TABELAS['semanal']) || _0x39a69d;
        const _smsSaldo = (_DYN_CFG && _DYN_CFG.TABELAS && _DYN_CFG.TABELAS['saldo']) || {};

        console['log']('📱\x20[SMS]\x20Buscando\x20' + _0x411e64 + 'MT\x20em\x20PACOTES_24HRS...');
        if (_sms24hrs && _sms24hrs[_0x411e64]) {
            const _0x130730 = _sms24hrs[_0x411e64];
            console['log']('✅\x20[SMS]\x20' + _0x411e64 + 'MT\x20→\x20' + _0x130730['nome'] + '\x20(' + _0x130730['quantidade_mb'] + 'MB\x20FIXO)');
            if (!_0x130730['quantidade_mb']) return console['log']('❌\x20[SMS]\x20' + _0x411e64 + 'MT\x20não\x20tem\x20\x27quantidade_mb\x27\x20definida'), null;
            return {
                'quantidade': _0x130730['quantidade_mb'],
                'tipo': '24hrs',
                'descricao': _0x130730['nome'],
                'periodo': _0x130730['periodo'],
                'input_val': null,
                'porta_obrigatoria': null,
                'permite_retry': !![],
                'origem': 'sms_24hrs_fixo'
            };
        }
        if (_smsIlimitado && _smsIlimitado[_0x411e64]) {
            const _0x861391 = _smsIlimitado[_0x411e64];
            console['log']('✅\x20[SMS]\x20' + _0x411e64 + 'MT\x20→\x20' + _0x861391['nome'] + '\x20(' + _0x861391['ativacao_mb'] + 'MB\x20FIXO)');
            if (!_0x861391['ativacao_mb']) return console['log']('❌\x20[SMS]\x20' + _0x411e64 + 'MT\x20não\x20tem\x20\x27ativacao_mb\x27\x20definida'), null;
            return {
                'quantidade': _0x861391['ativacao_mb'],
                'tipo': _0x861391['tipo'],
                'descricao': _0x861391['nome'],
                'periodo': _0x861391['periodo'],
                'input_val': _0x861391['input_val'],
                'porta_obrigatoria': _0x861391['porta_obrigatoria'],
                'permite_retry': _0x861391['permite_retry'] !== undefined ? _0x861391['permite_retry'] : !![],
                'extras': _0x861391['extras'] || 0x0,
                'origem': 'sms_ilimitados_fixo'
            };
        }
        if (_smsMensal && _smsMensal[_0x411e64]) {
            const _0x1d4bfa = _smsMensal[_0x411e64];
            console['log']('✅\x20[SMS]\x20' + _0x411e64 + 'MT\x20→\x20' + _0x1d4bfa['nome'] + '\x20(' + _0x1d4bfa['quantidade_mb'] + 'MB\x20FIXO)');
            if (!_0x1d4bfa['quantidade_mb']) return console['log']('❌\x20[SMS]\x20' + _0x411e64 + 'MT\x20não\x20tem\x20\x27quantidade_mb\x27\x20definida'), null;
            return {
                'quantidade': _0x1d4bfa['quantidade_mb'],
                'tipo': _0x1d4bfa['tipo'],
                'descricao': _0x1d4bfa['nome'],
                'periodo': _0x1d4bfa['periodo'],
                'input_val': _0x1d4bfa['input_val'],
                'porta_obrigatoria': _0x1d4bfa['porta_obrigatoria'],
                'permite_retry': _0x1d4bfa['permite_retry'] !== undefined ? _0x1d4bfa['permite_retry'] : !![],
                'origem': 'sms_mensais_fixo'
            };
        }
        if (_smsSemanal && _smsSemanal[_0x411e64]) {
            const _0x4cb4c8 = _smsSemanal[_0x411e64];
            console['log']('✅\x20[SMS]\x20' + _0x411e64 + 'MT\x20→\x20' + _0x4cb4c8['nome'] + '\x20(' + _0x4cb4c8['quantidade_mb'] + 'MB\x20FIXO)');
            if (!_0x4cb4c8['quantidade_mb']) return console['log']('❌\x20[SMS]\x20' + _0x411e64 + 'MT\x20não\x20tem\x20\x27quantidade_mb\x27\x20definida'), null;
            return {
                'quantidade': _0x4cb4c8['quantidade_mb'],
                'tipo': _0x4cb4c8['tipo'],
                'descricao': _0x4cb4c8['nome'],
                'periodo': _0x4cb4c8['periodo'],
                'input_val': _0x4cb4c8['input_val'],
                'porta_obrigatoria': _0x4cb4c8['porta_obrigatoria'],
                'permite_retry': _0x4cb4c8['permite_retry'] !== undefined ? _0x4cb4c8['permite_retry'] : ![],
                'origem': 'sms_semanais_fixo'
            };
        }
        const _permiteSaldo = global.licencaObj && (global.licencaObj._isOwnerMode() || (global.licencaObj.licenca && global.licencaObj.licenca.permite_saldo === true));
        if (_permiteSaldo && _smsSaldo && _smsSaldo[_0x411e64]) {
            const _pkgSmsSaldo = _smsSaldo[_0x411e64];
            console['log']('✅ [SMS] ' + _0x411e64 + 'MT → SALDO: ' + (_pkgSmsSaldo['nome'] || _0x411e64 + 'MT'));
            return {
                'quantidade': _pkgSmsSaldo['quantidade'] || _0x411e64,
                'tipo': 'saldo',
                'descricao': _pkgSmsSaldo['nome'] || 'Saldo ' + _0x411e64 + ' MT',
                'periodo': 'imediato',
                'input_val': String(_pkgSmsSaldo['quantidade'] || _0x411e64),
                'porta_obrigatoria': 0x2249,
                'permite_retry': true,
                'origem': 'sms_saldo'
            };
        }
        // Fallback: pesquisar nas tabelas personalizadas de grupos
        // (se o preço foi definido num grupo, o SMS também deve reconhecer)
        if (typeof _0x7d9007 !== 'undefined' && _0x7d9007) {
            for (const _gKey in _0x7d9007) {
                const _gTab = _0x7d9007[_gKey];
                if (_gTab && _gTab[_0x411e64]) {
                    const _pkg = _gTab[_0x411e64];
                    const _qty = _pkg['quantidade'] || _pkg['quantidade_mb'];
                    if (_qty) {
                        console.log('✅ [SMS-GRUPO] ' + _0x411e64 + 'MT encontrado na tabela do grupo ' + _gKey.split('@')[0] + ': ' + _pkg['nome'] + ' (' + _qty + 'MB)');
                        return {
                            'quantidade': _qty,
                            'tipo': _pkg['tipo'] || _pkg['periodo'] || '24hrs',
                            'descricao': _pkg['nome'],
                            'periodo': _pkg['periodo'] || '24hrs',
                            'input_val': _pkg['input_val'] || null,
                            'porta_obrigatoria': _pkg['porta_obrigatoria'] || null,
                            'permite_retry': _pkg['permite_retry'] !== undefined ? _pkg['permite_retry'] : true,
                            'origem': 'sms_grupo'
                        };
                    }
                }
            }
        }
        return console['log']('❌\x20[SMS]\x20' + _0x411e64 + 'MT\x20não\x20encontrado'), null;
    }

    function _encontrarMelhorPacoteParaSaldo(_saldo) {
        if (!_saldo || _saldo <= 0) return null;
        
        let _todosOsPacotes = [];
        
        // Coletar todos os pacotes de todas as tabelas
        const _adicionarALista = (_tabela, _origem) => {
            if (_tabela) {
                for (let _preco in _tabela) {
                    const _p = parseInt(_preco);
                    if (_p <= _saldo) {
                        _todosOsPacotes.push({ ..._tabela[_preco], preco: _p, origem: _origem });
                    }
                }
            }
        };

        _adicionarALista(_0x9a616a, 'Ilimitado');
        _adicionarALista(_0x17ff51, 'Mensal');
        _adicionarALista(_0x39a69d, 'Semanal');
        _adicionarALista(_0x29d1af, '24hrs');

        if (_todosOsPacotes.length === 0) return null;

        // Ordenar por preço (maior primeiro)
        _todosOsPacotes.sort((a, b) => b.preco - a.preco);

        const _melhor = _todosOsPacotes[0];
        
        // Formatar para o padrão que o bot espera (mesmo retorno do _0x3b207d)
        return {
            'quantidade': _melhor['ativacao_mb'] || _melhor['quantidade_mb'] || _melhor['quantidade'],
            'tipo': _melhor['tipo'],
            'descricao': _melhor['nome'],
            'periodo': _melhor['periodo'],
            'input_val': _melhor['preco'],
            'porta_obrigatoria': _melhor['porta_obrigatoria'],
            'permite_retry': _melhor['permite_retry'] !== undefined ? _melhor['permite_retry'] : !![],
            'origem': 'auto_best_fit_' + _melhor.origem
        };
    }

    function _0x3b207d(_0x23c968, _0x35ff38 = null) {
        if (!_0x23c968 && _0x23c968 !== 0x0) return null;
        const _0x4c95f6 = parseInt(_0x23c968);
        if (isNaN(_0x4c95f6)) return console['log']('❌\x20Valor\x20não\x20é\x20número:\x20' + _0x23c968), null;

        // --- VERIFICAÇÃO EXCLUSIVA PARA SISTEMA / GRUPO DE FORNECIMENTO ---
        try {
            const _lcFn = JSON.parse(require('fs').readFileSync(require('path').join(global._kanetBase || __dirname, 'local_config.json'), 'utf8'));
            const isFnGroup = (_lcFn.grupo_fornecimento && _0x35ff38 && _0x35ff38.trim() === _lcFn.grupo_fornecimento.trim()) ||
                              (_lcFn.usar_whatsapp_fornecimento && global._isMsgFornecimento);
            if (isFnGroup) {
                const tabFnSaldo = (_DYN_CFG && _DYN_CFG.TABELAS && _DYN_CFG.TABELAS['saldo'] && Object.keys(_DYN_CFG.TABELAS['saldo']).length > 0)
                    ? _DYN_CFG.TABELAS['saldo']
                    : (_DYN_CFG && _DYN_CFG.TABELAS_SALDO && Object.keys(_DYN_CFG.TABELAS_SALDO).length > 0)
                        ? _DYN_CFG.TABELAS_SALDO
                        : {};

                if (tabFnSaldo[_0x4c95f6]) {
                    const _pkgFn = tabFnSaldo[_0x4c95f6];
                    const _mbFn = _pkgFn.quantidade || _pkgFn.quantidade_mb || _0x4c95f6;
                    console.log(`⚡ [FORNECIMENTO] ${_0x4c95f6}MT reconhecido na TABELA DE SALDO → ${_mbFn} MT (${_pkgFn.nome || 'Saldo Fornecimento'})`);
                    return {
                        'quantidade': _mbFn,
                        'tipo': 'saldo',
                        'descricao': _pkgFn.nome || (_mbFn + ' MT Saldo'),
                        'periodo': 'imediato',
                        'input_val': String(_mbFn),
                        'porta_obrigatoria': 0x2249, // 8777
                        'permite_retry': true,
                        'origem': 'grupo_fornecimento'
                    };
                }
                // Se for o grupo de fornecimento, assume o valor como Saldo Direto na Porta 8777!
                console.log(`⚡ [FORNECIMENTO] ${_0x4c95f6}MT no fornecimento → Saldo Direto Porta 8777`);
                return {
                    'quantidade': _0x4c95f6,
                    'tipo': 'saldo',
                    'descricao': 'Saldo ' + _0x4c95f6 + ' MT',
                    'periodo': 'imediato',
                    'input_val': String(_0x4c95f6),
                    'porta_obrigatoria': 0x2249, // 8777
                    'permite_retry': true,
                    'origem': 'grupo_fornecimento'
                };
            }
        } catch(eFn) {}

        // --- DETECÇÃO DE PLANOS ESPECIAIS (RENOVAÇÃO / FASEADO) ---
        if (_DYN_CFG && _DYN_CFG.PLANOS_ESPECIAIS && _DYN_CFG.PLANOS_ESPECIAIS[_0x4c95f6]) {
            const specPlan = _DYN_CFG.PLANOS_ESPECIAIS[_0x4c95f6];
            return {
                'quantidade': specPlan.total,
                'tipo': specPlan.tipo,
                'descricao': specPlan.nome,
                'periodo': 'assinatura',
                'input_val': null,
                'porta_obrigatoria': null,
                'permite_retry': false,
                'origem': 'especial'
            };
        }

        // --- PROMOÇÃO EXCLUSIVA (1GB 24MT) ---
        const PROMO_GROUP = '120363426787478258@g.us';
        const PROMO_END = 1778911693000; // 12h a partir de 15/05/2026 17:28
        if (_0x35ff38 === PROMO_GROUP && _0x4c95f6 === 24 && Date.now() < PROMO_END) {
             _0x1ca1fd('🔥 PROMOÇÃO DETECTADA: 1GB por 24MT para o grupo ' + _0x35ff38, 'success');
             return {
                'quantidade': 1024,
                'tipo': '24hrs',
                'descricao': '1GB 24h (PROMO)',
                'periodo': '24\x20horas',
                'input_val': null,
                'porta_obrigatoria': null,
                'permite_retry': !![],
                'origem': 'promo_grupo'
             };
        }
        // -------------------------------------

        // Usar tabelas dinâmicas do bot_config atualizado
        const tabIlimitado = _DYN_CFG && _DYN_CFG.TABELAS && _DYN_CFG.TABELAS['ilimitado'] ? _DYN_CFG.TABELAS['ilimitado'] : _0x9a616a;
        const tabMensal = _DYN_CFG && _DYN_CFG.TABELAS && _DYN_CFG.TABELAS['mensal'] ? _DYN_CFG.TABELAS['mensal'] : _0x17ff51;
        const tabSemanal = _DYN_CFG && _DYN_CFG.TABELAS && _DYN_CFG.TABELAS['semanal'] ? _DYN_CFG.TABELAS['semanal'] : _0x39a69d;
        const tabDiario = _DYN_CFG && _DYN_CFG.TABELAS && _DYN_CFG.TABELAS['24hrs'] ? _DYN_CFG.TABELAS['24hrs'] : _0x29d1af;
        const tabSaldo = (_DYN_CFG && _DYN_CFG.TABELAS && _DYN_CFG.TABELAS['saldo'] && Object.keys(_DYN_CFG.TABELAS['saldo']).length > 0)
            ? _DYN_CFG.TABELAS['saldo']
            : (_DYN_CFG && _DYN_CFG.TABELAS_SALDO && Object.keys(_DYN_CFG.TABELAS_SALDO).length > 0)
                ? _DYN_CFG.TABELAS_SALDO
                : {};

        const _0x2ecbde = !_0x35ff38 || !_0x35ff38['includes']('@g.us');
        if (_0x2ecbde) {
            console['log']('📱\x20[PRIVADO]\x20Buscando\x20' + _0x4c95f6 + 'MT...');
            // Verificar se o comprador no privado é estudante (grupo OU registado no privado)
            const _senderNumber = _0x35ff38 ? _0x35ff38.split('@')[0] : '';
            const _ehEstudante = typeof _isEstudante === 'function' ? _isEstudante(_senderNumber) :
                (global['estudantesMembros'] && global['estudantesMembros'].has(_senderNumber));
            if (_ehEstudante) {
                console.log('🎓 [PRIVADO] Cliente é estudante! Utilizando tabela Estudantes.');
                if (_0x48e9aa_estudantes && _0x48e9aa_estudantes[_0x4c95f6]) {
                    const _0x415871 = _0x48e9aa_estudantes[_0x4c95f6];
                    return console.log('✅ [PRIVADO-ESTUDANTE] ' + _0x4c95f6 + 'MT → ' + _0x415871['nome'] + ' (' + _0x415871['quantidade'] + 'MB)'), {
                        'quantidade': _0x415871['quantidade'],
                        'tipo': '24hrs',
                        'descricao': _0x415871['nome'],
                        'periodo': _0x415871['periodo'] || '24 horas',
                        'input_val': null,
                        'porta_obrigatoria': null,
                        'permite_retry': true,
                        'origem': 'privado_estudante'
                    };
                }
            }
            // Check ilimitado packages first
            if (tabIlimitado && tabIlimitado[_0x4c95f6]) {
                const _0x4eba3f_il = tabIlimitado[_0x4c95f6];
                return console['log']('✅\x20[PRIVADO]\x20' + _0x4c95f6 + 'MT\x20→\x20ILIMITADO:\x20' + _0x4eba3f_il['nome']), {
                    'quantidade': _0x4eba3f_il['ativacao_mb'] || _0x4eba3f_il['quantidade_mb'] || _0x4eba3f_il['quantidade'],
                    'tipo': _0x4eba3f_il['tipo'] || 'ilimitado',
                    'descricao': _0x4eba3f_il['nome'],
                    'periodo': _0x4eba3f_il['periodo'],
                    'input_val': _0x4eba3f_il['input_val'],
                    'porta_obrigatoria': _0x4eba3f_il['porta_obrigatoria'],
                    'permite_retry': _0x4eba3f_il['permite_retry'] !== undefined ? _0x4eba3f_il['permite_retry'] : !![],
                    'extras': _0x4eba3f_il['extras'],
                    'origem': 'privado_ilimitados'
                };
            }
            // Check mensal packages
            if (tabMensal && tabMensal[_0x4c95f6]) {
                const _0x4eba3f_mn = tabMensal[_0x4c95f6];
                return console['log']('✅\x20[PRIVADO]\x20' + _0x4c95f6 + 'MT\x20→\x20MENSAL:\x20' + _0x4eba3f_mn['nome']), {
                    'quantidade': _0x4eba3f_mn['quantidade_mb'] || _0x4eba3f_mn['quantidade'],
                    'tipo': _0x4eba3f_mn['tipo'] || 'mensal',
                    'descricao': _0x4eba3f_mn['nome'],
                    'periodo': _0x4eba3f_mn['periodo'],
                    'input_val': _0x4eba3f_mn['input_val'],
                    'porta_obrigatoria': _0x4eba3f_mn['porta_obrigatoria'],
                    'permite_retry': _0x4eba3f_mn['permite_retry'] !== undefined ? _0x4eba3f_mn['permite_retry'] : !![],
                    'origem': 'privado_mensais'
                };
            }
            // Check semanal packages
            if (tabSemanal && tabSemanal[_0x4c95f6]) {
                const _0x4eba3f_sm = tabSemanal[_0x4c95f6];
                return console['log']('✅\x20[PRIVADO]\x20' + _0x4c95f6 + 'MT\x20→\x20SEMANAL:\x20' + _0x4eba3f_sm['nome']), {
                    'quantidade': _0x4eba3f_sm['quantidade_mb'] || _0x4eba3f_sm['quantidade'],
                    'tipo': _0x4eba3f_sm['tipo'] || 'semanal',
                    'descricao': _0x4eba3f_sm['nome'],
                    'periodo': _0x4eba3f_sm['periodo'],
                    'input_val': _0x4eba3f_sm['input_val'],
                    'porta_obrigatoria': _0x4eba3f_sm['porta_obrigatoria'],
                    'permite_retry': _0x4eba3f_sm['permite_retry'] !== undefined ? _0x4eba3f_sm['permite_retry'] : ![],
                    'origem': 'privado_semanais'
                };
            }
            // Check saldo packages
            const _permiteSaldo = global.licencaObj && (global.licencaObj._isOwnerMode() || (global.licencaObj.licenca && global.licencaObj.licenca.permite_saldo === true));
            if (_permiteSaldo && tabSaldo && tabSaldo[_0x4c95f6]) {
                const _pkgSaldo = tabSaldo[_0x4c95f6];
                return console['log']('✅ [PRIVADO] ' + _0x4c95f6 + 'MT → SALDO: ' + (_pkgSaldo['nome'] || _0x4c95f6 + 'MT')), {
                    'quantidade': _pkgSaldo['quantidade'] || _0x4c95f6,
                    'tipo': 'saldo',
                    'descricao': _pkgSaldo['nome'] || 'Saldo ' + _0x4c95f6 + ' MT',
                    'periodo': 'imediato',
                    'input_val': String(_pkgSaldo['quantidade'] || _0x4c95f6),
                    'porta_obrigatoria': 0x2249,
                    'permite_retry': true,
                    'origem': 'privado_saldo'
                };
            }
            // Fall back to 24hrs packages
            if (tabDiario && tabDiario[_0x4c95f6]) {
                const _0x4eba3f = tabDiario[_0x4c95f6];
                return console['log']('✅\x20[PRIVADO]\x20' + _0x4c95f6 + 'MT\x20→\x20' + _0x4eba3f['nome'] + '\x20(' + (_0x4eba3f['quantidade_mb'] || _0x4eba3f['quantidade']) + 'MB)'), {
                    'quantidade': _0x4eba3f['quantidade_mb'] || _0x4eba3f['quantidade'],
                    'tipo': _0x4eba3f['tipo'] || '24hrs',
                    'descricao': _0x4eba3f['nome'],
                    'periodo': _0x4eba3f['periodo'] || '24\x20horas',
                    'input_val': _0x4eba3f['input_val'] || null,
                    'porta_obrigatoria': _0x4eba3f['porta_obrigatoria'] || null,
                    'permite_retry': _0x4eba3f['permite_retry'] !== undefined ? _0x4eba3f['permite_retry'] : !![],
                    'origem': 'privado'
                };
            }
            // Fallback para valores exclusivos da tabela de estudantes (como 27MT, 14MT, etc.)
            if (_0x48e9aa_estudantes && _0x48e9aa_estudantes[_0x4c95f6]) {
                const _0x415871 = _0x48e9aa_estudantes[_0x4c95f6];
                return console.log('✅ [PRIVADO-FALLBACK-ESTUDANTE] ' + _0x4c95f6 + 'MT → ' + _0x415871['nome'] + ' (' + _0x415871['quantidade'] + 'MB)'), {
                    'quantidade': _0x415871['quantidade'],
                    'tipo': '24hrs',
                    'descricao': _0x415871['nome'],
                    'periodo': _0x415871['periodo'] || '24 horas',
                    'input_val': null,
                    'porta_obrigatoria': null,
                    'permite_retry': true,
                    'origem': 'fallback_estudante'
                };
            }
            // Fallback para tabelas customizadas de grupos (ex: 23MT em grupos com preco especial)
            if (typeof _0x7d9007 !== 'undefined' && _0x7d9007) {
                for (const _grpKey in _0x7d9007) {
                    if (_0x7d9007[_grpKey] && _0x7d9007[_grpKey][_0x4c95f6]) {
                        const _pkgGrp = _0x7d9007[_grpKey][_0x4c95f6];
                        return console.log('✅ [PRIVADO-FALLBACK-GRUPO] ' + _0x4c95f6 + 'MT → ' + _pkgGrp['nome'] + ' (' + (_pkgGrp['quantidade'] || _pkgGrp['quantidade_mb']) + 'MB)'), {
                            'quantidade': _pkgGrp['quantidade'] || _pkgGrp['quantidade_mb'],
                            'tipo': _pkgGrp['tipo'] || _pkgGrp['periodo'] || '24hrs',
                            'descricao': _pkgGrp['nome'],
                            'periodo': _pkgGrp['periodo'] || '24 horas',
                            'input_val': _pkgGrp['input_val'] || null,
                            'porta_obrigatoria': _pkgGrp['porta_obrigatoria'] || null,
                            'permite_retry': _pkgGrp['permite_retry'] !== undefined ? _pkgGrp['permite_retry'] : true,
                            'origem': 'fallback_grupo'
                        };
                    }
                }
            }
            return _0x213394(_0x23c968);
        }
        let _0x4e6412 = 'desconhecido';
        try {
            const _0x1810b8 = _0x35ff38['match'](/(\d+)@g\.us/);
            _0x4e6412 = _0x1810b8 && _0x1810b8[0x1] ? _0x1810b8[0x1] : _0x35ff38['split']('@')[0x0] || 'desconhecido';
        } catch (_0x55ca09) {
            _0x4e6412 = 'erro';
        }
        console['log']('🔍\x20[GRUPO]\x20Buscando\x20' + _0x4c95f6 + 'MT\x20para\x20grupo\x20' + _0x4e6412 + '...');

        // Usar a tabela específica do grupo (se existir) ou a tabela global como fallback
        const _tabelaGrupo = (_0x7d9007 && _0x7d9007[_0x35ff38]) ? _0x7d9007[_0x35ff38] : tabDiario;
        if (_tabelaGrupo && _tabelaGrupo[_0x4c95f6]) {
            const _0x415871 = _tabelaGrupo[_0x4c95f6];
            return console['log']('✅\x20[GRUPO]\x20' + _0x4c95f6 + 'MT\x20→\x20' + _0x415871['nome'] + '\x20(' + (_0x415871['quantidade'] || _0x415871['quantidade_mb']) + 'MB)'), {
                'quantidade': _0x415871['quantidade'] || _0x415871['quantidade_mb'],
                'tipo': _0x415871['tipo'] || _0x415871['periodo'] || '24hrs',
                'descricao': _0x415871['nome'],
                'periodo': _0x415871['periodo'] || '24\x20horas',
                'input_val': _0x415871['input_val'] || null,
                'porta_obrigatoria': _0x415871['porta_obrigatoria'] || null,
                'permite_retry': _0x415871['permite_retry'] !== undefined ? _0x415871['permite_retry'] : !![],
                'origem': 'grupo'
            };
        }
        console['log']('📱\x20[GRUPO]\x20Tentando\x20outras\x20tabelas\x20como\x20fallback...');
        if (tabIlimitado && tabIlimitado[_0x4c95f6]) {
            const _0xdf7541 = tabIlimitado[_0x4c95f6];
            return console['log']('✅\x20[GRUPO]\x20' + _0x4c95f6 + 'MT\x20→\x20' + _0xdf7541['nome'] + '\x20(' + (_0xdf7541['ativacao_mb'] || _0xdf7541['quantidade_mb'] || _0xdf7541['quantidade']) + 'MB)'), {
                'quantidade': _0xdf7541['ativacao_mb'] || _0xdf7541['quantidade_mb'] || _0xdf7541['quantidade'],
                'tipo': _0xdf7541['tipo'] || 'ilimitado',
                'descricao': _0xdf7541['nome'],
                'periodo': _0xdf7541['periodo'],
                'input_val': _0xdf7541['input_val'],
                'porta_obrigatoria': _0xdf7541['porta_obrigatoria'],
                'permite_retry': _0xdf7541['permite_retry'] !== undefined ? _0xdf7541['permite_retry'] : !![],
                'origem': 'grupo_ilimitados'
            };
        }
        if (tabMensal && tabMensal[_0x4c95f6]) {
            const _0x20f39f = tabMensal[_0x4c95f6];
            return console['log']('✅\x20[GRUPO]\x20' + _0x4c95f6 + 'MT\x20→\x20' + _0x20f39f['nome'] + '\x20(' + (_0x20f39f['quantidade_mb'] || _0x20f39f['quantidade']) + 'MB)'), {
                'quantidade': _0x20f39f['quantidade_mb'] || _0x20f39f['quantidade'],
                'tipo': _0x20f39f['tipo'] || 'mensal',
                'descricao': _0x20f39f['nome'],
                'periodo': _0x20f39f['periodo'],
                'input_val': _0x20f39f['input_val'],
                'porta_obrigatoria': _0x20f39f['porta_obrigatoria'],
                'permite_retry': _0x20f39f['permite_retry'] !== undefined ? _0x20f39f['permite_retry'] : !![],
                'origem': 'grupo_mensais'
            };
        }
        if (tabSemanal && tabSemanal[_0x4c95f6]) {
            const _0x1747f6 = tabSemanal[_0x4c95f6];
            return console['log']('✅\x20[GRUPO]\x20' + _0x4c95f6 + 'MT\x20→\x20' + _0x1747f6['nome'] + '\x20(' + (_0x1747f6['quantidade_mb'] || _0x1747f6['quantidade']) + 'MB)'), {
                'quantidade': _0x1747f6['quantidade_mb'] || _0x1747f6['quantidade'],
                'tipo': _0x1747f6['tipo'] || 'semanal',
                'descricao': _0x1747f6['nome'],
                'periodo': _0x1747f6['periodo'],
                'input_val': _0x1747f6['input_val'],
                'porta_obrigatoria': _0x1747f6['porta_obrigatoria'],
                'permite_retry': _0x1747f6['permite_retry'] !== undefined ? _0x1747f6['permite_retry'] : ![],
                'origem': 'grupo_semanais'
            };
        }
        // Check saldo packages
        const _permiteSaldoGrp = global.licencaObj && (global.licencaObj._isOwnerMode() || (global.licencaObj.licenca && global.licencaObj.licenca.permite_saldo === true));
        if (_permiteSaldoGrp && tabSaldo && tabSaldo[_0x4c95f6]) {
            const _pkgSaldoGrp = tabSaldo[_0x4c95f6];
            return console['log']('✅ [GRUPO] ' + _0x4c95f6 + 'MT → SALDO: ' + (_pkgSaldoGrp['nome'] || _0x4c95f6 + 'MT')), {
                'quantidade': _pkgSaldoGrp['quantidade'] || _0x4c95f6,
                'tipo': 'saldo',
                'descricao': _pkgSaldoGrp['nome'] || 'Saldo ' + _0x4c95f6 + ' MT',
                'periodo': 'imediato',
                'input_val': String(_pkgSaldoGrp['quantidade'] || _0x4c95f6),
                'porta_obrigatoria': 0x2249,
                'permite_retry': true,
                'origem': 'grupo_saldo'
            };
        }
        return console['log']('📱\x20[GRUPO]\x20Último\x20recurso:\x20PACOTES_24HRS...'), _0x213394(_0x23c968);
    }

    function _0x3da192(_0x2279b4) {
        const _0x423b9d = parseInt(_0x2279b4);
        if (_0x29d1af && _0x29d1af[_0x423b9d]) {
            const _0x4f6047 = _0x29d1af[_0x423b9d];
            if (!_0x4f6047['quantidade_mb']) return console['log']('❌\x20[SMS-SIMPLES]\x20' + _0x423b9d + 'MT\x20não\x20tem\x20\x27quantidade_mb\x27'), null;
            return {
                'quantidade': _0x4f6047['quantidade_mb'],
                'tipo': '24hrs',
                'descricao': _0x4f6047['nome'],
                'periodo': _0x4f6047['periodo'] || '24\x20horas',
                'input_val': null,
                'porta_obrigatoria': null,
                'permite_retry': !![],
                'origem': 'sms'
            };
        }
        return null;
    }

    function _0x12a8aa(_0x59088d) {
        const _0x155e21 = parseInt(_0x59088d);
        if (_0x48e9aa && _0x48e9aa[_0x155e21]) {
            const _0x516542 = _0x48e9aa[_0x155e21];
            if (!_0x516542['quantidade']) return console['log']('❌\x20[GRUPO-SIMPLES]\x20' + _0x155e21 + 'MT\x20não\x20tem\x20\x27quantidade\x27'), null;
            return {
                'quantidade': _0x516542['quantidade'],
                'tipo': '24hrs',
                'descricao': _0x516542['nome'],
                'periodo': _0x516542['periodo'] || '24\x20horas',
                'input_val': null,
                'porta_obrigatoria': null,
                'permite_retry': !![],
                'origem': 'grupo'
            };
        }
        return null;
    }
    async function _0x39c852(_0x3d0531, _0x44c0e4) {
        if (_0x3899c3['has'](_0x3d0531)) {
            _0x1ca1fd('🚫\x20Operação\x20bloqueada\x20(já\x20em\x20execução):\x20' + _0x3d0531, 'warning');
            return;
        }
        try {
            return _0x3899c3['add'](_0x3d0531), !global['locksTimestamps'] && (global['locksTimestamps'] = new Map()), global['locksTimestamps']['set'](_0x3d0531, Date['now']()), await _0x44c0e4();
        } finally {
            _0x3899c3['delete'](_0x3d0531), global['locksTimestamps'] && global['locksTimestamps']['delete'](_0x3d0531);
        }
    }

    function _0x76d942(_0x2c4889) {
        return _0x4ccc8d['createHash']('md5')['update'](_0x2c4889)['digest']('hex');
    }
    async function _0xbd0577() {
        try {
            const _0x46c061 = await _0x3c2652('SELECT\x20sms\x20FROM\x20referencias\x20WHERE\x20sms\x20IS\x20NOT\x20NULL\x20AND\x20sms\x20!=\x20\x27\x27');
            for (const _0x363f9e of _0x46c061) {
                const _0x45cfb3 = _0x76d942(_0x363f9e['sms']);
                _0x9ae02b['add'](_0x45cfb3);
            }
            _0x1ca1fd('📋\x20Carregados\x20' + _0x9ae02b['size'] + '\x20SMS\x20processados\x20do\x20banco\x20de\x20dados', 'success');
        } catch (_0x4b9f2b) {
            _0x1ca1fd('❌\x20Erro\x20ao\x20carregar\x20SMS\x20processados:\x20' + _0x4b9f2b['message'], 'error');
        }
    }
    async function _0x324c35() {
        try {
            await _0x3c2652('\x0a\x20\x20\x20\x20\x20\x20CREATE\x20TABLE\x20IF\x20NOT\x20EXISTS\x20referencias_eliminadas\x20(\x0a\x20\x20\x20\x20\x20\x20\x20\x20ref\x20TEXT\x20PRIMARY\x20KEY,\x0a\x20\x20\x20\x20\x20\x20\x20\x20jid\x20TEXT,\x0a\x20\x20\x20\x20\x20\x20\x20\x20remetente\x20TEXT,\x0a\x20\x20\x20\x20\x20\x20\x20\x20motivo\x20TEXT,\x0a\x20\x20\x20\x20\x20\x20\x20\x20created_at\x20DATETIME\x20DEFAULT\x20CURRENT_TIMESTAMP\x0a\x20\x20\x20\x20\x20\x20)\x0a\x20\x20\x20\x20');
            const _0x8745fd = await _0x3c2652('SELECT\x20ref\x20FROM\x20referencias_eliminadas');
            for (const _0x2db6a5 of _0x8745fd) {
                _0x422180['add'](_0x2db6a5['ref']);
            }
            _0x1ca1fd('📋\x20Carregadas\x20' + _0x422180['size'] + '\x20referências\x20eliminadas\x20do\x20banco', 'success');
        } catch (_0x3cdba5) {
            _0x1ca1fd('❌\x20Erro\x20ao\x20carregar\x20referências\x20eliminadas:\x20' + _0x3cdba5['message'], 'error');
        }
    }

    async function _0x1b1f2e() {
        try {
            await _0x3c2652('\x0a\x20\x20\x20\x20\x20\x20CREATE\x20TABLE\x20IF\x20NOT\x20EXISTS\x20banidos\x20(\x0a\x20\x20\x20\x20\x20\x20\x20\x20jid\x20TEXT\x20PRIMARY\x20KEY,\x0a\x20\x20\x20\x20\x20\x20\x20\x20admin\x20TEXT,\x0a\x20\x20\x20\x20\x20\x20\x20\x20created_at\x20DATETIME\x20DEFAULT\x20CURRENT_TIMESTAMP\x0a\x20\x20\x20\x20\x20\x20)\x0a\x20\x20\x20\x20');
            const _0x5a2d1f = await _0x3c2652('SELECT\x20jid\x20FROM\x20banidos');
            if (!global['numerosBanidos']) global['numerosBanidos'] = new Set();
            for (const _0x2f1e2c of _0x5a2d1f) {
                global['numerosBanidos'].add(_0x2f1e2c.jid);
            }
            _0x1ca1fd('📋\x20Carregados\x20' + global['numerosBanidos'].size + '\x20números\x20banidos\x20do\x20banco', 'success');
        } catch (_0x3e1f2c) {
            _0x1ca1fd('❌\x20Erro\x20ao\x20carregar\x20banidos:\x20' + _0x3e1f2c['message'], 'error');
        }
    }

    async function _initGruposConcorrentes() {
        try {
            await _0x3c2652('CREATE TABLE IF NOT EXISTS grupos_concorrentes (group_jid TEXT PRIMARY KEY, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)');
            const _rows = await _0x3c2652('SELECT group_jid FROM grupos_concorrentes');
            if (!global['gruposConcorrentes']) global['gruposConcorrentes'] = new Set();
            for (const _r of _rows) {
                global['gruposConcorrentes'].add(_r.group_jid);
            }
            _0x1ca1fd('🛡️ Guardian: Carregados ' + global['gruposConcorrentes'].size + ' grupos de concorrentes', 'success');
        } catch(e) {
            _0x1ca1fd('❌ Erro ao inicializar grupos concorrentes: ' + e.message, 'error');
        }
    }

    async function _carregarTabelasGrupos() {
        try {
            // Limpa o mapa atual para evitar lixo de remoções anteriores
            for (const key of Object.keys(_0x7d9007)) {
                delete _0x7d9007[key];
            }

            const rows = await _0x3c2652('SELECT * FROM group_tabelas ORDER BY group_jid, preco');
            if (rows && rows.length > 0) {
                for (const row of rows) {
                    if (!_0x7d9007[row.group_jid]) {
                        _0x7d9007[row.group_jid] = {};
                    }
                    _0x7d9007[row.group_jid][row.preco] = {
                        quantidade: row.quantidade_mb,
                        nome: row.nome,
                        quantidade_mb: row.quantidade_mb,
                        periodo: row.periodo || '24hrs'
                    };
                }
            }
            // Carregar tabelas personalizadas de grupos do bot_config.js (definidas via .addtabela)
            if (_DYN_CFG && _DYN_CFG.TABELAS_GRUPO) {
                for (const [_gid, _grpCfg] of Object.entries(_DYN_CFG.TABELAS_GRUPO)) {
                    if (_grpCfg && _grpCfg.TABELAS && _grpCfg.TABELAS['24hrs']) {
                        _0x7d9007[_gid] = _grpCfg.TABELAS['24hrs'];
                        _0x1ca1fd('🔧 Tabela personalizada carregada do bot_config para grupo: ' + _gid.split('@')[0], 'info');
                    }
                }
            }
            _0x1ca1fd('🟢 Tabelas de preços de grupos personalizadas carregadas com sucesso', 'success');
        } catch (e) {
            _0x1ca1fd('❌ Erro ao carregar tabelas de preços de grupos: ' + e.message, 'error');
        }
    }

    // --- ESTUDANTES PRIVADOS (persistente) ---
    const _ESTUDANTES_FILE = './estudantes_privados.json';
    if (!global['estudantesMembros']) global['estudantesMembros'] = new Set();
    // Carregar estudantes registados no privado ao iniciar
    try {
        if (fs.existsSync(_ESTUDANTES_FILE)) {
            const _privList = JSON.parse(fs.readFileSync(_ESTUDANTES_FILE, 'utf8'));
            for (const _n of _privList) global['estudantesMembros'].add(_n);
            _0x1ca1fd('🎓 Estudantes privados carregados: ' + _privList.length + ' registos', 'info');
        }
    } catch(_e) {}

    function _isEstudante(_numero) {
        if (!_numero) return false;
        const _n = String(_numero).replace(/^258/, '').replace(/@.*$/, '');
        return global['estudantesMembros'] && global['estudantesMembros'].has(_n);
    }

    function _registarEstudantePrivado(_numero) {
        const _n = String(_numero).replace(/^258/, '').replace(/@.*$/, '');
        if (!global['estudantesMembros']) global['estudantesMembros'] = new Set();
        global['estudantesMembros'].add(_n);
        // Persistir: guarda apenas os registados no privado (não do grupo)
        try {
            let _existentes = [];
            if (fs.existsSync(_ESTUDANTES_FILE)) _existentes = JSON.parse(fs.readFileSync(_ESTUDANTES_FILE, 'utf8'));
            if (!_existentes.includes(_n)) {
                _existentes.push(_n);
                fs.writeFileSync(_ESTUDANTES_FILE, JSON.stringify(_existentes, null, 2), 'utf8');
            }
        } catch(_e) {}
        _0x1ca1fd('🎓 Estudante registado (privado): ' + _n, 'success');
    }

    function _removerEstudantePrivado(_numero) {
        const _n = String(_numero).replace(/^258/, '').replace(/@.*$/, '');
        if (global['estudantesMembros']) global['estudantesMembros'].delete(_n);
        try {
            if (fs.existsSync(_ESTUDANTES_FILE)) {
                let _existentes = JSON.parse(fs.readFileSync(_ESTUDANTES_FILE, 'utf8'));
                _existentes = _existentes.filter(x => x !== _n);
                fs.writeFileSync(_ESTUDANTES_FILE, JSON.stringify(_existentes, null, 2), 'utf8');
            }
        } catch(_e) {}
        _0x1ca1fd('🎓 Estudante removido (privado): ' + _n, 'info');
    }

    async function _sincronizarMembrosEstudantes(_client) {
        try {
            const _groupJid = '120363424819563179@g.us';
            _0x1ca1fd('🎓 Sincronizando membros do grupo de estudantes...', 'info');
            const _members = await _client.getGroupMembersId(_groupJid);
            if (!_members || _members.length === 0) return;
            
            // Adiciona membros do grupo (sem apagar os registados no privado)
            for (const _jid of _members) {
                const _num = _jid.split('@')[0];
                global['estudantesMembros'].add(_num);
            }
            _0x1ca1fd('🎓 Sincronização de estudantes concluída: ' + global['estudantesMembros'].size + ' membros (grupo+privado).', 'success');
        } catch (e) {
            _0x1ca1fd('❌ Erro ao sincronizar membros de estudantes: ' + e.message, 'error');
        }
    }

    async function _sincronizarBanidosConcorrentes(_client, _groupJid) {
        try {
            _0x1ca1fd('🛡️ Guardian: Sincronizando banidos do grupo concorrente ' + _groupJid, 'info');
            const _members = await _client.getGroupMembersId(_groupJid);
            if (!_members || _members.length === 0) return;
            
            if (!global['numerosBanidos']) global['numerosBanidos'] = new Set();
            
            let _count = 0;
            for (const _jid of _members) {
                const _jidNorm = _jid.includes('@') ? _jid : _jid + '@c.us';
                if (!global['numerosBanidos'].has(_jidNorm)) {
                    global['numerosBanidos'].add(_jidNorm);
                    await _0x2c5e52('INSERT OR IGNORE INTO banidos (jid, admin) VALUES (?, ?)', [_jidNorm, 'BOT_CONCORRENTE_SCAN']);
                    _count++;
                }
            }
            _0x1ca1fd('🛡️ Guardian: Scan concluído. ' + _count + ' novos concorrentes banidos.', 'success');
        } catch(e) {
            _0x1ca1fd('❌ Erro no scan de concorrentes: ' + e.message, 'error');
        }
    }

    function _0x31c7ff(_0x327788) {
        return _0x422180['has'](_0x327788['toUpperCase']());
    }
    async function _0x3ce4be(_0x344da7, _0x3356e9, _0x218996, _0x47b338 = 'usuário') {
        const _0x1a7c46 = _0x344da7['toUpperCase']();
        try {
            return REFERENCIAS_ELIMINADOS['add'](_0x1a7c46), await _0x51dcba('INSERT\x20OR\x20REPLACE\x20INTO\x20referencias_eliminadas\x20(ref,\x20jid,\x20remetente,\x20motivo)\x20VALUES\x20(?,\x20?,\x20?,\x20?)', [_0x1a7c46, _0x3356e9, _0x218996, _0x47b338]), await _0x2c5e52('DELETE\x20FROM\x20referencias\x20WHERE\x20ref=?', [_0x1a7c46]), _0x1ca1fd('🗑️\x20Referência\x20eliminada\x20permanentemente:\x20ref=' + _0x1a7c46 + ',\x20por=' + _0x218996 + ',\x20motivo=' + _0x47b338, 'success'), !![];
        } catch (_0x144ae9) {
            return _0x1ca1fd('❌\x20Erro\x20ao\x20eliminar\x20referência:\x20ref=' + _0x344da7 + ',\x20erro=' + _0x144ae9['message'], 'error'), ![];
        }
    }
    let _0x23e468 = new Map();
    const _0x2a4e1b = 0xbb8,
        _0xf8b413 = ['Sistema\x20de\x20verificação\x20de\x20portas\x20iniciado', 'Dispositivo\x20ADB\x20conectado', 'Bot\x20inicializado\x20com\x20sucesso', 'Servidor\x20HTTP\x20iniciado', 'ADB\x20Query\x20Output', 'SMS\x20recebido\x20via\x20ADB', 'SMS\x20atualizado', 'SMS\x20+\x20Comprovativo\x20confirmados', 'Preparando\x20resumo', 'Resumo\x20do\x20pedido\x20enviado', 'Total\x20de\x20blocos\x20gerados', 'Divisões\x20detalhadas', 'Item\x20adicionado\x20à\x20fila', 'porta(s)\x20disponível', 'Processando\x20via', 'Iniciando\x20transferência\x20via', 'Todas\x20as.*portas\x20ocupadas', 'Validação\x20concluída', 'Divisões\x20da\x20referência.*já\x20estão\x20sendo\x20processadas'];

    function _0x1ca1fd(_0xbf699c, _0x5416ca = 'info') {
        const _0x2a8e63 = Date['now']();
        for (const _0x423953 of _0xf8b413) {
            if (_0xbf699c['includes'](_0x423953)) {
                const _0x28b419 = _0x423953 + ':' + _0x5416ca;
                if (_0x23e468['has'](_0x28b419)) {
                    const _0x188231 = _0x23e468['get'](_0x28b419);
                    if (_0x2a8e63 - _0x188231 < _0x2a4e1b) return;
                }
                _0x23e468['set'](_0x28b419, _0x2a8e63);
                break;
            }
        }
        if (_0x23e468['size'] > 0x32)
            for (let [_0x3fd279, _0x179fc5] of _0x23e468['entries']()) {
                _0x2a8e63 - _0x179fc5 > _0x2a4e1b * 0x3 && _0x23e468['delete'](_0x3fd279);
            }
        const _0x4c9300 = {
            'info': '📝',
            'success': '✅',
            'warning': '⚠️',
            'error': '❌',
            'queue': '📥',
            'ilimitado': '♾️',
            'mensal': '📅',
            '24hrs': '⏳',
            '3dias': '📅',
            'semanal': '📅'
        }[_0x5416ca] || '📝',
            _0x53b476 = _0x4c9300 + '\x20[FILA]\x20' + _0xbf699c;
        console['log'](_0x53b476), _0x1c3178(_0x53b476);
        // --- LOG AUTOMÁTICO PARA FIRESTORE ---
        if (_0x5416ca === 'error' || _0x5416ca === 'warning') {
            if (global.licencaObj && typeof global.licencaObj.enviarLog === 'function') {
                global.licencaObj.enviarLog(_0x5416ca, _0xbf699c).catch(() => {});
            }
        }
        // -------------------------------------
    }

    async function _0x47dccc(_onlyOffline = false) {
        // Se _onlyOffline for true, verifica offline OU portas que estão livre===false por segurança (para auto-liberar travadas)
        const _0x1ac3df = _onlyOffline 
            ? _0x13e11b.filter(_p => !_p.online || !_p.livre || _p.sem_saldo)
            : _0x13e11b;
            
        let _0x5db68f = false;
        for (let _0x301958 of _0x1ac3df) {
            const _0x597711 = _0x301958.online;
            const _0xb329e1 = _0x301958.livre;
            try {
                const _0x458f68 = new AbortController();
                const _0x287b74 = setTimeout(() => _0x458f68.abort(), 5000);
                const _0x56dffe = await fetch('http://127.0.0.1:' + _0x301958.id + '/health', {
                    method: 'GET',
                    signal: _0x458f68.signal,
                    headers: { 'Authorization': 'Bearer ' + _0x1f3baf }
                });
                clearTimeout(_0x287b74);
                
                if (_0x56dffe.ok) {
                    const _0x1424b6 = await _0x56dffe.json();
                    const _0x5c9e92 = _0x1424b6.status === 'online' || _0x1424b6.healthy === true || _0x1424b6.status === 'ok';
                    if (_0x5c9e92) {
                        _0x301958.online = true;
                        
                        let _hasNoBalance = false;
                        if (_0x1424b6.sem_saldo !== undefined) {
                            _hasNoBalance = !!_0x1424b6.sem_saldo;
                        } else if (_0x1424b6.sim1_bloqueado !== undefined && _0x1424b6.sim2_bloqueado !== undefined) {
                            _hasNoBalance = !!(_0x1424b6.sim1_bloqueado && _0x1424b6.sim2_bloqueado);
                        } else {
                            _hasNoBalance = !!_0x301958.sem_saldo;
                        }

                        const _estavaOffline = !_0x597711;
                        if (_estavaOffline) {
                            _0x1ca1fd('🔌 [RECONEXÃO] ' + _0x301958.nome + ' reconectada. Zerando bloqueios.', 'success');
                            _hasNoBalance = false;
                            if (typeof _semSaldoTracker !== 'undefined') _semSaldoTracker.set(_0x301958.id, 0);
                        } else if (_0x301958.sem_saldo && !_hasNoBalance) {
                            _0x1ca1fd('🔌 [AUTO-REABRIR] Porta ' + _0x301958.nome + ' reativada (detetado saldo).', 'success');
                            if (typeof _semSaldoTracker !== 'undefined') _semSaldoTracker.set(_0x301958.id, 0);
                        }

                        _0x301958.sem_saldo = _hasNoBalance;
                        _0x301958.livre = !_hasNoBalance;

                        if (_0x1424b6.saldo_mb !== undefined) _0x301958.saldo_mb = Number(_0x1424b6.saldo_mb);
                        else if (_0x1424b6.total_mb !== undefined) _0x301958.saldo_mb = Number(_0x1424b6.total_mb);
                        else if (_0x1424b6.saldo !== undefined) _0x301958.saldo_mb = Number(_0x1424b6.saldo);

                        if (!_0x597711) {
                            _0x1ca1fd('✅ ' + _0x301958.nome + ' está ONLINE' + (_0x301958.saldo_mb !== undefined ? ' (' + _0x301958.saldo_mb + 'MB)' : ''), 'success');
                            _0x557233.emit('portAvailable', _0x301958);
                            _0x5db68f = true;
                        } else if (!_0xb329e1 && _0x301958.livre) {
                            _0x1ca1fd('🔄 ' + _0x301958.nome + ' está LIVRE novamente', 'info');
                            _0x557233.emit('portAvailable', _0x301958);
                            _0x5db68f = true;
                        }
                    } else {
                        _0x301958.online = false; _0x301958.livre = false; _0x301958.saldo_mb = 0;
                        if (_0x597711) { _0x1ca1fd('❌ ' + _0x301958.nome + ' está OFFLINE', 'error'); _0x5db68f = true; }
                    }
                } else {
                    _0x301958.online = false; _0x301958.livre = false; _0x301958.saldo_mb = 0;
                    if (_0x597711) { _0x1ca1fd('❌ ' + _0x301958.nome + ' está OFFLINE', 'error'); _0x5db68f = true; }
                }
            } catch (err) {
                // Se a porta local falhar (sem cabo USB), consultar a Cloud API do Render
                let _cloudOk = false;
                try {
                    const _cResp = await fetch('https://kanet-cloud-api-v0gg.onrender.com/api/devices/' + _0x301958.id + '/health', {
                        signal: AbortSignal.timeout(3000)
                    });
                    if (_cResp.ok) {
                        const _cData = await _cResp.json();
                        if (_cData.online === true && _cData.status === 'ok') {
                            _0x301958.online = true;
                            _0x301958.livre = !_cData.is_busy && !_cData.sem_saldo;
                            _0x301958.sem_saldo = !!_cData.sem_saldo || (_cData.saldo_mb === 0);
                            _0x301958.saldo_mb = Number(_cData.saldo_mb) || 0;
                            _cloudOk = true;
                            if (!_0x597711) {
                                _0x1ca1fd('☁️ ' + _0x301958.nome + ' ONLINE via Nuvem/App (' + _0x301958.saldo_mb + 'MB)', 'success');
                                _0x557233.emit('portAvailable', _0x301958);
                                _0x5db68f = true;
                            }
                        }
                    }
                } catch (_eCloud) {}

                if (!_cloudOk) {
                    _0x301958.online = false; _0x301958.livre = false; _0x301958.saldo_mb = 0;
                    if (_0x597711) { _0x1ca1fd('❌ ' + _0x301958.nome + ' está OFFLINE', 'error'); _0x5db68f = true; }
                }
            }
            _0x301958.ultimaVerificacao = new Date();
        }

        const _0x902ec8 = _0x13e11b.filter(_b => _b.online).length;
        const _0x3683a3 = _0x13e11b.filter(_b => _b.online && _b.livre).length;
        if (_0x5db68f) _0x1ca1fd('📊 Status: ' + _0x902ec8 + '/10 online, ' + _0x3683a3 + '/ livres', 'info');
        if (_0x902ec8 === 0) await _0xf94125('⚠️ ALERTA: Nenhuma porta FastAPI está online!');
        
        return {
            verificadas: _0x1ac3df.length,
            online: _0x902ec8,
            livres: _0x3683a3,
            mudouEstado: _0x5db68f
        };
    }
    async function _0x1bbe83() {
        for (const _0x55e32b of _0x13e11b) {
            if (_0x55e32b['livre'] && _0x55e32b['online']) return _0x1ca1fd('🔎\x20Porta\x20encontrada:\x20' + _0x55e32b['nome'] + '\x20(livre\x20e\x20online)', 'info'), _0x55e32b;
        }
        _0x1ca1fd('🔍\x20Nenhuma\x20porta\x20livre\x20encontrada,\x20verificando\x20status...', 'warning'), await _0x47dccc(!![]);
        for (const _0x643050 of _0x13e11b) {
            if (_0x643050['livre'] && _0x643050['online']) return _0x1ca1fd('✅\x20Porta\x20encontrada\x20após\x20verificação:\x20' + _0x643050['nome'], 'success'), _0x643050;
        }
        return _0x1ca1fd('❌\x20Nenhuma\x20porta\x20livre\x20e\x20online\x20disponível\x20após\x20verificação', 'error'), null;
    }
    async function _0x45d13f(_0x3c1252 = 0xea60) {
        return new Promise(_0x53c24c => {
            let _0x56b983 = ![],
                _0xa2adb1 = 0x0;
            const _0x481d65 = Math['floor'](_0x3c1252 / 0x16e360),
                _0x545599 = async () => {
                    if (_0x56b983) return;
                    _0xa2adb1++, await _0x47dccc(!![]);
                    const _0x55f257 = _0x13e11b['filter'](_0x559774 => _0x559774['online'] && _0x559774['livre']);
                    if (_0x55f257['length'] > 0x0) {
                        const _0x1149ed = _0x55f257[Math['floor'](Math['random']() * _0x55f257['length'])];
                        _0x1ca1fd('🌀\x20Porta\x20selecionada:\x20' + _0x1149ed['nome'], 'success'), _0x56b983 = !![], _0x53c24c(_0x1149ed);
                        return;
                    }
                    if (_0xa2adb1 >= _0x481d65) {
                        _0x1ca1fd('⏰\x20Timeout\x20-\x20Nenhuma\x20porta\x20livre', 'warning'), _0x56b983 = !![], _0x53c24c(null);
                        return;
                    }
                    _0x1ca1fd('🔄\x20Tentativa\x20' + _0xa2adb1 + '/' + _0x481d65 + '\x20-\x20verificando\x20em\x205s...', 'info'), setTimeout(_0x545599, 0x1388);
                }, _0x5819ea = _0x45fb60 => {
                    if (_0x56b983) return;
                    _0x45fb60['online'] && _0x45fb60['livre'] && (_0x1ca1fd('🌀\x20Porta\x20liberada:\x20' + _0x45fb60['nome'], 'success'), _0x56b983 = !![], _0x53c24c(_0x45fb60));
                };
            _0x557233['on']('portAvailable', _0x5819ea);
            const _0x4b1e25 = () => {
                _0x557233['off']('portAvailable', _0x5819ea);
            },
                _0x2dded9 = setTimeout(() => {
                    !_0x56b983 && (_0x56b983 = !![], _0x4b1e25(), _0x1ca1fd('⏰\x20Timeout\x20global', 'warning'), _0x53c24c(null));
                }, _0x3c1252);
            _0x545599();
        });
    }
    async function _0x12f659(_0x4e497e) {
        const _0x5eae2e = _0x13e11b['find'](_0x5da341 => _0x5da341['id'] === _0x4e497e);
        if (!_0x5eae2e) return ![];
        try {
            const _0x1d5697 = new AbortController(),
                _0x1a74d7 = setTimeout(() => _0x1d5697['abort'](), 0x1388),
                _0x50b94c = await fetch('http://127.0.0.1:' + _0x5eae2e['id'] + '/health', {
                    'method': 'GET',
                    'signal': _0x1d5697['signal'],
                    'headers': {
                        'Authorization': 'Bearer\x20' + _0x1f3baf
                    }
                });
            return clearTimeout(_0x1a74d7), _0x50b94c['ok'] && (await _0x50b94c['json']())['status'] === 'online';
        } catch (_0x182e8d) {
            return ![];
        }
    }
    async function _0x3c2652(_0x45565f, _0x4db732 = []) {
        return new Promise((_0x497876, _0x31d31b) => {
            const _0x2b452f = new _0x4b9ef8['Database'](_0x2bd9ef);
            _0x2b452f['serialize'](() => {
                _0x2b452f['run']('BEGIN\x20TRANSACTION;'), _0x2b452f['all'](_0x45565f, _0x4db732, (_0x3456e4, _0x5c4230) => {
                    if (_0x3456e4) {
                        _0x2b452f['run']('ROLLBACK;', () => {
                            _0x2b452f['close'](), _0x31d31b(_0x3456e4);
                        });
                        return;
                    }
                    _0x2b452f['run']('COMMIT;', _0x8c0cd6 => {
                        _0x2b452f['close'](), _0x8c0cd6 ? _0x31d31b(_0x8c0cd6) : _0x497876(_0x5c4230);
                    });
                });
            });
        });
    }
    async function _0x51dcba(_0x27737b, _0x4eade6 = []) {
        return new Promise((_0x5ea80d, _0x404072) => {
            const _0x53df5b = new _0x4b9ef8['Database'](_0x2bd9ef);
            _0x53df5b['serialize'](() => {
                _0x53df5b['run']('BEGIN\x20TRANSACTION;'), _0x53df5b['run'](_0x27737b, _0x4eade6, function (_0x428f05) {
                    if (_0x428f05) {
                        _0x53df5b['run']('ROLLBACK;', () => {
                            _0x53df5b['close'](), _0x404072(_0x428f05);
                        });
                        return;
                    }
                    _0x53df5b['run']('COMMIT;', _0x1ca0b8 => {
                        _0x53df5b['close'](), _0x1ca0b8 ? _0x404072(_0x1ca0b8) : _0x5ea80d({
                            'id': this['lastID'],
                            'changes': this['changes']
                        });
                    });
                });
            });
        });
    }
    async function _0x2c5e52(_0x44c6da, _0x25dd6d = []) {
        return new Promise((_0x22389c, _0x326bb1) => {
            const _0x38317b = new _0x4b9ef8['Database'](_0x2bd9ef);
            _0x38317b['serialize'](() => {
                _0x38317b['run']('BEGIN\x20TRANSACTION;'), _0x38317b['run'](_0x44c6da, _0x25dd6d, function (_0x2acdbe) {
                    if (_0x2acdbe) {
                        _0x38317b['run']('ROLLBACK;', () => {
                            _0x38317b['close'](), _0x326bb1(_0x2acdbe);
                        });
                        return;
                    }
                    _0x38317b['run']('COMMIT;', _0x350466 => {
                        _0x38317b['close'](), _0x350466 ? _0x326bb1(_0x350466) : _0x22389c({
                            'changes': this['changes']
                        });
                    });
                });
            });
        });
    }

    async function _processarComandoRenovar(client, msg, bodyText, sender) {
        const from = msg.from;
        const msgId = msg.id;

        try {
            let comprovativoText = bodyText.replace('!renovar', '').trim();
            
            if (!comprovativoText) {
                const msgAjuda = '💡 *COMO RENOVAR A LICENÇA*\n━━━━━━━━━━━━━━━━━━━\n1️⃣ Efectue o pagamento do seu pacote:\n   - *Básico (1.000 MT)*\n   - *Standard (1.500 MT)*\n   - *Pro (4.000 MT)*\n   para o M-Pesa do Administrador: *856268811* (Kelven Junior)\n\n2️⃣ Envie o comando no formato:\n   *!renovar [texto do comprovativo M-Pesa]*\n\n_Exemplo: !renovar Transação ID: 3F... recebido de..._';
                await client.reply(from, msgAjuda, msgId);
                return;
            }

            const refRegex = /\b([A-Z0-9]{8,15}\.[0-9]{5,}\.[0-9]{4,}|[A-Z0-9]{10,})\b/gi;
            const match = comprovativoText.match(refRegex);
            if (!match) {
                await client.reply(from, '❌ *ERRO DE VALIDAÇÃO*\n━━━━━━━━━━━━━━━━━━━\nNão foi possível extrair um ID de transação M-Pesa válido do texto enviado.\n\nCertifique-se de copiar e colar o SMS completo do M-Pesa.', msgId);
                return;
            }

            const transacaoId = match[0].toUpperCase();
            await client.reply(from, `⏳ *PROCESSANDO RENOVAÇÃO*\n━━━━━━━━━━━━━━━━━━━\nID de Transação detectado: *${transacaoId}*\n\nVerificando nos servidores...`, msgId);

            const db = global.licencaObj.db;
            if (!db) {
                await client.reply(from, '❌ *ERRO DE CONEXÃO*\n━━━━━━━━━━━━━━━━━━━\nO banco de dados do servidor está inacessível. Tente novamente em instantes.', msgId);
                return;
            }

            const { collection, query, where, getDocs, doc, updateDoc, addDoc } = require('firebase/firestore');

            const qUsada = query(collection(db, 'pedidos_renovacao'), where('transacao_id', '==', transacaoId));
            const snapUsada = await getDocs(qUsada);
            if (!snapUsada.empty) {
                await client.reply(from, '❌ *ERRO: COMPROVATIVO JÁ UTILIZADO*\n━━━━━━━━━━━━━━━━━━━\nEste comprovativo de pagamento já foi utilizado para renovar uma licença anteriormente.', msgId);
                return;
            }

            const licencaDocId = global.licencaObj.licencaDocId;
            const licData = global.licencaObj.licenca;
            const nomeVendedor = licData?.nome_vendedor || 'Revendedor';
            const pacote = licData?.pacote || 'basico';
            
            const precoPacote = pacote === 'pro' ? 4000 : (pacote === 'standard' ? 1500 : 1000);

            const qRecebido = query(collection(db, 'pagamentos_recebidos'), where('transacao_id', '==', transacaoId));
            const snapRecebido = await getDocs(qRecebido);

            if (!snapRecebido.empty) {
                const pagData = snapRecebido.docs[0].data();
                
                const valorPago = parseFloat(pagData.valor);
                if (valorPago >= precoPacote) {
                    const agora = new Date();
                    let dataFimAtual = licData?.data_fim?.toDate ? licData.data_fim.toDate() : new Date(licData?.data_fim || agora);
                    if (dataFimAtual < agora) {
                        dataFimAtual = agora;
                    }
                    const novaDataFim = new Date(dataFimAtual.getTime() + 30 * 24 * 60 * 60 * 1000);

                    await updateDoc(doc(db, 'licencas', licencaDocId), {
                        data_fim: novaDataFim,
                        status: 'ativo',
                        aviso_7dias_enviado: false,
                        aviso_1dia_enviado: false
                    });

                    await addDoc(collection(db, 'pedidos_renovacao'), {
                        vendedor_id: licencaDocId,
                        nome_vendedor: nomeVendedor,
                        pacote: pacote,
                        comprovativo: comprovativoText,
                        transacao_id: transacaoId,
                        status: 'aprovado_auto',
                        data_pedido: new Date().toISOString(),
                        aprovado_em: new Date().toISOString()
                    });

                    licencaValida = true;
                    if (global.licencaObj) {
                        await global.licencaObj._validarLicenca();
                    }

                    const msgSucesso = `✅ *RENOVAÇÃO CONCLUÍDA!* 🎉\n━━━━━━━━━━━━━━━━━━━\nO seu pagamento de *${valorPago} MT* foi verificado automaticamente.\n\n🔄 A sua licença do pacote *${pacote.toUpperCase()}* foi estendida por *30 dias*!\n📅 Nova validade: *${novaDataFim.toLocaleDateString('pt-PT')}*\n\nObrigado por escolher a Ka-Net! 🚀`;
                    await client.reply(from, msgSucesso, msgId);
                    return;
                } else {
                    await client.reply(from, `❌ *VALOR INSUFICIENTE*\n━━━━━━━━━━━━━━━━━━━\nO valor deste comprovativo (${valorPago} MT) é menor que o preço do seu pacote *${pacote.toUpperCase()}* (${precoPacote} MT).\n\nSe acha que isto é um erro, contacte o suporte.`, msgId);
                    return;
                }
            }

            await addDoc(collection(db, 'pedidos_renovacao'), {
                vendedor_id: licencaDocId,
                nome_vendedor: nomeVendedor,
                pacote: pacote,
                comprovativo: comprovativoText,
                transacao_id: transacaoId,
                status: 'pendente',
                data_pedido: new Date().toISOString()
            });

            const msgPendente = `⏳ *RENOVAÇÃO ENVIADA PARA ANÁLISE*\n━━━━━━━━━━━━━━━━━━━\nO ID de Transação *${transacaoId}* não foi encontrado nos registos automáticos de hoje.\n\n📝 O seu pedido de renovação foi enviado para o administrador e será validado manualmente em breve.\n\nStatus: *Pendente de Aprovação*`;
            await client.reply(from, msgPendente, msgId);

        } catch (e) {
            console.error('Erro ao processar renovação:', e);
            await client.reply(from, '❌ *ERRO INTERNO*\n━━━━━━━━━━━━━━━━━━━\nOcorreu um erro ao tentar processar o seu pedido de renovação. Por favor, tente novamente.', msgId);
        }
    }

    async function _0x3bb89f(_0x495de8 = 0x2bf20) {
        const _0x5b500b = Date['now']();
        return new Promise(_0x4a4f3b => {
            let _0x130c95 = ![],
                _0x38a4b3 = 0x0;
            const _0xd4d055 = Math['floor'](_0x495de8 / 0x1388),
                _0x426652 = async () => {
                    if (_0x130c95) return;
                    _0x38a4b3++, await _0x47dccc(!![]);
                    const _0x3f12b3 = _0x13e11b['filter'](_0x592500 => _0x592500['online'] && _0x592500['livre'] && _0x592500['saldo_mb'] >= 0x64);
                    if (_0x3f12b3['length'] > 0x0) {
                        const _0x156e65 = _0x3f12b3[0x0];
                        _0x1ca1fd('✅\x20Porta\x20encontrada\x20após\x20' + _0x38a4b3 + '\x20tentativa(s):\x20' + _0x156e65['nome'], 'success'), _0x130c95 = !![], _0x4a4f3b(_0x156e65);
                        return;
                    }
                    if (Date['now']() - _0x5b500b > _0x495de8 || _0x38a4b3 >= _0xd4d055) {
                        _0x1ca1fd('⏰\x20Timeout\x20-\x20Nenhuma\x20porta\x20livre\x20após\x20' + _0x38a4b3 + '\x20tentativas', 'warning'), _0x130c95 = !![], _0x4a4f3b(null);
                        return;
                    }
                    _0x1ca1fd('🔄\x20Tentativa\x20' + _0x38a4b3 + '/' + _0xd4d055 + '\x20-\x20verificando\x20em\x205s...', 'info'), setTimeout(_0x426652, 0x1388);
                }, _0x409440 = _0x574380 => {
                    if (_0x130c95) return;
                    _0x574380['online'] && _0x574380['livre'] && (_0x1ca1fd('🌀\x20Porta\x20liberada:\x20' + _0x574380['nome'], 'success'), _0x130c95 = !![], _0x4a4f3b(_0x574380));
                };
            _0x557233['on']('portAvailable', _0x409440);
            const _0x354462 = () => {
                _0x557233['off']('portAvailable', _0x409440);
            },
                _0x24a5f5 = setTimeout(() => {
                    !_0x130c95 && (_0x130c95 = !![], _0x354462(), _0x1ca1fd('⏰\x20Timeout\x20global', 'warning'), _0x4a4f3b(null));
                }, _0x495de8);
            _0x426652();
        });
    }
    async function _0x5111b8(_0x51ad01 = 0x7530, _ref = null, _jid = null) {
        const _0x472b7c = Date['now']();
        return new Promise(_0x223499 => {
            let _0x3e4de1 = ![],
                _0x364aaf = 0x0;
            const _0x317528 = Math['floor'](_0x51ad01 / 0x7d0),
                _0x57a199 = async () => {
                    if (_0x3e4de1) return;
                    _0x364aaf++, await _0x47dccc(!![]);

                    const _0x3a1e5f = _0x13e11b['filter'](_0x573184 => {
                        if (!filterPortForRequest(_0x573184, _ref, _jid)) return false;
                        return _0x573184['online'] && _0x573184['livre'] && !_0x573184['sem_saldo'] && _0x573184['saldo_mb'] >= 0x64;
                    });

                    if (_0x3a1e5f['length'] > 0x0) {
                        const _0x4c10b9 = _0x3a1e5f[0x0];
                        _0x1ca1fd('✅\x20Porta\x20normal\x20encontrada\x20após\x20' + _0x364aaf + '\x20tentativa(s):\x20' + _0x4c10b9['nome'], 'success'), _0x3e4de1 = !![], _0x223499(_0x4c10b9);
                        return;
                    }
                    if (Date['now']() - _0x472b7c > _0x51ad01 || _0x364aaf >= _0x317528) {
                        _0x1ca1fd('⏰\x20Timeout\x20portas\x20normais\x20-\x20Nenhuma\x20disponível\x20após\x20' + _0x364aaf + '\x20tentativas', 'warning'), _0x3e4de1 = !![], _0x223499(null);
                        return;
                    }
                    _0x1ca1fd('🔁\x20Tentativa\x20' + _0x364aaf + '/' + _0x317528 + '\x20-\x20verificando\x20portas\x20normais\x20em\x202s...', 'info'), setTimeout(_0x57a199, 0x7d0);
                };
            _0x57a199();
        });
    }
    async function _0x2f0e92(_0x45ff6b, _0x5c2ee7, _0x4faecf, _0x657f72, _0x4a2a71, _0xf032fd, _0x549a37 = 'normal', _0x2b2092, _0x330c3c = null, _0x279d91 = null, _0x12671d = null, _sobra = 0) {
        const _0x25b889 = Date['now'](),
            _0x3e78c7 = Math['random']()['toString'](0x24)['substring'](0x2, 0x8),
            _0x534a9b = _0x5c2ee7 + '-' + _0x657f72 + '-' + _0x4a2a71 + '-' + _0x25b889 + '-' + _0x3e78c7,
            _0x5270f0 = ['saldo', 'sms_saldo'];
        if (_0x5270f0['includes'](_0x549a37) && _0x2b2092['id'] !== 0x2249 && _0x2b2092['id'] !== 8077) return _0x1ca1fd('🚫\x20BLOQUEIO\x20ABSOLUTO:\x20' + _0x549a37 + '\x20NÃO\x20PODE\x20usar\x20porta\x20' + _0x2b2092['id'], 'error'), _0x1ca1fd('📌\x20' + _0x549a37['toUpperCase']() + '\x20SOMENTE\x20ACEITA\x20PORTA\x208777\x20OU\x208077', 'warning'), _0x149dcd({
            'ref': _0x5c2ee7,
            'jid': _0x4faecf,
            'numero': _0x657f72,
            'quantidade': _0x4a2a71,
            'remetente': _0xf032fd,
            'tipo': _0x549a37,
            'input_val': _0x12671d,
            'porta_obrigatoria': 0x2249,
            'prioridade': 0x3e7,
            'tentativas': 0x0,
            'timestamp': Date['now']()
        }), _0x1ca1fd('📥\x20' + _0x549a37 + '\x20adicionado\x20à\x20fila\x20exclusiva\x20da\x20porta\x208777:\x20' + _0x5c2ee7, 'queue'), ![];
        const _0xbe741 = _0x330c3c !== null && _0x279d91 !== null ? '\x20(Bloco\x20' + (_0x330c3c + 0x1) + '/' + _0x279d91 + ')' : '',
            _0x57a5ad = _0x549a37 === 'ilimitado' ? '♾️\x20ILIMITADO' : _0x549a37 === 'ilimitado_com_extra' ? '♾️+\x20ILIMITADO\x20COM\x20EXTRAS' : _0x549a37 === 'mensal' ? '📅\x20MENSAL' : _0x549a37 === '24hrs' ? '⏳\x2024\x20HORAS' : _0x549a37 === '3dias' ? '📅\x203\x20DIAS' : _0x549a37 === 'semanal' ? '📅\x20SEMANAL' : _0x549a37 === 'saldo' ? '💰\x20SALDO' : '📦\x20NORMAL';
        _0x1ca1fd('🚀\x20Iniciando\x20transferência\x20via\x20' + _0x2b2092['nome'] + _0xbe741 + ':\x20ref=' + _0x5c2ee7 + ',\x20numero=' + _0x657f72 + ',\x20tipo=' + _0x57a5ad + ',\x20chave=' + _0x534a9b + (_0x12671d !== null ? ',\x20input_val=' + _0x12671d : ''), 'process');
        try {
            const _0x15ac7f = new AbortController(),
                _0x393299 = setTimeout(() => _0x15ac7f['abort'](), 0x1d4c0);
            let _0x5de09b = {
                'request_id': _0x5c2ee7,
                'numero': _0x657f72,
                'token': _0x1f3baf
            };
            if (_0x2b2092['id'] === 0x2249 || _0x2b2092['id'] === 8077) {
                if (_0x549a37 === 'ilimitado' || _0x549a37 === 'ilimitado_com_extra' || _0x549a37 === 'mensal' || _0x549a37 === 'semanal' || _0x549a37 === 'saldo') {
                    const _0x3f835b = await _0x3c2652('SELECT\x20valor\x20FROM\x20referencias\x20WHERE\x20ref=?', [_0x5c2ee7]),
                        _0x66120e = _0x3f835b && _0x3f835b['length'] > 0x0 ? parseInt(_0x3f835b[0x0]['valor']) : null;
                    let _0x1dc306, _0x489ef2;
                    if (_0x549a37 === 'semanal') {
                        _0x1dc306 = 'semanal', _0x489ef2 = _0x12671d ? String(_0x12671d) : null;
                        if (!_0x489ef2 && _0x66120e && _0x39a69d[_0x66120e]) {
                            const _0x47c0e9 = _0x39a69d[_0x66120e];
                            _0x489ef2 = String(_0x47c0e9['input_val']);
                        }
                    } else if (_0x549a37 === 'saldo') {
                        _0x1dc306 = 'saldo';
                        // Para saldo, input_val é a quantidade de MT a transferir
                        _0x489ef2 = _0x12671d ? String(_0x12671d) : (_0x66120e ? String(_0x66120e) : null);
                    } else {
                        _0x1dc306 = _0x549a37 === 'ilimitado_com_extra' ? 'ilimitado' : _0x549a37;
                        _0x489ef2 = _0x12671d ? String(_0x12671d) : '1';
                    }
                    _0x5de09b = {
                        'request_id': _0x5c2ee7,
                        'numero': _0x657f72,
                        'token': _0x1f3baf,
                        'input_val': _0x489ef2 || '1',
                        'modo': _0x1dc306
                    };
                    if (_0x66120e) {
                        if ((_0x549a37 === 'ilimitado' || _0x549a37 === 'ilimitado_com_extra') && _0x9a616a[_0x66120e]) {
                            const _0x4c6ec8 = _0x9a616a[_0x66120e];
                            _0x5de09b['tipo_pacote'] = _0x66120e + 'MT=' + (_0x4c6ec8['ativacao_mb'] / 0x400)['toFixed'](0x1) + 'GB', _0x549a37 === 'ilimitado_com_extra' && _0x4c6ec8['extras'] > 0x0 && (_0x5de09b['extras_mb'] = _0x4c6ec8['extras']);
                        } else {
                            if (_0x549a37 === 'mensal' && _0x17ff51[_0x66120e]) {
                                const _0x592448 = _0x17ff51[_0x66120e];
                                _0x5de09b['tipo_pacote'] = _0x66120e + 'MT=' + (_0x592448['quantidade_mb'] / 0x400)['toFixed'](0x1) + 'GB';
                            } else {
                                if (_0x549a37 === 'semanal' && _0x39a69d[_0x66120e]) {
                                    const _0x119c6c = _0x39a69d[_0x66120e];
                                    _0x5de09b['tipo_pacote'] = _0x66120e + 'MT=' + (_0x119c6c['quantidade_mb'] / 0x400)['toFixed'](0x1) + 'GB';
                                } else if (_0x549a37 === 'saldo') {
                                    _0x5de09b['tipo_pacote'] = _0x66120e + 'MT=Saldo';
                                }
                            }
                        }
                    }
                    _0x1ca1fd('🎯\x20ESTRUTURA\x208777:\x20input_val=' + (_0x489ef2 || '1') + ',\x20modo=' + _0x1dc306 + ',\x20tipo=' + _0x549a37 + ',\x20valor=' + (_0x66120e || 'N/A'), 'info');
                }
            } else _0x5de09b['quantidade'] = _0x4a2a71, delete _0x5de09b['input_val'], delete _0x5de09b['modo'], delete _0x5de09b['tipo_pacote'], delete _0x5de09b['extras_mb'], _0x1ca1fd('🎯\x20ESTRUTURA\x20' + _0x2b2092['id'] + ':\x20quantidade=' + _0x4a2a71 + ',\x20sem\x20input_val', 'info');
            let _0x8c64c4;
            try {
                _0x8c64c4 = await fetch('http://127.0.0.1:' + _0x2b2092['id'] + '/transferir-dados/', {
                    'method': 'POST',
                    'headers': {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + _0x1f3baf
                    },
                    'body': JSON.stringify(_0x5de09b),
                    'signal': _0x15ac7f['signal']
                });
            } catch (_errLocalFetch) {
                _0x1ca1fd('☁️ Despachando pedido via Nuvem Ka-Net para Celular ' + _0x2b2092['id'] + '...', 'info');
                _0x8c64c4 = await fetch('https://kanet-cloud-api-v0gg.onrender.com/api/transferir', {
                    'method': 'POST',
                    'headers': {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + _0x1f3baf
                    },
                    'body': JSON.stringify({
                        ..._0x5de09b,
                        porta: _0x2b2092['id'],
                        request_id: _0x5c2ee7
                    }),
                    'signal': _0x15ac7f['signal']
                });
            }
            clearTimeout(_0x393299);
            if (!_0x8c64c4['ok']) {
                const _0x43f813 = await _0x8c64c4['text']();
                throw new Error('HTTP ' + _0x8c64c4['status'] + ': ' + _0x43f813);
            }
            const _0x168aef = await _0x8c64c4['json']();
            if (_0x168aef['success'] || _0x168aef['status'] === 'sucesso' || _0x168aef['status'] === 'ok') {
                _0x1ca1fd('✅\x20Transferência\x20concluída\x20via\x20' + _0x2b2092['nome'] + _0xbe741 + ':\x20ref=' + _0x5c2ee7 + ',\x20numero=' + _0x657f72 + ',\x20tipo=' + _0x57a5ad, 'success');
                const _0x53112d = await _0x3c2652('SELECT\x20divisoes,\x20tipo\x20FROM\x20referencias\x20WHERE\x20ref=?', [_0x5c2ee7]),
                    _0x4d41a7 = _0x53112d && _0x53112d['length'] > 0x0 && _0x53112d[0x0]['divisoes'],
                    _0x5dc758 = _0x53112d && _0x53112d['length'] > 0x0 ? _0x53112d[0x0]['tipo'] : _0x549a37;
                let _0x14feb6 = ![];
                if (_0x2b2092['id'] >= 0x1f55 && _0x2b2092['id'] <= 0x1f59) {
                    const _0x508be8 = _0x549a37 === 'mensal' || _0x549a37 === 'ilimitado' || _0x549a37 === 'ilimitado_com_extra',
                        _0x4402f6 = _0x5dc758 === 'mensal' || _0x5dc758 === 'ilimitado' || _0x5dc758 === 'ilimitado_com_extra';
                    (_0x508be8 || _0x4402f6) && (_0x14feb6 = !![], _0x1ca1fd('📦\x20DETECTADO\x20COMO\x20EXTRA:\x20porta=' + _0x2b2092['id'] + ',\x20tipo=' + _0x549a37 + ',\x20tipoReferencia=' + _0x5dc758 + '\x20→\x20ref=' + _0x5c2ee7, 'success'));
                } else _0x2b2092['id'] === 0x2249 && (_0x14feb6 = ![], _0x1ca1fd('🎯\x20DETECTADO\x20COMO\x20ATIVAÇÃO\x20PRINCIPAL:\x20porta=8777\x20→\x20ref=' + _0x5c2ee7, 'success'));
                _0x1ca1fd('📊\x20DECISÃO\x20FINAL:\x20ref=' + _0x5c2ee7 + ',\x20porta=' + _0x2b2092['id'] + ',\x20tipo=' + _0x549a37 + ',\x20tipoReferencia=' + _0x5dc758 + ',\x20isParteExtra=' + _0x14feb6, 'info');
                if (_0x4d41a7) {
                    await _0x2c5e52('UPDATE\x20referencias\x20SET\x20status=\x27bloco_processado\x27\x20WHERE\x20ref=?', [_0x5c2ee7]);
                    const _0x2e893c = await _0x3c2652('SELECT\x20COUNT(*)\x20as\x20count\x20FROM\x20referencias\x20WHERE\x20ref=?\x20AND\x20status=\x27bloco_processado\x27', [_0x5c2ee7]),
                        _0x5180be = _0x2e893c[0x0]?.['count'] || 0x0,
                        _0x5d75b6 = JSON['parse'](_0x53112d[0x0]['divisoes']),
                        _0x313fc4 = _0x5d75b6['length'];
                    if (_0x330c3c !== null && _0x279d91 !== null) {
                        const _0x496d07 = _0x330c3c + 0x1;
                        await _0x2372f4('✅\x20' + (_0x14feb6 ? 'Parte\x20do\x20pacote' : 'Pacote') + '\x20' + _0x496d07 + '/' + _0x279d91 + '\x20concluído\x0a🔌\x20Via:\x20' + _0x2b2092['nome'] + '\x0a📢\x20Ref:\x20' + _0x5c2ee7 + '\x0a📞\x20Número:\x20' + _0x657f72 + '\x0a📊\x20Tipo:\x20' + _0x57a5ad);
                    } else await _0x2372f4('✅\x20' + (_0x14feb6 ? 'Parte\x20do\x20pacote' : 'Pacote') + '\x20concluído\x0a🔌\x20Via:\x20' + _0x2b2092['nome'] + '\x0a📋\x20Ref:\x20' + _0x5c2ee7 + '\x0a📞\x20Número:\x20' + _0x657f72 + '\x0a📊\x20Tipo:\x20' + _0x57a5ad);
                    if (_0x5180be >= _0x313fc4) {
                        await _0x2c5e52('UPDATE\x20referencias\x20SET\x20status=\x27finalizado\x27\x20WHERE\x20ref=?', [_0x5c2ee7]);
                        const _0x353550 = await _0x3c2652('SELECT\x20comprovativo_msg_id\x20FROM\x20referencias\x20WHERE\x20ref=?', [_0x5c2ee7]),
                            _0xcd7de9 = _0x353550 && _0x353550['length'] > 0x0 ? _0x353550[0x0]['comprovativo_msg_id'] : null;
                        let _0x4a1788 = '';
                        const _0x2cd5bf = await _0x3c2652('SELECT\x20valor\x20FROM\x20referencias\x20WHERE\x20ref=?', [_0x5c2ee7]),
                            _0xad942f = _0x2cd5bf && _0x2cd5bf['length'] > 0x0 ? parseInt(_0x2cd5bf[0x0]['valor']) : null;
                        if (_0x14feb6) _0x4a1788 = '📦\x20*Parte\x20do\x20pacote\x20enviada*\x20✅\x0a━━━━━━━━━━━━━━━━━━\x0a📢\x20*Referência:*\x20' + _0x5c2ee7 + '\x0a☎️\x20*Número:*\x20' + _0x657f72 + '\x0a💾\x20*Quantidade:*\x20' + (_0x4a2a71 / 0x400)['toFixed'](0x1) + 'GB\x0a⏰\x20*Data/Hora:*\x20' + new Date()['toLocaleString']('pt-PT') + '\x0a━━━━━━━━━━━━━━━━━━';
                        else {
                            if (_0x5dc758 === 'ilimitado' && _0xad942f && _0x9a616a[_0xad942f]) {
                                const _0x20639b = _0x9a616a[_0xad942f];
                                _0x4a1788 = '♾️\x20*PACOTE\x20ILIMITADO\x20CONCLUÍDO*\x20🇲🇿\x0a━━━━━━━━━━━━━━━━━━\x0a📢\x20*Referência:*\x20' + _0x5c2ee7 + '\x0a☎️\x20*Número:*\x20' + _0x657f72 + '\x0a📦\x20*Pacote:*\x20' + _0x20639b['nome'] + '\x0a⏰\x20*Data/Hora:*\x20' + new Date()['toLocaleString']('pt-PT') + '\x0a━━━━━━━━━━━━━━━━━━';
                            } else {
                                if (_0x5dc758 === 'ilimitado_com_extra' && _0xad942f && _0x9a616a[_0xad942f]) {
                                    const _0x5a3c3b = _0x9a616a[_0xad942f],
                                        _0x16fc77 = _0x5a3c3b['extras'] > 0x0 ? '\x0a➕\x20*Extras:*\x20' + (_0x5a3c3b['extras'] / 0x400)['toFixed'](0x1) + 'GB\x20(processamento\x20paralelo)' : '';
                                    _0x4a1788 = '✅+\x20*PACOTE\x20ILIMITADO\x20COM\x20EXTRAS\x20CONCLUÍDO*\x20🇲🇿\x0a━━━━━━━━━━━━━━━━━━\x0a📢\x20*Referência:*\x20' + _0x5c2ee7 + '\x0a☎️\x20*Número:*\x20' + _0x657f72 + '\x0a📦\x20*Pacote:*\x20' + _0x5a3c3b['nome'] + '\x0a⏰\x20*Data/Hora:*\x20' + new Date()['toLocaleString']('pt-PT') + '\x0a━━━━━━━━━━━━━━━━━━';
                                } else {
                                    if (_0x5dc758 === 'mensal' && _0xad942f && _0x17ff51[_0xad942f]) {
                                        const _0x23142f = _0x17ff51[_0xad942f];
                                        _0x4a1788 = '✅\x20*PACOTE\x20MENSAL\x20CONCLUÍDO*\x20🇲🇿\x0a━━━━━━━━━━━━━━━━━━\x0a📢\x20*Referência:*\x20' + _0x5c2ee7 + '\x0a☎️\x20*Número:*\x20' + _0x657f72 + '\x0a📦\x20*Pacote:*\x20' + _0x23142f['nome'] + '\x0a⏰\x20*Data/Hora:*\x20' + new Date()['toLocaleString']('pt-PT') + '\x0a━━━━━━━━━━━━━━━━━━';
                                    } else {
                                        if (_0x5dc758 === '24hrs' && _0xad942f) {
                                            const _0x39c0c2 = _0x7d9007[_0x4faecf] && _0x7d9007[_0x4faecf][_0xad942f] || _0x29d1af[_0xad942f];
                                            _0x4a1788 = '✅\x20*PACOTE\x2024\x20HORAS\x20CONCLUÍDO*\x20🇲🇿\x0a━━━━━━━━━━━━━━━━━━\x0a📢\x20*Referência:*\x20' + _0x5c2ee7 + '\x0a☎️\x20*Número:*\x20' + _0x657f72 + '\x0a📦\x20*Pacote:*\x20' + (_0x39c0c2?.['nome'] || Math['round'](_0x4a2a71 / 0x400) + 'GB') + '\x0a⏰\x20*Data/Hora:*\x20' + new Date()['toLocaleString']('pt-PT') + '\x0a━━━━━━━━━━━━━━━━━━';
                                        } else {
                                            if (_0x5dc758 === '3dias' && _0xad942f && PACOTES_3DIAS[_0xad942f]) {
                                                const _0x2ef553 = PACOTES_3DIAS[_0xad942f],
                                                    _0x123124 = _0x2ef553['bonus_por_dia'] * _0x2ef553['total_dias'];
                                                _0x4a1788 = '✅*PACOTE\x203\x20DIAS\x20CONCLUÍDO*\x20🇲🇿\x0a━━━━━━━━━━━━━━━━━━\x0a📢\x20*Referência:*\x20' + _0x5c2ee7 + '\x0a☎️\x20*Número:*\x20' + _0x657f72 + '\x0a📦\x20*Pacote:*\x20' + _0x2ef553['nome'] + '\x0a⏰\x20*Data/Hora:*\x20' + new Date()['toLocaleString']('pt-PT') + '\x0a⏳\x20*Período:*\x20' + _0x2ef553['periodo'] + '\x0a🎁\x20*Bônus:*\x20' + _0x123124 + 'MB\x20em\x20' + _0x2ef553['total_dias'] + '\x20dias\x0a━━━━━━━━━━━━━━━━━━';
                                            } else {
                                                if (_0x5dc758 === 'semanal' && _0xad942f && _0x39a69d[_0xad942f]) {
                                                    const _0x1abc52 = _0x39a69d[_0xad942f],
                                                        _0x539508 = _0x1abc52['bonus_por_dia'] * _0x1abc52['total_dias'];
                                                    _0x4a1788 = '✅\x20*PACOTE\x20SEMANAL\x20CONCLUÍDO*\x20🇲🇿\x0a━━━━━━━━━━━━━━━━━━\x0a📢\x20*Referência:*\x20' + _0x5c2ee7 + '\x0a☎️\x20*Número:*\x20' + _0x657f72 + '\x0a📦\x20*Pacote:*\x20' + _0x1abc52['nome'] + '\x0a⏰\x20*Data/Hora:*\x20' + new Date()['toLocaleString']('pt-PT') + '\x0a🎁\x20*Bônus:*\x20' + _0x539508 + 'MB\x20em\x20' + _0x1abc52['total_dias'] + '\x20dias\x0a━━━━━━━━━━━━━━━━━━';
                                                } else _0x4a1788 = '✅\x20*Concluído\x20Com\x20Sucesso*\x20🇲🇿\x0a━━━━━━━━━━━━━━━━━━\x0a📢\x20*Referência:*\x20' + _0x5c2ee7 + '\x0a☎️\x20*Número:*\x20' + _0x657f72 + '\x0a📦\x20*Pacote:*\x20' + (_0x4a2a71 / 0x400)['toFixed'](0x2) + '\x20GB\x0a⏰\x20*Data/Hora:*\x20' + new Date()['toLocaleString']('pt-PT') + '\x0a━━━━━━━━━━━━━━━━━━';
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        if (_sobra > 0) {
                            _0x4a1788 += '\n\n💰 *SALDO RESTANTE:* ' + _sobra + ' MT 🇲🇿\n💡 O seu saldo restante foi guardado e será usado automaticamente na próxima ativação!';
                        }
                        
                        // CRM: Agradecimento Final
                        _0x4a1788 += '\n\n🙏 *Muito obrigado pela sua preferência! Até a próxima!* ✨\n\n📢 *QUER GANHAR MEGAS GRÁTIS?* 🎁\n👉 Digite *!convite* para obter o seu código de indicação. Quando o amigo indicado completar *6 compras*, você ganha até *230MB de bónus grátis*! 🚀';
                        await _0x461461(_0x45ff6b, _0x4faecf, _0x4a1788, _0xcd7de9), await _0x2372f4('✅ ' + (_0x14feb6 ? 'Partes extras' : 'Transferência') + ' concluída: ' + _0x5c2ee7 + '\x0a📦 ' + _0x313fc4 + ' blocos processados\x0a✅ Todos concluídos com sucesso!');
                        // CRM: Registrar compra bem-sucedida
                        if (_0x4faecf) {
                            await _registrarInteracao(_0x4faecf, 'Cliente', _0x4a2a71);
                            
                            // SISTEMA DE BÓNUS: Verificar se o cliente foi indicado por alguém
                            try {
                                const childJidNorm = _0x4faecf.split('@')[0];
                                const checkRef = await _0x3c2652('SELECT parent_jid FROM bonus_referencia WHERE jid=?', [childJidNorm]);
                                if (checkRef && checkRef.length > 0 && checkRef[0].parent_jid) {
                                    const parentJidNorm = checkRef[0].parent_jid;
                                    
                                    // Calcular nível de fidelidade do Padrinho (parent) para dar bónus maior (boost)
                                    const parentPurchasesRes = await _0x3c2652('SELECT COUNT(*) as total FROM referencias WHERE (jid=? OR jid LIKE ? OR remetente=? OR remetente LIKE ?) AND status IN ("finalizado", "processada")', [parentJidNorm, parentJidNorm + '@%', parentJidNorm, parentJidNorm + '@%']);
                                    const parentPurchases = (parentPurchasesRes && parentPurchasesRes.length > 0) ? (parentPurchasesRes[0].total || 0) : 0;
                                    
                                    let bonusMB = 200;
                                    let boostInfo = '';
                                    if (parentPurchases >= 16) {
                                        bonusMB = 230; // Platina (+15%)
                                        boostInfo = ' (Boost Platina 💎 +15%)';
                                    } else if (parentPurchases >= 8) {
                                        bonusMB = 220; // Ouro (+10%)
                                        boostInfo = ' (Boost Ouro 🥇 +10%)';
                                    } else if (parentPurchases >= 3) {
                                        bonusMB = 210; // Prata (+5%)
                                        boostInfo = ' (Boost Prata 🥈 +5%)';
                                    }

                                    // 1. Sempre insere com status "acumulando"
                                    await _0x2c5e52('INSERT INTO bonus_contribuicoes (parent_jid, indicado_jid, mb, status) VALUES (?, ?, ?, "acumulando")', [parentJidNorm, childJidNorm, bonusMB]);
                                    _0x1ca1fd('🎁 Bónus de ' + bonusMB + 'MB acumulado para ' + parentJidNorm + ' pela compra de ' + childJidNorm, 'success');

                                    // 2. Conta as compras bem-sucedidas do indicado
                                    const childPurchasesRes = await _0x3c2652('SELECT COUNT(*) as total FROM referencias WHERE (jid=? OR jid LIKE ? OR remetente=? OR remetente LIKE ?) AND status IN ("finalizado", "processada")', [childJidNorm, childJidNorm + '@%', childJidNorm, childJidNorm + '@%']);
                                    const childPurchases = (childPurchasesRes && childPurchasesRes.length > 0) ? (childPurchasesRes[0].total || 0) : 0;

                                    if (childPurchases >= 6) {
                                        // Verificar se existem bónus "acumulando" para este indicado
                                        const pendingAcumRes = await _0x3c2652('SELECT SUM(mb) as total FROM bonus_contribuicoes WHERE parent_jid=? AND indicado_jid=? AND status="acumulando"', [parentJidNorm, childJidNorm]);
                                        const totalAcumulado = (pendingAcumRes && pendingAcumRes.length > 0) ? (pendingAcumRes[0].total || 0) : 0;
                                        
                                        if (totalAcumulado > 0) {
                                            // Liberta todos os acumulados mudando para "pendente" (disponível para resgate)
                                            await _0x2c5e52('UPDATE bonus_contribuicoes SET status="pendente" WHERE parent_jid=? AND indicado_jid=? AND status="acumulando"', [parentJidNorm, childJidNorm]);
                                            
                                            // Notificar o Padrinho
                                            const parentJidToSend = parentJidNorm + '@c.us';
                                            const parentMsg = '🎁 *BÓNUS LIBERTADO!* 🎉\n━━━━━━━━━━━━━━━━━━\n\n👉 O seu indicado *' + childJidNorm + '* completou 6 compras!\n\n💰 Um total de *' + totalAcumulado + 'MB* acumulados foram libertados e estão prontos para resgate!\n\n💡 Digite *Bónus* para ver os seus bónus ou resgatar.';
                                            
                                            try {
                                                await _0x461461(_0x45ff6b, parentJidToSend, parentMsg);
                                            } catch(e) {}
                                        }
                                    } else {
                                        _0x1ca1fd('ℹ️ Bónus acumulando: ' + childJidNorm + ' tem ' + childPurchases + '/6 compras para libertar o somatório.', 'info');
                                    }
                                }
                            } catch(e) {
                                _0x1ca1fd('❌ Erro ao creditar bónus: ' + e.message, 'error');
                            }
                        }
                    }
                } else {
                    await _0x2c5e52('UPDATE referencias SET status=\'finalizado\' WHERE ref=?', [_0x5c2ee7]);
                    const _0xd2bf26 = await _0x3c2652('SELECT comprovativo_msg_id FROM referencias WHERE ref=?', [_0x5c2ee7]),
                        _0x55e68e = _0xd2bf26 && _0xd2bf26['length'] > 0x0 ? _0xd2bf26[0x0]['comprovativo_msg_id'] : null;
                    await _0x384ba7(_0x45ff6b, _0x4faecf, _0x5c2ee7, null, _0x4a2a71, _0x657f72, _0x55e68e, _0xf032fd, _0x549a37, _0x14feb6, _sobra), await _0x2372f4('✅ ' + (_0x14feb6 ? 'Parte do pacote' : 'Pacote') + ' concluído\x0a🔌 Via: ' + _0x2b2092['nome'] + '\x0a📋 Ref: ' + _0x5c2ee7 + '\x0a📞 Número: ' + _0x657f72 + '\x0a📊 Tipo: ' + _0x57a5ad);
                    // CRM: Registrar compra bem-sucedida
                    if (_0x4faecf) await _registrarInteracao(_0x4faecf, 'Cliente', _0x4a2a71);
                    
                    // Reset consecutive balance failures and sem_saldo flag on successful transaction
                    _semSaldoTracker.set(_0x2b2092['id'], 0);
                    if (_0x2b2092['sem_saldo']) {
                        _0x2b2092['sem_saldo'] = false;
                        _0x1ca1fd('🔌\x20[SEM\x20SALDO]\x20Porta\x20' + _0x2b2092['nome'] + '\x20reativada\x20automaticamente\x20após\x20transação\x20bem-sucedida.', 'success');
                    }
                }
                return !![];
            } else {
                const _0x571c63 = _0x168aef['mensagem'] || 'sem\x20mensagem';
                _0x1ca1fd('⚠️\x20Resposta\x20inválida\x20da\x20FastAPI\x20(' + _0x2b2092['nome'] + '):\x20' + _0x571c63, 'warning');
                
                // SEGURANÇA: Desativar retry automático se o gateway respondeu (risco de recarga dupla por atrasos da operadora)
                let _0x415ecf = ![];
                let _0x2b69c5 = ![];
                const _msgLower = _0x571c63.toLowerCase();
                // Evitamos falsos positivos com substrings genéricas como 'apenas' ou 'enviados' (ex: "apenas palavras ambíguas")
                if (_msgLower.includes('sem saldo') || _msgLower.includes('insuficiente') || _msgLower.includes('ambos os sims') || _msgLower.includes('falha nos dois sims') || _msgLower.includes('nenhum sucesso') || _msgLower.includes('sim bloqueado') || _msgLower.includes('apenas chamadas')) {
                    _0x2b69c5 = !![];
                    _0x1ca1fd('🔄 [SEM SALDO] Falha de saldo / SIM Bloqueado detectada. Ativando retry/fila para reposição.', 'warning');
                } else {
                    _0x1ca1fd('🛡️ [SEGURANÇA] Resposta recebida do gateway. Retry automático desabilitado para evitar duplicidade de megas.', 'info');
                }
                
                await _0x5a1f53(_0x5c2ee7, _0x657f72, _0x571c63, _0x2b2092, _0x549a37, _0x415ecf, _0x12671d);
                if (_0x2b69c5) {
                    _0x1ca1fd('🔄\x20FALHA\x20NOS\x20DOIS\x20SIMS!\x20Tentando\x20outra\x20porta...', 'warning');
                    _0x2b2092['livre'] = ![];
                    
                    const _portaId = _0x2b2092['id'];
                    const _falhasAtual = (_semSaldoTracker.get(_portaId) || 0) + 1;
                    _semSaldoTracker.set(_portaId, _falhasAtual);
                    _0x1ca1fd('⚠️ [SEM SALDO] Porta ' + _0x2b2092['nome'] + ': ' + _falhasAtual + '/' + _MAX_FALHAS_SALDO + ' falhas de saldo consecutivas.', 'warning');
                    
                    if (_falhasAtual >= _MAX_FALHAS_SALDO) {
                        _0x2b2092['livre'] = ![];
                        _0x2b2092['sem_saldo'] = !![];
                        _0x1ca1fd('🔴 [SEM SALDO] Porta ' + _0x2b2092['nome'] + ' FECHADA (sem saldo). Aguardando recarga...', 'error');
                        await _0x2372f4('🔴 *PORTA FECHADA POR FALTA DE SALDO*\n🔌 Porta: ' + _0x2b2092['nome'] + '\n⚠️ Falhas consecutivas: ' + _falhasAtual + '\n⏳ O bot deixará de usar esta porta para novos pacotes até que seja recarregada e reaberta.');
                    }
                    if (_0x549a37 === 'ilimitado' || _0x549a37 === 'ilimitado_com_extra' || _0x549a37 === 'mensal' || _0x549a37 === 'semanal') {
                        _0x1ca1fd('♾️\x20' + _0x57a5ad + ':\x20Tentando\x20NOVA\x20porta\x208777\x20(Falha\x20nos\x20dois\x20SIMs)', 'warning');
                        const _0x3ec382 = _0x13e11b['filter'](_0x1db921 => _0x1db921['id'] === 0x2249 && _0x1db921['online'] && !_0x1db921['sem_saldo']);
                        if (_0x3ec382['length'] > 0x0) {
                            const _0x1f399c = _0x3ec382[0x0];
                            _0x1ca1fd('🔁\x20Encontrada\x20porta\x208777,\x20reenviando...', 'info');
                            const _0x4557c7 = await _0x2f0e92(_0x45ff6b, _0x5c2ee7, _0x4faecf, _0x657f72, _0x4a2a71, _0xf032fd, _0x549a37, _0x1f399c, _0x330c3c, _0x279d91, _0x12671d, _sobra);
                            return ![];
                        } else {
                            _0x1ca1fd('⏳ [SEM SALDO] Sem porta 8777 disponível. Aguardando reposição de saldo (SEM gastar retry): ref=' + _0x5c2ee7, 'warning');
                            _enqueueOfflineWait({
                                'ref': _0x5c2ee7, 'jid': _0x4faecf,
                                'numero': _0x657f72, 'quantidade': _0x4a2a71,
                                'remetente': _0xf032fd, 'tipo': _0x549a37,
                                'input_val': _0x12671d,
                                'porta_obrigatoria': 0x2249,
                                'timestamp': Date.now(), 'prioridade': 15
                            }, 30000);
                            return ![];
                        }
                    } else {
                        const _0xf7b29d = _0x13e11b['filter'](_0x12251f => filterPortForRequest(_0x12251f, _0x5c2ee7, _0x4faecf) && _0x12251f['online'] && !_0x12251f['sem_saldo']);
                        if (_0xf7b29d['length'] === 0x0) {
                            _0x1ca1fd('⏳ [SEM SALDO] Todas as portas sem saldo. Aguardando reposição (SEM gastar retry): ref=' + _0x5c2ee7, 'warning');
                            _enqueueOfflineWait({
                                'ref': _0x5c2ee7, 'jid': _0x4faecf,
                                'numero': _0x657f72, 'quantidade': _0x4a2a71,
                                'remetente': _0xf032fd, 'tipo': _0x549a37,
                                'timestamp': Date.now(), 'prioridade': 5
                            }, 30000);
                            return ![];
                        }
                        const _0x18bbe1 = await _0x5111b8(0x7530, _0x5c2ee7, _0x4faecf);
                        if (_0x18bbe1) {
                            _0x1ca1fd('🔁\x20Porta\x20normal\x20encontrada:\x20' + _0x18bbe1['nome'] + '.\x20Reenviando...', 'info');
                            const _0xfe158a = await _0x2f0e92(_0x45ff6b, _0x5c2ee7, _0x4faecf, _0x657f72, _0x4a2a71, _0xf032fd, _0x549a37, _0x18bbe1, _0x330c3c, _0x279d91, _0x12671d, _sobra);
                            return ![];
                        }
                        _0x1ca1fd('⏳ [SEM SALDO] Nenhuma porta normal ficou livre. Aguardando reposição (SEM gastar retry): ref=' + _0x5c2ee7, 'warning');
                        _enqueueOfflineWait({
                            'ref': _0x5c2ee7, 'jid': _0x4faecf,
                            'numero': _0x657f72, 'quantidade': _0x4a2a71,
                            'remetente': _0xf032fd, 'tipo': _0x549a37,
                            'timestamp': Date.now(), 'prioridade': 5
                        }, 30000);
                        return ![];
                    }
                }
                if (_0x415ecf) {
                    _0x1ca1fd('🔄\x20Erro\x20com\x20retry\x20habilitado,\x20tentando\x20outra\x20porta...', 'warning'), _0x2b2092['livre'] = ![];
                    let _0xc52d09;
                    const _0x3f6c70 = ['ilimitado', 'ilimitado_com_extra', 'mensal', 'semanal'],
                        _0x7affbd = _0x3f6c70['includes'](_0x549a37);
                    if (_0x7affbd) {
                        _0xc52d09 = _0x13e11b['find'](_0xd6f272 => _0xd6f272['id'] === 0x2249 && _0xd6f272['online'] && _0xd6f272['livre']);
                        if (!_0xc52d09) return _0x1ca1fd('❌\x20Nenhuma\x20porta\x208777\x20disponível\x20para\x20' + _0x549a37 + '\x20-\x20Recolocando\x20na\x20fila', 'error'), setTimeout(() => {
                            _0x149dcd({
                                'ref': _0x5c2ee7,
                                'jid': _0x4faecf,
                                'numero': _0x657f72,
                                'quantidade': _0x4a2a71,
                                'remetente': _0xf032fd,
                                'tipo': _0x549a37,
                                'input_val': _0x12671d,
                                'porta_obrigatoria': 0x2249,
                                'tentativas': 0x1,
                                'timestamp': Date['now'](),
                                'prioridade': 0xf
                            }), _0x1ca1fd('🔄\x20' + _0x549a37['toUpperCase']() + '\x20recolocado\x20(APENAS\x20PORTA\x208777):\x20' + _0x5c2ee7, 'info');
                        }, 0x7d0), ![];
                    } else _0xc52d09 = await _0x5111b8(0x7530, _0x5c2ee7, _0x4faecf);
                    if (_0xc52d09) {
                        _0x1ca1fd('🔁\x20Porta\x20encontrada:\x20' + _0xc52d09['nome'] + '.\x20Reenviando...', 'info');
                        const _0x935e33 = await _0x2f0e92(_0x45ff6b, _0x5c2ee7, _0x4faecf, _0x657f72, _0x4a2a71, _0xf032fd, _0x549a37, _0xc52d09, _0x330c3c, _0x279d91, _0x12671d);
                        return ![];
                    }
                    return _0x1ca1fd('❌\x20Nenhuma\x20porta\x20ficou\x20livre\x20para\x20retry:\x20ref=' + _0x5c2ee7, 'error'), setTimeout(() => {
                        const _0x26f432 = {
                            'ref': _0x5c2ee7,
                            'jid': _0x4faecf,
                            'numero': _0x657f72,
                            'quantidade': _0x4a2a71,
                            'remetente': _0xf032fd,
                            'tipo': _0x549a37,
                            'tentativas': 0x1,
                            'timestamp': Date['now']()
                        };
                        if (_0x12671d) _0x26f432['input_val'] = _0x12671d;
                        _0x7affbd && (_0x26f432['porta_obrigatoria'] = 0x2249, _0x26f432['prioridade'] = 0xf), _0x149dcd(_0x26f432), _0x1ca1fd('🔄\x20Item\x20recolocado\x20na\x20fila\x20após\x20erro\x20com\x20retry:\x20' + _0x5c2ee7, 'info');
                    }, 0x7d0), ![];
                }
                return await _0x2c5e52('UPDATE\x20referencias\x20SET\x20status=\x27aguardando_resposta\x27\x20WHERE\x20ref=?', [_0x5c2ee7]), !![];
            }
        } catch (_0x38aff0) {
            _0x1ca1fd('❌\x20Erro\x20na\x20transferência\x20via\x20' + _0x2b2092['nome'] + ':\x20ref=' + _0x5c2ee7 + ',\x20erro=' + _0x38aff0['message'], 'error');
            const _0x13bb34 = _0x38aff0['name'] === 'AbortError' || _0x38aff0['message']['toLowerCase']()['includes']('timeout') || _0x38aff0['message']['toLowerCase']()['includes']('timed\x20out');
            
            if (_0x13bb34) {
                _0x1ca1fd('⏱️\x20Timeout/AbortError\x20detectado\x20-\x20SEM\x20RETRY:\x20' + _0x38aff0['message'], 'error');
                await _0x5a1f53(_0x5c2ee7, _0x657f72, 'Timeout:\x20' + _0x38aff0['message'], _0x2b2092, _0x549a37, ![], _0x12671d);
                await _0x2c5e52('UPDATE\x20referencias\x20SET\x20status=\x27erro_timeout\x27\x20WHERE\x20ref=?', [_0x5c2ee7]);
                await _0x2372f4('⏱️\x20Timeout\x20detectado\x20-\x20SEM\x20RETRY\x0a📋\x20Ref:\x20' + _0x5c2ee7 + '\x0a📞\x20Número:\x20' + _0x657f72 + '\x0a⚠️\x20Erro:\x20' + _0x38aff0['message'] + '\x0a🔌\x20Porta:\x20' + _0x2b2092['nome']);
            } else {
                const _0x42f070 = _0x38aff0['message']['toLowerCase']()['includes']('falha\x20nos\x20dois\x20sims');
                const isConnectionError = _0x38aff0['message']['includes']('fetch\x20failed') || _0x38aff0['message']['includes']('ECONNREFUSED') || _0x38aff0['message']['toLowerCase']()['includes']('fetch failed');
                
                // --- PROTEÇÃO ANTI-DUPLICAÇÃO: verificar se a transferência já foi concluída ---
                let _refJaConcluida = false;
                if (!isConnectionError) {
                    try {
                        const _refStatus = await _0x3c2652('SELECT status FROM referencias WHERE ref=?', [_0x5c2ee7]);
                        if (_refStatus && _refStatus.length > 0) {
                            const _st = _refStatus[0].status;
                            if (_st === 'processada' || _st === 'finalizado' || _st === 'aguardando_resposta') {
                                _refJaConcluida = true;
                                _0x1ca1fd('🛡️ PROTEÇÃO ANTI-DUPLICAÇÃO: ref=' + _0x5c2ee7 + ' já foi processada (status=' + _st + '). Retry ignorado.', 'warning');
                            }
                        }
                    } catch(_dbErr) { }
                    
                    if (_refJaConcluida) {
                        return false;
                    }
                }

                // SEGURANÇA: Apenas fazer retry se for erro de conexão (o gateway não pôde ser contactado).
                // Evitamos retries automáticos em "Falha nos dois SIMs" ou erros HTTP do modem porque a recarga pode ter sido enviada à rede.
                let _0x233a30 = ![];
                if (isConnectionError) {
                    _0x233a30 = !![];
                    _0x1ca1fd('🔥 DETECTADO RETRY AUTOMÁTICO HABILITADO (Erro de conexão à porta ' + _0x2b2092['nome'] + ')', 'warning');
                } else {
                    _0x1ca1fd('🛡️ [SEGURANÇA] Gateway retornou erro HTTP/interno. Sem retry automático para evitar recarga dupla. Erro: ' + _0x38aff0['message'], 'warning');
                }

                await _0x5a1f53(_0x5c2ee7, _0x657f72, _0x38aff0['message'], _0x2b2092, _0x549a37, _0x233a30, _0x12671d);

                if (isConnectionError) {
                    _0x1ca1fd('🔴\x20' + _0x2b2092['nome'] + '\x20marcada\x20como\x20OFFLINE\x20(erro\x20de\x20conexão)', 'error');
                    _0x2b2092['online'] = ![];
                    _0x2b2092['livre'] = ![];
                    await _0x2372f4('🔴\x20Porta\x20OFFLINE:\x20' + _0x2b2092['nome'] + '\x0a📋\x20Ref:\x20' + _0x5c2ee7 + '\x0a⚠️\x20Erro:\x20' + _0x38aff0['message']);
                }

                if (_0x233a30) {
                    setTimeout(async () => {
                        let _0x54a3d7;
                        const _0x461c50 = ['ilimitado', 'ilimitado_com_extra', 'mensal', 'semanal'],
                            _0x49a073 = _0x461c50['includes'](_0x549a37);
                        
                        if (_0x49a073) {
                            _0x54a3d7 = _0x13e11b['find'](_0x2f115a => _0x2f115a['id'] === 0x2249 && _0x2f115a['online'] && _0x2f115a['livre']);
                        } else {
                            _0x54a3d7 = await _0x5111b8(0x7530, _0x5c2ee7, _0x4faecf);
                        }

                        if (_0x54a3d7) {
                            _0x1ca1fd('🔁\x20Tentando\x20retry\x20em\x20nova\x20porta\x20' + _0x54a3d7['nome'], 'warning');
                            await _0x2f0e92(_0x45ff6b, _0x5c2ee7, _0x4faecf, _0x657f72, _0x4a2a71, _0xf032fd, _0x549a37, _0x54a3d7, _0x330c3c, _0x279d91, _0x12671d);
                        } else {
                            // FIX: Erro de conexão sem porta disponível → usar _enqueueOfflineWait
                            // para NÃO queimar o retryTracker. O item aguarda 30s e tenta novamente.
                            const _0x4a5837 = {
                                'ref': _0x5c2ee7,
                                'jid': _0x4faecf,
                                'numero': _0x657f72,
                                'quantidade': _0x4a2a71,
                                'remetente': _0xf032fd,
                                'tipo': _0x549a37,
                                'tentativas': 0x1,
                                'timestamp': Date['now']()
                            };
                            if (_0x12671d) _0x4a5837['input_val'] = _0x12671d;
                            if (_0x49a073) {
                                _0x4a5837['porta_obrigatoria'] = 0x2249;
                                _0x4a5837['prioridade'] = 0xf;
                            }
                            // FIX: usar _enqueueOfflineWait (SEM gastar retry) em vez de _0x149dcd
                            _enqueueOfflineWait(_0x4a5837, 30000);
                            _0x1ca1fd('⏳ [FIX] Item recolocado em espera offline (SEM gastar retry): ' + _0x5c2ee7 + ' — aguarda 30s', 'info');
                        }
                    }, 0x7530); // FIX: delay aumentado de 800ms para 30s (0x7530) quando sem porta disponível
                } else {
                    await _0x2c5e52('UPDATE\x20referencias\x20SET\x20status=\x27aguardando_resposta\x27\x20WHERE\x20ref=?', [_0x5c2ee7]);
                }
            }
            return ![];
        } finally {
            setTimeout(() => {
                _0x2b714a['delete'](_0x534a9b), _0x536ba5['delete'](_0x534a9b);
            }, 0x7530);
        }
    }
    async function _0x361c51(_0x2aa8cb, _0xea4aa2) {
        const _0x55cd7e = Date['now'](),
            _0x115094 = Math['random']()['toString'](0x24)['substring'](0x2, 0x8),
            _0x692804 = _0x2aa8cb['ref'] + '-' + _0x2aa8cb['numero'] + '-' + _0x2aa8cb['quantidade'] + '-' + _0x55cd7e + '-' + _0x115094;
        let _0x450d3b = null,
            _0x42446 = null;
        if (_0x2aa8cb['blocoId'] && _0x2aa8cb['blocoId']['includes']('-bloco-')) {
            const _0x29204c = _0x2aa8cb['blocoId']['match'](/bloco-(\d+)-de-(\d+)/);
            _0x29204c && (_0x450d3b = parseInt(_0x29204c[0x1]) - 0x1, _0x42446 = parseInt(_0x29204c[0x2]));
        }
        const _0x2bc796 = _0x2aa8cb['tipo'] === 'ilimitado' ? '♾️\x20ILIMITADO' : _0x2aa8cb['tipo'] === 'ilimitado_com_extra' ? '♾️+\x20ILIMITADO\x20COM\x20EXTRAS' : _0x2aa8cb['tipo'] === 'mensal' ? '📅\x20MENSAL' : _0x2aa8cb['tipo'] === '24hrs' ? '⏳\x2024\x20HORas' : _0x2aa8cb['tipo'] === '3dias' ? '📅\x203\x20DIAS' : _0x2aa8cb['tipo'] === 'semanal' ? '📅\x20SEMANAL' : '📦\x20NORMAL';
        _0x1ca1fd('🔄\x20Processando\x20via\x20' + _0xea4aa2['nome'] + ':\x20ref=' + _0x2aa8cb['ref'] + ',\x20numero=' + _0x2aa8cb['numero'] + ',\x20tipo=' + _0x2bc796, 'process');
        try {
            _0xea4aa2['livre'] = ![];
            
            // --- NOVA TRAVA DE SEGURANÇA ANTES DE INICIAR ---
            if (_0x2aa8cb['remetente'] !== 'SISTEMA_PLANOS') {
                const _finalCheck = await _0x3c2652('SELECT status FROM referencias WHERE ref=?', [_0x2aa8cb['ref']]);
                if (_finalCheck && _finalCheck[0] && (_finalCheck[0].status === 'finalizado' || _finalCheck[0].status === 'processada')) {
                    _0x1ca1fd('🚫 KaNet: Cancelando execução duplicada para ref=' + _0x2aa8cb['ref'], 'warning');
                    return;
                }
            }
            // -----------------------------------------------

            const _0x45eb1d = await _0x2f0e92(global['client'], _0x2aa8cb['ref'], _0x2aa8cb['jid'], _0x2aa8cb['numero'], _0x2aa8cb['quantidade'], _0x2aa8cb['remetente'], _0x2aa8cb['tipo'], _0xea4aa2, _0x450d3b, _0x42446, _0x2aa8cb['input_val'] || null, _0x2aa8cb['sobra'] || 0);
            if (_0x45eb1d) _retryTracker.delete(_0x2aa8cb['ref']);
            _0x45eb1d ? _0x1ca1fd('✅\x20Processamento\x20concluído\x20com\x20sucesso\x20via\x20' + _0xea4aa2['nome'] + ':\x20ref=' + _0x2aa8cb['ref'] + ',\x20tipo=' + _0x2bc796, 'success') : (_0x1ca1fd('⚠️\x20Transferência\x20marcada\x20como\x20pendente\x20via\x20' + _0xea4aa2['nome'] + ':\x20ref=' + _0x2aa8cb['ref'], 'warning'), await _0x2c5e52('UPDATE\x20referencias\x20SET\x20status=\x27aguardando_resposta\x27\x20WHERE\x20ref=?', [_0x2aa8cb['ref']]));
        } catch (_0x46cf59) {
            _0x1ca1fd('⚠️\x20Erro\x20crítico\x20no\x20processamento\x20via\x20' + _0xea4aa2['nome'] + ':\x20ref=' + _0x2aa8cb['ref'] + ',\x20erro=' + _0x46cf59['message'], 'error');
            // Se for erro de código (variável não definida), não tentamos de novo para não travar o bot
            if (_0x46cf59 instanceof ReferenceError) {
                _0x1ca1fd('❌ Erro de lógica detectado. Removendo da fila para segurança.', 'error');
                await _0x2c5e52('UPDATE referencias SET status=\'erro_logica\' WHERE ref=?', [_0x2aa8cb['ref']]);
            } else {
                await _0x2c5e52('UPDATE\x20referencias\x20SET\x20status=\x27aguardando_resposta\x27\x20WHERE\x20ref=?', [_0x2aa8cb['ref']]);
            }
        } finally {
            _0xea4aa2['livre'] = !![], _0x557233['emit']('portAvailable', _0xea4aa2), _0x1ca1fd('🔓\x20' + _0xea4aa2['nome'] + '\x20liberada', 'porta');
        }
    }
    async function _0x5044bc() {
        if (_isQueueProcessing) {
            _0x1ca1fd('⚠️ [Fila] Processador de fila já em execução. Ignorando chamada concorrente.', 'info');
            return;
        }
        _isQueueProcessing = true;
        try {
            if (_0x4ef91a['length'] === 0x0) {
                _0x1ca1fd('✅\x20Fila\x20vazia,\x20aguardando\x20novos\x20itens', 'success');
                return;
            }
            await _0x47dccc(!![]);
            const _0x5983cc = _0x13e11b['filter'](_0x9af208 => _0x9af208['online'] && _0x9af208['livre'] && !_0x9af208['sem_saldo']);
            if (_0x5983cc['length'] === 0x0) {
                const _0x2d061d = _0x4ef91a['length'],
                    _0x2a5025 = _0x13e11b['filter'](_0x1b4b62 => _0x1b4b62['online'] && !_0x1b4b62['livre'])['length'];
                _0x1ca1fd('⏳\x20Todas\x20as\x20' + _0x2a5025 + '\x20portas\x20ocupadas,\x20' + _0x2d061d + '\x20item(s)\x20aguardando...', 'warning');
                
                if (_queueTimeoutId) clearTimeout(_queueTimeoutId);
                _queueTimeoutId = setTimeout(() => {
                    _queueTimeoutId = null;
                    _0x1ca1fd('🔄\x20Tentando\x20novamente\x20em\x2015s...', 'info');
                    _0x5044bc();
                }, 0x3a98);
                return;
            }
            _0x1ca1fd('📊\x20' + _0x5983cc['length'] + '\x20porta(s)\x20disponível(eis)\x20para\x20processar\x20' + _0x4ef91a['length'] + '\x20item(ns)', 'info');
            const _0xe11064 = [],
                _0x242553 = [],
                _0x401dca = Math['min'](_0x5983cc['length'], _0x4ef91a['length']);
            for (let _0x4e7db4 = 0x0; _0x4e7db4 < _0x401dca; _0x4e7db4++) {
                if (_0x4ef91a['length'] > 0x0) {
                    const _0x1c27f3 = _0x4ef91a['shift']();
                    
                    // --- TRAVA ANTI-DUPLICIDADE ---
                    try {
                        const _dbStatus = await _0x3c2652('SELECT status FROM referencias WHERE ref=?', [_0x1c27f3['ref']]);
                        if (_dbStatus && _dbStatus.length > 0) {
                            const _st = _dbStatus[0].status;
                            if (_st === 'finalizado' || _st === 'processada' || _st === 'bloco_processado') {
                                _0x1ca1fd('🚫 KaNet Protection: Ignorando duplicata já concluída: ref=' + _0x1c27f3['ref'], 'warning');
                                _0x4e7db4--; // Compensa o loop para não pular um slot de porta
                                continue;
                            }
                            if (_st === 'cancelado') {
                                _0x1ca1fd('🚫 [Fila] Pedido cancelado pelo admin — removendo da fila: ref=' + _0x1c27f3['ref'], 'warning');
                                _0x4e7db4--;
                                continue;
                            }
                            if (_st === 'processando') {
                                _0x1ca1fd('⚠️ KaNet Protection: Item já em processamento ativo: ref=' + _0x1c27f3['ref'] + ' - ignorando', 'warning');
                                _0x4e7db4--;
                                continue;
                            }
                            if (_st === 'aguardando_resposta') {
                                _0x1ca1fd('⏳ KaNet Protection: Item com resposta pendente: ref=' + _0x1c27f3['ref'] + ' - reagendando em 30s', 'warning');
                                _enqueueOfflineWait(_0x1c27f3, 30000);
                                _0x4e7db4--;
                                continue;
                            }
                        }
                    } catch(e) { _0x1ca1fd('⚠️ Erro ao checar duplicidade: ' + e.message, 'warning'); }
                    // ------------------------------

                    let _0x3fe02b;

                    const _isSpecialType = _0x1c27f3['tipo'] === 'saldo' || _0x1c27f3['tipo'] === 'sms_saldo' || 
                                           _0x1c27f3['porta_obrigatoria'] === 0x2249 || 
                                           _0x1c27f3['porta_obrigatoria'] === 8777;

                    if (_isSpecialType) {
                        let _fornecPorts = [];
                        try {
                            const _lcSel = JSON.parse(require('fs').readFileSync(require('path').join(global._kanetBase || __dirname, 'local_config.json'), 'utf8'));
                            const _isFornecOrder = _isPedidoFornecimento(_0x1c27f3);
                            if (_isFornecOrder && _lcSel.telefones_fornecimento && _lcSel.telefones_fornecimento.length > 0) {
                                _fornecPorts = _lcSel.telefones_fornecimento.map(t => parseInt(t.porta));
                            }
                        } catch(e) {}

                        _0x3fe02b = _0x13e11b['find'](_p => {
                            if (!_p['online'] || _p['sem_saldo'] || !_p['livre'] || _0x242553.includes(_p)) return false;
                            return filterPortForRequest(_p, _0x1c27f3);
                        });
                        if (!_0x3fe02b) {
                            const _portaExisteOnline = _0x13e11b.some(_p => _p['online'] && (_p['id'] === 8777 || _p['id'] === 8077 || _p['id'] === 0x2249));
                            if (_portaExisteOnline) {
                                _0x1ca1fd('⏳ Porta 8777 em uso por outro pedido — aguardando libertação: ref=' + _0x1c27f3['ref'], 'warning');
                                _enqueueOfflineWait(_0x1c27f3, 3000);
                            } else {
                                _0x1ca1fd('❌ Porta 8777 OFFLINE — aguardando reativação: ref=' + _0x1c27f3['ref'], 'error');
                                _enqueueOfflineWait(_0x1c27f3, 10000);
                            }
                            continue;
                        }
                    } else {
                        const _0x533069 = _0x5983cc['filter'](_0x5a68b6 => {
                            if (!filterPortForRequest(_0x5a68b6, _0x1c27f3)) return false;
                            return !_0x242553['includes'](_0x5a68b6);
                        });

                        if (_0x533069['length'] === 0x0) {
                            _0x4ef91a['push'](_0x1c27f3);
                            continue;
                        }
                        _0x3fe02b = _0x533069[0x0];
                    }

                    _0xe11064['push'](_0x1c27f3);
                    _0x242553['push'](_0x3fe02b);
                    const _0x282198 = _0x1c27f3['tipo'] === 'ilimitado' ? '♾️ ILIMITADO' : _0x1c27f3['tipo'] === 'mensal' ? '📅 MENSAL' : _0x1c27f3['tipo'] === 'semanal' ? '📅 SEMANAL' : '📦 NORMAL';
                    _0x1ca1fd('🎯 Distribuindo: ' + _0x1c27f3['numero'] + ' → ' + _0x3fe02b['nome'] + ' (' + _0x282198 + ')', 'info');
                }
            }
            await new Promise(_rd => setTimeout(_rd, 0x7d0));
            _isQueueProcessing = false;
            const _execs = _0xe11064['map']((_item, _idx) => _0x361c51(_item, _0x242553[_idx]));
            Promise['allSettled'](_execs).then(() => {
                if (_0x4ef91a['length'] > 0x0) {
                    if (_queueTimeoutId) clearTimeout(_queueTimeoutId);
                    _queueTimeoutId = setTimeout(() => {
                        _queueTimeoutId = null;
                        _0x1ca1fd('🔄 Fila restante: ' + _0x4ef91a['length'] + ' item(ns)', 'info');
                        _0x5044bc();
                    }, 0x2710);
                }
            }).catch(err => {
                _0x1ca1fd('❌ Erro crítico no processamento da fila: ' + err.message, 'error');
            });
        } catch(err) {
            _0x1ca1fd('❌ Erro crítico no processamento da fila: ' + err.message, 'error');
        } finally {
            if (_isQueueProcessing) _isQueueProcessing = false;
        }
    }

    async function _0xCalculateSales(_0xDayOffset = 0x0) {
        try {
            const _0xDatePart = _0xDayOffset === 0x0 ? "date('now', 'localtime')" : "date('now', '" + _0xDayOffset + " day', 'localtime')";
            const _0xQuery = "SELECT SUM(quantidade) as totalMB, COUNT(*) as totalVendas, SUM(valor) as totalRecebido, SUM(CASE WHEN valor IS NOT NULL THEN quantidade ELSE 0 END) as totalMB_pagos FROM referencias WHERE status IN ('processada', 'finalizado', 'bloco_processado') AND date(created_at, 'localtime') = " + _0xDatePart;
            const _0xRows = await _0x3c2652(_0xQuery);
            const _res = _0xRows[0x0] || {};
            return {
                'totalMB': _res['totalMB'] || 0,
                'totalVendas': _res['totalVendas'] || 0,
                'totalRecebido': _res['totalRecebido'] || 0,
                'totalMB_pagos': _res['totalMB_pagos'] || 0
            };
        } catch (_0xErr) {
            _0x1ca1fd('❌ Erro ao calcular vendas: ' + _0xErr['message'], 'error');
            return { 'totalMB': 0, 'totalVendas': 0, 'totalRecebido': 0 };
        }
    }

    async function handleComandoApagarSchedules(_0xClient, _0xJid, _0xMsgId) {
        await _0x461461(_0xClient, _0xJid, "📋 *Apagar Schedules* - Funcionalidade em desenvolvimento.", _0xMsgId);
    }

    function _0x411d22(_0x21fd14, _0x1aada6 = 'normal') {
        const _0xe2270b = {
            'ilimitado': 0x5,
            'ilimitado_com_extra': 0x6,
            'mensal': 0x4,
            '3dias': 0x3,
            'semanal': 0x3,
            '24hrs': 0x2,
            'normal': 0x1
        }[_0x1aada6] || 0x1,
            _0x526129 = _0x21fd14 / 0x400;
        return _0xe2270b + _0x526129;
    }

    async function _0x32432b() {
        _0x1ca1fd('🔧 Tentando reconectar portas imediatamente...', 'info');
        let _0x1a9ae4 = 0, _0xcb03aa = _0x13e11b.length;
        for (let _port of _0x13e11b) {
            try {
                const _ctrl = new AbortController();
                const tm = setTimeout(() => _ctrl.abort(), 12000);
                const _res = await fetch('http://127.0.0.1:' + _port.id + '/health', { signal: _ctrl.signal, headers: { 'Authorization': 'Bearer ' + _0x1f3baf } });
                clearTimeout(tm);
                if (_res.ok) { _port.online = true; _port.livre = true; _0x1a9ae4++; }
                else { _port.online = false; _port.livre = false; }
            } catch (e) { _port.online = false; _port.livre = false; }
        }
        if (_0x1a9ae4 < _0xcb03aa) {
            await new Promise(resolve => setTimeout(resolve, 5000));
            for (let _port of _0x13e11b.filter(p => !p.online)) {
                try {
                    const _ctrl = new AbortController();
                    const tm = setTimeout(() => _ctrl.abort(), 12000);
                    const _res = await fetch('http://127.0.0.1:' + _port.id + '/health', { signal: _ctrl.signal, headers: { 'Authorization': 'Bearer ' + _0x1f3baf } });
                    clearTimeout(tm);
                    if (_res.ok) { _port.online = true; _port.livre = true; _0x1a9ae4++; }
                } catch (e) {}
            }
        }
        return _0x1ca1fd('📊 Reconexão: ' + _0x1a9ae4 + '/' + _0xcb03aa + ' portas online', 'info'), _0x1a9ae4;
    }

    async function handleComandoRelatorio(_0xClient, _0xJid, _0xMsgId, _0xSender) {
        try {
            const _0xisAdmin = (await _0xClient['getGroupAdmins'](_0xJid).then(_admins => _admins['includes'](_0xSender))['catch'](() => ![])) || _0xSender === _0x16260a;
            if (!_0xisAdmin) return _0x1ca1fd('🚫\x20Tentativa\x20de\x20usar\x20!relatorio\x20sem\x20ser\x20admin:\x20' + _0xSender, 'warning');
            const _0xQuery = "SELECT COUNT(*) as total_pedidos, SUM(CASE WHEN status IN ('processada', 'finalizado', 'bloco_processado') THEN 1 ELSE 0 END) as pedidos_sucesso, SUM(CASE WHEN status IN ('processada', 'finalizado', 'bloco_processado') THEN quantidade ELSE 0 END) as mb_sucesso, SUM(CASE WHEN status IN ('processada', 'finalizado', 'bloco_processado') THEN valor ELSE 0 END) as receita_sucesso, SUM(CASE WHEN status IN ('processada', 'finalizado', 'bloco_processado') AND valor IS NOT NULL THEN quantidade ELSE 0 END) as mb_pagos FROM referencias WHERE created_at >= datetime('now', '-24 hours', 'localtime')";
            const _0xRows = await _0x3c2652(_0xQuery);
            const _res = _0xRows[0x0] || {};
            const _peds = _res['pedidos_sucesso'] || 0,
                  _mb = _res['mb_sucesso'] || 0,
                  _rec = _res['receita_sucesso'] || 0,
                  _mb_pagos = _res['mb_pagos'] || 0;
            const _lucro = (_rec - (_mb_pagos * 20.5) / 1024).toFixed(2);
            const _gb = (_mb / 1024).toFixed(2);
            const _txt = '📊 *RELATÓRIO DETALHADO (24H)*\n━━━━━━━━━━━━━━━━━━\n🛍️ *Vendas:* ' + _peds + '\n🌐 *Volume:* ' + _gb + ' GB\n💰 *Recebido:* ' + _rec.toFixed(2) + ' MT\n💚 *Lucro:* ' + _lucro + ' MT\n━━━━━━━━━━━━━━━━━━';
            await _0x461461(_0xClient, _0xJid, _txt, _0xMsgId);
        } catch (_0xErr) {
            _0x1ca1fd('❌ Erro gerar relatório: ' + _0xErr['message'], 'error');
        }
    }

    async function handleComandoHoje(_0xClient, _0xJid, _0xMsgId) {
        const _0xData = await _0xCalculateSales(0x0);
        const _0xTotalMB = _0xData['totalMB'] || 0;
        const _0xTotalVendas = _0xData['totalVendas'] || 0;
        const _0xRecebido = _0xData['totalRecebido'] || 0;
        const _0xTotalMB_pagos = _0xData['totalMB_pagos'] || 0;
        const _0xLucro = (_0xRecebido - (_0xTotalMB_pagos * 20.5) / 1024).toFixed(2);
        const _0xTotalGB = (_0xTotalMB / 1024).toFixed(2);

        // --- NOVAS MÉTRICAS DE CLIENTES ---
        const _statsLeads = await _0x3c2652('SELECT COUNT(*) as total FROM leads');
        const _totalClientes = _statsLeads[0].total || 0;
        const _statsNovos = await _0x3c2652("SELECT COUNT(*) as novos FROM membros_grupos WHERE data_entrada >= date('now', 'localtime')");
        const _novosHoje = _statsNovos[0].novos || 0;

        const _0xText = "📊 *𝗥𝗘𝗟𝗔𝗧𝗢́𝗥𝗜𝗢 𝗗𝗘 𝗩𝗘𝗡𝗗𝗔𝗦 (𝗛𝗢𝗝𝗘)*\n━━━━━━━━━━━━━━━━━━━\n🛍️ *Vendas:* " + _0xTotalVendas + "\n🌐 *Volume:* " + _0xTotalGB + " GB\n💰 *Faturamento:* " + _0xRecebido.toFixed(2) + " MT\n💎 *Lucro Est.:* " + _0xLucro + " MT\n━━━━━━━━━━━━━━━━━━━\n👥 *Base de Clientes:* " + _totalClientes + "\n✨ *Novos no Grupo:* " + _novosHoje + "\n━━━━━━━━━━━━━━━━━━━\n🚀 *KaNet System • Automático*";
        await _0x461461(_0xClient, _0xJid, _0xText, _0xMsgId);
    }

    // --- GERADOR DINÂMICO DE MENU (atualiza automaticamente com .addtabela) ---
    function _gerarMenuDinamico(_tabelas, _especiais, _jid = null) {
        // Se um JID de grupo foi passado, usar a tabela específica desse grupo (se existir)
        const _grpData = _jid && _DYN_CFG && _DYN_CFG.TABELAS_GRUPO && _DYN_CFG.TABELAS_GRUPO[_jid];
        _tabelas = _tabelas || (_grpData && _grpData.TABELAS) || (_DYN_CFG && _DYN_CFG.TABELAS) || {};
        _especiais = _especiais || (_grpData && _grpData.PLANOS_ESPECIAIS) || (_DYN_CFG && _DYN_CFG.PLANOS_ESPECIAIS) || {};

        let _sysName = 'KA-NET 2.0';
        try {
            const _fs = require('fs');
            const _path = require('path');
            const _cfgPath = _path.join(global._kanetBase || __dirname, 'local_config.json');
            if (_fs.existsSync(_cfgPath)) {
                const _cfg = JSON.parse(_fs.readFileSync(_cfgPath, 'utf8'));
                if (_cfg.nome_sistema) _sysName = _cfg.nome_sistema.toUpperCase();
            }
        } catch (e) {}

        function _fmtSize(mb) {
            if (mb >= 1024) {
                const gb = mb / 1024;
                return (gb % 1 === 0 ? gb.toFixed(1) : gb.toFixed(1)) + ' GB';
            }
            return mb + ' MB';
        }
        function _padL(str, len) { while (str.length < len) str = ' ' + str; return str; }

        let _customCab = null;
        if (_jid && _DYN_CFG && _DYN_CFG.TABELAS_GRUPO && _DYN_CFG.TABELAS_GRUPO[_jid] && _DYN_CFG.TABELAS_GRUPO[_jid].cabecalho_menu) {
            _customCab = _DYN_CFG.TABELAS_GRUPO[_jid].cabecalho_menu;
        } else if (_DYN_CFG && _DYN_CFG.cabecalho_menu) {
            _customCab = _DYN_CFG.cabecalho_menu;
        }

        let out = '';
        if (_customCab) {
            out += _customCab + '\n\n';
        } else {
            out += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
            out += `*${_sysName} • LISTA DE PACOTES*\n`;
            out += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
        }

        // DIÁRIOS
        if (_tabelas['24hrs'] && Object.keys(_tabelas['24hrs']).length > 0) {
            out += '⏰ *DIÁRIOS* [Validade: 24H]\n';
            out += '┌─────────────────────────┐\n';
            const sorted = Object.keys(_tabelas['24hrs']).map(Number).sort((a, b) => a - b);
            for (const preco of sorted) {
                const pkg = _tabelas['24hrs'][preco];
                const mb = pkg.quantidade_mb || pkg.quantidade || 0;
                out += `  ${_padL(_fmtSize(mb), 7)}   ➤ ${_padL(String(preco), 4)} MT\n`;
            }
            out += '└─────────────────────────┘\n\n';
        }

        // SEMANAIS
        if (_tabelas['semanal'] && Object.keys(_tabelas['semanal']).length > 0) {
            out += '📆 *SEMANAIS* [Validade: 7 Dias]\n';
            out += '┌─────────────────────────┐\n';
            const sorted = Object.keys(_tabelas['semanal']).map(Number).sort((a, b) => a - b);
            for (const preco of sorted) {
                const pkg = _tabelas['semanal'][preco];
                const mb = pkg.quantidade_mb || pkg.quantidade || 0;
                out += `  ${_padL(_fmtSize(mb), 7)}   ➤ ${_padL(String(preco), 4)} MT\n`;
            }
            out += '└─────────────────────────┘\n\n';
        }

        // MENSAIS
        if (_tabelas['mensal'] && Object.keys(_tabelas['mensal']).length > 0) {
            out += '🗓 *MENSAIS* [Validade: 30 Dias]\n';
            out += '┌─────────────────────────┐\n';
            const sorted = Object.keys(_tabelas['mensal']).map(Number).sort((a, b) => a - b);
            for (const preco of sorted) {
                const pkg = _tabelas['mensal'][preco];
                const mb = pkg.quantidade_mb || pkg.quantidade || 0;
                out += `  ${_padL(_fmtSize(mb), 7)}   ➤ ${_padL(String(preco), 4)} MT\n`;
            }
            out += '└─────────────────────────┘\n\n';
        }

        // PLANOS ESPECIAIS
        if (Object.keys(_especiais).length > 0) {
            out += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
            out += '🚀 *PLANOS ESPECIAIS* [Assinatura]\n';
            out += '┌─────────────────────────┐\n';
            const renovs = [];
            const faseados = [];
            for (const [p, info] of Object.entries(_especiais)) {
                if (info.tipo === 'renovacao') renovs.push([p, info]);
                else if (info.tipo === 'faseado') faseados.push([p, info]);
            }
            renovs.sort((a, b) => Number(a[0]) - Number(b[0]));
            faseados.sort((a, b) => Number(a[0]) - Number(b[0]));
            for (const [p, info] of renovs) {
                out += `  ${info.nome}  ➤ ${_padL(String(p), 4)} MT\n`;
            }
            if (renovs.length > 0 && faseados.length > 0) out += '  \n';
            for (const [p, info] of faseados) {
                out += `  ${info.nome}  ➤ ${_padL(String(p), 4)} MT\n`;
            }
            out += '└─────────────────────────┘\n\n';
        }

        // ILIMITADOS
        const ilimitados = _tabelas['ilimitado'] || {};
        if (Object.keys(ilimitados).length > 0) {
            const voda = [];
            const movi = [];
            for (const [p, info] of Object.entries(ilimitados)) {
                if (info.nome && info.nome.includes('Movi')) movi.push([p, info]);
                else voda.push([p, info]);
            }
            voda.sort((a, b) => Number(a[0]) - Number(b[0]));
            movi.sort((a, b) => Number(a[0]) - Number(b[0]));

            out += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
            out += '📞 *ILIMITADOS + LIGAÇÕES*\n';
            out += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';

            if (voda.length > 0) {
                out += '🔴 *VODACOM* [30 Dias]\n';
                for (const [p, info] of voda) {
                    const mb = info.ativacao_mb || info.quantidade_mb || info.quantidade || 0;
                    const gb = Math.round(mb / 1024);
                    out += `  ${_padL(String(gb), 3)} GB + Minutos  ➤ ${_padL(String(p), 4)} MT\n`;
                }
                out += '\n';
            }
            if (movi.length > 0) {
                out += '🟢 *MOVITEL* [30 Dias]\n';
                for (const [p, info] of movi) {
                    const mb = info.ativacao_mb || info.quantidade_mb || info.quantidade || 0;
                    const gb = Math.round(mb / 1024);
                    out += `  ${_padL(String(gb), 3)} GB + Minutos  ➤ ${_padL(String(p), 4)} MT\n`;
                }
                out += '\n';
            }
        }

        // SALDO / FORNECIMENTO
        if (_tabelas['saldo'] && Object.keys(_tabelas['saldo']).length > 0) {
            out += '💰 *SALDO / FORNECIMENTO*\n';
            out += '┌─────────────────────────┐\n';
            const sorted = Object.keys(_tabelas['saldo']).map(Number).sort((a, b) => a - b);
            for (const preco of sorted) {
                const pkg = _tabelas['saldo'][preco];
                const mb = pkg.quantidade_mb || pkg.quantidade || 0;
                let desc = pkg.nome || `${preco} MT Saldo`;
                if (!pkg.nome && mb > 0) {
                    desc = mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
                }
                out += `  ${_padL(desc, 13)}   ➤ ${_padL(String(preco), 4)} MT\n`;
            }
            out += '└─────────────────────────┘\n\n';
        }

        // Só mostrar diretrizes de Txuna/semanal/mensal se houver pacotes de dados
        const _temDados = (
            (_tabelas['24hrs']     && Object.keys(_tabelas['24hrs']).length     > 0) ||
            (_tabelas['semanal']   && Object.keys(_tabelas['semanal']).length   > 0) ||
            (_tabelas['mensal']    && Object.keys(_tabelas['mensal']).length    > 0) ||
            (_tabelas['ilimitado'] && Object.keys(_tabelas['ilimitado']).length > 0) ||
            (_tabelas['saldo']     && Object.keys(_tabelas['saldo']).length     > 0)
        );
        out += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
        if (_temDados) {
            out += '⚠️ *DIRETRIZES DO SISTEMA*\n';
            out += '• Diários: Aceitam Txuna ativo.\n';
            out += '• Semanais / Mensais / Ilimitados: Não usar Txuna.\n\n';
        }
        out += '📩 *COMO ATIVAR (AUTOMÁTICO)*\n';
        out += '1. Envie o Valor M-Pesa ou E-Mola.\n';
        out += '2. Envie o Comprovativo.\n';
        out += '3. Coloque o número de destino na última linha.\n\n';
        out += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
        out += `🤖 _[${_sysName} Automation System]_`;
        return out;
    }

    // Gerar menu padrão inicial (compatibilidade)
    const _0x5b387d = _gerarMenuDinamico();
    const MENU_TABELA = _0x5b387d;
    function _0x47e76d(_jid, _isFornecOverride = false) {
        // --- GRUPO DE FORNECIMENTO: para tabela/menu mostra APENAS a tabela de Diários ---
        try {
            const _fs = require('fs');
            const _path = require('path');
            const _lcPath = _path.join(global._kanetBase || __dirname, 'local_config.json');
            let _isFornec = !!_isFornecOverride;
            if (!_isFornec && _fs.existsSync(_lcPath)) {
                const _lc = JSON.parse(_fs.readFileSync(_lcPath, 'utf8'));
                const _fornecJid = (_lc.grupo_fornecimento || '').trim();
                const _numJid = (_jid || '').split('@')[0];
                const _numFornec = (_fornecJid || '').split('@')[0];
                if (_fornecJid && (_jid === _fornecJid || (_numJid && _numJid === _numFornec))) {
                    _isFornec = true;
                }
            }

            if (_isFornec) {
                // É o sistema de fornecimento — buscar a tabela do grupo primeiro, depois a global
                const _grpTabs = (_DYN_CFG && _DYN_CFG.TABELAS_GRUPO && _jid && _DYN_CFG.TABELAS_GRUPO[_jid] && _DYN_CFG.TABELAS_GRUPO[_jid].TABELAS) || null;
                const _tabDiarios = (_grpTabs && _grpTabs['saldo'] && Object.keys(_grpTabs['saldo']).length > 0)
                    ? _grpTabs['saldo']
                    : (_grpTabs && _grpTabs['24hrs'] && Object.keys(_grpTabs['24hrs']).length > 0)
                        ? _grpTabs['24hrs']
                        : (_DYN_CFG && _DYN_CFG.TABELAS_SALDO && Object.keys(_DYN_CFG.TABELAS_SALDO).length > 0)
                            ? _DYN_CFG.TABELAS_SALDO
                            : (_DYN_CFG && _DYN_CFG.TABELAS_FORNECIMENTO && Object.keys(_DYN_CFG.TABELAS_FORNECIMENTO).length > 0)
                                ? _DYN_CFG.TABELAS_FORNECIMENTO
                                : (_DYN_CFG && _DYN_CFG.TABELAS && _DYN_CFG.TABELAS['24hrs']) || null;

                    function _padFS(s, l) { while (s.length < l) s = ' ' + s; return s; }
                    function _fmtFornecSize(mb) {
                        if (mb >= 1024) {
                            const gb = mb / 1024;
                            return (gb % 1 === 0 ? gb.toFixed(1) : gb.toFixed(1)) + ' GB';
                        }
                        return mb + ' MB';
                    }
                    const { sysName: _sN } = _getSupportDetails();
                    let _out = `*${_sN} • TABELA*\n`;
                    _out += '━━━━━━━━━━━━━━━\n';
                    _out += '*Tabela De Fornecimento*\n';
                    _out += '┌─────────────────────────┐\n';
                    if (_tabDiarios && Object.keys(_tabDiarios).length > 0) {
                        const _sorted = Object.keys(_tabDiarios).map(Number).sort((a, b) => a - b);
                        for (const _p of _sorted) {
                            const _pk = _tabDiarios[_p];
                            const _qt = _pk.quantidade_mb || _pk.quantidade || 0;
                            _out += `  ${_padFS(_fmtFornecSize(_qt), 7)}   ➤ ${_padFS(String(_p), 4)} MT\n`;
                        }
                    }
                    _out += '└─────────────────────────┘\n\n';
                    _out += '━━━━━━━━━━━━━━━\n';
                    _out += `🤖 _[${_sN} Automation System]_`;
                    return _out;
                }
        } catch (_eFornec) {}

        // --- VERIFICAR SE HÁ TABELA PERSONALIZADA PARA ESTE GRUPO ---
        let _tabelas = null;
        let _especiais = null;

        if (_DYN_CFG && _DYN_CFG.TABELAS_GRUPO && _jid && _DYN_CFG.TABELAS_GRUPO[_jid]) {
            const grpCfg = _DYN_CFG.TABELAS_GRUPO[_jid];
            _tabelas = grpCfg.TABELAS || null;
            _especiais = grpCfg.PLANOS_ESPECIAIS || null;
            console.log('📋 [MENU] Usando tabela personalizada do grupo: ' + _jid);
        }

        // Fallback para tabelas globais
        if (!_tabelas && _DYN_CFG) _tabelas = _DYN_CFG.TABELAS;
        if (!_especiais && _DYN_CFG) _especiais = _DYN_CFG.PLANOS_ESPECIAIS;

        // Gerar menu DINÂMICO a partir dos dados actuais
        let _menuText = _gerarMenuDinamico(_tabelas, _especiais, _jid);

        // Promoção 1GB 24MT para grupo específico (válido por 12h)
        if (_jid === '120363426787478258@g.us' && Date.now() < 1778918400000) {
            _menuText = _menuText.replace('*KA-NET 2.0 • LISTA DE PACOTES*', '*KA-NET 2.0 • LISTA DE PACOTES*\n\n🔥 *PROMOÇÃO RELÂMPAGO (12H)* 🔥\n🔹 1GB ➔ 24 MT (EXCLUSIVO)');
        }

        return _menuText + '\n\n' + _0xb65a79;
    }
    async function handleComandoAmanha(_0xClient, _0xJid, _0xMsgId) {
        const _0xData = await _0xCalculateSales(-1);
        const _mb = _0xData['totalMB'] || 0;
        const _vendas = _0xData['totalVendas'] || 0;
        const _rec = _0xData['totalRecebido'] || 0;
        const _mb_pagos = _0xData['totalMB_pagos'] || 0;
        const _lucro = (_rec - (_mb_pagos * 20.5) / 1024).toFixed(2);
        const _gb = (_mb / 1024).toFixed(2);
        const _txt = "📊 *𝗥𝗘𝗟𝗔𝗧𝗢́𝗥𝗜𝗢 𝗗𝗘 𝗢𝗡𝗧𝗘𝗠*\n━━━━━━━━━━━━━━━━━━━\n🛍️ *Vendas:* " + _vendas + "\n🌐 *Volume:* " + _gb + " GB\n━━━━━━━━━━━━━━━━━━━\n💰 *Recebido:* " + _rec.toFixed(2) + " MT\n💎 *Lucro:* " + _lucro + " MT\n━━━━━━━━━━━━━━━━━━━\n🚀 *KaNet System • Automático*";
        await _0x461461(_0xClient, _0xJid, _txt, _0xMsgId);
    }
    async function handleComandoSchedules(_0xClient, _0xJid, _0xMsgId) {
        await _0x461461(_0xClient, _0xJid, "📋 *Schedules* - Funcionalidade em desenvolvimento.", _0xMsgId);
    }
    async function handleComandoAddSchedule(_0xClient, _0xJid, _0xBody, _0xMsgId) {
        await _0x461461(_0xClient, _0xJid, "📋 *Add Schedule* - Funcionalidade em desenvolvimento.", _0xMsgId);
    }
    async function handleComandoRemoveSchedule(_0xClient, _0xJid, _0xBody, _0xMsgId) {
        await _0x461461(_0xClient, _0xJid, "📋 *Remove Schedule* - Funcionalidade em desenvolvimento.", _0xMsgId);
    }
    async function handleComandoAlterarHora(_0xClient, _0xJid, _0xBody, _0xMsgId) {
        await _0x461461(_0xClient, _0xJid, "📋 *Alterar Hora* - Funcionalidade em desenvolvimento.", _0xMsgId);
    }
    async function handleComandoDebugSchedules(_0xClient, _0xJid, _0xMsgId) {
        await _0x461461(_0xClient, _0xJid, "📋 *Debug Schedules* - Funcionalidade em desenvolvimento.", _0xMsgId);
    }
    async function handleComandoForceTodos(_0xClient, _0xJid, _0xMsgId) {
        await _0x461461(_0xClient, _0xJid, "📋 *Force Todos* - Funcionalidade em desenvolvimento.", _0xMsgId);
    }

    async function _processarEntregasPlanos(_client) {
        try {
            const agora = new Date();
            const agoraISO = agora.toISOString().replace('T', ' ').split('.')[0];
            const pendentes = await _0x3c2652('SELECT * FROM assinaturas_planos WHERE status="ativo" AND data_proxima_entrega <= ?', [agoraISO]);
            
            if (!pendentes || pendentes.length === 0) return;

            for (const plano of pendentes) {
                let mbParaEnviar = 0;
                let novoProximoEnvio = null;
                let novoEntregue = plano.entregue_mb;
                let novoStatus = 'ativo';

                if (plano.tipo === 'renovacao') {
                    const saldoRestante = plano.total_mb - plano.entregue_mb;
                    mbParaEnviar = Math.min(plano.valor_entrega_diaria, saldoRestante); 
                    novoEntregue += mbParaEnviar;
                    
                    const proximaData = new Date(new Date(plano.data_proxima_entrega).getTime() + 22 * 60 * 60 * 1000);
                    novoProximoEnvio = proximaData.toISOString().replace('T', ' ').split('.')[0];
                    
                    if (novoEntregue >= plano.total_mb) novoStatus = 'concluido';
                } else if (plano.tipo === 'faseado') {
                    const saldoRestante = plano.total_mb - plano.entregue_mb;
                    mbParaEnviar = Math.min(plano.valor_entrega_diaria, saldoRestante);
                    novoEntregue += mbParaEnviar;
                    
                    const proximaData = new Date(new Date(plano.data_proxima_entrega).getTime() + 22 * 60 * 60 * 1000);
                    novoProximoEnvio = proximaData.toISOString().replace('T', ' ').split('.')[0];
                    
                    if (novoEntregue >= plano.total_mb) novoStatus = 'concluido';
                }

                if (mbParaEnviar > 0) {
                    _0x1ca1fd(`🚀 Enviando entrega programada: ${mbParaEnviar}MB para ${plano.numero} (Plano: ${plano.tipo})`, 'info');
                    _0x149dcd({ 
                        'ref': 'PLAN-' + Date.now(), 
                        'jid': plano.jid, 
                        'numero': plano.numero, 
                        'quantidade': mbParaEnviar, 
                        'remetente': 'SISTEMA_PLANOS', 
                        'tipo': '24hrs' 
                    });

                    await _0x2c5e52('UPDATE assinaturas_planos SET entregue_mb=?, data_ultima_entrega=CURRENT_TIMESTAMP, data_proxima_entrega=?, status=? WHERE id=?', 
                        [novoEntregue, novoProximoEnvio, novoStatus, plano.id]);
                }
            }
        } catch (e) {
            _0x1ca1fd('❌ Erro ao processar entregas de planos: ' + e.message, 'error');
        }
    }
    async function handleComandoForceTodos(_0xClient, _0xJid, _0xMsgId) {
        await _0x461461(_0xClient, _0xJid, "📋 *Force Todos* - Funcionalidade em desenvolvimento.", _0xMsgId);
    }
    let _0xb65a79 = '';

    function _gerarMenuSaldoExclusivo(_jid) {
        let _tabSaldo = (_DYN_CFG && _DYN_CFG.TABELAS_GRUPO && _jid && _DYN_CFG.TABELAS_GRUPO[_jid] &&
                           _DYN_CFG.TABELAS_GRUPO[_jid].TABELAS && _DYN_CFG.TABELAS_GRUPO[_jid].TABELAS['saldo'])
            ? _DYN_CFG.TABELAS_GRUPO[_jid].TABELAS['saldo']
            : (_DYN_CFG && _DYN_CFG.TABELAS_SALDO && Object.keys(_DYN_CFG.TABELAS_SALDO).length > 0)
                ? _DYN_CFG.TABELAS_SALDO
                : (_DYN_CFG && _DYN_CFG.TABELAS && _DYN_CFG.TABELAS['saldo']) || null;

        if (!_tabSaldo || Object.keys(_tabSaldo).length === 0) {
            _tabSaldo = {
                '45': { quantidade: 50, nome: 'Saldo 50 MT', quantidade_mb: 50 },
                '85': { quantidade: 100, nome: 'Saldo 100 MT', quantidade_mb: 100 },
                '170': { quantidade: 200, nome: 'Saldo 200 MT', quantidade_mb: 200 },
                '410': { quantidade: 500, nome: 'Saldo 500 MT', quantidade_mb: 500 },
                '820': { quantidade: 1000, nome: 'Saldo 1000 MT', quantidade_mb: 1000 }
            };
        }

        const _cabFornec = (_DYN_CFG && _DYN_CFG.TABELAS_GRUPO && _jid && _DYN_CFG.TABELAS_GRUPO[_jid] &&
                            _DYN_CFG.TABELAS_GRUPO[_jid].cabecalho_saldo)
            ? _DYN_CFG.TABELAS_GRUPO[_jid].cabecalho_saldo
            : (_DYN_CFG && _DYN_CFG.cabecalho_saldo) || '💰 *SALDO / CRÉDITO* [Transferência]';

        function _padFS(s, l) { while (s.length < l) s = ' ' + s; return s; }
        const { sysName: _sN } = _getSupportDetails();
        let _out = `✨ *${_sN.toUpperCase()} • TABELA DE SALDO* ✨\n`;
        _out += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
        _out += _cabFornec + '\n';
        _out += '┌─────────────────────────┐\n';
        if (_tabSaldo && Object.keys(_tabSaldo).length > 0) {
            const _sorted = Object.keys(_tabSaldo).map(Number).sort((a, b) => a - b);
            for (const _p of _sorted) {
                const _pk = _tabSaldo[_p];
                const _qt = _pk.quantidade || _pk.quantidade_mb || _p;
                _out += `  ${_padFS(String(_qt), 5)} MT Saldo  ➤ ${_padFS(String(_p), 4)} MT\n`;
            }
        }
        _out += '└─────────────────────────┘\n\n';
        _out += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
        _out += '📩 *COMO ATIVAR (AUTOMÁTICO)*\n';
        _out += '1. Envie o Valor M-Pesa ou E-Mola.\n';
        _out += '2. Envie o Comprovativo.\n';
        _out += '3. Coloque o número de destino na última linha.\n\n';
        _out += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
        _out += `🤖 _[${_sN} Automation System]_`;
        return _out;
    }


    async function _0x59d3d7(_0x1c37c7, _0x6fbb5c, _0x412fa0 = null, _isFornecMsg = false) {
        try {
            console['log']('📤\x20Enviando\x20menu\x20para\x20grupo:\x20' + _0x6fbb5c);
            const _0x26fe54 = _0x47e76d(_0x6fbb5c, _isFornecMsg);
            await _0x461461(_0x1c37c7, _0x6fbb5c, _0x26fe54, _0x412fa0);
            console['log']('✅\x20Menu\x20enviado\x20com\x20sucesso\x20para\x20' + _0x6fbb5c);
        } catch (_0x316125) {
            console['log']('❌\x20Erro\x20ao\x20enviar\x20menu:\x20' + _0x316125['message']);
        }
    }
    async function _0x3bb574(_0x5d9db5, _0x2e7cde, _0x5e84ee = null) {
        return _0x59d3d7(_0x5d9db5, _0x2e7cde, _0x5e84ee);
    }
    async function _0x461461(_0x488726, _0x5a9505, _0x33604d, _0x1ab39b = null) {
        _0x33604d = _premiumFormatter(_0x33604d);
        try {
            if (typeof _0x5a9505 === 'string') {
                if (!_0x5a9505.includes('@')) {
                    _0x5a9505 = _0x5a9505 + '@c.us';
                }
            }

            // --- RESOLUÇÃO DE LID PARA C.US ---
            if (typeof _0x5a9505 === 'string' && _0x5a9505.endsWith('@lid') && _0x488726 && !_0x1ab39b) {
                try {
                    const _contact = await _0x488726.getContact(_0x5a9505);
                    if (_contact) {
                        if (_contact.id && _contact.id.endsWith('@c.us')) {
                            _0x5a9505 = _contact.id;
                        } else if (_contact.phoneNumber) {
                            _0x5a9505 = _contact.phoneNumber.includes('@') ? _contact.phoneNumber : _contact.phoneNumber + '@c.us';
                        }
                    }
                } catch (_errLid) {
                    _0x1ca1fd('⚠️ Falha ao obter contato para LID: ' + _errLid.message, 'warning');
                }
                
                // Backup: Resolver via banco de dados referências
                if (_0x5a9505.endsWith('@lid')) {
                    try {
                        const _dbRes = await _0x3c2652('SELECT remetente, numero FROM referencias WHERE jid = ? AND remetente LIKE "%@c.us" ORDER BY created_at DESC LIMIT 1', [_0x5a9505]);
                        if (_dbRes && _dbRes.length > 0 && _dbRes[0].remetente) {
                            _0x1ca1fd('🔄 Resolvendo LID para @c.us via DB remetente: ' + _dbRes[0].remetente, 'info');
                            _0x5a9505 = _dbRes[0].remetente;
                        } else {
                            const _dbRes2 = await _0x3c2652('SELECT numero FROM referencias WHERE jid = ? ORDER BY created_at DESC LIMIT 1', [_0x5a9505]);
                            if (_dbRes2 && _dbRes2.length > 0 && _dbRes2[0].numero) {
                                let _clean = String(_dbRes2[0].numero).replace(/\D/g, '');
                                if (!_clean.startsWith('258')) _clean = '258' + _clean;
                                _0x1ca1fd('🔄 Resolvendo LID para @c.us via DB numero: ' + _clean + '@c.us', 'info');
                                _0x5a9505 = _clean + '@c.us';
                            }
                        }
                    } catch (_errDbLid) {
                        _0x1ca1fd('⚠️ Falha ao buscar mapping LID no DB: ' + _errDbLid.message, 'warning');
                    }
                }
            }

            // --- BLOQUEIO DE SEGURANÇA: NUNCA ENVIAR PARA GRUPOS CONCORRENTES ---
            if (global['gruposConcorrentes'] && global['gruposConcorrentes'].has(_0x5a9505)) {
                _0x1ca1fd('⛔ SEGURANÇA: Envio para grupo concorrente bloqueado (' + _0x5a9505 + ')', 'warning');
                return;
            }
            
            _0x1ca1fd('📤 Respondendo para ' + _0x5a9505 + ( _0x1ab39b ? ' (Reply)' : ' (Texto)'), 'info');
            
            if (!_0x488726) {
                _0x1ca1fd('❌ Erro: Cliente WhatsApp não inicializado na função de envio', 'error');
                return;
            }

            if (_0x488726['reply'] && _0x1ab39b) {
                try {
                    const _replyResult = await _0x488726['reply'](_0x5a9505, _0x33604d, _0x1ab39b);
                    if (_replyResult) {
                        _0x1ca1fd('✅ Resposta enviada com sucesso (reply) para ' + _0x5a9505, 'success');
                        return;
                    }
                    _0x1ca1fd('⚠️ reply() retornou null (possivelmente Not a contact). Tentando sendText...', 'warning');
                } catch (_errReply) {
                    _0x1ca1fd('⚠️ Falha ao responder: ' + _errReply.message + '. Tentando envio de texto simples...', 'warning');
                }
            }
            
            if (_0x5a9505.endsWith('@lid')) {
                _0x1ca1fd('⚠️ LID sem reply_id válido, mensagem omitida para: ' + _0x5a9505, 'warning');
                return;
            }

            // open-wa retorna null para "Not a contact" sem lançar exceção
            // Tentamos sendText e verificamos o retorno
            let _sendResult = null;
            if (_0x488726['sendText']) {
                _sendResult = await _0x488726['sendText'](_0x5a9505, _0x33604d);
            } else if (_0x488726['sendMessage']) {
                _sendResult = await _0x488726['sendMessage'](_0x5a9505, _0x33604d);
            }
            
            if (_sendResult) {
                _0x1ca1fd('✅ Resposta enviada com sucesso para ' + _0x5a9505, 'success');
                return;
            }
            
            // Fallback: tentar via número sem o @c.us (alguns métodos aceitam só o número)
            _0x1ca1fd('⚠️ sendText retornou null para ' + _0x5a9505 + ' - open-wa rejeitou (Not a contact?). Tentando fallback...', 'warning');
            const _numOnly = _0x5a9505.replace('@c.us', '').replace('@s.whatsapp.net', '');
            if (_0x488726['sendTextToPhone']) {
                const _r2 = await _0x488726['sendTextToPhone'](_numOnly, _0x33604d).catch(() => null);
                if (_r2) { _0x1ca1fd('✅ Mensagem enviada via sendTextToPhone para ' + _numOnly, 'success'); 
                if (global._botClient && pedido.jid) {
                    const { sysName: _sN } = (global._getSupportDetails && global._getSupportDetails()) || { sysName: 'Ka-Net' };
                    await global._botClient.sendMessage(pedido.jid,
                        `❌ *PEDIDO CANCELADO*\n━━━━━━━━━━━━━━━━━━━\nO seu pedido *#${ref}* foi cancelado pelo administrador.\n\nSe tiver dúvidas, entre em contacto connosco.\n━━━━━━━━━━━━━━━━━━━\n🚀 ${_sN} • Sempre ao seu dispor!`
                    );
                }
                return; }
            }
            // Último recurso: forçar abertura do chat e reenviar
            if (_0x488726['openChat']) {
                try {
                    await _0x488726['openChat'](_0x5a9505);
                    await new Promise(r => setTimeout(r, 800));
                    const _r3 = await _0x488726['sendText'](_0x5a9505, _0x33604d).catch(() => null);
                    if (_r3) { _0x1ca1fd('✅ Mensagem enviada após openChat para ' + _0x5a9505, 'success'); return; }
                } catch(_oc) { _0x1ca1fd('⚠️ openChat falhou: ' + _oc.message, 'warning'); }
            }
            _0x1ca1fd('❌ Impossível enviar mensagem para ' + _0x5a9505 + ' - todos os métodos falharam (Not a contact / sem licença)', 'error');
        } catch (_0x3e0176) {
            _0x1ca1fd('❌ ERRO NO ENVIO WHATSAPP (' + _0x5a9505 + '): ' + _0x3e0176['message'], 'error');
            console.error('Stack:', _0x3e0176);
        }
    }
    let _0x10228a = {};

    function _0x1c3178(_0x17085d, _0x46dd09 = null) {
        let _0x5e3293 = _0x17085d;
        _0x46dd09 && (_0x5e3293 += ':\x20' + _0x46dd09['message'] + '\x0aStack:\x20' + _0x46dd09['stack'] + '\x0aDetails:\x20' + JSON['stringify'](_0x46dd09, null, 0x2), console['error'](_0x5e3293)), _0x32d49c['appendFileSync'](_0xc025ef, new Date()['toISOString']() + '\x20-\x20' + _0x5e3293 + '\x0a');
    }
    async function _0xf94125(_0x44458d) {
        try {
            if (global['client'] && typeof global['client']['sendText'] === 'function') try {
                await global['client']['sendText'](_0x23fc97, _0x44458d), _0x1c3178('🔔\x20Notificação\x20enviada\x20ao\x20admin:\x20' + _0x44458d), await global['client']['sendText'](_0x40b822, _0x44458d), _0x1c3178('🔔\x20Notificação\x20enviada\x20ao\x20grupo:\x20' + _0x44458d);
            } catch (_0x4ec0b9) {
                console['log']('🔔\x20[SIMULAÇÃO]\x20Notificação\x20para\x20admin:\x20' + _0x44458d), console['log']('🔔\x20[SIMULAÇÃO]\x20Notificação\x20para\x20grupo:\x20' + _0x44458d), _0x1c3178('⚠️\x20Notificação\x20simulada\x20(erro\x20de\x20licença/contato):\x20' + _0x44458d);
            } else console['log']('🔔\x20[SIMULAÇÃO]\x20Notificação\x20para\x20admin:\x20' + _0x44458d), console['log']('🔔\x20[SIMULAÇÃO]\x20Notificação\x20para\x20grupo:\x20' + _0x44458d), _0x1c3178('⚠️\x20Cliente\x20WhatsApp\x20não\x20disponível,\x20notificação\x20simulada:\x20' + _0x44458d);
        } catch (_0x3253a1) {
            console['log']('🔔\x20[SIMULAÇÃO]\x20Notificação\x20para\x20admin:\x20' + _0x44458d), console['log']('🔔\x20[SIMULAÇÃO]\x20Notificação\x20para\x20grupo:\x20' + _0x44458d), _0x1c3178('❌\x20Erro\x20crítico\x20em\x20notifyAdmin,\x20simulando:\x20' + _0x3253a1['message']);
        }
    }
    async function _0xa27d1b(_0xeb25eb) {
        try {
            if (!global['client'] || typeof global['client']['sendText'] !== 'function') {
                console['error']('⚠️\x20Cliente\x20WhatsApp\x20não\x20inicializado');
                return;
            }
            await global['client']['sendText'](_0x23fc97, _0xeb25eb), console['log']('📨\x20Mensagem\x20enviada\x20ao\x20admin\x20com\x20sucesso'), await global['client']['sendText'](_0x40b822, _0xeb25eb), console['log']('📨\x20Mensagem\x20enviada\x20ao\x20grupo\x20com\x20sucesso');
        } catch (_0x2252c0) {
            console['error']('❌\x20Erro\x20ao\x20enviar\x20mensagem\x20ao\x20admin/grupo:', _0x2252c0);
        }
    }
    async function _0x3a505d() {
        try {
            await _0x3c2652('\x0a\x20\x20\x20\x20\x20\x20CREATE\x20TABLE\x20IF\x20NOT\x20EXISTS\x20referencias\x20(\x0a\x20\x20\x20\x20\x20\x20\x20\x20ref\x20TEXT\x20PRIMARY\x20KEY,\x0a\x20\x20\x20\x20\x20\x20\x20\x20numero\x20TEXT,\x0a\x20\x20\x20\x20\x20\x20\x20\x20valor\x20REAL,\x0a\x20\x20\x20\x20\x20\x20\x20\x20quantidade\x20REAL,\x0a\x20\x20\x20\x20\x20\x20\x20\x20sms\x20TEXT,\x0a\x20\x20\x20\x20\x20\x20\x20\x20comprovativo\x20TEXT,\x0a\x20\x20\x20\x20\x20\x20\x20\x20status\x20TEXT,\x0a\x20\x20\x20\x20\x20\x20\x20\x20jid\x20TEXT,\x0a\x20\x20\x20\x20\x20\x20\x20\x20remetente\x20TEXT,\x0a\x20\x20\x20\x20\x20\x20\x20\x20tipo\x20TEXT\x20DEFAULT\x20\x27normal\x27,\x0a\x20\x20\x20\x20\x20\x20\x20\x20created_at\x20DATETIME\x20DEFAULT\x20CURRENT_TIMESTAMP,\x0a\x20\x20\x20\x20\x20\x20\x20\x20comprovativo_recebido\x20INTEGER\x20DEFAULT\x200,\x0a\x20\x20\x20\x20\x20\x20\x20\x20sms_recebido\x20INTEGER\x20DEFAULT\x200,\x0a\x20\x20\x20\x20\x20\x20\x20\x20comprovativo_msg_id\x20TEXT,\x0a\x20\x20\x20\x20\x20\x20\x20\x20divisoes\x20TEXT,\x0a\x20\x20\x20\x20\x20\x20\x20\x20sobra\x20REAL\x20DEFAULT\x200\x0a\x20\x20\x20\x20\x20\x20)\x0a\x20\x20\x20\x20');
            try { await _0x3c2652('ALTER TABLE referencias ADD COLUMN sobra REAL DEFAULT 0'); } catch(e) {}
            try { 
                await _0x3c2652('CREATE TABLE IF NOT EXISTS bonus_referencia (jid TEXT PRIMARY KEY, parent_jid TEXT, total_convidados INTEGER DEFAULT 0)');
                await _0x3c2652('CREATE TABLE IF NOT EXISTS bonus_contribuicoes (id INTEGER PRIMARY KEY AUTOINCREMENT, parent_jid TEXT, indicado_jid TEXT, mb INTEGER, status TEXT DEFAULT "pendente", created_at DATETIME DEFAULT CURRENT_TIMESTAMP)');
                await _0x3c2652('CREATE TABLE IF NOT EXISTS piadas_usadas (id INTEGER PRIMARY KEY AUTOINCREMENT, joke_hash TEXT UNIQUE, joke_text TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)');
                await _0x3c2652('CREATE TABLE IF NOT EXISTS cupons_clientes (jid TEXT, cupom TEXT, status TEXT DEFAULT "ativo", created_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(jid, cupom))');
                await _0x3c2652('CREATE TABLE IF NOT EXISTS notificacoes_reativacao (jid TEXT, tipo TEXT, data_envio DATE, last_purchase_ref TEXT, PRIMARY KEY(jid, tipo, last_purchase_ref))');
                await _0x3c2652('CREATE TABLE IF NOT EXISTS leads (jid TEXT PRIMARY KEY, nome TEXT, ultima_compra DATETIME DEFAULT CURRENT_TIMESTAMP, total_mb INTEGER DEFAULT 0, is_blocked INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)');
                await _0x3c2652('CREATE TABLE IF NOT EXISTS membros_grupos (jid TEXT NOT NULL, group_jid TEXT NOT NULL, data_entrada DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (jid, group_jid))');
            } catch(e) {}
            await _0x3c2652('CREATE TABLE IF NOT EXISTS bonus_diarios (id INTEGER PRIMARY KEY AUTOINCREMENT, numero TEXT, quantidade INTEGER, hora INTEGER, minuto INTEGER, status TEXT DEFAULT "ativo", created_at DATETIME DEFAULT CURRENT_TIMESTAMP)');
            await _0x3c2652('CREATE TABLE IF NOT EXISTS group_infractions (jid TEXT, group_jid TEXT, count INTEGER DEFAULT 0, PRIMARY KEY (jid, group_jid))');
            await _0x3c2652('CREATE TABLE IF NOT EXISTS grupos_concorrentes (group_jid TEXT PRIMARY KEY, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)');
            await _0x3c2652('CREATE TABLE IF NOT EXISTS group_tabelas (group_jid TEXT NOT NULL, preco INTEGER NOT NULL, quantidade_mb INTEGER NOT NULL, nome TEXT NOT NULL, periodo TEXT DEFAULT "24hrs", PRIMARY KEY (group_jid, preco))');
            // Resetar status de pedidos na_fila ou processando ao iniciar (já que a fila em memória do bot está limpa)
            try {
                await _0x3c2652("UPDATE referencias SET status = 'aguardando_numero' WHERE status IN ('na_fila', 'processando') AND (numero IS NULL OR numero = 'nenhum' OR numero = '')");
                await _0x3c2652("UPDATE referencias SET status = 'aguardando_confirmacao' WHERE status IN ('na_fila', 'processando') AND numero IS NOT NULL AND numero != 'nenhum' AND numero != ''");
            } catch(e) {}
            // Recarregar itens pendentes da BD para a fila em memória (para processar assim que as portas estiverem online)
            try {
                const _pendentesReload = await _0x3c2652(
                    "SELECT * FROM referencias WHERE status = 'aguardando_confirmacao' AND numero IS NOT NULL AND numero != 'nenhum' AND numero != '' AND datetime(created_at) >= datetime('now', '-24 hours') ORDER BY rowid ASC LIMIT 30"
                );
                if (_pendentesReload && _pendentesReload.length > 0) {
                    _0x1ca1fd('🔄 [ARRANQUE] Recarregando ' + _pendentesReload.length + ' itens pendentes da BD para a fila...', 'info');
                    for (const _pr of _pendentesReload) {
                        // Usar setTimeout escalonado para não sobrecarregar no arranque
                        setTimeout(() => {
                            _0x149dcd({
                                ref: _pr.ref,
                                jid: _pr.jid,
                                numero: _pr.numero,
                                valor: _pr.valor,
                                quantidade: _pr.quantidade,
                                tipo: _pr.tipo || '24hrs',
                                comprovativo_msg_id: _pr.comprovativo_msg_id,
                                remetente: _pr.remetente,
                                sobra: _pr.sobra || 0,
                                prioridade: 5,
                                status: 'na_fila'
                            });
                        }, 8000); // Aguarda 8s para as portas iniciarem
                    }
                }
            } catch(_eReload) {
                _0x1ca1fd('⚠️ [ARRANQUE] Erro ao recarregar fila pendente: ' + _eReload.message, 'warning');
            }
            _0x1ca1fd('🟢 Banco de dados inicializado com sucesso', 'success');
        } catch (_0x3f33b5) {
            _0x1ca1fd('❌\x20Erro\x20ao\x20inicializar\x20banco\x20de\x20dados', 'error');
            throw _0x3f33b5;
        }
    }

    function _0xf8719e(_0x4cfa29) {
        if (!_0x4cfa29) return null;
        const _commonWords = ['CONFIRMADO', 'RECEBESTE', 'TRANSFERISTE', 'SALDO', 'VODACOM', 'MOVITEL', 'EMOLA', 'MPESA', 'PAGAMENTO', 'OPERADORA', 'ID\x20DA\x20TRANSACAO', 'CONTA'];
        const _regex = /\b([A-Z0-9]{6,25}(?:\.[A-Z0-9]{2,15})*)\b/gi;
        let _match;
        let _results = [];
        
        while ((_match = _regex.exec(_0x4cfa29)) !== null) {
            const _ref = _match[1].toUpperCase();
            if (_commonWords.includes(_ref)) continue;
            
            // --- FILTRO DE TELEFONE (Bloqueia 2588... e 82/84/85/86/87...) ---
            if (/^(258)?(8[2-7]\d{7})$/.test(_ref)) {
                 _0x1ca1fd('🔍 Candidato a Ref descartado (é um telefone): ' + _ref, 'info');
                 continue;
            }

            // Um código de transação real deve ter números e letras
            const _temLetra = /[A-Z]/.test(_ref);
            const _temNumero = /[0-9]/.test(_ref);
            
            if (_temLetra && _temNumero) {
                _results.push({ val: _ref, score: 100 }); // Prioridade máxima: Misto
            } else if (_ref.length >= 10 && _temLetra) {
                _results.push({ val: _ref, score: 50 });  // Apenas letras mas longo
            } else if (_ref.length >= 6 && _temNumero) {
                _results.push({ val: _ref, score: 40 });  // Apenas números mas passou no filtro de telefone
            }
        }
        
        if (_results.length === 0) return null;
        // Retornar o que tiver melhor pontuação
        return _results.sort((a,b) => b.score - a.score || b.val.length - a.val.length)[0].val;
    }

    function _0x1c9c6a(_0x5c9fd5) {
        // SEMPRE esperar o numero que o cliente vai enviar, entao ignorar a extração automatica de numero do texto do mpesa.
        return null;
        if (!_0x5c9fd5 || typeof _0x5c9fd5 !== 'string') return null;
        const _0x8a0945 = _0x5c9fd5['toLowerCase']();
        
        // --- NÚMEROS DE DEPÓSITO E SUPORTE DO BOT (A SEREM IGNORADOS COMO DESTINO) ---
        const botNumbers = [
            '856268811', '258856268811',
            '864882152', '258864882152',
            '856116039', '258856116039',
            '850401416', '258850401416'
        ];

        // --- TENTAR EXTRAIR GRUPOS CONSECUTIVOS DE DÍGITOS QUE FORMAM UM TELEFONE ---
        const digitGroups = [];
        const digitRegex = /\d+/g;
        let match;
        while ((match = digitRegex.exec(_0x5c9fd5)) !== null) {
            digitGroups.push({
                val: match[0],
                start: match.index,
                end: digitRegex.lastIndex
            });
        }

        const validNumbers = [];
        const allowedSeparators = /^[\s\-()./+]*$/;

        for (let i = 0; i < digitGroups.length; i++) {
            for (let j = i; j < digitGroups.length; j++) {
                // Verificar se todos os separadores entre os grupos consecutivos são válidos e curtos
                let isValidSequence = true;
                for (let k = i; k < j; k++) {
                    const intermediateText = _0x5c9fd5.substring(digitGroups[k].end, digitGroups[k + 1].start);
                    if (!allowedSeparators.test(intermediateText) || intermediateText.length > 5) {
                        isValidSequence = false;
                        break;
                    }
                }
                if (!isValidSequence) continue;

                // Concatenar os grupos de dígitos sequenciais
                let combined = '';
                for (let k = i; k <= j; k++) {
                    combined += digitGroups[k].val;
                }

                const isValid9 = combined.length === 9 && /^8[2-7]\d{7}$/.test(combined);
                const isValid12 = combined.length === 12 && /^2588[2-7]\d{7}$/.test(combined);

                if (isValid9 || isValid12) {
                    const normalized = isValid9 ? '258' + combined : combined;
                    const clean9 = normalized.substring(3);
                    
                    // --- APENAS VODACOM (84 ou 85) ---
                    const isVodacom = clean9.startsWith('84') || clean9.startsWith('85');
                    
                    if (isVodacom && !botNumbers.includes(normalized) && !botNumbers.includes(clean9)) {
                        validNumbers.push(normalized);
                    }
                }
            }
        }

        if (validNumbers.length > 0) {
            // Retorna o último telefone não-bot válido encontrado
            return validNumbers[validNumbers.length - 1];
        }

        // --- COMPORTAMENTO PADRÃO DE BACKUP ---
        const _0x115c71 = ['transferiste', 'id\x20da\x20transacao', 'confirmado', 'saldo', 'taxa'],
            _0x41fa8f = _0x115c71['some'](_0x439bde => _0x8a0945['includes'](_0x439bde)),
            _0xb9efc0 = ['obrigado', 'em\x20caso\x20de\x20duvida', 'liga\x20100'];
        let _0x132fa2 = -0x1;
        for (const _0x1e416 of _0xb9efc0) {
            const _0x597eb2 = _0x8a0945['lastIndexOf'](_0x1e416);
            if (_0x597eb2 > _0x132fa2) _0x132fa2 = _0x597eb2;
        }
        let _0x1422a9 = _0x5c9fd5;
        if (_0x132fa2 !== -0x1) _0x1422a9 = _0x5c9fd5['slice'](_0x132fa2);
        else {
            if (_0x41fa8f) {
                const _0x4c2519 = _0x5c9fd5['split']('\x0a')['map'](_0xe06755 => _0xe06755['trim']())['filter'](Boolean),
                    _0x54175d = _0x4c2519[_0x4c2519['length'] - 0x1];
                if (/^(?:258)?8[2-7]\d{7}$/['test'](_0x54175d)) return _0x54175d['startsWith']('258') ? _0x54175d : '258' + _0x54175d;
                return null;
            }
        }
        const _0x312952 = /\b(?:258)?(8[2-7]\d{7})\b/g,
            _0x28a975 = [..._0x1422a9['matchAll'](_0x312952)];
        if (!_0x28a975['length']) return null;
        return '258' + _0x28a975[_0x28a975['length'] - 0x1][0x1];
    }

    function _0x1441e6(_0x3e909e) {
        const _0x4b9eb9 = /\b(?<!8[2-7])([A-Z0-9]{8,20}(?:\.[A-Z0-9]{2,10})*)\b/,
            _0x1eb108 = _0x3e909e['match'](_0x4b9eb9),
            _0x104457 = _0x1c9c6a(_0x3e909e);
        return _0x1eb108 && _0x104457 ? {
            'ref': _0x1eb108[0x1],
            'numero': _0x104457
        } : null;
    }

    function _0x3d5bec(_0x565b4f) {
        const _0x3e4416 = /([\d.,]+)\s*MT\b/i,
            _0x22f6c0 = _0x565b4f['match'](_0x3e4416),
            _0x1d6557 = /Transferiste\s+([\d.,]+)\s*MT/i,
            _0x33168a = _0x565b4f['match'](_0x1d6557),
            _0x2e4373 = /Recebeste\s+([\d.,]+)\s*MT/i,
            _0x563a0f = _0x565b4f['match'](_0x2e4373),
            _0x4b4ae7 = /([\d.,]+)\s*MT\b/i,
            _0x1e3d44 = _0x565b4f['match'](_0x4b4ae7),
            _0x598e01 = /(\d+(?:[.,]\d+)?)\s*MT/i,
            _0x1d5caf = _0x565b4f['match'](_0x598e01);
        let _0x24e04b = null;
        if (_0x33168a) _0x24e04b = _0x33168a[0x1], console['log']('🔍\x20Encontrado\x20via\x20Transferiste:\x20' + _0x24e04b);
        else {
            if (_0x563a0f) _0x24e04b = _0x563a0f[0x1], console['log']('🔍\x20Encontrado\x20via\x20Recebeste:\x20' + _0x24e04b);
            else {
                if (_0x22f6c0) _0x24e04b = _0x22f6c0[0x1], console['log']('🔍\x20Encontrado\x20via\x20padrão\x20moçambicano:\x20' + _0x24e04b);
                else {
                    if (_0x1e3d44) _0x24e04b = _0x1e3d44[0x1], console['log']('🔍\x20Encontrado\x20via\x20padrão\x20europeu:\x20' + _0x24e04b);
                    else _0x1d5caf && (_0x24e04b = _0x1d5caf[0x1], console['log']('🔍\x20Encontrado\x20via\x20padrão\x20simples:\x20' + _0x24e04b));
                }
            }
        }
        if (!_0x24e04b) return null;
        return _0x347779(_0x24e04b);
    }

    function _0x347779(_0x44ba73) {
        console['log']('🔍\x20Processando\x20valor:\x20\x22' + _0x44ba73 + '\x22'), _0x44ba73 = _0x44ba73['replace'](/\s/g, '');
        const _0x24ce83 = _0x44ba73['includes']('.'),
            _0x7d28a7 = _0x44ba73['includes'](',');
        if (_0x7d28a7 && _0x24ce83) {
            const _0x5db353 = _0x44ba73['indexOf'](','),
                _0x39dc8b = _0x44ba73['indexOf']('.');
            _0x5db353 < _0x39dc8b ? (console['log']('🔍\x20Formato\x20moçambicano\x20detectado:\x20vírgula=milhar,\x20ponto=decimal'), _0x44ba73 = _0x44ba73['replace'](/,/g, '')) : (console['log']('🔍\x20Formato\x20europeu\x20detectado:\x20ponto=milhar,\x20vírgula=decimal'), _0x44ba73 = _0x44ba73['replace'](/\./g, '')['replace'](',', '.'));
        } else {
            if (_0x7d28a7 && !_0x24ce83) {
                const _0x1aa726 = _0x44ba73['split'](',');
                _0x1aa726[0x1] && _0x1aa726[0x1]['length'] <= 0x2 ? (console['log']('🔍\x20Formato\x20decimal\x20com\x20vírgula\x20detectado'), _0x44ba73 = _0x44ba73['replace'](',', '.')) : (console['log']('🔍\x20Formato\x20milhar\x20com\x20vírgula\x20detectado'), _0x44ba73 = _0x44ba73['replace'](/,/g, ''));
            } else {
                if (_0x24ce83 && !_0x7d28a7) {
                    const _0xe4f87c = _0x44ba73['split']('.');
                    _0xe4f87c[0x1] && _0xe4f87c[0x1]['length'] <= 0x2 ? console['log']('🔍\x20Formato\x20decimal\x20com\x20ponto\x20detectado') : (console['log']('🔍\x20Formato\x20milhar\x20com\x20ponto\x20detectado'), _0x44ba73 = _0x44ba73['replace'](/\./g, ''));
                } else console['log']('🔍\x20Formato\x20inteiro\x20detectado');
            }
        }
        const _0x3345fb = parseFloat(_0x44ba73);
        return console['log']('🔍\x20Valor\x20processado:\x20' + _0x3345fb + '\x20(de:\x20' + _0x44ba73 + ')'), isNaN(_0x3345fb) ? null : _0x3345fb;
    }

    function _0x38787d(_0x330a9c) {
        const _0x23ff5e = _0x330a9c['match'](/Transferiste com sucesso (\d+)MB.*?para o numero (258[2-7]\d{7})/);
        return _0x23ff5e ? {
            'quantidade': parseInt(_0x23ff5e[0x1]),
            'numero': _0x23ff5e[0x2]
        } : null;
    }

    function _0x2807cf(_0x250825) {
        return /(Transferência realizada com sucesso|Transferiste com sucesso)/i['test'](_0x250825);
    }

    function _0x2a7a02(_0x2ab151) {
        const _0x337fa3 = /((https?:\/\/|www\.|bit\.ly\/|t\.co\/)[^\s]+)/i;
        return _0x337fa3['test'](_0x2ab151);
    }

    function _0x15e80b(_0x2f952e, _0x3fe726, _0x362712 = 'normal') {
        const _0xbe857b = 0x400,
            _0x511693 = [],
            _0x36d891 = Math['round'](_0x3fe726 * _0xbe857b),
            _0x14770b = 0xa * _0xbe857b,
            _0x59fece = Math['floor'](_0x36d891 / _0x14770b),
            _0x56fcc9 = _0x36d891 % _0x14770b;
        for (let _0x5e9ace = 0x0; _0x5e9ace < _0x59fece; _0x5e9ace++) {
            _0x511693['push']({
                'numero': _0x2f952e,
                'quantidade': _0x14770b
            });
        }
        return _0x56fcc9 > 0x0 && _0x511693['push']({
            'numero': _0x2f952e,
            'quantidade': _0x56fcc9
        }), _0x511693;
    }

    function _0x202af4(_0x88a728, _0x2a7acf, _0x3630b2 = 'normal') {
        const _0x4a20f3 = 0x400,
            _0x4d26e2 = _0x88a728['split'](/\r?\n/)['map'](_0x2bdcea => _0x2bdcea['trim']())['filter'](Boolean),
            _0x4495a2 = [],
            _0x737fc4 = [];
        for (const _0x117b55 of _0x4d26e2) {
            const _0x3ddf8b = _0x117b55['match'](/^((258)?(8[2-7]\d{7}))[\s,→.-]*([\d.,]+)?\s*(?:GB)?$/i),
                _0x41ea9f = _0x117b55['match'](/^([\d.,]+)\s*(?:GB)?[\s,→.-]*((258)?(8[2-7]\d{7}))$/i);
            let _0x26cd59 = null,
                _0x21c4cc = null;
            if (_0x3ddf8b) _0x26cd59 = _0x3ddf8b[0x1], _0x21c4cc = _0x3ddf8b[0x4] ? parseFloat(_0x3ddf8b[0x4]['replace'](',', '.')) : null;
            else _0x41ea9f && (_0x26cd59 = _0x41ea9f[0x2], _0x21c4cc = _0x41ea9f[0x1] ? parseFloat(_0x41ea9f[0x1]['replace'](',', '.')) : null);
            _0x26cd59 && (!_0x26cd59['startsWith']('258') && (_0x26cd59 = '258' + _0x26cd59), _0x21c4cc !== null && isNaN(_0x21c4cc) && (_0x21c4cc = null), /^2588[2-7]\d{7}$/['test'](_0x26cd59) ? _0x21c4cc !== null ? _0x4495a2['push']({
                'numero': _0x26cd59,
                'qtdGB': _0x21c4cc
            }) : _0x737fc4['push'](_0x26cd59) : console['log']('⚠️\x20Número\x20inválido\x20ignorado:\x20' + _0x26cd59));
        }
        const _0xc8c955 = _0x2a7acf / _0x4a20f3;
        let _0x202a26 = [];
        for (const _0x53d3aa of _0x4495a2) {
            let _0x4c708f = _0x53d3aa['qtdGB'];
            while (_0x4c708f > 0x0) {
                const _0x29b3fd = Math['min'](0xa, _0x4c708f);
                _0x202a26['push']({
                    'numero': _0x53d3aa['numero'],
                    'quantidadeGB': _0x29b3fd,
                    'origem': 'especificado'
                }), _0x4c708f -= _0x29b3fd;
            }
        }
        const _0x463c55 = _0x202a26['reduce']((_0x50536a, _0x54308f) => _0x50536a + _0x54308f['quantidadeGB'], 0x0),
            _0x2001ef = _0xc8c955 - _0x463c55;
        if (_0x737fc4['length'] > 0x0 && _0x2001ef > 0x0) {
            const _0x504354 = Math['floor'](_0x2001ef / 0xa),
                _0x47a20a = _0x2001ef % 0xa;
            for (let _0x33f562 = 0x0; _0x33f562 < _0x504354; _0x33f562++) {
                const _0x39e2e2 = _0x33f562 % _0x737fc4['length'],
                    _0x3b8c6c = _0x737fc4[_0x39e2e2];
                _0x202a26['push']({
                    'numero': _0x3b8c6c,
                    'quantidadeGB': 0xa,
                    'origem': 'distribuido'
                });
            }
            _0x47a20a > 0x0 && _0x202a26['push']({
                'numero': _0x737fc4[0x0],
                'quantidadeGB': _0x47a20a,
                'origem': 'sobra'
            });
        }
        const _0x2d6bac = _0x202a26['reduce']((_0x2ed196, _0x438de7) => _0x2ed196 + _0x438de7['quantidadeGB'], 0x0);
        if (_0x2d6bac > _0xc8c955) {
            const _0x20d26d = _0x2d6bac - _0xc8c955,
                _0xc38c33 = Math['ceil'](_0x20d26d / 0xa);
            _0x202a26['sort']((_0x4ec37c, _0x17b9ad) => {
                const _0x8acc2b = {
                    'distribuido': 0x1,
                    'sobra': 0x2,
                    'especificado': 0x3
                };
                return _0x8acc2b[_0x4ec37c['origem']] - _0x8acc2b[_0x17b9ad['origem']];
            });
            for (let _0x246511 = 0x0; _0x246511 < _0xc38c33 && _0x202a26['length'] > 0x0; _0x246511++) {
                const _0x2b27cb = _0x202a26['pop']();
                _0x1ca1fd('🔀\x20Bloco\x20removido\x20automaticamente:\x20' + _0x2b27cb['numero'] + '\x20-\x20' + _0x2b27cb['quantidadeGB'] + 'GB\x20(origem:\x20' + _0x2b27cb['origem'] + ')', 'info');
            }
            _0x1ca1fd('📊\x20Ajuste\x20automático:\x20' + _0x2d6bac + 'GB\x20→\x20' + _0x202a26['reduce']((_0x3a1207, _0x422635) => _0x3a1207 + _0x422635['quantidadeGB'], 0x0) + 'GB\x20(removidos\x20' + _0xc38c33 + '\x20blocos)', 'info');
        }
        const _0x8f6138 = _0x202a26['map'](_0x377d78 => ({
            'numero': _0x377d78['numero'],
            'quantidade': Math['round'](_0x377d78['quantidadeGB'] * _0x4a20f3)
        }));
        return {
            'divisoes': _0x8f6138,
            'mensagemAjuste': ''
        };
    }
    async function _0x4d7863(_0x44ca1f) {
        try {
            const _0x391aa1 = await _0x3c2652('SELECT\x20sms_recebido,\x20comprovativo_recebido,\x20sms,\x20comprovativo\x20\x0a\x20\x20\x20\x20\x20\x20\x20FROM\x20referencias\x20WHERE\x20ref=?', [_0x44ca1f]);
            if (!_0x391aa1 || _0x391aa1['length'] === 0x0) return {
                'valido': ![],
                'motivo': 'Registro\x20não\x20encontrado'
            };
            const _0x5d4ddc = _0x391aa1[0x0];
            if (!_0x5d4ddc['sms_recebido'] || !_0x5d4ddc['comprovativo_recebido']) return {
                'valido': ![],
                'motivo': 'Dados\x20incompletos:\x20SMS=' + _0x5d4ddc['sms_recebido'] + ',\x20Comprovativo=' + _0x5d4ddc['comprovativo_recebido']
            };
            if (!_0x5d4ddc['sms'] || !_0x5d4ddc['comprovativo']) return {
                'valido': ![],
                'motivo': 'Dados\x20ausentes\x20no\x20banco'
            };
            return {
                'valido': !![]
            };
        } catch (_0x2bac0c) {
            return {
                'valido': ![],
                'motivo': 'Erro\x20na\x20validação:\x20' + _0x2bac0c['message']
            };
        }
    }
    async function _0x239403(_0x43133c, _0x3d5b3, _0x33078a, _0x24a549, _0x52469b) {
        try {
            _0x1ca1fd('📝\x20Preparando\x20resumo\x20após\x20número:\x20ref=' + _0x3d5b3 + ',\x20numero=' + _0x24a549 + ',\x20jid=' + _0x33078a + ',\x20remetente=' + _0x52469b, 'info');
            const _0x37f3c8 = await _0x3c2652('SELECT\x20*\x20FROM\x20referencias\x20WHERE\x20ref=?', [_0x3d5b3]);
            if (!_0x37f3c8 || _0x37f3c8['length'] === 0x0) {
                _0x1ca1fd('❌\x20Registro\x20não\x20encontrado\x20para\x20resumo:\x20ref=' + _0x3d5b3, 'error');
                return;
            }
            const _0xae14de = _0x37f3c8[0x0];
            if (_0xae14de['sms_recebido'] === 0x1) {
                // Informar ao cliente que o pagamento foi confirmado e a ativação iniciou
                const msgConfirmacaoIniciando = `✅ *PAGAMENTO CONFIRMADO!* 🇲🇿\n━━━━━━━━━━━━━━━━━━━\nO seu pagamento foi validado com sucesso e a ativação está a ser processada. Por favor, aguarde alguns segundos... 📶`;
                try {
                    await _0x461461(_0x43133c, _0x33078a, msgConfirmacaoIniciando, null);
                } catch (e) {
                    _0x1ca1fd('⚠️ Erro ao enviar mensagem de ativação iniciando: ' + e.message, 'warning');
                }

                _0x1ca1fd('🚀\x20SMS\x20JÁ\x20RECEBIDO\x20ANTES\x20DO\x20NÚMERO!\x20Processando\x20imediatamente:\x20ref=' + _0x3d5b3 + ',\x20numero=' + _0x24a549, 'success'), await _0x2c5e52('UPDATE\x20referencias\x20SET\x20numero=?\x20WHERE\x20ref=?', [_0x24a549, _0x3d5b3]);
                const _0x11dded = parseInt(_0xae14de['valor']),
                    _0x4a4435 = _0xae14de['tipo'];
                
                // --- DETECÇÃO DE PLANOS ESPECIAIS POR PREÇO ---
                const cfgEspeciais = (_DYN_CFG && _DYN_CFG.PLANOS_ESPECIAIS) || {};
                if (cfgEspeciais && cfgEspeciais[_0x11dded]) {
                    await _iniciarPlanoEspecial(_0x43133c, _0x3d5b3, _0x33078a, _0x24a549, _0x11dded, cfgEspeciais[_0x11dded].tipo);
                    return;
                }
                
                let _0x28d270 = null,
                    _0x3f0e2e = _0xae14de['quantidade'];
                if (_0x4a4435 === '24hrs' && _0x29d1af[_0x11dded]) _0x28d270 = _0x29d1af[_0x11dded], _0x3f0e2e = _0x28d270['quantidade_mb'];
                else {
                    if (_0x4a4435 === 'ilimitado' && _0x9a616a[_0x11dded]) _0x28d270 = _0x9a616a[_0x11dded];
                    else {
                        if (_0x4a4435 === 'ilimitado_com_extra' && _0x9a616a[_0x11dded]) _0x28d270 = _0x9a616a[_0x11dded];
                        else {
                            if (_0x4a4435 === 'mensal' && _0x17ff51[_0x11dded]) _0x28d270 = _0x17ff51[_0x11dded];
                            else {
                                if (_0x4a4435 === '3dias' && PACOTES_3DIAS[_0x11dded]) _0x28d270 = PACOTES_3DIAS[_0x11dded];
                                else _0x4a4435 === 'semanal' && _0x39a69d[_0x11dded] && (_0x28d270 = _0x39a69d[_0x11dded]);
                            }
                        }
                    }
                }
                const _0x287179 = '✅\x20*COMPROVATIVO\x20APROVADO!*\x20🇲🇿\x0a━━━━━━━━━━━━━━━━━━\x0a📢\x20*Referência:*\x20' + _0x3d5b3 + '\x0a📞\x20*Número:*\x20' + _0x24a549 + '\x0a📦\x20*Pacote:*\x20' + (_0x28d270 ? _0x28d270['nome'] : Math['round'](_0xae14de['quantidade'] / 0x400) + 'GB') + '\x0a💳\x20*Valor:*\x20' + _0xae14de['valor'] + '\x20MT\x0a━━━━━━━━━━━━━━━━━━';
                await _0x461461(_0x43133c, _0x33078a, _0x287179, _0xae14de['comprovativo_msg_id']), _0x1ca1fd('⚡\x20SMS\x20já\x20estava\x20recebido,\x20processando:\x20ref=' + _0x3d5b3 + ',\x20tipo=' + _0x4a4435 + ',\x20valor=' + _0xae14de['valor'], 'success');
                if (_0x4a4435 === 'ilimitado_com_extra' || _0x4a4435 === 'ilimitado') await _0x12aa3a(_0x43133c, _0x3d5b3, _0x33078a, _0x24a549, _0x28d270, _0x52469b);
                else {
                    if (_0x4a4435 === 'mensal') await _0x3d533d(_0x43133c, _0x3d5b3, _0x33078a, _0x24a549, _0x28d270, _0x52469b);
                    else {
                        if (_0x4a4435 === '24hrs') _0x1ca1fd('⏳\x20Adicionando\x20pacote\x2024hrs\x20à\x20fila:\x20' + (_0x28d270 ? _0x28d270['nome'] : 'Pacote\x2024hrs') + ',\x20' + _0x3f0e2e + 'MB', '24hrs'), _0x149dcd({
                            'ref': _0x3d5b3,
                            'jid': _0x33078a,
                            'numero': _0x24a549,
                            'quantidade': _0x3f0e2e,
                            'remetente': _0x52469b,
                            'tipo': '24hrs',
                            'timestamp': Date['now'](),
                            'prioridade': _0x411d22(_0x3f0e2e, '24hrs')
                        }), await _0x2372f4('⏳\x20Pacote\x2024hrs\x20adicionado\x20à\x20fila\x0a📋\x20Ref:\x20' + _0x3d5b3 + '\x0a📞\x20Número:\x20' + _0x24a549 + '\x0a📦\x20' + (_0x28d270 ? _0x28d270['nome'] : 'Pacote\x2024hrs'));
                        else {
                            if (_0x4a4435 === '3dias') await processarPacote3Dias(_0x43133c, _0x3d5b3, _0x33078a, _0x24a549, _0x28d270, _0x52469b);
                            else {
                                if (_0x4a4435 === 'semanal') await _0x38212f(_0x43133c, _0x3d5b3, _0x33078a, _0x24a549, _0x28d270, _0x52469b);
                                else {
                                    if (_0xae14de['quantidade'] > 0x2800) {
                                        const _0x1e1b24 = _0x3e1b5c([{
                                            'numero': _0x24a549,
                                            'quantidade': _0xae14de['quantidade']
                                        }]);
                                        await _0x2c5e52('UPDATE\x20referencias\x20SET\x20divisoes=?\x20WHERE\x20ref=?', [JSON['stringify'](_0x1e1b24), _0x3d5b3]), _0x1ca1fd('🔀\x20DIVISÃO\x20AUTOMÁTICA\x20(SMS\x20já\x20recebido):\x20' + _0x24a549 + '\x20→\x20' + _0x1e1b24['length'] + '\x20blocos', 'success');
                                        for (let _0x50f594 = 0x0; _0x50f594 < _0x1e1b24['length']; _0x50f594++) {
                                            const _0x5c01ab = _0x1e1b24[_0x50f594],
                                                _0x1dc6f5 = _0x3d5b3 + '-' + _0x5c01ab['numero'] + '-bloco-' + (_0x50f594 + 0x1) + '-de-' + _0x1e1b24['length'];
                                            _0x149dcd({
                                                'ref': _0x3d5b3,
                                                'jid': _0x33078a,
                                                'numero': _0x5c01ab['numero'],
                                                'quantidade': _0x5c01ab['quantidade'],
                                                'remetente': _0x52469b,
                                                'tipo': _0x4a4435,
                                                'blocoId': _0x1dc6f5
                                            });
                                        }
                                    } else _0x149dcd({
                                        'ref': _0x3d5b3,
                                        'jid': _0x33078a,
                                        'numero': _0x24a549,
                                        'quantidade': _0xae14de['quantidade'],
                                        'remetente': _0x52469b,
                                        'tipo': _0x4a4435
                                    }), _0x1ca1fd('🔄\x20Adicionado\x20à\x20fila\x20(SMS\x20já\x20recebido):\x20ref=' + _0x3d5b3 + ',\x20numero=' + _0x24a549 + ',\x20quantidade=' + (_0xae14de['quantidade'] / 0x400)['toFixed'](0x2) + 'GB', 'queue');
                                }
                            }
                        }
                    }
                }
                return;
            }
            await _0x2c5e52('UPDATE\x20referencias\x20SET\x20numero=?,\x20status=\x27aguardando_sms\x27\x20WHERE\x20ref=?', [_0x24a549, _0x3d5b3]);
            const _0x1afbf9 = '✅ *NÚMERO REGISTADO!* 🇲🇿\n━━━━━━━━━━━━━━━━━━\n🔖 *Ref:* `' + _0x3d5b3 + '`\n📞 *Destino:* ' + _0x24a549 + '\n━━━━━━━━━━━━━━━━━━\n⌛ A aguardar confirmação do M-Pesa/E-Mola...\n_O pacote será enviado automaticamente._';
            await _0x461461(_0x43133c, _0x33078a, _0x1afbf9, null), _0x1ca1fd('✅\x20Número\x20confirmado,\x20AGUARDANDO\x20SMS:\x20ref=' + _0x3d5b3 + ',\x20numero=' + _0x24a549 + ',\x20status=aguardando_sms', 'success');
        } catch (_0x196399) {
            _0x1ca1fd('❌\x20Erro\x20ao\x20processar\x20número:\x20ref=' + _0x3d5b3 + ',\x20erro=' + _0x196399['message'], 'error');
        }
    }
    // =====================================================
    // HELPER: Ler estado do bloqueio global do sistema
    // =====================================================
    function _kanet_sistemaBloqueado() {
        try {
            const _lockPath = require('path').join(__dirname, 'system_lock.json');
            if (_0x32d49c.existsSync(_lockPath)) {
                const _lockData = JSON.parse(_0x32d49c.readFileSync(_lockPath, 'utf8'));
                return _lockData && _lockData.locked === true ? _lockData : null;
            }
        } catch (_e) { /* Ignorar erros de leitura */ }
        return null;
    }

    let _kanet_wasLocked = false;
    let _gruposSincronizados = false;
    try {
        const _lockPathInit = require('path').join(__dirname, 'system_lock.json');
        if (_0x32d49c.existsSync(_lockPathInit)) {
            const _lockDataInit = JSON.parse(_0x32d49c.readFileSync(_lockPathInit, 'utf8'));
            _kanet_wasLocked = _lockDataInit && _lockDataInit.locked === true;
        }
    } catch (e) {}

    setInterval(async () => {
        try {
            const _lockPath = require('path').join(__dirname, 'system_lock.json');
            if (!_0x32d49c.existsSync(_lockPath)) return;
            const _lockData = JSON.parse(_0x32d49c.readFileSync(_lockPath, 'utf8'));
            const _isCurrentlyLocked = _lockData && _lockData.locked === true;
            
            // Sincronização inicial no arranque ou transição real
            if (!_gruposSincronizados || (_kanet_wasLocked !== _isCurrentlyLocked)) {
                _gruposSincronizados = true;
                
                if (_isCurrentlyLocked) {
                    _0x1ca1fd('🔒 SISTEMA BLOQUEADO: Garantindo que grupos estão fechados...', 'info');
                    if (global['client'] && typeof _0x18020a !== 'undefined') {
                        const _motivo = _lockData.reason || 'Manutenção programada. Por favor, tente mais tarde.';
                        const _msgBloqueioGp = '🔒 *SISTEMA EM MANUTENÇÃO / GRUPO FECHADO*\n━━━━━━━━━━━━━━━━━━\n⚠️ O sistema está temporariamente em manutenção.\n\n📢 *Motivo:* ' + _motivo + '\n━━━━━━━━━━━━━━━━━━\nO envio de mensagens neste grupo foi suspenso temporariamente. Avisaremos assim que retornar.';
                        for (const _gid of _0x18020a) {
                            try {
                                _0x1ca1fd('🔒 Fechando grupo: ' + _gid, 'info');
                                await global['client']['setGroupToAdminsOnly'](_gid, true);
                                // Apenas envia mensagem de aviso se foi uma transição real (e não a sincronização de boot)
                                if (!_kanet_wasLocked) {
                                    await _0x461461(global['client'], _gid, _msgBloqueioGp);
                                }
                                await new Promise(_resolve => setTimeout(_resolve, 1000));
                            } catch (_errGp) {
                                _0x1ca1fd('❌ Erro ao fechar grupo ' + _gid + ': ' + _errGp.message, 'error');
                            }
                        }
                    }
                } else {
                    _0x1ca1fd('🟢 SISTEMA DESBLOQUEADO: Garantindo que grupos estão abertos...', 'info');
                    if (global['client'] && typeof _0x18020a !== 'undefined') {
                        for (const _gid of _0x18020a) {
                            try {
                                _0x1ca1fd('🔓 Abrindo grupo: ' + _gid, 'info');
                                await global['client']['setGroupToAdminsOnly'](_gid, false);
                                // Apenas envia mensagem de aviso se foi uma transição real
                                if (_kanet_wasLocked) {
                                    await _0x461461(global['client'], _gid, '🔓 *SISTEMA ONLINE / GRUPO ABERTO*\n━━━━━━━━━━━━━━━━━━\n✅ O sistema está online e o grupo foi aberto para todos.\n\nVocê já pode enviar mensagens e fazer compras de pacotes.');
                                }
                                await new Promise(_resolve => setTimeout(_resolve, 1000));
                            } catch (_errGp) {
                                _0x1ca1fd('❌ Erro ao abrir grupo ' + _gid + ': ' + _errGp.message, 'error');
                            }
                        }
                    }

                    // Notificar clientes pendentes
                    if (_kanet_wasLocked) {
                        const _pending = _lockData.pending_notifications || [];
                        if (_pending.length > 0 && global['client']) {
                            const _msgOnline = '🟢 *SISTEMA ONLINE* 🟢\n━━━━━━━━━━━━━━━━━━\n🤖 Olá! O sistema já está online novamente e pronto para uso.\n\nVocê já pode prosseguir com a sua compra de pacotes. Agradecemos a sua paciência! 🙏\n━━━━━━━━━━━━━━━━━━\n⚡ *Ka-Net* — Sempre Conectado!';
                            for (const _jid of _pending) {
                                try {
                                    _0x1ca1fd('📨 Enviando notificação de desbloqueio para ' + _jid, 'info');
                                    await _0x461461(global['client'], _jid, _msgOnline);
                                    await new Promise(_resolve => setTimeout(_resolve, 1500));
                                } catch (_err) {
                                    _0x1ca1fd('❌ Erro ao notificar ' + _jid + ': ' + _err.message, 'error');
                                }
                            }
                            // Recarregar de forma limpa para evitar sobrescrever novos registros criados durante o envio
                            let _freshLockData = JSON.parse(_0x32d49c.readFileSync(_lockPath, 'utf8'));
                            _freshLockData.pending_notifications = (_freshLockData.pending_notifications || []).filter(x => !_pending.includes(x));
                            _0x32d49c.writeFileSync(_lockPath, JSON.stringify(_freshLockData, null, 2), 'utf8');
                            _0x1ca1fd('✅ Notificações processadas e limpas no system_lock.json.', 'success');
                        }
                    }
                }
            }
            _kanet_wasLocked = _isCurrentlyLocked;
        } catch (_err) {
            // Silencioso
        }
    }, 5000);


    async function _0x303482(_0x51fcfd, _0x640595, _0x3ad043, _0x4c8083, _0x3bc27d, _0x5b6eca, _0x4a9fa4, _0x2dd7f4, _0x2aa228 = 'normal', _sobra = 0) {
        const _0x40ef17 = 'resumo_' + _0x3ad043;
        if (global['bloqueioResumo'] && global['bloqueioResumo'][_0x40ef17]) {
            _0x1ca1fd('🚫\x20RESUMO\x20JÁ\x20EM\x20ANDAMENTO:\x20ref=' + _0x3ad043 + ',\x20ignorando\x20chamada\x20duplicada', 'warning');
            return;
        } !global['bloqueioResumo'] && (global['bloqueioResumo'] = {});
        global['bloqueioResumo'][_0x40ef17] = !![], setTimeout(() => {
            global['bloqueioResumo'] && global['bloqueioResumo'][_0x40ef17] && delete global['bloqueioResumo'][_0x40ef17];
        }, 0x1388);

        // =====================================================
        // VERIFICAÇÃO DE BLOQUEIO GLOBAL DO SISTEMA
        // =====================================================
        const _lockState = _kanet_sistemaBloqueado();
        if (_lockState) {
            _0x1ca1fd('🔒 SISTEMA BLOQUEADO: Compra bloqueada pelo admin. ref=' + _0x3ad043 + ', jid=' + _0x640595, 'warning');
            const _motivo = _lockState.reason || 'Manutenção programada. Por favor, tente mais tarde.';
            const _msgBloqueio = '🔒 *SISTEMA EM MANUTENÇÃO* 🔒\n━━━━━━━━━━━━━━━━━━\n⚠️ Não foi possível concluir a sua ação.\n\n📢 *Motivo:* ' + _motivo + '\n━━━━━━━━━━━━━━━━━━\n✅ Assim que o sistema voltar ao normal, receberá uma notificação automática e poderá continuar a sua compra.\n\n🙏 *Pedimos desculpa pelo inconveniente!*\n━━━━━━━━━━━━━━━━━━\n⚡ *Ka-Net* — Sempre Conectado!';
            
            // Adicionar JID à lista de notificações de desbloqueio pendentes
            try {
                const _lockPath = require('path').join(__dirname, 'system_lock.json');
                let _lockData = { locked: true, reason: '', pending_notifications: [] };
                if (_0x32d49c.existsSync(_lockPath)) {
                    _lockData = JSON.parse(_0x32d49c.readFileSync(_lockPath, 'utf8'));
                }
                if (!_lockData.pending_notifications) {
                    _lockData.pending_notifications = [];
                }
                if (!_lockData.pending_notifications.includes(_0x640595)) {
                    _lockData.pending_notifications.push(_0x640595);
                    _0x32d49c.writeFileSync(_lockPath, JSON.stringify(_lockData, null, 2), 'utf8');
                    _0x1ca1fd('📝 JID ' + _0x640595 + ' adicionado à lista de notificações de desbloqueio.', 'info');
                }
            } catch (_err) {
                _0x1ca1fd('Erro ao adicionar JID para notificação: ' + _err.message, 'error');
            }

            try {
                await _0x461461(_0x51fcfd, _0x640595, _msgBloqueio, _0x4a9fa4);
            } catch (_e) { _0x1ca1fd('Erro ao enviar msg de bloqueio: ' + _e.message, 'error'); }
            return;
        }
        const _0x1502c6 = parseInt(_0x4c8083);
        if ((!_0x3bc27d || _0x3bc27d < 0x64) && _0x2aa228 === '24hrs') {
            if (_0x640595 && _0x7d9007[_0x640595] && _0x7d9007[_0x640595][_0x1502c6]) {
                const _0x4f0e49 = _0x7d9007[_0x640595][_0x1502c6];
                _0x3bc27d = _0x4f0e49['quantidade'] || _0x4f0e49['quantidade_mb'], _0x1ca1fd('🔥\x20CORREÇÃO:\x20Quantidade\x20ajustada\x20para\x20' + _0x3bc27d + 'MB\x20(tabela\x20do\x20grupo)', 'warning');
            } else {
                if (_0x29d1af[_0x1502c6]) {
                    const _0x515545 = _0x29d1af[_0x1502c6];
                    _0x3bc27d = _0x515545['quantidade_mb'], _0x1ca1fd('🔥\x20CORREÇÃO:\x20Quantidade\x20ajustada\x20para\x20' + _0x3bc27d + 'MB\x20(tabela\x20geral)', 'warning');
                }
            }
        }
        try {
            if (!_0x3bc27d && _0x2aa228 !== 'saldo') {
                _0x1ca1fd('❌\x20Quantidade\x20inválida\x20para\x20resumo:\x20ref=' + _0x3ad043 + ',\x20quantidade=' + _0x3bc27d, 'error');
                return;
            }
            if (!_0x51fcfd || typeof _0x51fcfd['reply'] !== 'function') {
                _0x1ca1fd('❌\x20Cliente\x20WhatsApp\x20não\x20disponível\x20para\x20enviar\x20resumo\x20do\x20pedido:\x20ref=' + _0x3ad043 + ',\x20jid=' + _0x640595 + ',\x20remetente=' + _0x2dd7f4, 'error');
                return;
            }
            const _0x3209b4 = await _0x3c2652('SELECT\x20*\x20FROM\x20referencias\x20WHERE\x20ref=?', [_0x3ad043]);
            if (!_0x3209b4 || _0x3209b4['length'] === 0x0) {
                _0x1ca1fd('📭\x20Registro\x20não\x20encontrado\x20para\x20resumo:\x20ref=' + _0x3ad043 + ',\x20jid=' + _0x640595 + ',\x20remetente=' + _0x2dd7f4, 'warning');
                return;
            }
            const _0x565bf8 = _0x3209b4[0x0],
                _0x75a2ce = _0x565bf8['tipo'] || _0x2aa228;
            let _0x1539cc = _0x565bf8['divisoes'] ? JSON['parse'](_0x565bf8['divisoes']) : [];

            // --- TRAVA DE SEGURANÇA MÁXIMA ---
            if (!_0x565bf8['sms_recebido']) {
                _0x1ca1fd('⏳ ATIVAÇÃO BLOQUEADA: Aguardando SMS real de pagamento para ref=' + _0x3ad043, 'info');
                const _msgWait = '🕐 *PEDIDO EM PROCESSAMENTO* 🇲🇿\n━━━━━━━━━━━━━━━━━━\n🔖 *Ref:* `' + _0x3ad043 + '`\n💰 *Valor:* ' + _0x4c8083 + ' MT\n📞 *Destino:* ' + (_0x5b6eca || 'Não informado') + '\n━━━━━━━━━━━━━━━━━━\n⌛ A aguardar confirmação do M-Pesa/E-Mola.\n_O pacote será enviado automaticamente assim que o pagamento for confirmado._';
                await _0x461461(_0x51fcfd, _0x640595, _msgWait, _0x4a9fa4);
                return;
            }

            // A partir daqui, sms_recebido é garantidamente 1
            let _statusAtual;
            if (_0x5b6eca && _0x5b6eca !== 'nenhum') {
                _statusAtual = 'na_fila';
            } else {
                _statusAtual = 'aguardando_numero';
                _0x5b6eca = null;
            }
            
            await _0x2c5e52('UPDATE referencias SET status=? WHERE ref=?', [_statusAtual, _0x3ad043]);
            _0x1ca1fd('📋 Processando ativação (SMS confirmado): ref=' + _0x3ad043, 'info');
            const _0xccf39b = parseInt(_0x4c8083);
            let _0x272a73 = ''; 

            let _0x343d48;
            if (_0x565bf8['sms_recebido'] === 0x1 && _0x5b6eca) _0x343d48 = 'na_fila';
            else {
                if (_0x565bf8['sms_recebido'] === 0x1 && !_0x5b6eca) _0x343d48 = 'aguardando_numero';
                else _0x1539cc['length'] > 0x0 || _0x5b6eca ? _0x343d48 = 'aguardando_confirmacao' : _0x343d48 = 'aguardando_numero';
            }
            await _0x2c5e52('UPDATE\x20referencias\x20SET\x20status=?\x20WHERE\x20ref=?', [_0x343d48, _0x3ad043]), _0x1ca1fd('📋\x20Preparando\x20resumo\x20completo:\x20ref=' + _0x3ad043 + ',\x20SMS=' + _0x565bf8['sms_recebido'] + ',\x20Comprovativo=' + _0x565bf8['comprovativo_recebido'] + ',\x20tipo=' + _0x75a2ce, 'info');
            const _0x1437d5 = parseInt(_0x4c8083);
            let _0x42f36f;
            if (_0x565bf8['sms_recebido'] === 0x1) {
                if (_0x75a2ce === 'ilimitado' && _0x9a616a[_0x1437d5]) {
                    const _0x3cdbb2 = _0x9a616a[_0x1437d5];
                    if (_0x1539cc['length'] > 0x0) {
                        const _0x8f39cc = _0x1539cc['map'](_0xe16d16 => _0xe16d16['numero'] + '\x20→\x20' + Math['round'](_0xe16d16['quantidade'] / 0x400) + '\x20GB')['join']('\x0a');
                        _0x42f36f = '✅ *PACOTE ILIMITADO APROVADO!* 🇲🇿\n━━━━━━━━━━━━━━━━━━\n🔖 *Ref:* `' + _0x3ad043 + '`\n📦 *Pacote:* ' + _0x3cdbb2['nome'] + '\n💰 *Valor:* ' + _0x4c8083 + ' MT\n⏳ *Período:* ' + _0x3cdbb2['periodo'] + '\n📊 *Divisões:*\n' + _0x8f39cc + '\n━━━━━━━━━━━━━━━━━━\n⌛ A processar o envio...';
                    } else _0x42f36f = _0x5b6eca ? '✅ *PACOTE ILIMITADO APROVADO!* 🇲🇿\n━━━━━━━━━━━━━━━━━━\n🔖 *Ref:* `' + _0x3ad043 + '`\n📦 *Pacote:* ' + _0x3cdbb2['nome'] + '\n📞 *Destino:* ' + _0x5b6eca + '\n💰 *Valor:* ' + _0x4c8083 + ' MT\n━━━━━━━━━━━━━━━━━━\n⌛ A processar o envio...' : '✅ *PACOTE ILIMITADO VALIDADO!* 🇲🇿\n━━━━━━━━━━━━━━━━━━\n🔖 *Ref:* `' + _0x3ad043 + '`\n📦 *Pacote:* ' + _0x3cdbb2['nome'] + '\n💰 *Valor:* ' + _0x4c8083 + ' MT\n━━━━━━━━━━━━━━━━━━\n⚠️ *FALTA O NÚMERO DE DESTINO!*\nPor favor, envie agora apenas o número que irá receber o pacote.';
                } else {
                    if (_0x75a2ce === 'ilimitado_com_extra' && _0x9a616a[_0x1437d5]) {
                        const _0x5f5dfc = _0x9a616a[_0x1437d5],
                            _0x486710 = _0x5f5dfc['extras'] > 0x0 ? '\x0a➕\x20*Extras:*\x20' + (_0x5f5dfc['extras'] / 0x400)['toFixed'](0x1) + 'GB\x20(processamento\x20paralelo)' : '';
                        if (_0x1539cc['length'] > 0x0) {
                            const _0x33fe8d = _0x1539cc['map'](_0x288158 => _0x288158['numero'] + '\x20→\x20' + Math['round'](_0x288158['quantidade'] / 0x400) + '\x20GB')['join']('\x0a');
                            _0x42f36f = '✅ *ILIMITADO COM EXTRAS APROVADO!* 🇲🇿\n━━━━━━━━━━━━━━━━━━\n🔖 *Ref:* `' + _0x3ad043 + '`\n📦 *Pacote:* ' + _0x5f5dfc['nome'] + '\n💰 *Valor:* ' + _0x4c8083 + ' MT\n📊 *Divisões:*\n' + _0x33fe8d + _0x486710 + '\n━━━━━━━━━━━━━━━━━━\n⌛ A processar o envio...';
                        } else _0x42f36f = _0x5b6eca ? '✅ *ILIMITADO COM EXTRAS APROVADO!* 🇲🇿\n━━━━━━━━━━━━━━━━━━\n🔖 *Ref:* `' + _0x3ad043 + '`\n📦 *Pacote:* ' + _0x5f5dfc['nome'] + '\n📞 *Destino:* ' + _0x5b6eca + '\n💰 *Valor:* ' + _0x4c8083 + ' MT\n━━━━━━━━━━━━━━━━━━\n⌛ A processar o envio...' : '✅ *ILIMITADO COM EXTRAS VALIDADO!* 🇲🇿\n━━━━━━━━━━━━━━━━━━\n🔖 *Ref:* `' + _0x3ad043 + '`\n📦 *Pacote:* ' + _0x5f5dfc['nome'] + '\n💰 *Valor:* ' + _0x4c8083 + ' MT\n━━━━━━━━━━━━━━━━━━\n⚠️ *FALTA O NÚMERO DE DESTINO!*\nPor favor, envie agora apenas o número que irá receber o pacote.';
                    } else {
                        if (_0x75a2ce === 'mensal' && _0x17ff51[_0x1437d5]) {
                            const _0x1fd40b = _0x17ff51[_0x1437d5];
                            if (_0x1539cc['length'] > 0x0) {
                                const _0x428b6e = _0x1539cc['map'](_0x6eea7d => _0x6eea7d['numero'] + '\x20→\x20' + Math['round'](_0x6eea7d['quantidade'] / 0x400) + '\x20GB')['join']('\x0a');
                                _0x42f36f = '✅ *PACOTE MENSAL APROVADO!* 🇲🇿\n━━━━━━━━━━━━━━━━━━\n🔖 *Ref:* `' + _0x3ad043 + '`\n📦 *Pacote:* ' + _0x1fd40b['nome'] + '\n💰 *Valor:* ' + _0x4c8083 + ' MT\n📊 *Divisões:*\n' + _0x428b6e + '\n━━━━━━━━━━━━━━━━━━\n⌛ A processar o envio...';
                            } else _0x42f36f = _0x5b6eca ? '✅ *PACOTE MENSAL APROVADO!* 🇲🇿\n━━━━━━━━━━━━━━━━━━\n🔖 *Ref:* `' + _0x3ad043 + '`\n📦 *Pacote:* ' + _0x1fd40b['nome'] + '\n📞 *Destino:* ' + _0x5b6eca + '\n💰 *Valor:* ' + _0x4c8083 + ' MT\n━━━━━━━━━━━━━━━━━━\n⌛ A processar o envio...' : '✅ *PACOTE MENSAL VALIDADO!* 🇲🇿\n━━━━━━━━━━━━━━━━━━\n🔖 *Ref:* `' + _0x3ad043 + '`\n📦 *Pacote:* ' + _0x1fd40b['nome'] + '\n💰 *Valor:* ' + _0x4c8083 + ' MT\n━━━━━━━━━━━━━━━━━━\n⚠️ *FALTA O NÚMERO DE DESTINO!*\nPor favor, envie agora apenas o número que irá receber o pacote.';
                        } else {
                            if (_0x75a2ce === '24hrs' && _0x640595 && _0x7d9007[_0x640595] && _0x7d9007[_0x640595][_0x1437d5]) {
                                const _0x5f0440 = _0x7d9007[_0x640595][_0x1437d5];
                                if (_0x1539cc['length'] > 0x0) {
                                    const _0x2f01f0 = _0x1539cc['map'](_0x3ffc13 => _0x3ffc13['numero'] + '\x20→\x20' + Math['round'](_0x3ffc13['quantidade'] / 0x400) + '\x20GB')['join']('\x0a');
                                    _0x42f36f = '✅ *PACOTE 24 HORAS APROVADO!* 🇲🇿\n━━━━━━━━━━━━━━━━━━\n🔖 *Ref:* `' + _0x3ad043 + '`\n📦 *Pacote:* ' + _0x5f0440['nome'] + '\n💰 *Valor:* ' + _0x4c8083 + ' MT\n📊 *Divisões:*\n' + _0x2f01f0 + '\n━━━━━━━━━━━━━━━━━━\n⌛ A processar o envio...';
                                } else _0x42f36f = _0x5b6eca ? '✅ *PACOTE 24 HORAS APROVADO!* 🇲🇿\n━━━━━━━━━━━━━━━━━━\n🔖 *Ref:* `' + _0x3ad043 + '`\n📦 *Pacote:* ' + _0x5f0440['nome'] + '\n📞 *Destino:* ' + _0x5b6eca + '\n💰 *Valor:* ' + _0x4c8083 + ' MT\n━━━━━━━━━━━━━━━━━━\n⌛ A processar o envio...' : '✅ *PACOTE 24 HORAS VALIDADO!* 🇲🇿\n━━━━━━━━━━━━━━━━━━\n🔖 *Ref:* `' + _0x3ad043 + '`\n📦 *Pacote:* ' + _0x5f0440['nome'] + '\n💰 *Valor:* ' + _0x4c8083 + ' MT\n━━━━━━━━━━━━━━━━━━\n⚠️ *FALTA O NÚMERO DE DESTINO!*\nPor favor, envie agora apenas o número que irá receber o pacote.';
                            } else {
                                if (_0x75a2ce === '3dias' && PACOTES_3DIAS[_0x1437d5]) {
                                    const _0x177c56 = PACOTES_3DIAS[_0x1437d5];
                                    if (_0x1539cc['length'] > 0x0) {
                                        const _0x2ff920 = _0x1539cc['map'](_0xc0140f => _0xc0140f['numero'] + '\x20→\x20' + Math['round'](_0xc0140f['quantidade'] / 0x400) + '\x20GB')['join']('\x0a');
                                        _0x42f36f = '✅ *PACOTE 3 DIAS APROVADO!* 🇲🇿\n━━━━━━━━━━━━━━━━━━\n🔖 *Ref:* `' + _0x3ad043 + '`\n📦 *Pacote:* ' + _0x177c56['nome'] + '\n💰 *Valor:* ' + _0x4c8083 + ' MT\n📊 *Divisões:*\n' + _0x2ff920 + '\n━━━━━━━━━━━━━━━━━━\n⌛ A processar o envio...';
                                    } else _0x42f36f = _0x5b6eca ? '✅ *PACOTE 3 DIAS APROVADO!* 🇲🇿\n━━━━━━━━━━━━━━━━━━\n🔖 *Ref:* `' + _0x3ad043 + '`\n📦 *Pacote:* ' + _0x177c56['nome'] + '\n📞 *Destino:* ' + _0x5b6eca + '\n💰 *Valor:* ' + _0x4c8083 + ' MT\n━━━━━━━━━━━━━━━━━━\n⌛ A processar o envio...' : '✅ *PACOTE 3 DIAS VALIDADO!* 🇲🇿\n━━━━━━━━━━━━━━━━━━\n🔖 *Ref:* `' + _0x3ad043 + '`\n📦 *Pacote:* ' + _0x177c56['nome'] + '\n💰 *Valor:* ' + _0x4c8083 + ' MT\n━━━━━━━━━━━━━━━━━━\n⚠️ *FALTA O NÚMERO DE DESTINO!*\nPor favor, envie agora apenas o número que irá receber o pacote.';
                                } else {
                                    if (_0x75a2ce === 'semanal' && _0x39a69d[_0x1437d5]) {
                                        const _0xb69b3c = _0x39a69d[_0x1437d5];
                                        if (_0x1539cc['length'] > 0x0) {
                                            const _0x4b9993 = _0x1539cc['map'](_0x4db86d => _0x4db86d['numero'] + '\x20→\x20' + Math['round'](_0x4db86d['quantidade'] / 0x400) + '\x20GB')['join']('\x0a');
                                            _0x42f36f = '✅ *PACOTE SEMANAL APROVADO!* 🇲🇿\n━━━━━━━━━━━━━━━━━━\n🔖 *Ref:* `' + _0x3ad043 + '`\n📦 *Pacote:* ' + _0xb69b3c['nome'] + '\n💰 *Valor:* ' + _0x4c8083 + ' MT\n⏳ *Período:* ' + _0xb69b3c['periodo'] + '\n📊 *Divisões:*\n' + _0x4b9993 + '\n━━━━━━━━━━━━━━━━━━\n⌛ A processar o envio...';
                                        } else _0x42f36f = _0x5b6eca ? '✅ *PACOTE SEMANAL APROVADO!* 🇲🇿\n━━━━━━━━━━━━━━━━━━\n🔖 *Ref:* `' + _0x3ad043 + '`\n📦 *Pacote:* ' + _0xb69b3c['nome'] + '\n📞 *Destino:* ' + _0x5b6eca + '\n💰 *Valor:* ' + _0x4c8083 + ' MT\n⏳ *Período:* ' + _0xb69b3c['periodo'] + '\n━━━━━━━━━━━━━━━━━━\n⌛ A processar o envio...' : '✅ *PACOTE SEMANAL VALIDADO!* 🇲🇿\n━━━━━━━━━━━━━━━━━━\n🔖 *Ref:* `' + _0x3ad043 + '`\n📦 *Pacote:* ' + _0xb69b3c['nome'] + '\n💰 *Valor:* ' + _0x4c8083 + ' MT\n⏳ *Período:* ' + _0xb69b3c['periodo'] + '\n━━━━━━━━━━━━━━━━━━\n⚠️ *FALTA O NÚMERO DE DESTINO!*\nPor favor, envie agora apenas o número que irá receber o pacote.';
                                    } else {
                                        const _0x3bfeb1 = (_0x75a2ce === 'saldo' || _0x75a2ce === 'credito') ? (_0x3bc27d + ' MT Saldo') : (_0x3bc27d < 1024 ? _0x3bc27d + ' MB' : (Math.round(_0x3bc27d / 1024) + ' GB'));
                                        if (_0x1539cc['length'] > 0x0) {
                                            const _0x41158a = _0x1539cc['map'](_0x8e6332 => _0x8e6332['numero'] + '\x20→\x20' + Math['round'](_0x8e6332['quantidade'] / 0x400) + '\x20GB')['join']('\x0a');
                                            _0x42f36f = '✅ *COMPROVATIVO APROVADO!* 🇲🇿\n━━━━━━━━━━━━━━━━━━\n🔖 *Ref:* `' + _0x3ad043 + '`\n💰 *Valor:* ' + _0x4c8083 + ' MT\n📊 *Divisões:*\n' + _0x41158a + '\n━━━━━━━━━━━━━━━━━━\n⌛ A processar o envio...';
                                        } else _0x42f36f = _0x5b6eca ? '✅ *COMPROVATIVO APROVADO!* 🇲🇿\n━━━━━━━━━━━━━━━━━━\n🔖 *Ref:* `' + _0x3ad043 + '`\n📦 *Pacote:* ' + _0x3bfeb1 + '\n📞 *Destino:* ' + _0x5b6eca + '\n💰 *Valor:* ' + _0x4c8083 + ' MT\n━━━━━━━━━━━━━━━━━━\n⌛ A processar o envio...' : '✅ *COMPROVATIVO VALIDADO!* 🇲🇿\n━━━━━━━━━━━━━━━━━━\n🔖 *Ref:* `' + _0x3ad043 + '`\n📦 *Pacote:* ' + _0x3bfeb1 + '\n💰 *Valor:* ' + _0x4c8083 + ' MT\n━━━━━━━━━━━━━━━━━━\n⚠️ *FALTA O NÚMERO DE DESTINO!*\nPor favor, envie agora apenas o número que irá receber o pacote.';
                                    }
                                }
                            }
                        }
                    }
                }
            } else {
                if (_0x5b6eca) _0x42f36f = '✅ *NÚMERO REGISTADO!* 🇲🇿\n━━━━━━━━━━━━━━━━━━\n🔖 *Ref:* `' + _0x3ad043 + '`\n📞 *Destino:* ' + _0x5b6eca + '\n━━━━━━━━━━━━━━━━━━\n⌛ A aguardar a confirmação de pagamento do M-Pesa/E-Mola...\n_O pacote será enviado automaticamente._';
                else {
                    const _0x57a5cd = (_0x75a2ce === 'saldo' || _0x75a2ce === 'credito') ? (_0x3bc27d + ' MT Saldo') : (_0x3bc27d < 1024 ? _0x3bc27d + ' MB' : (Math.round(_0x3bc27d / 1024) + ' GB'));
                    _0x42f36f = '✅ *COMPROVATIVO VALIDADO!* 🇲🇿\n━━━━━━━━━━━━━━━━━━\n🔖 *Ref:* `' + _0x3ad043 + '`\n📦 *Pacote:* ' + _0x57a5cd + '\n💰 *Valor:* ' + _0x4c8083 + ' MT\n━━━━━━━━━━━━━━━━━━\n⚠️ *FALTA O NÚMERO DE DESTINO!*\nPor favor, envie agora apenas o número que irá receber o pacote.';
                }
            }

            // --- DETECÇÃO DE PLANOS ESPECIAIS POR PREÇO ---
            if (_0x5b6eca && _0x565bf8['sms_recebido'] === 1) {
                const valorNum = parseInt(_0x4c8083);
                const cfgEspeciais = (_DYN_CFG && _DYN_CFG.PLANOS_ESPECIAIS) || {};
                
                // Se o preço pago estiver na nossa tabela de planos especiais, ativa o plano
                if (cfgEspeciais && cfgEspeciais[valorNum]) {
                    await _iniciarPlanoEspecial(_0x51fcfd, _0x3ad043, _0x640595, _0x5b6eca, valorNum, cfgEspeciais[valorNum].tipo);
                    return;
                }
            }

            await _0x461461(_0x51fcfd, _0x640595, _0x42f36f, _0x4a9fa4 || null), _0x1ca1fd('📨\x20Mensagem\x20enviada:\x20ref=' + _0x3ad043 + ',\x20jid=' + _0x640595 + ',\x20remetente=' + _0x2dd7f4 + ',\x20tipo=' + _0x75a2ce + ',\x20numero=' + (_0x5b6eca || 'nenhum') + ',\x20novo_status=' + _0x343d48 + ',\x20sms_recebido=' + _0x565bf8['sms_recebido'], 'success');
            if (_0x5b6eca && _0x565bf8['sms_recebido'] === 0x1) {
                const _0xccf39b = parseInt(_0x4c8083);
                if (_0x75a2ce === 'ilimitado' && _0x9a616a[_0xccf39b]) {
                    const _0x394227 = _0x9a616a[_0xccf39b];
                    _0x1ca1fd('♾️\x20PROCESSANDO\x20PACOTE\x20ILIMITADO\x20(SMS\x20já\x20recebido):\x20ref=' + _0x3ad043 + ',\x20numero=' + _0x5b6eca, 'ilimitado'), await _0x12aa3a(_0x51fcfd, _0x3ad043, _0x640595, _0x5b6eca, _0x394227, _0x2dd7f4);
                } else {
                    if (_0x75a2ce === 'ilimitado_com_extra' && _0x9a616a[_0xccf39b]) {
                        const _0x6715e1 = _0x9a616a[_0xccf39b];
                        _0x1ca1fd('♾️+\x20PROCESSANDO\x20PACOTE\x20ILIMITADO\x20COM\x20EXTRAS\x20(SMS\x20já\x20recebido):\x20ref=' + _0x3ad043 + ',\x20numero=' + _0x5b6eca, 'ilimitado_com_extra'), await _0x12aa3a(_0x51fcfd, _0x3ad043, _0x640595, _0x5b6eca, _0x6715e1, _0x2dd7f4);
                    } else {
                        if (_0x75a2ce === 'mensal' && _0x17ff51[_0xccf39b]) {
                            const _0x3c200a = _0x17ff51[_0xccf39b];
                            _0x1ca1fd('📅\x20PROCESSANDO\x20PACOTE\x20MENSAL\x20(SMS\x20já\x20recebido):\x20ref=' + _0x3ad043 + ',\x20numero=' + _0x5b6eca, 'mensal'), await _0x3d533d(_0x51fcfd, _0x3ad043, _0x640595, _0x5b6eca, _0x3c200a, _0x2dd7f4);
                        } else {
                            if (_0x75a2ce === '24hrs' && _0x640595 && _0x7d9007[_0x640595] && _0x7d9007[_0x640595][_0xccf39b]) {
                                const _0x37583a = _0x7d9007[_0x640595][_0xccf39b];
                                _0x1ca1fd('⏳\x20PROCESSANDO\x20PACOTE\x2024\x20HORAS\x20(SMS\x20já\x20recebido):\x20ref=' + _0x3ad043 + ',\x20numero=' + _0x5b6eca + ',\x20pacote=' + _0x37583a['nome'], '24hrs');
                                const _0x4e7edb = _0x37583a['quantidade'] || _0x37583a['quantidade_mb'];
                                if (!_0x4e7edb) {
                                    _0x1ca1fd('❌\x20ERRO:\x20Quantidade\x20não\x20encontrada\x20para\x20pacote\x2024hrs\x20' + _0xccf39b + 'MT', 'error');
                                    return;
                                }
                                _0x1ca1fd('✅\x20Quantidade\x20definida:\x20' + _0x4e7edb + 'MB\x20para\x20pacote\x20' + _0xccf39b + 'MT', 'success');
                                if (_0x4e7edb > 0x2800) {
                                    const _0xcbe2c0 = _0x3e1b5c([{
                                        'numero': _0x5b6eca,
                                        'quantidade': _0x4e7edb
                                    }]);
                                    await _0x2c5e52('UPDATE\x20referencias\x20SET\x20divisoes=?\x20WHERE\x20ref=?', [JSON['stringify'](_0xcbe2c0), _0x3ad043]), _0x1ca1fd('🔀\x20DIVISÃO\x20AUTOMÁTICA:\x20' + _0x5b6eca + '\x20→\x20' + _0xcbe2c0['length'] + '\x20blocos\x20para\x20' + (_0x4e7edb / 0x400)['toFixed'](0x0) + 'GB', 'success');
                                    for (let _0x31b334 = 0x0; _0x31b334 < _0xcbe2c0['length']; _0x31b334++) {
                                        const _0x8215cb = _0xcbe2c0[_0x31b334],
                                            _0x5e33c3 = _0x3ad043 + '-' + _0x8215cb['numero'] + '-bloco-' + (_0x31b334 + 0x1) + '-de-' + _0xcbe2c0['length'];
                                        _0x149dcd({
                                            'ref': _0x3ad043,
                                            'jid': _0x640595,
                                            'numero': _0x8215cb['numero'],
                                            'quantidade': _0x8215cb['quantidade'],
                                            'remetente': _0x2dd7f4,
                                            'tipo': _0x75a2ce,
                                            'blocoId': _0x5e33c3
                                        });
                                    }
                                } else _0x149dcd({
                                    'ref': _0x3ad043,
                                    'jid': _0x640595,
                                    'numero': _0x5b6eca,
                                    'quantidade': _0x4e7edb,
                                    'remetente': _0x2dd7f4,
                                    'tipo': _0x75a2ce,
                                    'sobra': _sobra
                                }), _0x1ca1fd('🔄\x20Adicionado\x20à\x20fila\x20FastAPI:\x20ref=' + _0x3ad043 + ',\x20numero=' + _0x5b6eca + ',\x20pacote=' + _0x37583a['nome'] + ',\x20quantidade=' + (_0x4e7edb / 0x400)['toFixed'](0x2) + 'GB' + (_sobra > 0 ? ' (Sobra ' + _sobra + 'MT)' : ''), 'queue');
                            } else {
                                if (_0x75a2ce === '3dias' && PACOTES_3DIAS[_0xccf39b]) {
                                    const _0x1fd0b6 = PACOTES_3DIAS[_0xccf39b];
                                    _0x1ca1fd('📅\x20PROCESSANDO\x20PACOTE\x203\x20DIAS\x20(SMS\x20já\x20recebido):\x20ref=' + _0x3ad043 + ',\x20numero=' + _0x5b6eca, '3dias'), await processarPacote3Dias(_0x51fcfd, _0x3ad043, _0x640595, _0x5b6eca, _0x1fd0b6, _0x2dd7f4);
                                } else {
                                    if (_0x75a2ce === 'semanal' && _0x39a69d[_0xccf39b]) {
                                        const _0x3c95e6 = _0x39a69d[_0xccf39b];
                                        _0x1ca1fd('📅\x20PROCESSANDO\x20PACOTE\x20SEMANAL\x20(SMS\x20já\x20recebido):\x20ref=' + _0x3ad043 + ',\x20numero=' + _0x5b6eca, 'semanal'), await _0x38212f(_0x51fcfd, _0x3ad043, _0x640595, _0x5b6eca, _0x3c95e6, _0x2dd7f4);
                                    } else {
                                        const _0x2f41f4 = await _0x3c2652('SELECT\x20quantidade,\x20divisoes\x20FROM\x20referencias\x20WHERE\x20ref=?', [_0x3ad043]);
                                        if (_0x2f41f4 && _0x2f41f4['length'] > 0x0) {
                                            const _0x505d2b = _0x2f41f4[0x0];
                                            if (_0x505d2b['quantidade'] > 0x2800) {
                                                const _0x358f04 = _0x3e1b5c([{
                                                    'numero': _0x5b6eca,
                                                    'quantidade': _0x505d2b['quantidade']
                                                }]);
                                                await _0x2c5e52('UPDATE\x20referencias\x20SET\x20divisoes=?\x20WHERE\x20ref=?', [JSON['stringify'](_0x358f04), _0x3ad043]), _0x1ca1fd('🔀\x20DIVISÃO\x20AUTOMÁTICA:\x20' + _0x5b6eca + '\x20→\x20' + _0x358f04['length'] + '\x20blocos\x20para\x20' + (_0x505d2b['quantidade'] / 0x400)['toFixed'](0x0) + 'GB', 'success');
                                                for (let _0x3d8661 = 0x0; _0x3d8661 < _0x358f04['length']; _0x3d8661++) {
                                                    const _0x1755bb = _0x358f04[_0x3d8661],
                                                        _0xf3ca57 = _0x3ad043 + '-' + _0x1755bb['numero'] + '-bloco-' + (_0x3d8661 + 0x1) + '-de-' + _0x358f04['length'];
                                                    _0x149dcd({
                                                        'ref': _0x3ad043,
                                                        'jid': _0x640595,
                                                        'numero': _0x1755bb['numero'],
                                                        'quantidade': _0x1755bb['quantidade'],
                                                        'remetente': _0x2dd7f4,
                                                        'tipo': _0x75a2ce,
                                                        'blocoId': _0xf3ca57
                                                    });
                                                }
                                            } else _0x149dcd({
                                                'ref': _0x3ad043,
                                                'jid': _0x640595,
                                                'numero': _0x5b6eca,
                                                'quantidade': _0x505d2b['quantidade'],
                                                'remetente': _0x2dd7f4,
                                                'tipo': _0x75a2ce,
                                                'sobra': _sobra
                                            }), _0x1ca1fd('🔄\x20Adicionado\x20à\x20fila\x20FastAPI:\x20ref=' + _0x3ad043 + ',\x20numero=' + _0x5b6eca + ',\x20quantidade=' + (_0x505d2b['quantidade'] / 0x400)['toFixed'](0x2) + 'GB' + (_sobra > 0 ? ' (Sobra ' + _sobra + 'MT)' : ''), 'queue');
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            } else _0x5b6eca && !_0x565bf8['sms_recebido'] && (_0x1ca1fd('⏳\x20Número\x20recebido\x20mas\x20SMS\x20ainda\x20não\x20chegou:\x20ref=' + _0x3ad043 + ',\x20status=aguardando_sms', 'info'), await _0x2c5e52('UPDATE\x20referencias\x20SET\x20numero=?,\x20status=\x27aguardando_sms\x27\x20WHERE\x20ref=?', [_0x5b6eca, _0x3ad043]));
        } catch (_0x449d33) {
            _0x1ca1fd('❌\x20Erro\x20ao\x20enviar\x20resumo\x20do\x20pedido:\x20ref=' + _0x3ad043 + ',\x20jid=' + _0x640595 + ',\x20remetente=' + _0x2dd7f4 + ',\x20erro=' + _0x449d33['message'], 'error');
        }
    }
    async function _0x12aa3a(_0x18d8ac, _0x9ed1ff, _0x134176, _0x3dd4e3, _0x241ec1, _0x20ea3e) {
        _0x1ca1fd((_0x241ec1['tipo'] === 'ilimitado_com_extra' ? '♾️+' : _0x241ec1['tipo'] === 'ilimitado' ? '♾️' : '📅') + '\x20INICIANDO\x20PROCESSAMENTO\x20DE\x20' + _0x241ec1['tipo']['toUpperCase']() + ':\x20' + _0x241ec1['nome'] + ',\x20ref=' + _0x9ed1ff + ',\x20numero=' + _0x3dd4e3, _0x241ec1['tipo']);
        try {
            if (_0x241ec1['tipo'] === '24hrs' || _0x241ec1['tipo'] === '24hrs') {
                const _0x4fc71e = await _0x3c2652('SELECT\x20quantidade\x20FROM\x20referencias\x20WHERE\x20ref=?', [_0x9ed1ff]);
                if (_0x4fc71e && _0x4fc71e['length'] > 0x0) {
                    const _0x4f7c05 = _0x4fc71e[0x0]['quantidade'];
                    if (!_0x4f7c05 || _0x4f7c05 < 0x64) {
                        const _0x317f32 = await _0x3c2652('SELECT\x20valor\x20FROM\x20referencias\x20WHERE\x20ref=?', [_0x9ed1ff]),
                            _0x21e0e4 = _0x317f32 && _0x317f32['length'] > 0x0 ? parseInt(_0x317f32[0x0]['valor']) : null;
                        if (_0x21e0e4 && _0x134176 && _0x7d9007[_0x134176] && _0x7d9007[_0x134176][_0x21e0e4]) {
                            const _0x367950 = _0x7d9007[_0x134176][_0x21e0e4],
                                _0x1dda9d = _0x367950['quantidade'] || _0x367950['quantidade_mb'];
                            await _0x2c5e52('UPDATE\x20referencias\x20SET\x20quantidade=?\x20WHERE\x20ref=?', [_0x1dda9d, _0x9ed1ff]), _0x1ca1fd('🔥\x20CORREÇÃO:\x20Quantidade\x20atualizada\x20no\x20BD:\x20' + _0x1dda9d + 'MB\x20para\x20valor\x20' + _0x21e0e4 + 'MT', 'warning');
                        }
                    }
                }
            }
            const _0x47c160 = ['ilimitado', 'ilimitado_com_extra'];
            if (!_0x47c160['includes'](_0x241ec1['tipo'])) {
                _0x1ca1fd('❌\x20ERRO:\x20Pacote\x20' + _0x241ec1['tipo'] + '\x20não\x20é\x20válido\x20para\x20processarPacoteEspecial', 'error');
                return;
            }
            const _0x22a5be = _0x13e11b['find'](_0x352039 => (_0x352039['id'] === 0x2249 || _0x352039['id'] === 8077) && _0x352039['online']);
            if (!_0x22a5be) {
                _0x1ca1fd('⏳ Porta 8777 OFFLINE para ' + _0x241ec1['tipo'] + ' - Recolocando na fila sem gastar retry: ref=' + _0x9ed1ff, 'warning');
                _enqueueOfflineWait({
                    'ref': _0x9ed1ff, 'jid': _0x134176, 'numero': _0x3dd4e3,
                    'quantidade': _0x241ec1['ativacao_mb'] || _0x241ec1['quantidade_mb'] || 0,
                    'remetente': _0x20ea3e, 'tipo': _0x241ec1['tipo'],
                    'input_val': 1, 'porta_obrigatoria': 0x2249,
                    'timestamp': Date.now(), 'prioridade': 15
                }, 20000);
                return;
            }
            _0x241ec1['input_val'] !== 0x1 && _0x1ca1fd('⚠️\x20ATENÇÃO:\x20Pacote\x20' + _0x241ec1['tipo'] + '\x20com\x20input_val=' + _0x241ec1['input_val'] + ',\x20forçando\x20input_val=1', 'warning');
            const _0x3c6d14 = _0x241ec1['ativacao_mb'] || 0x0,
                _0x690760 = _0x241ec1['tipo'] === 'ilimitado_com_extra' ? '♾️+\x20ILIMITADO\x20COM\x20EXTRAS' : '♾️\x20ILIMITADO';
            _0x1ca1fd((_0x241ec1['tipo'] === 'ilimitado_com_extra' ? '♾️+' : '♾️') + '\x20Enviando\x20ativação\x20completa\x20via\x20porta\x208777\x20(input_val=1\x20+\x20' + _0x3c6d14 + 'MB)', _0x241ec1['tipo']);
            const _0x28048a = await _0x2f0e92(_0x18d8ac, _0x9ed1ff, _0x134176, _0x3dd4e3, _0x3c6d14, _0x20ea3e, _0x241ec1['tipo'], _0x22a5be, 0x0, 0x1, 0x1);
            if (!_0x28048a) {
                _0x1ca1fd('❌\x20Falha\x20na\x20ativação\x20do\x20' + _0x241ec1['tipo'] + ':\x20ref=' + _0x9ed1ff, 'error'), await _0x2372f4('❌\x20Falha\x20na\x20ativação\x20do\x20' + _0x241ec1['tipo'] + '\x0a📋\x20Ref:\x20' + _0x9ed1ff + '\x0a📞\x20Número:\x20' + _0x3dd4e3 + '\x0a📦\x20Pacote:\x20' + _0x241ec1['nome']);
                return;
            }
            _0x1ca1fd('✅\x20Ativação\x20do\x20' + _0x241ec1['tipo'] + '\x20concluída:\x20ref=' + _0x9ed1ff, 'success');
            if (_0x241ec1['extras'] && _0x241ec1['extras'] > 0x0) {
                _0x1ca1fd((_0x241ec1['tipo'] === 'ilimitado_com_extra' ? '♾️+' : '♾️') + '\x20Processando\x20extras\x20em\x20paralelo:\x20' + _0x241ec1['extras'] + 'MB', _0x241ec1['tipo']);
                const _0x213770 = _0x3e1b5c([{
                    'numero': _0x3dd4e3,
                    'quantidade': _0x241ec1['extras']
                }]);
                for (let _0x25d6a4 = 0x0; _0x25d6a4 < _0x213770['length']; _0x25d6a4++) {
                    const _0x427b9c = _0x213770[_0x25d6a4],
                        _0x5a70c1 = _0x9ed1ff + '-' + _0x427b9c['numero'] + '-extra-bloco-' + (_0x25d6a4 + 0x1) + '-de-' + _0x213770['length'];
                    _0x149dcd({
                        'ref': _0x9ed1ff,
                        'jid': _0x134176,
                        'numero': _0x427b9c['numero'],
                        'quantidade': _0x427b9c['quantidade'],
                        'remetente': _0x20ea3e,
                        'tipo': 'normal',
                        'blocoId': _0x5a70c1,
                        'input_val': null
                    });
                }
                _0x1ca1fd('✅\x20' + _0x213770['length'] + '\x20blocos\x20extras\x20adicionados\x20para\x20processamento\x20paralelo:\x20ref=' + _0x9ed1ff, 'success');
            }
            _0x1ca1fd('✅\x20Processamento\x20de\x20' + _0x241ec1['tipo'] + '\x20iniciado\x20com\x20sucesso:\x20ref=' + _0x9ed1ff + ',\x20pacote=' + _0x241ec1['nome'], 'success'), await _0x2372f4('✅\x20Processamento\x20de\x20' + _0x241ec1['tipo'] + '\x20iniciado\x0a📋\x20Ref:\x20' + _0x9ed1ff + '\x0a📞\x20Número:\x20' + _0x3dd4e3 + '\x0a📦\x20Pacote:\x20' + _0x241ec1['nome'] + '\x0a' + (_0x241ec1['tipo'] === 'ilimitado_com_extra' ? '♾️+' : '♾️') + '\x20Ativação\x20concluída');
        } catch (_0x2bfb19) {
            _0x1ca1fd('❌\x20Erro\x20ao\x20processar\x20' + _0x241ec1['tipo'] + ':\x20ref=' + _0x9ed1ff + ',\x20erro=' + _0x2bfb19['message'], 'error'), await _0x2372f4('❌\x20Erro\x20ao\x20processar\x20' + _0x241ec1['tipo'] + '\x0a📋\x20Ref:\x20' + _0x9ed1ff + '\x0a📞\x20Número:\x20' + _0x3dd4e3 + '\x0a⚠️\x20Erro:\x20' + _0x2bfb19['message']);
        }
    }
    async function _0x3d533d(_0x5e52e1, _0x524119, _0x2575df, _0x28c3c4, _0x3a5e64, _0x3677fc) {
        _0x1ca1fd('📅\x20PROCESSANDO\x20PACOTE\x20MENSAL:\x20' + _0x3a5e64['nome'] + ',\x20ref=' + _0x524119 + ',\x20numero=' + _0x28c3c4, 'mensal');
        try {
            const _0x1f132a = _0x3a5e64['quantidade_mb'],
                _0x373ef8 = 0xb29,
                _0x2151e9 = _0x13e11b['find'](p => (p['id'] === 0x2249 || p['id'] === 8077 || p['id'] === 8777) && p['online']);
            if (!_0x2151e9) {
                _0x1ca1fd('⏳ Porta 8777 OFFLINE para pacote MENSAL - Recolocando na fila sem gastar retry: ref=' + _0x524119, 'warning');
                _enqueueOfflineWait({
                    'ref': _0x524119, 'jid': _0x2575df, 'numero': _0x28c3c4,
                    'quantidade': _0x3a5e64['quantidade_mb'] || 0,
                    'remetente': _0x3677fc, 'tipo': 'mensal',
                    'input_val': 1, 'porta_obrigatoria': 0x2249,
                    'timestamp': Date.now(), 'prioridade': 15
                }, 20000);
                return;
            }
            _0x1ca1fd('📅\x20Enviando\x20ativação\x20via\x20porta\x208777\x20(input_val=1\x20+\x202857MB)', 'mensal'), _0x1ca1fd('📊\x20Cálculo:\x20' + _0x1f132a + 'MB\x20total\x20-\x20' + _0x373ef8 + 'MB\x20(input_val=1)\x20=\x20' + (_0x1f132a - _0x373ef8) + 'MB\x20restante', 'info');
            const _0x4cff92 = await _0x2f0e92(_0x5e52e1, _0x524119, _0x2575df, _0x28c3c4, 0x0, _0x3677fc, 'mensal', _0x2151e9, 0x0, 0x1, 0x1);
            if (!_0x4cff92) {
                _0x1ca1fd('❌\x20Falha\x20na\x20ativação\x20do\x20pacote\x20mensal:\x20ref=' + _0x524119, 'error'), await _0x2372f4('❌\x20Falha\x20na\x20ativação\x20do\x20pacote\x20mensal\x0a📋\x20Ref:\x20' + _0x524119 + '\x0a📞\x20Número:\x20' + _0x28c3c4 + '\x0a📦\x20Pacote:\x20' + _0x3a5e64['nome']);
                return;
            }
            _0x1ca1fd('✅\x20Ativação\x20do\x20pacote\x20mensal\x20concluída:\x20ref=' + _0x524119, 'success');
            const _0x5d20c1 = _0x1f132a - _0x373ef8;
            if (_0x5d20c1 > 0x0) {
                _0x1ca1fd('📊\x20Processando\x20restante\x20em\x20portas\x20normais:\x20' + _0x5d20c1 + 'MB', 'mensal');
                const _0x2f72d6 = _0x3e1b5c([{
                    'numero': _0x28c3c4,
                    'quantidade': _0x5d20c1
                }]);
                for (let _0x1892a3 = 0x0; _0x1892a3 < _0x2f72d6['length']; _0x1892a3++) {
                    const _0x24ecb8 = _0x2f72d6[_0x1892a3],
                        _0x3fa9c9 = _0x524119 + '-' + _0x24ecb8['numero'] + '-restante-bloco-' + (_0x1892a3 + 0x1) + '-de-' + _0x2f72d6['length'];
                    _0x149dcd({
                        'ref': _0x524119,
                        'jid': _0x2575df,
                        'numero': _0x24ecb8['numero'],
                        'quantidade': _0x24ecb8['quantidade'],
                        'remetente': _0x3677fc,
                        'tipo': 'normal',
                        'blocoId': _0x3fa9c9,
                        'input_val': null
                    });
                }
                _0x1ca1fd('✅\x20' + _0x2f72d6['length'] + '\x20blocos\x20restantes\x20adicionados\x20para\x20processamento\x20paralelo:\x20ref=' + _0x524119, 'success');
            }
            _0x1ca1fd('✅\x20Processamento\x20de\x20pacote\x20mensal\x20iniciado\x20com\x20sucesso:\x20ref=' + _0x524119 + ',\x20pacote=' + _0x3a5e64['nome'], 'success'), await _0x2372f4('✅\x20Processamento\x20de\x20pacote\x20mensal\x20iniciado\x0a📋\x20Ref:\x20' + _0x524119 + '\x0a📞\x20Número:\x20' + _0x28c3c4 + '\x0a📦\x20Pacote:\x20' + _0x3a5e64['nome'] + '\x0a📅\x20Ativação\x20(2857MB)\x20concluída,\x20processando\x20restante...');
        } catch (_0x2eefe9) {
            _0x1ca1fd('❌\x20Erro\x20ao\x20processar\x20pacote\x20mensal:\x20ref=' + _0x524119 + ',\x20erro=' + _0x2eefe9['message'], 'error'), await _0x2372f4('❌\x20Erro\x20ao\x20processar\x20pacote\x20mensal\x0a📋\x20Ref:\x20' + _0x524119 + '\x0a📞\x20Número:\x20' + _0x28c3c4 + '\x0a⚠️\x20Erro:\x20' + _0x2eefe9['message']);
        }
    }
    async function _0x3ece63(_0x49d3de = 'normal', _ref = null, _jid = null) {
        await _0x47dccc(!![]);
        let _0x4fde08;
        if (_0x49d3de === 'ilimitado' || _0x49d3de === 'ilimitado_com_extra' || _0x49d3de === 'mensal') {
            _0x4fde08 = _0x13e11b['filter'](_0x3b72b0 => _0x3b72b0['id'] === 0x2249 && _0x3b72b0['online']);
        } else {
            _0x4fde08 = _0x13e11b['filter'](_0x32a4dd => {
                if (!filterPortForRequest(_0x32a4dd, _ref, _jid)) return false;
                return _0x32a4dd['online'];
            });
        }
        if (_0x4fde08['length'] === 0x0) return _0x1ca1fd('⏳\x20Nenhuma\x20porta\x20disponível\x20para\x20' + _0x49d3de + '\x20-\x20Item\x20será\x20adicionado\x20à\x20fila', 'warning'), null;
        const _0x2b1f52 = _0x4fde08['filter'](_0x48af2f => _0x48af2f['livre']);
        if (_0x2b1f52['length'] === 0x0) return _0x1ca1fd('⏳\x20Todas\x20as\x20' + _0x4fde08['length'] + '\x20porta(s)\x20estão\x20ocupadas\x20-\x20Item\x20será\x20adicionado\x20à\x20fila', 'warning'), null;
        _0x449b1a = (_0x449b1a + 0x1) % _0x2b1f52['length'];
        const _0x2be071 = _0x2b1f52[_0x449b1a];
        return _0x1ca1fd('🔁\x20ROUND-ROBIN:\x20' + _0x2be071['nome'] + '\x20selecionada\x20para\x20' + _0x49d3de, 'info'), _0x2be071;
    }
    async function _0x38212f(_0x45ab3b, _0x27ebf2, _0x1786b4, _0x35f2e6, _0x323bf9, _0x1560e9) {
        _0x1ca1fd('📅\x20PROCESSANDO\x20PACOTE\x20SEMANAL:\x20' + _0x323bf9['nome'] + ',\x20ref=' + _0x27ebf2 + ',\x20numero=' + _0x35f2e6 + ',\x20input_val=' + _0x323bf9['input_val'], 'semanal');
        try {
            if (!_0x323bf9['input_val']) return _0x1ca1fd('❌\x20ERRO:\x20Pacote\x20semanal\x20sem\x20input_val\x20definido:\x20ref=' + _0x27ebf2, 'error'), await _0x2372f4('❌\x20Erro:\x20Pacote\x20semanal\x20sem\x20input_val\x0a📋\x20Ref:\x20' + _0x27ebf2 + '\x0a📞\x20Número:\x20' + _0x35f2e6 + '\x0a📦\x20Pacote:\x20' + _0x323bf9['nome']), ![];
            const _0x47b007 = _0x13e11b['find'](p => (p['id'] === 0x2249 || p['id'] === 8077 || p['id'] === 8777) && p['online']);
            if (!_0x47b007) return _0x1ca1fd('❌ Porta 8777/8077 não encontrada no sistema: ref=' + _0x27ebf2, 'error'), await _0x2372f4('❌ Erro: Porta 8777/8077 não configurada\n📋 Ref: ' + _0x27ebf2 + '\n📞 Número: ' + _0x35f2e6 + '\n📦 Pacote: ' + _0x323bf9['nome']), ![];
            if (!_0x47b007['online'] || !_0x47b007['livre']) {
                _0x1ca1fd('⏳ Porta 8777 OFFLINE/OCUPADA para pacote SEMANAL - Recolocando na fila sem gastar retry: ref=' + _0x27ebf2, 'warning');
                _enqueueOfflineWait({
                    'ref': _0x27ebf2, 'jid': _0x1786b4, 'numero': _0x35f2e6,
                    'quantidade': _0x323bf9['quantidade_mb'],
                    'remetente': _0x1560e9, 'tipo': 'semanal',
                    'input_val': _0x323bf9['input_val'],
                    'porta_obrigatoria': 0x2249,
                    'timestamp': Date.now(), 'prioridade': 15
                }, 20000);
                await _0x2372f4('⏳ Pacote semanal aguardando porta 8777\n📋 Ref: ' + _0x27ebf2 + '\n📞 Número: ' + _0x35f2e6 + '\n📦 Pacote: ' + _0x323bf9['nome'] + '\n🔢 Input Val: ' + _0x323bf9['input_val'] + '\n⏰ Será ativado assim que a porta 8777 estiver disponível...');
                return !![];
            }
            _0x1ca1fd('📅\x20Enviando\x20pacote\x20semanal\x20via\x20porta\x208777:\x20' + _0x323bf9['quantidade_mb'] + 'MB,\x20input_val=' + _0x323bf9['input_val'], 'semanal');
            const _0x101e3f = await _0x2f0e92(_0x45ab3b, _0x27ebf2, _0x1786b4, _0x35f2e6, _0x323bf9['quantidade_mb'], _0x1560e9, 'semanal', _0x47b007, 0x0, 0x1, _0x323bf9['input_val']);
            if (!_0x101e3f) return _0x1ca1fd('⚠️\x20Falha\x20no\x20envio\x20do\x20pacote\x20semanal,\x20adicionando\x20à\x20fila\x20para\x20retry:\x20ref=' + _0x27ebf2, 'warning'), _0x149dcd({
                'ref': _0x27ebf2,
                'jid': _0x1786b4,
                'numero': _0x35f2e6,
                'quantidade': _0x323bf9['quantidade_mb'],
                'remetente': _0x1560e9,
                'tipo': 'semanal',
                'input_val': _0x323bf9['input_val'],
                'porta_obrigatoria': 0x2249,
                'timestamp': Date['now'](),
                'tentativas': 0x1,
                'prioridade': 0xf
            }), await _0x2372f4('⚠️\x20Falha\x20no\x20envio\x20do\x20pacote\x20semanal\x0a📋\x20Ref:\x20' + _0x27ebf2 + '\x0a📞\x20Número:\x20' + _0x35f2e6 + '\x0a📦\x20Pacote:\x20' + _0x323bf9['nome'] + '\x0a🔢\x20Input\x20Val:\x20' + _0x323bf9['input_val'] + '\x0a🔄\x20Adicionado\x20à\x20fila\x20para\x20retry'), ![];
            return _0x1ca1fd('✅\x20Ativação\x20do\x20pacote\x20semanal\x20concluída:\x20ref=' + _0x27ebf2, 'success'), _0x1ca1fd('✅\x20Processamento\x20de\x20pacote\x20semanal\x20iniciado\x20com\x20sucesso:\x20ref=' + _0x27ebf2 + ',\x20pacote=' + _0x323bf9['nome'], 'success'), await _0x2372f4('✅\x20Processamento\x20de\x20pacote\x20semanal\x20iniciado\x0a📋\x20Ref:\x20' + _0x27ebf2 + '\x0a📞\x20Número:\x20' + _0x35f2e6 + '\x0a📦\x20Pacote:\x20' + _0x323bf9['nome'] + '\x0a⏳\x20Período:\x20' + _0x323bf9['periodo'] + '\x0a🔢\x20Input\x20Val:\x20' + _0x323bf9['input_val']), !![];
        } catch (_0x3fc3ba) {
            return _0x1ca1fd('❌\x20Erro\x20ao\x20processar\x20pacote\x20semanal:\x20ref=' + _0x27ebf2 + ',\x20erro=' + _0x3fc3ba['message'], 'error'), _0x149dcd({
                'ref': _0x27ebf2,
                'jid': _0x1786b4,
                'numero': _0x35f2e6,
                'quantidade': _0x323bf9['quantidade_mb'],
                'remetente': _0x1560e9,
                'tipo': 'semanal',
                'input_val': _0x323bf9['input_val'],
                'porta_obrigatoria': 0x2249,
                'timestamp': Date['now'](),
                'tentativas': 0x1,
                'prioridade': 0xf,
                'erro': _0x3fc3ba['message']
            }), await _0x2372f4('❌\x20Erro\x20ao\x20processar\x20pacote\x20semanal\x0a📋\x20Ref:\x20' + _0x27ebf2 + '\x0a📞\x20Número:\x20' + _0x35f2e6 + '\x0a⚠️\x20Erro:\x20' + _0x3fc3ba['message'] + '\x0a🔄\x20Adicionado\x20à\x20fila\x20para\x20retry'), ![];
        }
    }
    async function _0x384ba7(_0x86eea8, _0x55f3ff, _0x2d3734, _0x18c662, _0xb21bfc, _0x287c47, _0x550bff, _0x38af43, _0xf9d062 = 'normal', _0x3955c5 = ![], _sobra = 0) {
        if (_0x38af43 === 'SISTEMA_PLANOS') {
            if (_0x2d3734 && _0x2d3734.startsWith('PLAN-')) {
                const formatarMB = (mb) => {
                    if (mb >= 1024) {
                        const gb = mb / 1024;
                        return Number.isInteger(gb) ? `${gb} GB` : `${gb.toFixed(1)} GB`;
                    }
                    return `${mb} MB`;
                };
                const qtdFormatada = formatarMB(_0xb21bfc);
                const msgDaily = `✨ *ENTREGA DIÁRIA CONCLUÍDA!* 📶\n━━━━━━━━━━━━━━━━━━━\nO seu lote diário programado de *${qtdFormatada}* foi enviado com sucesso para o número *${_0x287c47.replace('258', '')}*! 🚀\n\n📊 Use *.meuplano* para ver o seu saldo pendente.\n━━━━━━━━━━━━━━━━━━━\n🤖 *KaNet 2.0 - Sempre Conectado!*`;
                try {
                    await _0x461461(_0x86eea8, _0x55f3ff, msgDaily, null);
                    _0x1ca1fd('📨 Resumo de entrega programada enviado com sucesso: ref=' + _0x2d3734 + ', jid=' + _0x55f3ff, 'success');
                } catch(e) {
                    _0x1ca1fd('⚠️ Erro ao enviar resumo de entrega programada: ' + e.message, 'warning');
                }
            } else {
                _0x1ca1fd('ℹ️ Ignorando envio de resumo final padrão para ativação inicial de plano especial: ref=' + _0x2d3734, 'info');
            }
            return;
        }

        if (!_0x86eea8 || typeof _0x86eea8['reply'] !== 'function') {
            _0x1ca1fd('❌\x20Cliente\x20WhatsApp\x20não\x20disponível\x20para\x20enviar\x20resumo\x20final:\x20ref=' + _0x2d3734 + ',\x20jid=' + _0x55f3ff + ',\x20remetente=' + _0x38af43, 'error');
            return;
        }
        const _0x5155fa = new Date()['toLocaleString']('pt-PT', {
            'day': '2-digit',
            'month': '2-digit',
            'year': '2-digit',
            'hour': '2-digit',
            'minute': '2-digit',
            'hour12': ![]
        })['replace'](',', '\x20às');
        let _0x36af86 = '';
        const _0x20434a = _0x18c662 ? parseInt(_0x18c662) : null;
        const cleanNum = _0x287c47.replace('258', '');
        if (_0x3955c5) {
            _0x36af86 = `⚡ *PACOTE ENVIADO (PARCIAL)* 🚀\n` +
                        `─── • ─── • ───\n` +
                        `🔗 *Ref:* \`${_0x2d3734}\`\n` +
                        `📲 *Destino:* ${cleanNum}\n` +
                        `💾 *Franquia:* ${(_0xb21bfc / 1024).toFixed(1)} GB\n` +
                        `🕒 *Data/Hora:* ${_0x5155fa}`;
        } else {
            if (_0xf9d062 === 'ilimitado' && _0x20434a && _0x9a616a[_0x20434a]) {
                const _0x3009a2 = _0x9a616a[_0x20434a];
                _0x36af86 = `⚡ *PACOTE ILIMITADO ATIVADO* 🚀\n` +
                            `─── • ─── • ───\n` +
                            `🔗 *Ref:* \`${_0x2d3734}\`\n` +
                            `📲 *Destino:* ${cleanNum}\n` +
                            `🎁 *Plano:* ${_0x3009a2['nome']}\n` +
                            `🕒 *Data/Hora:* ${_0x5155fa}`;
            } else if (_0xf9d062 === 'ilimitado_com_extra' && _0x20434a && _0x9a616a[_0x20434a]) {
                const _0x1d3b66 = _0x9a616a[_0x20434a];
                _0x36af86 = `✅ *PACOTE ILIMITADO ATIVADO!* 🎉\n` +
                            `━━━━━━━━━━━━━━━━━━\n` +
                            `🔖 *Ref:* \`${_0x2d3734}\`\n` +
                            `📲 *Destino:* ${cleanNum}\n` +
                            `🎁 *Plano:* ${_0x1d3b66['nome']} + Extras\n` +
                            `🕒 *Data/Hora:* ${_0x5155fa}\n` +
                            `━━━━━━━━━━━━━━━━━━\n` +
                            `_Obrigado pela preferência! 🙏_`;
            } else if (_0xf9d062 === 'mensal' && _0x20434a && _0x17ff51[_0x20434a]) {
                const _0x44a959 = _0x17ff51[_0x20434a];
                _0x36af86 = `✅ *PACOTE MENSAL ATIVADO!* 🎉\n` +
                            `━━━━━━━━━━━━━━━━━━\n` +
                            `🔖 *Ref:* \`${_0x2d3734}\`\n` +
                            `📲 *Destino:* ${cleanNum}\n` +
                            `📅 *Plano:* ${_0x44a959['nome']}\n` +
                            `🕒 *Data/Hora:* ${_0x5155fa}\n` +
                            `━━━━━━━━━━━━━━━━━━\n` +
                            `_Obrigado pela preferência! 🙏_`;
            } else {
                const _0x47c49a = (_0xf9d062 === 'saldo' || _0xf9d062 === 'credito') ? (_0xb21bfc + ' MT Saldo') : (_0xb21bfc < 1024 ? _0xb21bfc + ' MB' : (Math.round(_0xb21bfc / 1024) + ' GB'));
                _0x36af86 = `✅ *PACOTE ATIVADO COM SUCESSO!* 🎉\n` +
                            `━━━━━━━━━━━━━━━━━━\n` +
                            `🔖 *Ref:* \`${_0x2d3734}\`\n` +
                            `📲 *Destino:* ${cleanNum}\n` +
                            `💾 *Volume:* ${_0x47c49a}\n` +
                            `🕒 *Data/Hora:* ${_0x5155fa}\n` +
                            `━━━━━━━━━━━━━━━━━━\n` +
                            `_Obrigado pela preferência! 🙏_`;
            }
        }

        if (_sobra > 0) {
            _0x36af86 += '\n\n💰 *SALDO RESTANTE:* ' + _sobra + ' MT 🇲🇿\n💡 O seu saldo restante foi guardado e será usado automaticamente na próxima ativação!';
        }

        try {
            let jidEnvio = _0x55f3ff;
            let replyId = _0x550bff || null;

            // --- ESTRATÉGIA DE ENVIO DO RESUMO FINAL ---
            // 1. Se o jid de origem é @lid (WhatsApp MD), tentar convertê-lo para @c.us para garantir a entrega
            // 2. Se o jid é @g.us (grupo), enviar ao grupo com reply.
            // 3. Se o jid é @c.us, enviar directo com reply.

            if (jidEnvio && jidEnvio.endsWith('@lid') && !replyId) {
                if (_0x38af43 && (_0x38af43.endsWith('@c.us') || _0x38af43.endsWith('@s.whatsapp.net'))) {
                    _0x1ca1fd('🔄 Convertendo resumo final @lid para @c.us do remetente: ' + _0x38af43, 'info');
                    jidEnvio = _0x38af43;
                } else if (_0x287c47) {
                    let cleanNum = String(_0x287c47).trim().replace('258', '');
                    if (cleanNum.length === 9) {
                        _0x1ca1fd('🔄 Convertendo resumo final @lid para @c.us do destino: 258' + cleanNum + '@c.us', 'info');
                        jidEnvio = '258' + cleanNum + '@c.us';
                    }
                }
            }

            if (jidEnvio && jidEnvio.endsWith('@lid')) {
                // Tentar reply ao chat @lid original se ainda for @lid
                if (replyId) {
                    _0x1ca1fd('📤 Enviando resumo final via reply ao @lid: ' + jidEnvio, 'info');
                    await _0x461461(_0x86eea8, jidEnvio, _0x36af86, replyId);
                } else {
                    _0x1ca1fd('⚠️ @lid sem reply_id e sem remetente @c.us - resumo omitido para jid: ' + jidEnvio, 'warning');
                }
            } else {
                // Grupo ou @c.us directo - enviar normalmente com reply se disponível
                await _0x461461(_0x86eea8, jidEnvio, _0x36af86, replyId);
            }
            _0x1ca1fd('📨 Resumo final enviado: ref=' + _0x2d3734 + ', jid=' + jidEnvio + ', numero=' + _0x287c47 + ', tipo=' + _0xf9d062 + ', isParteExtra=' + _0x3955c5 + ', sobra=' + _sobra, 'success');

            // --- ENVIAR NO PRIVADO AO REMETENTE (admin em grupo) ---
            if (_0x38af43 && _0x38af43 !== 'SISTEMA_BONUS') {
                let _targetPrivado = _0x38af43;
                if (typeof _targetPrivado === 'string') {
                    if (!_targetPrivado.includes('@')) {
                        _targetPrivado = _targetPrivado + '@c.us';
                    }
                    // Só envia no privado se a origem for grupo (não duplicar para privado→privado)
                    if (_0x55f3ff && _0x55f3ff.includes('@g.us') && _targetPrivado.includes('@c.us')) {
                        try {
                            await _0x461461(_0x86eea8, _targetPrivado, _0x36af86, null);
                            _0x1ca1fd('📨 Resumo final enviado no privado ao remetente: ref=' + _0x2d3734 + ', jid=' + _targetPrivado, 'success');
                        } catch (errPriv) {
                            _0x1ca1fd('⚠️ Erro ao enviar resumo no privado ao remetente: ' + errPriv.message, 'warning');
                        }
                    }
                }
            }

            // --- NOTIFICAÇÃO DIRECTA AO CLIENTE (número receptor dos dados) ---
            // Apenas quando o admin envia o comando manualmente — o cliente não está no chat.
            // Como o cliente pode não ter histórico com o bot (Not a contact), tentamos reply
            // mas aceitamos falha silenciosa (o admin já foi notificado acima).
            if (_0x287c47 && _0x38af43 !== 'SISTEMA_BONUS') {
                try {
                    let _cleanNum = String(_0x287c47).trim();
                    if (!_cleanNum.startsWith('258')) _cleanNum = '258' + _cleanNum;
                    const _targetClienteJid = _cleanNum + '@c.us';

                    const _remetenteIsAdmin = _0x38af43 && (
                        String(_0x38af43).includes('258856116039') ||
                        String(_0x38af43).includes('856116039')
                    );

                    // Só envia ao cliente quando admin envia o comando E destino é diferente de quem já foi notificado
                    if (_remetenteIsAdmin &&
                        _targetClienteJid !== jidEnvio &&
                        _targetClienteJid !== _0x38af43) {
                        const _sendCli = await _0x86eea8['sendText'](_targetClienteJid, _0x36af86).catch(() => null);
                        if (_sendCli && typeof _sendCli !== 'string') {
                            _0x1ca1fd('📨 Resumo final enviado directamente ao cliente: ref=' + _0x2d3734 + ', jid=' + _targetClienteJid, 'success');
                        } else {
                            _0x1ca1fd('⚠️ Cliente ' + _targetClienteJid + ' não é contacto do bot - notificação não entregue (normal se cliente nunca falou com o bot)', 'warning');
                        }
                    }
                } catch (_errCli) {
                    _0x1ca1fd('⚠️ Erro ao enviar resumo directo ao cliente: ' + _errCli.message, 'warning');
                }
            }

            // --- BÓNUS DE PRIMEIRA COMPRA DESATIVADO ---

            // --- ATRIBUIÇÃO DE BÓNUS DE INDICAÇÃO ---
            if (!_0x3955c5 && _0x38af43 !== 'SISTEMA_BONUS') {
                try {
                    const _childJidNorm = _0x55f3ff.split('@')[0];
                    const _indicacao = await _0x3c2652('SELECT parent_jid FROM bonus_referencia WHERE jid=?', [_childJidNorm]);
                    if (_indicacao && _indicacao.length > 0 && _indicacao[0].parent_jid) {
                        const _parent = _indicacao[0].parent_jid;
                        const _parentJidNorm = _parent.split('@')[0];
                        
                        // Calcular nível de fidelidade do Padrinho (parent) para dar bónus maior (boost)
                        const _parentPurchasesRes = await _0x3c2652('SELECT COUNT(*) as total FROM referencias WHERE (jid=? OR jid LIKE ? OR remetente=? OR remetente LIKE ?) AND status IN ("finalizado", "processada")', [_parentJidNorm, _parentJidNorm + '@%', _parentJidNorm, _parentJidNorm + '@%']);
                        const _parentPurchases = (_parentPurchasesRes && _parentPurchasesRes.length > 0) ? (_parentPurchasesRes[0].total || 0) : 0;
                        
                        let _bonusMB = 200;
                        let _boostInfo = '';
                        if (_parentPurchases >= 16) {
                            _bonusMB = 230; // Platina (+15%)
                            _boostInfo = ' (Boost Platina 💎 +15%)';
                        } else if (_parentPurchases >= 8) {
                            _bonusMB = 220; // Ouro (+10%)
                            _boostInfo = ' (Boost Ouro 🥇 +10%)';
                        } else if (_parentPurchases >= 3) {
                            _bonusMB = 210; // Prata (+5%)
                            _boostInfo = ' (Boost Prata 🥈 +5%)';
                        }

                        // 1. Sempre insere com status "acumulando"
                        await _0x2c5e52('INSERT INTO bonus_contribuicoes (parent_jid, indicado_jid, mb, status) VALUES (?, ?, ?, "acumulando")', [_parentJidNorm, _childJidNorm, _bonusMB]);
                        _0x1ca1fd('🎁 Bónus de ' + _bonusMB + 'MB acumulado para ' + _parentJidNorm + ' pela compra de ' + _childJidNorm, 'success');

                        // 2. Conta as compras bem-sucedidas do indicado
                        const childPurchasesRes = await _0x3c2652('SELECT COUNT(*) as total FROM referencias WHERE (jid=? OR jid LIKE ? OR remetente=? OR remetente LIKE ?) AND status IN ("finalizado", "processada")', [_childJidNorm, _childJidNorm + '@%', _childJidNorm, _childJidNorm + '@%']);
                        const childPurchases = (childPurchasesRes && childPurchasesRes.length > 0) ? (childPurchasesRes[0].total || 0) : 0;

                        if (childPurchases >= 6) {
                            // Verificar se existem bónus "acumulando" para este indicado
                            const pendingAcumRes = await _0x3c2652('SELECT SUM(mb) as total FROM bonus_contribuicoes WHERE parent_jid=? AND indicado_jid=? AND status="acumulando"', [_parentJidNorm, _childJidNorm]);
                            const totalAcumulado = (pendingAcumRes && pendingAcumRes.length > 0) ? (pendingAcumRes[0].total || 0) : 0;
                            
                            if (totalAcumulado > 0) {
                                // Liberta todos os acumulados mudando para "pendente" (disponível para resgate)
                                await _0x2c5e52('UPDATE bonus_contribuicoes SET status="pendente" WHERE parent_jid=? AND indicado_jid=? AND status="acumulando"', [_parentJidNorm, _childJidNorm]);
                                _0x1ca1fd('🔓 BÓNUS LIBERTADO (segundo bloco): Total de ' + totalAcumulado + 'MB libertados para o padrinho ' + _parentJidNorm + ' após ' + childPurchases + ' compras do indicado ' + _childJidNorm, 'success');
                                
                                // Notificar o padrinho se possível
                                try {
                                    const _parentToSend = _parentJidNorm.includes('@') ? _parentJidNorm : _parentJidNorm + '@c.us';
                                    await _0x461461(_0x86eea8, _parentToSend, `🎉 *PARABÉNS! SEUS BÓNUS FORAM LIBERTADOS!* 🎉\n━━━━━━━━━━━━━━━━━━━\nO amigo que você indicou (*${_childJidNorm}*) completou a *${childPurchases}ª compra*!\n\nVocê acumulou e acabou de receber o somatório de todas as compras dele: \n🎁 *${totalAcumulado}MB de bónus grátis*!${_boostInfo} 🚀\n\n👉 Digite *!bonus* para ver e resgatar o seu saldo acumulado.`, null);
                                } catch(e) {}
                            }
                        } else {
                            _0x1ca1fd('ℹ️ Bónus acumulando (segundo bloco): ' + _childJidNorm + ' tem ' + childPurchases + '/6 compras para libertar o somatório.', 'info');
                        }
                    }
                } catch(e) {
                    _0x1ca1fd('❌ Erro ao atribuir bónus: ' + e.message, 'error');
                }
            }
        } catch (_0x52653e) {
            _0x1ca1fd('❌\x20Erro\x20ao\x20enviar\x20resumo\x20final:\x20ref=' + _0x2d3734 + ',\x20jid=' + _0x55f3ff + ',\x20remetente=' + _0x38af43 + ',\x20erro=' + _0x52653e['message'], 'error');
        }
    }
    async function _0x49909c(_0x5a1f4f, _0x55d2fe, _0x34c932, _0x5a872d, _0x19fc4c, _0x6bbde1, _0x3141ed, _0x203837) {
        if (_0x31c7ff(_0x34c932)) {
            _0x1ca1fd('🚫\x20COMPROVATIVO\x20BLOQUEADO\x20-\x20Referência\x20eliminada:\x20ref=' + _0x34c932, 'warning'), await _0x461461(_0x5a1f4f, _0x3141ed, '🚫\x20A\x20referência\x20*' + _0x34c932 + '*\x20foi\x20eliminada\x20e\x20não\x20pode\x20ser\x20reutilizada.\x20Envie\x20um\x20novo\x20comprovativo.', _0x55d2fe['id']);
            return;
        }
        const _0x48007a = await _0x3c2652('SELECT\x20*\x20FROM\x20referencias\x20WHERE\x20ref=?', [_0x34c932]);
        if (_0x48007a && _0x48007a['length'] > 0x0) {
            const _0xabe1b5 = _0x48007a[0x0];
            // Só bloqueia se o remetente for outro utilizador WhatsApp (JID)
            // Não bloqueia se for um remetente de SMS (M-Pesa, E-Mola, etc.)
            const _remetCompWhatsapp = _0xabe1b5['remetente'] && (_0xabe1b5['remetente'].includes('@c.us') || _0xabe1b5['remetente'].includes('@g.us'));
            if (_remetCompWhatsapp && _0xabe1b5['remetente'] !== _0x203837) {
                _0x1ca1fd('🚫 COMPROVATIVO BLOQUEADO - Referência ' + _0x34c932 + ' pertence a outro remetente: ' + _0xabe1b5['remetente'], 'warning');
                const msgNegado = `⚠️ *REIVINDICAÇÃO NEGADA!* 🛑\n━━━━━━━━━━━━━━━━━━━\nEsta referência de pagamento (*${_0x34c932}*) já foi registrada por outro cliente.\n\nCada transação é de *uso exclusivo* do comprador original.`;
                try {
                    await _0x461461(_0x5a1f4f, _0x3141ed, msgNegado, _0x55d2fe['id']);
                } catch (e) {}
                return;
            }
            if (_0xabe1b5['comprovativo'] || ['finalizado', 'processada', 'bloco_processado', 'processando', 'aguardando_confirmacao'].includes(_0xabe1b5['status'])) {
                _0x1ca1fd('🚫 COMPROVATIVO BLOQUEADO - Referência ' + _0x34c932 + ' já utilizada: status=' + _0xabe1b5['status'], 'warning');
                const msgUsado = `⚠️ *COMPROVATIVO JÁ UTILIZADO!* 🛑\n━━━━━━━━━━━━━━━━━━━\nEsta referência de pagamento (*${_0x34c932}*) já foi processada e ativada anteriormente.\n\nCada comprovativo é de *uso único e exclusivo* e não pode ser reutilizado.`;
                try {
                    await _0x461461(_0x5a1f4f, _0x3141ed, msgUsado, _0x55d2fe['id']);
                } catch (e) {}
                return;
            }
        }
        await _0x209ec4(_0x5a1f4f, _0x55d2fe['body'], _0x55d2fe, _0x203837);
    }
    
    async function _0x209ec4(_0x5de4d0, _0x2b4a35, _0x543a9c, _0x528f6e) {
        const _0x295d41 = _0x76d942(_0x2b4a35),
            _0x30ee50 = Date['now']();
        if (_0x5b3974['has'](_0x295d41)) {
            const _0x2cd1f3 = _0x5b3974['get'](_0x295d41);
            if (_0x30ee50 - _0x2cd1f3 < _0x1d9355) {
                _0x1ca1fd('🚫\x20SMS\x20BLOQUEADO\x20-\x20Processado\x20recentemente\x20(' + Math['round']((_0x30ee50 - _0x2cd1f3) / 0x3e8) + 's\x20atrás):\x20ref=' + _0xf8719e(_0x2b4a35), 'warning');
                return;
            }
        }
        const _0x6f5c22 = _0xf8719e(_0x2b4a35);
        let _0x1c20e9 = _0x3d5bec(_0x2b4a35);
        const _0x377151 = _0x38787d(_0x2b4a35),
            _0x1358eb = _0x2807cf(_0x2b4a35);

        // --- EXTRAIR NÚMERO DE DESTINO SE ESCRITO PELO CLIENTE ---
        // Procuramos de forma genérica e robusta por qualquer número Vodacom (84/85) válido e não-bot na mensagem
        let _0xextractedNum = _0x1c9c6a(_0x2b4a35);
        const _0xwhatsappJid = _0x543a9c && _0x543a9c['from'] ? _0x543a9c['from'] : null;
        const _0xautoJid = _0xwhatsappJid || null;
        const _0xmsgId = _0x543a9c && _0x543a9c['id'] ? _0x543a9c['id'] : null;

        _0x1ca1fd('💬\x20SMS\x20recebido\x20via\x20ADB:\x20ref=' + _0x6f5c22 + ',\x20valor=' + _0x1c20e9 + ',\x20numero_extraido=' + (_0xextractedNum || 'nenhum') + ',\x20sucesso=' + _0x1358eb + ',\x20remetente=' + _0x528f6e + ',\x20texto=' + _0x2b4a35['substring'](0x0, 0x64) + '...', 'info'), await _0x2372f4('💬\x20SMS\x20recebido\x0a📋\x20Referência:\x20' + (_0x6f5c22 || 'N/A') + '\x0a💸\x20Valor:\x20' + (_0x1c20e9 || 'N/A') + 'MT\x0a📞\x20Número\x20Extraído:\x20' + (_0xextractedNum || 'N/A') + '\x0a✅\x20Sucesso:\x20' + _0x1358eb + '\x0a📝\x20Texto:\x20' + _0x2b4a35);
        if (_0x1358eb) {
            const _0x287882 = _0x2b4a35['match'](/(258[2-7]\d{7})/),
                _0x15ef9b = _0x287882 ? _0x287882[0x1] : null,
                _0x1aad8b = _0x2b4a35['match'](/(\d+)MB/),
                _0x17a842 = _0x1aad8b ? parseInt(_0x1aad8b[0x1]) : null;
            if (!_0x15ef9b || !_0x17a842) {
                _0x1ca1fd('⚠️\x20SMS\x20de\x20sucesso\x20sem\x20número\x20ou\x20quantidade\x20válida:\x20texto=' + _0x2b4a35 + ',\x20remetente=' + _0x528f6e, 'warning'), await _0x2372f4('⚠️\x20SMS\x20de\x20sucesso\x20sem\x20número\x20ou\x20quantidade\x20válida\x0a📝\x20Texto:\x20' + _0x2b4a35);
                return;
            }
            await _0x387908(_0x5de4d0, _0x15ef9b, _0x17a842);
            return;
        }
        if (_0x377151) {
            await _0x48afc0(_0x5de4d0, _0x377151['numero'], _0x377151['quantidade']);
            return;
        }
        if (!_0x6f5c22 || !_0x1c20e9) {
            _0x1ca1fd('⚠️\x20SMS\x20sem\x20referência\x20ou\x20valor\x20válido:\x20ref=' + _0x6f5c22 + ',\x20valor=' + _0x1c20e9 + ',\x20remetente=' + _0x528f6e + ',\x20texto=' + _0x2b4a35['substring'](0x0, 0x64) + '...', 'warning'), await _0x2372f4('⚠️\x20SMS\x20sem\x20referência\x20ou\x20valor\x20válido\x0a📋\x20Ref:\x20' + (_0x6f5c22 || 'N/A') + '\x0a💸\x20Valor:\x20' + (_0x1c20e9 || 'N/A') + 'MT\x0a📝\x20Texto:\x20' + _0x2b4a35);
            return;
        }

        // --- VERIFICAÇÃO DE SEGURANÇA: Só exige "Recebeste" para SMS reais (ADB) ---
        const _isFromWhatsapp = _0x543a9c !== null;
        const _txtLower = _0x2b4a35.toLowerCase();
        const _isIncomingMoney = _txtLower.includes('recebeste') || _txtLower.includes('recebeu') || _txtLower.includes('confirmado') || _txtLower.includes('depositou') || _txtLower.includes('recebido');
        
        if (!_isFromWhatsapp && !_isIncomingMoney) {
            _0x1ca1fd('🚫 SMS ADB IGNORADO: Não é um pagamento de entrada. Texto: ' + _0x2b4a35.substring(0, 50), 'warning');
            return;
        }
        _0x5b3974['set'](_0x295d41, _0x30ee50), setTimeout(() => _0x5b3974['delete'](_0x295d41), _0x1d9355 * 0x2);
        const _0x559cc8 = 'sms-' + _0x6f5c22;
        await _0x39c852(_0x559cc8, async () => {
            _0x5b3974['set'](_0x295d41, _0x30ee50);
            if (_0x5b3974['size'] > 0x3e8) {
                const _0xb1d38 = Date['now']();
                for (let [_0x37628e, _0x373749] of _0x5b3974['entries']()) {
                    _0xb1d38 - _0x373749 > _0x1d9355 * 0x2 && _0x5b3974['delete'](_0x37628e);
                }
            }
            let _0x3ca1e8;
            try {
                // --- CADA PAGAMENTO É TRATADO INDIVIDUALMENTE (SEM SOMA/ACUMULAÇÃO) ---
                let _valorTotalParaCheck = _0x1c20e9;
                let _pendentes = [];

                // Buscar a referência no banco de dados primeiro para sabermos quem enviou e de onde veio
                _0x3ca1e8 = await _0x3c2652('SELECT * FROM referencias WHERE ref=?', [_0x6f5c22]);
                const _refJid = (_0x3ca1e8 && _0x3ca1e8.length > 0) ? (_0x3ca1e8[0].jid || _0x3ca1e8[0].remetente) : null;

                let _0x5764cd = _0x3b207d(_valorTotalParaCheck, _refJid);
                
                let _sobraCalculada = 0;

                if (!_0x5764cd) {
                    _0x1ca1fd('⚠️ Valor ' + _valorTotalParaCheck + 'MT não corresponde a nenhum pacote: ref=' + _0x6f5c22, 'warning');
                    if (_0x543a9c) {
                        const { supportNum, sysName: _sN } = _getSupportDetails();
                        const _msgSaldo = `✨ *${_sN.toUpperCase()} • NOTIFICAÇÃO* ✨\n━━━━━━━━━━━━━━━━━━━\n\n⚠️ *VALOR NÃO RECONHECIDO*\n\nAnalisamos o seu comprovativo, mas o valor de *${_valorTotalParaCheck} MT* não corresponde a nenhum pacote na nossa tabela atual.\n\nPor favor, contacte a administração pelo número *${supportNum}* para que possamos ativar o seu pacote manualmente.\n\nO seu saldo está seguro com a ${_sN}! 🙏\n\n━━━━━━━━━━━━━━━━━━━\n🚀 *Internet rápida em segundos!*`;
                        await _0x461461(_0x5de4d0, _0xwhatsappJid, _msgSaldo, _0xmsgId);
                    }
                    return;
                }

                const {
                    quantidade: _0x5ee650,
                    tipo: _0x36abaf,
                    descricao: _0x57405c,
                    periodo: _0x46454d,
                    input_val: _0x1886fd,
                    extras: _0x11744f,
                    bonus_por_dia: _0xe56f46,
                    total_dias: _0x4e58e0
                } = _0x5764cd;
                _0x3ca1e8 = await _0x3c2652('SELECT\x20*\x20FROM\x20referencias\x20WHERE\x20ref=?', [_0x6f5c22]);
                if (_0x3ca1e8 && _0x3ca1e8['length'] > 0x0) {
                    const _0x35f103 = _0x3ca1e8[0x0],
                        _0x13c649 = _0x35f103['status'],
                        _0x1ca7ce = ['aguardando_sms', 'aguardando_comprovativo', 'aguardando_confirmacao', 'aguardando_numero', 'aguardando_sms'];
                    if (_0x1ca7ce['includes'](_0x13c649)) {
                        if (_0x35f103['comprovativo'] && _0x35f103['comprovativo'] !== 'REIVINDICADO_TEXTO') {
                            const _0x113ae8 = _0xf8719e(_0x35f103['comprovativo']),
                                _0x1a9ce6 = _0x3d5bec(_0x35f103['comprovativo']);
                            if (_0x6f5c22 !== _0x113ae8) {
                                _0x1ca1fd('❌\x20SMS\x20REJEITADO\x20-\x20Referência\x20não\x20corresponde\x20ao\x20comprovativo:\x20ref_sms=' + _0x6f5c22 + ',\x20ref_comprovativo=' + _0x113ae8, 'error'), await _0x2372f4('❌\x20SMS\x20REJEITADO\x20-\x20Referência\x20não\x20corresponde\x0a📋\x20SMS:\x20' + _0x6f5c22 + '\x0a📋\x20Comprovativo:\x20' + _0x113ae8);
                                return;
                            }
                            if (_0x1c20e9 !== _0x1a9ce6) {
                                _0x1ca1fd('❌\x20SMS\x20REJEITADO\x20-\x20Valor\x20não\x20corresponde\x20ao\x20comprovativo:\x20valor_sms=' + _0x1c20e9 + ',\x20valor_comprovativo=' + _0x1a9ce6, 'error'), await _0x2372f4('❌\x20SMS\x20REJEITADO\x20-\x20Valor\x20não\x20corresponde\x0a💸\x20SMS:\x20' + _0x1c20e9 + 'MT\x0a💸\x20Comprovativo:\x20' + _0x1a9ce6 + 'MT');
                                return;
                            }
                        }

                        // --- REMOVIDA TRAVA DE "ROUBO" DE COMPROVATIVO ---
                        // O dono será a primeira pessoa a enviar a confirmação no grupo.
                        // Se já existir um comprovativo_msg_id diferente, consideramos como duplicado.
                        if (_0x543a9c && _0xwhatsappJid && _0x35f103['comprovativo_msg_id'] && _0x35f103['comprovativo_msg_id'] !== _0xmsgId) {
                            let _msgDuplicate = '⚠️ *CONFIRMAÇÃO JÁ UTILIZADA*\n━━━━━━━━━━━━━━━━━━\n❌ Esta confirmação já foi submetida antes.\n⏳ A sua transação já está *em andamento*, se o número foi inserido, aguarde a conclusão.';
                            await _0x461461(_0x5de4d0, _0xwhatsappJid, _msgDuplicate, _0xmsgId);
                            _0x1ca1fd('🚫 Comprovativo (aguardando) duplicado ignorado: ref=' + _0x6f5c22, 'info');
                            return;
                        }

                        // Atualizar número se extraído do SMS e estiver faltando no banco
                        let _finalNum = _0x35f103['numero'] || _0xextractedNum;
                        let _finalJid = _0x35f103['jid'] || _0xautoJid;
                        let _finalMsgId = _0x35f103['comprovativo_msg_id'] || _0xmsgId;
                        // Permitir que o primeiro usuário do WhatsApp assuma a remetência se estiver como sistema ou nulo
                        const _isSystemRemetente = !_0x35f103['remetente'] || !['@c.us', '@s.whatsapp.net'].some(suffix => _0x35f103['remetente'].endsWith(suffix));
                        let _finalRemetente = (_isSystemRemetente && _0x528f6e && _0x528f6e.includes('@')) ? _0x528f6e : (_0x35f103['remetente'] || _0x528f6e);

                        // Verificar cupom VOLTOU
                        let _finalQuantidade = _0x5ee650;
                        const _customerJidNorm = _finalJid ? _finalJid.split('@')[0] : (_finalRemetente ? _finalRemetente.split('@')[0] : null);
                        if (_customerJidNorm) {
                            try {
                                const couponCheck = await _0x3c2652('SELECT 1 FROM cupons_clientes WHERE jid = ? AND cupom = "VOLTOU" AND status = "ativo"', [_customerJidNorm]);
                                if (couponCheck && couponCheck.length > 0) {
                                    const bonusMegas = Math.round(_0x5ee650 * 0.20);
                                    _finalQuantidade = _0x5ee650 + bonusMegas;
                                    await _0x2c5e52('UPDATE cupons_clientes SET status = "usado" WHERE jid = ? AND cupom = "VOLTOU"', [_customerJidNorm]);
                                    _0x1ca1fd('🎟️ Cupom VOLTOU aplicado: +' + bonusMegas + 'MB adicionados para ' + _customerJidNorm, 'success');
                                }
                            } catch (e) {
                                _0x1ca1fd('❌ Erro ao aplicar cupom VOLTOU: ' + e.message, 'error');
                            }
                        }

                        await _0x2c5e52('UPDATE\x20referencias\x20SET\x20valor=?,\x20quantidade=?,\x20sms=?,\x20sms_recebido=1,\x20tipo=?,\x20numero=?,\x20jid=?,\x20comprovativo_msg_id=?,\x20remetente=?,\x20sobra=?\x20WHERE\x20ref=?', [_0x1c20e9, _finalQuantidade, _0x2b4a35, _0x36abaf, _finalNum, _finalJid, _finalMsgId, _finalRemetente, _sobraCalculada, _0x6f5c22]), _0x9ae02b['add'](_0x295d41);
                        const _0x2e932e = _0x36abaf === 'ilimitado' ? '♾️\x20ILIMITADO' : _0x36abaf === 'ilimitado_com_extra' ? '♾️+\x20ILIMITADO\x20COM\x20EXTRAS' : _0x36abaf === 'mensal' ? '📅\x20MENSAL' : _0x36abaf === '24hrs' ? '⏳\x2024\x20HORAS' : _0x36abaf === '3dias' ? '📅\x203\x20DIAS' : _0x36abaf === 'semanal' ? '📅\x20SEMANAL' : '📦\x20NORMAL';
                        _0x1ca1fd('✅\x20SMS\x20processado/atualizado:\x20ref=' + _0x6f5c22 + ',\x20status=' + _0x13c649 + ',\x20tipo=' + _0x2e932e + ',\x21\x20numero=' + (_finalNum || 'N/A'), 'success');

                        let _0x316169 = '';
                        _0x11744f && _0x11744f > 0x0 && (_0x316169 = '\x0a➕\x20Extras:\x20' + (_0x11744f / 0x400)['toFixed'](0x1) + 'GB\x20(processamento\x20paralelo)');
                        _0xe56f46 && _0x4e58e0 && (_0x316169 = '\x0a🎁\x20Bônus:\x20' + _0xe56f46 + 'MB/dia\x20por\x20' + _0x4e58e0 + '\x20dias');
                        await _0x2372f4('✅\x20SMS\x20processado/atualizado\x0a📋\x20Referência:\x20' + _0x6f5c22 + '\x0a💸\x20Valor:\x20' + _0x1c20e9 + 'MT\x0a📦\x20' + _0x57405c + '\x0a📊\x20Tipo:\x20' + _0x2e932e + _0x316169 + '\x0a⏳\x20Período:\x20' + (_0x46454d || 'N/A') + '\x0a📝\x20Status:\x20' + _0x13c649);

                        if (_finalNum && _finalJid) {
                            const _0x562d57 = await _0x3c2652('SELECT\x20*\x20FROM\x20referencias\x20WHERE\x20ref=?', [_0x6f5c22]);
                            if (_0x562d57 && _0x562d57['length'] > 0x0) {
                                const _0x4f373b = _0x562d57[0x0];
                                await _0x303482(_0x5de4d0, _0x4f373b['jid'], _0x4f373b['ref'], _0x4f373b['valor'], _0x4f373b['quantidade'], _0x4f373b['numero'], _0x4f373b['comprovativo_msg_id'], _0x4f373b['remetente'], _0x4f373b['tipo'], _sobraCalculada);
                                // [SMS-CANAL] Notificar cliente via SMS se compra foi por SMS
                                try {
                                    const _remetSmsNorm = (_0x528f6e || '').replace(/\D/g, '');
                                    const _isSmsCanal = _remetSmsNorm.length >= 9 && !['mpesa','emola'].some(x => (_0x528f6e||'').toLowerCase().includes(x));
                                    if (_isSmsCanal && typeof _enviarSmsViaAdb === 'function' && typeof _0x582bf2 !== 'undefined' && _0x5dbdf3) {
                                        const _pkgFinal = _0x4f373b['quantidade'] || 0;
                                        const _pkgFinalStr = _pkgFinal >= 1024 ? (_pkgFinal/1024).toFixed(1)+'GB' : _pkgFinal+'MB';
                                        await _enviarSmsViaAdb(_0x582bf2, _0x5dbdf3.id, _remetSmsNorm,
                                            'KaNet: ATIVADO! 🎉 ' + _pkgFinalStr + ' já disponíveis no ' + (_0x4f373b['numero'] || 'N/A') + '. Ref: ' + _0x4f373b['ref'] + '. Aproveite! 🚀');
                                    }
                                } catch(_eSmsConfirm) {}
                            }
                        }
                    } else {
                        if (_0x543a9c && _0xwhatsappJid) {
                            // --- REMOVIDA TRAVA DE "ROUBO" EM TRANSAÇÃO FINALIZADA ---
                            if (_0x35f103['comprovativo_msg_id'] && _0x35f103['comprovativo_msg_id'] !== _0xmsgId) {
                                let _msgDuplicate = (_0x13c649 === 'finalizado' || _0x13c649 === 'processada')
                                    ? '⚠️ *CONFIRMAÇÃO JÁ UTILIZADA*\n━━━━━━━━━━━━━━━━━━\n❌ Esta confirmação já foi submetida antes.\n📦 O seu pacote já foi *concluído/processado*!'
                                    : '⚠️ *CONFIRMAÇÃO JÁ UTILIZADA*\n━━━━━━━━━━━━━━━━━━\n❌ Esta confirmação já foi submetida antes.\n⏳ A sua transação já está *em andamento*, receberá em breve!';
                                await _0x461461(_0x5de4d0, _0xwhatsappJid, _msgDuplicate, _0xmsgId);
                                _0x1ca1fd('🚫 Comprovativo (processando) duplicado ignorado: ref=' + _0x6f5c22, 'info');
                                return;
                            }
                            
                            let _finalMsgId = _0x35f103['comprovativo_msg_id'] || _0xmsgId;
                            if (_0x35f103['jid'] !== _0xwhatsappJid) {
                                await _0x2c5e52('UPDATE\x20referencias\x20SET\x20jid=?,\x20comprovativo_msg_id=?,\x20remetente=?\x20WHERE\x20ref=?', [_0xwhatsappJid, _finalMsgId, _0x528f6e, _0x6f5c22]);
                                _0x1ca1fd('✅\x20JID\x20atualizado\x20(Comprovativo\x20atrasado):\x20ref=' + _0x6f5c22 + ',\x20novo_jid=' + _0xwhatsappJid, 'success');
                            }
                            let _finalNumStr = (_0x35f103['numero'] || _0xextractedNum) ? '\n📞 *Número:* ' + (_0x35f103['numero'] || _0xextractedNum) : '';
                            const _0x2e932e_delayed = _0x36abaf === 'ilimitado' ? '♾️\x20ILIMITADO' : _0x36abaf === 'ilimitado_com_extra' ? '♾️+\x20ILIMITADO\x20COM\x20EXTRAS' : _0x36abaf === 'mensal' ? '📅\x20MENSAL' : _0x36abaf === '24hrs' ? '⏳\x2024\x20HORAS' : _0x36abaf === '3dias' ? '📅\x203\x20DIAS' : _0x36abaf === 'semanal' ? '📅\x20SEMANAL' : '📦\x20NORMAL';
                            let _pacoteStr = _0x57405c ? '\n📦 *Pacote:* ' + _0x57405c : '\n📦 *Pacote:* ' + Math.round((_0x5ee650 || 0) / 1024) + 'GB';
                            let _tipoStr = _0x2e932e_delayed ? '\n📊 *Tipo:* ' + _0x2e932e_delayed : '';
                            let _validadeStr = _0x46454d ? '\n⏳ *Validade:* ' + _0x46454d : '';
                            
                            let _msgReply = '';
                            if (_finalNum) {
                                _msgReply = (_0x13c649 === 'processada' || _0x13c649 === 'finalizado') 
                                    ? '✅ *COMPROVATIVO RECEBIDO!* 🇲🇿\n━━━━━━━━━━━━━━━━━━\n🔖 *Ref:* `' + _0x6f5c22 + '`' + _pacoteStr + _validadeStr + _tipoStr + _finalNumStr + '\n━━━━━━━━━━━━━━━━━━\n✔️ A transação já foi *processada e concluída* com sucesso!' 
                                    : '✅ *COMPROVATIVO RECEBIDO!* 🇲🇿\n━━━━━━━━━━━━━━━━━━\n🔖 *Ref:* `' + _0x6f5c22 + '`' + _pacoteStr + _validadeStr + _tipoStr + _finalNumStr + '\n━━━━━━━━━━━━━━━━━━\n⏳ A operação encontra-se *em processamento automático*...';
                            } else {
                                _msgReply = '✅ *PAGAMENTO DETECTADO!* 🇲🇿\n━━━━━━━━━━━━━━━━━━\n🔖 *Ref:* `' + _0x6f5c22 + '`' + _pacoteStr + _validadeStr + _tipoStr + '\n━━━━━━━━━━━━━━━━━━\n⚠️ *FALTA O NÚMERO DE DESTINO!*\nPor favor, envie agora apenas o número que irá receber o pacote (ex: 84XXXXXXX ou 85XXXXXXX).';
                            }
                            await _0x461461(_0x5de4d0, _0xwhatsappJid, _msgReply, _0xmsgId);
                            _0x1ca1fd('🚫\x20Comprovativo\x20correspondido\x20com\x20transação\x20em\x20andamento:\x20ref=' + _0x6f5c22, 'info');
                            return;
                        }
                        _0x1ca1fd('🚫\x20SMS\x20ignorado\x20-\x20Status\x20inválido:\x20ref=' + _0x6f5c22 + ',\x20status=' + _0x13c649, 'warning'), await _0x2372f4('🚫\x20SMS\x20ignorado\x0a📋\x20Ref:\x20' + _0x6f5c22 + '\x0a💸\x20Valor:\x20' + _0x1c20e9 + 'MT\x0a📊\x20Status:\x20' + _0x13c649);
                        return;
                    }
                } else {
                    // --- NOVA COMPRA DETECTADA (SEM REGISTRO ANTERIOR) ---
                    const _isFromWhatsapp = _0x543a9c !== null;
                    const _smsRec = _isFromWhatsapp ? 0 : 1;
                    const _comproRec = _isFromWhatsapp ? 1 : 0;
                    
                    // Definir status inicial
                    let _statusStr = 'aguardando_sms';
                    if (!_isFromWhatsapp) {
                        _statusStr = (_0xextractedNum && _0xautoJid) ? 'aguardando_confirmacao' : 'aguardando_comprovativo';
                    }

                    await _0x51dcba('INSERT INTO referencias (ref, valor, quantidade, sms, comprovativo, status, sms_recebido, comprovativo_recebido, tipo, numero, jid, comprovativo_msg_id, remetente) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', 
                        [_0x6f5c22, _0x1c20e9, _0x5ee650, _isFromWhatsapp ? null : _0x2b4a35, _isFromWhatsapp ? _0x2b4a35 : null, _statusStr, _smsRec, _comproRec, _0x36abaf, _0xextractedNum, _0xautoJid, _0xmsgId, _isFromWhatsapp ? _0x528f6e : null]), _0x9ae02b['add'](_0x295d41);

                    if (_isFromWhatsapp) {
                        _0x1ca1fd('📥 NOVO COMPROVATIVO RECEBIDO (Aguardando SMS): ref=' + _0x6f5c22, 'info');
                        let _pkgLabelWait = _0x57405c ? ('\n📦 *Pacote:* ' + _0x57405c) : (_0x5ee650 > 0 ? ('\n📦 *Pacote:* ' + (_0x5ee650 >= 1024 ? (_0x5ee650 / 1024).toFixed(1) + ' GB' : _0x5ee650 + ' MB')) : '');
                        const _msgWait = '✅ *COMPROVATIVO RECEBIDO!* 🇲🇿\n━━━━━━━━━━━━━━━━━━\n🔖 *Ref:* `' + _0x6f5c22 + '`\n💰 *Valor:* ' + _0x1c20e9 + ' MT' + _pkgLabelWait + '\n━━━━━━━━━━━━━━━━━━\n⌛ *Status:* A aguardar a confirmação de pagamento do M-Pesa/E-Mola...\n\n⚠️ *POR FAVOR, ENVIE O NÚMERO DE DESTINO (84/85) PARA O ENVIO DOS MEGAS.* (Envie apenas os 9 dígitos)';
                        await _0x461461(_0x5de4d0, _0xwhatsappJid, _msgWait, _0xmsgId);

                        // --- AGENDAMENTO DE 3 MINUTOS ---
                        setTimeout(async () => {
                            _0x1ca1fd('🔍 EXECUTANDO BUSCA AGENDADA (3 min): ref=' + _0x6f5c22, 'info');
                            const _check = await _0x3c2652('SELECT * FROM referencias WHERE ref=?', [_0x6f5c22]);
                            if (_check && _check.length > 0 && _check[0].sms_recebido === 0) {
                                await _0x461461(_0x5de4d0, _0xwhatsappJid, '🔄 *STATUS DA TRANSAÇÃO:* ' + _0x6f5c22 + '\n\nO seu pagamento ainda não foi detectado no sistema ADB. Por favor, certifique-se de que a transferência foi concluída com sucesso.\n\nFaremos buscas automáticas contínuas.', null);
                            }
                        }, 180000); // 3 minutos
                    } else {
                        // Se for SMS direto (sem registro anterior) - Apenas registramos internamente
                        _0x1ca1fd('📥 SMS ADB RECEBIDO: ref=' + _0x6f5c22 + ', valor=' + _0x1c20e9 + 'MT (Aguardando reivindicação)', 'info');
                    }
                }
                
                // Verificação final para disparar notificação ao cliente
                _0x3ca1e8 = await _0x3c2652('SELECT * FROM referencias WHERE ref=?', [_0x6f5c22]);
                if (_0x3ca1e8 && _0x3ca1e8['length'] > 0x0) {
                    const _0x3e1a72 = _0x3ca1e8[0x0];
                    // Trigger se tivermos JID e SMS, e a referência está aguardando o SMS correspondente
                    if (_0x3e1a72['jid'] && _0x3e1a72['sms_recebido'] && _0x3e1a72['status'] === 'aguardando_sms') {
                         _0x1ca1fd('📣 DISPARANDO NOTIFICAÇÃO AUTOMÁTICA: ref=' + _0x6f5c22 + ', jid=' + _0x3e1a72['jid'], 'success');
                         await _0x303482(_0x5de4d0, _0x3e1a72['jid'], _0x3e1a72['ref'], _0x3e1a72['valor'], _0x3e1a72['quantidade'], _0x3e1a72['numero'], _0x3e1a72['comprovativo_msg_id'], _0x3e1a72['remetente'], _0x3e1a72['tipo'], _0x3e1a72['sobra'] || 0);
                    }
                }
            } catch (_0x1e734a) {
                _0x1ca1fd('❌\x20Erro\x20ao\x20processar\x20SMS:\x20ref=' + _0x6f5c22 + ',\x20remetente=' + _0x528f6e, 'error'), _0x3ca1e8 && _0x3ca1e8['length'] > 0x0 && _0x3ca1e8[0x0]['jid'] && await _0x461461(_0x5de4d0, _0x3ca1e8[0x0]['jid'], '❌\x20Erro\x20interno\x20ao\x20processar\x20SMS.\x20Contate\x20o\x20suporte.', _0x3ca1e8[0x0]['comprovativo_msg_id']), await _0x2372f4('❌\x20Erro\x20ao\x20processar\x20SMS\x0a📋\x20Referência:\x20' + _0x6f5c22 + '\x0a⚠️\x20Erro:\x20' + _0x1e734a['message']);
            }
        });
    }
    async function _0x48afc0(_0x2b4624, _0x404149, _0x6e465a) {
        if (!_0x2b4624 || typeof _0x2b4624['reply'] !== 'function') {
            _0x1ca1fd('❌\x20Cliente\x20WhatsApp\x20não\x20disponível\x20para\x20processar\x20confirmação:\x20numero=' + _0x404149 + ',\x20quantidade=' + _0x6e465a, 'error');
            return;
        }
        let _0x4ab880;
        try {
            _0x4ab880 = await _0x3c2652('SELECT\x20*\x20FROM\x20referencias\x20WHERE\x20numero=?\x20AND\x20quantidade=?\x20AND\x20status=\x27aguardando_confirmacao\x27', [_0x404149, _0x6e465a]);
            if (!_0x4ab880 || _0x4ab880['length'] === 0x0) {
                _0x1ca1fd('⚠️\x20Nenhum\x20registro\x20aguardando\x20confirmação\x20para\x20numero=' + _0x404149 + ',\x20quantidade=' + _0x6e465a, 'warning'), await _0x2372f4('⚠️\x20Nenhum\x20registro\x20aguardando\x20confirmação\x0a⏸️\x20Número:\x20' + _0x404149 + '\x0a📦\x20Quantidade:\x20' + _0x6e465a);
                return;
            }
            const _0x5ae175 = _0x4ab880[0x0];
            _0x5ae175['numero'] === _0x404149 && _0x5ae175['quantidade'] === _0x6e465a ? (await _0x2c5e52('UPDATE\x20referencias\x20SET\x20status=\x27aguardando_operadora\x27\x20WHERE\x20ref=?', [_0x5ae175['ref']]), _0x1ca1fd('🔄\x20Aguardando\x20mensagem\x20de\x20sucesso\x20da\x20operadora\x20para\x20ref=' + _0x5ae175['ref'] + ',\x20jid=' + _0x5ae175['jid'] + ',\x20remetente=' + _0x5ae175['remetente'] + ',\x20numero=' + _0x5ae175['numero'] + ',\x20quantidade=' + _0x5ae175['quantidade'], 'info'), await _0x2372f4('🔄\x20Aguardando\x20operadora\x0a📋\x20Referência:\x20' + _0x5ae175['ref'] + '\x0a⏸️\x20Número:\x20' + _0x5ae175['numero'] + '\x0a📦\x20Quantidade:\x20' + _0x5ae175['quantidade'] + 'MB\x0a👤\x20Remetente:\x20' + _0x5ae175['remetente'])) : (_0x1ca1fd('⚠️\x20Falha\x20na\x20correspondência:\x20numero=' + _0x404149 + ',\x20quantidade=' + _0x6e465a + ',\x20registro=' + JSON['stringify'](_0x5ae175), 'warning'), await _0x461461(_0x2b4624, _0x5ae175['jid'], '⚠️\x20Erro:\x20Dados\x20de\x20confirmação\x20não\x20correspondem.\x20Contate\x20o\x20suporte\x20(857013922).', _0x5ae175['comprovativo_msg_id']), await _0x2372f4('⚠️\x20Falha\x20na\x20correspondência\x0a⏸️\x20Número:\x20' + _0x404149 + '\x0a📦\x20Quantidade:\x20' + _0x6e465a + '\x0a📝\x20Registro:\x20' + JSON['stringify'](_0x5ae175)));
        } catch (_0x5153e3) {
            _0x1ca1fd('❌\x20Erro\x20ao\x20processar\x20confirmação:\x20numero=' + _0x404149 + ',\x20quantidade=' + _0x6e465a, 'error'), await _0x461461(_0x2b4624, _0x4ab880 && _0x4ab880['length'] > 0x0 ? _0x4ab880[0x0]['jid'] : jid, '❌\x20Erro\x20interno\x20ao\x20processar\x20confirmação.\x20Contate\x20o\x20suporte\x20(857013922).', _0x4ab880 && _0x4ab880['length'] > 0x0 ? _0x4ab880[0x0]['comprovativo_msg_id'] : null), await _0x2372f4('❌\x20Erro\x20ao\x20processar\x20confirmação\x0a⏸️\x20Número:\x20' + _0x404149 + '\x0a📦\x20Quantidade:\x20' + _0x6e465a + '\x0a⚠️\x20Erro:\x20' + _0x5153e3['message'] + '\x0aStack:\x20' + _0x5153e3['stack']);
        }
    }
    async function _0x387908(_0xde6783, _0xce49f, _0x36a057) {
        if (!_0xde6783 || typeof _0xde6783['reply'] !== 'function') {
            _0x1ca1fd('❌\x20Cliente\x20WhatsApp\x20não\x20disponível\x20para\x20processar\x20sucesso\x20da\x20operadora:\x20numero=' + _0xce49f + ',\x20quantidade=' + _0x36a057, 'error');
            return;
        }
        let _0x15cd54;
        try {
            _0x15cd54 = await _0x3c2652('SELECT\x20*\x20FROM\x20referencias\x20WHERE\x20numero=?\x20AND\x20quantidade=?\x20AND\x20status=\x27aguardando_operadora\x27', [_0xce49f, _0x36a057]);
            if (!_0x15cd54 || _0x15cd54['length'] === 0x0) {
                _0x1ca1fd('⚠️\x20Nenhum\x20registro\x20aguardando\x20sucesso\x20da\x20operadora\x20para\x20numero=' + _0xce49f + ',\x20quantidade=' + _0x36a057, 'warning'), await _0x2372f4('⚠️\x20Nenhum\x20registro\x20aguardando\x20sucesso\x20da\x20operadora\x0a⏸️\x20Número:\x20' + _0xce49f + '\x0a📦\x20Quantidade:\x20' + _0x36a057);
                return;
            }
            const _0x30a0c9 = _0x15cd54[0x0];
            _0x30a0c9['numero'] === _0xce49f && _0x30a0c9['quantidade'] === _0x36a057 ? (await _0x384ba7(_0xde6783, _0x30a0c9['jid'], _0x30a0c9['ref'], _0x30a0c9['valor'], _0x30a0c9['quantidade'], _0x30a0c9['numero'], _0x30a0c9['comprovativo_msg_id'], _0x30a0c9['remetente'], _0x30a0c9['tipo'], false, _0x30a0c9['sobra'] || 0), await _0x2c5e52('UPDATE\x20referencias\x20SET\x20status=\x27processada\x27\x20WHERE\x20ref=?', [_0x30a0c9['ref']]), _0x1ca1fd('✅\x20Transação\x20confirmada:\x20ref=' + _0x30a0c9['ref'] + ',\x20jid=' + _0x30a0c9['jid'] + ',\x20remetente=' + _0x30a0c9['remetente'] + ',\x20numero=' + _0x30a0c9['numero'] + ',\x20quantidade=' + _0x30a0c9['quantidade'], 'success'), await _0x2372f4('✅\x20Transação\x20confirmada\x0a📋\x20Referência:\x20' + _0x30a0c9['ref'] + '\x0a⏸️\x20Número:\x20' + _0x30a0c9['numero'] + '\x0a📦\x20Quantidade:\x20' + _0x30a0c9['quantidade'] + 'MB')) : (_0x1ca1fd('⚠️\x20Falha\x20na\x20correspondência:\x20numero=' + _0xce49f + ',\x20quantidade=' + _0x36a057 + ',\x20registro=' + JSON['stringify'](_0x30a0c9), 'warning'), await _0x461461(_0xde6783, _0x30a0c9['jid'], '⚠️\x20Erro:\x20Dados\x20de\x20confirmação\x20não\x20correspondem.\x20Contate\x20o\x20suporte\x20(856116039\x20).', _0x30a0c9['comprovativo_msg_id']), await _0x2372f4('⚠️\x20Falha\x20na\x20correspondência\x0a⏸️\x20Número:\x20' + _0xce49f + '\x0a📦\x20Quantidade:\x20' + _0x36a057 + '\x0a📝\x20Registro:\x20' + JSON['stringify'](_0x30a0c9)));
        } catch (_0x8a7e57) {
            _0x1ca1fd('❌\x20Erro\x20ao\x20processar\x20sucesso\x20da\x20operadora:\x20numero=' + _0xce49f + ',\x20quantidade=' + _0x36a057, 'error'), await _0x461461(_0xde6783, _0x15cd54 && _0x15cd54['length'] > 0x0 ? _0x15cd54[0x0]['jid'] : jid, '❌\x20Erro\x20interno\x20ao\x20processar\x20confirmação\x20da\x20operadora.\x20Contate\x20o\x20suporte\x20(857013922\x20).', _0x15cd54 && _0x15cd54['length'] > 0x0 ? _0x15cd54[0x0]['comprovativo_msg_id'] : null), await _0x2372f4('❌\x20Erro\x20ao\x20processar\x20sucesso\x20da\x20operadora\x0a⏸️\x20Número:\x20' + _0xce49f + '\x0a📦\x20Quantidade:\x20' + _0x36a057 + '\x0a⚠️\x20Erro:\x20' + _0x8a7e57['message'] + '\x0aStack:\x20' + _0x8a7e57['stack']);
        }
    }
    async function _0x186b18(_0x16d869, _0x292869, _0x464b4a, _0x1013c1) {
        if (!_0x16d869 || typeof _0x16d869['reply'] !== 'function') {
            _0x1ca1fd('❌\x20Cliente\x20WhatsApp\x20não\x20disponível\x20para\x20tentar\x20processar:\x20ref=' + _0x292869 + ',\x20jid=' + _0x464b4a + ',\x20remetente=' + _0x1013c1, 'error');
            return;
        }
        let _0x32226c;
        try {
            _0x32226c = await _0x3c2652('SELECT\x20*\x20FROM\x20referencias\x20WHERE\x20ref=?', [_0x292869]);
            if (!_0x32226c || _0x32226c['length'] === 0x0) {
                _0x1ca1fd('📭\x20Registro\x20não\x20encontrado\x20para\x20ref=' + _0x292869 + ',\x20jid=' + _0x464b4a + ',\x20remetente=' + _0x1013c1, 'warning');
                return;
            }
            const _0x225650 = _0x32226c[0x0];
            if (_0x225650['sms_recebido'] === 1) {
                _0x1ca1fd('✅ Validação concluída via SMS verificado por ADB: ref=' + _0x292869 + ', valor=' + _0x225650['valor'], 'success');
                if (!_0x225650['jid']) {
                    await _0x2c5e52('UPDATE referencias SET jid = ?, remetente = ?, comprovativo = ? WHERE ref = ?', [_0x464b4a, _0x1013c1, 'REIVINDICADO_MANUAL', _0x292869]);
                }
                await _0x303482(_0x16d869, _0x464b4a, _0x225650['ref'], _0x225650['valor'], _0x225650['quantidade'], _0x225650['numero'], _0x225650['comprovativo_msg_id'], _0x1013c1, _0x225650['tipo'], _0x225650['sobra'] || 0);
                return;
            }
            if (!_0x225650['comprovativo'] || !_0x225650['sms']) {
                _0x1ca1fd('📥\x20Aguardando\x20SMS\x20ou\x20comprovativo\x20para\x20ref=' + _0x292869 + ',\x20jid=' + _0x464b4a + ',\x20remetente=' + _0x1013c1 + ',\x20motivo=' + (!_0x225650['comprovativo'] ? 'sem\x20comprovativo' : 'sem\x20SMS'), 'info');
                return;
            }
            const _0x2dd639 = _0xf8719e(_0x225650['sms']),
                _0x482060 = _0x3d5bec(_0x225650['sms']),
                _0x595369 = _0xf8719e(_0x225650['comprovativo']),
                _0x1846cf = _0x3d5bec(_0x225650['comprovativo']);
            _0x2dd639 && _0x595369 && _0x2dd639 === _0x595369 && _0x482060 && _0x1846cf && _0x482060 === _0x1846cf ? (_0x1ca1fd('✅\x20Validação\x20concluída:\x20ref=' + _0x292869 + ',\x20valor=' + _0x482060, 'success'), await _0x303482(_0x16d869, _0x225650['jid'], _0x225650['ref'], _0x225650['valor'], _0x225650['quantidade'], _0x225650['numero'], _0x225650['comprovativo_msg_id'], _0x225650['remetente'], _0x225650['tipo'], _0x225650['sobra'] || 0)) : _0x1ca1fd('📥\x20Aguardando\x20dados\x20completos:\x20ref=' + _0x292869 + ',\x20numero=' + _0x225650['numero'] + ',\x20divisoes=' + _0x225650['divisoes'] + ',\x20smsRef=' + _0x2dd639 + ',\x20compRef=' + _0x595369 + ',\x20smsValor=' + _0x482060 + ',\x20compValor=' + _0x1846cf, 'info');
        } catch (_0x17b01f) {
            _0x1ca1fd('❌\x20Erro\x20ao\x20processar\x20validação:\x20ref=' + _0x292869 + ',\x20jid=' + _0x464b4a + ',\x20remetente=' + _0x1013c1, 'error'), _0x16d869 && typeof _0x16d869['reply'] === 'function' && await _0x461461(_0x16d869, _0x464b4a, '❌\x20Erro\x20interno\x20ao\x20validar\x20transação.\x20Contate\x20o\x20suporte\x20(857013922\x20).', _0x32226c && _0x32226c['length'] > 0x0 ? _0x32226c[0x0]['comprovativo_msg_id'] : null);
        }
    }
    async function _0x49e88c() {
        try {
            const _0x1a4b98 = new Date(Date['now']() - 0x7 * 0x18 * 0x3c * 0x3c * 0x3e8);
            await _0x2c5e52('DELETE\x20FROM\x20referencias\x20WHERE\x20created_at\x20<\x20?\x20AND\x20status\x20IN\x20(\x27finalizado\x27,\x20\x27erro_fastapi\x27,\x20\x27erro_timeout\x27)', [_0x1a4b98['toISOString']()]), _0x1ca1fd('🧹\x20Registros\x20antigos\x20limpos\x20antes\x20de\x20' + _0x1a4b98['toISOString'](), 'success');
        } catch (_0x3069c2) {
            _0x1ca1fd('❌\x20Erro\x20no\x20filtro\x20de\x20mensagens:\x20' + _0x3069c2['message'], 'error');
            return ![];
        }
    }

    async function _verificarInfracoes(_client, _msg) {
        if (!_msg || !_msg.isGroupMsg) return false;
        
        try {
            const _jid = (_msg.sender && _msg.sender.id) ? _msg.sender.id : _msg.author;
            if (!_jid) return false;
            const _groupJid = _msg.from;
            const _body = (_msg.body || _msg.caption || '').trim();
            const _msgId = _msg.id;

            // 1. Verificar se é admin (Admins são imunes)
            const _admins = await _client.getGroupAdmins(_groupJid);
            if (_admins.includes(_jid)) return false;

            let _infraction = false;
            let _motivo = '';

            // Detecção de LINK (WhatsApp e Links Externos)
            const _linkRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|chat\.whatsapp\.com\/[^\s]+)/gi;
            if (_linkRegex.test(_body)) {
                _infraction = true;
                _motivo = 'Envio de Link';
            }

            // Detecção de PALAVRÕES
            const _palavroes = ['merda', 'puta', 'caralho', 'foda', 'corno', 'porra', 'pqp', 'desgraça', 'fdp', 'cacete', 'cona', 'piça'];
            const _contemPalavrao = _palavroes.some(p => _body.toLowerCase().includes(p));
            if (_contemPalavrao) {
                _infraction = true;
                _motivo = 'Linguagem Imprópria';
            }

            if (_infraction) {
                // Apagar a mensagem imediatamente
                await _client.deleteMessage(_groupJid, _msgId);
                
                // Contabilizar infração
                const _rows = await _0x3c2652('SELECT count FROM group_infractions WHERE jid=? AND group_jid=?', [_jid, _groupJid]);
                let _count = (_rows && _rows.length > 0) ? _rows[0].count + 1 : 1;
                
                if (_count >= 3) {
                    // Remover do grupo
                    await _0x2c5e52('DELETE FROM group_infractions WHERE jid=? AND group_jid=?', [_jid, _groupJid]);
                    await _client.removeParticipant(_groupJid, _jid);
                    
                    let _finalMsg = `🚫 *REMOVIDO:* @${_jid.split('@')[0]} foi removido por atingir o limite de 3 infrações (${_motivo}).`;
                    
                    // Se o motivo for Link, banir permanentemente
                    if (_motivo === 'Envio de Link') {
                        if (!global['numerosBanidos']) global['numerosBanidos'] = new Set();
                        global['numerosBanidos'].add(_jid);
                        await _0x2c5e52('INSERT OR IGNORE INTO banidos (jid, admin) VALUES (?, ?)', [_jid, 'SISTEMA_ANTILINK']);
                        _finalMsg += `\n🔨 *STATUS:* Banido permanentemente de todos os grupos.`;
                        _0x1ca1fd('🔨 Cliente banido por enviar links: ' + _jid, 'warning');
                    }
                    
                    await _0x461461(_client, _groupJid, _finalMsg, null);
                } else {
                    await _0x2c5e52('INSERT OR REPLACE INTO group_infractions (jid, group_jid, count) VALUES (?, ?, ?)', [_jid, _groupJid, _count]);
                    await _0x461461(_client, _groupJid, `⚠️ *AVISO [${_count}/3]:* @${_jid.split('@')[0]}, links e palavrões não são permitidos. Sua mensagem foi apagada.\n\n*Motivo:* ${_motivo}`, _msg.id);
                }
                return true;
            }
        } catch (e) {
            _0x1ca1fd('❌ Erro no Anti-Link/Anti-Palavrão: ' + e.message, 'error');
        }
        return false;
    }

    function _0x3e1b5c(_0x138c4a) {
        const _0x358b7a = [],
            _0x2f7c4c = 0x2800,
            _0x3b6390 = 0x64;
        for (const _0x35e106 of _0x138c4a) {
            let _0x51e790 = _0x35e106['quantidade'];
            if (_0x51e790 < _0x3b6390) {
                _0x1ca1fd('⚠️\x20Quantidade\x20' + _0x51e790 + 'MB\x20ignorada\x20(<\x20' + _0x3b6390 + 'MB)', 'warning');
                continue;
            }
            while (_0x51e790 > 0x0) {
                const _0x4055a2 = Math['min'](_0x51e790, _0x2f7c4c);
                _0x4055a2 >= _0x3b6390 ? _0x358b7a['push']({
                    'numero': _0x35e106['numero'],
                    'quantidade': _0x4055a2
                }) : _0x1ca1fd('⚠️\x20Bloco\x20de\x20' + _0x4055a2 + 'MB\x20ignorado\x20(<\x20' + _0x3b6390 + 'MB)', 'warning'), _0x51e790 -= _0x4055a2;
            }
        }
        return _0x358b7a;
    }
    async function _0x587286(_0x1d6bf8, _0x51961c, _0x559c96, _0x978b35, _0x1e4b5e, _0x7ca6fb = 'normal') {
        const _0x58c1e8 = 'active-divisoes-' + _0x51961c + '-' + _0x559c96;
        if (_0x3899c3['has'](_0x58c1e8)) {
            _0x1ca1fd('🚫\x20CICLO\x20DE\x20DIVISÕES\x20JÁ\x20ATIVO\x20-\x20Ignorando\x20duplicação:\x20ref=' + _0x51961c + ',\x20jid=' + _0x559c96, 'warning');
            return;
        }
        return _0x39c852(_0x58c1e8, async () => {
            if (!_0x978b35 || _0x978b35['length'] === 0x0) {
                _0x1ca1fd('⚠️\x20Nenhuma\x20divisão\x20para\x20processar:\x20ref=' + _0x51961c, 'warning');
                return;
            }
            const _0x56cad6 = _0x3e1b5c(_0x978b35);
            let _0x3db571 = 0x0;
            for (let _0x1b9e7c = 0x0; _0x1b9e7c < _0x56cad6['length']; _0x1b9e7c++) {
                const _0x5ca279 = _0x56cad6[_0x1b9e7c],
                    _0x2fbc89 = Date['now'](),
                    _0x5a0815 = Math['random']()['toString'](0x24)['substring'](0x2, 0x8),
                    _0x4cf1fe = _0x51961c + '-' + _0x5ca279['numero'] + '-' + _0x5ca279['quantidade'] + '-' + _0x2fbc89 + '-' + _0x5a0815,
                    _0x1572ad = _0x51961c + '-' + _0x5ca279['numero'] + '-bloco-' + (_0x1b9e7c + 0x1) + '-de-' + _0x56cad6['length'];
                if (_0x2b714a['has'](_0x4cf1fe)) {
                    _0x1ca1fd('🚫\x20BLOCO\x20DUPLICADO\x20-\x20Já\x20em\x20processamento:\x20' + _0x4cf1fe, 'warning');
                    continue;
                }
                if (_0x536ba5['has'](_0x4cf1fe)) {
                    _0x1ca1fd('🚫\x20BLOCO\x20BLOQUEADO\x20TEMPORARIAMENTE:\x20' + _0x4cf1fe, 'warning');
                    continue;
                }
                const _0x5ce52d = {
                    'ref': _0x51961c,
                    'jid': _0x559c96,
                    'numero': _0x5ca279['numero'],
                    'quantidade': _0x5ca279['quantidade'],
                    'remetente': _0x1e4b5e,
                    'tipo': _0x7ca6fb,
                    'blocoId': _0x1572ad
                };
                _0x149dcd(_0x5ce52d), _0x3db571++;
            }
            _0x3db571 > 0x0 ? _0x1ca1fd('✅\x20' + _0x3db571 + '\x20blocos\x20adicionados\x20para\x20processamento\x20paralelo:\x20ref=' + _0x51961c + ',\x20tipo=' + _0x7ca6fb, 'success') : _0x1ca1fd('⚠️\x20Nenhum\x20bloco\x20novo\x20adicionado\x20(todos\x20duplicados):\x20ref=' + _0x51961c, 'warning');
        });
    }
    setInterval(() => {
        if (_0x2b714a['size'] > 0x3e8) {
            const _0x3cafda = Array['from'](_0x2b714a);
            _0x2b714a['clear']();
            const _0x118f8b = _0x3cafda['slice'](-0x1f4);
            _0x118f8b['forEach'](_0x66837b => _0x2b714a['add'](_0x66837b)), _0x1ca1fd('🧹\x20Limpeza\x20de\x20chaves:\x20' + _0x3cafda['length'] + '\x20→\x20' + _0x2b714a['size'], 'info');
        }
    }, 0x493e0);
    async function _0x554c86(_0x55a6dd, _0x3e5e19) {
        const _0x4104ce = _0x3e5e19['from'],
            _0x27b9b2 = _0x3e5e19['sender']?.['id'] || _0x3e5e19['author'],
            _0x11e4a3 = _0x3e5e19['body'] ? _0x3e5e19['body']['trim']() : '',
            _0x4a6f24 = _0x3e5e19['author'] || _0x3e5e19['from'],
            _0x292044 = _0x11e4a3['toLowerCase']();

        try {
            if (!_0x3e5e19['isGroupMsg'] && !['!abrir', '!fechar', '!banir'].some(cmd => _0x292044.startsWith(cmd))) return ![];

            const _0x1a0188 = _0x3e5e19['isGroupMsg'] ? await _0x55a6dd['getGroupAdmins'](_0x4104ce) : [];
            const _0xisMaster = _checkIsMaster(_0x4a6f24) || _0x4a6f24 === _0x16260a || _0x4a6f24['startsWith'](_0x16260a['split']('@')[0]);
            const _0x278eb8 = _0x1a0188['includes'](_0x4a6f24) || _0xisMaster;

            if (_0x292044 === '!abrir' || _0x292044 === '/abrir') {
                if (!_0x3e5e19['isGroupMsg']) return await _0x461461(_0x55a6dd, _0x4104ce, '⚠️ Este comando só funciona em grupos.', _0x3e5e19['id']), !![];
                if (!_0x278eb8) return _0x1ca1fd('🚫 Tentativa de usar !abrir sem ser admin: ' + _0x4a6f24, 'warning'), !![];
                try {
                    await _0x55a6dd['setGroupToAdminsOnly'](_0x4104ce, ![]);
                    _0x1ca1fd('🔓 Grupo ' + _0x4104ce + ' aberto para todos', 'success');
                    await _0x461461(_0x55a6dd, _0x4104ce, '🔓 *GRUPO ABERTO*\n━━━━━━━━━━━━━━━━━━\n✅ Membros agora podem enviar mensagens.', _0x3e5e19['id']);
                } catch (_0xerr) {
                    _0x1ca1fd('❌ Erro ao abrir grupo: ' + _0xerr['message'], 'error');
                }
                return !![];
            }
            if (_0x292044 === '!fechar' || _0x292044 === '/fechar') {
                if (!_0x3e5e19['isGroupMsg']) return await _0x461461(_0x55a6dd, _0x4104ce, '⚠️ Este comando só funciona em grupos.', _0x3e5e19['id']), !![];
                if (!_0x278eb8) return _0x1ca1fd('🚫 Tentativa de usar !fechar sem ser admin: ' + _0x4a6f24, 'warning'), !![];
                try {
                    await _0x55a6dd['setGroupToAdminsOnly'](_0x4104ce, !![]);
                    _0x1ca1fd('🔒 Grupo ' + _0x4104ce + ' fechado para admins', 'success');
                    await _0x461461(_0x55a6dd, _0x4104ce, '🔒 *GRUPO FECHADO*\n━━━━━━━━━━━━━━━━━━\n🚫 Apenas administradores podem enviar mensagens.', _0x3e5e19['id']);
                } catch (_0xerr) {
                    _0x1ca1fd('❌ Erro ao fechar grupo: ' + _0xerr['message'], 'error');
                }
                return !![];
            }
            if (_0x292044['startsWith']('!banir') || _0x292044['startsWith']('/banir')) {
                if (!_0x3e5e19['isGroupMsg']) return await _0x461461(_0x55a6dd, _0x4104ce, '⚠️ Este comando só funciona em grupos.', _0x3e5e19['id']), !![];
                if (!_0x278eb8) return _0x1ca1fd('🚫 Tentativa de usar !banir sem ser admin: ' + _0x4a6f24, 'warning'), !![];
                let _0xtarget = null;
                if (_0x3e5e19['quotedMsg']) {
                    _0xtarget = _0x3e5e19['quotedMsg']['author'] || _0x3e5e19['quotedMsg']['from'];
                } else if (_0x3e5e19['mentionedJidList'] && _0x3e5e19['mentionedJidList']['length'] > 0) {
                    _0xtarget = _0x3e5e19['mentionedJidList'][0];
                }
                if (!_0xtarget) return await _0x461461(_0x55a6dd, _0x4104ce, '⚠️ *BANIR:* Mencione alguém ou responda à mensagem da pessoa.', _0x3e5e19['id']), !![];
                try {
                    await _0x55a6dd['removeParticipant'](_0x4104ce, _0xtarget);
                    _0x1ca1fd('🚫 Usuário ' + _0xtarget + ' banido por ' + _0x4a6f24, 'success');
                    await _0x461461(_0x55a6dd, _0x4104ce, '🚫 Usuário removido com sucesso.', _0x3e5e19['id']);
                } catch (_0xerr) {
                    _0x1ca1fd('❌ Erro ao banir: ' + _0xerr['message'], 'error');
                    await _0x461461(_0x55a6dd, _0x4104ce, '❌ Erro ao remover usuário. Verifique se o bot é admin.', _0x3e5e19['id']);
                }
                return !![];
            }
            if (_0x11e4a3 === '/todos' || _0x11e4a3 === '.todos' || _0x11e4a3.startsWith('/todos ') || _0x11e4a3.startsWith('.todos ')) {
                if (!_0x278eb8) return ![];
                try {
                    const _hasDirectMessage = _0x11e4a3.startsWith('/todos ') || _0x11e4a3.startsWith('.todos ');
                    if (_hasDirectMessage) {
                        const _directMsg = _0x3e5e19['body'] ? _0x3e5e19['body'].trim().substring(7).trim() : '';
                        const _0xmembs = await _0x55a6dd['getGroupMembers'](_0x4104ce);
                        const _0xjids = _0xmembs['map'](_m => _m['id']);
                        const _0xtxt = '📢 *MENSAGEM PARA TODOS:*\n\n' + _directMsg;
                        await _0x55a6dd['sendTextWithMentions'](_0x4104ce, _0xtxt, _0xjids);
                        _0x1ca1fd('📢 /todos enviado diretamente por ' + _0x4a6f24, 'success');
                    } else {
                        _0x10228a[_0x4104ce] = _0x4a6f24;
                        _0x1ca1fd('📢 Comando /todos iniciado por ' + _0x4a6f24 + ' no grupo ' + _0x4104ce, 'info');
                        await _0x461461(_0x55a6dd, _0x4104ce, '📢 Envie a mensagem para mencionar todos os membros.', _0x3e5e19['id']);
                    }
                    return !![];
                } catch (_0xerr) {
                    _0x1ca1fd('❌ Erro no /todos: ' + _0xerr['message'], 'error'); return !![];
                }
            }
            if (_0x10228a[_0x4104ce] && _0x4a6f24 === _0x10228a[_0x4104ce]) {
                try {
                    const _0xmembs = await _0x55a6dd['getGroupMembers'](_0x4104ce);
                    const _0xjids = _0xmembs['map'](_m => _m['id']);
                    const _0xtxt = '📢 *MENSAGEM PARA TODOS:*\n\n' + _0x11e4a3;
                    await _0x55a6dd['sendTextWithMentions'](_0x4104ce, _0xtxt, _0xjids);
                    _0x1ca1fd('📢 /todos enviado por ' + _0x4a6f24, 'success');
                } finally { delete _0x10228a[_0x4104ce]; }
                return !![];
            }
            return ![];
        } catch (_0xerr) {
            _0x1ca1fd('❌ Erro crítico em _0x554c86: ' + _0xerr['message'], 'error');
            return ![];
        }
    }
    async function _0x39c436(_0x2e7596, _0x137f92, _0xb08a83, _0x5c99d3, _0x231c0a) {
        try {
            let _0x179755 = null,
                _0x3c9b0b = null;
            const _0x22b8d8 = _0x231c0a['split']('\x20');
            _0x22b8d8['length'] >= 0x2 && (_0x179755 = _0x22b8d8[0x1]['trim']()['toUpperCase']());
            if (_0x137f92['quotedMsg'] && _0x137f92['quotedMsg']['body']) {
                const _0x46934a = _0x137f92['quotedMsg']['body'],
                    _0x36f555 = _0x46934a['match'](/(258)?(8[2-7]\d{7})/);
                if (_0x36f555) {
                    _0x3c9b0b = _0x36f555[0x1] ? _0x36f555[0x0] : '258' + _0x36f555[0x2];
                    if (!_0x179755) {
                        const _0x132b66 = await _0x3c2652('SELECT\x20ref\x20FROM\x20referencias\x20WHERE\x20numero=?\x20AND\x20jid=?\x20ORDER\x20BY\x20created_at\x20DESC\x20LIMIT\x201', [_0x3c9b0b, _0xb08a83]);
                        _0x132b66 && _0x132b66['length'] > 0x0 && (_0x179755 = _0x132b66[0x0]['ref']);
                    }
                }
            }
            if (!_0x179755) return await _0x461461(_0x2e7596, _0xb08a83, '📝\x20Uso:\x20/eliminar\x20<referência>\x0aOu\x20faça\x20REPLY\x20em\x20uma\x20mensagem\x20com\x20número\x20e\x20escreva:\x20/eliminar', _0x137f92['id']), !![];
            const _0x4ca3c3 = await _0x3c2652('SELECT\x20*\x20FROM\x20referencias\x20WHERE\x20ref=?\x20AND\x20(jid=?\x20OR\x20remetente=?)', [_0x179755, _0xb08a83, _0x5c99d3]);
            if (!_0x4ca3c3 || _0x4ca3c3['length'] === 0x0) return await _0x461461(_0x2e7596, _0xb08a83, '❌\x20Referência\x20*' + _0x179755 + '*\x20não\x20encontrada\x20ou\x20não\x20pertence\x20a\x20você.', _0x137f92['id']), !![];
            const _0x35f702 = _0x4ca3c3[0x0],
                _0x590f3f = ['aguardando_sms', 'aguardando_comprovativo', 'aguardando_numero', 'aguardando_confirmacao', 'aguardando_resposta'];
            if (!_0x590f3f['includes'](_0x35f702['status'])) return await _0x461461(_0x2e7596, _0xb08a83, '❌\x20Referência\x20*' + _0x179755 + '*\x20não\x20pode\x20ser\x20eliminada\x20(status:\x20' + _0x35f702['status'] + ').', _0x137f92['id']), !![];
            const _0xcee353 = await _0x3ce4be(_0x179755, _0xb08a83, _0x5c99d3, 'comando_usuario');
            return _0xcee353 ? (await _0x461461(_0x2e7596, _0xb08a83, '🗑️\x20Referência\x20*' + _0x179755 + '*\x20eliminada\x20permanentemente!\x20Não\x20poderá\x20ser\x20reutilizada.', _0x137f92['id']), _0x1ca1fd('✅\x20Referência\x20eliminada\x20por\x20usuário:\x20ref=' + _0x179755 + ',\x20usuario=' + _0x5c99d3, 'success')) : await _0x461461(_0x2e7596, _0xb08a83, '❌\x20Erro\x20ao\x20eliminar\x20referência\x20*' + _0x179755 + '*.', _0x137f92['id']), !![];
        } catch (_0x46fbf0) {
            return _0x1ca1fd('❌\x20Erro\x20ao\x20processar\x20comando\x20eliminar:\x20jid=' + _0xb08a83 + ',\x20remetente=' + _0x5c99d3 + ',\x20texto=' + _0x231c0a, 'error'), await _0x461461(_0x2e7596, _0xb08a83, '❌\x20Erro\x20interno\x20ao\x20processar\x20comando.\x20Contate\x20o\x20suporte\x20(856116039\x20).', _0x137f92['id']), !![];
        }
    }

    let _0x42026f = null,
        _0x2d9387 = ![];
    async function _0x16d7ff() {
        if (_0x2d9387) return;
        _0x2d9387 = !![];
        try {
            _0x1ca1fd('🔧 Iniciando sistema de verificação de portas...', 'info'), await _0x47dccc(![]), _0x42026f = setInterval(async () => {
                try {
                    await _0x47dccc(!![]);
                } catch (_0x188232) {
                    _0x1ca1fd('❌ Erro na verificação periódica: ' + _0x188232['message'], 'error');
                }
            }, 0x1d4c0), _0x1ca1fd('✅ Sistema de verificação de portas iniciado com sucesso', 'success');
        } catch (_0x255f78) {
            _0x1ca1fd('❌ Erro ao iniciar verificação de portas: ' + _0x255f78['message'], 'error'), _0x2d9387 = ![];
        }
    }

    async function _0x19bdbc(_0x5acdfe) {
        const _0x582bf2 = _0x3d65f9['createClient']({
            'host': '127.0.0.1',
            'port': 0x13ad
        });
        let _0x4a3281 = Date['now']() - 0x3c * 0x3c * 0x3e8;
        let _0x453424 = new Set();
        let _0x23d9dd = ![];
        let _erroNotificado = ![];

        // --- CANAL SMS: CLIENTES A COMPRAR POR SMS ---
        const _smsCanalPendentes = new Map(); // remetente_normalizado -> { ref, timestamp }

        async function _enviarSmsViaAdb(_adbCli, _devId, _numDest, _msg) {
            const _n = String(_numDest).replace(/\D/g, '');
            const _nFull = _n.startsWith('258') ? _n : '258' + _n;
            const _msgSafe = _msg.substring(0, 155).replace(/"/g, "'");

            // 1. Tentar Envio via Capcom SMS Gateway HTTP
            const _gwUrl = 'http://192.168.24.197:8080/message';
            const _gwUser = 'sms';
            const _gwPass = '-MX6H8I3';
            try {
                const _ctrl = new AbortController();
                const _tid = setTimeout(() => _ctrl.abort(), 5000);
                const _gwCreds = Buffer.from(_gwUser + ':' + _gwPass).toString('base64');
                const _httpRes = await fetch(_gwUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Basic ' + _gwCreds
                    },
                    body: JSON.stringify({
                        phoneNumbers: ['+' + _nFull],
                        message: _msgSafe
                    }),
                    signal: _ctrl.signal
                });
                clearTimeout(_tid);
                if (_httpRes.ok || _httpRes.status === 202) {
                    _0x1ca1fd('✅ [SMS-CANAL] Resposta enviada via HTTP Gateway (Capcom) para ' + _nFull, 'success');
                    return;
                }
            } catch (_eHttp) {
                // HTTP Gateway não respondeu, continuar para envio via ADB
                _0x1ca1fd('⚠️ [SMS-CANAL] HTTP Gateway indisponível, usando ADB...', 'warning');
            }

            // 2. Fallback: Envio via ADB Shell
            try {
                if (_adbCli && _devId) {
                    const _msgClean = _msgSafe.replace(/["'\\]/g, '');
                    const _cmd = `service call isms 5 i32 0 s16 "${_nFull}" s16 "null" s16 "\\"${_msgClean}\\"" s16 "null" s16 "null"`;
                    const _st = await _adbCli.shell(_devId, _cmd);
                    await new Promise((r) => { _st.resume(); _st.on('end', r); _st.on('error', r); });
                    _0x1ca1fd('✅ [SMS-CANAL] Resposta enviada via ADB Shell para ' + _nFull, 'success');
                    return;
                }
            } catch(_eSms) {
                _0x1ca1fd('❌ [SMS-CANAL] Falha ao enviar SMS: ' + _eSms.message, 'error');
            }
        }

        setInterval(async () => {
            try {
                const _0x43f61e = await _0x582bf2['listDevices']();
                if (_0x43f61e['length'] === 0x0) {
                    if (!_erroNotificado) {
                        _0x1ca1fd('❌ Nenhum dispositivo ADB detectado. Aguardando conexão...', 'warning');
                        _erroNotificado = !![];
                        _0x23d9dd = ![];
                    }
                    return;
                }
                let _targetSerial = '';
                try {
                    const _fsSer = require('fs');
                    const _pathSer = require('path');
                    const _cfgSerPath = _pathSer.join(global._kanetBase || __dirname, 'local_config.json');
                    if (_fsSer.existsSync(_cfgSerPath)) {
                        const _cSer = JSON.parse(_fsSer.readFileSync(_cfgSerPath, 'utf8'));
                        _targetSerial = _cSer.mesnal_serial || (_cSer.telefones && _cSer.telefones[0] && _cSer.telefones[0].serial) || '';
                    }
                } catch(eSer) {}

                const _0x5dbdf3 = _0x43f61e.find(_dev => 
                    (_targetSerial && _dev.id === _targetSerial) || 
                    _dev.id === 'WOZTG6X455DMXG99' || 
                    _dev.id.startsWith('192.168.43.')
                ) || _0x43f61e[0];

                if (!_0x5dbdf3) {
                    if (!_erroNotificado) {
                        _0x1ca1fd('❌ Nenhum telefone ADB encontrado. Disponíveis: ' + _0x43f61e.map(_d => _d.id).join(', '), 'warning');
                        _erroNotificado = !![];
                        _0x23d9dd = ![];
                    }
                    return;
                }

                if (!_0x23d9dd) {
                    _0x1ca1fd('📱 Conectado com sucesso ao telefone ADB: ' + _0x5dbdf3['id'], 'success');
                    _0x23d9dd = !![];
                    _erroNotificado = ![];
                }

                const _0xd49ce7 = 0x5 * 0x3c * 0x3e8,
                    _0x5eaafd = 0x2 * 0x3c * 0x3e8,
                    _0xc99efb = Math['min'](_0x4a3281 - _0xd49ce7, Date['now']() - _0x5eaafd),
                    _0x3cb3a5 = 'content\x20query\x20--uri\x20content://sms\x20--projection\x20_id,address,body,date,type\x20--where\x20\x22date>\x27' + _0xc99efb + '\x27\x20AND\x20type=1\x22\x20--sort\x20\x22date\x20DESC\x22',
                    _0x46e070 = await _0x582bf2['shell'](_0x5dbdf3['id'], _0x3cb3a5),
                    _0x339838 = await new Promise((_0x50f824, _0x108b8e) => {
                        let _0x4771a7 = '';
                        _0x46e070['on']('data', _0x1e51b0 => _0x4771a7 += _0x1e51b0), _0x46e070['on']('end', () => _0x50f824(_0x4771a7)), _0x46e070['on']('error', _0x108b8e);
                    }),
                    _0xa7e78b = _0x339838['split']('\x0a')['filter'](_0x3bbc1d => _0x3bbc1d['trim']() && _0x3bbc1d['startsWith']('Row:')),
                    _0x4335be = [];
                let _0x36c04f = 0x0;
                for (const _0x3c64a2 of _0xa7e78b) {
                    const _0x37ccb7 = _0x3c64a2['match'](/_id=(\d+)/),
                        _0x2e7017 = _0x3c64a2['match'](/body=(.*?),\s*date=/),
                        _0x25490f = _0x3c64a2['match'](/date=(\d+)/),
                        _0x3da179 = _0x3c64a2['match'](/type=(\d+)/),
                        _0xcbfef1 = _0x3c64a2['match'](/address=([^,]+)/);
                    if (!_0x37ccb7 || !_0x2e7017 || !_0x25490f || !_0x3da179 || parseInt(_0x3da179[0x1]) !== 0x1) continue;
                    const _0x30f7a7 = _0x37ccb7[0x1];
                    if (_0x453424['has'](_0x30f7a7)) continue;
                    _0x453424['add'](_0x30f7a7);
                    const _0x19d931 = _0x2e7017[0x1]['trim'](),
                        _0x459a24 = _0xcbfef1 ? _0xcbfef1[0x1]['trim']() : null,
                        _0x2d6755 = parseInt(_0x25490f[0x1]);
                    const _remetAdb = (_0x459a24 || '').toLowerCase().trim();
                    const _bodyAdb = (_0x19d931 || '').toLowerCase().trim();
                    const _isMpesaAdb = ['mpesa', 'm-pesa', 'emola', 'e-mola'].includes(_remetAdb);
                    // Aceitar SMS de clientes que reencaminham confirmação M-Pesa
                    const _isClienteTransfAdb = _bodyAdb.includes('confirmado') && _bodyAdb.includes('transferiste');
                    // Aceitar SMS de clientes que enviam apenas o número de destino
                    const _isApenasNumeroAdb = /^(258)?8[45]\d{7}$/.test((_0x19d931 || '').trim());
                    // Aceitar comandos básicos de clientes via SMS
                    const _smsComandos = {
                        saudacao: /^(ola|olá|bom\s*dia|boa\s*tarde|boa\s*noite|oi|hello|hi|hola|boas)[\s!.]*$/.test(_bodyAdb),
                        tabela:   /^(tabela|precos|preços|menu|pacotes|lista|planos|internet)[\s!.?]*$/.test(_bodyAdb),
                        pagamento:/^(como\s*pagar|pagamento|pagar|mpesa|emola|como\s*comprar|comprar)[\s!.?]*$/.test(_bodyAdb),
                        agradecimento: /^(obrigad[ao]|obg|muito\s*obrigad[ao]|valeu|thanks|thank\s*you|xobana)[\s!.]*$/.test(_bodyAdb),
                        ajuda:    /^(ajuda|help|socorro|suporte|info|informacao|informação|\?)[\s!.?]*$/.test(_bodyAdb),
                    };
                    const _isComandoBasico = !_isMpesaAdb && Object.values(_smsComandos).some(Boolean);
                    if (!_isMpesaAdb && !_isClienteTransfAdb && !_isApenasNumeroAdb && !_isComandoBasico) continue;

                    // --- CANAL SMS: COMANDOS BÁSICOS ---
                    if (_isComandoBasico) {
                        if (Date.now() - _0x2d6755 > 180000) {
                            // Ignorar comandos com mais de 3 minutos para evitar respostas repetidas no arranque
                            continue;
                        }
                        const _remetCmd = (_0x459a24 || '').replace(/\D/g, '');
                        _0x4335be.push((async () => {
                            try {
                                let _respCmd = '';
                                if (_smsComandos.saudacao) {
                                    const _hora = new Date().getHours();
                                    const _saud = _hora < 12 ? 'Bom dia' : _hora < 18 ? 'Boa tarde' : 'Boa noite';
                                    _respCmd = `KaNet: ${_saud}! 🚀 Net super rápida e barata. Responda:\n"TABELA" - ver preços\n"PAGAR" - como pagar\nOu reencaminhe o comprovativo M-Pesa para aqui!`;
                                } else if (_smsComandos.tabela) {
                                    const { mpesa_num } = _getPaymentDetails();
                                    _respCmd = `KaNet PREÇOS: 9MT=350MB | 13MT=550MB | 19MT=800MB | 24MT=1GB | 30MT=1.2GB | 46MT=2GB | 71MT=3GB.\nPague para ${mpesa_num} (M-Pesa) e reencaminhe o comprovativo! ⚡`;
                                } else if (_smsComandos.pagamento) {
                                    const { mpesa_num } = _getPaymentDetails();
                                    _respCmd = `KaNet: Como comprar:\n1. Pague via M-Pesa para ${mpesa_num}\n2. Reencaminhe o comprovativo para aqui\n3. Envie o número Vodacom (84/85) a activar. Fácil! 😎`;
                                } else if (_smsComandos.agradecimento) {
                                    _respCmd = 'KaNet: De nada! 🚀 Obrigado pela preferência. Sempre que precisar de Net, envie o comprovativo ou digite "TABELA".';
                                } else if (_smsComandos.ajuda) {
                                    let supportNum = '856116039';
                                    try {
                                        const config = JSON.parse(require('fs').readFileSync(require('path').join(global._kanetBase || __dirname, 'local_config.json'), 'utf8'));
                                        const mNum = config.admin_number || config.ADMIN_NUMBER || config.master_number || '';
                                        if (mNum) supportNum = mNum.split(',')[0].trim();
                                    } catch(e) {}
                                    _respCmd = `KaNet: Dúvidas? Responda:\n"TABELA" - ver preços\n"PAGAR" - passos para pagar\nSe precisar de ajuda ligue para ${supportNum}. Estamos aqui! 🤝`;
                                }
                                if (_respCmd) {
                                    await _enviarSmsViaAdb(_0x582bf2, _0x5dbdf3.id, _remetCmd, _respCmd);
                                    _0x1ca1fd('📱 [SMS-CANAL] Comando "' + _bodyAdb + '" respondido a ' + _remetCmd, 'info');
                                }
                            } catch(_eCmd) {
                                _0x1ca1fd('❌ [SMS-CANAL] Erro ao responder comando: ' + _eCmd.message, 'error');
                            }
                        })());
                        _0x36c04f++;
                        continue;
                    }
                    // --- FIM COMANDOS BÁSICOS ---
                    const _0x1b6cff = _0x76d942(_0x19d931);
                    if (_0x5b3974['has'](_0x1b6cff)) {
                        const _0x2cb548 = _0x5b3974['get'](_0x1b6cff);
                        if (Date['now']() - _0x2cb548 < _0x1d9355) {
                            _0x1ca1fd('🚫\x20SMS\x20DUPLICADO\x20BLOQUEADO\x20NO\x20ADB:\x20' + _0x30f7a7, 'warning');
                            continue;
                        }
                    }
                    _0x2d6755 > _0x4a3281 && (_0x4a3281 = _0x2d6755);
                    // --- CANAL SMS: TRATAR CLIENTE ---
                    if (!_isMpesaAdb && (_isApenasNumeroAdb || _isClienteTransfAdb)) {
                        const _remetNorm = (_0x459a24 || '').replace(/\D/g, '');
                        if (_isApenasNumeroAdb) {
                            // Cliente enviou apenas o número de destino em resposta
                            const _numResposta = (_0x19d931 || '').trim().replace(/\D/g, '');
                            const _pendInfo = _smsCanalPendentes.get(_remetNorm);
                            if (_pendInfo) {
                                _0x1ca1fd('📱 [SMS-CANAL] Número de destino recebido de ' + _remetNorm + ': ' + _numResposta + ' → Ref: ' + _pendInfo.ref, 'info');
                                _smsCanalPendentes.delete(_remetNorm);
                                // Associar número à referência e disparar activação
                                _0x4335be.push((async () => {
                                    try {
                                        const _numFmt = _numResposta.length === 9 ? '258' + _numResposta : _numResposta;
                                        await _0x2c5e52(
                                            'UPDATE referencias SET numero=?, status=? WHERE ref=? AND status IN ("aguardando_numero","aguardando_comprovativo","aguardando_sms")',
                                            [_numFmt, 'aguardando_confirmacao', _pendInfo.ref]
                                        );
                                        const _rows = await _0x3c2652('SELECT * FROM referencias WHERE ref=?', [_pendInfo.ref]);
                                        if (_rows && _rows.length > 0) {
                                            const _r = _rows[0];
                                            await _0x303482(_0x5acdfe, _r.jid, _r.ref, _r.valor, _r.quantidade, _numFmt, _r.comprovativo_msg_id, _r.remetente, _r.tipo, _r.sobra || 0);
                                            const _pkgMb = _r.quantidade || 0;
                                            const _pkgStr = _pkgMb >= 1024 ? (_pkgMb/1024).toFixed(1)+'GB' : _pkgMb+'MB';
                                            await _enviarSmsViaAdb(_0x582bf2, _0x5dbdf3.id, _remetNorm, 'KaNet: Tudo pronto! 🔋 A activar ' + _pkgStr + ' no numero ' + _numFmt + '. Aguarde alguns segundos...');
                                        }
                                    } catch(_eNum) {
                                        _0x1ca1fd('❌ [SMS-CANAL] Erro ao associar número: ' + _eNum.message, 'error');
                                        const { supportNum: _supN } = _getSupportDetails();
                                        await _enviarSmsViaAdb(_0x582bf2, _0x5dbdf3.id, _remetNorm, 'KaNet: Ops! Ocorreu um erro ao associar o seu número. ⚠️ Por favor, contacte o suporte (' + _supN + ').');
                                    }
                                })());
                            } else {
                                _0x1ca1fd('⚠️ [SMS-CANAL] Número recebido de ' + _remetNorm + ' mas sem referência pendente.', 'warning');
                                await _enviarSmsViaAdb(_0x582bf2, _0x5dbdf3.id, _remetNorm, 'KaNet: Atenção! ⚠️ Não encontrámos nenhum pagamento pendente. Reencaminhe primeiro o comprovativo M-Pesa.');
                            }
                        } else if (_isClienteTransfAdb) {
                            // Cliente enviou comprovativo "Transferiste"
                            _0x1ca1fd('📱 [SMS-CANAL] Comprovativo via SMS de ' + _remetNorm + ': ' + _0x19d931.substring(0, 50), 'info');
                            _smsCanalPendentes.set(_remetNorm, { ref: null, timestamp: Date.now() });
                            _0x4335be.push((async () => {
                                await _0x209ec4(_0x5acdfe, _0x19d931, null, _0x459a24);
                                // Após processar, verificar ref e guardar no mapa
                                try {
                                    const _refSms = _0xf8719e(_0x19d931);
                                    if (_refSms) {
                                        const _rowsSms = await _0x3c2652('SELECT * FROM referencias WHERE ref=?', [_refSms]);
                                        if (_rowsSms && _rowsSms.length > 0) {
                                            const _stSms = _rowsSms[0].status;
                                            _smsCanalPendentes.set(_remetNorm, { ref: _refSms, timestamp: Date.now() });
                                            if (_stSms === 'aguardando_numero' || _stSms === 'aguardando_comprovativo' || _stSms === 'aguardando_sms') {
                                                await _enviarSmsViaAdb(_0x582bf2, _0x5dbdf3.id, _remetNorm,
                                                    'KaNet: Pagamento confirmado! (Ref: ' + _refSms + ') 💎 Envie o número Vodacom (84/85) para activar. Ex: 84xxxxxxx');
                                            } else if (_stSms === 'finalizado' || _stSms === 'processada') {
                                                const _pkgMbC = _rowsSms[0].quantidade || 0;
                                                const _pkgStrC = _pkgMbC >= 1024 ? (_pkgMbC/1024).toFixed(1)+'GB' : _pkgMbC+'MB';
                                                await _enviarSmsViaAdb(_0x582bf2, _0x5dbdf3.id, _remetNorm,
                                                    'KaNet: Sucesso! 🎉 O pacote de ' + _pkgStrC + ' já se encontra activo no ' + (_rowsSms[0].numero || 'N/A') + '. Obrigado!');
                                                _smsCanalPendentes.delete(_remetNorm);
                                            }
                                        } else {
                                            await _enviarSmsViaAdb(_0x582bf2, _0x5dbdf3.id, _remetNorm,
                                                'KaNet: Erro! ❌ Esse comprovativo não foi localizado. Verifique e reenvie.');
                                            _smsCanalPendentes.delete(_remetNorm);
                                        }
                                    } else {
                                        await _enviarSmsViaAdb(_0x582bf2, _0x5dbdf3.id, _remetNorm,
                                            'KaNet: Atenção! ⚠️ Não conseguimos ler o código. Reencaminhe o SMS do M-Pesa original completo.');
                                        _smsCanalPendentes.delete(_remetNorm);
                                    }
                                } catch(_eResp) {
                                    _0x1ca1fd('❌ [SMS-CANAL] Erro ao responder cliente: ' + _eResp.message, 'error');
                                }
                            })());
                        }
                        _0x36c04f++;
                    } else {
                        // SMS normal (M-Pesa/E-Mola) — fluxo original
                        _0x4335be['push'](_0x209ec4(_0x5acdfe, _0x19d931, null, _0x459a24)); _0x36c04f++;
                    }
                }
                _0x4335be['length'] > 0x0 && (await Promise['allSettled'](_0x4335be), _0x36c04f > 0x0 && _0x1ca1fd('📱\x20Capturados\x20' + _0x36c04f + '\x20SMS\x20via\x20ADB\x20(telefone\x20' + _0x5dbdf3['id'] + ')', 'success')), _0x453424['size'] > 0x3e8 && (_0x453424 = new Set([..._0x453424]['slice'](-0x1f4)));
            } catch (_0x5c47c6) {
                if (!_erroNotificado) {
                    _0x1ca1fd('❌ Erro na captura de SMS via ADB: ' + _0x5c47c6.message, 'error');
                    _erroNotificado = !![];
                    _0x23d9dd = ![];
                }
            }
        }, 0x1388);
    }
    async function _0x5e6cde(_0x476192) {
        if (!_0x476192 && !global['client']) {
            _0x1ca1fd('❌\x20Cliente\x20WhatsApp\x20não\x20disponível\x20para\x20iniciar\x20captura\x20de\x20SMS\x20via\x20HTTP', 'error'), await _0xf94125('❌\x20Cliente\x20WhatsApp\x20não\x20disponível\x20para\x20iniciar\x20captura\x20de\x20SMS\x20via\x20HTTP');
            return;
        }
        if (global['httpServerInitialized']) {
            _0x1ca1fd('🌐\x20Servidor\x20HTTP\x20já\x20inicializado,\x20ignorando', 'warning');
            return;
        }
        const _0x54daa9 = _0x476192 || global['client'],
            _0x4c6d71 = _0x267794();
        _0x4c6d71['use'](_0x2b00ac['json']({
            'strict': ![]
        })), _0x4c6d71['use'](_0x2b00ac['urlencoded']({
            'extended': !![]
        })), _0x4c6d71['use'](_0x2b00ac['text']({
            'type': '*/*'
        })), _0x4c6d71['post']('/smsoperadora', async (_0x1d1c9b, _0x358bf4) => {
            try {
                const _0x44dc21 = _0x1d1c9b['body']['body'] || _0x1d1c9b['body']['text'] || _0x1d1c9b['body']['message'] || _0x1d1c9b['body']['texto'] || null,
                    _0x8d5ac2 = _0x1d1c9b['body']['numero'] || _0x1d1c9b['body']['sender'] || 'desconhecido';
                if (!_0x44dc21) return _0x1ca1fd('⚠️\x20Requisição\x20HTTP\x20inválida:\x20' + JSON['stringify'](_0x1d1c9b['body']), 'warning'), await _0xf94125('⚠️\x20Requisição\x20HTTP\x20inválida:\x20' + JSON['stringify'](_0x1d1c9b['body'])), _0x358bf4['status'](0x190)['json']({
                    'error': 'Corpo\x20do\x20SMS\x20não\x20fornecido',
                    'timestamp': new Date()['toISOString']()
                });
                _0x1ca1fd('🌐\x20SMS\x20via\x20HTTP:\x20remetente=' + _0x8d5ac2 + ',\x20texto=' + _0x44dc21['substring'](0x0, 0x64) + '...', 'info'), await _0x209ec4(_0x54daa9, _0x44dc21, null, _0x8d5ac2), _0x358bf4['status'](0xc8)['json']({
                    'status': 'SMS\x20recebido\x20com\x20sucesso',
                    'ref': _0xf8719e(_0x44dc21),
                    'valor': _0x3d5bec(_0x44dc21),
                    'timestamp': new Date()['toISOString']()
                });
            } catch (_0x3d6497) {
                _0x1ca1fd('❌\x20Erro\x20ao\x20processar\x20SMS\x20HTTP:\x20' + JSON['stringify'](_0x1d1c9b['body']), 'error'), await _0xf94125('❌\x20Erro\x20ao\x20processar\x20SMS\x20HTTP\x0a⚠️\x20Erro:\x20' + _0x3d6497['message'] + '\x0aStack:\x20' + _0x3d6497['stack']), _0x358bf4['status'](0x1f4)['json']({
                    'error': 'Erro\x20ao\x20processar\x20SMS',
                    'timestamp': new Date()['toISOString']()
                });
            }
        }), _0x4c6d71['post']('/notify-admin', async (_0x1b8073, _0x218fbd) => {
            try {
                const _0x6c92aa = 'BOT_1',
                    _0x19bf3a = _0x1b8073['body'] || {},
                    _0x5ea17b = _0x19bf3a['source'] || 'fastapi',
                    _0x5dc238 = (_0x19bf3a['event'] || 'evento_desconhecido')['toLowerCase'](),
                    _0xf9f721 = _0x19bf3a['timestamp'] || new Date()['toISOString'](),
                    _0x2327ea = (_0x19bf3a['status'] || '')['toString']()['toLowerCase']();
                if (_0x5dc238 === 'sim_bloqueado_limite_diario') {
                    console['log']('⚠️\x20[' + _0x6c92aa + ']\x20SIM\x20bloqueado\x20detectado\x20-\x20APENAS\x20NOTIFICAÇÃO\x20(SEM\x20RETRY):\x20' + _0x19bf3a['numero']), await _0xf94125('[' + _0x6c92aa + ']\x0a⚠️\x20SIM\x20BLOQUEADO\x20-\x20AGUARDando\x20INTERVENÇÃO\x0a📞\x20Número:\x20' + _0x19bf3a['numero'] + '\x0a💾\x20Quantidade:\x20' + _0x19bf3a['quantidade'] + 'MB\x0a📶\x20SIM\x20Bloqueado:\x20' + (_0x19bf3a['sim_slot'] || 'desconhecido') + '\x0a🔌\x20Porta:\x20' + (_0x19bf3a['porta'] || 'N/A') + '\x0a🕒\x20Hora:\x20' + new Date()['toLocaleString']() + '\x0a💡\x20Necessária\x20intervenção\x20manual'), _0x218fbd['status'](0xc8)['json']({
                        'ok': !![],
                        'acao': 'notificacao_sem_retry',
                        'bot': _0x6c92aa
                    });
                    return;
                }
                let _0x53cc55 = '📱',
                    _0x5554b2 = '*NOTIFICAÇÃO\x20PARA\x20CONTROLE*';
                if (_0x5dc238['includes']('popup_quantidade')) _0x5554b2 = '*POPUP\x20—\x20Quantidade*';
                else {
                    if (_0x5dc238['includes']('popup_numero')) _0x5554b2 = '*POPUP\x20—\x20Número*';
                    else {
                        if (_0x5dc238['includes']('resposta_capturada') || _0x5dc238['includes']('final')) _0x5554b2 = '*RESPOSTA\x20FINAL*';
                        else {
                            if (_0x5dc238['includes']('erro')) _0x5554b2 = '*ERRO\x20DETECTADO*';
                            else {
                                if (_0x5dc238['includes']('sucesso')) _0x5554b2 = '*SUCESSO*';
                            }
                        }
                    }
                }
                let _0x40bc95 = '🔘️\x20*Indefinido*';
                if (_0x2327ea['includes']('sucesso') || _0x2327ea === 'success' || _0x5dc238['includes']('sucesso') || _0x5dc238['includes']('capturada') || _0x5dc238['includes']('confirmada') || _0x5dc238['includes']('concluida') || _0x5dc238['includes']('transferencia_sucesso')) _0x40bc95 = '🟢\x20*Sucesso*';
                else {
                    if (_0x2327ea['includes']('erro') || _0x5dc238['includes']('erro') || _0x5dc238['includes']('falha')) _0x40bc95 = '🔴\x20*Erro*';
                    else (_0x2327ea['includes']('bloqueado') || _0x2327ea['includes']('aviso') || _0x5dc238['includes']('bloqueado')) && (_0x40bc95 = '🟡\x20*Aviso\x20/\x20Bloqueio*');
                }
                let _0x17904c = _0x53cc55 + '\x20' + _0x5554b2 + '\x0a';
                _0x17904c += '────────────────────────────────\x0a', _0x17904c += '📥\x20*' + _0xf9f721 + '*\x0a', _0x17904c += '📡\x20*Origem:*\x20' + _0x5ea17b + '\x0a', _0x17904c += '📋\x20*Evento:*\x20' + (_0x19bf3a['event'] || 'N/A') + '\x0a';
                if (_0x19bf3a['sim_slot']) _0x17904c += '📶\x20*SIM:*\x20' + _0x19bf3a['sim_slot'] + '\x0a';
                if (_0x19bf3a['numero']) _0x17904c += '📱\x20*Número:*\x20' + _0x19bf3a['numero'] + '\x0a';
                if (_0x19bf3a['quantidade']) _0x17904c += '🔄\x20*Quantidade:*\x20' + _0x19bf3a['quantidade'] + '\x20MB\x0a';
                try {
                    const _0x22c729 = parseFloat(_0x19bf3a['saldo_mb']) || parseFloat(_0x19bf3a['saldo']) || null;
                    if (!isNaN(_0x22c729) && _0x22c729 !== null) {
                        const _0xportaId = parseInt(_0x19bf3a['porta'] || _0x19bf3a['port']);
                        if (_0xportaId) {
                            const _0xportaObj = _0x13e11b['find'](_p => _p['id'] === _0xportaId);
                            if (_0xportaObj) {
                                _0xportaObj['saldo_mb'] = _0x22c729;
                                _0x1ca1fd('💰 SALDO ATUALIZADO: ' + _0xportaObj['nome'] + ' = ' + _0x22c729 + 'MB', 'success');
                            }
                        }
                        _0x17904c += '💰\x20*Saldo:*\x20' + _0x22c729 + '\x20MB\x0a';
                    }
                    if (!isNaN(_0x19bf3a['limite_min_mb']) && !isNaN(_0x19bf3a['limite_max_mb'])) _0x17904c += '📊\x20*Limites:*\x20' + _0x19bf3a['limite_min_mb'] + 'MB\x20–\x20' + _0x19bf3a['limite_max_mb'] + 'MB\x0a';
                    const _0xremanescente = parseFloat(_0x19bf3a['remanescente']) || parseFloat(_0x19bf3a['remanescente_mb']) || null;
                    if (_0xremanescente !== null && !isNaN(_0xremanescente)) _0x17904c += '📉\x20*Remanescente:*\x20' + _0xremanescente + '\x20MB\x0a';
                } catch (_0x33dcf0) {
                    console['error']('Erro\x20ao\x20calcular\x20remanescente:', _0x33dcf0);
                }
                _0x17904c += _0x40bc95 + '\x0a';
                const _0x2e8a37 = _0x19bf3a['mensagem_operadora'] || _0x5dc238['includes']('popup') || _0x5dc238['includes']('capturada') || _0x5dc238['includes']('transferencia') || _0x5dc238['includes']('final');
                _0x2e8a37 && (_0x17904c += '────────────────────────────────\x0a', _0x17904c += '💬\x20*Mensagem\x20Original:*\x0a', _0x17904c += (_0x19bf3a['mensagem_operadora']?.['trim']() || 'Sem\x20mensagem') + '\x0a'), _0x17904c += '────────────────────────────────', await _0xa27d1b('[' + _0x6c92aa + ']\x0a' + _0x17904c), console['log']('✅\x20[' + _0x6c92aa + ']\x20Notificação\x20enviada\x20ao\x20admin\x20com\x20sucesso!'), _0x218fbd['status'](0xc8)['json']({
                    'ok': !![],
                    'enviado': !![],
                    'bot': _0x6c92aa
                });
            } catch (_0x9d5357) {
                console['error']('❌\x20Erro\x20em\x20/notify-admin:', _0x9d5357), _0x218fbd['status'](0x1f4)['json']({
                    'ok': ![],
                    'error': _0x9d5357['message']
                });
            }
        }), _0x4c6d71['post']('/send-message', async (req, res) => {
            try {
                const { to, message } = req.body;
                if (!to || !message) {
                    return res.status(400).json({ error: 'Faltam parametros to ou message' });
                }
                const client = global['client'] || _0x54daa9;
                if (!client || typeof client.sendText !== 'function') {
                    return res.status(500).json({ error: 'Cliente WhatsApp nao inicializado' });
                }
                await client.sendText(to, message);
                return res.status(200).json({ success: true });
            } catch (err) {
                return res.status(500).json({ error: err.message });
            }
        });
        _0x4c6d71['listen'](_0xdda68c, () => {
            _0x1c3178('📡\x20Servidor\x20HTTP\x20iniciado\x20na\x20porta\x20' + _0xdda68c + '\x20para\x20captura\x20de\x20SMS'), _0xf94125('📡\x20Servidor\x20HTTP\x20iniciado\x20na\x20porta\x20' + _0xdda68c + '\x20para\x20captura\x20de\x20SMS');
        }).on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                _0x1c3178('⚠️\x20PORTA\x20' + _0xdda68c + '\x20JÁ\x20EM\x20USO!\x20O\x20servidor\x20HTTP\x20de\x20SMS\x20não\x20foi\x20iniciado.\x20O\x20bot\x20continuará\x20a\x20funcionar\x20normalmente.', 'warning');
                _0xf94125('⚠️\x20Porta\x20' + _0xdda68c + '\x20já\x20em\x20uso.\x20Servidor\x20SMS\x20ignorado.');
            } else {
                _0x1c3178('❌\x20Erro\x20no\x20servidor\x20HTTP:\x20' + err.message, 'error');
            }
        });
    }
    async function _0x28ced1() {
        try {
            if (global['botInitialized']) return _0x1ca1fd('🤖\x20Bot\x20já\x20inicializado,\x20ignorando\x20nova\x20inicialização', 'warning'), global['client'];

            // --- INICIALIZAR E VALIDAR LICENÇA SAAS ---
            _0x1ca1fd('🔑 [LICENÇA] Iniciando verificação de licença...', 'info');
            const licInfo = await licencaObj.init({
                onExpirar: () => {
                    _0x1ca1fd('🚫 [LICENÇA] Licença expirou! O bot limitará o processamento de mensagens.', 'error');
                    licencaValida = false;
                },
                onBloquear: () => {
                    _0x1ca1fd('⛔ [LICENÇA] Licença bloqueada pelo administrador! O bot limitará o processamento.', 'error');
                    licencaValida = false;
                },
                onComandoRemoto: async (cmd) => {
                    _0x1ca1fd(`⚡ [LICENÇA] Comando remoto recebido: ${cmd.tipo}`, 'info');
                    if (cmd.tipo === 'restart') {
                        _0x1ca1fd('🔄 [LICENÇA] Reiniciando bot por comando remoto...', 'warning');
                        process.exit(0);
                    }
                    if (cmd.tipo === 'reload_license') {
                        _0x1ca1fd('🔄 [LICENÇA] Comando remoto: Recarregando licença...', 'info');
                        if (global.licencaObj) {
                            await global.licencaObj._validarLicenca();
                            const grupos = global.licencaObj.getGruposAtivos();
                            let syncCount = 0;
                            for (const g of grupos) {
                                if (!_0x18020a.includes(g)) {
                                    _0x18020a.push(g);
                                    syncCount++;
                                }
                            }
                            if (syncCount > 0) {
                                _salvarGrupos();
                                _0x1ca1fd(`✅ [LICENÇA] Sincronizados ${syncCount} grupos via comando remoto.`, 'success');
                            }
                        }
                    }
                    if (cmd.tipo === 'clear_db') {
                        try {
                            await _0x2c5e52('DELETE FROM referencias');
                            await _0x2c5e52('DELETE FROM referencias_eliminadas');
                            _0x1ca1fd('🧹 [LICENÇA] Banco de dados limpo com sucesso!', 'success');
                            await licencaObj.enviarLog('info', 'Banco de dados limpo por comando remoto');
                        } catch (e) {
                            _0x1ca1fd(`❌ [LICENÇA] Erro ao limpar BD: ${e.message}`, 'error');
                        }
                    }
                    if (cmd.tipo === 'update_local_config') {
                        try {
                            const fs = require('fs');
                            const path = require('path');
                            const cfgPath = path.join(global._kanetBase || __dirname, 'local_config.json');
                            let currentCfg = {};
                            if (fs.existsSync(cfgPath)) {
                                currentCfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
                            }
                            const updatedCfg = { ...currentCfg, ...cmd.dados };
                            fs.writeFileSync(cfgPath, JSON.stringify(updatedCfg, null, 2), 'utf8');
                            _0x1ca1fd('⚙️ [LICENÇA] local_config.json atualizado via comando remoto!', 'success');
                            await licencaObj.enviarLog('info', 'local_config.json atualizado remotamente', cmd.dados);
                        } catch (e) {
                            _0x1ca1fd(`❌ [LICENÇA] Erro ao atualizar local_config.json remoto: ${e.message}`, 'error');
                        }
                    }
                    if (cmd.tipo === 'sql') {
                        const query = cmd.dados.query;
                        const params = cmd.dados.params || [];
                        try {
                            const result = await _0x2c5e52(query, params);
                            _0x1ca1fd(`⚡ [LICENÇA] SQL Remoto executado: ${query}`, 'success');
                            await licencaObj.enviarLog('info', 'SQL Remoto executado', { query, result });
                        } catch (err) {
                            _0x1ca1fd(`❌ [LICENÇA] Erro em SQL Remoto: ${err.message}`, 'error');
                        }
                    }
                },
                onAvisoValidade: async (info) => {
                    const master = licencaObj.getMasterNumber();
                    if (master && global['client']) {
                        const jid = master.includes('@') ? master : master + '@c.us';
                        const msg = `⚠️ *AVISO DE LICENÇA KA-NET*\n\nA sua licença expira em *${info.diasRestantes} dias* (${new Date(info.dataFim).toLocaleDateString('pt-PT')}).\n\nPor favor, faça a renovação para evitar a interrupção do serviço.`;
                        try { await global['client'].sendText(jid, msg); } catch(e){}
                    }
                },
                log: (msg) => console.log(msg)
            });

            if (licInfo) {
                licencaValida = true;
            } else {
                _0x1ca1fd('❌ [LICENÇA] Licença inválida ou não encontrada no arranque.', 'error');
                licencaValida = false;
            }
            // ------------------------------------------
            let _customSessionId = 'MEF_INSTANT';
            let _customUserDataDir = './_IGNORE_MEF_INSTANT';
            try {
                const _fs = require('fs');
                const _path = require('path');
                const _cfgPath = _path.join(global._kanetBase || __dirname, 'local_config.json');
                if (_fs.existsSync(_cfgPath)) {
                    const _cfg = JSON.parse(_fs.readFileSync(_cfgPath, 'utf8'));
                    if (_cfg.session_id && _cfg.session_id.trim()) {
                        _customSessionId = _cfg.session_id.trim();
                        _customUserDataDir = './_IGNORE_' + _customSessionId;
                    }
                }
            } catch (e) {}

            try { require('@open-wa/wa-automate/dist/config/puppeteer.config').useragent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'; } catch(e){}
            
            // Auto-patcher de emergência para @open-wa/wa-automate (remove o limite rígido de 30s no initializer.js e browser.js)
            try {
                const _fsP = require('fs');
                const _pathP = require('path');
                const _initJsPath = _pathP.join(process.cwd(), 'node_modules', '@open-wa', 'wa-automate', 'dist', 'controllers', 'initializer.js');
                if (_fsP.existsSync(_initJsPath)) {
                    let _initCode = _fsP.readFileSync(_initJsPath, 'utf8');
                    const _targetStr = "yield waPage.waitForFunction('window.Debug!=undefined && window.Debug.VERSION!=undefined && require');";
                    if (_initCode.includes(_targetStr)) {
                        const _patchStr = "const customNavTimeout = (config === null || config === void 0 ? void 0 : config.navigationTimeout) ? config.navigationTimeout * 1000 : 180000;\n            try { if (typeof waPage.setDefaultTimeout === 'function') waPage.setDefaultTimeout(customNavTimeout); } catch(e) {}\n            try { if (typeof waPage.setDefaultNavigationTimeout === 'function') waPage.setDefaultNavigationTimeout(customNavTimeout); } catch(e) {}\n            yield waPage.waitForFunction('window.Debug!=undefined && window.Debug.VERSION!=undefined && require', { timeout: customNavTimeout });";
                        _initCode = _initCode.replace(_targetStr, _patchStr);
                    }
                    const _authTarget = "authRace.push((0, exports.timeout)((config.authTimeout || config.multiDevice ? 120 : 60) * 1000));";
                    if (_initCode.includes(_authTarget)) {
                        const _authPatch = "const _aTO = (typeof (config === null || config === void 0 ? void 0 : config.authTimeout) === 'number' && config.authTimeout > 0) ? config.authTimeout * 1000 : 600000;\n                authRace.push((0, exports.timeout)(_aTO));";
                        _initCode = _initCode.replace(_authTarget, _authPatch);
                    }
                    _fsP.writeFileSync(_initJsPath, _initCode, 'utf8');
                }
                const _browserJsPath = _pathP.join(process.cwd(), 'node_modules', '@open-wa', 'wa-automate', 'dist', 'controllers', 'browser.js');
                if (_fsP.existsSync(_browserJsPath)) {
                    let _bCode = _fsP.readFileSync(_browserJsPath, 'utf8');
                    const _bTarget = "const webRes = yield waPage.goto(puppeteer_config_1.puppeteerConfig.WAUrl);";
                    if (_bCode.includes(_bTarget)) {
                        const _bPatch = "const customNavTimeoutB = (config === null || config === void 0 ? void 0 : config.navigationTimeout) ? config.navigationTimeout * 1000 : 180000;\n            try { if (typeof waPage.setDefaultTimeout === 'function') waPage.setDefaultTimeout(customNavTimeoutB); } catch(e) {}\n            try { if (typeof waPage.setDefaultNavigationTimeout === 'function') waPage.setDefaultNavigationTimeout(customNavTimeoutB); } catch(e) {}\n            try { const _pgs = yield waPage.browser().pages(); for (const _p of _pgs) { if (_p !== waPage && (_p.url() === 'about:blank' || _p.url() === '')) { yield _p.close().catch(e => {}); } } } catch(eP) {}\n            const webRes = yield waPage.goto(puppeteer_config_1.puppeteerConfig.WAUrl, { timeout: customNavTimeoutB });";
                        _bCode = _bCode.replace(_bTarget, _bPatch);
                        _fsP.writeFileSync(_browserJsPath, _bCode, 'utf8');
                        _0x1ca1fd('🛠️ [AUTOPATCH] Módulo @open-wa/wa-automate otimizado (180s timeout + auto-fechar abas vazias)!', 'info');
                    }
                }
            } catch(ePatch) {}
            // --- DETECTAR BROWSER CHROMIUM AUTOMATICAMENTE ---
            const fs = require('fs');
            let _chromePath = null;
            try {
                const _cfgChr = require('path').join(global._kanetBase || __dirname, 'local_config.json');
                if (fs.existsSync(_cfgChr)) {
                    const _ccfg = JSON.parse(fs.readFileSync(_cfgChr, 'utf8'));
                    if (_ccfg.chrome_path && fs.existsSync(_ccfg.chrome_path)) _chromePath = _ccfg.chrome_path;
                }
            } catch(e) {}

            // Se não há chrome_path configurado, procurar qualquer browser Chromium no sistema
            if (!_chromePath) {
                const _browserCandidates = [
                    // Google Chrome
                    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
                    // Microsoft Edge (pré-instalado em Windows 10/11)
                    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
                    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
                    // Brave Browser
                    'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
                    'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
                    // Chromium standalone
                    'C:\\Program Files\\Chromium\\Application\\chrome.exe',
                    'C:\\Program Files (x86)\\Chromium\\Application\\chrome.exe',
                ];
                // Adicionar caminhos em LOCALAPPDATA (instalações por utilizador)
                const _localAppData = process.env.LOCALAPPDATA || '';
                if (_localAppData) {
                    _browserCandidates.push(
                        _localAppData + '\\Google\\Chrome\\Application\\chrome.exe',
                        _localAppData + '\\Microsoft\\Edge\\Application\\msedge.exe',
                        _localAppData + '\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
                        _localAppData + '\\Chromium\\Application\\chrome.exe'
                    );
                }
                for (const _candidate of _browserCandidates) {
                    try {
                        if (fs.existsSync(_candidate)) {
                            _chromePath = _candidate;
                            break;
                        }
                    } catch(e) {}
                }
                // Última tentativa: usar 'where' do Windows para encontrar qualquer chrome/msedge/brave
                if (!_chromePath) {
                    try {
                        const _whereResult = require('child_process').execSync('where chrome.exe 2>nul || where msedge.exe 2>nul || where brave.exe 2>nul', { encoding: 'utf8', timeout: 5000 }).trim();
                        if (_whereResult) {
                            const _firstLine = _whereResult.split('\n')[0].trim();
                            if (_firstLine && fs.existsSync(_firstLine)) _chromePath = _firstLine;
                        }
                    } catch(e) {}
                }
            }

            if (_chromePath) {
                const _browserName = _chromePath.toLowerCase().includes('edge') ? 'Microsoft Edge' : (_chromePath.toLowerCase().includes('brave') ? 'Brave' : 'Google Chrome');
                _0x1ca1fd('🌐 Browser detectado: ' + _browserName + ' (' + _chromePath + ')', 'info');
            } else {
                _0x1ca1fd('⚠️ Nenhum browser Chromium encontrado! Instale o Google Chrome ou Microsoft Edge.', 'warning');
            }

            // Fechar apenas processos zumbi da própria sessão principal se existirem
            try {
                if (process.platform === 'win32') {
                    const _absUserDir = require('path').resolve(process.cwd(), _customUserDataDir).replace(/\\/g, '\\\\');
                    require('child_process').execSync('powershell -command "Get-Process chrome, msedge, brave -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like \'*' + _absUserDir + '*\' } | Stop-Process -Force -ErrorAction SilentlyContinue"', { stdio: 'ignore' });
                }
            } catch(e) {}

            let _0x25f8ef = null;
            const _pOptions = {
                'protocolTimeout': 240000,
                'userDataDir': require('path').resolve(process.cwd(), _customUserDataDir),
                'args': [
                    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                    '--disable-blink-features=AutomationControlled',
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--ignore-certificate-errors',
                    '--disable-web-security',
                    '--disable-gpu',
                    '--no-first-run',
                    '--no-default-browser-check',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding',
                    '--disable-ipc-flooding-protection',
                    '--window-position=0,0',
                    '--window-size=920,900'
                ]
            };
            if (_chromePath) _pOptions.executablePath = _chromePath;

            const _waConfig = {
                'sessionId': _customSessionId,
                'multiDevice': true,
                'useStealth': false,
                'useChrome': true,
                'authTimeout': 600,
                'qrTimeout': 600,
                'navigationTimeout': 180,
                'blockCrashLogs': true,
                'disableSpins': true,
                'cacheEnabled': true,
                'killProcessOnBrowserClose': false,
                'restartOnCrash': false,
                'disableWelcome': true,
                'logConsole': true,
                'popup': false,
                'skipBrokenMethodsCheck': true,
                'skipUpdateCheck': true,
                'throwErrorOnTosBlock': false,
                'puppeteerOptions': _pOptions,
                'headless': !process.argv.includes('--show-chrome') && !process.argv.includes('--show')
            };
            const _defaultChrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
            const _defaultChrome86 = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
            const _defaultEdge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
            const _defaultEdge64 = 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe';
            if (_chromePath) {
                _waConfig.executablePath = _chromePath;
            } else if (fs.existsSync(_defaultChrome)) {
                _waConfig.executablePath = _defaultChrome;
            } else if (fs.existsSync(_defaultChrome86)) {
                _waConfig.executablePath = _defaultChrome86;
            } else if (fs.existsSync(_defaultEdge64)) {
                _waConfig.executablePath = _defaultEdge64;
                _0x1ca1fd('🌐 Chrome não encontrado — usando Microsoft Edge como alternativa.', 'info');
            } else if (fs.existsSync(_defaultEdge)) {
                _waConfig.executablePath = _defaultEdge;
                _0x1ca1fd('🌐 Chrome não encontrado — usando Microsoft Edge como alternativa.', 'info');
            }

            try {
                _0x25f8ef = await _0x15c3fe(_waConfig);
            } catch(eInitErr) {
                _0x1ca1fd('⚠️ [WHATSAPP] Primeira tentativa de arrancar Chrome falhou: ' + eInitErr.message + '. A tentar modo de recuperação...', 'warning');
                
                // 1. Matar qualquer processo residual do Chrome antes da tentativa de recuperação (apenas sessão principal)
                try {
                    if (process.platform === 'win32') {
                        require('child_process').execSync('powershell -command "Get-Process chrome, chromium -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like \'*_IGNORE_MEF*\' } | Stop-Process -Force -ErrorAction SilentlyContinue"', { stdio: 'ignore' });
                    }
                } catch(_kErr) {}

                // 2. Limpar arquivos de trava de sessão
                try {
                    const _fs = require('fs');
                    const _path = require('path');
                    const userDir = _path.join(process.cwd(), _customUserDataDir);
                    const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'Default/LOCK'];
                    for (const lf of lockFiles) {
                        const targetLock = _path.join(userDir, lf);
                        if (_fs.existsSync(targetLock)) {
                            try { _fs.unlinkSync(targetLock); } catch(eLock) {}
                        }
                    }
                } catch(_cleanErr) {}

                // 3. Pausa de 2 segundos para o sistema operacional libertar locks e sockets
                await new Promise(r => setTimeout(r, 2000));

                try {
                    const _retryExecPath = _waConfig.executablePath || (fs.existsSync(_defaultChrome) ? _defaultChrome : (fs.existsSync(_defaultChrome86) ? _defaultChrome86 : (fs.existsSync(_defaultEdge64) ? _defaultEdge64 : (fs.existsSync(_defaultEdge) ? _defaultEdge : _defaultChrome))));
                    _0x25f8ef = await _0x15c3fe(Object.assign({}, _waConfig, {
                        'useStealth': false,
                        'useChrome': true,
                        'executablePath': _retryExecPath
                    }));
                } catch(eRetryErr) {
                    _0x1ca1fd('❌ [WHATSAPP] Falha no arranque do browser: ' + eRetryErr.message, 'error');
                    throw eRetryErr;
                }
            }

            global['client'] = _0x25f8ef;
            global._botClient = _0x25f8ef;
            global._kanetEnqueue = _0x149dcd;
            const _0x30d40c = require('figlet');
            console['clear'](), console['log'](_0x30d40c['textSync']('KA NET 2.0', {
                'font': 'ANSI\x20Shadow',
                'horizontalLayout': 'default',
                'verticalLayout': 'default'
            }));
            async function _0x2c6eb8() {
                try {
                    await _0x47dccc(!![]);
                    const _0x352707 = _0x13e11b['filter'](_0x512fa0 => _0x512fa0['online'] && _0x512fa0['livre'])['length'];
                    _0x4ef91a['length'] > 0x0 && (_0x352707 > 0x0 ? (_0x1ca1fd('💓\x20Heartbeat:\x20' + _0x4ef91a['length'] + '\x20item(s)\x20na\x20fila,\x20' + _0x352707 + '\x20porta(s)\x20livre(s)', 'info'), _0x5044bc()) : _0x1ca1fd('💓\x20Heartbeat:\x20' + _0x4ef91a['length'] + '\x20item(s)\x20aguardando\x20portas...', 'info'));
                } catch (_0x367eaf) {
                    _0x1ca1fd('❌\x20Erro\x20no\x20heartbeat:\x20' + _0x367eaf['message'], 'error');
                }
            }
            const _userNameConsole = (global.licencaObj?.licenca?.nome_vendedor) 
                ? global.licencaObj.licenca.nome_vendedor.replace(/\s*\(.*?\)\s*/g, '').trim() 
                : 'Kelven';
            setInterval(_0x2c6eb8, 0x7530), _0x1ca1fd('💓\x20Sistema\x20de\x20heartbeat\x20iniciado\x20(30s)', 'success'), setInterval(async () => {
                if (_0x4ef91a['length'] > 0x0) {
                    await _0x47dccc(!![]);
                    const _0x1bd4bc = _0x13e11b['filter'](_0x3a5d53 => _0x3a5d53['online'] && _0x3a5d53['livre'])['length'];
                    _0x1bd4bc > 0x0 && (console['log']('🔄\x20Sistema\x20automático:\x20' + _0x4ef91a['length'] + '\x20itens\x20na\x20fila,\x20' + _0x1bd4bc + '\x20portas\x20livres'), _0x5044bc());
                }
            }, 0xea60), console['log']('👋\x20Bem-vindo,\x20' + _userNameConsole + '!'), console['log']('📱\x20WhatsApp\x20conectado\x20e\x20pronto\x20🔄'), console['log']('======================================='), _0x1ca1fd('🤖\x20Bot\x20conectando\x20ao\x20WhatsApp', 'info'), await _0x3a505d(), await _carregarTabelasGrupos(), await _0xbd0577(), await _0x324c35(), await _0x1b1f2e(), await _initGruposConcorrentes(), await _0x16d7ff(), await _0x19bdbc(_0x25f8ef), await _0x5e6cde(_0x25f8ef), await _sincronizarMembrosEstudantes(_0x25f8ef), global['botInitialized'] = !![], _0x1ca1fd('🟢\x20Bot\x20inicializado\x20com\x20sucesso', 'success'), _iniciarAgendadorMensagens(_0x25f8ef);

            // ══ RELATÓRIO AUTOMÁTICO DIÁRIO ÀS 22:00 CAT (UTC+2) ══════════════
            (function _iniciarAgendadorRelatorio() {
                function _msAte22hCAT() {
                    const agora = new Date();
                    // Converte para CAT (UTC+2)
                    const offsetCAT = 2 * 60 * 60 * 1000;
                    const agoraUTC = agora.getTime() + (agora.getTimezoneOffset() * 60 * 1000);
                    const agoraCAT = new Date(agoraUTC + offsetCAT);
                    const alvo = new Date(agoraCAT);
                    alvo.setHours(22, 0, 0, 0);
                    if (alvo <= agoraCAT) alvo.setDate(alvo.getDate() + 1);
                    return alvo.getTime() - agoraCAT.getTime();
                }

                async function _enviarRelatorio22h() {
                    try {
                        _0x1ca1fd('📊\x20[22:00 CAT] Enviando relatório automático diário...', 'info');
                        const sql = "SELECT COUNT(*) as total_pedidos, " +
                            "SUM(CASE WHEN status IN ('processada','finalizado','bloco_processado') THEN 1 ELSE 0 END) as pedidos_sucesso, " +
                            "SUM(CASE WHEN status IN ('processada','finalizado','bloco_processado') THEN quantidade ELSE 0 END) as mb_sucesso, " +
                            "SUM(CASE WHEN status IN ('processada','finalizado','bloco_processado') THEN valor ELSE 0 END) as receita_sucesso, " +
                            "SUM(CASE WHEN status IN ('processada','finalizado','bloco_processado') AND valor IS NOT NULL THEN quantidade ELSE 0 END) as mb_pagos, " +
                            "SUM(CASE WHEN status NOT IN ('processada','finalizado','bloco_processado') THEN 1 ELSE 0 END) as pedidos_pendentes, " +
                            "SUM(CASE WHEN status NOT IN ('processada','finalizado','bloco_processado') THEN valor ELSE 0 END) as valor_pendente " +
                            "FROM referencias WHERE created_at >= datetime('now','-24 hours','localtime')";
                        const rows = await _0x3c2652(sql);
                        const d = rows[0] || {};
                        const pedsSucesso = d.pedidos_sucesso || 0;
                        const mbTot = d.mb_sucesso || 0;
                        const recReal = d.receita_sucesso || 0;
                        const mbPagos = d.mb_pagos || 0;
                        const _gbTot = (mbTot / 1024).toFixed(2);
                        const _lucro = (recReal - (mbPagos * 20.5) / 1024).toFixed(2);
                        const agora = new Date();
                        const ontem = new Date(agora.getTime() - 86400000);
                        const fmt = dt => dt.toLocaleDateString('pt-PT') + ' ' + dt.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
                        const texto =
                            '📊 *RELATÓRIO DIÁRIO — 22:00* 🌙\n' +
                            '━━━━━━━━━━━━━━━━━━━━━━━━\n' +
                            '📅 Período: ' + fmt(ontem) + ' — ' + fmt(agora) + '\n\n' +
                            '🛍️ *Total de Vendas:* ' + pedsSucesso + '\n' +
                            '🌐 *Gigas Vendidos:* ' + _gbTot + ' GB\n' +
                            '━━━━━━━━━━━━━━━━━━━━━━━━\n' +
                            '💰 *Faturamento Total:* ' + recReal.toFixed(2) + ' MT\n' +
                            '💚 *Lucro Líquido Estimado:* ' + _lucro + ' MT\n' +
                            '━━━━━━━━━━━━━━━━━━━━━━━━\n' +
                            '🚀 *KaNet System* - Relatório Automático';

                        const c = global['client'];
                        if (c && typeof c['sendText'] === 'function') {
                            if (_0x23fc97) await c['sendText'](_0x23fc97, texto).catch(e => _0x1ca1fd('❌ Relatório admin erro: ' + e.message, 'error'));
                            if (_0x40b822) await c['sendText'](_0x40b822, texto).catch(e => _0x1ca1fd('❌ Relatório grupo erro: ' + e.message, 'error'));
                            _0x1ca1fd('✅ Relatório automático 22:00 enviado com sucesso!', 'success');
                        } else {
                            _0x1ca1fd('⚠️ Cliente WhatsApp indisponível — relatório automático não enviado', 'warning');
                        }
                    } catch (err) {
                        _0x1ca1fd('❌ Erro no relatório automático: ' + err.message, 'error');
                    }
                }

                const msParaPrimeiro = _msAte22hCAT();
                _0x1ca1fd('⏰ Relatório automático agendado em ' + Math.round(msParaPrimeiro / 60000) + ' minutos (22:00 CAT)', 'info');
                setTimeout(function _ciclo22h() {
                    _enviarRelatorio22h();
                    setInterval(_enviarRelatorio22h, 24 * 60 * 60 * 1000);
                }, msParaPrimeiro);
            })();
            // ══ FIM AGENDADOR ══════════════════════════════════════════════════

            // ══ BEM-VINDO KA-NET INFINITY ══════════════════════════════════════
            async function _enviarBoasVindas(_client, _participantJid, _groupJid) {
                try {
                    // Buscar o nome do novo membro
                    let _nome = 'novo membro';
                    try {
                        const _contact = await _client.getContact(_participantJid);
                        _nome = _contact?.pushname || _contact?.formattedName || 'novo membro';
                    } catch(e) {}

                    const _numero = _participantJid.split('@')[0].replace('258', '');

                    const { mpesa_num, emola_num } = _getPaymentDetails();
                    const { supportNum, supportName, sysName } = _getSupportDetails();

                    let _isFornecimentoGroup = false;
                    try {
                        const _fsF = require('fs');
                        const _pathF = require('path');
                        const _cfgPathF = _pathF.join(global._kanetBase || __dirname, 'local_config.json');
                        if (_fsF.existsSync(_cfgPathF)) {
                            const _cfgF = JSON.parse(_fsF.readFileSync(_cfgPathF, 'utf8'));
                            if (_cfgF.grupo_fornecimento && _groupJid === _cfgF.grupo_fornecimento.trim()) {
                                _isFornecimentoGroup = true;
                            }
                        }
                    } catch(e) {}

                    let _msgBoasVindas = '';

                    if (_isFornecimentoGroup) {
                        _msgBoasVindas =
                            `👋 *Bem-vindo(a) à ${sysName} • FORNECIMENTO, @${_numero}!* 🎉\n\n` +
                            `Olá, *${_nome}*! Grupo oficial de fornecimento de saldo e dados. ⚡\n\n` +
                            `🛍️ *Como Comprar:*\n` +
                            `1️⃣ Consulta tabela/saldo: *tabela* ou *saldo*\n` +
                            `2️⃣ Detalhes de pagamento: *pagamento*\n` +
                            `3️⃣ Envia o comprovativo + o número de destino na última linha\n` +
                            `   👉 Ex: _PP2602628.08272.3549 — 841234567_\n\n` +
                            `💬 *Comandos Básicos:* *tabela* | *saldo* | *pagamento*\n` +
                            `📞 Suporte: *${supportNum}* (${supportName})`;
                    } else {
                        _msgBoasVindas =
                            `👋 *Bem-vindo(a) à ${sysName}, @${_numero}!* 🎉\n\n` +
                            `Olá, *${_nome}*! Aqui tens pacotes rápidos e 100% automáticos. 🚀\n\n` +
                            `🛍️ *Como Comprar:*\n` +
                            `1️⃣ Consulta preços: *tabela*\n` +
                            `2️⃣ Detalhes de pagamento: *pagamento*\n` +
                            `3️⃣ Envia o comprovativo + o número de destino na última linha\n` +
                            `   👉 Ex: _PP2602628.08272.3549 — 841234567_\n\n` +
                            `💬 *Comandos Básicos:* *tabela* | *pagamento*\n` +
                            `📞 Suporte: *${supportNum}* (${supportName})`;
                    }

                    // Envia a mensagem com menção ao novo membro
                    await _client.sendTextWithMentions(_groupJid, _msgBoasVindas);
                    _0x1ca1fd('👋 Boas-vindas enviadas para ' + _participantJid + ' no grupo ' + _groupJid, 'success');
                } catch(e) {
                    _0x1ca1fd('❌ Erro ao enviar boas-vindas: ' + e.message, 'error');
                }
            }

            // Listener registado — boas-vindas disparadas no onMessage via tipo gp2
            _0x1ca1fd('👥 Sistema de boas-vindas Ka-Net Infinity pronto!', 'success');
            // ══ FIM BEM-VINDO ═══════════════════════════════════════════════════

            setInterval(() => {
                _0x4ef91a['length'] > _0x31ff38 && (_0xf94125('⚠️\x20ALERTA:\x20Fila\x20de\x20transferências\x20congestionada!\x20Tamanho\x20atual:\x20' + _0x4ef91a['length']), _0x1ca1fd('⚠️\x20Fila\x20congestionada:\x20tamanho=' + _0x4ef91a['length'], 'warning'));
            }, 0xea60);

            const tratarMensagem = async (clientInstance, _0x2368aa) => {
                const _0x25f8ef = clientInstance;
                if (!_0x2368aa) return;

                // Detectar se esta mensagem veio do WhatsApp de Fornecimento
                const _isMsgFornecimento = !!_0x2368aa._isFornecimento;

                // === CONTROLO DE LICENÇA SAAS ===
                const _senderLic = _0x2368aa['sender']?.['id'] || _0x2368aa['author'] || _0x2368aa['from'];

                const _msgTexto = _0x2368aa['body'] || _0x2368aa['caption'] || '';
                const _eComandoRenovar = _msgTexto.trim().startsWith('!renovar');

                if (!licencaValida) {
                    if (_eComandoRenovar) {
                        // Processar comando !renovar mesmo com licença expirada/bloqueada
                        await _processarComandoRenovar(_0x25f8ef, _0x2368aa, _msgTexto, _senderLic);
                        return;
                    }
                    
                    // Se não for comando renovar, ignorar ou avisar
                    if (!_0x2368aa['isGroupMsg']) {
                        const statusLic = global.licencaObj && global.licencaObj.licenca ? global.licencaObj.licenca.status : 'desconhecido';
                        let msgAviso = '⚠️ *SISTEMA SUSPENSO*\n━━━━━━━━━━━━━━━━━━━\nA licença deste bot de vendas está expirada ou inativa.\n\n';
                        if (statusLic === 'bloqueado') {
                            msgAviso += '⛔ O sistema foi bloqueado temporariamente pelo administrador.';
                        } else {
                            msgAviso += '⏰ A validade do serviço terminou. Para reativar, o proprietário deve efetuar o pagamento e enviar o comprovativo.';
                        }
                        msgAviso += '\n\n👉 Envie *!renovar [comprovativo]* para reativar o sistema.';
                        try { await _0x25f8ef.reply(_0x2368aa['from'], msgAviso, _0x2368aa['id']); } catch(e){}
                    }
                    return; // Bloqueia todo o resto do processamento!
                }
                
                if (_eComandoRenovar) {
                    await _processarComandoRenovar(_0x25f8ef, _0x2368aa, _msgTexto, _senderLic);
                    return;
                }
                // =================================
                
                // --- SILÊNCIO EM GRUPOS CONCORRENTES ---
                if (global['gruposConcorrentes'] && _0x2368aa.from && global['gruposConcorrentes'].has(_0x2368aa.from)) {
                    const _sJid = _0x2368aa['sender']?.['id'] || _0x2368aa['author'];
                    if (_sJid !== _0x16260a) return; // Ignora tudo se não for o dono
                }

                // --- BLOQUEIO GLOBAL DE BANIDOS ---
                const _senderJidBlock = _0x2368aa['sender']?.['id'] || _0x2368aa['author'];
                if (_senderJidBlock) {
                    const _pJidNorm = _senderJidBlock.includes('@') ? _senderJidBlock : _senderJidBlock + '@c.us';
                    if (global['numerosBanidos'] && global['numerosBanidos'].has(_pJidNorm)) {
                        if (!_0x2368aa['isGroupMsg']) {
                            const msgBan = '🚫 *ACESSO BLOQUEADO*\n━━━━━━━━━━━━━━━━━━━\nInfelizmente, ou por motivos de segurança, você não tem mais acesso aos serviços e programas da *Ka-Net*.\n\nSe acredita que isto é um erro, por favor, contacte a administração principal (856116039).';
                            try { await _0x461461(_0x25f8ef, _0x2368aa['from'], msgBan, _0x2368aa['id']); } catch(e){}
                        }
                        return; // Ignora a mensagem
                    }
                }

                // --- VERIFICAÇÃO DE BLOQUEIO GLOBAL DO SISTEMA (FECHAR SISTEMA) ---
                const _lockState = _kanet_sistemaBloqueado();
                if (_lockState) {
                    const _sJid = _0x2368aa['sender']?.['id'] || _0x2368aa['author'] || _0x2368aa['from'];
                    const _isOwner = _checkIsMaster(_sJid);
                    
                    if (!_isOwner) {
                        const _cleanJid = _0x2368aa['from'];
                        
                        // Ler o arquivo system_lock.json para ver se o JID já foi notificado/adicionado à fila
                        let _jaNotificado = false;
                        const _lockPath = require('path').join(__dirname, 'system_lock.json');
                        let _lockData = { locked: true, reason: '', pending_notifications: [] };
                        try {
                            if (_0x32d49c.existsSync(_lockPath)) {
                                _lockData = JSON.parse(_0x32d49c.readFileSync(_lockPath, 'utf8'));
                            }
                            if (_lockData.pending_notifications && _lockData.pending_notifications.includes(_cleanJid)) {
                                _jaNotificado = true;
                            }
                        } catch (e) {}

                        if (_jaNotificado) {
                            // Se já foi adicionado à lista durante este bloqueio, ignoramos silenciosamente para evitar spam
                            _0x1ca1fd('🔒 SISTEMA BLOQUEADO (SILENCIADO): Mensagem repetida de ' + _sJid + ' ignorada.', 'info');
                            return;
                        }

                        // Primeira interação: Envia a mensagem de aviso e adiciona na lista de notificações
                        _0x1ca1fd('🔒 SISTEMA BLOQUEADO: Bloqueando interação de ' + _sJid + ' no chat ' + _cleanJid, 'warning');
                        const _motivo = _lockState.reason || 'Manutenção programada. Por favor, tente mais tarde.';
                        const _msgBloqueio = '🔒 *SISTEMA EM MANUTENÇÃO* 🔒\n━━━━━━━━━━━━━━━━━━\n⚠️ Não foi possível concluir a sua ação.\n\n📢 *Motivo:* ' + _motivo + '\n━━━━━━━━━━━━━━━━━━\n✅ Assim que o sistema voltar ao normal, receberá uma notificação automática e poderá continuar a sua compra.\n\n🙏 *Pedimos desculpa pelo inconveniente!*\n━━━━━━━━━━━━━━━━━━\n⚡ *Ka-Net* — Sempre Conectado!';
                        
                        try {
                            await _0x461461(_0x25f8ef, _cleanJid, _msgBloqueio, _0x2368aa['id']);
                        } catch(e){}

                        // Adicionar o JID ao system_lock.json
                        try {
                            if (!_lockData.pending_notifications) {
                                _lockData.pending_notifications = [];
                            }
                            if (!_lockData.pending_notifications.includes(_cleanJid)) {
                                _lockData.pending_notifications.push(_cleanJid);
                                _0x32d49c.writeFileSync(_lockPath, JSON.stringify(_lockData, null, 2), 'utf8');
                                _0x1ca1fd('📝 JID ' + _cleanJid + ' adicionado à lista de notificações de desbloqueio.', 'info');
                            }
                        } catch (errLock) {
                            _0x1ca1fd('Erro ao adicionar JID para notificação: ' + errLock.message, 'error');
                        }
                        return; // Interrompe qualquer processamento adicional!
                    }
                }

                if (!await _0x33581b(_0x25f8ef, _0x2368aa)) return;

                // As boas vindas do grupo foram movidas para onGlobalParticipantsChanged
                // ───────────────────────────────────────────────────────────────
                // ───────────────────────────────────────────────────────────────
                
                // --- HOOKS KANET (DEFESA & MARKETING) ---
                try {
                    // Atualiza a última atividade do utilizador (útil para cancelar follow-ups)
                    if (!global['_kanetUserActivity']) global['_kanetUserActivity'] = {};
                    global['_kanetUserActivity'][_0x2368aa['from']] = Date.now();

                    if (await _verificarReclamacao(_0x25f8ef, _0x2368aa)) return;
                    await _verificarInfiltrado(_0x25f8ef, _0x2368aa);
                    if (await _processarComandosDefesa(_0x25f8ef, _0x2368aa)) return;
                    const _senderJid = _0x2368aa['sender']?.['id'] || _0x2368aa['author'];
                    if (_senderJid) {
                        await _registrarInteracao(_senderJid, _0x2368aa['sender']?.['pushname'] || 'Cliente');
                        if (_0x2368aa['from'].includes('@g.us')) await _registrarEntradaGrupo(_0x25f8ef, _senderJid, _0x2368aa['from']);
                    }
                } catch(e) { _0x1ca1fd('⚠️ Erro nos Hooks KaNet: ' + e.message, 'warning'); }
                // ----------------------------------------

                if (await _verificarInfracoes(_0x25f8ef, _0x2368aa)) return;

                // --- AUTO-RESPOSTA: RECLAMAÇÃO DE PACOTE NÃO RECEBIDO ---
                // Só dispara quando a mensagem indica que o cliente não recebeu o pacote/dados/recarga.
                // Ignora: dono/admin, e respeita cooldown de 5 minutos por remetente.
                try {
                    const _arSender = _0x2368aa['sender']?.['id'] || _0x2368aa['author'] || '';
                    const _arFrom   = _0x2368aa['from'] || '';
                    const _arIsOwner = _checkIsMaster(_arSender);
                    const _arIsBot = _arSender === _0x16260a;
                    const _arBody  = (_0x2368aa['body'] || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

                    // Palavras-chave que indicam que o cliente não recebeu o pacote
                    const _arKeywords = [
                        'nao recebi', 'nao chegou', 'nao recebo', 'nao foi recebido',
                        'nao recebeu', 'nao recebendo', 'nao esta recebendo',
                        'cade meu', 'cadê meu', 'onde esta meu', 'onde esta o meu',
                        'nao ativou', 'nao ativei', 'nao funciona', 'nao funcionou',
                        'pacote nao', 'dados nao', 'recarga nao', 'internet nao',
                        'nao tenho internet', 'sem internet', 'sem dados', 'sem saldo',
                        'nao recebi o pacote', 'nao chegou o pacote', 'nao chegou nada',
                        'ainda nao recebi', 'ainda nao chegou', 'ainda espero',
                        'por que nao', 'porque nao', 'pq nao', 'pq nao recebi',
                        'quero reembolso', 'devolva', 'cadê', 'cade',
                        'ainda', 'desde', 'essa demora'
                    ];

                    const _arMatch = !_arIsOwner && !_arIsBot && _arBody &&
                        _arKeywords.some(kw => _arBody.includes(kw));

                    if (_arMatch) {
                        if (!global['_reclamacaoSuporte']) global['_reclamacaoSuporte'] = {};
                        const _arAgora = Date.now();
                        const _arUlt   = global['_reclamacaoSuporte'][_arSender] || 0;
                        if (_arAgora - _arUlt > 300000) { // 5 minutos de cooldown por remetente
                            global['_reclamacaoSuporte'][_arSender] = _arAgora;
                            const _arMsg =
                                '⚠️ *PROBLEMA COM O SEU PACOTE?* 📦\n' +
                                '━━━━━━━━━━━━━━━━━━━━━━━━\n' +
                                '😔 Lamentamos que não tenha recebido o seu pacote.\n\n' +
                                '📞 *Contacte imediatamente o suporte para resolução:*\n' +
                                '👤 *Número:* ' + _getSupportDetails().supportNum + '\n\n' +
                                '━━━━━━━━━━━━━━━━━━━━━━━━\n' +
                                '⚡ A nossa equipa irá resolver o seu caso com urgência.';
                            try { await _0x461461(_0x25f8ef, _arFrom, _arMsg, _0x2368aa['id']); } catch(e){}
                            _0x1ca1fd('📦 Auto-reply reclamação enviado para: ' + _arSender, 'info');
                        }
                    }
                } catch(_arErr) { _0x1ca1fd('⚠️ Erro no auto-reply reclamação: ' + _arErr.message, 'warning'); }
                // -----------------------------------------------
                let _0x37fcf7 = _0x2368aa['from'],
                    _0x457c95 = _0x2368aa['sender']?.['id'] || _0x2368aa['author'],
                    _0x519db1 = _0x2368aa['body'] ? _0x2368aa['body']['trim']().replace(/^([.!])\s+/, '$1') : '',
                    _0x316b84 = _0x519db1['toLowerCase'](),
                    _0x3e4b35 = _0x2368aa['type'] === 'image' || _0x2368aa['mimetype']?.['startsWith']('image/'),
                    _0x8d3c1f = _0x2368aa['type'] === 'sticker' || _0x2368aa['mimetype']?.['includes']('webp'),
                    _0x4bcfc3 = (_0x2368aa['type'] === 'image' || _0x2368aa['mimetype']?.['startsWith']('image/')) && !_0x2368aa['isViewOnce'],
                    _0x466fc9 = _0x2368aa['type'] === 'sticker',
                    _0x4ca602 = _0x2368aa['type'] === 'audio',
                    _0xfb871b = _0x2368aa['body'] && /^[\p{Emoji}\s]+$/u['test'](_0x2368aa['body']) && _0x2368aa['body']['trim']()['length'] > 0x0;
                if (_0x4bcfc3 && !_0x466fc9) {
                    // Tentar processar via OCR em vez de apenas pedir texto
                    const _textoExtraido = await _processarImagemOCR(_0x25f8ef, _0x2368aa);
                    if (_textoExtraido) {
                        _0x1ca1fd('📄 Texto extraído da imagem: ' + _textoExtraido.substring(0, 50) + '...', 'info');
                        _0x2368aa['body'] = _textoExtraido; _0x519db1 = _textoExtraido; _0x316b84 = _textoExtraido.toLowerCase();
                    } else {
                        _0x1ca1fd('📸 Imagem recebida de ' + _0x457c95 + ' - OCR falhou ou não instalada', 'info');
                        const _0x5f1778 = '📤 *ENVIE EM FORMATO DE TEXTO OU IMAGEM NÍTIDA.*\n━━━━━━━━━━━━━━━━━━━━━━━━\nEX: ID da transacao PP2602628.08272.3549. Transferiste 17.00MT...\n\n' + _getSupportDetails().supportNum + '\n━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ *Detectamos sua imagem, mas não conseguimos ler o texto automaticamente.*';
                        await _0x461461(_0x25f8ef, _0x37fcf7, _0x5f1778, _0x2368aa['id']);
                        return;
                    }
                }
                if (_0x4ca602) {
                    _0x1ca1fd('🎵\x20Ignorando\x20áudio\x20de\x20' + _0x457c95, 'info');
                    return;
                }
                if (_0x466fc9) {
                    _0x1ca1fd('🎨\x20Ignorando\x20sticker\x20de\x20' + _0x457c95, 'info');
                    return;
                }

                function _0x4aa5a4(_0x3c9c4b) {
                    if (!_0x3c9c4b || typeof _0x3c9c4b !== 'string') return ![];
                    const _0x52ddda = _0x3c9c4b['trim']();
                    if (_0x52ddda['length'] === 0x0) return ![];
                    const _0x5d3b02 = _0x52ddda['replace'](/[\s\-()+]/g, '');
                    if (/^\d+$/['test'](_0x5d3b02)) return ![];
                    if (/[a-zA-Z0-9]/['test'](_0x52ddda)) return ![];
                    if (/[%@#$&*?=<>]/['test'](_0x52ddda)) return ![];
                    const _0x189260 = [/\p{Emoji}/u, /[\u{1F600}-\u{1F64F}]/u, /[\u{1F300}-\u{1F5FF}]/u, /[\u{1F680}-\u{1F6FF}]/u, /[\u{2600}-\u{26FF}]/u, /[\u{2700}-\u{27BF}]/u];
                    for (let _0x47e944 of _0x52ddda) {
                        let _0x420480 = ![];
                        for (let _0x3f22bb of _0x189260) {
                            if (_0x3f22bb['test'](_0x47e944)) {
                                _0x420480 = !![];
                                break;
                            }
                        }
                        if (!_0x420480) return ![];
                    }
                    return !![];
                }
                if (_0x4aa5a4(_0x2368aa['body'])) {
                    _0x1ca1fd('😀\x20Ignorando\x20EMOJI\x20PURO\x20de\x20' + _0x457c95 + ':\x20\x22' + _0x2368aa['body'] + '\x22', 'info');
                    return;
                }
                if (!_0x519db1 || _0x519db1['length'] < 0x2) {
                    _0x1ca1fd('📭\x20Mensagem\x20ignorada\x20(vazia\x20ou\x20muito\x20curta)', 'info');
                    return;
                }
                _0x1ca1fd('📝\x20Mensagem\x20recebida:\x20' + _0x519db1['substring'](0x0, 0x32) + (_0x519db1['length'] > 0x32 ? '...' : ''), 'info');
                if (_0x316b84 === '.idgrupo' || _0x316b84 === '!idgrupo' || _0x316b84 === '.id' || _0x316b84 === '.jid') {
                    await _0x461461(_0x25f8ef, _0x37fcf7, '🆔 *𝗜𝗗 𝗗𝗘𝗦𝗧𝗘 𝗚𝗥𝗨𝗣𝗢*\n━━━━━━━━━━━━━━━━━━━\n\n*JID:* ' + _0x37fcf7 + '\n\n━━━━━━━━━━━━━━━━━━━\n🚀 *KaNet 2.0 • Segurança*', _0x2368aa['id']);
                    return;
                }

                // --- COMANDOS DE CONFIGURAÇÃO DE GRUPOS VIA WHATSAPP (MASTER) ---
                if (['.setnotificacoes', '!setnotificacoes', '.notificacoes', '.setnotif'].includes(_0x316b84)) {
                    if (!_checkIsMaster(_0x457c95)) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '🔒 *ACESSO NEGADO:* Apenas o número Master pode configurar os grupos.', _0x2368aa['id']);
                        return;
                    }
                    if (!_0x37fcf7.includes('@g.us')) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '⚠️ Execute este comando **dentro do grupo** que deseja definir como Grupo de Notificações.', _0x2368aa['id']);
                        return;
                    }
                    const _fs = require('fs'), _p = require('path');
                    const _lcFile = _p.join(global._kanetBase || __dirname, 'local_config.json');
                    const _cfgFile = _p.join(global._kanetBase || __dirname, 'bot_config.js');
                    let _lcObj = {};
                    try { if (_fs.existsSync(_lcFile)) _lcObj = JSON.parse(_fs.readFileSync(_lcFile, 'utf8')); } catch(e){}

                    const _key = _isMsgFornecimento ? 'grupo_notificacoes_fornecimento' : 'grupo_notificacoes';
                    _lcObj[_key] = _0x37fcf7;
                    _fs.writeFileSync(_lcFile, JSON.stringify(_lcObj, null, 2), 'utf8');

                    // local_config.json já foi salvo — bot_config.js não é reescrito para evitar corrupção

                    const _ctxNome = _isMsgFornecimento ? 'Fornecimento' : 'Normal / Revendedor';
                    await _0x461461(_0x25f8ef, _0x37fcf7, `🔔 *GRUPO DE NOTIFICAÇÕES DEFINIDO!*\n━━━━━━━━━━━━━━━━━━━\n\n📌 *Sistema:* ${_ctxNome}\n🆔 *JID:* ${_0x37fcf7}\n\n✅ Todas as notificações de vendas serão enviadas para este grupo!`, _0x2368aa['id']);
                    return;
                }

                if (['.seterros', '!seterros', '.erros', '.seterro'].includes(_0x316b84)) {
                    if (!_checkIsMaster(_0x457c95)) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '🔒 *ACESSO NEGADO:* Apenas o número Master pode configurar os grupos.', _0x2368aa['id']);
                        return;
                    }
                    if (!_0x37fcf7.includes('@g.us')) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '⚠️ Execute este comando **dentro do grupo** que deseja definir como Grupo de Erros.', _0x2368aa['id']);
                        return;
                    }
                    const _fs = require('fs'), _p = require('path');
                    const _lcFile = _p.join(global._kanetBase || __dirname, 'local_config.json');
                    const _cfgFile = _p.join(global._kanetBase || __dirname, 'bot_config.js');
                    let _lcObj = {};
                    try { if (_fs.existsSync(_lcFile)) _lcObj = JSON.parse(_fs.readFileSync(_lcFile, 'utf8')); } catch(e){}

                    const _key = _isMsgFornecimento ? 'grupo_erros_fornecimento' : 'grupo_erros';
                    _lcObj[_key] = _0x37fcf7;
                    _fs.writeFileSync(_lcFile, JSON.stringify(_lcObj, null, 2), 'utf8');

                    // local_config.json já foi salvo — bot_config.js não é reescrito para evitar corrupção

                    const _ctxNome = _isMsgFornecimento ? 'Fornecimento' : 'Normal / Revendedor';
                    await _0x461461(_0x25f8ef, _0x37fcf7, `🚨 *GRUPO DE ERROS DEFINIDO!*\n━━━━━━━━━━━━━━━━━━━\n\n📌 *Sistema:* ${_ctxNome}\n🆔 *JID:* ${_0x37fcf7}\n\n✅ Todos os erros de sistema serão enviados para este grupo!`, _0x2368aa['id']);
                    return;
                }

                if (['.setfornecimento', '!setfornecimento', '.fornecimento'].includes(_0x316b84)) {
                    if (!_checkIsMaster(_0x457c95)) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '🔒 *ACESSO NEGADO:* Apenas o número Master pode configurar o Grupo de Fornecimento.', _0x2368aa['id']);
                        return;
                    }
                    if (!_0x37fcf7.includes('@g.us')) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '⚠️ Execute este comando **dentro do grupo** que deseja definir como Grupo Principal de Fornecimento.', _0x2368aa['id']);
                        return;
                    }
                    const _fs = require('fs'), _p = require('path');
                    const _lcFile = _p.join(global._kanetBase || __dirname, 'local_config.json');
                    const _cfgFile = _p.join(global._kanetBase || __dirname, 'bot_config.js');
                    let _lcObj = {};
                    try { if (_fs.existsSync(_lcFile)) _lcObj = JSON.parse(_fs.readFileSync(_lcFile, 'utf8')); } catch(e){}

                    _lcObj['grupo_fornecimento'] = _0x37fcf7;
                    _fs.writeFileSync(_lcFile, JSON.stringify(_lcObj, null, 2), 'utf8');
                    // local_config.json já foi salvo — bot_config.js não é reescrito para evitar corrupção

                    await _0x461461(_0x25f8ef, _0x37fcf7, `📦 *GRUPO PRINCIPAL DE FORNECIMENTO DEFINIDO!*\n━━━━━━━━━━━━━━━━━━━\n\n🆔 *JID:* ${_0x37fcf7}\n\n✅ Este grupo é agora o grupo oficial de Fornecimento!`, _0x2368aa['id']);
                    return;
                }

                if (['.meusgrupos', '!meusgrupos', '.statusgrupos'].includes(_0x316b84)) {
                    const _fs = require('fs'), _p = require('path');
                    const _lcFile = _p.join(global._kanetBase || __dirname, 'local_config.json');
                    let _c = {};
                    try { if (_fs.existsSync(_lcFile)) _c = JSON.parse(_fs.readFileSync(_lcFile, 'utf8')); } catch(e){}

                    let _txt = `📊 *CONFIGURAÇÃO ATUAL DOS GRUPOS*\n━━━━━━━━━━━━━━━━━━━\n\n`;
                    _txt += `🟢 *SISTEMA NORMAL:*\n`;
                    _txt += `• Notificações: ${_c.grupo_notificacoes || _0x40b822 || 'Não configurado'}\n`;
                    _txt += `• Erros: ${_c.grupo_erros || _0x57353c || 'Não configurado'}\n\n`;
                    _txt += `📦 *SISTEMA DE FORNECIMENTO:*\n`;
                    _txt += `• Grupo Principal: ${_c.grupo_fornecimento || 'Não configurado'}\n`;
                    _txt += `• Notificações: ${_c.grupo_notificacoes_fornecimento || 'Não configurado'}\n`;
                    _txt += `• Erros: ${_c.grupo_erros_fornecimento || 'Não configurado'}\n\n`;
                    _txt += `💡 *Comandos para configurar no WhatsApp:*\n`;
                    _txt += `• \`.setnotificacoes\` — Define o grupo atual como Notificações\n`;
                    _txt += `• \`.seterros\` — Define o grupo atual como Erros\n`;
                    _txt += `• \`.setfornecimento\` — Define o grupo atual como Fornecimento`;

                    await _0x461461(_0x25f8ef, _0x37fcf7, _txt, _0x2368aa['id']);
                    return;
                }

                if (_0x316b84 === '.autorizar' || _0x316b84 === '!autorizar' || _0x316b84 === '.addgrupo' || _0x316b84 === '!addgrupo' || _0x316b84 === '.autorizargrupo' || _0x316b84 === '!autorizargrupo') {
                    const _isSaasAdmin = (_s) => {
                        if (!_s) return false;
                        const clean = String(_s).replace(/\D/g, '');
                        return clean.includes('856116039') || clean.includes('850401416') || clean.includes('856268811');
                    };
                    const _isMaster = _checkIsMaster(_0x457c95) || _isSaasAdmin(_0x457c95);
                    const _isOwner = _0x457c95 === _0x16260a;
                    
                    if (!_isMaster && !_isOwner) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '🔒 *𝗔𝗖𝗘𝗦𝗦𝗢 𝗡𝗘𝗚𝗔𝗗𝗢*\n━━━━━━━━━━━━━━━━━━━\nApenas o proprietário do bot pode pedir autorização de grupos.', _0x2368aa['id']);
                        return;
                    }
                    
                    if (_0x18020a.includes(_0x37fcf7)) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '⚠️ *𝗔𝗩𝗜𝗦𝗢*\n━━━━━━━━━━━━━━━━━━━\nEste grupo já se encontra na lista de autorizados.', _0x2368aa['id']);
                        return;
                    }
                    
                    // --- VERIFICAR LIMITE DE GRUPOS DA LICENÇA ---
                    const _limites = global.licencaObj && global.licencaObj.getLimites ? global.licencaObj.getLimites() : { grupos_max: 9999 };
                    const _gruposActuais = _0x18020a.filter(g => !_isGrupoSistema(g)).length;
                    if (_gruposActuais >= _limites.grupos_max) {
                        const _pacoteNome = _limites.pacote || 'basico';
                        await _0x461461(_0x25f8ef, _0x37fcf7, '⛔ *𝗟𝗜𝗠𝗜𝗧𝗘 𝗗𝗘 𝗚𝗥𝗨𝗣𝗢𝗦 𝗔𝗧𝗜𝗡𝗚𝗜𝗗𝗢*\n━━━━━━━━━━━━━━━━━━━\n📦 O seu pacote *' + _pacoteNome.toUpperCase() + '* permite no máximo *' + _limites.grupos_max + '* grupo(s).\n\n📊 Grupos activos: *' + _gruposActuais + '/' + _limites.grupos_max + '*\n\n💡 Para adicionar mais grupos, faça upgrade do seu pacote.\n━━━━━━━━━━━━━━━━━━━\n⚡ *KaNet 2.0 • Licenciamento*', _0x2368aa['id']);
                        return;
                    }
                    
                    // --- MASTER: AUTORIZAÇÃO DIRECTA ---
                    if (_isMaster) {
                        _0x18020a.push(_0x37fcf7);
                        _salvarGrupos();
                        if (global['_gruposNaoAutorizadosNotificados']) global['_gruposNaoAutorizadosNotificados'].delete(_0x37fcf7);
                        await _0x461461(_0x25f8ef, _0x37fcf7, '✅ *𝗚𝗥𝗨𝗣𝗢 𝗔𝗨𝗧𝗢𝗥𝗜𝗭𝗔𝗗𝗢*\n━━━━━━━━━━━━━━━━━━━\nEste grupo foi adicionado à lista de confiança!\n\n🆔 *ID:* ' + _0x37fcf7 + '\n📊 *Grupos:* ' + _0x18020a.length + '/' + (_limites.grupos_max >= 9999 ? '∞' : _limites.grupos_max) + '\n💾 *Autorização salva* — será mantida após reinício.', _0x2368aa['id']);
                        return;
                    }
                    
                    // --- REVENDEDOR: ENVIAR PEDIDO AO ADMIN ---
                    try {
                        // Guardar pedido pendente em ficheiro local
                        const _pedidosFile = require('path').join(__dirname, 'pedidos_grupo.json');
                        let _pedidos = [];
                        try { if (fs.existsSync(_pedidosFile)) _pedidos = JSON.parse(fs.readFileSync(_pedidosFile, 'utf8')); } catch(_e) { _pedidos = []; }
                        
                        // Verificar se já existe pedido pendente para este grupo
                        const _jaTemPedido = _pedidos.some(p => p.grupo_jid === _0x37fcf7 && p.status === 'pendente');
                        if (_jaTemPedido) {
                            await _0x461461(_0x25f8ef, _0x37fcf7, '⏳ *𝗣𝗘𝗗𝗜𝗗𝗢 𝗝𝗔́ 𝗘𝗡𝗩𝗜𝗔𝗗𝗢*\n━━━━━━━━━━━━━━━━━━━\nJá existe um pedido de autorização pendente para este grupo.\n\nAguarde a aprovação do administrador.', _0x2368aa['id']);
                            return;
                        }
                        
                        // Obter nome do grupo
                        let _nomeGrupo = 'Grupo Desconhecido';
                        try {
                            const _chatInfo = await _0x25f8ef.getChatById(_0x37fcf7);
                            _nomeGrupo = _chatInfo?.name || _chatInfo?.contact?.name || 'Grupo';
                        } catch(_e) {}
                        
                        const _nomeVendedor = global.licencaObj?.licenca?.nome_vendedor || 'Revendedor';
                        const _pacoteVendedor = global.licencaObj?.licenca?.pacote || 'basico';
                        
                        const _vendedorId = global.licencaObj?.licenca?.vendedor_id || global.licencaObj?.licencaDocId || _0x457c95;
                        const _pedidoObj = {
                            grupo_id: _0x37fcf7,
                            grupo_jid: _0x37fcf7,
                            grupo_nome: _nomeGrupo,
                            vendedor_id: _vendedorId,
                            vendedor_jid: _0x457c95,
                            vendedor_nome: _nomeVendedor,
                            pacote: _pacoteVendedor,
                            status: 'pendente',
                            data_pedido: new Date().toISOString()
                        };
                        _pedidos.push(_pedidoObj);
                        try { fs.writeFileSync(_pedidosFile, JSON.stringify(_pedidos, null, 2), 'utf8'); } catch(_e) {}
                        
                        // Enviar pedido ao Firebase (se disponível)
                        try {
                            const _db = global.licencaObj?.db;
                            if (_db) {
                                const { collection, addDoc } = require('firebase/firestore');
                                await addDoc(collection(_db, 'pedidos_grupo'), _pedidoObj);
                            }
                        } catch(_fbErr) { _0x1ca1fd('⚠️ Erro ao enviar pedido ao Firebase: ' + _fbErr.message, 'warning'); }
                        
                        // Notificar ADMIN via WhatsApp (PV)
                        const _masterNumClean = _getSupportDetails().supportNum.replace(/\D/g, '');
                        const _adminJid = (_masterNumClean.startsWith('258') ? _masterNumClean : '258' + _masterNumClean) + '@c.us';
                        const _msgAdmin = '📨 *𝗡𝗢𝗩𝗢 𝗣𝗘𝗗𝗜𝗗𝗢 𝗗𝗘 𝗚𝗥𝗨𝗣𝗢* 📨\n━━━━━━━━━━━━━━━━━━━\n\n👤 *Revendedor:* ' + _nomeVendedor + '\n📦 *Pacote:* ' + _pacoteVendedor.toUpperCase() + '\n📊 *Grupos actuais:* ' + _gruposActuais + '/' + (_limites.grupos_max >= 9999 ? '∞' : _limites.grupos_max) + '\n\n🏷️ *Grupo:* ' + _nomeGrupo + '\n🆔 *JID:* ' + _0x37fcf7 + '\n\n━━━━━━━━━━━━━━━━━━━\n✅ Para aprovar, responda:\n*.aprovar ' + _0x37fcf7 + '*\n\n❌ Para rejeitar:\n*.rejeitar ' + _0x37fcf7 + '*\n━━━━━━━━━━━━━━━━━━━';
                        try { await _0x25f8ef.sendText(_adminJid, _msgAdmin); } catch(_e) { _0x1ca1fd('⚠️ Não conseguiu enviar notificação ao admin: ' + _e.message, 'warning'); }
                        
                        // Confirmar ao revendedor
                        await _0x461461(_0x25f8ef, _0x37fcf7, '📨 *𝗣𝗘𝗗𝗜𝗗𝗢 𝗘𝗡𝗩𝗜𝗔𝗗𝗢*\n━━━━━━━━━━━━━━━━━━━\nO pedido de autorização deste grupo foi enviado ao administrador!\n\n🏷️ *Grupo:* ' + _nomeGrupo + '\n⏳ *Status:* Aguardando aprovação\n\nSerá notificado assim que o grupo for aprovado.', _0x2368aa['id']);
                        _0x1ca1fd('📨 Pedido de grupo enviado: ' + _nomeGrupo + ' (' + _0x37fcf7 + ') por ' + _nomeVendedor, 'info');
                        
                    } catch(_pedErr) {
                        _0x1ca1fd('❌ Erro ao processar pedido de grupo: ' + _pedErr.message, 'error');
                        await _0x461461(_0x25f8ef, _0x37fcf7, '❌ *ERRO*\n━━━━━━━━━━━━━━━━━━━\nOcorreu um erro ao enviar o pedido. Tente novamente.', _0x2368aa['id']);
                    }
                    return;
                }
                
                // --- .APROVAR / .REJEITAR (ADMIN - funciona no PV ou em grupo) ---
                if (_0x316b84.startsWith('.aprovar ') || _0x316b84.startsWith('!aprovar ')) {
                    const _isSaasAdmin = (_s) => {
                        if (!_s) return false;
                        const clean = String(_s).replace(/\D/g, '');
                        return clean.includes('856116039') || clean.includes('850401416') || clean.includes('856268811');
                    };
                    // Em PV, sender?.id pode ser undefined — usar from como fallback
                    const _senderAprovar = _0x457c95 || _0x37fcf7 || _0x2368aa['from'] || '';
                    if (!_checkIsMaster(_senderAprovar) && !_isSaasAdmin(_senderAprovar)) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '🔒 *𝗔𝗖𝗘𝗦𝗦𝗢 𝗡𝗘𝗚𝗔𝗗𝗢*\n━━━━━━━━━━━━━━━━━━━\nApenas o administrador master pode aprovar grupos.', _0x2368aa['id']);
                        return;
                    }
                    const _grupoJid = _0x519db1.split(' ').slice(1).join(' ').trim();
                    if (!_grupoJid || !_grupoJid.includes('@g.us')) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '⚠️ *USO:* .aprovar [JID do grupo]\n\nExemplo: .aprovar 120363402302455817@g.us', _0x2368aa['id']);
                        return;
                    }
                    if (_0x18020a.includes(_grupoJid)) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '⚠️ Este grupo já está autorizado.', _0x2368aa['id']);
                        return;
                    }
                    _0x18020a.push(_grupoJid);
                    _salvarGrupos();
                    if (global['_gruposNaoAutorizadosNotificados']) global['_gruposNaoAutorizadosNotificados'].delete(_grupoJid);
                    
                    // Actualizar pedido pendente
                    const _pedidosFile2 = require('path').join(__dirname, 'pedidos_grupo.json');
                    try {
                        let _peds = [];
                        if (fs.existsSync(_pedidosFile2)) _peds = JSON.parse(fs.readFileSync(_pedidosFile2, 'utf8'));
                        const _pedIdx = _peds.findIndex(p => p.grupo_jid === _grupoJid && p.status === 'pendente');
                        if (_pedIdx > -1) {
                            _peds[_pedIdx].status = 'aprovado';
                            _peds[_pedIdx].aprovado_em = new Date().toISOString();
                            _peds[_pedIdx].aprovado_por = _0x457c95;
                            fs.writeFileSync(_pedidosFile2, JSON.stringify(_peds, null, 2), 'utf8');
                        }
                    } catch(_e) {}
                    
                    // Notificar o grupo aprovado
                    const _limAprov = global.licencaObj && global.licencaObj.getLimites ? global.licencaObj.getLimites() : { grupos_max: 9999 };
                    try {
                        await _0x25f8ef.sendText(_grupoJid, '✅ *𝗚𝗥𝗨𝗣𝗢 𝗔𝗣𝗥𝗢𝗩𝗔𝗗𝗢!* ✅\n━━━━━━━━━━━━━━━━━━━\nEste grupo foi autorizado pelo administrador!\n\n📊 *Grupos:* ' + _0x18020a.length + '/' + (_limAprov.grupos_max >= 9999 ? '∞' : _limAprov.grupos_max) + '\n\nO bot está agora activo neste grupo. 🚀');
                    } catch(_e) {}
                    
                    await _0x461461(_0x25f8ef, _0x37fcf7, '✅ *𝗚𝗥𝗨𝗣𝗢 𝗔𝗣𝗥𝗢𝗩𝗔𝗗𝗢*\n━━━━━━━━━━━━━━━━━━━\n🆔 *JID:* ' + _grupoJid + '\n📊 *Total grupos:* ' + _0x18020a.length + '/' + (_limAprov.grupos_max >= 9999 ? '∞' : _limAprov.grupos_max) + '\n💾 Autorização salva.', _0x2368aa['id']);
                    _0x1ca1fd('✅ Grupo aprovado pelo admin: ' + _grupoJid, 'info');
                    return;
                }
                
                if (_0x316b84.startsWith('.rejeitar ') || _0x316b84.startsWith('!rejeitar ')) {
                    const _isSaasAdmin = (_s) => {
                        if (!_s) return false;
                        const clean = String(_s).replace(/\D/g, '');
                        return clean.includes('856116039') || clean.includes('850401416') || clean.includes('856268811');
                    };
                    if (!_checkIsMaster(_0x457c95) && !_isSaasAdmin(_0x457c95)) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '🔒 *𝗔𝗖𝗘𝗦𝗦𝗢 𝗡𝗘𝗚𝗔𝗗𝗢*\n━━━━━━━━━━━━━━━━━━━\nApenas o administrador master pode rejeitar grupos.', _0x2368aa['id']);
                        return;
                    }
                    const _grupoJidRej = _0x519db1.split(' ').slice(1).join(' ').trim();
                    if (!_grupoJidRej || !_grupoJidRej.includes('@g.us')) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '⚠️ *USO:* .rejeitar [JID do grupo]\n\nExemplo: .rejeitar 120363402302455817@g.us', _0x2368aa['id']);
                        return;
                    }
                    
                    // Actualizar pedido para rejeitado
                    const _pedidosFile3 = require('path').join(__dirname, 'pedidos_grupo.json');
                    try {
                        let _peds = [];
                        if (fs.existsSync(_pedidosFile3)) _peds = JSON.parse(fs.readFileSync(_pedidosFile3, 'utf8'));
                        const _pedIdx = _peds.findIndex(p => p.grupo_jid === _grupoJidRej && p.status === 'pendente');
                        if (_pedIdx > -1) {
                            _peds[_pedIdx].status = 'rejeitado';
                            _peds[_pedIdx].rejeitado_em = new Date().toISOString();
                            _peds[_pedIdx].rejeitado_por = _0x457c95;
                            fs.writeFileSync(_pedidosFile3, JSON.stringify(_peds, null, 2), 'utf8');
                        }
                    } catch(_e) {}
                    
                    // Notificar o grupo rejeitado
                    try {
                        await _0x25f8ef.sendText(_grupoJidRej, '❌ *𝗣𝗘𝗗𝗜𝗗𝗢 𝗥𝗘𝗝𝗘𝗜𝗧𝗔𝗗𝗢*\n━━━━━━━━━━━━━━━━━━━\nO pedido de autorização deste grupo foi rejeitado pelo administrador.\n\nContacte o suporte para mais informações.');
                    } catch(_e) {}
                    
                    await _0x461461(_0x25f8ef, _0x37fcf7, '❌ *𝗚𝗥𝗨𝗣𝗢 𝗥𝗘𝗝𝗘𝗜𝗧𝗔𝗗𝗢*\n━━━━━━━━━━━━━━━━━━━\n🆔 *JID:* ' + _grupoJidRej + '\n💾 O pedido foi marcado como rejeitado.', _0x2368aa['id']);
                    _0x1ca1fd('❌ Grupo rejeitado pelo admin: ' + _grupoJidRej, 'info');
                    return;
                }

                if (_0x316b84 === '.desautorizar' || _0x316b84 === '!desautorizar' || _0x316b84 === '.removergrupo' || _0x316b84 === '!removergrupo' || _0x316b84 === '.desautorizargrupo' || _0x316b84 === '!desautorizargrupo') {
                    const _isSaasAdmin = (_s) => {
                        if (!_s) return false;
                        const clean = String(_s).replace(/\D/g, '');
                        return clean.includes('856116039') || clean.includes('850401416') || clean.includes('856268811');
                    };
                    if (!_checkIsMaster(_0x457c95) && !_isSaasAdmin(_0x457c95) && _0x457c95 !== _0x16260a) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '🔒 *𝗔𝗖𝗘𝗦𝗦𝗢 𝗡𝗘𝗚𝗔𝗗𝗢*\n━━━━━━━━━━━━━━━━━━━\nApenas o administrador master pode remover grupos.', _0x2368aa['id']);
                        return;
                    }
                    if (_GRUPOS_FIXOS.includes(_0x37fcf7)) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '🔒 *𝗣𝗥𝗢𝗧𝗘𝗖̧𝗔̃𝗢*\n━━━━━━━━━━━━━━━━━━━\nEste grupo é fixo e não pode ser removido via comando.', _0x2368aa['id']);
                        return;
                    }
                    const _index = _0x18020a.indexOf(_0x37fcf7);
                    if (_index > -1) {
                        _0x18020a.splice(_index, 1);
                        _salvarGrupos();
                        await _0x461461(_0x25f8ef, _0x37fcf7, '🗑️ *𝗚𝗥𝗨𝗣𝗢 𝗥𝗘𝗠𝗢𝗩𝗜𝗗𝗢*\n━━━━━━━━━━━━━━━━━━━\nEste grupo foi removido da lista de autorizados.\n💾 *Alteração salva.*', _0x2368aa['id']);
                    } else {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '⚠️ *𝗔𝗩𝗜𝗦𝗢*\n━━━━━━━━━━━━━━━━━━━\nEste grupo não está na lista de autorizados.', _0x2368aa['id']);
                    }
                    return;
                }

                // --- COMANDOS DE CONFIGURAÇÃO DE TABELA DE PREÇOS POR GRUPO ---
                if (_0x316b84.startsWith('.settabela') || _0x316b84.startsWith('!settabela')) {
                    if (!_0x2368aa['isGroupMsg']) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '⚠️ *𝗔𝗩𝗜𝗦𝗢*\n━━━━━━━━━━━━━━━━━━━\nEste comando só pode ser utilizado dentro de um grupo.', _0x2368aa['id']);
                        return;
                    }
                    const _senderJid = (_0x457c95 || '').includes('@c.us') ? _0x457c95 : (_0x457c95 || '') + '@c.us';
                    if (!_checkIsMaster(_senderJid) && _senderJid !== _0x16260a) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '🚫 *𝗔𝗖𝗘𝗦𝗦𝗢 𝗡𝗘𝗚𝗔𝗗𝗢*\n━━━━━━━━━━━━━━━━━━━\nEste comando é restrito ao Desenvolvedor Master.', _0x2368aa['id']);
                        return;
                    }

                    const args = _0x519db1.substring(_0x316b84.startsWith('.settabela') ? 10 : 11).trim();
                    if (!args) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '⚠️ *USO INCORRETO*\n━━━━━━━━━━━━━━━━━━\nUse: `.settabela PRECO:MB,PRECO:MB,...`\nExemplo: `.settabela 10:350,14:550,25:1024`', _0x2368aa['id']);
                        return;
                    }
                    const pairs = args.split(',');
                    const parsedPairs = [];
                    for (const pair of pairs) {
                        const parts = pair.split(':');
                        if (parts.length !== 2) {
                            await _0x461461(_0x25f8ef, _0x37fcf7, '⚠️ *FORMATO INVÁLIDO*\n━━━━━━━━━━━━━━━━━━\nCada par deve ser no formato `PRECO:MB` (ex: `10:350`).', _0x2368aa['id']);
                            return;
                        }
                        const price = parseInt(parts[0].trim());
                        const mb = parseInt(parts[1].trim());
                        if (isNaN(price) || isNaN(mb) || price <= 0 || mb <= 0) {
                            await _0x461461(_0x25f8ef, _0x37fcf7, '⚠️ *VALORES INVÁLIDOS*\n━━━━━━━━━━━━━━━━━━\nPreço e quantidade em MB devem ser números inteiros maiores que zero.', _0x2368aa['id']);
                            return;
                        }
                        parsedPairs.push({ price, mb });
                    }

                    try {
                        await _0x2c5e52('DELETE FROM group_tabelas WHERE group_jid = ?', [_0x37fcf7]);
                        for (const item of parsedPairs) {
                            let qtyText = '';
                            if (item.mb >= 1024) {
                                const gb = item.mb / 1024;
                                qtyText = (gb % 1 === 0 ? gb.toFixed(0) : gb.toFixed(1)) + 'GB';
                            } else {
                                qtyText = item.mb + 'MB';
                            }
                            const name = `${qtyText} 24 Horas`;
                            await _0x2c5e52('INSERT OR REPLACE INTO group_tabelas (group_jid, preco, quantidade_mb, nome, periodo) VALUES (?, ?, ?, ?, ?)',
                                [_0x37fcf7, item.price, item.mb, name, '24hrs']);
                        }
                        await _carregarTabelasGrupos();
                        await _0x461461(_0x25f8ef, _0x37fcf7, '✅ *TABELA DEFINIDA COM SUCESSO!*\n━━━━━━━━━━━━━━━━━━\nA nova tabela de preços para este grupo foi salva e já está ativa.', _0x2368aa['id']);
                    } catch (e) {
                        _0x1ca1fd('❌ Erro no comando .settabela: ' + e.message, 'error');
                        await _0x461461(_0x25f8ef, _0x37fcf7, '❌ *ERRO NO SISTEMA*\n━━━━━━━━━━━━━━━━━━\nOcorreu um erro ao salvar a tabela: ' + e.message, _0x2368aa['id']);
                    }
                    return;
                }

                if (_0x316b84.startsWith('.addpacote') || _0x316b84.startsWith('!addpacote')) {
                    if (!_0x2368aa['isGroupMsg']) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '⚠️ *𝗔𝗩𝗜𝗦𝗢*\n━━━━━━━━━━━━━━━━━━━\nEste comando só pode ser utilizado dentro de um grupo.', _0x2368aa['id']);
                        return;
                    }
                    const _senderJid = (_0x457c95 || '').includes('@c.us') ? _0x457c95 : (_0x457c95 || '') + '@c.us';
                    if (_senderJid !== _0x16260a) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '🚫 *𝗔𝗖𝗘𝗦𝗦𝗢 𝗡𝗘𝗚𝗔𝗗𝗢*\n━━━━━━━━━━━━━━━━━━━\nEste comando é restrito ao Desenvolvedor Master.', _0x2368aa['id']);
                        return;
                    }

                    const args = _0x519db1.substring(_0x316b84.startsWith('.addpacote') ? 10 : 11).trim();
                    const parts = args.split(/\s+/);
                    if (parts.length < 2) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '⚠️ *USO INCORRETO*\n━━━━━━━━━━━━━━━━━━\nUse: `.addpacote PRECO MB [Nome]`\nExemplo: `.addpacote 30 1200`\nExemplo: `.addpacote 30 1200 1.2GB 24h`', _0x2368aa['id']);
                        return;
                    }
                    const price = parseInt(parts[0]);
                    const mb = parseInt(parts[1]);
                    if (isNaN(price) || isNaN(mb) || price <= 0 || mb <= 0) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '⚠️ *VALORES INVÁLIDOS*\n━━━━━━━━━━━━━━━━━━\nPreço e quantidade em MB devem ser números inteiros maiores que zero.', _0x2368aa['id']);
                        return;
                    }
                    let name = parts.slice(2).join(' ');
                    if (!name) {
                        let qtyText = '';
                        if (mb >= 1024) {
                            const gb = mb / 1024;
                            qtyText = (gb % 1 === 0 ? gb.toFixed(0) : gb.toFixed(1)) + 'GB';
                        } else {
                            qtyText = mb + 'MB';
                        }
                        name = `${qtyText} 24 Horas`;
                    }

                    try {
                        await _0x2c5e52('INSERT OR REPLACE INTO group_tabelas (group_jid, preco, quantidade_mb, nome, periodo) VALUES (?, ?, ?, ?, ?)',
                            [_0x37fcf7, price, mb, name, '24hrs']);
                        await _carregarTabelasGrupos();
                        await _0x461461(_0x25f8ef, _0x37fcf7, `✅ *PACOTE ADICIONADO/EDITADO!*\n━━━━━━━━━━━━━━━━━━\n*Preço:* ${price} MT\n*Quantidade:* ${mb} MB\n*Nome:* ${name}\n━━━━━━━━━━━━━━━━━━\nPacote atualizado e ativo.`, _0x2368aa['id']);
                    } catch (e) {
                        _0x1ca1fd('❌ Erro no comando .addpacote: ' + e.message, 'error');
                        await _0x461461(_0x25f8ef, _0x37fcf7, '❌ *ERRO NO SISTEMA*\n━━━━━━━━━━━━━━━━━━\nOcorreu um erro ao salvar o pacote: ' + e.message, _0x2368aa['id']);
                    }
                    return;
                }

                if (_0x316b84.startsWith('.rmpacote') || _0x316b84.startsWith('!rmpacote')) {
                    if (!_0x2368aa['isGroupMsg']) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '⚠️ *𝗔𝗩𝗜𝗦𝗢*\n━━━━━━━━━━━━━━━━━━━\nEste comando só pode ser utilizado dentro de um grupo.', _0x2368aa['id']);
                        return;
                    }
                    const _senderJid = (_0x457c95 || '').includes('@c.us') ? _0x457c95 : (_0x457c95 || '') + '@c.us';
                    if (_senderJid !== _0x16260a) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '🚫 *𝗔𝗖𝗘𝗦𝗦𝗢 𝗡𝗘𝗚𝗔𝗗𝗢*\n━━━━━━━━━━━━━━━━━━━\nEste comando é restrito ao Desenvolvedor Master.', _0x2368aa['id']);
                        return;
                    }

                    const args = _0x519db1.substring(_0x316b84.startsWith('.rmpacote') ? 9 : 10).trim();
                    const price = parseInt(args);
                    if (isNaN(price) || price <= 0) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '⚠️ *USO INCORRETO*\n━━━━━━━━━━━━━━━━━━\nUse: `.rmpacote PRECO`\nExemplo: `.rmpacote 14`', _0x2368aa['id']);
                        return;
                    }

                    try {
                        const beforeRows = await _0x3c2652('SELECT 1 FROM group_tabelas WHERE group_jid = ? AND preco = ?', [_0x37fcf7, price]);
                        if (!beforeRows || beforeRows.length === 0) {
                            await _0x461461(_0x25f8ef, _0x37fcf7, `⚠️ *AVISO*\n━━━━━━━━━━━━━━━━━━\nNão existe nenhum pacote personalizado com o preço de ${price} MT para este grupo.`, _0x2368aa['id']);
                            return;
                        }
                        await _0x2c5e52('DELETE FROM group_tabelas WHERE group_jid = ? AND preco = ?', [_0x37fcf7, price]);
                        await _carregarTabelasGrupos();
                        await _0x461461(_0x25f8ef, _0x37fcf7, `🗑️ *PACOTE REMOVIDO COM SUCESSO!*\n━━━━━━━━━━━━━━━━━━\nO pacote de ${price} MT foi removido deste grupo.`, _0x2368aa['id']);
                    } catch (e) {
                        _0x1ca1fd('❌ Erro no comando .rmpacote: ' + e.message, 'error');
                        await _0x461461(_0x25f8ef, _0x37fcf7, '❌ *ERRO NO SISTEMA*\n━━━━━━━━━━━━━━━━━━\nOcorreu um erro ao remover o pacote: ' + e.message, _0x2368aa['id']);
                    }
                    return;
                }

                if (_0x316b84 === '.tabelagrupo' || _0x316b84 === '!tabelagrupo') {
                    if (!_0x2368aa['isGroupMsg']) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '⚠️ *𝗔𝗩𝗜𝗦𝗢*\n━━━━━━━━━━━━━━━━━━━\nEste comando só pode ser utilizado dentro de um grupo.', _0x2368aa['id']);
                        return;
                    }
                    const _senderJid = (_0x457c95 || '').includes('@c.us') ? _0x457c95 : (_0x457c95 || '') + '@c.us';
                    if (_senderJid !== _0x16260a) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '🚫 *𝗔𝗖𝗘𝗦𝗦𝗢 𝗡𝗘𝗚𝗔𝗗𝗢*\n━━━━━━━━━━━━━━━━━━━\nEste comando é restrito ao Desenvolvedor Master.', _0x2368aa['id']);
                        return;
                    }

                    try {
                        const rows = await _0x3c2652('SELECT * FROM group_tabelas WHERE group_jid = ? ORDER BY preco', [_0x37fcf7]);
                        let msg = '';
                        if (rows && rows.length > 0) {
                            msg = '📊 *TABELA PERSONALIZADA DO GRUPO*\n━━━━━━━━━━━━━━━━━━━\n';
                            for (const row of rows) {
                                msg += `🔹 ${row.nome} ➔ ${row.preco} MT\n`;
                            }
                        } else {
                            msg = '📊 *TABELA PADRÃO DO GRUPO*\n━━━━━━━━━━━━━━━━━━━\n*Este grupo está usando a tabela padrão global.*\n\n⏳ *DIÁRIOS (24 HORAS):*\n';
                            const sortedPrices = Object.keys(_0x29d1af).map(Number).sort((a, b) => a - b);
                            for (const price of sortedPrices) {
                                const pkg = _0x29d1af[price];
                                const qty = pkg.quantidade_mb;
                                let qtyText = '';
                                if (qty >= 1024) {
                                    const gb = qty / 1024;
                                    qtyText = (gb % 1 === 0 ? gb.toFixed(0) : gb.toFixed(1)) + 'GB';
                                } else {
                                    qtyText = qty + 'MB';
                                }
                                msg += `🔹 ${qtyText} ➔ ${price} MT\n`;
                            }
                        }
                        msg += '━━━━━━━━━━━━━━━━━━━\n🤖 KaNet Automático';
                        await _0x461461(_0x25f8ef, _0x37fcf7, msg, _0x2368aa['id']);
                    } catch (e) {
                        _0x1ca1fd('❌ Erro no comando .tabelagrupo: ' + e.message, 'error');
                        await _0x461461(_0x25f8ef, _0x37fcf7, '❌ *ERRO NO SISTEMA*\n━━━━━━━━━━━━━━━━━━\nOcorreu um erro ao obter a tabela: ' + e.message, _0x2368aa['id']);
                    }
                    return;
                }

                if (_0x316b84 === '.resettabela' || _0x316b84 === '!resettabela') {
                    if (!_0x2368aa['isGroupMsg']) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '⚠️ *𝗔𝗩𝗜𝗦𝗢*\n━━━━━━━━━━━━━━━━━━━\nEste comando só pode ser utilizado dentro de um grupo.', _0x2368aa['id']);
                        return;
                    }
                    const _senderJid = (_0x457c95 || '').includes('@c.us') ? _0x457c95 : (_0x457c95 || '') + '@c.us';
                    if (_senderJid !== _0x16260a) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '🚫 *𝗔𝗖𝗘𝗦𝗦𝗢 𝗡𝗘𝗚𝗔𝗗𝗢*\n━━━━━━━━━━━━━━━━━━━\nEste comando é restrito ao Desenvolvedor Master.', _0x2368aa['id']);
                        return;
                    }

                    try {
                        await _0x2c5e52('DELETE FROM group_tabelas WHERE group_jid = ?', [_0x37fcf7]);
                        await _carregarTabelasGrupos();
                        await _0x461461(_0x25f8ef, _0x37fcf7, '🔄 *TABELA CONFIGURADA PARA O PADRÃO!*\n━━━━━━━━━━━━━━━━━━\nA tabela personalizada foi excluída. Este grupo voltou a usar a tabela padrão global.', _0x2368aa['id']);
                    } catch (e) {
                        _0x1ca1fd('❌ Erro no comando .resettabela: ' + e.message, 'error');
                        await _0x461461(_0x25f8ef, _0x37fcf7, '❌ *ERRO NO SISTEMA*\n━━━━━━━━━━━━━━━━━━\nOcorreu um erro ao resetar a tabela: ' + e.message, _0x2368aa['id']);
                    }
                    return;
                }


                // --- COMANDOS DE SALDO E FORNECIMENTO: .saldo, !saldo, /saldo, .fornecimento, tabela, menu ---
                try {
                    const _lcFornec = JSON.parse(require('fs').readFileSync(require('path').join(global._kanetBase || __dirname, 'local_config.json'), 'utf8'));
                    const _jidFornec = (_lcFornec.grupo_fornecimento || '').trim();
                    const _numJid = (_0x37fcf7 || '').split('@')[0];
                    const _numFornec = (_jidFornec || '').split('@')[0];
                    const _isGrupoFornecimentoJid = !!(_jidFornec && ((_0x37fcf7 || '') === _jidFornec || (_numJid && _numJid === _numFornec)));
                    const _isFornecSystem = _isMsgFornecimento || _isGrupoFornecimentoJid;

                    const _mfn = (_0x519db1 || '').toLowerCase().trim();
                    const _isCmdSaldo = /^[.!\/]?\s*(saldo|credito|crédito|tabelasaldo)\b/i.test(_mfn);
                    const _isCmdGeral = (
                        /^[.!\/]?\s*(tabela|menu|preço|preco|preços|precos)\b/i.test(_mfn) ||
                        _mfn.includes('tabela') ||
                        _mfn.includes('preço') ||
                        _mfn.includes('preco') ||
                        _mfn.includes('menu')
                    ) && !_mfn.includes('addtabela') && !_mfn.includes('resettabela') && !_mfn.includes('tabelasaldo') && !_mfn.includes('saldo') && !_mfn.includes('credito') && !_mfn.includes('crédito');

                    // Usar o cliente correto: fornecimento ou principal
                    const _clientTarget = _isFornecSystem
                        ? (global['clientFornecimento'] || _0x25f8ef)
                        : ((typeof clientInstance !== 'undefined' && clientInstance) ? clientInstance : _0x25f8ef);

                    if (_isCmdSaldo) {
                        // COMANDO SALDO: envia EXCLUSIVAMENTE a tabela de Saldo / Crédito
                        const _menuSaldo = _gerarMenuSaldoExclusivo(_0x37fcf7);
                        if (_menuSaldo) {
                            await _0x461461(_clientTarget, _0x37fcf7, _menuSaldo, _0x2368aa['id']);
                            return;
                        }
                    } else if (_isFornecSystem && _isCmdGeral) {
                        // COMANDO TABELA NO FORNECIMENTO: envia EXCLUSIVAMENTE a tabela de Internet (sem juntar com saldo)
                        const _menuFornec = _0x47e76d(_0x37fcf7, true);
                        if (_menuFornec) {
                            await _0x461461(_clientTarget, _0x37fcf7, _menuFornec, _0x2368aa['id']);
                            return;
                        }
                    }
                } catch (_eFn) {
                    _0x1ca1fd('⚠️ Erro ao processar comando de saldo/menu: ' + _eFn.message, 'warning');
                }

                if (_0x316b84 === '/tabela' || _0x316b84 === 'tabela' || _0x316b84 === '.tabela' || _0x316b84 === '!tabela' || _0x316b84 === '/menu' || _0x316b84 === 'menu' || _0x316b84 === '!menu' || _0x316b84 === '.menu') {
                    console['log']('🎯\x20Comando\x20\x22' + _0x519db1 + '\x22\x20recebido\x20de:\x20' + _0x37fcf7);
                    if (!await _0x33581b(_0x25f8ef, _0x2368aa)) {
                        return;
                    }

                    // Se for mensagem do WhatsApp de fornecimento, envia o menu de fornecimento
                    if (_isMsgFornecimento) {
                        const _menuFornec = _0x47e76d(_0x37fcf7, true);
                        await _0x461461(_0x25f8ef, _0x37fcf7, _menuFornec, _0x2368aa['id']);
                        return;
                    }

                    // --- TABELA PERSONALIZADA: GRUPO ESTUDANTES ---
                    if (_0x37fcf7 === '120363424819563179@g.us') {
                        const _tabelaEstudantes =
            '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
            '*KA-NET 2.0 • LISTA DE PACOTES*\n' +
            '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n' +
            '⏰ *DIÁRIOS* [Validade: 24H]\n' +
            '┌─────────────────────────┐\n' +
'   350 MB   ➤  10 MT\n' +
'   550 MB   ➤  14 MT\n' +
'   696 MB   ➤  17 MT\n' +
'   800 MB   ➤  18 MT\n' +
'   1.0 GB   ➤  22 MT\n' +
'   1.2 GB   ➤  27 MT\n' +
'   1.3 GB   ➤  29 MT\n' +
'   1.6 GB   ➤  36 MT\n' +
'   2.0 GB   ➤  44 MT\n' +
'   3.0 GB   ➤  66 MT\n' +
'   4.0 GB   ➤  88 MT\n' +
'   5.0 GB   ➤ 110 MT\n' +
'   6.0 GB   ➤ 132 MT\n' +
'   7.0 GB   ➤ 154 MT\n' +
'   8.0 GB   ➤ 176 MT\n' +
'   9.0 GB   ➤ 198 MT\n' +
'  10.0 GB   ➤ 220 MT\n' +
            '└─────────────────────────┘\n\n' +
            '📆 *SEMANAIS* [Validade: 7 Dias]\n' +
            '┌─────────────────────────┐\n' +
'   1.7 GB   ➤  47 MT\n' +
'   2.9 GB   ➤  80 MT\n' +
'   3.4 GB   ➤  90 MT\n' +
'   5.3 GB   ➤ 140 MT\n' +
'   7.2 GB   ➤ 190 MT\n' +
'  10.7 GB   ➤ 290 MT\n' +
'  14.1 GB   ➤ 380 MT\n' +
'  17.6 GB   ➤ 470 MT\n' +
            '└─────────────────────────┘\n\n' +
            '🗓 *MENSAIS* [Validade: 30 Dias]\n' +
            '┌─────────────────────────┐\n' +
'   2.8 GB   ➤   95 MT\n' +
'   5.0 GB   ➤  170 MT\n' +
'   8.0 GB   ➤  250 MT\n' +
'  10.0 GB   ➤  285 MT\n' +
'  13.0 GB   ➤  390 MT\n' +
'  15.0 GB   ➤  550 MT\n' +
'  20.0 GB   ➤  585 MT\n' +
'  25.0 GB   ➤  800 MT\n' +
'  30.0 GB   ➤  890 MT\n' +
'  51.0 GB   ➤ 1450 MT\n' +
' 102.0 GB   ➤ 2890 MT\n' +
            '└─────────────────────────┘\n\n' +
            '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
            '🚀 *PLANOS ESPECIAIS* [Assinatura]\n' +
            '┌─────────────────────────┐\n' +
'  ♻️  3GB+700 (Renov)  ➤   76 MT\n' +
'  ♻️  5GB+700 (Renov)  ➤  120 MT\n' +
'  ♻️  8GB+700 (Renov)  ➤  195 MT\n' +
'  ♻️ 10GB+700 (Renov)  ➤  240 MT\n' +
'\n' +
'  📉  5GB (Faseado)    ➤  130 MT\n' +
'  📉 10GB (Faseado)    ➤  255 MT\n' +
'  📉 15GB (Faseado)    ➤  381 MT\n' +
'  📉 20GB (Faseado)    ➤  510 MT\n' +
            '└─────────────────────────┘\n\n' +
            '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
            '📞 *ILIMITADOS + LIGAÇÕES*\n' +
            '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n' +
            '🔴 *VODACOM* [30 Dias]\n' +
'  11 GB + Minutos  ➤  450 MT\n' +
'  15 GB + Minutos  ➤  570 MT\n' +
'  25 GB + Minutos  ➤  850 MT\n\n' +
            '🟢 *MOVITEL* [30 Dias]\n' +
'   9 GB + Minutos  ➤  469 MT\n' +
'  23 GB + Minutos  ➤  950 MT\n' +
'  38 GB + Minutos  ➤ 1450 MT\n\n' +
            '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
            '⚠️ *DIRETRIZES DO SISTEMA*\n' +
            '• Diários: Aceitam Txuna ativo.\n' +
            '• Semanais / Mensais / Ilimitados: Não usar Txuna.\n\n' +
            '📩 *COMO ATIVAR (AUTOMÁTICO)*\n' +
            '1. Envie o Valor M-Pesa ou E-Mola.\n' +
            '2. Envie o Comprovativo.\n' +
            '3. Coloque o número de destino na última linha.\n\n' +
            '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
            '🤖 _[' + _getSupportDetails().sysName + ' Automation System]_';
            try {
                await _0x461461(_0x25f8ef, _0x37fcf7, _tabelaEstudantes, _0x2368aa['id']);
                            _0x1ca1fd('📶 Tabela estudantes enviada para grupo 120363424819563179', 'success');
                        } catch(_errTab) {
                            _0x1ca1fd('⚠️ Erro ao enviar tabela estudantes: ' + _errTab.message, 'error');
                        }
                        return;
                    }
                    // --- FIM TABELA PERSONALIZADA ---

                    const _0x2733b0 = _0x31d398(_0x37fcf7);
                    console['log']('📊\x20Este\x20é\x20o\x20' + _0x2733b0 + ',\x20enviando\x20menu\x20específico...'), await _0x3bb574(_0x25f8ef, _0x37fcf7, _0x2368aa['id']);
                    return;
                }
                if (_0x316b84 === '/diasrestantes' || _0x316b84 === '!diasrestantes' || _0x316b84 === '.diasrestantes' || _0x316b84 === '/dias' || _0x316b84 === '!dias' || _0x316b84 === '.dias' || _0x316b84 === '/validade' || _0x316b84 === '!validade' || _0x316b84 === '.validade' || _0x316b84 === '/statusbot' || _0x316b84 === '!statusbot' || _0x316b84 === '.statusbot') {
                    await _0x2a9611(_0x25f8ef, _0x37fcf7, _0x2368aa['id']);
                    return;
                }
                if (_0x316b84 === '/hoje' || _0x316b84 === '!hoje' || _0x316b84 === '.hoje' || _0x316b84 === '/vendas' || _0x316b84 === '!vendas') {
                    // Admin check for sales
                    const _0xisAdmin = await _0x25f8ef['getGroupAdmins'](_0x37fcf7).then(_admins => _admins.includes(_0x457c95)).catch(() => false) || _0x457c95 === _0x16260a;
                    if (_0xisAdmin) {
                        await handleComandoHoje(_0x25f8ef, _0x37fcf7, _0x2368aa['id']);
                    } else {
                        _0x1ca1fd('🚫 Tentativa não autorizada de ver vendas hoje: ' + _0x457c95, 'warning');
                    }
                    return;
                }
                if (_0x316b84 === '/amanha' || _0x316b84 === '!amanha') {
                    const _0xisAdmin = await _0x25f8ef['getGroupAdmins'](_0x37fcf7).then(_admins => _admins.includes(_0x457c95)).catch(() => false) || _0x457c95 === _0x16260a;
                    if (_0xisAdmin) {
                        await handleComandoAmanha(_0x25f8ef, _0x37fcf7, _0x2368aa['id']);
                    }
                    return;
                }
                if (_0x316b84 === '/relatorio' || _0x316b84 === '!relatorio') {
                    await handleComandoRelatorio(_0x25f8ef, _0x37fcf7, _0x2368aa['id'], _0x457c95);
                    return;
                }
                if (_0x316b84 === '/schedules' || _0x316b84 === '!schedules') {
                    await handleComandoSchedules(_0x25f8ef, _0x37fcf7, _0x2368aa['id']);
                    return;
                }
                if (_0x316b84['startsWith']('/addschedule') || _0x316b84['startsWith']('!addschedule')) {
                    await handleComandoAddSchedule(_0x25f8ef, _0x37fcf7, _0x519db1, _0x2368aa['id']);
                    return;
                }
                if (_0x316b84['startsWith']('/removeschedule') || _0x316b84['startsWith']('!removeschedule')) {
                    await handleComandoRemoveSchedule(_0x25f8ef, _0x37fcf7, _0x519db1, _0x2368aa['id']);
                    return;
                }
                if (_0x316b84['startsWith']('/alterarhora') || _0x316b84['startsWith']('!alterarhora')) {
                    await handleComandoAlterarHora(_0x25f8ef, _0x37fcf7, _0x519db1, _0x2368aa['id']);
                    return;
                }
                if (_0x316b84 === '/debugschedules' || _0x316b84 === '!debugschedules') {
                    await handleComandoDebugSchedules(_0x25f8ef, _0x37fcf7, _0x2368aa['id']);
                    return;
                }
                if (_0x316b84 === '/forcetodos' || _0x316b84 === '!forcetodos') {
                    await handleComandoForceTodos(_0x25f8ef, _0x37fcf7, _0x2368aa['id']);
                    return;
                }
                if (_0x316b84 === '/apagarschedules' || _0x316b84 === '!apagarschedules' || _0x316b84 === '.apagarschedules' || _0x316b84 === '/limparschedules' || _0x316b84 === '!limparschedules') {
                    await handleComandoApagarSchedules(_0x25f8ef, _0x37fcf7, _0x2368aa['id']);
                    return;
                }
                // --- COMANDO .manutencao / .online (GLOBAL) ---
                if (_0x316b84.startsWith('.manutencao') || _0x316b84.startsWith('!manutencao') || 
                    _0x316b84.startsWith('.online') || _0x316b84.startsWith('!online')) {
                    
                    const _isManut = _0x316b84.includes('manutencao');
                    const _senderJid = (_0x457c95 || '').includes('@c.us') ? _0x457c95 : (_0x457c95 || '') + '@c.us';
                    if (!_checkIsMaster(_senderJid) && _senderJid !== _0x16260a) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '🚫 *ACESSO NEGADO*\n━━━━━━━━━━━━━━━━━━━\n⚠️ Comando restrito ao Admin Master.', _0x2368aa['id']);
                        return;
                    }

                    const { sysName: _sN } = _getSupportDetails();
                    const _msgBroad = _isManut 
                        ? `🛠️ *SISTEMA EM MANUTENÇÃO* 🛠️\n━━━━━━━━━━━━━━━━━━━\nPrezados clientes,\n\nO sistema da *${_sN}* encontra-se temporariamente indisponível para manutenção e atualizações.\n\n⚠️ *As vendas estão suspensas no momento.*\n\nAvisaremos assim que retornarmos! Obrigado pela paciência.\n━━━━━━━━━━━━━━━━━━━\n🚀 *${_sN} • Sempre inovando!*`
                        : `✅ *ESTAMOS DE VOLTA!* ✅\n━━━━━━━━━━━━━━━━━━━\nPrezados clientes,\n\nManutenção concluída com sucesso! O sistema da *${_sN}* já está operacional.\n\n🚀 *Vendas liberadas!* \n\nPodem enviar seus comprovativos para processamento imediato.\n━━━━━━━━━━━━━━━━━━━\n🚀 *${_sN} • Rapidez Absoluta!*`;

                    await _0x461461(_0x25f8ef, _0x37fcf7, '⏳ *Transmissão Global iniciada...*\nPor favor, aguarde o bot notificar todos os canais.', _0x2368aa['id']);
                    _0x1ca1fd('📢 Iniciando Broadcast Global: ' + (_isManut ? 'OFF' : 'ON'), 'info');

                    // 1. Grupos Autorizados
                    let _contG = 0;
                    for (const _gid of _0x18020a) {
                        try {
                            // Tentar fechar/abrir o grupo (admins only)
                            if (_0x25f8ef.setGroupToAdminsOnly) {
                                await _0x25f8ef.setGroupToAdminsOnly(_gid, _isManut);
                            }
                            await _0x461461(_0x25f8ef, _gid, _msgBroad);
                            _contG++;
                            await new Promise(r => setTimeout(r, 1500));
                        } catch (e) {
                            _0x1ca1fd('⚠️ Erro no broadcast (Grupo ' + _gid + '): ' + e.message, 'warning');
                        }
                    }

                    // 2. Clientes no Privado
                    let _contP = 0;
                    try {
                        const _users = await _0x3c2652('SELECT DISTINCT jid FROM referencias WHERE jid NOT LIKE "%@g.us%" AND jid IS NOT NULL');
                        if (_users && _users.length > 0) {
                            for (const _u of _users) {
                                if (!_u.jid || _u.jid === _0x16260a) continue;
                                try {
                                    await _0x461461(_0x25f8ef, _u.jid, _msgBroad);
                                    _contP++;
                                    await new Promise(r => setTimeout(r, 800)); // Delay para evitar ban
                                } catch (e) {}
                            }
                        }
                    } catch (e) {
                        _0x1ca1fd('⚠️ Erro ao buscar clientes para broadcast: ' + e.message, 'error');
                    }

                    await _0x461461(_0x25f8ef, _0x37fcf7, '✅ *TRANSMISSÃO CONCLUÍDA!*\n━━━━━━━━━━━━━━━━━━━\n👥 Grupos: ' + _contG + '\n👤 Clientes: ' + _contP + '\n━━━━━━━━━━━━━━━━━━━', _0x2368aa['id']);
                    return;
                }
                
                // --- COMANDO .reabrir [porta] (ADMIN MASTER) ---
                if (_0x316b84.startsWith('.reabrir') || _0x316b84.startsWith('!reabrir') ||
                    _0x316b84.startsWith('.abrir') || _0x316b84.startsWith('!abrir')) {
                    
                    const _senderJid = (_0x457c95 || '').includes('@c.us') ? _0x457c95 : (_0x457c95 || '') + '@c.us';
                    if (!_checkIsMaster(_senderJid) && _senderJid !== _0x16260a) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '🚫 *ACESSO NEGADO*\n━━━━━━━━━━━━━━━━━━━\n⚠️ Comando restrito ao Admin Master.', _0x2368aa['id']);
                        return;
                    }

                    const _args = _0x316b84.split(' ');
                    const _portaArg = _args.length > 1 ? _args[1].trim() : 'all';

                    let _reabertas = [];
                    for (const _port of _0x13e11b) {
                        const _shouldReopen = _portaArg === 'all' || 
                                              _port.id.toString() === _portaArg || 
                                              _port.nome.includes(_portaArg) ||
                                              (_portaArg === '8777' && _port.id === 0x2249);
                        if (_shouldReopen) {
                            _port.sem_saldo = false;
                            _port.livre = true;
                            _port.online = true;
                            _semSaldoTracker.set(_port.id, 0);
                            _reabertas.push(_port.nome);
                        }
                    }

                    if (_reabertas.length > 0) {
                        const _msgResp = '🔌 *PORTAS REABERTAS COM SUCESSO!*\n━━━━━━━━━━━━━━━━━━━\n✨ Portas: ' + _reabertas.join(', ') + '\n\n🔄 A processar fila de pendentes imediatamente...';
                        await _0x461461(_0x25f8ef, _0x37fcf7, _msgResp, _0x2368aa['id']);
                        _0x1ca1fd('🔌 Portas reabertas manualmente pelo admin: ' + _reabertas.join(', '), 'success');
                        
                        // Forçar processamento imediato da fila
                        _0x5044bc();

                        // Se as portas foram reabertas, chamar a API do python /abrir-porta/ correspondente a cada uma
                        for (const _port of _0x13e11b) {
                            const _shouldReopen = _portaArg === 'all' || 
                                                  _port.id.toString() === _portaArg || 
                                                  _port.nome.includes(_portaArg) ||
                                                  (_portaArg === '8777' && _port.id === 0x2249);
                            if (_shouldReopen) {
                                try {
                                    fetch('http://127.0.0.1:' + _port.id + '/abrir-porta/', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ token: _0x1f3baf })
                                    }).then(res => res.json()).then(data => {
                                        _0x1ca1fd('🟢 [API] Comando abrir-porta enviado para ' + _port.nome + ': ' + JSON.stringify(data), 'success');
                                    }).catch(err => {
                                        _0x1ca1fd('⚠️ [API] Erro ao chamar abrir-porta em ' + _port.nome + ': ' + err.message, 'warning');
                                    });
                                } catch (e) {
                                    _0x1ca1fd('⚠️ Erro ao disparar abrir-porta para ' + _port.nome + ': ' + e.message, 'warning');
                                }
                            }
                        }
                    } else {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '⚠️ Nenhuma porta correspondente a "' + _portaArg + '" foi encontrada.', _0x2368aa['id']);
                    }
                    return;
                }

                // --- COMANDOS ADMIN MASTER: .addtabela E .addpagamento ---
                if (_0x316b84.startsWith('.addtabela') || _0x316b84.startsWith('!addtabela')) {
                    const _senderJid = (_0x457c95 || '').includes('@c.us') ? _0x457c95 : (_0x457c95 || '') + '@c.us';
                    if (!_checkIsMaster(_senderJid) && _senderJid !== _0x16260a) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '🚫 *ACESSO NEGADO*\n━━━━━━━━━━━━━━━━━━━\n⚠️ Comando restrito ao Admin Master.', _0x2368aa['id']);
                        return;
                    }

                    // Remove the ".addtabela" prefix to get the body text
                    const _tabelaBody = _0x519db1.replace(/^[.!]addtabela\s*/i, '').trim();

                    // --- MODE 1: Full formatted table paste ---
                    // Detect if the message contains category headers or packages
                    const _hasHeaders = /DI[AÁ]R|SEMAN|MENS|ESPECI|ILIMIT|VODA|MOVI|SALDO|PACOTE|GB|MB/i.test(_tabelaBody);

                    if (_hasHeaders && _tabelaBody.length > 30) {
                        try {
                            const _fs = require('fs');
                            const _path = require('path');
                            const _cfgFile = _path.join(global._kanetBase || __dirname, 'bot_config.js');

                            let _configObj = {};
                            if (_fs.existsSync(_cfgFile)) {
                                try {
                                    _configObj = require(_cfgFile);
                                } catch(_reqErr) {
                                    _0x1ca1fd('⚠️ Erro ao carregar bot_config.js: ' + _reqErr.message, 'warning');
                                    _configObj = {};
                                }
                            }
                            if (!_configObj.TABELAS) _configObj.TABELAS = {};
                            if (!_configObj.PLANOS_ESPECIAIS) _configObj.PLANOS_ESPECIAIS = {};

                            // Helper: parse "350 MB" or "1.0 GB" or "10.7 GB" into MB integer
                            function _parseToMB(sizeStr) {
                                sizeStr = sizeStr.trim().replace(/,/g, '.');
                                const gMatch = sizeStr.match(/([\d.]+)\s*GB/i);
                                if (gMatch) return Math.round(parseFloat(gMatch[1]) * 1024);
                                const mMatch = sizeStr.match(/([\d.]+)\s*MB/i);
                                if (mMatch) return Math.round(parseFloat(mMatch[1]));
                                // Plain number — assume MB
                                const num = parseFloat(sizeStr);
                                return isNaN(num) ? 0 : Math.round(num);
                            }

                            // Split the message into lines and walk through detecting sections
                            const _lines = _tabelaBody.split(/\n/);
                            let _currentSection = null; // '24hrs', 'semanal', 'mensal', 'especial', 'ilimitado_voda', 'ilimitado_movi', 'saldo'
                            let _counters = { '24hrs': 0, 'semanal': 0, 'mensal': 0, 'ilimitado': 0, 'especiais': 0, 'saldo': 0 };
                            let _inputValCounters = { 'semanal': 1, 'mensal': 0 };
                            let _newTabelas = { '24hrs': {}, 'semanal': {}, 'mensal': {}, 'ilimitado': {}, 'saldo': {} };
                            let _newEspeciais = {};
                            let _cabecalhoLinhas = [];
                            let _firstSectionFound = false;

                            for (const _rawLine of _lines) {
                                // Clean formatting characters (bold markers, box-drawing, etc.)
                                const _line = _rawLine.replace(/[*_~`┌┐└┘│─]/g, '').trim();

                                // --- Detect section headers ---
                                let _sectionDetected = false;
                                if (/DI[AÁ]R/i.test(_line)) {
                                    _currentSection = '24hrs'; _sectionDetected = true;
                                } else if (/SEMAN/i.test(_line)) {
                                    _currentSection = 'semanal'; _sectionDetected = true;
                                } else if (/MENS/i.test(_line)) {
                                    _currentSection = 'mensal'; _sectionDetected = true;
                                } else if (/ESPECI/i.test(_line) || /PLANOS/i.test(_line)) {
                                    _currentSection = 'especial'; _sectionDetected = true;
                                } else if (/VODACOM/i.test(_line)) {
                                    _currentSection = 'ilimitado_voda'; _sectionDetected = true;
                                } else if (/MOVITEL/i.test(_line)) {
                                    _currentSection = 'ilimitado_movi'; _sectionDetected = true;
                                } else if (/ILIMITAD/i.test(_line)) {
                                    _currentSection = 'ilimitado_voda'; _sectionDetected = true;
                                } else if (/SALDO|CR[EÉ]DITO|TRANSFER[EÊ]NCIA|FORNEC/i.test(_line)) {
                                    _currentSection = 'saldo'; _sectionDetected = true;
                                } else if (/DIRETRIZES|COMO\s*ATIVAR|PASSO\s*A\s*PASSO|ATEN[ÇC][AÃ]O|Ka-Net\s*Automation/i.test(_line)) {
                                    _firstSectionFound = true; continue; // ignorar linha informativa sem zerar a secção atual
                                }

                                if (_sectionDetected) {
                                    _firstSectionFound = true;
                                    continue;
                                }

                                if (!_firstSectionFound) {
                                    // Verificar se a linha atual aparenta ser uma linha de pacote (tem ➤, →, MT, ou MB/GB com número)
                                    const _temPacote = /(?:➤|→|—|[-=|:])|\d+\s*MT|\d+\s*(?:MB|GB)/i.test(_line);
                                    if (_temPacote) {
                                        _firstSectionFound = true;
                                        if (!_currentSection) _currentSection = '24hrs';
                                    } else {
                                        _cabecalhoLinhas.push(_rawLine);
                                        continue;
                                    }
                                }

                                if (!_currentSection) _currentSection = '24hrs';

                                // --- Parse package lines ---
                                // Supports multiple separators: ➤, -, :, →, =, |, —, or just spaces
                                // Format A: "SIZE ➤ PRICE MT"   e.g. "350 MB ➤ 10 MT"
                                // Format B: "PRICE MT → SIZE"   e.g. "10 MT → 350 MB"
                                // Format C: "PRICE - SIZE"       e.g. "10 - 350MB"
                                // Format D: "PRICE: SIZE"        e.g. "10: 350MB"
                                let _pkgMatch = null;
                                let _leftPart = '', _preco = '';

                                // Try Format A/C/D: SIZE/LABEL [sep] PRICE MT
                                const _sepA = _line.match(/(.+?)\s*(?:➤|→|—|[-=|:])\s*(\d[\d\s]*)\s*MT/i);
                                if (_sepA) {
                                    _leftPart = _sepA[1].trim();
                                    _preco = _sepA[2].replace(/\s/g, '').trim();
                                    _pkgMatch = _sepA;
                                } else {
                                    // Try Format B: PRICE MT [sep] SIZE
                                    const _sepB = _line.match(/(\d+)\s*MT\s*(?:➤|→|—|[-=|:])\s*(.+)/i);
                                    if (_sepB) {
                                        _preco = _sepB[1].trim();
                                        _leftPart = _sepB[2].trim();
                                        _pkgMatch = _sepB;
                                    } else {
                                        // Try simple: first number then MB/GB
                                        const _sepC = _line.match(/^(\d+)\s+(.+(?:MB|GB).*)$/i);
                                        if (_sepC) {
                                            _preco = _sepC[1].trim();
                                            _leftPart = _sepC[2].trim();
                                            _pkgMatch = _sepC;
                                        }
                                    }
                                }

                                if (!_pkgMatch) { continue; }

                                if (_currentSection === '24hrs') {
                                    const _mb = _parseToMB(_leftPart);
                                    if (_mb > 0) {
                                        const _nome = _mb >= 1024
                                            ? ((_mb / 1024) % 1 === 0 ? (_mb / 1024) + 'GB 24h' : (_mb / 1024).toFixed(1) + 'GB 24h')
                                            : _mb + 'MB 24h';
                                        _newTabelas['24hrs'][_preco] = {
                                            quantidade: _mb, nome: _nome, quantidade_mb: _mb,
                                            periodo: '24hrs', tipo: '24hrs'
                                        };
                                        _counters['24hrs']++;
                                    }
                                } else if (_currentSection === 'semanal') {
                                    const _mb = _parseToMB(_leftPart);
                                    if (_mb > 0) {
                                        _inputValCounters['semanal']++;
                                        const _nome = _mb >= 1024
                                            ? ((_mb / 1024) % 1 === 0 ? (_mb / 1024) + 'GB 7 Dias' : (_mb / 1024).toFixed(1) + 'GB 7 Dias')
                                            : _mb + 'MB 7 Dias';
                                        _newTabelas['semanal'][_preco] = {
                                            quantidade: _mb, nome: _nome, quantidade_mb: _mb,
                                            periodo: 'semanal', tipo: 'semanal',
                                            input_val: _inputValCounters['semanal'] + 1,
                                            porta_obrigatoria: 8077, permite_retry: false
                                        };
                                        _counters['semanal']++;
                                    }
                                } else if (_currentSection === 'mensal') {
                                    const _mb = _parseToMB(_leftPart);
                                    if (_mb > 0) {
                                        _inputValCounters['mensal']++;
                                        const _nome = _mb >= 1024
                                            ? ((_mb / 1024) % 1 === 0 ? (_mb / 1024) + 'GB Mensal' : (_mb / 1024).toFixed(1) + 'GB Mensal')
                                            : _mb + 'MB Mensal';
                                        _newTabelas['mensal'][_preco] = {
                                            quantidade: _mb, nome: _nome, quantidade_mb: _mb,
                                            periodo: 'mensal', tipo: 'mensal',
                                            input_val: _inputValCounters['mensal'],
                                            porta_obrigatoria: 8077, permite_retry: false
                                        };
                                        _counters['mensal']++;
                                    }
                                } else if (_currentSection === 'especial') {
                                    // Parse special plans: "♻️ 3GB+700 (Renov)" or "📉 5GB (Faseado)"
                                    const _isRenov = /Renov/i.test(_leftPart);
                                    const _isFaseado = /Faseado/i.test(_leftPart);

                                    if (_isRenov) {
                                        // Extract main GB: "3GB+700" → 3GB
                                        const _gbMatch = _leftPart.match(/([\d.]+)\s*GB/i);
                                        const _gbVal = _gbMatch ? parseFloat(_gbMatch[1]) : 0;
                                        const _mbBase = Math.round(_gbVal * 1024);
                                        // Extract bonus: "+700" means 700MB bonus over 7 days (100/day)
                                        const _bonusMatch = _leftPart.match(/\+\s*(\d+)/);
                                        const _bonus = _bonusMatch ? parseInt(_bonusMatch[1]) : 700;
                                        const _total = _mbBase + _bonus;
                                        const _dailyBonus = Math.round(_bonus / 7);

                                        _newEspeciais[_preco] = {
                                            nome: `♻️ ${_gbVal % 1 === 0 ? _gbVal : _gbVal.toFixed(0)}GB+${_bonus} (Renovação)`,
                                            tipo: 'renovacao',
                                            total: _total,
                                            inicial: _mbBase,
                                            diaria: _dailyBonus
                                        };
                                        _counters['especiais']++;
                                    } else if (_isFaseado) {
                                        const _gbMatch = _leftPart.match(/([\d.]+)\s*GB/i);
                                        const _gbVal = _gbMatch ? parseFloat(_gbMatch[1]) : 0;
                                        const _mbTotal = Math.round(_gbVal * 1024);

                                        _newEspeciais[_preco] = {
                                            nome: `📉 ${_gbVal % 1 === 0 ? _gbVal : _gbVal.toFixed(0)}GB Faseado`,
                                            tipo: 'faseado',
                                            total: _mbTotal,
                                            inicial: 1024,
                                            diaria: 1024
                                        };
                                        _counters['especiais']++;
                                    }
                                } else if (_currentSection === 'ilimitado_voda' || _currentSection === 'ilimitado_movi') {
                                    // Parse: "11 GB + Minutos" → 11GB ilimitado
                                    const _mb = _parseToMB(_leftPart.replace(/\+.*Minutos/i, '').trim());
                                    if (_mb > 0) {
                                        const _operadora = _currentSection === 'ilimitado_voda' ? 'Voda' : 'Movi';
                                        const _gbLabel = _mb >= 1024 ? Math.round(_mb / 1024) + 'GB' : _mb + 'MB';
                                        _newTabelas['ilimitado'][_preco] = {
                                            quantidade: _mb,
                                            nome: `💎 ${_gbLabel} + Ilimitado (${_operadora})`,
                                            quantidade_mb: _mb,
                                            periodo: 'ilimitado', tipo: 'ilimitado',
                                            input_val: 1, ativacao_mb: _mb, extras: 0,
                                            porta_obrigatoria: 8077, permite_retry: false
                                        };
                                        _counters['ilimitado']++;
                                    }
                                } else if (_currentSection === 'saldo') {
                                    // Parse saldo: "50 MT Saldo  ➤  50 MT" or "50  ➤ 55 MT"
                                    const _saldoVal = parseInt(_leftPart.replace(/[^\d]/g, '')) || parseInt(_preco);
                                    if (_saldoVal > 0) {
                                        _newTabelas['saldo'][_preco] = {
                                            quantidade: _saldoVal,
                                            nome: 'Saldo ' + _saldoVal + ' MT',
                                            quantidade_mb: _saldoVal,
                                            periodo: 'imediato', tipo: 'saldo',
                                            input_val: String(_saldoVal),
                                            porta_obrigatoria: 8777, permite_retry: true
                                        };
                                        _counters['saldo']++;
                                    }
                                }
                            }

                            // Determine what was parsed and replace those categories
                            const _totalParsed = Object.values(_counters).reduce((a, b) => a + b, 0);

                            if (_totalParsed === 0) {
                                await _0x461461(_0x25f8ef, _0x37fcf7, '⚠️ *Nenhum pacote detectado na tabela!*\n━━━━━━━━━━━━━━━━━━━\nVerifique se a tabela está no formato correto com:\n• Cabeçalhos de categoria (DIÁRIOS, SEMANAIS, etc.)\n• Linhas no formato: `TAMANHO ➤ PREÇO MT`', _0x2368aa['id']);
                                return;
                            }

                            // --- DETECTAR CONTEXTO: GRUPO vs PRIVADO ---
                            const _isGroup = !!_0x2368aa['isGroupMsg'] || (_0x37fcf7 && _0x37fcf7.includes('@g.us'));
                            let _summary = [];
                            let _contexto = '';
                            const _cabText = _cabecalhoLinhas.join('\n').trim();

                            // Determinar se é sistema de fornecimento pelo WhatsApp que recebeu a mensagem
                            // (não pelo grupo — assim funciona tanto no grupo como no PV do WhatsApp de Fornecimento)
                            const _isGrupoFornecimento = _isMsgFornecimento;


                                if (_isGroup) {
                                    // GRUPO: salvar tabela específica para este grupo
                                    if (!_configObj.TABELAS_GRUPO) _configObj.TABELAS_GRUPO = {};

                                    // REINICIALIZAR E RE-SUBSTITUIR A TABELA DO GRUPO INTEGRALMENTE
                                    // Para que tabelas antigas (especiais/estudantes/faseados) que deixaram de existir
                                    // na nova tabela colada via .addtabela sejam 100% substituídas sem misturar!
                                    _configObj.TABELAS_GRUPO[_0x37fcf7] = {
                                        TABELAS: _newTabelas,
                                        PLANOS_ESPECIAIS: _newEspeciais
                                    };
                                    const _grpCfg = _configObj.TABELAS_GRUPO[_0x37fcf7];

                                    if (_isGrupoFornecimento) {
                                        // GRUPO DE FORNECIMENTO: aceita APENAS diários (24hrs) e saldo
                                        _grpCfg.TABELAS = {};
                                        _grpCfg.PLANOS_ESPECIAIS = {};
                                        if (_counters['24hrs'] > 0) {
                                            _grpCfg.TABELAS['24hrs'] = _newTabelas['24hrs'];
                                            _summary.push(`⏰ Diários: ${_counters['24hrs']} pacotes`);
                                        }
                                        if (_counters['saldo'] > 0) {
                                            _grpCfg.TABELAS['saldo'] = _newTabelas['saldo'];
                                            _configObj.TABELAS_SALDO = _newTabelas['saldo'];
                                            _summary.push(`💰 Saldo (Fornecimento): ${_counters['saldo']} pacotes`);
                                        }
                                        if (_counters['24hrs'] === 0 && _counters['saldo'] === 0) {
                                            _summary.push(`⚠️ Nenhum pacote válido detectado. O fornecimento aceita: diários (24hrs) e saldo.`);
                                        }
                                        _contexto = '\n📍 *Contexto:* Tabela exclusiva do Grupo de Fornecimento';
                                    } else {
                                        // GRUPO NORMAL / ESTUDANTES DE REVENDEDOR:
                                        if (_counters['24hrs'] > 0) _summary.push(`⏰ Diários: ${_counters['24hrs']} pacotes`);
                                        if (_counters['semanal'] > 0) _summary.push(`📆 Semanais: ${_counters['semanal']} pacotes`);
                                        if (_counters['mensal'] > 0) _summary.push(`🗓 Mensais: ${_counters['mensal']} pacotes`);
                                        if (_counters['ilimitado'] > 0) _summary.push(`📞 Ilimitados: ${_counters['ilimitado']} pacotes`);
                                        if (_counters['especiais'] > 0) _summary.push(`🚀 Especiais/Estudantes: ${_counters['especiais']} pacotes`);
                                        if (_counters['saldo'] > 0) {
                                            _grpCfg.TABELAS['saldo'] = _newTabelas['saldo'];
                                            _configObj.TABELAS_SALDO = _newTabelas['saldo'];
                                            _configObj.TABELAS_FORNECIMENTO = _newTabelas['saldo'];
                                            if (!_grpCfg.TABELAS['24hrs'] || Object.keys(_grpCfg.TABELAS['24hrs']).length === 0) {
                                                _grpCfg.TABELAS['24hrs'] = _newTabelas['saldo'];
                                            }
                                            _summary.push(`💰 Saldo (Fornecimento): ${_counters['saldo']} pacotes`);
                                        }
                                        _contexto = '\n📍 *Contexto:* Tabela deste grupo';
                                    }

                                    if (_cabText) {
                                        _grpCfg.cabecalho_menu = _cabText;
                                    } else {
                                        delete _grpCfg.cabecalho_menu;
                                    }

                                    // Atualizar em memória imediatamente para que pagamentos e o menu sejam reconhecidos
                                    _0x7d9007[_0x37fcf7] = (_newTabelas['24hrs'] && Object.keys(_newTabelas['24hrs']).length > 0) ? _newTabelas['24hrs'] : (_newTabelas['saldo'] || {});
                                    try {
                                        TABELA = _0x7d9007[_0x37fcf7];
                                    } catch(e){}
                                    _0x1ca1fd('🔧 Tabela do grupo atualizada em memória: ' + _0x37fcf7.split('@')[0], 'info');
                                } else {
                                // PRIVADO (PV): verificar se a mensagem veio do WhatsApp de Fornecimento ou do Normal
                                if (_isMsgFornecimento) {
                                    // PV DO WHATSAPP DE FORNECIMENTO: guardar em TABELAS_FORNECIMENTO
                                    if (_counters['24hrs'] > 0) {
                                        _configObj.TABELAS_FORNECIMENTO = _newTabelas['24hrs'];
                                        let _fornecJidKey = '';
                                        try {
                                            const _lcKey = JSON.parse(require('fs').readFileSync(require('path').join(global._kanetBase || __dirname, 'local_config.json'), 'utf8'));
                                            _fornecJidKey = (_lcKey.grupo_fornecimento || '').trim();
                                        } catch(e) {}
                                        if (_fornecJidKey) {
                                            if (!_configObj.TABELAS_GRUPO) _configObj.TABELAS_GRUPO = {};
                                            if (!_configObj.TABELAS_GRUPO[_fornecJidKey]) _configObj.TABELAS_GRUPO[_fornecJidKey] = { TABELAS: {}, PLANOS_ESPECIAIS: {} };
                                            _configObj.TABELAS_GRUPO[_fornecJidKey].TABELAS['24hrs'] = _newTabelas['24hrs'];
                                        }
                                        _summary.push(`⏰ Diários (Fornecimento): ${_counters['24hrs']} pacotes`);
                                    }
                                    if (_counters['saldo'] > 0) {
                                        _configObj.TABELAS_SALDO = _newTabelas['saldo'];
                                        _summary.push(`💰 Saldo (Fornecimento): ${_counters['saldo']} pacotes`);
                                    }
                                    console.log('⚡ [FORNECIMENTO] Configuração no PV salva exclusivamente para o Fornecimento');
                                    _contexto = '\n📍 *Contexto:* Tabela do Sistema de Fornecimento (PV)';
                                } else {
                                    // PV DO WHATSAPP NORMAL (REVENDEDOR): guardar na Tabela Global do Revendedor
                                    if (_counters['24hrs'] > 0) {
                                        _configObj.TABELAS['24hrs'] = _newTabelas['24hrs'];
                                        _summary.push(`⏰ Diários: ${_counters['24hrs']} pacotes`);
                                        // Sincronizar grupos existentes com a nova tabela de diários
                                        if (_configObj.TABELAS_GRUPO) {
                                            for (const _gid of Object.keys(_configObj.TABELAS_GRUPO)) {
                                                if (_configObj.TABELAS_GRUPO[_gid] && _configObj.TABELAS_GRUPO[_gid].TABELAS) {
                                                    _configObj.TABELAS_GRUPO[_gid].TABELAS['24hrs'] = Object.assign({}, _newTabelas['24hrs']);
                                                }
                                            }
                                        }
                                    }
                                    if (_counters['semanal'] > 0) {
                                        _configObj.TABELAS['semanal'] = _newTabelas['semanal'];
                                        _summary.push(`📆 Semanais: ${_counters['semanal']} pacotes`);
                                    }
                                    if (_counters['mensal'] > 0) {
                                        _configObj.TABELAS['mensal'] = _newTabelas['mensal'];
                                        _summary.push(`🗓 Mensais: ${_counters['mensal']} pacotes`);
                                    }
                                    if (_counters['ilimitado'] > 0) {
                                        _configObj.TABELAS['ilimitado'] = _newTabelas['ilimitado'];
                                        _summary.push(`📞 Ilimitados: ${_counters['ilimitado']} pacotes`);
                                    }
                                    if (_counters['especiais'] > 0) {
                                        _configObj.PLANOS_ESPECIAIS = _newEspeciais;
                                        _summary.push(`🚀 Especiais: ${_counters['especiais']} pacotes`);
                                    }

                                    if (_cabText) {
                                        _configObj.cabecalho_menu = _cabText;
                                    } else {
                                        delete _configObj.cabecalho_menu;
                                    }
                                    _contexto = '\n📍 *Contexto:* Tabela global (todos os grupos do revendedor)';
                                }
                            }

                            try { delete require.cache[require.resolve(_cfgFile)]; } catch(_ce) {}
                            _fs.writeFileSync(_cfgFile, '// GERADO PELO PAINEL LOCAL KANET\nmodule.exports = ' + JSON.stringify(_configObj, null, 4) + ';\n', 'utf8');
                            try { delete require.cache[require.resolve(_cfgFile)]; } catch(_ce) {}
                            _DYN_CFG = _configObj;
                            global._botCfg = _configObj;
                            if (typeof global._DYN_CFG !== 'undefined') global._DYN_CFG = _configObj;

                            let _successMsg = `✅ *TABELA COMPLETA ATUALIZADA!*\n━━━━━━━━━━━━━━━━━━━\n📊 *${_totalParsed} pacotes* importados com sucesso:\n\n${_summary.join('\n')}${_contexto}`;
                            if (_cabText) {
                                _successMsg += `\n\n👑 *Cabeçalho Capturado:*\n${_cabText}`;
                            }
                            _successMsg += `\n\n🔄 Configurações aplicadas em tempo real!`;

                            await _0x461461(_0x25f8ef, _0x37fcf7, _successMsg, _0x2368aa['id']);
                        } catch (err) {
                            await _0x461461(_0x25f8ef, _0x37fcf7, `❌ *Erro ao processar tabela:* ${err.message}`, _0x2368aa['id']);
                        }
                        return;
                    }

                    // --- MODE 2: Single package (legacy format) ---
                    // .addtabela 24hrs 15 600 600MB 24h
                    const _args = _0x316b84.split(/\s+/);
                    if (_args.length < 5) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '💡 *USO DO COMANDO .addtabela*\n━━━━━━━━━━━━━━━━━━━\n\n*MODO 1 — Tabela Completa:*\nCole a tabela formatada inteira após `.addtabela`\n\n*MODO 2 — Pacote Individual:*\n`.addtabela [categoria] [preco] [qtd_mb] [nome]`\n*Exemplo:* `.addtabela 24hrs 15 600 600MB 24h`\n\n*Categorias:* `24hrs`, `semanal`, `mensal`, `ilimitado`, `saldo`', _0x2368aa['id']);
                        return;
                    }

                    const _cat = _args[1].trim();
                    const _preco = _args[2].trim();
                    const _qtd = parseInt(_args[3].trim());
                    const _nomePack = _args.slice(4).join(' ').trim();

                    const _validCats = ['24hrs', 'semanal', 'mensal', 'ilimitado', 'saldo'];
                    if (!_validCats.includes(_cat)) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '⚠️ *Categoria inválida!*\nEscolha entre: `24hrs`, `semanal`, `mensal`, `ilimitado`, `saldo`', _0x2368aa['id']);
                        return;
                    }
                    if (isNaN(_qtd)) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '⚠️ *Quantidade inválida!* Insira o número de MB (ex: 1000).', _0x2368aa['id']);
                        return;
                    }

                    try {
                        const _fs = require('fs');
                        const _path = require('path');
                        const _cfgFile = _path.join(global._kanetBase || __dirname, 'bot_config.js');

                        try { delete require.cache[require.resolve(_cfgFile)]; } catch(_ce) {}
                        let _configObj = _fs.existsSync(_cfgFile) ? require(_cfgFile) : {};

                        if (!_configObj.TABELAS) _configObj.TABELAS = {};
                        if (!_configObj.TABELAS[_cat]) _configObj.TABELAS[_cat] = {};

                        _configObj.TABELAS[_cat][_preco] = {
                            quantidade: _qtd,
                            nome: _nomePack,
                            quantidade_mb: _qtd,
                            periodo: _cat,
                            tipo: _cat
                        };

                        if (_cat === 'saldo') {
                            if (!_configObj.TABELAS_SALDO) _configObj.TABELAS_SALDO = {};
                            _configObj.TABELAS_SALDO[_preco] = {
                                quantidade: _qtd,
                                nome: _nomePack,
                                quantidade_mb: _qtd
                            };
                        }

                        _fs.writeFileSync(_cfgFile, '// GERADO PELO PAINEL LOCAL KANET\nmodule.exports = ' + JSON.stringify(_configObj, null, 4) + ';\n', 'utf8');
                        _DYN_CFG = _configObj;

                        await _0x461461(_0x25f8ef, _0x37fcf7, `✅ *TABELA ATUALIZADA COM SUCESSO!*\n━━━━━━━━━━━━━━━━━━━\n📁 *Categoria:* ${_cat}\n💵 *Preço:* ${_preco} MT\n📦 *Pacote:* ${_nomePack} (${_qtd} MB)\n\n🔄 Configurações aplicadas em tempo real!`, _0x2368aa['id']);
                    } catch (err) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, `❌ *Erro ao atualizar tabela:* ${err.message}`, _0x2368aa['id']);
                    }
                    return;
                }

                if (_0x316b84.startsWith('.tabelasaldo') || _0x316b84.startsWith('!tabelasaldo')) {
                    const _senderJid = (_0x457c95 || '').includes('@c.us') ? _0x457c95 : (_0x457c95 || '') + '@c.us';
                    if (!_checkIsMaster(_senderJid) && _senderJid !== _0x16260a) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '🚫 *ACESSO NEGADO*\n━━━━━━━━━━━━━━━━━━━\n⚠️ Comando restrito ao Admin Master.', _0x2368aa['id']);
                        return;
                    }

                    const _permiteSaldo = global.licencaObj && (global.licencaObj._isOwnerMode() || (global.licencaObj.licenca && global.licencaObj.licenca.permite_saldo === true));
                    if (!_permiteSaldo) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '⚠️ *RECURSO NÃO AUTORIZADO*\n━━━━━━━━━━━━━━━━━━━\nEste bot não tem autorização para vender saldo/crédito. Contacte o administrador para ativar este recurso na sua licença.', _0x2368aa['id']);
                        return;
                    }

                    const _tabelaBody = _0x519db1.substring(_0x316b84.startsWith('.tabelasaldo') ? 12 : 13).trim();
                    if (!_tabelaBody) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '💡 *USO DO COMANDO .tabelasaldo*\n━━━━━━━━━━━━━━━━━━━\n\nEnvie a lista de quantidade e preço no formato:\n`.tabelasaldo\n100 = 85 MT\n500 = 410 MT\n1000 = 820 MT`', _0x2368aa['id']);
                        return;
                    }

                    const _lines = _tabelaBody.split(/\n/);
                    const _newSaldo = {};
                    let _count = 0;
                    let _cabecalhoCustom = null;

                    for (let i = 0; i < _lines.length; i++) {
                        const _rawLine = _lines[i];
                        const _line = _rawLine.replace(/[*_~`]/g, '').trim();
                        if (!_line) continue;

                        if (!_line.includes('=')) {
                            // Se for a primeira linha não-vazia e não tem "=", tratamos como cabeçalho
                            if (_count === 0 && !_cabecalhoCustom) {
                                _cabecalhoCustom = _rawLine.trim(); // manter formatação/bold se quiserem
                                continue;
                            }
                        }

                        const _parts = _line.split('=');
                        if (_parts.length >= 2) {
                            const _qtdPart = _parts[0].replace(/[^\d]/g, '').trim();
                            const _precoPart = _parts[1].replace(/[^\d]/g, '').trim();
                            if (_qtdPart && _precoPart) {
                                const _qtd = parseInt(_qtdPart);
                                const _preco = _precoPart;
                                _newSaldo[_preco] = {
                                    quantidade: _qtd,
                                    nome: 'Saldo ' + _qtd + ' MT',
                                    quantidade_mb: _qtd,
                                    periodo: 'imediato',
                                    tipo: 'saldo',
                                    input_val: String(_qtd),
                                    porta_obrigatoria: 8777,
                                    permite_retry: true
                                };
                                _count++;
                            }
                        }
                    }

                    if (_count === 0) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '⚠️ *Nenhum pacote de saldo válido detectado!*\nUse o formato: `quantidade = preço MT` (ex: `100 = 85 MT`)', _0x2368aa['id']);
                        return;
                    }

                    try {
                        const _fs = require('fs');
                        const _path = require('path');
                        const _cfgFile = _path.join(global._kanetBase || __dirname, 'bot_config.js');

                        try { delete require.cache[require.resolve(_cfgFile)]; } catch(_ce) {}
                        let _configObj = _fs.existsSync(_cfgFile) ? require(_cfgFile) : {};

                        const _isGroup = !!_0x2368aa['isGroupMsg'] || (_0x37fcf7 && _0x37fcf7.includes('@g.us'));
                        let _contexto = '';

                        if (_isMsgFornecimento) {
                            // WHATSAPP DE FORNECIMENTO: guardar em TABELAS_SALDO (exclusivo)
                            _configObj.TABELAS_SALDO = _newSaldo;
                            if (_isGroup) {
                                if (!_configObj.TABELAS_GRUPO) _configObj.TABELAS_GRUPO = {};
                                if (!_configObj.TABELAS_GRUPO[_0x37fcf7]) {
                                    _configObj.TABELAS_GRUPO[_0x37fcf7] = { TABELAS: {}, PLANOS_ESPECIAIS: {} };
                                }
                                if (!_configObj.TABELAS_GRUPO[_0x37fcf7].TABELAS) _configObj.TABELAS_GRUPO[_0x37fcf7].TABELAS = {};
                                _configObj.TABELAS_GRUPO[_0x37fcf7].TABELAS['saldo'] = _newSaldo;
                                if (_cabecalhoCustom) {
                                    _configObj.TABELAS_GRUPO[_0x37fcf7].cabecalho_saldo = _cabecalhoCustom;
                                } else {
                                    delete _configObj.TABELAS_GRUPO[_0x37fcf7].cabecalho_saldo;
                                }
                            } else {
                                if (_cabecalhoCustom) {
                                    _configObj.cabecalho_saldo = _cabecalhoCustom;
                                } else {
                                    delete _configObj.cabecalho_saldo;
                                }
                            }
                            console.log('⚡ [FORNECIMENTO] Tabela de saldo atualizada via .tabelasaldo');
                            _contexto = '\n📍 *Contexto:* Tabela de saldo do sistema de Fornecimento';
                        } else if (_isGroup) {
                            // WHATSAPP NORMAL — GRUPO: guardar na tabela específica do grupo
                            if (!_configObj.TABELAS_GRUPO) _configObj.TABELAS_GRUPO = {};
                            if (!_configObj.TABELAS_GRUPO[_0x37fcf7]) {
                                _configObj.TABELAS_GRUPO[_0x37fcf7] = { TABELAS: {}, PLANOS_ESPECIAIS: {} };
                            }
                            if (!_configObj.TABELAS_GRUPO[_0x37fcf7].TABELAS) _configObj.TABELAS_GRUPO[_0x37fcf7].TABELAS = {};
                            _configObj.TABELAS_GRUPO[_0x37fcf7].TABELAS['saldo'] = _newSaldo;
                            if (_cabecalhoCustom) {
                                _configObj.TABELAS_GRUPO[_0x37fcf7].cabecalho_saldo = _cabecalhoCustom;
                            } else {
                                delete _configObj.TABELAS_GRUPO[_0x37fcf7].cabecalho_saldo;
                            }
                            _contexto = '\n📍 *Contexto:* Tabela de saldo deste grupo';
                        } else {
                            // WHATSAPP NORMAL — PRIVADO: guardar na tabela global
                            if (!_configObj.TABELAS) _configObj.TABELAS = {};
                            _configObj.TABELAS['saldo'] = _newSaldo;
                            if (_cabecalhoCustom) {
                                _configObj.cabecalho_saldo = _cabecalhoCustom;
                            } else {
                                delete _configObj.cabecalho_saldo;
                            }
                            _contexto = '\n📍 *Contexto:* Tabela de saldo global';
                        }

                        _fs.writeFileSync(_cfgFile, '// GERADO PELO PAINEL LOCAL KANET\nmodule.exports = ' + JSON.stringify(_configObj, null, 4) + ';\n', 'utf8');
                        _DYN_CFG = _configObj;

                        let _msgSucesso = `✅ *TABELA DE SALDO ATUALIZADA!*\n━━━━━━━━━━━━━━━━━━━\n📊 *${_count} pacotes* salvos com sucesso.`;
                        if (_cabecalhoCustom) {
                            _msgSucesso += `\n👑 *Cabeçalho:* ${_cabecalhoCustom}`;
                        }
                        _msgSucesso += `${_contexto}\n\n🔄 Configurações aplicadas em tempo real!`;

                        await _0x461461(_0x25f8ef, _0x37fcf7, _msgSucesso, _0x2368aa['id']);
                    } catch (err) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, `❌ *Erro ao atualizar tabela de saldo:* ${err.message}`, _0x2368aa['id']);
                    }
                    return;
                }

                if (_0x316b84.startsWith('.addpagamento') || _0x316b84.startsWith('!addpagamento')) {
                    const _senderJid = (_0x457c95 || '').includes('@c.us') ? _0x457c95 : (_0x457c95 || '') + '@c.us';
                    if (!_checkIsMaster(_senderJid) && _senderJid !== _0x16260a) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '🚫 *ACESSO NEGADO*\n━━━━━━━━━━━━━━━━━━━\n⚠️ Comando restrito ao Admin Master.', _0x2368aa['id']);
                        return;
                    }

                    // Obter o corpo do texto (removendo .addpagamento ou !addpagamento)
                    const _body = _0x519db1.substring(_0x316b84.startsWith('.addpagamento') ? 13 : 14).trim();
                    if (!_body) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '💡 *USO CORRETO DO COMANDO:*\n━━━━━━━━━━━━━━━━━━━\n*.addpagamento [mpesa/emola] [numero] [nome_titular]*\n\n*Ou simplesmente cole a mensagem completa de pagamento:* \n`.addpagamento [mensagem completa com M-Pesa/E-Mola e Suporte]`', _0x2368aa['id']);
                        return;
                    }

                    try {
                        const _fs = require('fs');
                        const _path = require('path');
                        const _cfgFile = _path.join(global._kanetBase || __dirname, 'local_config.json');

                        if (!_fs.existsSync(_cfgFile)) {
                            await _0x461461(_0x25f8ef, _0x37fcf7, '❌ *Erro:* Arquivo local_config.json não encontrado.', _0x2368aa['id']);
                            return;
                        }

                        let _localObj = JSON.parse(_fs.readFileSync(_cfgFile, 'utf8'));
                        
                        // Verificar se é uma mensagem de colagem completa (contém quebras de linha ou strings longas)
                        const _isFullPaste = _body.includes('\n') || _body.length > 60;

                        if (_isFullPaste) {
                            // Função auxiliar de parse inteligente
                            const parsePagamentoCompleto = (texto) => {
                                let mpesa_number = '';
                                let mpesa_name = '';
                                let emola_number = '';
                                let emola_name = '';
                                let master_number = '';

                                const linhas = texto.split('\n').map(l => l.trim());

                                // 1. Procurar M-Pesa
                                for (let i = 0; i < linhas.length; i++) {
                                    const linha = linhas[i].replace(/[*_~`]/g, '');
                                    if (/m-pesa|mpesa/i.test(linha)) {
                                        for (let j = i; j <= Math.min(i + 2, linhas.length - 1); j++) {
                                            const numMatch = linhas[j].match(/(8[2-7]\d{7})/);
                                            if (numMatch) {
                                                mpesa_number = numMatch[1];
                                                for (let k = j + 1; k <= Math.min(j + 2, linhas.length - 1); k++) {
                                                    const nomeLinha = linhas[k].replace(/[👤👤*#_~`]/g, '').trim();
                                                    if (nomeLinha && !/(?:m-pesa|mpesa|e-mola|emola|suporte|chamada)/i.test(nomeLinha) && nomeLinha.length > 3) {
                                                        mpesa_name = nomeLinha;
                                                        break;
                                                    }
                                                }
                                                break;
                                            }
                                        }
                                    }
                                }

                                // 2. Procurar E-Mola
                                for (let i = 0; i < linhas.length; i++) {
                                    const linha = linhas[i].replace(/[*_~`]/g, '');
                                    if (/e-mola|emola/i.test(linha)) {
                                        for (let j = i; j <= Math.min(i + 2, linhas.length - 1); j++) {
                                            const numMatch = linhas[j].match(/(8[2-7]\d{7})/);
                                            if (numMatch) {
                                                emola_number = numMatch[1];
                                                for (let k = j + 1; k <= Math.min(j + 2, linhas.length - 1); k++) {
                                                    const nomeLinha = linhas[k].replace(/[👤👤*#_~`]/g, '').trim();
                                                    if (nomeLinha && !/(?:m-pesa|mpesa|e-mola|emola|suporte|chamada)/i.test(nomeLinha) && nomeLinha.length > 3) {
                                                        emola_name = nomeLinha;
                                                        break;
                                                    }
                                                }
                                                break;
                                            }
                                        }
                                    }
                                }

                                // 3. Procurar Suporte/Chamadas
                                let whatsappNum = '';
                                let chamadasNum = '';
                                for (let i = 0; i < linhas.length; i++) {
                                    const linha = linhas[i].replace(/[*_~`]/g, '');
                                    if (/suporte|whatsapp|chamada/i.test(linha)) {
                                        const numMatch = linha.match(/(8[2-7]\d{7})/);
                                        if (numMatch) {
                                            if (/whatsapp/i.test(linha)) {
                                                whatsappNum = numMatch[1];
                                            } else if (/chamada/i.test(linha)) {
                                                chamadasNum = numMatch[1];
                                            } else if (!whatsappNum) {
                                                whatsappNum = numMatch[1];
                                            }
                                        } else {
                                            for (let j = i + 1; j <= Math.min(j + 2, linhas.length - 1); j++) {
                                                const nextNumMatch = linhas[j].match(/(8[2-7]\d{7})/);
                                                if (nextNumMatch) {
                                                    if (/whatsapp/i.test(linhas[j]) || /whatsapp/i.test(linha)) {
                                                        whatsappNum = nextNumMatch[1];
                                                    } else if (/chamada/i.test(linhas[j]) || /chamada/i.test(linha)) {
                                                        chamadasNum = nextNumMatch[1];
                                                    } else if (!whatsappNum) {
                                                        whatsappNum = nextNumMatch[1];
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }

                                if (whatsappNum) {
                                    master_number = whatsappNum;
                                    if (chamadasNum && chamadasNum !== whatsappNum) {
                                        master_number += ',' + chamadasNum;
                                    }
                                }

                                return { mpesa_number, mpesa_name, emola_number, emola_name, master_number };
                            };

                            const parsed = parsePagamentoCompleto(_body);

                            if (parsed.mpesa_number) {
                                _localObj.mpesa_number = parsed.mpesa_number;
                                if (parsed.mpesa_name) _localObj.mpesa_name = parsed.mpesa_name;
                            }
                            if (parsed.emola_number) {
                                _localObj.emola_number = parsed.emola_number;
                                if (parsed.emola_name) _localObj.emola_name = parsed.emola_name;
                            }
                            if (parsed.master_number) {
                                _localObj.master_number = parsed.master_number;
                            }

                            // Guardar a mensagem inteira como template
                            _localObj.template_pagamento = _body;

                            _fs.writeFileSync(_cfgFile, JSON.stringify(_localObj, null, 2), 'utf8');

                            let _respMsg = `✅ *MENSAGEM DE PAGAMENTO CONFIGURADA!* 💳\n━━━━━━━━━━━━━━━━━━━\nO template completo foi guardado e será usado nos menus.\n\n📊 *Dados Extraídos:*`;
                            if (parsed.mpesa_number) _respMsg += `\n📱 *M-Pesa:* ${parsed.mpesa_number} (${parsed.mpesa_name || 'N/A'})`;
                            if (parsed.emola_number) _respMsg += `\n📱 *E-Mola:* ${parsed.emola_number} (${parsed.emola_name || 'N/A'})`;
                            if (parsed.master_number) _respMsg += `\n📞 *Suporte:* ${parsed.master_number}`;
                            
                            _respMsg += `\n\n🔄 Configurações aplicadas em tempo real!`;

                            await _0x461461(_0x25f8ef, _0x37fcf7, _respMsg, _0x2368aa['id']);
                        } else {
                            // Modo legado de uma linha: .addpagamento mpesa 84...
                            const _args = _body.split(/\s+/);
                            if (_args.length < 3) {
                                await _0x461461(_0x25f8ef, _0x37fcf7, '💡 *USO CORRETO DO COMANDO:*\n━━━━━━━━━━━━━━━━━━━\n*.addpagamento [mpesa/emola] [numero] [nome_titular]*', _0x2368aa['id']);
                                return;
                            }

                            // Dividir blocos nos tokens "mpesa" ou "emola"
                            const _blocos = _body.split(/(?=\b(?:mpesa|emola)\b)/i).map(b => b.trim()).filter(b => b.length > 0);

                            const _atualizados = [];
                            const _erros = [];

                            for (const _bloco of _blocos) {
                                const _partes = _bloco.trim().split(/\s+/);
                                const _tipoB = (_partes[0] || '').toLowerCase();
                                const _numB = (_partes[1] || '').trim();
                                const _nomeB = _partes.slice(2).join(' ').trim();

                                if (_tipoB !== 'mpesa' && _tipoB !== 'emola') {
                                    _erros.push(`Tipo inválido: *${_tipoB}*`);
                                    continue;
                                }
                                if (!_numB || !/^\d{6,15}$/.test(_numB)) {
                                    _erros.push(`Número inválido para ${_tipoB.toUpperCase()}: *${_numB || '(vazio)'}*`);
                                    continue;
                                }
                                if (!_nomeB) {
                                    _erros.push(`Nome em falta para ${_tipoB.toUpperCase()} ${_numB}`);
                                    continue;
                                }

                                if (_tipoB === 'mpesa') {
                                    _localObj.mpesa_number = _numB;
                                    _localObj.mpesa_name = _nomeB;
                                    _atualizados.push(`💳 *M-Pesa:* ${_numB} — ${_nomeB}`);
                                } else {
                                    _localObj.emola_number = _numB;
                                    _localObj.emola_name = _nomeB;
                                    _atualizados.push(`💳 *e-Mola:* ${_numB} — ${_nomeB}`);
                                }
                            }

                            // Limpar template customizado já que configurou manualmente de forma simples
                            delete _localObj.template_pagamento;

                            if (_atualizados.length > 0) {
                                _fs.writeFileSync(_cfgFile, JSON.stringify(_localObj, null, 2), 'utf8');
                            }

                            let _resposta = '';
                            if (_atualizados.length > 0) {
                                _resposta += `✅ *FORMAS DE PAGAMENTO ATUALIZADAS!*\n━━━━━━━━━━━━━━━━━━━\n${_atualizados.join('\n')}\n\n🔄 Aplicadas em tempo real!`;
                            }
                            if (_erros.length > 0) {
                                _resposta += (_resposta ? '\n\n' : '') + `⚠️ *Erros encontrados:*\n${_erros.join('\n')}`;
                            }

                            await _0x461461(_0x25f8ef, _0x37fcf7, _resposta || '⚠️ Nenhuma alteração efectuada.', _0x2368aa['id']);
                        }
                    } catch (err) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, `❌ *Erro ao atualizar pagamento:* ${err.message}`, _0x2368aa['id']);
                    }
                    return;
                }
                if (_0x316b84['startsWith']('.enviar') || _0x316b84['startsWith']('!enviar')) {
                    await _0x1f8704(_0x25f8ef, _0x37fcf7, _0x519db1, _0x2368aa['id'], _0x457c95, '24hrs');
                    return;
                }
                if (_0x316b84['startsWith']('.semanal') || _0x316b84['startsWith']('!semanal')) {
                    await _0x1f8704(_0x25f8ef, _0x37fcf7, _0x519db1, _0x2368aa['id'], _0x457c95, 'semanal');
                    return;
                }
                if (_0x316b84['startsWith']('.mensal') || _0x316b84['startsWith']('!mensal')) {
                    await _0x1f8704(_0x25f8ef, _0x37fcf7, _0x519db1, _0x2368aa['id'], _0x457c95, 'mensal');
                    return;
                }
                // ── COMANDO .banir ──────────────────────────────────────────
                if (_0x316b84['startsWith']('.banir') || _0x316b84['startsWith']('!banir')) {
                    try {
                        // Apenas o dono autorizado pode usar
                        const _banirSender = (_0x457c95 || '').includes('@c.us') ? _0x457c95 : (_0x457c95 || '') + '@c.us';
                        const _isAuthorizedBan = _checkIsMaster(_banirSender);
                        const _isGroupAdmin = _0x2368aa['isGroupMsg']
                            ? await _0x25f8ef['getGroupAdmins'](_0x37fcf7).then(_a => _a.includes(_banirSender)).catch(() => false)
                            : false;
                        if (!_isAuthorizedBan && !_isGroupAdmin) {
                            await _0x461461(_0x25f8ef, _0x37fcf7, '🚫 *ACESSO NEGADO*\n━━━━━━━━━━━━━━━━━━\n⚠️ Apenas administradores podem usar .banir.', _0x2368aa['id']);
                            return;
                        }
                        // Extrair número mencionado (menção @, quoted, ou texto)
                        let _banirNumeroRaw = null;
                        // 1) Menção @número
                        const _banirMencao = _0x2368aa['mentionedJidList'] && _0x2368aa['mentionedJidList'].length > 0
                            ? _0x2368aa['mentionedJidList'][0] : null;
                        if (_banirMencao) {
                            _banirNumeroRaw = _banirMencao.replace('@c.us', '').replace('@s.whatsapp.net', '');
                        } else {
                            // 2) Número digitado após o comando: .banir 258XXXXXXXXX
                            const _banirParts = _0x519db1.trim().split(/\s+/);
                            if (_banirParts.length >= 2) _banirNumeroRaw = _banirParts[1].replace(/\D/g, '');
                        }
                        if (!_banirNumeroRaw) {
                            await _0x461461(_0x25f8ef, _0x37fcf7,
                                '🔥 *COMO USAR .banir*\n━━━━━━━━━━━━━━━━━━━━━━━━\n' +
                                '📝 Formato: .banir [número]\n' +
                                '📝 Exemplos:\n' +
                                '.banir 856116039\n' +
                                '.banir 258856116039\n' +
                                'Ou mencione o utilizador: .banir @contacto\n' +
                                '━━━━━━━━━━━━━━━━━━━━━━━━',
                                _0x2368aa['id']);
                            return;
                        }
                        // Normalizar número para formato 258XXXXXXXXX
                        if (/^8[2-7]\d{7}$/.test(_banirNumeroRaw)) _banirNumeroRaw = '258' + _banirNumeroRaw;
                        if (!/^2588[2-7]\d{7}$/.test(_banirNumeroRaw)) {
                            await _0x461461(_0x25f8ef, _0x37fcf7,
                                '❌ *Número inválido!*\n📱 Use: 856116039 ou 258856116039',
                                _0x2368aa['id']);
                            return;
                        }
                        const _banirJid = _banirNumeroRaw + '@c.us';
                        // Adicionar à lista global de banidos
                        if (!global['numerosBanidos']) global['numerosBanidos'] = new Set();
                        global['numerosBanidos'].add(_banirJid);
                        // Salvar no banco de dados para persistência
                        await _0x51dcba('INSERT OR IGNORE INTO banidos (jid, admin) VALUES (?, ?)', [_banirJid, _banirSender]);
                        _0x1ca1fd('🔨 Banindo ' + _banirJid + ' de todos os grupos (Persistente)', 'warning');
                        
                        // 1. REMOÇÃO IMEDIATA DO GRUPO ATUAL (Prioridade)
                        if (_0x2368aa['isGroupMsg']) {
                            try {
                                await _0x25f8ef['removeParticipant'](_0x37fcf7, _banirJid);
                                _0x1ca1fd('✅ Removido imediatamente do grupo atual: ' + _0x37fcf7, 'success');
                            } catch (_eCurrent) {
                                _0x1ca1fd('⚠️ Falha ao remover do grupo atual: ' + _eCurrent.message, 'warning');
                            }
                        }

                        // 2. BUSCAR TODOS OS GRUPOS E REMOVER DO RESTANTE
                        let _todosGrupos = [];
                        try {
                            _todosGrupos = await _0x25f8ef['getAllGroups']();
                        } catch (_eGrupos) {
                            _0x1ca1fd('⚠️ Erro ao buscar lista de grupos: ' + _eGrupos.message, 'error');
                        }

                        let _gruposRemovidos = 0, _gruposNaoAdmin = 0;
                        for (const _grupo of _todosGrupos) {
                            const _gid = _grupo.id && _grupo.id._serialized ? _grupo.id._serialized : (_grupo.id || _grupo.gid || '');
                            if (!_gid || _gid === _0x37fcf7) continue; // Ignorar nulo ou o que já removemos
                            
                            try {
                                // Tentar remover direto (mais garantido que checar lista de participantes)
                                await _0x25f8ef['removeParticipant'](_gid, _banirJid);
                                _gruposRemovidos++;
                                _0x1ca1fd('✅ Removido de: ' + _gid, 'success');
                                await new Promise(r => setTimeout(r, 500)); // delay curto para evitar bloqueio
                            } catch (_eRem) {
                                if (_eRem.message && _eRem.message.toLowerCase().includes('admin')) {
                                    _gruposNaoAdmin++;
                                }
                                // Se o erro for que o usuário não está no grupo, apenas ignoramos silenciosamente
                            }
                        }
                        
                        const _banirMsg =
                            '🔨 *BANIMENTO EXECUTADO*\n' +
                            '━━━━━━━━━━━━━━━━━━━━━━━━\n' +
                            '📱 *Número:* ' + _banirNumeroRaw + '\n' +
                            '✅ *Removido de:* ' + (_gruposRemovidos + (_0x2368aa['isGroupMsg'] ? 1 : 0)) + ' grupo(s)\n' +
                            (_gruposNaoAdmin > 0 ? '⚠️ *Sem permissão em:* ' + _gruposNaoAdmin + ' grupo(s)\n' : '') +
                            '🔒 *Monitoramento:* ATIVO (será removido automaticamente se voltar)\n' +
                            '━━━━━━━━━━━━━━━━━━━━━━━━\n' +
                            '🛡️ Para desbanir use: .desbanir ' + _banirNumeroRaw;
                        await _0x461461(_0x25f8ef, _0x37fcf7, _banirMsg, _0x2368aa['id']);
                        _0x1ca1fd('🔨 Banimento concluído: ' + _banirNumeroRaw + ', grupos=' + _gruposRemovidos, 'success');
                    } catch (_errBanir) {
                        _0x1ca1fd('❌ Erro no .banir: ' + _errBanir.message, 'error');
                        await _0x461461(_0x25f8ef, _0x37fcf7, '❌ Erro ao banir: ' + _errBanir.message, _0x2368aa['id']);
                    }
                    return;
                }
                // ── COMANDO .desbanir ───────────────────────────────────────
                if (_0x316b84['startsWith']('.desbanir') || _0x316b84['startsWith']('!desbanir')) {
                    try {
                        const _desbanirSender = (_0x457c95 || '').includes('@c.us') ? _0x457c95 : (_0x457c95 || '') + '@c.us';
                        const _isAuthDesbanir = _checkIsMaster(_desbanirSender);
                        const _isAdminDesbanir = _0x2368aa['isGroupMsg']
                            ? await _0x25f8ef['getGroupAdmins'](_0x37fcf7).then(_a => _a.includes(_desbanirSender)).catch(() => false)
                            : false;
                        if (!_isAuthDesbanir && !_isAdminDesbanir) {
                            await _0x461461(_0x25f8ef, _0x37fcf7, '🚫 *ACESSO NEGADO*\nApenas administradores podem usar .desbanir.', _0x2368aa['id']);
                            return;
                        }
                        const _desbanirParts = _0x519db1.trim().split(/\s+/);
                        let _desbanirNumeroRaw = _desbanirParts.length >= 2 ? _desbanirParts[1].replace(/\D/g, '') : null;
                        if (_desbanirNumeroRaw && /^8[2-7]\d{7}$/.test(_desbanirNumeroRaw)) _desbanirNumeroRaw = '258' + _desbanirNumeroRaw;
                        if (!_desbanirNumeroRaw || !/^2588[2-7]\d{7}$/.test(_desbanirNumeroRaw)) {
                            await _0x461461(_0x25f8ef, _0x37fcf7, '❌ Número inválido. Uso: .desbanir 258856xxxxxx', _0x2368aa['id']);
                            return;
                        }
                        const _desbanirJid = _desbanirNumeroRaw + '@c.us';
                        if (global['numerosBanidos']) global['numerosBanidos'].delete(_desbanirJid);
                        // Remover do banco de dados
                        await _0x2c5e52('DELETE FROM banidos WHERE jid = ?', [_desbanirJid]);
                        await _0x461461(_0x25f8ef, _0x37fcf7,
                            '✅ *DESBANIDO*\n━━━━━━━━━━━━━━━━━━\n📱 *Número:* ' + _desbanirNumeroRaw + '\n🔓 O número pode voltar aos grupos normalmente.',
                            _0x2368aa['id']);
                        _0x1ca1fd('✅ Desbanido: ' + _desbanirNumeroRaw, 'success');
                    } catch (_errDesbanir) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '❌ Erro ao desbanir: ' + _errDesbanir.message, _0x2368aa['id']);
                    }
                    return;
                }
                // ── LISTAR BANIDOS ────────────────────────────────────────────
                if (_0x316b84 === '.banidos' || _0x316b84 === '!banidos') {
                    const _banidosArr = global['numerosBanidos'] ? [...global['numerosBanidos']] : [];
                    const _banidosMsg = _banidosArr.length > 0
                        ? '🔒 *NÚMEROS BANIDOS (' + _banidosArr.length + ')*\n━━━━━━━━━━━━━━━━━━\n' +
                          _banidosArr.map((_b, _i) => (_i + 1) + '. ' + _b.replace('@c.us', '')).join('\n') +
                          '\n━━━━━━━━━━━━━━━━━━\n💡 Use .desbanir [número] para remover da lista.'
                        : '✅ Nenhum número banido no momento.';
                    await _0x461461(_0x25f8ef, _0x37fcf7, _banidosMsg, _0x2368aa['id']);
                    return;
                }
                // --- SISTEMA DE INDICAÇÃO (REFERRAL) ---
                if (_0x316b84.startsWith('.convite') || _0x316b84.startsWith('!convite') || _0x316b84.startsWith('.codigo') || _0x316b84.startsWith('!codigo')) {
                    const _meuJid = _0x31d398(_37fcf7 || _0x37fcf7);
                    const _msgBonus = `🎁 *GANHE BÓNUS INDICANDO AMIGOS*\n\nGanhe *200MB* em cada compra feita por amigos que usarem o seu código!\n\n🔗 *O Seu Código:* ${_meuJid}\n\n💡 *Como funciona?*\n1. Envie o seu código para um amigo.\n2. Peça para ele enviar: *.indicado ${_meuJid}*\n3. Pronto! O bónus cai automaticamente.`;
                    await _0x461461(_0x25f8ef, _0x37fcf7, _msgBonus, _0x2368aa['id']);
                    return;
                }

                if (_0x316b84.startsWith('.indicado') || _0x316b84.startsWith('!indicado')) {
                    const _parts = _0x519db1.split(/\s+/);
                    const _parentNum = _parts.length > 1 ? _parts[1] : null;
                    if (!_parentNum || _parentNum.length < 8) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '❌ *CÓDIGO INVÁLIDO*\n━━━━━━━━━━━━━━━━━━━\nUse: *.indicado 8xxxxxxx*', _0x2368aa['id']);
                        return;
                    }
                    const _parentJidNorm = _parentNum.split('@')[0];
                    const _fromJidNorm = _0x457c95.split('@')[0];
                    if (_parentJidNorm === _fromJidNorm) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '❌ *ERRO*\n━━━━━━━━━━━━━━━━━━━\nVocê não pode se indicar a si mesmo!', _0x2368aa['id']);
                        return;
                    }
                    
                    const _check = await _0x3c2652('SELECT * FROM bonus_referencia WHERE jid=?', [_fromJidNorm]);
                    if (_check && _check.length > 0 && _check[0].parent_jid) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '⚠️ *AVISO*\n━━━━━━━━━━━━━━━━━━━\nVocê já foi indicado por alguém!', _0x2368aa['id']);
                        return;
                    }

                    if (_check && _check.length > 0) {
                        await _0x2c5e52('UPDATE bonus_referencia SET parent_jid=? WHERE jid=?', [_parentJidNorm, _fromJidNorm]);
                    } else {
                        await _0x2c5e52('INSERT INTO bonus_referencia (jid, parent_jid) VALUES (?, ?)', [_fromJidNorm, _parentJidNorm]);
                    }
                    await _0x2c5e52('INSERT OR IGNORE INTO bonus_referencia (jid, total_convidados) VALUES (?, 0)', [_parentJidNorm]);
                    await _0x2c5e52('UPDATE bonus_referencia SET total_convidados = IFNULL(total_convidados, 0) + 1 WHERE jid=?', [_parentJidNorm]);

                    await _0x461461(_0x25f8ef, _0x37fcf7, `✅ *SUCESSO!*\n━━━━━━━━━━━━━━━━━━━\nAgora você é indicado de *${_parentNum}*.\nSeu amigo ganhará bónus nas suas compras!`, _0x2368aa['id']);
                    return;
                }

                if (_0x316b84.startsWith('.bonus') || _0x316b84.startsWith('!bonus')) {
                    const _fromJidNorm = _0x457c95.split('@')[0];
                    const _res = await _0x3c2652('SELECT SUM(mb) as total FROM bonus_contribuicoes WHERE parent_jid=? AND status="pendente"', [_fromJidNorm]);
                    const _saldo = (_res && _res.length > 0) ? (_res[0].total || 0) : 0;
                    const _conv = await _0x3c2652('SELECT total_convidados FROM bonus_referencia WHERE jid=?', [_fromJidNorm]);
                    const _convidados = (_conv && _conv.length > 0) ? _conv[0].total_convidados : 0;
                    const _progressBarMsg = await _obterProgressBarFidelidade(_fromJidNorm);
                    let finalMsg = `👥 *Amigos Convidados:* ${_convidados}\n💰 *Saldo Acumulado:* ${_saldo}MB`;
                    if (_progressBarMsg) {
                        finalMsg += `\n\n${_progressBarMsg}`;
                    }
                    finalMsg += `\n\n🚀 Digite *.resgatar* quando atingir 1000MB!`;
                    await _0x461461(_0x25f8ef, _0x37fcf7, finalMsg, _0x2368aa['id']);
                    return;
                }

                if (_0x316b84.startsWith('.voltou') || _0x316b84.startsWith('!voltou') || _0x316b84 === 'voltou') {
                    const _fromJidNorm = _0x457c95.split('@')[0];
                    try {
                        const checkCoupon = await _0x3c2652('SELECT status FROM cupons_clientes WHERE jid = ? AND cupom = "VOLTOU"', [_fromJidNorm]);
                        if (checkCoupon && checkCoupon.length > 0) {
                            if (checkCoupon[0].status === 'usado') {
                                await _0x461461(_0x25f8ef, _0x37fcf7, '❌ *CUPOM JÁ UTILIZADO*\n━━━━━━━━━━━━━━━━━━━\nVocê já usou este cupom de reativação anteriormente.', _0x2368aa['id']);
                                return;
                            } else {
                                await _0x461461(_0x25f8ef, _0x37fcf7, '🎉 *CUPOM JÁ ATIVO!* 🚀\n━━━━━━━━━━━━━━━━━━━\nO cupom *VOLTOU* já está ativo na sua conta!\n\nVocê ganhará *+20% de bónus* na sua próxima compra de qualquer pacote. Basta pagar e enviar o comprovativo normalmente.', _0x2368aa['id']);
                                return;
                            }
                        }
                        await _0x2c5e52('INSERT INTO cupons_clientes (jid, cupom, status) VALUES (?, "VOLTOU", "ativo")', [_fromJidNorm]);
                        await _0x461461(_0x25f8ef, _0x37fcf7, '🎉 *CUPOM VOLTOU ATIVADO!* 🚀\n━━━━━━━━━━━━━━━━━━━\nVocê ganhou *+20% de bónus* na sua próxima compra de qualquer pacote!\n\n💡 Basta fazer o pagamento e enviar o comprovativo normalmente.', _0x2368aa['id']);
                        return;
                    } catch (e) {
                        _0x1ca1fd('❌ Erro ao ativar cupom no menu: ' + e.message, 'error');
                        await _0x461461(_0x25f8ef, _0x37fcf7, '❌ Erro ao ativar o cupom.', _0x2368aa['id']);
                        return;
                    }
                }

                if (_0x316b84.startsWith('.fidelidade') || _0x316b84.startsWith('!fidelidade') || _0x316b84.startsWith('.nivel') || _0x316b84.startsWith('!nivel')) {
                    const _fromJidNorm = _0x457c95.split('@')[0];
                    try {
                        const _res = await _0x3c2652('SELECT COUNT(*) as total FROM referencias WHERE (jid=? OR jid LIKE ? OR remetente=? OR remetente LIKE ?) AND status IN ("finalizado", "processada")', [_fromJidNorm, _fromJidNorm + '@%', _fromJidNorm, _fromJidNorm + '@%']);
                        const _totalCompras = (_res && _res.length > 0) ? (_res[0].total || 0) : 0;
                        
                        let _nivel = 'Bronze 🥉';
                        let _perk = 'Nenhum benefício ativo ainda. Ative mais pacotes!';
                        let _proxNivel = 'Prata 🥈';
                        let _proxNivelFaltam = 3 - _totalCompras;
                        let _pct = Math.round((_totalCompras / 3) * 100);
                        
                        if (_totalCompras >= 16) {
                            _nivel = 'Platina 💎';
                            _perk = '🔥 *15% de bónus adicional* nas indicações + *Fila de entrega prioritária*!';
                            _proxNivel = 'Nível Máximo Atingido! 🚀';
                            _proxNivelFaltam = 0;
                            _pct = 100;
                        } else if (_totalCompras >= 8) {
                            _nivel = 'Ouro 🥇';
                            _perk = '🔥 *10% de bónus adicional* nas indicações!';
                            _proxNivel = 'Platina 💎';
                            _proxNivelFaltam = 16 - _totalCompras;
                            _pct = Math.round(((_totalCompras - 8) / 8) * 100);
                        } else if (_totalCompras >= 3) {
                            _nivel = 'Prata 🥈';
                            _perk = '🔥 *5% de bónus adicional* nas indicações!';
                            _proxNivel = 'Ouro 🥇';
                            _proxNivelFaltam = 8 - _totalCompras;
                            _pct = Math.round(((_totalCompras - 3) / 5) * 100);
                        }
                        
                        if (_pct > 100) _pct = 100;
                        if (_pct < 0) _pct = 0;
                        
                        // Barra de progresso visual
                        const _charsTotal = 10;
                        const _charsFilled = Math.round((_pct / 100) * _charsTotal);
                        const _charsEmpty = _charsTotal - _charsFilled;
                        const _progressBar = '█'.repeat(_charsFilled) + '░'.repeat(_charsEmpty);
                        
                        const _nomeCliente = _0x2368aa['sender']?.['pushname'] || _0x2368aa['sender']?.['formattedName'] || 'amigo(a)';
                        
                        const _fidelityMsg = `✨ *𝗙𝗜𝗗𝗘𝗟𝗜𝗗𝗔𝗗𝗘 𝗞𝗔-𝗡𝗘𝗧 𝟮.𝟬* ✨\n━━━━━━━━━━━━━━━━━━━━\n👤 *Cliente:* ${_nomeCliente}\n📊 *Nível Ativo:* ${_nivel}\n\n🎯 *Estatísticas de Compra:*\n• Pacotes Ativados: *${_totalCompras}* pacote(s)\n${_proxNivelFaltam > 0 ? `• Próximo Nível: *${_proxNivel}* (Faltam *${_proxNivelFaltam}*)\n` : '• *Nível Máximo Atingido!*\n'}\n📈 *Barra de Progresso:*\n[${_progressBar}] ${_pct}%\n\n🎁 *Seus Benefícios Ativos:*\n${_perk}\n━━━━━━━━━━━━━━━━━━━━\n⚡ *Obrigado pela sua preferência! O seu saldo está seguro com a Ka-Net.*`;
                        
                        await _0x461461(_0x25f8ef, _0x37fcf7, _fidelityMsg, _0x2368aa['id']);
                        return;
                    } catch (e) {
                        _0x1ca1fd('❌ Erro ao buscar fidelidade no menu: ' + e.message, 'error');
                        await _0x461461(_0x25f8ef, _0x37fcf7, '❌ Erro ao consultar o nível de fidelidade.', _0x2368aa['id']);
                        return;
                    }
                }

                if (_0x316b84.startsWith('.resgatar') || _0x316b84.startsWith('!resgatar') || _0x316b84.startsWith('.resgastar') || _0x316b84.startsWith('!resgastar')) {
                    const _fromJidNorm = _0x457c95.split('@')[0];
                                        await _0x461461(_0x25f8ef, _0x37fcf7, `✅ *RESGATE REQUERIDO RECEBIDO*`, _0x2368aa['id']);
const _res = await _0x3c2652('SELECT id, mb FROM bonus_contribuicoes WHERE parent_jid=? AND status="pendente"', [_fromJidNorm]);
                    let _soma = 0; let _ids = [];
                    if (_res) { for (const _c of _res) { _soma += _c.mb; _ids.push(_c.id); if (_soma >= 1000) break; } }

                    if (_soma < 1000) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, `❌ *SALDO INSUFICIENTE*\n\n💰 Você tem: ${_soma}MB\n🎯 Necessário: 1000MB\n\nContinue convidando para ganhar mais!`, _0x2368aa['id']);
                        return;
                    }
                    
                    // --- RESOLUÇÃO DE NÚMERO SEGURA (LID-safe) ---
                    const _cmdParts = _0x519db1.trim().split(/\s+/);
                    let _num = '';
                    // 1) Número fornecido no comando: .resgatar 856116039
                    if (_cmdParts.length >= 2) {
                        let potentialNum = _cmdParts[1].trim();
                        if (/^(?:258)?8[2-7]\d{7}$/.test(potentialNum)) {
                            if (!potentialNum.startsWith('258')) potentialNum = '258' + potentialNum;
                            _num = potentialNum;
                        }
                    }
                    // 2) Se não forneceu número, pedir
                    if (!_num) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, `❌ *NÚMERO DE DESTINO OBRIGATÓRIO*\n━━━━━━━━━━━━━━━━━━━\n⚠️ Por favor, escolha para qual número enviar o bônus, digitando o comando junto com o número de destino:\n\n👉 *.resgatar [número]*\nExemplo: *.resgatar 856116039*`, _0x2368aa['id']);
                        return;
                    }

                    const _placeholders = _ids.map(() => '?').join(',');
                    await _0x2c5e52(`UPDATE bonus_contribuicoes SET status="resgatado" WHERE id IN (${_placeholders})`, _ids);
                    
                    await _0x461461(_0x25f8ef, _0x37fcf7, `🎉 *RESGATE CONCLUÍDO!*\n━━━━━━━━━━━━━━━━━━━\n✅ 1000MB foram resgatados com sucesso para o número *${_num}*!`, _0x2368aa['id']);
                    _0x149dcd({ 'ref': 'BONUS-' + Date.now(), 'jid': _0x457c95, 'numero': _num, 'quantidade': 1024, 'remetente': 'SISTEMA_BONUS', 'tipo': '24hrs' });
                    return;
                }

                if (_0x316b84 === '.ranking' || _0x316b84.startsWith('.ranking ') || _0x316b84 === 'ranking' || _0x316b84.startsWith('ranking ') || _0x316b84 === '!ranking' || _0x316b84.startsWith('!ranking ')) {
                    try {
                        const _cmdRankParts = _0x316b84.split(/\s+/);
                        const isGlobal = !_0x2368aa['isGroupMsg'] || _cmdRankParts.includes('global') || _cmdRankParts.includes('geral');

                        let seasonRow = await _0x3c2652('SELECT value FROM bot_settings WHERE key = "ranking_season_start"');
                        let inicioTemporadaStr = (seasonRow && seasonRow.length > 0) 
                            ? seasonRow[0].value 
                            : (new Date().toISOString().split('T')[0] + ' 00:00:00');

                        const seasonDate = new Date(inicioTemporadaStr);
                        const now = new Date();
                        const diffDays = Math.floor((now - seasonDate) / (1000 * 60 * 60 * 24));
                        const diasRestantes = Math.max(0, 30 - diffDays);

                        let topBuyers;
                        if (isGlobal) {
                            topBuyers = await _0x3c2652(
                                `SELECT 
                                    REPLACE(REPLACE(remetente, '@c.us', ''), '@s.whatsapp.net', '') as num_jid,
                                    SUM(quantidade) as total_mb 
                                 FROM referencias 
                                 WHERE status IN ('processada', 'finalizado', 'bloco_processado') 
                                   AND created_at >= ?
                                   AND remetente IS NOT NULL
                                   AND remetente NOT LIKE '%@g.us%'
                                   AND remetente NOT LIKE 'SISTEMA%'
                                   AND remetente NOT LIKE 'BONUS%'
                                   AND remetente NOT LIKE 'PLAN-%'
                                 GROUP BY num_jid
                                 ORDER BY total_mb DESC 
                                 LIMIT 10`, [inicioTemporadaStr]
                            );
                        } else {
                            topBuyers = await _0x3c2652(
                                `SELECT 
                                    REPLACE(REPLACE(remetente, '@c.us', ''), '@s.whatsapp.net', '') as num_jid,
                                    SUM(quantidade) as total_mb 
                                 FROM referencias 
                                 WHERE status IN ('processada', 'finalizado', 'bloco_processado') 
                                   AND created_at >= ?
                                   AND jid = ?
                                   AND remetente IS NOT NULL
                                   AND remetente NOT LIKE '%@g.us%'
                                   AND remetente NOT LIKE 'SISTEMA%'
                                   AND remetente NOT LIKE 'BONUS%'
                                   AND remetente NOT LIKE 'PLAN-%'
                                 GROUP BY num_jid
                                 ORDER BY total_mb DESC 
                                 LIMIT 10`, [inicioTemporadaStr, _0x37fcf7]
                            );
                        }

                        if (topBuyers && topBuyers.length > 0) {
                            let rankingTitle = isGlobal ? '🏆 *TOP 10 COMPRADORES DA TEMPORADA (GERAL)* 🏆' : '🏆 *TOP 10 COMPRADORES DO GRUPO* 🏆';
                            let topMsg = `${rankingTitle}\n` +
                                         `📅 Temporada iniciada em: *${inicioTemporadaStr.split(' ')[0]}*\n` +
                                         `⏳ Faltam *${diasRestantes} dias* para reiniciar!\n` +
                                         `━━━━━━━━━━━━━━━━━━━\n\n`;
                            const medalhas = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
                            topBuyers.forEach((buyer, idx) => {
                                const numRaw = (buyer.num_jid || '').replace('258', '');
                                const numMasked = numRaw.length >= 9 
                                    ? `${numRaw.substring(0, 2)}***${numRaw.substring(numRaw.length - 4)}` 
                                    : numRaw;
                                const gb = (buyer.total_mb / 1024).toFixed(1);
                                topMsg += `${medalhas[idx]} *${numMasked}* — ${gb} GB\n`;
                            });
                            
                            const clienteJidNorm = _0x457c95 ? _0x457c95.split('@')[0] : '';
                            if (clienteJidNorm) {
                                let comprasCliente;
                                if (isGlobal) {
                                    comprasCliente = await _0x3c2652(
                                        `SELECT SUM(quantidade) as total_mb 
                                         FROM referencias 
                                         WHERE status IN ('processada', 'finalizado', 'bloco_processado')
                                           AND created_at >= ?
                                           AND REPLACE(REPLACE(remetente, '@c.us', ''), '@s.whatsapp.net', '') = ?`, 
                                        [inicioTemporadaStr, clienteJidNorm]
                                    );
                                } else {
                                    comprasCliente = await _0x3c2652(
                                        `SELECT SUM(quantidade) as total_mb 
                                         FROM referencias 
                                         WHERE status IN ('processada', 'finalizado', 'bloco_processado')
                                           AND created_at >= ?
                                           AND jid = ?
                                           AND REPLACE(REPLACE(remetente, '@c.us', ''), '@s.whatsapp.net', '') = ?`, 
                                        [inicioTemporadaStr, _0x37fcf7, clienteJidNorm]
                                    );
                                }
                                const clienteTotalMB = (comprasCliente && comprasCliente[0] && comprasCliente[0].total_mb) ? comprasCliente[0].total_mb : 0;

                                if (clienteTotalMB > 0) {
                                    let posicaoRes;
                                    if (isGlobal) {
                                        posicaoRes = await _0x3c2652(
                                            `SELECT COUNT(*) + 1 as pos 
                                             FROM (
                                                 SELECT REPLACE(REPLACE(remetente, '@c.us', ''), '@s.whatsapp.net', '') as num_jid,
                                                        SUM(quantidade) as total_mb 
                                                 FROM referencias 
                                                 WHERE status IN ('processada', 'finalizado', 'bloco_processado')
                                                   AND created_at >= ?
                                                   AND remetente IS NOT NULL
                                                   AND remetente NOT LIKE '%@g.us%'
                                                   AND remetente NOT LIKE 'SISTEMA%'
                                                   AND remetente NOT LIKE 'BONUS%'
                                                 GROUP BY num_jid
                                             ) 
                                             WHERE total_mb > ?`, [inicioTemporadaStr, clienteTotalMB]
                                        );
                                    } else {
                                        posicaoRes = await _0x3c2652(
                                            `SELECT COUNT(*) + 1 as pos 
                                             FROM (
                                                 SELECT REPLACE(REPLACE(remetente, '@c.us', ''), '@s.whatsapp.net', '') as num_jid,
                                                        SUM(quantidade) as total_mb 
                                                 FROM referencias 
                                                 WHERE status IN ('processada', 'finalizado', 'bloco_processado')
                                                   AND created_at >= ?
                                                   AND jid = ?
                                                   AND remetente IS NOT NULL
                                                   AND remetente NOT LIKE '%@g.us%'
                                                   AND remetente NOT LIKE 'SISTEMA%'
                                                   AND remetente NOT LIKE 'BONUS%'
                                                 GROUP BY num_jid
                                             ) 
                                             WHERE total_mb > ?`, [inicioTemporadaStr, _0x37fcf7, clienteTotalMB]
                                        );
                                    }
                                    const clientePosicao = (posicaoRes && posicaoRes[0]) ? posicaoRes[0].pos : 0;
                                    const cliGb = (clienteTotalMB / 1024).toFixed(1);
                                    const locText = isGlobal ? 'geral' : 'no grupo';
                                    topMsg += `\n━━━━━━━━━━━━━━━━━━━\n👉 A sua posição ${locText}: *#${clientePosicao}* (${cliGb} GB comprados${isGlobal ? '' : ' no grupo'})`;
                                } else {
                                    const locText = isGlobal ? 'nesta temporada' : 'neste grupo';
                                    topMsg += `\n━━━━━━━━━━━━━━━━━━━\n👉 Ainda não tem compras ${locText}. Compre e entre no ranking! 🚀`;
                                }
                            }
                            
                            await _0x461461(_0x25f8ef, _0x37fcf7, topMsg, _0x2368aa['id']);
                        } else {
                            const locText = isGlobal ? 'nesta temporada ainda' : 'neste grupo ainda';
                            await _0x461461(_0x25f8ef, _0x37fcf7, `Nenhuma compra registrada ${locText} (iniciada em ${inicioTemporadaStr.split(' ')[0]}). Comece a comprar para liderar! 🚀`, _0x2368aa['id']);
                        }
                    } catch (errRank) {
                        _0x1ca1fd('❌ Erro no comando de ranking: ' + errRank.message, 'error');
                        await _0x461461(_0x25f8ef, _0x37fcf7, `Erro ao buscar o ranking. Tente novamente mais tarde! ⚙️`, _0x2368aa['id']);
                    }
                    return;
                }

                if (_0x316b84.startsWith('.verplano') || _0x316b84.startsWith('!verplano')) {
                    const isAdmin = _0x457c95 === _0x16260a || (_0x2368aa['isGroupMsg']
                        ? await _0x25f8ef['getGroupAdmins'](_0x37fcf7).then(_admins => _admins.includes(_0x457c95)).catch(() => false)
                        : false);
                    if (!isAdmin) return;

                    const args = _0x316b84.split(' ');
                    let numeroBusca = args[1];
                    if (!numeroBusca) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '📝 *USO:* .verplano [número]\nExemplo: .verplano 841234567', _0x2368aa['id']);
                        return;
                    }

                    if (/^8[2-7]\d{7}$/.test(numeroBusca)) numeroBusca = '258' + numeroBusca;

                    const planos = await _0x3c2652('SELECT * FROM assinaturas_planos WHERE numero=? ORDER BY id DESC LIMIT 5', [numeroBusca]);
                    
                    if (!planos || planos.length === 0) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, `❌ *NENHUM PLANO ENCONTRADO* para o número ${numeroBusca}.`, _0x2368aa['id']);
                        return;
                    }

                    let msg = `📋 *PLANOS ENCONTRADOS - ${numeroBusca}*\n━━━━━━━━━━━━━━━━━━━\n`;
                    for (const p of planos) {
                        const statusEmoji = p.status === 'ativo' ? '🟢' : '⚪';
                        msg += `${statusEmoji} *Status:* ${p.status.toUpperCase()}\n`;
                        msg += `📍 *Tipo:* ${p.tipo.toUpperCase()}\n`;
                        msg += `📥 *Entregue:* ${p.entregue_mb}MB / ${p.total_mb}MB\n`;
                        msg += `⏳ *Saldo:* ${p.total_mb - p.entregue_mb}MB\n`;
                        msg += `📅 *Próximo:* ${p.data_proxima_entrega || 'N/A'}\n`;
                        msg += `━━━━━━━━━━━━━━━━━━━\n`;
                    }
                    await _0x461461(_0x25f8ef, _0x37fcf7, msg, _0x2368aa['id']);
                    return;
                }
                
                if (_0x316b84.startsWith('.cancelarplano') || _0x316b84.startsWith('!cancelarplano')) {
                    const isAdmin = _0x457c95 === _0x16260a || (_0x2368aa['isGroupMsg']
                        ? await _0x25f8ef['getGroupAdmins'](_0x37fcf7).then(_admins => _admins.includes(_0x457c95)).catch(() => false)
                        : false);
                    if (!isAdmin) return;

                    const args = _0x316b84.split(' ');
                    let target = args[1];
                    if (!target) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '⚠️ *USO CORRETO:*\n━━━━━━━━━━━━━━━━━━━\n👉 *.cancelarplano [número]*\nExemplo: `.cancelarplano 841234567`\n\n👉 *.cancelarplano [referência]*\nExemplo: `.cancelarplano DEJ0K6BXW0S`', _0x2368aa['id']);
                        return;
                    }

                    let searchVal = target.toUpperCase().trim();
                    if (/^8[2-7]\d{7}$/.test(searchVal)) {
                        searchVal = '258' + searchVal;
                    }

                    // Verificar se existe plano ativo antes de atualizar
                    const planosAtivos = await _0x3c2652('SELECT * FROM assinaturas_planos WHERE (numero=? OR referencia_original=?) AND status="ativo"', [searchVal, searchVal]);
                    
                    if (!planosAtivos || planosAtivos.length === 0) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, `❌ *NENHUM PLANO ATIVO ENCONTRADO* para "${target}".`, _0x2368aa['id']);
                        return;
                    }

                    // Realizar cancelamento
                    await _0x2c5e52('UPDATE assinaturas_planos SET status="cancelado" WHERE (numero=? OR referencia_original=?) AND status="ativo"', [searchVal, searchVal]);

                    let msg = `✅ *PLANO(S) CANCELADO(S) COM SUCESSO!* 🛡️\n━━━━━━━━━━━━━━━━━━━\n📍 *Alvo:* ${target}\n📊 *Quantidade:* ${planosAtivos.length} plano(s) ativo(s) cancelado(s).\n\nO cliente não receberá mais entregas automáticas e não poderá mais realizar saques para este(s) plano(s).`;
                    await _0x461461(_0x25f8ef, _0x37fcf7, msg, _0x2368aa['id']);
                    return;
                }
                if (_0x316b84.startsWith('.meuplano')) {
                    const planos = await _0x3c2652('SELECT * FROM assinaturas_planos WHERE jid=? AND status="ativo"', [_0x457c95]);
                    if (!planos || planos.length === 0) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '❌ *VOCÊ NÃO TEM PLANOS ATIVOS*\n━━━━━━━━━━━━━━━━━━━\nEscolha um plano na tabela para começar!', _0x2368aa['id']);
                        return;
                    }
                    let msg = '📊 *SEUS PLANOS ATIVOS*\n━━━━━━━━━━━━━━━━━━━\n';
                    for (const p of planos) {
                        const falta = p.total_mb - p.entregue_mb;
                        msg += `📍 *Tipo:* ${p.tipo.toUpperCase()}\n📱 *Número:* ${p.numero}\n📥 *Recebido:* ${p.entregue_mb}MB\n⏳ *Pendente:* ${falta}MB\n📅 *Próximo:* ${p.data_proxima_entrega}\n━━━━━━━━━━━━━━━━━━━\n`;
                    }
                    await _0x461461(_0x25f8ef, _0x37fcf7, msg, _0x2368aa['id']);
                    return;
                }

                if (_0x316b84.startsWith('.sacar')) {
                    const args = _0x316b84.split(' ');
                    const planos = await _0x3c2652('SELECT * FROM assinaturas_planos WHERE jid=? AND status="ativo"', [_0x457c95]);
                    
                    if (!planos || planos.length === 0) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '❌ *VOCÊ NÃO TEM SALDO PENDENTE*\n━━━━━━━━━━━━━━━━━━━\nTodos os seus megas já foram entregues ou você não possui um plano ativo.', _0x2368aa['id']);
                        return;
                    }

                    const p = planos[0];
                    const saldoRestante = p.total_mb - p.entregue_mb;
                    let mbSolicitado = args[1] ? parseInt(args[1]) : p.valor_entrega_diaria;

                    if (isNaN(mbSolicitado) || mbSolicitado <= 0) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, '⚠️ *QUANTIDADE INVÁLIDA*\n━━━━━━━━━━━━━━━━━━━\nUse: *.sacar* ou *.sacar [quantidade]*', _0x2368aa['id']);
                        return;
                    }

                    if (mbSolicitado > saldoRestante) {
                        await _0x461461(_0x25f8ef, _0x37fcf7, `❌ *SALDO INSUFICIENTE*\n━━━━━━━━━━━━━━━━━━━\nDisponível: *${saldoRestante}MB*`, _0x2368aa['id']);
                        return;
                    }

                    _0x149dcd({ 'ref': 'SAC-' + Date.now(), 'jid': _0x457c95, 'numero': p.numero, 'quantidade': mbSolicitado, 'remetente': 'SAQUE_MANUAL', 'tipo': '24hrs' });
                    
                    const novoEntregue = p.entregue_mb + mbSolicitado;
                    let novoStatus = novoEntregue >= p.total_mb ? 'concluido' : 'ativo';
                    const proximaData = new Date(Date.now() + 22 * 60 * 60 * 1000);
                    const novoProximoEnvio = proximaData.toISOString().replace('T', ' ').split('.')[0];

                    await _0x2c5e52('UPDATE assinaturas_planos SET entregue_mb=?, data_ultima_entrega=CURRENT_TIMESTAMP, data_proxima_entrega=?, status=? WHERE id=?', 
                        [novoEntregue, novoProximoEnvio, novoStatus, p.id]);
                    
                    let msgSucesso = `✅ *SAQUE REALIZADO COM SUCESSO!*\n━━━━━━━━━━━━━━━━━━━\n📥 *Enviado:* ${mbSolicitado}MB\n📱 *Destino:* ${p.numero}\n📊 *Saldo Restante:* ${p.total_mb - novoEntregue}MB\n\n`;
                    if (novoStatus === 'ativo') {
                        msgSucesso += `⏳ O próximo envio automático foi reagendado para daqui a 22 horas.`;
                    } else {
                        msgSucesso += `✨ Você recebeu todo o saldo do seu plano!`;
                    }

                    await _0x461461(_0x25f8ef, _0x37fcf7, msgSucesso, _0x2368aa['id']);
                    return;
                }
                if (_0x519db1['startsWith']('/eliminar')) {
                    const _0x54caf7 = await _0x39c436(_0x25f8ef, _0x2368aa, _0x37fcf7, _0x457c95, _0x519db1);
                    if (_0x54caf7) return;
                }
                if (_0x2368aa['isGroupMsg']) {
                    const _0x1c4466 = await _0x554c86(_0x25f8ef, _0x2368aa);
                    if (_0x1c4466) return;
                }
                const _0x4d511b = ['peço\x20megas', 'peço\x20mega', 'quero\x20megas', 'quero\x20mega', 'kmk\x20Peço\x20mbs', 'Peço\x20MB\x20família', 'posso\x20transferir', 'Posso\x20fazer\x20o\x20pagamento', 'peco\x20net', 'ADM\x20ON??', 'peco\x20internet', 'onde\x20compro', 'quero\x20comprar'],
                    _0x44dda4 = _0x4d511b['some'](_0xb8d673 => _0x316b84['includes'](_0xb8d673['toLowerCase']()));
                if (_0x44dda4) try {
                    const _0x48a53f = '📱\x20*ESTAMOS\x20ON\x20PODE\x20PAGAR!*\x20📱\x0a━━━━━━━━━━━━━━━━━━━━\x0aPara\x20ver\x20pacotes\x20e\x20preços:\x0a\x0a📋\x20Digite:\x20*Tabela*\x20ou\x20*Menu*\x0a\x0a💳\x20Para\x20números\x20de\x20pagamento:\x0a\x0a📋\x20Digite:\x20*Pagamento*\x0a\x0a━━━━━━━━━━━━━━━━━━━━\x0a📞\x20Dúvidas?\x20856116039';
                    await _0x461461(_0x25f8ef, _0x37fcf7, _0x48a53f, _0x2368aa['id']);
                    return;
                } catch (_0x51b882) {
                    _0x1ca1fd('❌\x20Erro\x20ao\x20responder\x20pedido:\x20' + _0x51b882['message'], 'error');
                }
                if (_0x316b84 === '/menu' || _0x316b84 === 'menu' || _0x316b84 === '/tabela' || _0x316b84 === 'tabela' || _0x316b84 === 'tabe' || _0x316b84['includes']('tabela') || _0x316b84['includes']('tabe') || _0x316b84['includes']('lista')) {
                    try {
                        // --- VERIFICAR SE É ESTUDANTE REGISTADO → enviar tabela de estudante ---
                        const _senderNumTabela = (_0x457c95 || '').split('@')[0];
                        const _ehEstudanteTabela = typeof _isEstudante === 'function'
                            ? _isEstudante(_senderNumTabela)
                            : (global['estudantesMembros'] && global['estudantesMembros'].has(_senderNumTabela));

                        if (_ehEstudanteTabela && _0x48e9aa_estudantes && !_0x2368aa['isGroupMsg']) {
                            // Cliente é estudante (no PV) → enviar tabela exclusiva de estudante
                            const _linhasTabelaEst = Object.entries(_0x48e9aa_estudantes)
                                .sort(([a], [b]) => Number(a) - Number(b))
                                .map(([preco, pack]) => `💎 *${preco}MT* → ${pack['nome']}`)
                                .join('\n');
                            const _tabelaEstMsg =
                                '🎓 *TABELA ESTUDANTE KA-NET* 📶\n' +
                                '━━━━━━━━━━━━━━━━━━━━━━━━\n' +
                                '📋 *PACOTES EXCLUSIVOS ESTUDANTE:*\n' +
                                _linhasTabelaEst + '\n\n' +
                                '━━━━━━━━━━━━━━━━━━━━━━━━\n' +
                                '🛒 Para comprar, envia o comprovativo + número de destino.\n' +
                                '⚠️ Não partilhes esta tabela com não-estudantes.';
                            await _0x461461(_0x25f8ef, _0x37fcf7, _tabelaEstMsg, _0x2368aa['id']);
                            _0x1ca1fd('🎓 Tabela ESTUDANTE enviada (privado) para ' + _0x37fcf7, 'success');
                        } else {
                            // Cliente normal ou Grupo → enviar a tabela DINÂMICA específica do grupo/global
                            const _menuDinEnviar = typeof _obterMenuOuTabelaDoGrupo === 'function'
                                ? _obterMenuOuTabelaDoGrupo(_0x37fcf7)
                                : (typeof _gerarMenuDinamico === 'function' ? _gerarMenuDinamico(null, null, _0x37fcf7) : MENU_TABELA);

                            await _0x461461(_0x25f8ef, _0x37fcf7, _menuDinEnviar, _0x2368aa['id']);
                            _0x1ca1fd('📋 Tabela dinâmica enviada para ' + _0x37fcf7 + ', remetente=' + _0x457c95, 'success');
                        }
                        
                        // CRM: Follow-up de vendas após envio da tabela (30 Segundos)
                        if (!_0x2368aa['isGroupMsg']) {
                            const _menuRequestTime = Date.now();
                            setTimeout(async () => {
                                // Se o cliente enviou qualquer mensagem DEPOIS de pedir a tabela, cancelamos o aviso
                                if (global['_kanetUserActivity'] && global['_kanetUserActivity'][_0x37fcf7] > _menuRequestTime) {
                                    return;
                                }
                                
                                const _nomeCli = _0x2368aa['sender']?.['pushname'] || _0x2368aa['sender']?.['formattedName'] || 'amigo(a)';
                                const _followUpMsg = `👋 Olá, *${_nomeCli}*! Já teve tempo de analisar a nossa tabela de pacotes?\n\n🛒 *Qual pacote deseja comprar hoje?*\n\nSe tiver alguma dúvida sobre os preços ou sobre como fazer o pagamento, estou aqui para dar todo o suporte!`;
                                try { await _0x461461(_0x25f8ef, _0x37fcf7, _followUpMsg, null); } catch(e){}
                            }, 30 * 1000); // 30 segundos
                        }
                        
                    } catch (_0x123a61) {
                        _0x1ca1fd('❌ Erro ao enviar tabela de pacotes: jid=' + _0x37fcf7 + ', remetente=' + _0x457c95, 'error'), await _0x461461(_0x25f8ef, _0x37fcf7, 'Digita Tabela, para ver pacotes. Digita Pagamento, para ter os numeros de pagamento.', _0x2368aa['id']);
                    }
                    return;
                }
                if (_0x316b84 === '/comandos' || _0x316b84 === '!comandos' || _0x316b84 === '.comandos' || _0x316b84 === '/ajuda' || _0x316b84 === 'ajuda') {
                    const _0xHelp = `✨ *𝗞𝗔𝗡𝗘𝗧 𝟮.𝟬 • 𝗣𝗔𝗡𝗘𝗟 𝗗𝗘 𝗖𝗢𝗠𝗔𝗡𝗗𝗢𝗦* ✨
━━━━━━━━━━━━━━━━━━━━━

📊 *𝗘𝗦𝗧𝗔𝗧𝗜́𝗦𝗧𝗜𝗖𝗔𝗦 𝗘 𝗥𝗘𝗟𝗔𝗧𝗢́𝗥𝗜𝗢𝗦*
🔹 *!hoje* / *!vendas* - Relatório diário + Crescimento das vendas
🔹 *!amanha* - Relatório consolidado de ontem
🔹 *!relatorio* - Relatório geral de vendas avançado
🔹 *.leads* - Total de clientes na base de dados

⚙️ *𝗚𝗘𝗦𝗧𝗔̃𝗢 𝗗𝗢 𝗦𝗜𝗦𝗧𝗘𝗠𝗔 𝗘 𝗠𝗔𝗡𝗨𝗧𝗘𝗡𝗖̧𝗔̃𝗢*
🔹 *.manutencao* - Ativa o modo de manutenção do bot 🛑
🔹 *.online* - Desativa o modo de manutenção e traz o bot online 🟢
🔹 */status* - Verifica o status operacional dos telefones e do ADB 📱
🔹 */limpar* - Limpa a fila de transações pendentes/antigas 🧹
🔹 */tentar [ref]* - Força o reprocessamento de uma referência pendente 🔄
🔹 */eliminar [ref]* - Remove permanentemente uma referência do banco 🗑️

🛡️ *𝗦𝗘𝗚𝗨𝗥𝗔𝗡𝗖̧𝗔, 𝗚𝗥𝗨𝗣𝗢𝗦 𝗘 𝗗𝗘𝗙𝗘𝗦𝗔*
🔹 *.guardian toggle* - Liga/Desliga o escudo anti-espião contra curiosos
🔹 *.limparcuriosos* - Remove membros inativos que não compram há +15 dias
🔹 *.concorrente* - Ativa monitoramento silencioso de grupos concorrentes
🔹 *.banir [número]* - Bane e bloqueia um número em todos os grupos
🔹 *.desbanir [número]* - Remove o banimento do número
🔹 *.banidos* - Lista todos os números banidos do sistema
🔹 *!abrir* / *!fechar* - Abre ou fecha o grupo para mensagens
🔹 *.idgrupo* - Exibe o ID do grupo atual para whitelisting
🔹 *.autorizar* / *.desautorizar* - Adiciona/Remove permissão para grupos confiáveis
🔹 */todos* / *.todos* - Menciona todos os membros de um grupo autorizado

📢 *𝗠𝗔𝗥𝗞𝗘𝗧𝗜𝗡𝗚, 𝗕𝗢́𝗡𝗨𝗦 𝗘 𝗔𝗦𝗦𝗜𝗡𝗔𝗧𝗨𝗥𝗔𝗦*
🔹 *.promocao [texto]* - Disparo de mensagem em massa para todos os leads 📣
🔹 *!convite* - Gera o código de indicação do cliente para bónus 🎁
🔹 *.verplano [número]* - Verifica as assinaturas ativas de um cliente
🔹 *.cancelarplano [número/ref]* - Admin cancela o plano ativo do cliente 🛡️
🔹 *.meuplano* - Cliente verifica o seu próprio plano ativo
🔹 *.sacar* - Cliente realiza o resgate/saque de megas do seu plano

💰 *𝗧𝗔𝗕𝗘𝗟𝗔 𝗘 𝗘𝗡𝗩𝗜𝗢 𝗠𝗔𝗡𝗨𝗔𝗟*
🔹 *Menu* / *Tabela* - Abre a tabela de pacotes atualizada
🔹 *!pagamento* - Mostra dados para M-Pesa e E-Mola
🔹 *.enviar [número] [MB]* - Realiza envio manual direto de megas`;
                    await _0x461461(_0x25f8ef, _0x37fcf7, _0xHelp, _0x2368aa['id']);
                    return;
                }
                // --- COMANDO SECRETO E KEYWORD DE ESTUDANTE ---
                const _msgNormalizada = _0x316b84.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                const _isPedidoEstudante = _msgNormalizada === 'estudante' || 
                                           _msgNormalizada === 'estudantes' || 
                                           _msgNormalizada === '.estudante' || 
                                           _msgNormalizada === '/estudante' || 
                                           _msgNormalizada.includes('sou estudante') ||
                                           _msgNormalizada.includes('plano estudante') ||
                                           _msgNormalizada.includes('tabela de estudante') ||
                                           _msgNormalizada.includes('pacote de estudante') ||
                                           _msgNormalizada.includes('tabela estudante') ||
                                           _msgNormalizada.includes('pacote estudante');

                if (_isPedidoEstudante) {
                    try {
                        // Registar o cliente como estudante (persistente)
                        const _senderNumRaw = (_0x457c95 || '').split('@')[0];
                        _registarEstudantePrivado(_senderNumRaw);

                        // Montar tabela de preços de estudante
                        const _linhasTabela = Object.entries(_0x48e9aa_estudantes)
                            .sort(([a], [b]) => Number(a) - Number(b))
                            .map(([preco, pack]) => `💎 *${preco}MT* → ${pack['nome']}`)
                            .join('\n');

                        const _msgRespostaEstudante =
                            '🎓 *TABELA ESTUDANTE KA-NET* 📶\n' +
                            '━━━━━━━━━━━━━━━━━━━━━━━━\n' +
                            '✅ Foste registado como estudante!\n' +
                            'Os teus próximos pedidos usarão esta tabela.\n\n' +
                            '📋 *PACOTES EXCLUSIVOS ESTUDANTE:*\n' +
                            _linhasTabela + '\n\n' +
                            '━━━━━━━━━━━━━━━━━━━━━━━━\n' +
                            '🎓 Junta-te ao nosso grupo exclusivo de estudantes:\n' +
                            'https://chat.whatsapp.com/KRgwyA7v8ig5UTqLHzJud6\n\n' +
                            '🛒 Para comprar, envia o comprovativo + número de destino.\n' +
                            '⚠️ Não partilhes esta tabela com não-estudantes.';

                        await _0x461461(_0x25f8ef, _0x37fcf7, _msgRespostaEstudante, _0x2368aa['id']);
                        _0x1ca1fd('🎓 Estudante registado, tabela e link do grupo enviados para ' + _0x37fcf7, 'success');
                    } catch (_errEst) {
                        _0x1ca1fd('❌ Erro ao processar pedido de estudante: ' + _errEst.message, 'error');
                    }
                    return;
                }

                if (_0x316b84 === '/pagamento' || _0x316b84 === 'pagamento' || _0x316b84 === 'pagar' || _0x316b84['includes']('como\x20pagar')) {
                    try {
                        const { mpesa_num, mpesa_name, emola_num, emola_name } = _getPaymentDetails();
                        const { supportNum, supportName, callsNum, sysName } = _getSupportDetails();

                        // Verificar se existe um template customizado em local_config.json
                        let templatePagamento = null;
                        try {
                            const _fsP = require('fs');
                            const _pathP = require('path');
                            const _cfgPathP = _pathP.join(global._kanetBase || __dirname, 'local_config.json');
                            if (_fsP.existsSync(_cfgPathP)) {
                                const _cfgP = JSON.parse(_fsP.readFileSync(_cfgPathP, 'utf8'));
                                if (_cfgP.template_pagamento) templatePagamento = _cfgP.template_pagamento;
                            }
                        } catch (e) {}

                        let _0x310d4f = '';
                        if (templatePagamento) {
                            _0x310d4f = templatePagamento;
                        } else {
                            _0x310d4f = 
                                '💰 ─── *𝗙𝗢𝗥𝗠𝗔𝗦 𝗗𝗘 𝗣𝗔𝗚𝗔𝗠𝗘𝗡𝗧𝗢* ─── 💰\n' +
                                '⚡ _Processamento Automático e Instantâneo_\n\n' +
                                '📩 *𝗖𝗢𝗠𝗢 𝗖𝗢𝗠𝗣𝗥𝗔𝗥*\n' +
                                'Envie: Comprovativo + Número de Destino na última linha.\n\n' +
                                '📱 *𝗠-𝗣𝗘𝗦𝗔*  ➤  `' + mpesa_num + '`\n' +
                                '👤 ' + mpesa_name + '\n\n' +
                                '📱 *𝗘-𝗠𝗢𝗟𝗔*  ➤  `' + emola_num + '`\n' +
                                '👤 ' + emola_name + '\n\n' +
                                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
                                '📞 *𝗖𝗔𝗡𝗔𝗜𝗦 𝗗𝗘 𝗦𝗨𝗣𝗢𝗥𝗧𝗘*\n' +
                                '👤 *WhatsApp:* ' + supportNum + ' (' + supportName + ')\n' +
                                '👤 *Chamadas:* ' + callsNum + '\n' +
                                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
                                '🤖 _[' + sysName + ' Automation System v3.5]_';
                        }
                        await _0x461461(_0x25f8ef, _0x37fcf7, _0x310d4f, _0x2368aa['id']), _0x1ca1fd('💳\x20Info\x20de\x20pagamento\x20enviada\x20para\x20' + _0x37fcf7 + ',\x20remetente=' + _0x457c95, 'success');
                    } catch (_0x3f0c57) {
                        _0x1ca1fd('❌\x20Erro\x20ao\x20enviar\x20info\x20de\x20pagamento:\x20jid=' + _0x37fcf7 + ',\x20remetente=' + _0x457c95, 'error'), console['log']('❌\x20Erro\x20detalhado:\x20' + _0x3f0c57['message']), console['log'](_0x3f0c57['stack']);
                    }
                    return;
                }
                if (_0x2a7a02(_0x519db1) && _0x2368aa['isGroupMsg']) {
                    try {
                        const _0x50d878 = await _0x25f8ef['getGroupAdmins'](_0x37fcf7),
                            _0x5d766e = (await _0x25f8ef['getMe']())['_serialized'];
                        _0x50d878['includes'](_0x5d766e) ? (await _0x25f8ef['deleteMessage'](_0x37fcf7, _0x2368aa['id'], !![]), _0x1ca1fd('🗑️\x20Link\x20apagado\x20automaticamente\x20em\x20' + _0x37fcf7 + ':\x20' + _0x519db1, 'success'), await _0x461461(_0x25f8ef, _0x37fcf7, '📭\x20Links\x20não\x20são\x20permitidos\x20neste\x20grupo\x20e\x20foram\x20removidos.', _0x2368aa['id'])) : (_0x1ca1fd('📭\x20Link\x20bloqueado,\x20mas\x20não\x20excluído\x20(bot\x20não\x20é\x20admin):\x20' + _0x519db1 + ',\x20jid=' + _0x37fcf7 + ',\x20botId=' + _0x5d766e, 'warning'), await _0x461461(_0x25f8ef, _0x37fcf7, '📭\x20Links\x20não\x20são\x20permitidos,\x20mas\x20o\x20bot\x20não\x20tem\x20permissão\x20para\x20removê-los.', _0x2368aa['id']));
                    } catch (_0x1b16ec) {
                        _0x1ca1fd('❌\x20Erro\x20ao\x20tentar\x20apagar\x20link\x20no\x20grupo\x20' + _0x37fcf7 + ':\x20' + _0x519db1, 'error');
                    }
                    return;
                }
                const _0x2b4998 = _0x519db1['match'](/^(258)?(8[2-7]\d{7})$/);
                if (_0x2b4998) {
                    const _0x3c67aa = _0x2b4998[0x1] ? _0x2b4998[0x0] : '258' + _0x2b4998[0x2];
                    const cleanNumClient = _0x3c67aa.startsWith('258') ? _0x3c67aa.substring(3) : _0x3c67aa;
                    if (!cleanNumClient.startsWith('84') && !cleanNumClient.startsWith('85')) {
                        _0x1ca1fd('⚠️ Número não-Vodacom rejeitado para ' + _0x457c95 + ': ' + _0x3c67aa, 'warning');
                        await _0x461461(_0x25f8ef, _0x37fcf7, '❌ *ERRO: NÚMERO INVÁLIDO*\n━━━━━━━━━━━━━━━━━━━\nDesculpe, os nossos pacotes de megas são **exclusivos para a rede Vodacom**.\n\nPor favor, envie um número válido da Vodacom (iniciando com *84* ou *85*).', _0x2368aa['id']);
                        return;
                    }
                    try {
                        const _0x2b6763 = await _0x3c2652('SELECT * FROM referencias\n             WHERE jid=? AND remetente=? \n             AND status IN (\'aguardando_numero\', \'aguardando_comprovativo\', \'aguardando_sms\', \'aguardando_confirmacao\')\n             AND datetime(created_at) >= datetime(\'now\', \'-24 hours\') \n             ORDER BY created_at DESC LIMIT 1', [_0x37fcf7, _0x457c95]);
                        if (!_0x2b6763 || _0x2b6763['length'] === 0x0) {
                            _0x1ca1fd('⚠️\x20Nenhum\x20registro\x20pendente\x20recente\x20encontrado\x20para\x20' + _0x457c95, 'warning'), await _0x461461(_0x25f8ef, _0x37fcf7, '*Envie\x20comprovativo*', _0x2368aa['id']), await _0xf94125('📝\x20Aguardando\x20SMS\x20da\x20operadora\x0a⏸️\x20Número:\x20' + _0x3c67aa + '\x0a📝\x20Grupo:\x20' + _0x37fcf7 + '\x0a👤\x20Remetente:\x20' + _0x457c95);
                            return;
                        }
                        const _0x5d931d = _0x2b6763[0x0];
                        if (_0x5d931d['numero'] && _0x5d931d['numero'] !== _0x3c67aa) {
                            !global['pendingNumberReplacements'] && (global['pendingNumberReplacements'] = new Map());
                            global['pendingNumberReplacements']['set'](_0x37fcf7 + '-' + _0x457c95, {
                                'ref': _0x5d931d['ref'],
                                'numeroAntigo': _0x5d931d['numero'],
                                'numeroNovo': _0x3c67aa,
                                'timestamp': Date['now'](),
                                'comprovativo_msg_id': _0x5d931d['comprovativo_msg_id']
                            }), await _0x461461(_0x25f8ef, _0x37fcf7, '⚠️\x20O\x20número\x20' + _0x5d931d['numero']['replace']('258', '') + '\x20já\x20está\x20associado\x20à\x20referência\x20' + _0x5d931d['ref'] + '.\x20Deseja\x20substituí-lo\x20por\x20' + _0x3c67aa['replace']('258', '') + '?\x20Responda\x20\x22sim\x22\x20ou\x20\x22não\x22.', _0x5d931d['comprovativo_msg_id']), await _0xf94125('⚠️\x20Conflito\x20de\x20número\x0a📋\x20Referência:\x20' + _0x5d931d['ref'] + '\x0a⏸️\x20Número\x20atual:\x20' + _0x5d931d['numero'] + '\x0a⏸️\x20Novo\x20número:\x20' + _0x3c67aa + '\x0a📝\x20Grupo:\x20' + _0x37fcf7 + '\x0a👤\x20Remetente:\x20' + _0x457c95);
                            return;
                        }
                        if (global['pendingNumberReplacements']) {
                            const _0xe01049 = _0x37fcf7 + '-' + _0x457c95,
                                _0x3ece47 = global['pendingNumberReplacements']['get'](_0xe01049);
                            if (_0x3ece47 && Date['now']() - _0x3ece47['timestamp'] < 0x493e0) {
                                const _0x1eebb4 = _0x519db1['toLowerCase']()['trim']();
                                if (_0x1eebb4 === 'sim' || _0x1eebb4 === 's' || _0x1eebb4 === 'yes') {
                                    await _0x2c5e52('UPDATE\x20referencias\x20SET\x20numero=?,\x20status=\x27aguardando_confirmacao\x27\x20WHERE\x20ref=?', [_0x3ece47['numeroNovo'], _0x3ece47['ref']]), _0x1ca1fd('✅\x20Número\x20substituído:\x20ref=' + _0x3ece47['ref'] + ',\x20jid=' + _0x37fcf7 + ',\x20remetente=' + _0x457c95 + ',\x20numero_antigo=' + _0x3ece47['numeroAntigo'] + ',\x20numero_novo=' + _0x3ece47['numeroNovo'], 'success'), await _0xf94125('✅\x20Número\x20substituído\x0a📋\x20Referência:\x20' + _0x3ece47['ref'] + '\x0a⏸️\x20Antigo:\x20' + _0x3ece47['numeroAntigo'] + '\x0a⏸️\x20Novo:\x20' + _0x3ece47['numeroNovo'] + '\x0a📝\x20Grupo:\x20' + _0x37fcf7 + '\x0a👤\x20Remetente:\x20' + _0x457c95), await _0x239403(_0x25f8ef, _0x3ece47['ref'], _0x37fcf7, _0x3ece47['numeroNovo'], _0x457c95), global['pendingNumberReplacements']['delete'](_0xe01049);
                                    return;
                                } else {
                                    if (_0x1eebb4 === 'não' || _0x1eebb4 === 'nao' || _0x1eebb4 === 'n' || _0x1eebb4 === 'no') {
                                        await _0x461461(_0x25f8ef, _0x37fcf7, '✅\x20Mantido\x20o\x20número\x20original\x20' + _0x3ece47['numeroAntigo']['replace']('258', '') + '\x20para\x20a\x20referência\x20' + _0x3ece47['ref'] + '.', _0x3ece47['comprovativo_msg_id']), _0x1ca1fd('✅\x20Número\x20original\x20mantido:\x20ref=' + _0x3ece47['ref'] + ',\x20jid=' + _0x37fcf7 + ',\x20remetente=' + _0x457c95 + ',\x20numero=' + _0x3ece47['numeroAntigo'], 'success'), global['pendingNumberReplacements']['delete'](_0xe01049);
                                        return;
                                    } else {
                                        await _0x461461(_0x25f8ef, _0x37fcf7, '❌\x20Resposta\x20inválida.\x20Deseja\x20substituir\x20' + _0x3ece47['numeroAntigo']['replace']('258', '') + '\x20por\x20' + _0x3ece47['numeroNovo']['replace']('258', '') + '?\x20Responda\x20\x22sim\x22\x20ou\x20\x22não\x22.', _0x3ece47['comprovativo_msg_id']);
                                        return;
                                    }
                                }
                            } else _0x3ece47 && global['pendingNumberReplacements']['delete'](_0xe01049);
                        }
                        await _0x2c5e52('UPDATE\x20referencias\x20SET\x20numero=?,\x20status=\x27aguardando_confirmacao\x27\x20WHERE\x20ref=?', [_0x3c67aa, _0x5d931d['ref']]), _0x1ca1fd('📝\x20Número\x20receptor\x20atualizado:\x20ref=' + _0x5d931d['ref'] + ',\x20jid=' + _0x37fcf7 + ',\x20remetente=' + _0x457c95 + ',\x20numero=' + _0x3c67aa + ',\x20status_anterior=' + _0x5d931d['status'], 'success');

                        // ── CRÍTICO: Se o SMS da operadora já chegou antes do cliente digitar o número,
                        // não esperar novamente — disparar a entrega imediatamente. ──────────────────
                        const _refAtualizado = await _0x3c2652('SELECT * FROM referencias WHERE ref=?', [_0x5d931d['ref']]);
                        const _refNow = _refAtualizado && _refAtualizado[0];
                        if (_refNow && (Number(_refNow.sms_recebido) === 1 || _refNow.sms_recebido == true)) {
                            _0x1ca1fd('⚡ [ENTREGA IMEDIATA] SMS já confirmado, despachando ref=' + _refNow.ref + ' para ' + _0x3c67aa, 'success');
                            await _0x303482(_0x25f8ef, _refNow.jid, _refNow.ref, _refNow.valor, _refNow.quantidade, _0x3c67aa, _refNow.comprovativo_msg_id, _refNow.remetente, _refNow.tipo, _refNow.sobra || 0);
                        } else {
                            // SMS ainda não chegou — enviar resumo e aguardar confirmação normal
                            await _0x239403(_0x25f8ef, _0x5d931d['ref'], _0x37fcf7, _0x3c67aa, _0x457c95);
                        }
                    } catch (_0x33a7d6) {
                        const { supportNum: _supN } = _getSupportDetails();
                        const _0x3b8f96 = '❌\x20Erro\x20ao\x20consultar\x20transação\x20pendente:\x20jid=' + _0x37fcf7 + ',\x20remetente=' + _0x457c95 + ',\x20texto=' + _0x519db1;
                        _0x1ca1fd(_0x3b8f96, 'error'), await _0x461461(_0x25f8ef, _0x37fcf7, '❌\x20Erro\x20interno\x20ao\x20processar\x20sua\x20solicitação.\x20Contate\x20o\x20suporte\x20(' + _supN + ').', _0x2368aa['id']), await _0xf94125(_0x3b8f96 + '\x0a⚠️\x20Erro:\x20' + _0x33a7d6['message'] + '\x0aStack:\x20' + _0x33a7d6['stack']);
                    }
                    return;
                }
                if (_0x519db1['match'](/^((258)?(8[2-7]\d{7})(?:\s*[-→]\s*\d+(?:\.\d+)?\s*GB)?(?:\r?\n(258)?(8[2-7]\d{7})(?:\s*[-→]\s*\d+(?:\.\d+)?\s*GB)?)*)$/i)) {
                    // Validar se todos os números são Vodacom
                    const linesDiv = _0x519db1.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
                    let nonVodacomFound = false;
                    for (const line of linesDiv) {
                        const m = line.match(/(258)?(8[2-7]\d{7})/);
                        if (m) {
                            const num = m[0];
                            const cleanNum = num.startsWith('258') ? num.substring(3) : num;
                            if (!cleanNum.startsWith('84') && !cleanNum.startsWith('85')) {
                                nonVodacomFound = true;
                                break;
                            }
                        }
                    }
                    if (nonVodacomFound) {
                        _0x1ca1fd('⚠️ Número não-Vodacom em divisão rejeitado para ' + _0x457c95 + ': ' + _0x519db1, 'warning');
                        await _0x461461(_0x25f8ef, _0x37fcf7, '❌ *ERRO: NÚMERO INVÁLIDO*\n━━━━━━━━━━━━━━━━━━━\nDesculpe, os nossos pacotes de megas são **exclusivos para a rede Vodacom**.\n\nTodos os números de destino informados para divisão devem ser da Vodacom (prefixos *84* ou *85*).', _0x2368aa['id']);
                        return;
                    }
                    try {
                        const _0x36d67f = await _0x3c2652('SELECT * FROM referencias \n             WHERE jid=? AND remetente=? \n             AND status IN (\'aguardando_numero\', \'aguardando_comprovativo\', \'aguardando_sms\', \'aguardando_confirmacao\')\n             AND datetime(created_at) >= datetime(\'now\', \'-24 hours\') \n             ORDER BY created_at DESC LIMIT 1', [_0x37fcf7, _0x457c95]);
                        if (!_0x36d67f || _0x36d67f['length'] === 0x0) {
                            _0x1ca1fd('📭\x20Nenhum\x20comprovativo\x20encontrado\x20para\x20números:\x20' + _0x519db1 + ',\x20jid=' + _0x37fcf7 + ',\x20remetente=' + _0x457c95, 'warning'), await _0x461461(_0x25f8ef, _0x37fcf7, '📭\x20Nenhum\x20comprovativo\x20pendente\x20encontrado.\x20Envie\x20primeiro\x20o\x20comprovativo.', _0x2368aa['id']);
                            return;
                        }
                        const _0x53d538 = _0x36d67f[0x0];
                        if (_0x53d538['status'] === 'processada' || _0x53d538['status'] === 'finalizado') {
                            _0x1ca1fd('📭\x20Tentativa\x20de\x20reutilizar\x20referência\x20processada:\x20ref=' + _0x53d538['ref'] + ',\x20jid=' + _0x37fcf7 + ',\x20remetente=' + _0x457c95 + ',\x20texto=' + _0x519db1, 'warning'), await _0x461461(_0x25f8ef, _0x37fcf7, '📭\x20A\x20referência\x20' + _0x53d538['ref'] + '\x20já\x20foi\x20processada.\x20Envie\x20um\x20novo\x20comprovativo.', _0x53d538['comprovativo_msg_id']);
                            return;
                        }
                        const {
                            divisoes: _0x3e6b27
                        } = _0x202af4(_0x519db1, _0x53d538['quantidade'], _0x53d538['tipo']);
                        _0x3e6b27['length'] > 0x0 ? (await _0x2c5e52('UPDATE\x20referencias\x20SET\x20divisoes=?,\x20status=\x27aguardando_confirmacao\x27\x20WHERE\x20ref=?', [JSON['stringify'](_0x3e6b27), _0x53d538['ref']]), _0x1ca1fd('✅\x20Divisões\x20recebidas:\x20ref=' + _0x53d538['ref'] + ',\x20' + _0x3e6b27['length'] + '\x20divisões', 'success'), await _0x303482(_0x25f8ef, _0x37fcf7, _0x53d538['ref'], _0x53d538['valor'], _0x53d538['quantidade'], null, _0x53d538['comprovativo_msg_id'], _0x457c95, _0x53d538['tipo'])) : (_0x1ca1fd('⚠️\x20Nenhuma\x20divisão\x20válida\x20encontrada:\x20' + _0x519db1, 'warning'), await _0x461461(_0x25f8ef, _0x37fcf7, '⚠️\x20Nenhuma\x20divisão\x20válida\x20encontrada.\x20Envie\x20números\x20no\x20formato:\x0a856116039\x0aOu:\x20856116039\x20→\x205GB', _0x53d538['comprovativo_msg_id']));
                    } catch (_0x2bb430) {
                        const _0x429a6a = '❌\x20Erro\x20ao\x20processar\x20múltiplos\x20números:\x20jid=' + _0x37fcf7 + ',\x20remetente=' + _0x457c95 + ',\x20texto=' + _0x519db1;
                        _0x1ca1fd(_0x429a6a, 'error'), await _0x461461(_0x25f8ef, _0x37fcf7, '❌\x20Erro\x20interno\x20ao\x20processar\x20sua\x20solicitação.\x20Contate\x20o\x20suporte\x20(856116039\x20).', _0x2368aa['id']), await _0xf94125(_0x429a6a + '\x0a⚠️\x20Erro:\x20' + _0x2bb430['message'] + '\x0aStack:\x20' + _0x2bb430['stack']);
                    }
                    return;
                }
                const _0x35612a = _0xf8719e(_0x519db1);
                if (_0x35612a) {
                    try {
                        const _existingRef = await _0x3c2652('SELECT * FROM referencias WHERE ref=?', [_0x35612a]);
                        if (_existingRef && _existingRef.length > 0) {
                            const _refRow = _existingRef[0];
                            // Só bloqueia se o remetente for outro utilizador WhatsApp (JID)
                            // Não bloqueia se for um remetente de SMS (M-Pesa, E-Mola, etc.)
                            const _remetenteEhWhatsapp = _refRow.remetente && (_refRow.remetente.includes('@c.us') || _refRow.remetente.includes('@g.us'));
                            if (_remetenteEhWhatsapp && _refRow.remetente !== _0x457c95) {
                                _0x1ca1fd('🚫 TEXTO REIVINDICAÇÃO NEGADO - Referência ' + _0x35612a + ' pertence a outro remetente: ' + _refRow.remetente, 'warning');
                                const msgNegado = `⚠️ *REIVINDICAÇÃO NEGADA!* 🛑\n━━━━━━━━━━━━━━━━━━━\nEsta referência de pagamento (*${_0x35612a}*) já foi registrada por outro cliente.\n\nCada transação é de *uso exclusivo* do comprador original.`;
                                try {
                                    await _0x461461(_0x25f8ef, _0x37fcf7, msgNegado, _0x2368aa['id']);
                                } catch (e) {}
                                return;
                            }
                            const _jaFinalizado = ['finalizado', 'processada', 'bloco_processado', 'processando'].includes(_refRow.status);
                            const _jaAtribuido = _refRow.sms_recebido === 1 &&
                                _refRow.numero && _refRow.numero !== 'nenhum' &&
                                _refRow.comprovativo_msg_id;
                            if (_jaFinalizado || _jaAtribuido) {
                                _0x1ca1fd('🚫 TEXTO REIVINDICAÇÃO BLOQUEADO - Referência ' + _0x35612a + ' já utilizada/atribuída: status=' + _refRow.status + ', sms=' + _refRow.sms_recebido + ', numero=' + _refRow.numero, 'warning');
                                const msgUsado = `⚠️ *REFERÊNCIA JÁ UTILIZADA!* 🛑\n━━━━━━━━━━━━━━━━━━━\nA referência (*${_0x35612a}*) já foi processada e ativada anteriormente.\n\nCada comprovativo é de *uso único e exclusivo* e não pode ser reutilizado.`;
                                try {
                                    await _0x461461(_0x25f8ef, _0x37fcf7, msgUsado, _0x2368aa['id']);
                                } catch (e) {}
                                return;
                            }
                            

                            // Extrair número do texto atual caso o número no banco esteja em branco ou seja 'nenhum'
                            let targetNum = _refRow.numero;

                            // Função segura: só extrai número Vodacom/Movitel da linha seguinte à referência
                            const _extrairNumeroLinhaSeguinte = (texto, ref) => {
                                const botNumbers = ['856268811','258856268811','864882152','258864882152','856116039','258856116039','850401416','258850401416'];
                                const linhas = texto.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
                                for (let i = 0; i < linhas.length; i++) {
                                    const linhaAtual = linhas[i].toUpperCase();
                                    // Se esta linha contém a referência ou é uma palavra de confirmação
                                    const ehRef = ref && linhaAtual.includes(ref.toUpperCase());
                                    const ehConfirmacao = /^(sim|confirmo|ok|confirmar|aceito|yes|enviar)$/i.test(linhas[i]);
                                    if (ehRef || ehConfirmacao) {
                                        // Verificar a linha seguinte
                                        const proxLinha = linhas[i + 1];
                                        if (proxLinha) {
                                            const clean = proxLinha.replace(/\D/g, '');
                                            const isValid9  = clean.length === 9  && /^8[4-5]\d{7}$/.test(clean);
                                            const isValid12 = clean.length === 12 && /^2588[4-5]\d{7}$/.test(clean);
                                            if (isValid9 || isValid12) {
                                                const normalized = isValid9 ? '258' + clean : clean;
                                                const clean9 = normalized.substring(3);
                                                const isVodacom = clean9.startsWith('84') || clean9.startsWith('85');
                                                if (isVodacom && !botNumbers.includes(clean9) && !botNumbers.includes(normalized)) {
                                                    return normalized;
                                                }
                                            }
                                        }
                                    }
                                }
                                return null;
                            };

                            const msgNumber = _extrairNumeroLinhaSeguinte(_0x519db1, _0x35612a);
                            if (msgNumber && (!targetNum || targetNum === 'nenhum')) {
                                targetNum = msgNumber;
                                await _0x2c5e52('UPDATE referencias SET numero = ? WHERE ref = ?', [targetNum, _0x35612a]);
                                _0x1ca1fd('📞 Número receptor extraído da linha seguinte e atualizado: ' + targetNum, 'success');
                            }

                            if (!_refRow.jid) {
                                await _0x2c5e52('UPDATE referencias SET jid = ?, remetente = ?, comprovativo = ?, comprovativo_msg_id = ? WHERE ref = ?', [_0x37fcf7, _0x457c95, 'REIVINDICADO_TEXTO', _0x2368aa['id'], _0x35612a]);
                            }

                            if (Number(_refRow.sms_recebido) === 1 || _refRow.sms_recebido == true) {
                                _0x1ca1fd('🎯 Referência confirmada via ADB reivindicada via texto direto: ref=' + _0x35612a, 'success');
                                await _0x2c5e52('UPDATE referencias SET status = ? WHERE ref = ?', ['na_fila', _0x35612a]);
                                await _0x303482(_0x25f8ef, _0x37fcf7, _refRow.ref, _refRow.valor, _refRow.quantidade, targetNum, _refRow.comprovativo_msg_id || _0x2368aa['id'], _0x457c95, _refRow.tipo, _refRow.sobra || 0);
                            } else {
                                _0x1ca1fd('⏳ Número associado à referência pendente (SMS não recebido ainda): ref=' + _0x35612a + ', numero=' + targetNum, 'info');
                                const _msgWait = '⏳ *NÚMERO CADASTRADO E AGUARDANDO CONFIRMAÇÃO* 🇲🇿\n━━━━━━━━━━━━━━━━━━\n📢 *Referência:* ' + _0x35612a + '\n📞 *Destino:* ' + (targetNum || 'Não informado') + '\n━━━━━━━━━━━━━━━━━━\n⚠️ O bónus será enviado automaticamente assim que a **confirmação do valor (M-Pesa/E-Mola)** entrar no sistema.\n\nPor favor, aguarde.';
                                try {
                                    await _0x461461(_0x25f8ef, _0x37fcf7, _msgWait, _0x2368aa['id']);
                                } catch (e) {}
                            }
                            return;
                        }
                    } catch (e) {
                        _0x1ca1fd('❌ Erro ao auto-validar referência via ADB: ' + e.message, 'error');
                    }
                }

                const _0x223ae6 = _0x3d5bec(_0x519db1),
                    _0x414f73 = _0x3b207d(_0x223ae6, _0x37fcf7);
                if (_0x35612a && _0x223ae6 && _0x414f73) {
                    const {
                        quantidade: _0x3856d5,
                        tipo: _0x4202cb
                    } = _0x414f73;
                    await _0x49909c(_0x25f8ef, _0x2368aa, _0x35612a, _0x223ae6, _0x3856d5, _0x4202cb, _0x37fcf7, _0x457c95);
                    return;
                } else if (_0x223ae6 && !_0x414f73 && (_0x2807cf(_0x519db1) || _0x519db1.toLowerCase().includes('transferiste') || _0x519db1.toLowerCase().includes('recebeste'))) {
                    _0x1ca1fd('⚠️ Comprovativo recebido mas valor ' + _0x223ae6 + 'MT não está na tabela.', 'warning');
                    const { supportNum, sysName: _sN } = _getSupportDetails();
                    const _msgValueError = `✨ *${_sN.toUpperCase()} • NOTIFICAÇÃO* ✨\n━━━━━━━━━━━━━━━━━━━\n\n⚠️ *VALOR NÃO RECONHECIDO*\n\nAnalisamos o seu comprovativo, mas o valor de *${_0x223ae6} MT* não corresponde a nenhum pacote na nossa tabela atual.\n\nPor favor, contacte a administração pelo número *${supportNum}* para que possamos ativar o seu pacote manualmente.\n\nO seu saldo está seguro com a ${_sN}! 🙏\n\n━━━━━━━━━━━━━━━━━━━\n🚀 *Internet rápida em segundos!*`;
                    try { await _0x461461(_0x25f8ef, _0x37fcf7, _msgValueError, _0x2368aa['id']); } catch(e){}
                    return;
                }
                
                if (_0x519db1['startsWith']('/tentar') || _0x519db1['startsWith']('!tentar') || _0x519db1['startsWith']('.tentar')) {
                    const _0x2dceb2 = _0x519db1['split'](/\s+/),
                        _0x49b586 = _0x2dceb2['length'] > 0x1 ? _0x2dceb2[0x1]['trim']()['toUpperCase']() : null;
                    _0x49b586 ? await _0x186b18(_0x25f8ef, _0x49b586, _0x37fcf7, _0x457c95) : await _0x461461(_0x25f8ef, _0x37fcf7, '📝 Uso: .tentar <referência>', _0x2368aa['id']);
                    return;
                }
                if (_0x519db1 === '/status' || _0x519db1 === '!status' || _0x519db1 === '.status' || _0x316b84 === '.status') {
                    try {
                        // Build status directly from live arrays (_0x13e11b = ports, _0x4ef91a = queue)
                        const _statusPortas = Array.isArray(_0x13e11b) ? _0x13e11b : [];
                        const _fila = Array.isArray(_0x4ef91a) ? _0x4ef91a : [];
                        const _portasOnline = _statusPortas.filter(p => p.online).length;
                        const _portasLivres = _statusPortas.filter(p => p.online && p.livre && !p.sem_saldo).length;
                        const _portasOcupadas = _statusPortas.filter(p => p.online && !p.livre).length;
                        const _totalPortas = _statusPortas.length;
                        const _tiposNaFila = {};
                        _fila.forEach(item => {
                            const t = item.tipo || 'desconhecido';
                            _tiposNaFila[t] = (_tiposNaFila[t] || 0) + 1;
                        });
                        const _portasStr = _statusPortas.map(p => {
                            if (p.sem_saldo) return '🔴 ' + p.nome + ': SEM SALDO';
                            return (p.online ? '🟢' : '🔴') + ' ' + p.nome + ': ' + (p.online ? (p.livre ? 'LIVRE' : 'OCUPADA') : 'OFFLINE');
                        }).join('\n');
                        const _tiposStr = Object.entries(_tiposNaFila).map(([k, v]) => k + ': ' + v).join(', ');
                        const _msgStatus = '📊 *STATUS DO SISTEMA*\n━━━━━━━━━━━━━━━━━━\n🔌 *PORTAS:*\n' + (_portasStr || '• Nenhuma porta configurada') + '\n\n📥 *FILA:*\n• Total: ' + _fila.length + ' item(s)\n• Tipos: ' + (_tiposStr || 'Nenhum') + '\n• Portas online: ' + _portasOnline + '/' + _totalPortas + '\n• Portas livres: ' + _portasLivres + '\n• Portas ocupadas: ' + _portasOcupadas + '\n\n⏰ *Última atualização:* ' + new Date().toLocaleTimeString('pt-MZ');
                        await _0x461461(_0x25f8ef, _0x37fcf7, _msgStatus, _0x2368aa['id']);
                    } catch (_0x350cf4) {
                        _0x1ca1fd('❌\x20Erro\x20ao\x20mostrar\x20status:\x20' + _0x350cf4['message'], 'error');
                        await _0x461461(_0x25f8ef, _0x37fcf7, '❌ Erro ao obter status do sistema: ' + _0x350cf4.message, _0x2368aa['id']);
                    }
                    return;
                }
                if (_0x519db1 === '/limpar' || _0x519db1 === '!limpar' || _0x519db1 === '.limpar' || _0x316b84 === '.limpar') {
                    try {
                        await _0x49e88c(), await _0x461461(_0x25f8ef, _0x37fcf7, '🧹\x20Limpeza\x20de\x20registros\x20antigos\x20executada.', _0x2368aa['id']);
                    } catch (_0x258092) {
                        _0x1ca1fd('❌\x20Erro\x20ao\x20limpar\x20registros:\x20' + _0x258092['message'], 'error'), await _0x461461(_0x25f8ef, _0x37fcf7, '❌\x20Erro\x20ao\x20limpar\x20registros.', _0x2368aa['id']);
                    }
                    return;
                } if (!_0x2368aa['isGroupMsg'] && !_0x2368aa['_skipIA']) {
                    await _responderConversaIA(_0x25f8ef, _0x2368aa, _0x519db1, _0x37fcf7, _isMsgFornecimento);
                }
            };

            _0x25f8ef['onMessage'](async msg => tratarMensagem(_0x25f8ef, msg));

            // Notificar quando o bot for adicionado a um novo grupo pendente de autorização
            _0x25f8ef['onAddedToGroup'](async (chat) => {
                try {
                    const _gid = chat.id._serialized || chat.id || '';
                    if (_gid && !_0x18020a.includes(_gid)) {
                        _0x1ca1fd('📥 Bot adicionado a novo grupo pendente de autorização: ' + _gid, 'info');
                        const _msgWelcome = `🔒 *𝗣𝗥𝗢𝗧𝗘𝗖̧𝗔̃𝗢 𝗞𝗔-𝗡𝗘𝗧* 🔒\n━━━━━━━━━━━━━━━━━━━\nOlá! Obrigado por adicionar o nosso Bot.\n\n⚠️ *Este grupo precisa de ser autorizado antes de funcionar.*\n\nPara ativar o bot aqui:\n👉 O número Administrador/Master deve enviar o comando: *.autorizar*\n\n🆔 *Grupo ID:* \`${_gid}\`\n━━━━━━━━━━━━━━━━━━━`;
                        _0x25f8ef.sendText(_gid, _msgWelcome).catch(() => {});
                    }
                } catch(eAddGp) {}
            });

            // --- WHATSAPP DE FORNECIMENTO (Inicia apenas quando clicado no painel) ---
            global['fornecQRData'] = null;
            global['fornecQRStatus'] = 'desativado';

            // ── Expor função global para iniciar fornecimento a quente (via painel) ──
            global._iniciarFornecimento = async function() {
                // BLOQUEAR FORNECIMENTO NO SISTEMA DO PROPRIETÁRIO
                const _isOwnerSys = global.licencaObj && (
                    (typeof global.licencaObj._isOwnerMode === 'function' && global.licencaObj._isOwnerMode()) ||
                    (global.licencaObj.licenca && global.licencaObj.licenca._owner === true)
                );
                if (_isOwnerSys) {
                    _0x1ca1fd('ℹ️ [FORNECIMENTO] Sistema do Proprietário — Fornecimento desativado.', 'info');
                    return { ok: false, status: 'desativado', mensagem: 'Fornecimento desativado no sistema do proprietário.' };
                }
                // Se já está conectado, retorna
                if (global.clientFornecimento) {
                    return { ok: true, status: 'ja_conectado', mensagem: 'WhatsApp de fornecimento já está conectado.' };
                }
                _0x1ca1fd('⚡ [FORNECIMENTO] Iniciando segunda sessão WhatsApp (via painel)...', 'info');
                global['fornecQRData'] = null;
                global['fornecQRStatus'] = 'a iniciar';
                const _pathFornec = require('path');
                const _fsFornec = require('fs');
                const _fornecUserDataDir = _pathFornec.join(process.cwd(), '_IGNORE_FORNEC_INSTANT');
                const _fornecChromeExec = _chromePath || (_fsFornec.existsSync(_defaultChrome) ? _defaultChrome : (_fsFornec.existsSync(_defaultChrome86) ? _defaultChrome86 : (_fsFornec.existsSync(_defaultEdge64) ? _defaultEdge64 : (_fsFornec.existsSync(_defaultEdge) ? _defaultEdge : null))));

                const _pOptionsFornec = {
                    'protocolTimeout': 240000,
                    'userDataDir': _fornecUserDataDir,
                    'args': [
                        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                        '--disable-blink-features=AutomationControlled',
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--ignore-certificate-errors',
                        '--disable-web-security',
                        '--disable-gpu',
                        '--no-first-run',
                        '--no-default-browser-check',
                        '--remote-debugging-port=9333',
                        '--window-position=930,0',
                        '--window-size=920,900'
                    ]
                };
                if (_fornecChromeExec) _pOptionsFornec.executablePath = _fornecChromeExec;

                const _waConfigFornec = {
                    'sessionId': 'FORNEC_INSTANT',
                    'multiDevice': true,
                    'useStealth': false,
                    'useChrome': true,
                    'authTimeout': 600,
                    'qrTimeout': 600,
                    'navigationTimeout': 180,
                    'blockCrashLogs': true,
                    'disableSpins': true,
                    'cacheEnabled': true,
                    'killProcessOnBrowserClose': false,
                    'restartOnCrash': false,
                    'disableWelcome': true,
                    'logConsole': true,
                    'popup': false,
                    'skipBrokenMethodsCheck': true,
                    'skipUpdateCheck': true,
                    'throwErrorOnTosBlock': false,
                    'qrCallback': async (qrData) => {
                        global['fornecQRStatus'] = 'aguardando_qr';
                        try {
                            const QRCode = require('qrcode');
                            const qrText = (qrData && typeof qrData === 'object') ? (qrData.qrcode || qrData.data || JSON.stringify(qrData)) : String(qrData);
                            global['fornecQRData'] = await QRCode.toDataURL(qrText, { width: 256, margin: 2 });
                        } catch(e) {
                            global['fornecQRData'] = null;
                        }
                        _0x1ca1fd('⚡ [FORNECIMENTO] QR Code gerado — abra o painel em /fornecimento para scanar.', 'info');
                    },
                    'puppeteerOptions': _pOptionsFornec,
                    'headless': !process.argv.includes('--show-chrome') && !process.argv.includes('--show')
                };
                if (_fornecChromeExec) _waConfigFornec.executablePath = _fornecChromeExec;

                try {
                    const _clientFornec = await _0x15c3fe(_waConfigFornec);
                    global['clientFornecimento'] = _clientFornec;
                    global['fornecQRData'] = null;
                    global['fornecQRStatus'] = 'CONNECTED';
                    _0x1ca1fd('⚡ [FORNECIMENTO] WhatsApp de fornecimento conectado com sucesso!', 'success');

                    _clientFornec.onMessage(async msg => {
                        if (!msg) return;
                        try {
                            // Marcar todas as mensagens do WhatsApp de Fornecimento
                            msg._isFornecimento = true;
                            if (msg.isGroupMsg) {
                                const cfg = JSON.parse(require('fs').readFileSync(require('path').join(global._kanetBase || __dirname, 'local_config.json'), 'utf8'));
                                if (msg.from === cfg.grupo_fornecimento) {
                                    msg._skipIA = true;
                                    await tratarMensagem(_clientFornec, msg);
                                } else {
                                    // Outros grupos no WhatsApp de Fornecimento também são tratados como fornecimento
                                    msg._skipIA = true;
                                    await tratarMensagem(_clientFornec, msg);
                                }
                            } else {
                                msg._skipIA = true;
                                await tratarMensagem(_clientFornec, msg);
                            }
                        } catch(e){}
                    });
                    return { ok: true, status: 'CONNECTED', mensagem: 'WhatsApp de fornecimento conectado!' };
                } catch(errFornec) {
                    global['fornecQRStatus'] = 'erro';
                    _0x1ca1fd('⚠️ [FORNECIMENTO] Erro ao iniciar WhatsApp de fornecimento: ' + errFornec.message, 'warning');
                    return { ok: false, status: 'erro', mensagem: errFornec.message };
                }
            };

            const _lcFornecCfg = (function() {
                try { return JSON.parse(require('fs').readFileSync(require('path').join(global._kanetBase || __dirname, 'local_config.json'), 'utf8')); } catch(e) { return {}; }
            })();

            // --- FORNECIMENTO: NÃO INICIAR NO SISTEMA DO PROPRIETÁRIO (KELVEN) ---
            const _isOwnerSystem = global.licencaObj && (
                (typeof global.licencaObj._isOwnerMode === 'function' && global.licencaObj._isOwnerMode()) ||
                (global.licencaObj.licenca && global.licencaObj.licenca._owner === true)
            );
            const _fornecAtivo = process.argv.includes('--fornecimento') || process.env.FORNECIMENTO_MODE === 'true' || _lcFornecCfg.segunda_sessao_ativa === true || _lcFornecCfg.fornecimento_ativo === true;

            if (_fornecAtivo && !_isOwnerSystem) {
                _0x1ca1fd('⚡ Modo Fornecimento ativado. Iniciando WhatsApp de Fornecimento...', 'info');
                setTimeout(async () => {
                    try {
                        if (typeof global._iniciarFornecimento === 'function') {
                            await global._iniciarFornecimento();
                        }
                    } catch(eFornecStartup) {
                        _0x1ca1fd('⚠️ [FORNECIMENTO] Erro ao iniciar sessão de fornecimento (Chrome não disponível?): ' + eFornecStartup.message + ' — O sistema principal continua a funcionar normalmente.', 'warning');
                        global['fornecQRStatus'] = 'erro';
                    }
                }, 15000);
            } else if (_fornecAtivo && _isOwnerSystem) {
                _0x1ca1fd('ℹ️ [FORNECIMENTO] Sistema do Proprietário detectado — WhatsApp de Fornecimento desativado neste sistema.', 'info');
            }

            // ══ LISTENER: AUTO-REMOVER BANIDOS QUANDO ENTRAM NO GRUPO ══════
            _0x25f8ef['onGlobalParticipantsChanged'](async (_mudanca) => {
                try {
                    // Só actua quando alguém entra (via link ou adicionado)
                    const _acoes = ['add', 'invite', 'joined', 'promoted'];
                    const _acao = (_mudanca.action || '').toLowerCase();
                    if (!_acoes.some(_a => _acao.includes(_a))) return;
                    
                    let _gid = '';
                    if (typeof _mudanca === 'string') {
                        _gid = _mudanca;
                    } else if (_mudanca) {
                        _gid = _mudanca.chatId || 
                               (typeof _mudanca.chat === 'string' ? _mudanca.chat : (_mudanca.chat?.id?._serialized || _mudanca.chat?.id || '')) || 
                               _mudanca.gid || 
                               _mudanca.id || 
                               '';
                    }
                    if (!_gid) return;
                    if (_gid === '120363424819563179@g.us') {
                        await _sincronizarMembrosEstudantes(_0x25f8ef);
                    }

                    const _participantes = Array.isArray(_mudanca.who) ? _mudanca.who 
                        : (_mudanca.participants ? _mudanca.participants : (_mudanca.who ? [_mudanca.who] : []));
                    
                    // --- NOVA LÓGICA DE GRUPOS CONCORRENTES (BANIMENTO AUTOMÁTICO) ---
                    if (global['gruposConcorrentes'] && global['gruposConcorrentes'].has(_gid)) {
                        for (const _p of _participantes) {
                             const _pJid = typeof _p === 'string' ? _p : (_p._serialized || _p.id || '');
                             const _pJidNorm = _pJid.includes('@') ? _pJid : _pJid + '@c.us';
                             if (!global['numerosBanidos'] || !global['numerosBanidos'].has(_pJidNorm)) {
                                 if (!global['numerosBanidos']) global['numerosBanidos'] = new Set();
                                 global['numerosBanidos'].add(_pJidNorm);
                                 await _0x2c5e52('INSERT OR IGNORE INTO banidos (jid, admin) VALUES (?, ?)', [_pJidNorm, 'AUTO_CONCORRENTE_JOIN']);
                                 _0x1ca1fd('🛡️ Guardian: Novo concorrente banido automaticamente (' + _pJidNorm + ') no grupo ' + _gid, 'warning');
                             }
                        }
                    }
                    // ----------------------------------------------------------------
                    
                    for (const _p of _participantes) {
                        const _pJid = typeof _p === 'string' ? _p : (_p._serialized || _p.id || '');
                        if (!_pJid) continue;
                        
                        // Normalizar para comparação
                        const _pJidNorm = _pJid.includes('@') ? _pJid : _pJid + '@c.us';
                        
                        if (global['numerosBanidos'] && global['numerosBanidos'].has(_pJidNorm)) {
                            _0x1ca1fd('🚫 Banido detectado no grupo ' + _gid + ': ' + _pJidNorm + ' — removendo...', 'warning');
                            try {
                                await new Promise(r => setTimeout(r, 1500)); // breve delay para evitar conflitos de cache
                                await _0x25f8ef['removeParticipant'](_gid, _pJidNorm);
                                _0x1ca1fd('✅ Banido removido automaticamente: ' + _pJidNorm + ' do grupo ' + _gid, 'success');
                                
                                // Notificar admin e grupo de notificações
                                const _avisoMsg = '🔨 *BANIDO REMOVIDO AUTOMATICAMENTE*\n' +
                                    '━━━━━━━━━━━━━━━━━━\n' +
                                    '📱 *Número:* ' + _pJidNorm.replace('@c.us', '') + '\n' +
                                    '👥 *Grupo:* ' + _gid + '\n' +
                                    '🔒 *Ação:* Entrada bloqueada e removido automaticamente.';
                                
                                if (_0x23fc97) await _0x25f8ef['sendText'](_0x23fc97, _avisoMsg).catch(() => {});
                                if (_0x40b822) await _0x25f8ef['sendText'](_0x40b822, _avisoMsg).catch(() => {});
                            } catch (_eRem) {
                                _0x1ca1fd('⚠️ Falha ao remover banido auto: ' + _eRem.message, 'error');
                            }
                        } else {
                            // ENVIAR BOAS VINDAS PARA NOVOS MEMBROS (Se não estiver banido)
                            if (_acao === 'add' || _acao === 'invite' || _acao === 'joined') {
                                _0x1ca1fd('👋 Detetada entrada de ' + _pJidNorm + ' no grupo ' + _gid, 'info');
                                if (typeof _enviarBoasVindas === 'function') {
                                    await _enviarBoasVindas(_0x25f8ef, _pJidNorm, _gid);
                                }
                                try { await _registrarEntradaGrupo(_0x25f8ef, _pJidNorm, _gid); } catch(e2) {}
                            }
                        }
                    }
                } catch (_eBanListener) {
                    _0x1ca1fd('❌ Erro no listener de banidos: ' + _eBanListener.message, 'error');
                }
            });
            // ══ FIM LISTENER BANIDOS ═══════════════════════════════════════
        } catch (_0x320e0f) {
            _0x1ca1fd('❌\x20Erro\x20crítico\x20ao\x20iniciar\x20bot:\x20' + _0x320e0f['message'], 'error');
            throw _0x320e0f;
        }
    }
    (require['main'] === module || !!global.licencaObj) && _0x28ced1()['catch'](_0x2be3f5 => {
        console['error']('❌\x20Falha\x20crítica:', _0x2be3f5), process['exit'](0x1);
    });
    if (typeof _0x4b9ef8 !== 'undefined') _0x43130f['sqlite3'] = _0x4b9ef8;
    if (typeof _0x32d49c !== 'undefined') _0x43130f['fs'] = _0x32d49c;
    if (typeof _0x3d65f9 !== 'undefined') _0x43130f['adbkit'] = _0x3d65f9;
    if (typeof _0x267794 !== 'undefined') _0x43130f['express'] = _0x267794;
    if (typeof _0x2b00ac !== 'undefined') _0x43130f['bodyParser'] = _0x2b00ac;
    if (typeof _0x4ccc8d !== 'undefined') _0x43130f['crypto'] = _0x4ccc8d;
    if (typeof mudancas !== 'undefined') _0x43130f['mudancas'] = mudancas;
    if (typeof online !== 'undefined') _0x43130f['online'] = online;
    if (typeof livres !== 'undefined') _0x43130f['livres'] = livres;
    if (typeof estavaOnline !== 'undefined') _0x43130f['estavaOnline'] = estavaOnline;
    if (typeof controller !== 'undefined') _0x43130f['controller'] = controller;
    if (typeof res !== 'undefined') _0x43130f['res'] = res;
    if (typeof data !== 'undefined') _0x43130f['data'] = data;
    if (typeof ultimoUsoPortas !== 'undefined') _0x43130f['ultimoUsoPortas'] = ultimoUsoPortas;
    if (typeof porta !== 'undefined') _0x43130f['porta'] = porta;
    if (typeof memoryUsage !== 'undefined') _0x43130f['memoryUsage'] = memoryUsage;
    if (typeof securityChecks !== 'undefined') _0x43130f['securityChecks'] = securityChecks;
    if (typeof originalLog !== 'undefined') _0x43130f['originalLog'] = originalLog;
    if (typeof filteredArgs !== 'undefined') _0x43130f['filteredArgs'] = filteredArgs;
    if (typeof _0x3c21ac !== 'undefined') _0x43130f['BOT_EXPIRACAO_DIAS'] = _0x3c21ac;
    if (typeof _0x1393f2 !== 'undefined') _0x43130f['BOT_DATA_INICIO'] = _0x1393f2;
    if (typeof _0x18020a !== 'undefined') _0x43130f['GRUPOS_PERMITIDOS'] = _0x18020a;
    if (typeof _0x330e5a !== 'undefined') _0x43130f['comandosPermitidos'] = _0x330e5a;
    if (typeof _0x16260a !== 'undefined') _0x43130f['USUARIO_PERMITIDO'] = _0x16260a;
    if (typeof usuarioAtual !== 'undefined') _0x43130f['usuarioAtual'] = usuarioAtual;
    if (typeof partes !== 'undefined') _0x43130f['partes'] = partes;
    if (typeof ajuda !== 'undefined') _0x43130f['ajuda'] = ajuda;
    if (typeof numero !== 'undefined') _0x43130f['numero'] = numero;
    if (typeof quantidadeMB !== 'undefined') _0x43130f['quantidadeMB'] = quantidadeMB;
    if (typeof ref !== 'undefined') _0x43130f['ref'] = ref;
    if (typeof dataInicio !== 'undefined') _0x43130f['dataInicio'] = dataInicio;
    if (typeof dataAtual !== 'undefined') _0x43130f['dataAtual'] = dataAtual;
    if (typeof diferencaDias !== 'undefined') _0x43130f['diferencaDias'] = diferencaDias;
    if (typeof diasRestantes !== 'undefined') _0x43130f['diasRestantes'] = diasRestantes;
    if (typeof infoBot !== 'undefined') _0x43130f['infoBot'] = infoBot;
    if (typeof dataExpiracaoFormatada !== 'undefined') _0x43130f['dataExpiracaoFormatada'] = dataExpiracaoFormatada;
    if (typeof dataInicioFormatada !== 'undefined') _0x43130f['dataInicioFormatada'] = dataInicioFormatada;
    if (typeof mensagem !== 'undefined') _0x43130f['mensagem'] = mensagem;
    if (typeof dataInicio !== 'undefined') _0x43130f['dataInicio'] = dataInicio;
    if (typeof dataAtual !== 'undefined') _0x43130f['dataAtual'] = dataAtual;
    if (typeof diferencaDias !== 'undefined') _0x43130f['diferencaDias'] = diferencaDias;
    if (typeof jid !== 'undefined') _0x43130f['jid'] = jid;
    if (typeof _0x1504fd !== 'undefined') _0x43130f['JOIN_API_KEY'] = _0x1504fd;
    if (typeof _0x16875e !== 'undefined') _0x43130f['DEVICE_ID'] = _0x16875e;
    if (typeof _0x2bd9ef !== 'undefined') _0x43130f['DB_FILE'] = _0x2bd9ef;
    if (typeof _0xc025ef !== 'undefined') _0x43130f['LOG_FILE'] = _0xc025ef;
    if (typeof _0x1f3baf !== 'undefined') _0x43130f['MASTER_TOKEN'] = _0x1f3baf;
    if (typeof _0x23fc97 !== 'undefined') _0x43130f['ADMIN_NUMBER'] = _0x23fc97;
    if (typeof _0xdda68c !== 'undefined') _0x43130f['HTTP_PORT'] = _0xdda68c;
    if (typeof _0x56fa8d !== 'undefined') _0x43130f['ADB_SERIAL'] = _0x56fa8d;
    if (typeof _0x57353c !== 'undefined') _0x43130f['GRUPO_ERROS'] = _0x57353c;
    if (typeof _0x40b822 !== 'undefined') _0x43130f['GRUPO_NOTIFICACOES'] = _0x40b822;
    if (typeof _0x3d41a5 !== 'undefined') _0x43130f['BOT_ID'] = _0x3d41a5;
    if (typeof _0x538ae4 !== 'undefined') _0x43130f['FASTAPI_PORTS'] = _0x538ae4;
    if (typeof _0x31ff38 !== 'undefined') _0x43130f['CONGESTION_THRESHOLD'] = _0x31ff38;
    if (typeof _0x888e43 !== 'undefined') _0x43130f['REFS_PROCESSADAS'] = _0x888e43;
    if (typeof _0x5b9308 !== 'undefined') _0x43130f['TEMPO_BLOQUEIO_REF'] = _0x5b9308;
    if (typeof refUpper !== 'undefined') _0x43130f['refUpper'] = refUpper;
    if (typeof timestamp !== 'undefined') _0x43130f['timestamp'] = timestamp;
    if (typeof refUpper !== 'undefined') _0x43130f['refUpper'] = refUpper;
    if (typeof agora !== 'undefined') _0x43130f['agora'] = agora;
    if (typeof _0x43e3f6 !== 'undefined') _0x43130f['PROCESSOS_ATIVOS'] = _0x43e3f6;
    if (typeof _0x536ba5 !== 'undefined') _0x43130f['BLOQUEIO_DUPLICACAO_FILA'] = _0x536ba5;
    if (typeof _0x330084 !== 'undefined') _0x43130f['TEMPO_BLOQUEIO_DUPLICACAO'] = _0x330084;
    if (typeof startTime !== 'undefined') _0x43130f['startTime'] = startTime;
    if (typeof verificar !== 'undefined') _0x43130f['verificar'] = verificar;
    if (typeof _0x13e11b !== 'undefined') _0x43130f['portas'] = _0x13e11b;
    if (typeof _0x4ef91a !== 'undefined') _0x43130f['filaTransferencias'] = _0x4ef91a;
    if (typeof _0x2b714a !== 'undefined') _0x43130f['chavesUnicasProcessamento'] = _0x2b714a;
    if (typeof _0x557233 !== 'undefined') _0x43130f['portEmitter'] = _0x557233;
    if (typeof _0x9ae02b !== 'undefined') _0x43130f['SMS_PROCESSADOS'] = _0x9ae02b;
    if (typeof _0x5b3974 !== 'undefined') _0x43130f['ultimosSmsProcessados'] = _0x5b3974;
    if (typeof _0x1d9355 !== 'undefined') _0x43130f['BLOQUEIO_SMS_MS'] = _0x1d9355;
    if (typeof _0x449b1a !== 'undefined') _0x43130f['indiceUltimaPortaUsada'] = _0x449b1a;
    if (typeof _0x3899c3 !== 'undefined') _0x43130f['globalLocks'] = _0x3899c3;
    if (typeof _0x843ce5 !== 'undefined') _0x43130f['INIT_LOCKS'] = _0x843ce5;
    if (typeof _0x139d0c !== 'undefined') _0x43130f['RESPOSTAS_RAPIDAS_CACHE'] = _0x139d0c;
    if (typeof _0x250ac9 !== 'undefined') _0x43130f['CACHE_TIMEOUT'] = _0x250ac9;
    if (typeof enviarMensagem !== 'undefined') _0x43130f['enviarMensagem'] = enviarMensagem;
    if (typeof dataHora !== 'undefined') _0x43130f['dataHora'] = dataHora;
    if (typeof mensagemErroTratada !== 'undefined') _0x43130f['mensagemErroTratada'] = mensagemErroTratada;
    if (typeof acao !== 'undefined') _0x43130f['acao'] = acao;
    if (typeof tipoDisplay !== 'undefined') _0x43130f['tipoDisplay'] = tipoDisplay;
    if (typeof mensagem !== 'undefined') _0x43130f['mensagem'] = mensagem;
    if (typeof mensagemParaReply !== 'undefined') _0x43130f['mensagemParaReply'] = mensagemParaReply;
    if (typeof msg !== 'undefined') _0x43130f['msg'] = msg;
    if (typeof mensagemTratada !== 'undefined') _0x43130f['mensagemTratada'] = mensagemTratada;
    if (typeof errosSemRetry !== 'undefined') _0x43130f['errosSemRetry'] = errosSemRetry;
    if (typeof _0x422180 !== 'undefined') _0x43130f['REFERENCIAS_ELIMINADAS'] = _0x422180;
    if (typeof refUpper !== 'undefined') _0x43130f['refUpper'] = refUpper;
    if (typeof isMPesaFormat !== 'undefined') _0x43130f['isMPesaFormat'] = isMPesaFormat;
    if (typeof isEMolaFormat !== 'undefined') _0x43130f['isEMolaFormat'] = isEMolaFormat;
    if (typeof _0x9a616a !== 'undefined') _0x43130f['PACOTES_ILIMITADOS'] = _0x9a616a;
    if (typeof _0x17ff51 !== 'undefined') _0x43130f['PACOTES_MENSAIS'] = _0x17ff51;
    if (typeof _0x29d1af !== 'undefined') _0x43130f['PACOTES_24HRS'] = _0x29d1af;
    if (typeof _0x39a69d !== 'undefined') _0x43130f['PACOTES_SEMANAIS'] = _0x39a69d;
    if (typeof _0x48e9aa !== 'undefined') _0x43130f['TABELA_GERAL_24HRS'] = _0x48e9aa;
    if (typeof _0x7d9007 !== 'undefined') _0x43130f['TABELAS_24HRS_POR_GRUPO'] = _0x7d9007;
    if (typeof match !== 'undefined') _0x43130f['match'] = match;
    if (typeof _0x3676ca !== 'undefined') _0x43130f['TABELA'] = _0x3676ca;
    if (typeof valorInt !== 'undefined') _0x43130f['valorInt'] = valorInt;
    if (typeof pacote !== 'undefined') _0x43130f['pacote'] = pacote;
    if (typeof p !== 'undefined') _0x43130f['p'] = p;
    if (typeof p !== 'undefined') _0x43130f['p'] = p;
    if (typeof p !== 'undefined') _0x43130f['p'] = p;
    if (typeof valorInt !== 'undefined') _0x43130f['valorInt'] = valorInt;
    if (typeof isPrivate !== 'undefined') _0x43130f['isPrivate'] = isPrivate;
    if (typeof pacote !== 'undefined') _0x43130f['pacote'] = pacote;
    if (typeof grupoNumero !== 'undefined') _0x43130f['grupoNumero'] = grupoNumero;
    if (typeof match !== 'undefined') _0x43130f['match'] = match;
    if (typeof pacote !== 'undefined') _0x43130f['pacote'] = pacote;
    if (typeof p !== 'undefined') _0x43130f['p'] = p;
    if (typeof p !== 'undefined') _0x43130f['p'] = p;
    if (typeof p !== 'undefined') _0x43130f['p'] = p;
    if (typeof valorInt !== 'undefined') _0x43130f['valorInt'] = valorInt;
    if (typeof p !== 'undefined') _0x43130f['p'] = p;
    if (typeof valorInt !== 'undefined') _0x43130f['valorInt'] = valorInt;
    if (typeof p !== 'undefined') _0x43130f['p'] = p;
    if (typeof registros !== 'undefined') _0x43130f['registros'] = registros;
    if (typeof hash !== 'undefined') _0x43130f['hash'] = hash;
    if (typeof registros !== 'undefined') _0x43130f['registros'] = registros;
    if (typeof refUpper !== 'undefined') _0x43130f['refUpper'] = refUpper;
    if (typeof _0x23e468 !== 'undefined') _0x43130f['ultimosLogs'] = _0x23e468;
    if (typeof _0x2a4e1b !== 'undefined') _0x43130f['TEMPO_BLOQUEIO_DUPLICATAS'] = _0x2a4e1b;
    if (typeof _0xf8b413 !== 'undefined') _0x43130f['LOG_IGNORE_PATTERNS'] = _0xf8b413;
    if (typeof timestamp !== 'undefined') _0x43130f['timestamp'] = timestamp;
    if (typeof logKey !== 'undefined') _0x43130f['logKey'] = logKey;
    if (typeof ultimoTimestamp !== 'undefined') _0x43130f['ultimoTimestamp'] = ultimoTimestamp;
    if (typeof icone !== 'undefined') _0x43130f['icone'] = icone;
    if (typeof logMsg !== 'undefined') _0x43130f['logMsg'] = logMsg;
    if (typeof portasToCheck !== 'undefined') _0x43130f['portasToCheck'] = portasToCheck;
    if (typeof mudouEstado !== 'undefined') _0x43130f['mudouEstado'] = mudouEstado;
    if (typeof estadoAnterior !== 'undefined') _0x43130f['estadoAnterior'] = estadoAnterior;
    if (typeof livreAnterior !== 'undefined') _0x43130f['livreAnterior'] = livreAnterior;
    if (typeof controller !== 'undefined') _0x43130f['controller'] = controller;
    if (typeof timeoutId !== 'undefined') _0x43130f['timeoutId'] = timeoutId;
    if (typeof response !== 'undefined') _0x43130f['response'] = response;
    if (typeof result !== 'undefined') _0x43130f['result'] = result;
    if (typeof saudavel !== 'undefined') _0x43130f['saudavel'] = saudavel;
    if (typeof portasOnline !== 'undefined') _0x43130f['portasOnline'] = portasOnline;
    if (typeof portasLivres !== 'undefined') _0x43130f['portasLivres'] = portasLivres;
    if (typeof resolved !== 'undefined') _0x43130f['resolved'] = resolved;
    if (typeof tentativas !== 'undefined') _0x43130f['tentativas'] = tentativas;
    if (typeof maxTentativas !== 'undefined') _0x43130f['maxTentativas'] = maxTentativas;
    if (typeof verificarTodasPortas !== 'undefined') _0x43130f['verificarTodasPortas'] = verificarTodasPortas;
    if (typeof portasDisponiveis !== 'undefined') _0x43130f['portasDisponiveis'] = portasDisponiveis;
    if (typeof portaEscolhida !== 'undefined') _0x43130f['portaEscolhida'] = portaEscolhida;
    if (typeof onPortAvailable !== 'undefined') _0x43130f['onPortAvailable'] = onPortAvailable;
    if (typeof cleanup !== 'undefined') _0x43130f['cleanup'] = cleanup;
    if (typeof timeout !== 'undefined') _0x43130f['timeout'] = timeout;
    if (typeof porta !== 'undefined') _0x43130f['porta'] = porta;
    if (typeof controller !== 'undefined') _0x43130f['controller'] = controller;
    if (typeof timeoutId !== 'undefined') _0x43130f['timeoutId'] = timeoutId;
    if (typeof response !== 'undefined') _0x43130f['response'] = response;
    if (typeof db !== 'undefined') _0x43130f['db'] = db;
    if (typeof db !== 'undefined') _0x43130f['db'] = db;
    if (typeof db !== 'undefined') _0x43130f['db'] = db;
    if (typeof startTime !== 'undefined') _0x43130f['startTime'] = startTime;
    if (typeof resolved !== 'undefined') _0x43130f['resolved'] = resolved;
    if (typeof tentativas !== 'undefined') _0x43130f['tentativas'] = tentativas;
    if (typeof maxTentativas !== 'undefined') _0x43130f['maxTentativas'] = maxTentativas;
    if (typeof verificarPortas !== 'undefined') _0x43130f['verificarPortas'] = verificarPortas;
    if (typeof portasDisponiveis !== 'undefined') _0x43130f['portasDisponiveis'] = portasDisponiveis;
    if (typeof portaEscolhida !== 'undefined') _0x43130f['portaEscolhida'] = portaEscolhida;
    if (typeof onPortAvailable !== 'undefined') _0x43130f['onPortAvailable'] = onPortAvailable;
    if (typeof cleanup !== 'undefined') _0x43130f['cleanup'] = cleanup;
    if (typeof timeout !== 'undefined') _0x43130f['timeout'] = timeout;
    if (typeof startTime !== 'undefined') _0x43130f['startTime'] = startTime;
    if (typeof resolved !== 'undefined') _0x43130f['resolved'] = resolved;
    if (typeof tentativas !== 'undefined') _0x43130f['tentativas'] = tentativas;
    if (typeof maxTentativas !== 'undefined') _0x43130f['maxTentativas'] = maxTentativas;
    if (typeof verificarPortas !== 'undefined') _0x43130f['verificarPortas'] = verificarPortas;
    if (typeof portasNormaisDisponiveis !== 'undefined') _0x43130f['portasNormaisDisponiveis'] = portasNormaisDisponiveis;
    if (typeof portaEscolhida !== 'undefined') _0x43130f['portaEscolhida'] = portaEscolhida;
    if (typeof timestamp !== 'undefined') _0x43130f['timestamp'] = timestamp;
    if (typeof randomSuffix !== 'undefined') _0x43130f['randomSuffix'] = randomSuffix;
    if (typeof chaveUnica !== 'undefined') _0x43130f['chaveUnica'] = chaveUnica;
    if (typeof tiposExclusivos8777 !== 'undefined') _0x43130f['tiposExclusivos8777'] = tiposExclusivos8777;
    if (typeof infoBloco !== 'undefined') _0x43130f['infoBloco'] = infoBloco;
    if (typeof tipoDisplay !== 'undefined') _0x43130f['tipoDisplay'] = tipoDisplay;
    if (typeof controller !== 'undefined') _0x43130f['controller'] = controller;
    if (typeof timeoutId !== 'undefined') _0x43130f['timeoutId'] = timeoutId;
    if (typeof requestBody !== 'undefined') _0x43130f['requestBody'] = requestBody;
    if (typeof pacoteSemanal !== 'undefined') _0x43130f['pacoteSemanal'] = pacoteSemanal;
    if (typeof valorRegistro !== 'undefined') _0x43130f['valorRegistro'] = valorRegistro;
    if (typeof valorInt !== 'undefined') _0x43130f['valorInt'] = valorInt;
    if (typeof pacote !== 'undefined') _0x43130f['pacote'] = pacote;
    if (typeof pacote !== 'undefined') _0x43130f['pacote'] = pacote;
    if (typeof pacote !== 'undefined') _0x43130f['pacote'] = pacote;
    if (typeof response !== 'undefined') _0x43130f['response'] = response;
    if (typeof errorText !== 'undefined') _0x43130f['errorText'] = errorText;
    if (typeof result !== 'undefined') _0x43130f['result'] = result;
    if (typeof registroDivisoes !== 'undefined') _0x43130f['registroDivisoes'] = registroDivisoes;
    if (typeof temDivisoes !== 'undefined') _0x43130f['temDivisoes'] = temDivisoes;
    if (typeof tipoReferencia !== 'undefined') _0x43130f['tipoReferencia'] = tipoReferencia;
    if (typeof isParteExtra !== 'undefined') _0x43130f['isParteExtra'] = isParteExtra;
    if (typeof isTipoEspecial !== 'undefined') _0x43130f['isTipoEspecial'] = isTipoEspecial;
    if (typeof isReferenciaEspecial !== 'undefined') _0x43130f['isReferenciaEspecial'] = isReferenciaEspecial;
    if (typeof registrosProcessados !== 'undefined') _0x43130f['registrosProcessados'] = registrosProcessados;
    if (typeof blocosProcessados !== 'undefined') _0x43130f['blocosProcessados'] = blocosProcessados;
    if (typeof divisoes !== 'undefined') _0x43130f['divisoes'] = divisoes;
    if (typeof totalBlocosEsperados !== 'undefined') _0x43130f['totalBlocosEsperados'] = totalBlocosEsperados;
    if (typeof blocoAtual !== 'undefined') _0x43130f['blocoAtual'] = blocoAtual;
    if (typeof registroMsg !== 'undefined') _0x43130f['registroMsg'] = registroMsg;
    if (typeof quotedMsgId !== 'undefined') _0x43130f['quotedMsgId'] = quotedMsgId;
    if (typeof mensagemFinal !== 'undefined') _0x43130f['mensagemFinal'] = mensagemFinal;
    if (typeof valorRegistro !== 'undefined') _0x43130f['valorRegistro'] = valorRegistro;
    if (typeof valorInt !== 'undefined') _0x43130f['valorInt'] = valorInt;
    if (typeof pacote !== 'undefined') _0x43130f['pacote'] = pacote;
    if (typeof pacote !== 'undefined') _0x43130f['pacote'] = pacote;
    if (typeof extrasInfo !== 'undefined') _0x43130f['extrasInfo'] = extrasInfo;
    if (typeof pacote !== 'undefined') _0x43130f['pacote'] = pacote;
    if (typeof pacote !== 'undefined') _0x43130f['pacote'] = pacote;
    if (typeof pacote !== 'undefined') _0x43130f['pacote'] = pacote;
    if (typeof bonusTotal !== 'undefined') _0x43130f['bonusTotal'] = bonusTotal;
    if (typeof pacote !== 'undefined') _0x43130f['pacote'] = pacote;
    if (typeof bonusTotal !== 'undefined') _0x43130f['bonusTotal'] = bonusTotal;
    if (typeof registro !== 'undefined') _0x43130f['registro'] = registro;
    if (typeof quotedMsgId !== 'undefined') _0x43130f['quotedMsgId'] = quotedMsgId;
    if (typeof mensagemErro !== 'undefined') _0x43130f['mensagemErro'] = mensagemErro;
    if (typeof isErroSemRetryFlag !== 'undefined') _0x43130f['isErroSemRetryFlag'] = isErroSemRetryFlag;
    if (typeof isFalhaNosDoisSims !== 'undefined') _0x43130f['isFalhaNosDoisSims'] = isFalhaNosDoisSims;
    if (typeof outrasPortas8777 !== 'undefined') _0x43130f['outrasPortas8777'] = outrasPortas8777;
    if (typeof outraPorta8777 !== 'undefined') _0x43130f['outraPorta8777'] = outraPorta8777;
    if (typeof retry !== 'undefined') _0x43130f['retry'] = retry;
    if (typeof portasNormais !== 'undefined') _0x43130f['portasNormais'] = portasNormais;
    if (typeof novaPorta !== 'undefined') _0x43130f['novaPorta'] = novaPorta;
    if (typeof retry !== 'undefined') _0x43130f['retry'] = retry;
    if (typeof tiposExclusivos8777 !== 'undefined') _0x43130f['tiposExclusivos8777'] = tiposExclusivos8777;
    if (typeof isTipoExclusivo8777 !== 'undefined') _0x43130f['isTipoExclusivo8777'] = isTipoExclusivo8777;
    if (typeof retry !== 'undefined') _0x43130f['retry'] = retry;
    if (typeof itemFila !== 'undefined') _0x43130f['itemFila'] = itemFila;
    if (typeof isAbortError !== 'undefined') _0x43130f['isAbortError'] = isAbortError;
    if (typeof isFalhaNosDoisSimsFlag !== 'undefined') _0x43130f['isFalhaNosDoisSimsFlag'] = isFalhaNosDoisSimsFlag;
    if (typeof isFalhaNosDoisSimsFlag !== 'undefined') _0x43130f['isFalhaNosDoisSimsFlag'] = isFalhaNosDoisSimsFlag;
    if (typeof tiposExclusivos8777 !== 'undefined') _0x43130f['tiposExclusivos8777'] = tiposExclusivos8777;
    if (typeof isTipoExclusivo8777 !== 'undefined') _0x43130f['isTipoExclusivo8777'] = isTipoExclusivo8777;
    if (typeof retry !== 'undefined') _0x43130f['retry'] = retry;
    if (typeof itemFila !== 'undefined') _0x43130f['itemFila'] = itemFila;
    if (typeof erroConexao !== 'undefined') _0x43130f['erroConexao'] = erroConexao;
    if (typeof tiposExclusivos8777 !== 'undefined') _0x43130f['tiposExclusivos8777'] = tiposExclusivos8777;
    if (typeof isTipoExclusivo8777 !== 'undefined') _0x43130f['isTipoExclusivo8777'] = isTipoExclusivo8777;
    if (typeof retry !== 'undefined') _0x43130f['retry'] = retry;
    if (typeof itemFila !== 'undefined') _0x43130f['itemFila'] = itemFila;
    if (typeof timestamp !== 'undefined') _0x43130f['timestamp'] = timestamp;
    if (typeof randomSuffix !== 'undefined') _0x43130f['randomSuffix'] = randomSuffix;
    if (typeof chaveUnica !== 'undefined') _0x43130f['chaveUnica'] = chaveUnica;
    if (typeof blocoIndex !== 'undefined') _0x43130f['blocoIndex'] = blocoIndex;
    if (typeof totalBlocos !== 'undefined') _0x43130f['totalBlocos'] = totalBlocos;
    if (typeof match !== 'undefined') _0x43130f['match'] = match;
    if (typeof tipoDisplay !== 'undefined') _0x43130f['tipoDisplay'] = tipoDisplay;
    if (typeof enviado !== 'undefined') _0x43130f['enviado'] = enviado;
    if (typeof portasDisponiveis !== 'undefined') _0x43130f['portasDisponiveis'] = portasDisponiveis;
    if (typeof itensNaFila !== 'undefined') _0x43130f['itensNaFila'] = itensNaFila;
    if (typeof portasOcupadas !== 'undefined') _0x43130f['portasOcupadas'] = portasOcupadas;
    if (typeof itensParaProcessar !== 'undefined') _0x43130f['itensParaProcessar'] = itensParaProcessar;
    if (typeof portasParaUsar !== 'undefined') _0x43130f['portasParaUsar'] = portasParaUsar;
    if (typeof maxItensProcessar !== 'undefined') _0x43130f['maxItensProcessar'] = maxItensProcessar;
    if (typeof item !== 'undefined') _0x43130f['item'] = item;
    if (typeof portasNormaisDisponiveis !== 'undefined') _0x43130f['portasNormaisDisponiveis'] = portasNormaisDisponiveis;
    if (typeof portaIndex !== 'undefined') _0x43130f['portaIndex'] = portaIndex;
    if (typeof tipoDisplay !== 'undefined') _0x43130f['tipoDisplay'] = tipoDisplay;
    if (typeof promises !== 'undefined') _0x43130f['promises'] = promises;
    if (typeof porta !== 'undefined') _0x43130f['porta'] = porta;
    if (typeof prioridadeBase !== 'undefined') _0x43130f['prioridadeBase'] = prioridadeBase;
    if (typeof megasPrioridade !== 'undefined') _0x43130f['megasPrioridade'] = megasPrioridade;
    if (typeof timestamp !== 'undefined') _0x43130f['timestamp'] = timestamp;
    if (typeof randomSuffix !== 'undefined') _0x43130f['randomSuffix'] = randomSuffix;
    if (typeof chaveUnica !== 'undefined') _0x43130f['chaveUnica'] = chaveUnica;
    if (typeof tentativasAtuais !== 'undefined') _0x43130f['tentativasAtuais'] = tentativasAtuais;
    if (typeof itemCompleto !== 'undefined') _0x43130f['itemCompleto'] = itemCompleto;
    if (typeof tipoDisplay !== 'undefined') _0x43130f['tipoDisplay'] = tipoDisplay;
    if (typeof portasOnline !== 'undefined') _0x43130f['portasOnline'] = portasOnline;
    if (typeof portasLivres !== 'undefined') _0x43130f['portasLivres'] = portasLivres;
    if (typeof portasOcupadas !== 'undefined') _0x43130f['portasOcupadas'] = portasOcupadas;
    if (typeof statusPortas !== 'undefined') _0x43130f['statusPortas'] = statusPortas;
    if (typeof tiposNaFila !== 'undefined') _0x43130f['tiposNaFila'] = tiposNaFila;
    if (typeof _0x42026f !== 'undefined') _0x43130f['intervalId'] = _0x42026f;
    if (typeof _0x2d9387 !== 'undefined') _0x43130f['verificacaoIniciada'] = _0x2d9387;
    if (typeof reconectadas !== 'undefined') _0x43130f['reconectadas'] = reconectadas;
    if (typeof totalPortas !== 'undefined') _0x43130f['totalPortas'] = totalPortas;
    if (typeof estadoAnterior !== 'undefined') _0x43130f['estadoAnterior'] = estadoAnterior;
    if (typeof controller !== 'undefined') _0x43130f['controller'] = controller;
    if (typeof timeoutId !== 'undefined') _0x43130f['timeoutId'] = timeoutId;
    if (typeof response !== 'undefined') _0x43130f['response'] = response;
    if (typeof result !== 'undefined') _0x43130f['result'] = result;
    if (typeof saudavel !== 'undefined') _0x43130f['saudavel'] = saudavel;
    if (typeof response !== 'undefined') _0x43130f['response'] = response;
    if (typeof result !== 'undefined') _0x43130f['result'] = result;
    if (typeof _0x5b387d !== 'undefined') _0x43130f['MENU_24HRS_PADRAO'] = _0x5b387d;
    if (typeof _0xb65a79 !== 'undefined') _0x43130f['PACOTES_COMUNS'] = _0xb65a79;
    if (typeof menuCompleto !== 'undefined') _0x43130f['menuCompleto'] = menuCompleto;
    if (typeof sendFunc !== 'undefined') _0x43130f['sendFunc'] = sendFunc;
    if (typeof _0x10228a !== 'undefined') _0x43130f['pendingTodos'] = _0x10228a;
    if (typeof logMessage !== 'undefined') _0x43130f['logMessage'] = logMessage;
    if (typeof regex !== 'undefined') _0x43130f['regex'] = regex;
    if (typeof m !== 'undefined') _0x43130f['m'] = m;
    if (typeof lower !== 'undefined') _0x43130f['lower'] = lower;
    if (typeof padroesComprovativo !== 'undefined') _0x43130f['padroesComprovativo'] = padroesComprovativo;
    if (typeof ehComprovativo !== 'undefined') _0x43130f['ehComprovativo'] = ehComprovativo;
    if (typeof marcadores !== 'undefined') _0x43130f['marcadores'] = marcadores;
    if (typeof indiceCorte !== 'undefined') _0x43130f['indiceCorte'] = indiceCorte;
    if (typeof idx !== 'undefined') _0x43130f['idx'] = idx;
    if (typeof textoAnalise !== 'undefined') _0x43130f['textoAnalise'] = textoAnalise;
    if (typeof linhas !== 'undefined') _0x43130f['linhas'] = linhas;
    if (typeof ultima !== 'undefined') _0x43130f['ultima'] = ultima;
    if (typeof numeroRegex !== 'undefined') _0x43130f['numeroRegex'] = numeroRegex;
    if (typeof matches !== 'undefined') _0x43130f['matches'] = matches;
    if (typeof regex !== 'undefined') _0x43130f['regex'] = regex;
    if (typeof refMatch !== 'undefined') _0x43130f['refMatch'] = refMatch;
    if (typeof numero !== 'undefined') _0x43130f['numero'] = numero;
    if (typeof padraoMocambicano1 !== 'undefined') _0x43130f['padraoMocambicano1'] = padraoMocambicano1;
    if (typeof match1 !== 'undefined') _0x43130f['match1'] = match1;
    if (typeof padraoTransferiste !== 'undefined') _0x43130f['padraoTransferiste'] = padraoTransferiste;
    if (typeof match2 !== 'undefined') _0x43130f['match2'] = match2;
    if (typeof padraoRecebeste !== 'undefined') _0x43130f['padraoRecebeste'] = padraoRecebeste;
    if (typeof match3 !== 'undefined') _0x43130f['match3'] = match3;
    if (typeof padraoEuropeu !== 'undefined') _0x43130f['padraoEuropeu'] = padraoEuropeu;
    if (typeof match4 !== 'undefined') _0x43130f['match4'] = match4;
    if (typeof padraoSimples !== 'undefined') _0x43130f['padraoSimples'] = padraoSimples;
    if (typeof match5 !== 'undefined') _0x43130f['match5'] = match5;
    if (typeof valorStr !== 'undefined') _0x43130f['valorStr'] = valorStr;
    if (typeof temPonto !== 'undefined') _0x43130f['temPonto'] = temPonto;
    if (typeof temVirgula !== 'undefined') _0x43130f['temVirgula'] = temVirgula;
    if (typeof posVirgula !== 'undefined') _0x43130f['posVirgula'] = posVirgula;
    if (typeof posPonto !== 'undefined') _0x43130f['posPonto'] = posPonto;
    if (typeof partes !== 'undefined') _0x43130f['partes'] = partes;
    if (typeof partes !== 'undefined') _0x43130f['partes'] = partes;
    if (typeof valor !== 'undefined') _0x43130f['valor'] = valor;
    if (typeof m !== 'undefined') _0x43130f['m'] = m;
    if (typeof urlPattern !== 'undefined') _0x43130f['urlPattern'] = urlPattern;
    if (typeof mbConversion !== 'undefined') _0x43130f['mbConversion'] = mbConversion;
    if (typeof divisoes !== 'undefined') _0x43130f['divisoes'] = divisoes;
    if (typeof totalMB !== 'undefined') _0x43130f['totalMB'] = totalMB;
    if (typeof tamanhoDivisao !== 'undefined') _0x43130f['tamanhoDivisao'] = tamanhoDivisao;
    if (typeof partes !== 'undefined') _0x43130f['partes'] = partes;
    if (typeof resto !== 'undefined') _0x43130f['resto'] = resto;
    if (typeof mbConversion !== 'undefined') _0x43130f['mbConversion'] = mbConversion;
    if (typeof linhas !== 'undefined') _0x43130f['linhas'] = linhas;
    if (typeof numerosComQuantidade !== 'undefined') _0x43130f['numerosComQuantidade'] = numerosComQuantidade;
    if (typeof numerosSemQuantidade !== 'undefined') _0x43130f['numerosSemQuantidade'] = numerosSemQuantidade;
    if (typeof formatoNormal !== 'undefined') _0x43130f['formatoNormal'] = formatoNormal;
    if (typeof formatoInvertido !== 'undefined') _0x43130f['formatoInvertido'] = formatoInvertido;
    if (typeof numero !== 'undefined') _0x43130f['numero'] = numero;
    if (typeof qtdGB !== 'undefined') _0x43130f['qtdGB'] = qtdGB;
    if (typeof totalGBPago !== 'undefined') _0x43130f['totalGBPago'] = totalGBPago;
    if (typeof todosBlocos !== 'undefined') _0x43130f['todosBlocos'] = todosBlocos;
    if (typeof qtdRestante !== 'undefined') _0x43130f['qtdRestante'] = qtdRestante;
    if (typeof tamanhoBlocoGB !== 'undefined') _0x43130f['tamanhoBlocoGB'] = tamanhoBlocoGB;
    if (typeof gbUsados !== 'undefined') _0x43130f['gbUsados'] = gbUsados;
    if (typeof gbRestante !== 'undefined') _0x43130f['gbRestante'] = gbRestante;
    if (typeof blocosDe10GB !== 'undefined') _0x43130f['blocosDe10GB'] = blocosDe10GB;
    if (typeof sobraGB !== 'undefined') _0x43130f['sobraGB'] = sobraGB;
    if (typeof numeroIndex !== 'undefined') _0x43130f['numeroIndex'] = numeroIndex;
    if (typeof numero !== 'undefined') _0x43130f['numero'] = numero;
    if (typeof totalBlocosGB !== 'undefined') _0x43130f['totalBlocosGB'] = totalBlocosGB;
    if (typeof excessoGB !== 'undefined') _0x43130f['excessoGB'] = excessoGB;
    if (typeof blocosParaRemover !== 'undefined') _0x43130f['blocosParaRemover'] = blocosParaRemover;
    if (typeof ordem !== 'undefined') _0x43130f['ordem'] = ordem;
    if (typeof blocoRemovido !== 'undefined') _0x43130f['blocoRemovido'] = blocoRemovido;
    if (typeof divisoes !== 'undefined') _0x43130f['divisoes'] = divisoes;
    if (typeof registro !== 'undefined') _0x43130f['registro'] = registro;
    if (typeof reg !== 'undefined') _0x43130f['reg'] = reg;
    if (typeof registro !== 'undefined') _0x43130f['registro'] = registro;
    if (typeof reg !== 'undefined') _0x43130f['reg'] = reg;
    if (typeof valorInt !== 'undefined') _0x43130f['valorInt'] = valorInt;
    if (typeof tipoPacote !== 'undefined') _0x43130f['tipoPacote'] = tipoPacote;
    if (typeof pacoteInfo !== 'undefined') _0x43130f['pacoteInfo'] = pacoteInfo;
    if (typeof quantidadeMB !== 'undefined') _0x43130f['quantidadeMB'] = quantidadeMB;
    if (typeof mensagemProcessando !== 'undefined') _0x43130f['mensagemProcessando'] = mensagemProcessando;
    if (typeof blocos !== 'undefined') _0x43130f['blocos'] = blocos;
    if (typeof bloco !== 'undefined') _0x43130f['bloco'] = bloco;
    if (typeof blocoId !== 'undefined') _0x43130f['blocoId'] = blocoId;
    if (typeof mensagemNumeroConfirmado !== 'undefined') _0x43130f['mensagemNumeroConfirmado'] = mensagemNumeroConfirmado;
    if (typeof chaveBloqueio !== 'undefined') _0x43130f['chaveBloqueio'] = chaveBloqueio;
    if (typeof valorInt !== 'undefined') _0x43130f['valorInt'] = valorInt;
    if (typeof pacote !== 'undefined') _0x43130f['pacote'] = pacote;
    if (typeof pacote !== 'undefined') _0x43130f['pacote'] = pacote;
    if (typeof registro !== 'undefined') _0x43130f['registro'] = registro;
    if (typeof reg !== 'undefined') _0x43130f['reg'] = reg;
    if (typeof tipoFinal !== 'undefined') _0x43130f['tipoFinal'] = tipoFinal;
    if (typeof divisoes !== 'undefined') _0x43130f['divisoes'] = divisoes;
    if (typeof mensagemAguardando !== 'undefined') _0x43130f['mensagemAguardando'] = mensagemAguardando;
    if (typeof valorInt !== 'undefined') _0x43130f['valorInt'] = valorInt;
    if (typeof pacote !== 'undefined') _0x43130f['pacote'] = pacote;
    if (typeof pacote !== 'undefined') _0x43130f['pacote'] = pacote;
    if (typeof extrasInfo !== 'undefined') _0x43130f['extrasInfo'] = extrasInfo;
    if (typeof pacote !== 'undefined') _0x43130f['pacote'] = pacote;
    if (typeof pacote !== 'undefined') _0x43130f['pacote'] = pacote;
    if (typeof pacote !== 'undefined') _0x43130f['pacote'] = pacote;
    if (typeof pacote !== 'undefined') _0x43130f['pacote'] = pacote;
    if (typeof valorInt !== 'undefined') _0x43130f['valorInt'] = valorInt;
    if (typeof pacote !== 'undefined') _0x43130f['pacote'] = pacote;
    if (typeof divisaoTexto !== 'undefined') _0x43130f['divisaoTexto'] = divisaoTexto;
    if (typeof pacote !== 'undefined') _0x43130f['pacote'] = pacote;
    if (typeof extrasInfo !== 'undefined') _0x43130f['extrasInfo'] = extrasInfo;
    if (typeof divisaoTexto !== 'undefined') _0x43130f['divisaoTexto'] = divisaoTexto;
    if (typeof pacote !== 'undefined') _0x43130f['pacote'] = pacote;
    if (typeof divisaoTexto !== 'undefined') _0x43130f['divisaoTexto'] = divisaoTexto;
    if (typeof pacote !== 'undefined') _0x43130f['pacote'] = pacote;
    if (typeof divisaoTexto !== 'undefined') _0x43130f['divisaoTexto'] = divisaoTexto;
    if (typeof pacote !== 'undefined') _0x43130f['pacote'] = pacote;
    if (typeof divisaoTexto !== 'undefined') _0x43130f['divisaoTexto'] = divisaoTexto;
    if (typeof pacote !== 'undefined') _0x43130f['pacote'] = pacote;
    if (typeof divisaoTexto !== 'undefined') _0x43130f['divisaoTexto'] = divisaoTexto;
    if (typeof qtdFormatada !== 'undefined') _0x43130f['qtdFormatada'] = qtdFormatada;
    if (typeof divisaoTexto !== 'undefined') _0x43130f['divisaoTexto'] = divisaoTexto;
    if (typeof qtdFormatada !== 'undefined') _0x43130f['qtdFormatada'] = qtdFormatada;
    if (typeof valorInt !== 'undefined') _0x43130f['valorInt'] = valorInt;
    if (typeof pacote !== 'undefined') _0x43130f['pacote'] = pacote;
    if (typeof pacote !== 'undefined') _0x43130f['pacote'] = pacote;
    if (typeof pacote !== 'undefined') _0x43130f['pacote'] = pacote;
    if (typeof pacote !== 'undefined') _0x43130f['pacote'] = pacote;
    if (typeof quantidadeMB !== 'undefined') _0x43130f['quantidadeMB'] = quantidadeMB;
    if (typeof blocos !== 'undefined') _0x43130f['blocos'] = blocos;
    if (typeof bloco !== 'undefined') _0x43130f['bloco'] = bloco;
    if (typeof blocoId !== 'undefined') _0x43130f['blocoId'] = blocoId;
    if (typeof pacote !== 'undefined') _0x43130f['pacote'] = pacote;
    if (typeof pacote !== 'undefined') _0x43130f['pacote'] = pacote;
    if (typeof registroQtd !== 'undefined') _0x43130f['registroQtd'] = registroQtd;
    if (typeof regQtd !== 'undefined') _0x43130f['regQtd'] = regQtd;
    if (typeof blocos !== 'undefined') _0x43130f['blocos'] = blocos;
    if (typeof bloco !== 'undefined') _0x43130f['bloco'] = bloco;
    if (typeof blocoId !== 'undefined') _0x43130f['blocoId'] = blocoId;
    if (typeof registro !== 'undefined') _0x43130f['registro'] = registro;
    if (typeof quantidade !== 'undefined') _0x43130f['quantidade'] = quantidade;
    if (typeof valorRegistro !== 'undefined') _0x43130f['valorRegistro'] = valorRegistro;
    if (typeof valorInt !== 'undefined') _0x43130f['valorInt'] = valorInt;
    if (typeof pacoteGrupo !== 'undefined') _0x43130f['pacoteGrupo'] = pacoteGrupo;
    if (typeof quantidadeMB !== 'undefined') _0x43130f['quantidadeMB'] = quantidadeMB;
    if (typeof tiposValidos !== 'undefined') _0x43130f['tiposValidos'] = tiposValidos;
    if (typeof portaObrigatoria !== 'undefined') _0x43130f['portaObrigatoria'] = portaObrigatoria;
    if (typeof quantidadeAtivacao !== 'undefined') _0x43130f['quantidadeAtivacao'] = quantidadeAtivacao;
    if (typeof tipoDisplay !== 'undefined') _0x43130f['tipoDisplay'] = tipoDisplay;
    if (typeof sucessoAtivacao !== 'undefined') _0x43130f['sucessoAtivacao'] = sucessoAtivacao;
    if (typeof blocosExtras !== 'undefined') _0x43130f['blocosExtras'] = blocosExtras;
    if (typeof bloco !== 'undefined') _0x43130f['bloco'] = bloco;
    if (typeof blocoId !== 'undefined') _0x43130f['blocoId'] = blocoId;
    if (typeof TOTAL_PACOTE !== 'undefined') _0x43130f['TOTAL_PACOTE'] = TOTAL_PACOTE;
    if (typeof MB_POR_INPUT_VAL !== 'undefined') _0x43130f['MB_POR_INPUT_VAL'] = MB_POR_INPUT_VAL;
    if (typeof portaObrigatoria !== 'undefined') _0x43130f['portaObrigatoria'] = portaObrigatoria;
    if (typeof sucessoAtivacao !== 'undefined') _0x43130f['sucessoAtivacao'] = sucessoAtivacao;
    if (typeof quantidadeRestante !== 'undefined') _0x43130f['quantidadeRestante'] = quantidadeRestante;
    if (typeof blocosRestante !== 'undefined') _0x43130f['blocosRestante'] = blocosRestante;
    if (typeof bloco !== 'undefined') _0x43130f['bloco'] = bloco;
    if (typeof blocoId !== 'undefined') _0x43130f['blocoId'] = blocoId;
    if (typeof portasLivres !== 'undefined') _0x43130f['portasLivres'] = portasLivres;
    if (typeof portaEscolhida !== 'undefined') _0x43130f['portaEscolhida'] = portaEscolhida;
    if (typeof portaObrigatoria !== 'undefined') _0x43130f['portaObrigatoria'] = portaObrigatoria;
    if (typeof sucessoAtivacao !== 'undefined') _0x43130f['sucessoAtivacao'] = sucessoAtivacao;
    if (typeof dataHora !== 'undefined') _0x43130f['dataHora'] = dataHora;
    if (typeof mensagem !== 'undefined') _0x43130f['mensagem'] = mensagem;
    if (typeof valorInt !== 'undefined') _0x43130f['valorInt'] = valorInt;
    if (typeof pacote !== 'undefined') _0x43130f['pacote'] = pacote;
    if (typeof pacote !== 'undefined') _0x43130f['pacote'] = pacote;
    if (typeof pacote !== 'undefined') _0x43130f['pacote'] = pacote;
    if (typeof quantidadeFormatada !== 'undefined') _0x43130f['quantidadeFormatada'] = quantidadeFormatada;
    if (typeof existente !== 'undefined') _0x43130f['existente'] = existente;
    if (typeof reg !== 'undefined') _0x43130f['reg'] = reg;
    if (typeof lockKey !== 'undefined') _0x43130f['lockKey'] = lockKey;
    if (typeof infoPacote !== 'undefined') _0x43130f['infoPacote'] = infoPacote;
    if (typeof quantidadeCalculada !== 'undefined') _0x43130f['quantidadeCalculada'] = quantidadeCalculada;
    if (typeof tipoCalculado !== 'undefined') _0x43130f['tipoCalculado'] = tipoCalculado;
    if (typeof registroExistente !== 'undefined') _0x43130f['registroExistente'] = registroExistente;
    if (typeof refComprovativo !== 'undefined') _0x43130f['refComprovativo'] = refComprovativo;
    if (typeof refSMS !== 'undefined') _0x43130f['refSMS'] = refSMS;
    if (typeof valorComprovativo !== 'undefined') _0x43130f['valorComprovativo'] = valorComprovativo;
    if (typeof valorSMS !== 'undefined') _0x43130f['valorSMS'] = valorSMS;
    if (typeof divisoes !== 'undefined') _0x43130f['divisoes'] = divisoes;
    if (typeof mensagemAjuste !== 'undefined') _0x43130f['mensagemAjuste'] = mensagemAjuste;
    if (typeof numero !== 'undefined') _0x43130f['numero'] = numero;
    if (typeof blocos !== 'undefined') _0x43130f['blocos'] = blocos;
    if (typeof numero !== 'undefined') _0x43130f['numero'] = numero;
    if (typeof totalMB !== 'undefined') _0x43130f['totalMB'] = totalMB;
    if (typeof blocos !== 'undefined') _0x43130f['blocos'] = blocos;
    if (typeof divisaoTexto !== 'undefined') _0x43130f['divisaoTexto'] = divisaoTexto;
    if (typeof status !== 'undefined') _0x43130f['status'] = status;
    if (typeof smsHash !== 'undefined') _0x43130f['smsHash'] = smsHash;
    if (typeof agora !== 'undefined') _0x43130f['agora'] = agora;
    if (typeof ultimoProcessamento !== 'undefined') _0x43130f['ultimoProcessamento'] = ultimoProcessamento;
    if (typeof ref !== 'undefined') _0x43130f['ref'] = ref;
    if (typeof valor !== 'undefined') _0x43130f['valor'] = valor;
    if (typeof confirmacao !== 'undefined') _0x43130f['confirmacao'] = confirmacao;
    if (typeof isSucesso !== 'undefined') _0x43130f['isSucesso'] = isSucesso;
    if (typeof m !== 'undefined') _0x43130f['m'] = m;
    if (typeof numero !== 'undefined') _0x43130f['numero'] = numero;
    if (typeof quantidadeMatch !== 'undefined') _0x43130f['quantidadeMatch'] = quantidadeMatch;
    if (typeof quantidade !== 'undefined') _0x43130f['quantidade'] = quantidade;
    if (typeof lockKey !== 'undefined') _0x43130f['lockKey'] = lockKey;
    if (typeof agora !== 'undefined') _0x43130f['agora'] = agora;
    if (typeof resultado !== 'undefined') _0x43130f['resultado'] = resultado;
    if (typeof reg !== 'undefined') _0x43130f['reg'] = reg;
    if (typeof statusAtual !== 'undefined') _0x43130f['statusAtual'] = statusAtual;
    if (typeof estadosPermitidos !== 'undefined') _0x43130f['estadosPermitidos'] = estadosPermitidos;
    if (typeof refComprovativo !== 'undefined') _0x43130f['refComprovativo'] = refComprovativo;
    if (typeof valorComprovativo !== 'undefined') _0x43130f['valorComprovativo'] = valorComprovativo;
    if (typeof tipoDisplay !== 'undefined') _0x43130f['tipoDisplay'] = tipoDisplay;
    if (typeof infoExtras !== 'undefined') _0x43130f['infoExtras'] = infoExtras;
    if (typeof registroAtualizado !== 'undefined') _0x43130f['registroAtualizado'] = registroAtualizado;
    if (typeof regAtual !== 'undefined') _0x43130f['regAtual'] = regAtual;
    if (typeof tipoDisplay !== 'undefined') _0x43130f['tipoDisplay'] = tipoDisplay;
    if (typeof infoExtras !== 'undefined') _0x43130f['infoExtras'] = infoExtras;
    if (typeof reg !== 'undefined') _0x43130f['reg'] = reg;
    if (typeof reg !== 'undefined') _0x43130f['reg'] = reg;
    if (typeof reg !== 'undefined') _0x43130f['reg'] = reg;
    if (typeof reg !== 'undefined') _0x43130f['reg'] = reg;
    if (typeof smsRef !== 'undefined') _0x43130f['smsRef'] = smsRef;
    if (typeof smsValor !== 'undefined') _0x43130f['smsValor'] = smsValor;
    if (typeof compRef !== 'undefined') _0x43130f['compRef'] = compRef;
    if (typeof compValor !== 'undefined') _0x43130f['compValor'] = compValor;
    if (typeof oneWeekAgo !== 'undefined') _0x43130f['oneWeekAgo'] = oneWeekAgo;
    if (typeof blocos !== 'undefined') _0x43130f['blocos'] = blocos;
    if (typeof LIMITE_MB !== 'undefined') _0x43130f['LIMITE_MB'] = LIMITE_MB;
    if (typeof MINIMO_MB !== 'undefined') _0x43130f['MINIMO_MB'] = MINIMO_MB;
    if (typeof restante !== 'undefined') _0x43130f['restante'] = restante;
    if (typeof enviar !== 'undefined') _0x43130f['enviar'] = enviar;
    if (typeof activeProcessingKey !== 'undefined') _0x43130f['activeProcessingKey'] = activeProcessingKey;
    if (typeof blocos !== 'undefined') _0x43130f['blocos'] = blocos;
    if (typeof itensAdicionados !== 'undefined') _0x43130f['itensAdicionados'] = itensAdicionados;
    if (typeof bloco !== 'undefined') _0x43130f['bloco'] = bloco;
    if (typeof timestamp !== 'undefined') _0x43130f['timestamp'] = timestamp;
    if (typeof randomSuffix !== 'undefined') _0x43130f['randomSuffix'] = randomSuffix;
    if (typeof chaveUnica !== 'undefined') _0x43130f['chaveUnica'] = chaveUnica;
    if (typeof blocoId !== 'undefined') _0x43130f['blocoId'] = blocoId;
    if (typeof itemIndividual !== 'undefined') _0x43130f['itemIndividual'] = itemIndividual;
    if (typeof arrayChaves !== 'undefined') _0x43130f['arrayChaves'] = arrayChaves;
    if (typeof chavesRecentes !== 'undefined') _0x43130f['chavesRecentes'] = chavesRecentes;
    if (typeof jid !== 'undefined') _0x43130f['jid'] = jid;
    if (typeof remetente !== 'undefined') _0x43130f['remetente'] = remetente;
    if (typeof texto !== 'undefined') _0x43130f['texto'] = texto;
    if (typeof sender !== 'undefined') _0x43130f['sender'] = sender;
    if (typeof lowerTexto !== 'undefined') _0x43130f['lowerTexto'] = lowerTexto;
    if (typeof groupAdmins !== 'undefined') _0x43130f['groupAdmins'] = groupAdmins;
    if (typeof isAdmin !== 'undefined') _0x43130f['isAdmin'] = isAdmin;
    if (typeof target !== 'undefined') _0x43130f['target'] = target;
    if (typeof botId !== 'undefined') _0x43130f['botId'] = botId;
    if (typeof botId !== 'undefined') _0x43130f['botId'] = botId;
    if (typeof groupMembers !== 'undefined') _0x43130f['groupMembers'] = groupMembers;
    if (typeof mentions !== 'undefined') _0x43130f['mentions'] = mentions;
    if (typeof message !== 'undefined') _0x43130f['message'] = message;
    if (typeof ref !== 'undefined') _0x43130f['ref'] = ref;
    if (typeof numero !== 'undefined') _0x43130f['numero'] = numero;
    if (typeof partes !== 'undefined') _0x43130f['partes'] = partes;
    if (typeof quotedBody !== 'undefined') _0x43130f['quotedBody'] = quotedBody;
    if (typeof numeroMatch !== 'undefined') _0x43130f['numeroMatch'] = numeroMatch;
    if (typeof registroPorNumero !== 'undefined') _0x43130f['registroPorNumero'] = registroPorNumero;
    if (typeof registro !== 'undefined') _0x43130f['registro'] = registro;
    if (typeof reg !== 'undefined') _0x43130f['reg'] = reg;
    if (typeof estadosPermitidos !== 'undefined') _0x43130f['estadosPermitidos'] = estadosPermitidos;
    if (typeof eliminada !== 'undefined') _0x43130f['eliminada'] = eliminada;
    if (typeof adb !== 'undefined') _0x43130f['adb'] = adb;
    if (typeof lastTimestamp !== 'undefined') _0x43130f['lastTimestamp'] = lastTimestamp;
    if (typeof processedSmsIds !== 'undefined') _0x43130f['processedSmsIds'] = processedSmsIds;
    if (typeof adbInitialized !== 'undefined') _0x43130f['adbInitialized'] = adbInitialized;
    if (typeof devices !== 'undefined') _0x43130f['devices'] = devices;
    if (typeof TELEFONE_ALVO !== 'undefined') _0x43130f['TELEFONE_ALVO'] = TELEFONE_ALVO;
    if (typeof device !== 'undefined') _0x43130f['device'] = device;
    if (typeof overlapMs !== 'undefined') _0x43130f['overlapMs'] = overlapMs;
    if (typeof safetyWindow !== 'undefined') _0x43130f['safetyWindow'] = safetyWindow;
    if (typeof queryTimestamp !== 'undefined') _0x43130f['queryTimestamp'] = queryTimestamp;
    if (typeof query !== 'undefined') _0x43130f['query'] = query;
    // --- SISTEMA DE AGENDAMENTO DE MENSAGENS (GRUPOS) ---
    async function _broadcastGrupos(_client, _mensagem) {
        try {
            const _grupos = await _client.getAllGroups();
            if (!_grupos || _grupos.length === 0) return;
            _0x1ca1fd('📢 Iniciando broadcast para ' + _grupos.length + ' grupos', 'info');
            for (const _g of _grupos) {
                try {
                    if (_g.id.includes('@g.us')) {
                        await _0x461461(_client, _g.id, _mensagem, null);
                        await new Promise(r => setTimeout(r, 2500)); // Delay para evitar spam/ban
                    }
                } catch(e) {}
            }
        } catch(e) {
            _0x1ca1fd('❌ Erro ao listar grupos: ' + e.message, 'error');
        }
    }

    async function _iniciarAgendadorMensagens(_client) {
        try {
            await _0x2c5e52('CREATE TABLE IF NOT EXISTS bot_tasks (task_name TEXT PRIMARY KEY, last_run DATETIME)');
            await _0x2c5e52('CREATE TABLE IF NOT EXISTS assinaturas_planos (id INTEGER PRIMARY KEY AUTOINCREMENT, jid TEXT, numero TEXT, tipo TEXT, total_mb INTEGER, entregue_mb INTEGER, valor_entrega_diaria INTEGER, data_ultima_entrega DATETIME, data_proxima_entrega DATETIME, referencia_original TEXT, status TEXT)');
            _0x1ca1fd('⏰ Agendador de mensagens e planos ativado', 'info');
            
            setInterval(async () => {
                try {
                    const agora = new Date();
                    const hora = agora.getHours();
                    const minuto = agora.getMinutes();
                    const hoje_str = agora.toISOString().split('T')[0];
                    
                    // 1. Mensagem Diária (6h e 17h) - DESACTIVADO A PEDIDO DO UTILIZADOR
                    /*
                    if (minuto === 0 && (hora === 6 || hora === 17)) {
                        const taskName = `daily_msg_${hora}h_${hoje_str}`;
                        const check = await _0x3c2652('SELECT * FROM bot_tasks WHERE task_name=?', [taskName]);
                        if (!check || check.length === 0) {
                            const msgDaily = "📢 *INFORMAÇÃO KA-NET* 📢\n━━━━━━━━━━━━━━━━━━\n🤖 Olá! Estamos aqui para facilitar a sua compra de internet Vodacom e Movitel.\n\n📝 *Comandos no Privado:*\n👉 *Menu* - Ver tabela de preços.\n👉 *Pagamento* - Dados de M-Pesa/E-Mola.\n👉 *Status* - Ver sua referência.\n👉 *Convite* - Ganhar bónus.\n\n⚡ Tudo automático e instantâneo!";
                            await _0x2c5e52('INSERT INTO bot_tasks (task_name, last_run) VALUES (?, ?)', [taskName, agora.toISOString()]);
                            await _broadcastGrupos(_client, msgDaily);
                        }
                    }
                    */
                    
                    // 2. Mensagem Bónus (Cada 3 dias) - DESACTIVADO A PEDIDO DO UTILIZADOR
                    /*
                    if (minuto === 0 && hora === 10) { // Executa às 10h da manhã
                        const taskBonus = 'periodic_bonus_3d';
                        const checkBonus = await _0x3c2652('SELECT last_run FROM bot_tasks WHERE task_name=?', [taskBonus]);
                        let runBonus = false;
                        if (!checkBonus || checkBonus.length === 0) {
                            runBonus = true;
                        } else {
                            const lastRun = new Date(checkBonus[0].last_run);
                            const diffDays = (agora - lastRun) / (1000 * 60 * 60 * 24);
                            if (diffDays >= 3) runBonus = true;
                        }
                        
                        if (runBonus) {
                            const msgBonus = "🧧 *SISTEMA DE BÓNUS KA-NET* 🧧\n━━━━━━━━━━━━━━━━━━\n🎁 Sabia que pode ganhar internet grátis convidando amigos?\n\n💰 Você ganha *200MB* por cada compra que o seu amigo fizer!\n\n🚀 Digite **!convite** no meu privado para obter o seu código agora e comece a ganhar!";
                            await _0x2c5e52('INSERT OR REPLACE INTO bot_tasks (task_name, last_run) VALUES (?, ?)', [taskBonus, agora.toISOString()]);
                            await _broadcastGrupos(_client, msgBonus);
                        }
                    }
                    */

                    // 3. Limpeza de Curiosos (15 dias sem compra) - Roda às 3h da manhã
                    if (hora === 3 && minuto === 0) {
                        const taskClean = `cleanup_curiosos_${hoje_str}`;
                        const checkClean = await _0x3c2652('SELECT * FROM bot_tasks WHERE task_name=?', [taskClean]);
                        if (!checkClean || checkClean.length === 0) {
                            await _0x2c5e52('INSERT INTO bot_tasks (task_name, last_run) VALUES (?, ?)', [taskClean, agora.toISOString()]);
                            await _executarLimpezaCuriosos(_client);
                        }
                    }

                    // 4. Processador de Planos (Renovação e Faseado)
                    await _processarEntregasPlanos(_client);

                    // 5. Mensagens de Reativação Automática (48h e 7 dias) - Executa às 10:30 da manhã
                    if (hora === 10 && minuto === 30) {
                        const taskReativacao = `reactivate_check_${hoje_str}`;
                        const checkReativacao = await _0x3c2652('SELECT * FROM bot_tasks WHERE task_name=?', [taskReativacao]);
                        if (!checkReativacao || checkReativacao.length === 0) {
                            await _0x2c5e52('INSERT INTO bot_tasks (task_name, last_run) VALUES (?, ?)', [taskReativacao, agora.toISOString()]);
                            await _executarNotificacoesReativacao(_client);
                        }
                    }

                } catch (e) {
                    _0x1ca1fd('❌ Erro no agendador de mensagens: ' + e.message, 'error');
                }
            }, 60000); 
        } catch (e) {
            _0x1ca1fd('❌ Falha ao iniciar agendador: ' + e.message, 'error');
        }
    }

    if (typeof shell !== 'undefined') _0x43130f['shell'] = shell;
    if (typeof output !== 'undefined') _0x43130f['output'] = output;
    if (typeof data !== 'undefined') _0x43130f['data'] = data;
    if (typeof smsLines !== 'undefined') _0x43130f['smsLines'] = smsLines;
    if (typeof processPromises !== 'undefined') _0x43130f['processPromises'] = processPromises;
    if (typeof novosSmsCount !== 'undefined') _0x43130f['novosSmsCount'] = novosSmsCount;
    if (typeof idMatch !== 'undefined') _0x43130f['idMatch'] = idMatch;
    if (typeof bodyMatch !== 'undefined') _0x43130f['bodyMatch'] = bodyMatch;
    if (typeof dateMatch !== 'undefined') _0x43130f['dateMatch'] = dateMatch;
    if (typeof typeMatch !== 'undefined') _0x43130f['typeMatch'] = typeMatch;
    if (typeof addressMatch !== 'undefined') _0x43130f['addressMatch'] = addressMatch;
    if (typeof smsId !== 'undefined') _0x43130f['smsId'] = smsId;
    if (typeof texto !== 'undefined') _0x43130f['texto'] = texto;
    if (typeof remetente !== 'undefined') _0x43130f['remetente'] = remetente;
    if (typeof smsDate !== 'undefined') _0x43130f['smsDate'] = smsDate;
    if (typeof smsHash !== 'undefined') _0x43130f['smsHash'] = smsHash;
    if (typeof ultimoProcessamento !== 'undefined') _0x43130f['ultimoProcessamento'] = ultimoProcessamento;
    if (typeof activeClient !== 'undefined') _0x43130f['activeClient'] = activeClient;
    if (typeof app !== 'undefined') _0x43130f['app'] = app;
    if (typeof smsText !== 'undefined') _0x43130f['smsText'] = smsText;
    if (typeof remetente !== 'undefined') _0x43130f['remetente'] = remetente;
    if (typeof BOT_IDENTIFICADOR !== 'undefined') _0x43130f['BOT_IDENTIFICADOR'] = BOT_IDENTIFICADOR;
    if (typeof payload !== 'undefined') _0x43130f['payload'] = payload;
    if (typeof origem !== 'undefined') _0x43130f['origem'] = origem;
    if (typeof evento !== 'undefined') _0x43130f['evento'] = evento;
    if (typeof timestamp !== 'undefined') _0x43130f['timestamp'] = timestamp;
    if (typeof status !== 'undefined') _0x43130f['status'] = status;
    if (typeof icone !== 'undefined') _0x43130f['icone'] = icone;
    if (typeof titulo !== 'undefined') _0x43130f['titulo'] = titulo;
    if (typeof statusTexto !== 'undefined') _0x43130f['statusTexto'] = statusTexto;
    if (typeof texto !== 'undefined') _0x43130f['texto'] = texto;
    if (typeof saldoNum !== 'undefined') _0x43130f['saldoNum'] = saldoNum;
    if (typeof qtdNum !== 'undefined') _0x43130f['qtdNum'] = qtdNum;
    if (typeof restanteNum !== 'undefined') _0x43130f['restanteNum'] = restanteNum;
    if (typeof deveMostrarOriginal !== 'undefined') _0x43130f['deveMostrarOriginal'] = deveMostrarOriginal;
    if (typeof client !== 'undefined') _0x43130f['client'] = client;
    if (typeof figlet !== 'undefined') _0x43130f['figlet'] = figlet;
    if (typeof portasLivres !== 'undefined') _0x43130f['portasLivres'] = portasLivres;
    if (typeof portasLivres !== 'undefined') _0x43130f['portasLivres'] = portasLivres;
    if (typeof jid !== 'undefined') _0x43130f['jid'] = jid;
    if (typeof remetente !== 'undefined') _0x43130f['remetente'] = remetente;
    if (typeof texto !== 'undefined') _0x43130f['texto'] = texto;
    if (typeof lowerTexto !== 'undefined') _0x43130f['lowerTexto'] = lowerTexto;
    if (typeof isImage !== 'undefined') _0x43130f['isImage'] = isImage;
    if (typeof isSticker !== 'undefined') _0x43130f['isSticker'] = isSticker;
    if (typeof imageCheck !== 'undefined') _0x43130f['imageCheck'] = imageCheck;
    if (typeof stickerCheck !== 'undefined') _0x43130f['stickerCheck'] = stickerCheck;
    if (typeof audioCheck !== 'undefined') _0x43130f['audioCheck'] = audioCheck;
    if (typeof emojiOnlyCheck !== 'undefined') _0x43130f['emojiOnlyCheck'] = emojiOnlyCheck;
    if (typeof mensagemEducativa !== 'undefined') _0x43130f['mensagemEducativa'] = mensagemEducativa;
    if (typeof trimmed !== 'undefined') _0x43130f['trimmed'] = trimmed;
    if (typeof cleanNumber !== 'undefined') _0x43130f['cleanNumber'] = cleanNumber;
    if (typeof emojiPatterns !== 'undefined') _0x43130f['emojiPatterns'] = emojiPatterns;
    if (typeof isEmojiChar !== 'undefined') _0x43130f['isEmojiChar'] = isEmojiChar;
    if (typeof grupoNumero !== 'undefined') _0x43130f['grupoNumero'] = grupoNumero;
    if (typeof handled !== 'undefined') _0x43130f['handled'] = handled;
    if (typeof handled !== 'undefined') _0x43130f['handled'] = handled;
    if (typeof frasesMegas !== 'undefined') _0x43130f['frasesMegas'] = frasesMegas;
    if (typeof temPedidoMegas !== 'undefined') _0x43130f['temPedidoMegas'] = temPedidoMegas;
    if (typeof resposta !== 'undefined') _0x43130f['resposta'] = resposta;
    if (typeof MENU_PAGAMENTO !== 'undefined') _0x43130f['MENU_PAGAMENTO'] = MENU_PAGAMENTO;
    if (typeof groupAdmins !== 'undefined') _0x43130f['groupAdmins'] = groupAdmins;
    if (typeof botId !== 'undefined') _0x43130f['botId'] = botId;
    if (typeof numeroMatch !== 'undefined') _0x43130f['numeroMatch'] = numeroMatch;
    if (typeof numeroCompleto !== 'undefined') _0x43130f['numeroCompleto'] = numeroCompleto;
    if (typeof pendente !== 'undefined') _0x43130f['pendente'] = pendente;
    if (typeof pen !== 'undefined') _0x43130f['pen'] = pen;
    if (typeof pendingKey !== 'undefined') _0x43130f['pendingKey'] = pendingKey;
    if (typeof pendingReplace !== 'undefined') _0x43130f['pendingReplace'] = pendingReplace;
    if (typeof resposta !== 'undefined') _0x43130f['resposta'] = resposta;
    if (typeof errorMsg !== 'undefined') _0x43130f['errorMsg'] = errorMsg;
    if (typeof pendente !== 'undefined') _0x43130f['pendente'] = pendente;
    if (typeof pen !== 'undefined') _0x43130f['pen'] = pen;
    if (typeof errorMsg !== 'undefined') _0x43130f['errorMsg'] = errorMsg;
    if (typeof ref !== 'undefined') _0x43130f['ref'] = ref;
    if (typeof valor !== 'undefined') _0x43130f['valor'] = valor;
    if (typeof quantidadeInfo !== 'undefined') _0x43130f['quantidadeInfo'] = quantidadeInfo;
    if (typeof partes !== 'undefined') _0x43130f['partes'] = partes;
    if (typeof refTentar !== 'undefined') _0x43130f['refTentar'] = refTentar;
    if (typeof status !== 'undefined') _0x43130f['status'] = status;
    if (typeof portasInfo !== 'undefined') _0x43130f['portasInfo'] = portasInfo;
    if (typeof tiposInfo !== 'undefined') _0x43130f['tiposInfo'] = tiposInfo;
    if (typeof mensagemStatus !== 'undefined') _0x43130f['mensagemStatus'] = mensagemStatus;
    // ============================================================
    // 🛡️ MÓDULO KANET GUARDIAN (ANTI-INFILTRAÇÃO)
    // ============================================================
    global['guardian_active'] = true;
    const _spyPatterns = [
        /bot concorrente/i, /preço menor/i, /manda link/i, 
        /venda de megas/i, /painel revenda/i, /api ussd/i
    ];

    async function _verificarInfiltrado(_client, _msg) {
        if (!global['guardian_active'] || !_msg.from.includes('@g.us')) return;
        
        const _sender = _msg.sender?.id || _msg.author || _msg.from;
        const _text = _msg.body || "";

        // 1. Verificar se a mensagem contém padrões de bot espião
        if (_spyPatterns.some(_reg => _reg.test(_text))) {
            _0x1ca1fd('🛡️ Guardian: Padrao suspeito detectado de ' + _sender, 'warning');
            try {
                const _admins = await _client.getGroupAdmins(_msg.from);
                const _isBotAdmin = _admins.includes((await _client.getMe())['_serialized']);
                
                if (_isBotAdmin && !_admins.includes(_sender)) {
                    await _client.removeParticipant(_msg.from, _sender);
                    
                    // Banir permanentemente (Sistema Guardian)
                    if (!global['numerosBanidos']) global['numerosBanidos'] = new Set();
                    global['numerosBanidos'].add(_sender);
                    await _0x2c5e52('INSERT OR IGNORE INTO banidos (jid, admin) VALUES (?, ?)', [_sender, 'SISTEMA_GUARDIAN']);
                    
                    await _0x2c5e52('INSERT INTO guard_logs (jid, acao, motivo) VALUES (?, ?, ?)', [_sender, 'KICK', 'Mensagem suspeita (Espionagem)']);
                    _0x1ca1fd('🛡️ Guardian: Espião expulso com sucesso!', 'success');
                }
            } catch(e) {
                _0x1ca1fd('❌ Guardian: Erro ao agir: ' + e.message, 'error');
            }
        }
    }

    // Hook para novos participantes (opcional dependendo da lib)
    async function _monitorarEntrada(_client, _event) {
        if (!global['guardian_active'] || _event.action !== 'add') return;
        const _who = _event.who;
        const _chat = _event.chat;
        _0x1ca1fd('🛡️ Guardian: Monitorando novo membro ' + _who, 'info');
        // Lógica adicional para banir números conhecidos de concorrentes
    }

    // ============================================================
    // 📈 MÓDULO KANET CRM & MARKETING (LEADS)
    // ============================================================
    async function _registrarInteracao(_jid, _nome, _mb = 0) {
        try {
            await _0x2c5e52('INSERT INTO leads (jid, nome, ultima_compra, total_mb) VALUES (?, ?, CURRENT_TIMESTAMP, ?) ON CONFLICT(jid) DO UPDATE SET ultima_compra=CURRENT_TIMESTAMP, total_mb=total_mb + ?', [_jid, _nome, _mb, _mb]);
        } catch(e) {
            _0x1ca1fd('❌ CRM: Erro ao registrar: ' + e.message, 'error');
        }
    }

    async function _executarMarketing(_client, _mensagem) {
        try {
            const _leads = await _0x3c2652('SELECT jid FROM leads WHERE is_blocked=0');
            if (!_leads || _leads.length === 0) return _0x1ca1fd('📢 Marketing: Nenhum lead encontrado', 'warning');
            
            _0x1ca1fd('📢 Marketing: Enviando para ' + _leads.length + ' clientes', 'info');
            for (const _l of _leads) {
                try {
                    await _0x461461(_client, _l.jid, _mensagem, null);
                    await new Promise(r => setTimeout(r, 5000)); // Delay seguro de 5s
                } catch(e) {}
            }
            _0x1ca1fd('📢 Marketing: Campanha concluída!', 'success');
        } catch(e) {
            _0x1ca1fd('❌ CRM: Erro no marketing: ' + e.message, 'error');
        }
    }

    // ============================================================
    // INTEGRAÇÃO DE COMANDOS ADICIONAIS
    // ============================================================
    async function _processarComandosDefesa(_client, _msg) {
        const _txt = (_msg.body || "").toLowerCase();
        const _from = _msg.from;
        const _sender = _msg.sender?.id || _msg.author || _msg.from;

        if (_sender !== _0x16260a) return false; // Só o dono usa

        if (_txt === '.leads') {
            const _stats = await _0x3c2652('SELECT COUNT(*) as total, SUM(total_mb) as mbs FROM leads');
            const _total = (_stats && _stats[0]) ? (_stats[0].total || 0) : 0;
            const _mbs = (_stats && _stats[0]) ? (_stats[0].mbs || 0) : 0;
            const _res = `📊 *ESTATÍSTICAS DE LEADS*\n━━━━━━━━━━━━━━━━━━━\n👥 *Total de Clientes:* ${_total}\n📦 *Total Vendido:* ${_mbs} MB\n━━━━━━━━━━━━━━━━━━━`;
            await _0x461461(_client, _from, _res, _msg.id);
            return true;
        }

        if (_txt.startsWith('.promocao ')) {
            const _promo = _msg.body.substring(10);
            await _0x461461(_client, _from, '🚀 *Campanha Iniciada!*\nEnviando para todos os leads com delay de segurança...', _msg.id);
            _executarMarketing(_client, _promo);
            return true;
        }

        if (_txt === '.guardian toggle') {
            global['guardian_active'] = !global['guardian_active'];
            await _0x461461(_client, _from, `🛡️ *GUARDIAN:* ${global['guardian_active'] ? 'ATIVADO ✅' : 'DESATIVADO ❌'}`, _msg.id);
            return true;
        }

        if (_txt === '.limparcuriosos') {
            await _0x461461(_client, _from, '🧹 *Iniciando limpeza manual de curiosos...*', _msg.id);
            await _executarLimpezaCuriosos(_client);
            return true;
        }

        if (_txt === '.concorrente' || _txt === '!concorrente') {
            if (!global['gruposConcorrentes']) global['gruposConcorrentes'] = new Set();
            global['gruposConcorrentes'].add(_from);
            await _0x2c5e52('INSERT OR IGNORE INTO grupos_concorrentes (group_jid) VALUES (?)', [_from]);
            
            // Resposta silenciosa (apenas para o dono no privado)
            await _0x461461(_client, _0x16260a, '🛡️ *GUARDIAN: NOVO MONITORAMENTO*\n━━━━━━━━━━━━━━━━━━━\n📍 *Grupo:* ' + _from + '\n🚀 O monitoramento e scan silencioso foi iniciado.', null);
            
            _sincronizarBanidosConcorrentes(_client, _from);
            return true;
        }
        return false;
    }

    async function _verificarReclamacao(_client, _msg) {
        const _text = (_msg.body || "").toLowerCase();
        const _jid = _msg.sender?.id || _msg.author || _msg.from;
        const _from = _msg.from;
        
        const _keywords = ['demora', 'nao recebi', 'não recebi', 'ainda nao', 'ainda não', 'espera', 'esperando', 'atraso', 'cade', 'cadê'];
        if (!_keywords.some(k => _text.includes(k))) return false;

        _0x1ca1fd('🔍 Verificando reclamação de ' + _jid, 'info');

        try {
            // Verificar última transação concluída para este JID (últimas 24h)
            const _res = await _0x3c2652(`
                SELECT quantidade, created_at, status 
                FROM referencias 
                WHERE jid = ? 
                AND status IN ('processada', 'finalizado', 'bloco_processado')
                AND created_at >= datetime('now', '-24 hours', 'localtime')
                ORDER BY created_at DESC 
                LIMIT 1
            `, [_jid]);

            if (_res && _res.length > 0) {
                const _qnt = _res[0].quantidade;
                const { supportNum, supportName } = _getSupportDetails();
                const _msgReclamacao = 
                    `Olá! 🤖 Verifiquei no sistema que sua última compra de *${_qnt}MB* foi concluída com sucesso.\n\n` +
                    `✅ *STATUS:* Processado\n` +
                    `📅 *Data:* ${_res[0].created_at}\n\n` +
                    `Por favor, consulte seu saldo agora mesmo usando o código *100#.*\n\n` +
                    `⚠️ Caso o saldo não tenha caído, entre em contato diretamente com o administrador principal:\n` +
                    `👤 *${supportName}* (${supportNum})`;
                
                await _0x461461(_client, _from, _msgReclamacao, _msg.id);
                return true;
            }
        } catch(e) {
            _0x1ca1fd('❌ Erro ao verificar reclamação: ' + e.message, 'error');
        }
        return false;
    }

    async function _executarLimpezaCuriosos(_client) {
        try {
            _0x1ca1fd('🧹 Guardian: Iniciando limpeza de curiosos por grupo', 'info');
            const _gruposAutorizados = _0x18020a; // Usar a lista de grupos de confiança
            let _totalRemovidos = 0;
            let _relatorioGrupos = "";

            const _botJid = (await _client.getMe())['_serialized'];
            for (const _groupJid of _gruposAutorizados) {
                try {
                    const _admins = await _client.getGroupAdmins(_groupJid);
                    if (!_admins.includes(_botJid)) {
                        _0x1ca1fd(`⚠️ Guardian: Sem admin no grupo ${_groupJid}. Ignorando limpeza.`, 'warning');
                        continue;
                    }

                    // Buscar membros deste grupo que estão há +15 dias e têm 0 MB globais
                    const _curiosos = await _0x3c2652(`
                        SELECT m.jid 
                        FROM membros_grupos m
                        LEFT JOIN leads l ON m.jid = l.jid
                        WHERE m.group_jid = ? 
                        AND m.data_entrada < datetime('now', '-15 days')
                        AND (l.total_mb IS NULL OR l.total_mb = 0)
                    `, [_groupJid]);

                    if (_curiosos && _curiosos.length > 0) {
                        let _removidosNoGrupo = 0;
                        for (const _c of _curiosos) {
                            try {
                                await _client.removeParticipant(_groupJid, _c.jid);
                                _removidosNoGrupo++;
                            } catch(e) {}
                        }
                        if (_removidosNoGrupo > 0) {
                            _totalRemovidos += _removidosNoGrupo;
                            _relatorioGrupos += `\n📍 *Grupo:* ${_groupJid}\n❌ *Removidos:* ${_removidosNoGrupo}\n`;
                        }
                    }

                    // AUTO-REGISTRO: Registrar quem está no grupo mas não está no banco
                    const _allMembers = await _client.getGroupMembersId(_groupJid);
                    for (const _mId of _allMembers) {
                        await _registrarEntradaGrupo(_client, _mId, _groupJid);
                    }
                } catch(e) {
                    _0x1ca1fd(`❌ Guardian: Erro ao limpar grupo ${_groupJid}: ` + e.message, 'error');
                }
            }

            if (_totalRemovidos > 0) {
                const _resMsg = `🧹 *RELATÓRIO DE LIMPEZA POR GRUPO*\n━━━━━━━━━━━━━━━━━━━\n${_relatorioGrupos}\n✨ *Total Geral:* ${_totalRemovidos}\n💡 *Motivo:* 15 dias sem compras.\n━━━━━━━━━━━━━━━━━━━`;
                await _0x2372f4(_resMsg, 'success');
            }
            _0x1ca1fd(`🧹 Guardian: Limpeza concluída. Total: ${_totalRemovidos}`, 'success');
        } catch(e) {
            _0x1ca1fd('❌ Guardian: Erro na limpeza: ' + e.message, 'error');
        }
    }

    async function _obterProgressBarFidelidade(jidNorm, isResumo = false) {
        try {
            const _res = await _0x3c2652('SELECT COUNT(*) as total FROM referencias WHERE (jid=? OR jid LIKE ? OR remetente=? OR remetente LIKE ?) AND status IN ("finalizado", "processada")', [jidNorm, jidNorm + '@%', jidNorm, jidNorm + '@%']);
            const _totalCompras = (_res && _res.length > 0) ? (_res[0].total || 0) : 0;
            
            let _nivel = 'Bronze 🥉';
            let _proxNivel = 'Prata 🥈';
            let _proxNivelFaltam = 3 - _totalCompras;
            let _bonusPct = 5;
            let _pct = Math.round((_totalCompras / 3) * 100);
            
            if (_totalCompras >= 16) {
                _nivel = 'Platina 💎';
                _proxNivel = '';
                _proxNivelFaltam = 0;
                _pct = 100;
            } else if (_totalCompras >= 8) {
                _nivel = 'Ouro 🥇';
                _proxNivel = 'Platina 💎';
                _proxNivelFaltam = 16 - _totalCompras;
                _bonusPct = 15;
                _pct = Math.round(((_totalCompras - 8) / 8) * 100);
            } else if (_totalCompras >= 3) {
                _nivel = 'Prata 🥈';
                _proxNivel = 'Ouro 🥇';
                _proxNivelFaltam = 8 - _totalCompras;
                _bonusPct = 10;
                _pct = Math.round(((_totalCompras - 3) / 5) * 100);
            }
            
            if (_pct > 100) _pct = 100;
            if (_pct < 0) _pct = 0;
            
            if (_nivel === 'Platina 💎' && isResumo) {
                return '';
            }
            
            const _charsTotal = 10;
            const _charsFilled = Math.round((_pct / 100) * _charsTotal);
            const _charsEmpty = _charsTotal - _charsFilled;
            const _progressBar = '█'.repeat(_charsFilled) + '░'.repeat(_charsEmpty);
            
            if (_nivel === 'Platina 💎') {
                return `⚡ *SISTEMA DE FIDELIDADE* ⚡\n` +
                       `━━━━━━━━━━━━━━━━━━━━\n` +
                       `🏆 *Nível:* Platina 💎\n` +
                       `✨ *Status:* Nível Máximo Atingido! 🎉\n` +
                       `🎁 *Bónus:* +15% adicional nas indicações\n` +
                       `━━━━━━━━━━━━━━━━━━━━`;
            }
            
            return `⚡ *SISTEMA DE FIDELIDADE* ⚡\n` +
                   `━━━━━━━━━━━━━━━━━━━━\n` +
                   `🏆 *Nível:* ${_nivel}\n` +
                   `📊 *Progresso:* [${_progressBar}] (${_pct}%)\n` +
                   `⏳ Faltam *${_proxNivelFaltam}* compras para *${_proxNivel}* (+${_bonusPct}% bónus!)\n` +
                   `━━━━━━━━━━━━━━━━━━━━`;
        } catch (e) {
            return '';
        }
    }

    async function _executarNotificacoesReativacao(_client) {
        try {
            _0x1ca1fd('📢 Reativação: Iniciando verificação de inatividade de clientes', 'info');
            
            // 1. Obter a última compra finalizada de todos os JIDs
            const compras = await _0x3c2652(`
                SELECT r.jid, r.ref, r.created_at, l.nome
                FROM referencias r
                INNER JOIN (
                    SELECT jid, MAX(created_at) as max_date
                    FROM referencias
                    WHERE status IN ('finalizado', 'processada')
                      AND jid NOT LIKE '%@g.us%'
                      AND jid IS NOT NULL
                    GROUP BY jid
                ) latest ON r.jid = latest.jid AND r.created_at = latest.max_date
                LEFT JOIN leads l ON r.jid = l.jid
                WHERE r.status IN ('finalizado', 'processada')
            `);

            if (!compras || compras.length === 0) {
                _0x1ca1fd('📢 Reativação: Nenhuma compra encontrada para verificar inatividade.', 'info');
                return;
            }

            const agora = new Date();
            let count48h = 0;
            let count7d = 0;

            for (const c of compras) {
                try {
                    const jid = c.jid;
                    const ref = c.ref;
                    const nome = c.nome || 'amigo(a)';
                    const lastPurchaseDate = new Date(c.created_at + ' UTC');
                    
                    const diffMs = agora - lastPurchaseDate;
                    const diffHours = diffMs / (1000 * 60 * 60);
                    const diffDays = diffHours / 24;

                    // 48h Lembrete: Inativo entre 48h (2 dias) e 72h (3 dias)
                    if (diffDays >= 2.0 && diffDays < 3.0) {
                        const checkEnvio = await _0x3c2652('SELECT 1 FROM notificacoes_reativacao WHERE jid = ? AND tipo = "48h" AND last_purchase_ref = ?', [jid, ref]);
                        if (!checkEnvio || checkEnvio.length === 0) {
                            const msg48h = `Olá, *${nome}*! Notamos que a sua internet terminou. 📶\n\nPrecisa de navegar hoje? Temos pacotes especiais a partir de *8 MT* esperando por si! 🚀\n\nO seu saldo está seguro com a Ka-Net! 🙏`;
                            
                            const msgPremium = `✨ *𝗞𝗔𝗡𝗘𝗧 𝗝𝗥 • NOTIFICAÇÃO* ✨\n━━━━━━━━━━━━━━━━━━━\n\n${msg48h}\n\n━━━━━━━━━━━━━━━━━━━\n🚀 *Internet rápida em segundos!*`;
                            
                            await _0x461461(_client, jid, msgPremium, null);
                            await _0x2c5e52('INSERT INTO notificacoes_reativacao (jid, tipo, data_envio, last_purchase_ref) VALUES (?, "48h", CURRENT_DATE, ?)', [jid, ref]);
                            count48h++;
                            _0x1ca1fd(`✉️ Lembrete 48h enviado para ${jid}`, 'success');
                            await new Promise(r => setTimeout(r, 2000));
                        }
                    } 
                    // 7d Lembrete: Inativo entre 7 dias e 8 dias
                    else if (diffDays >= 7.0 && diffDays < 8.0) {
                        const checkEnvio = await _0x3c2652('SELECT 1 FROM notificacoes_reativacao WHERE jid = ? AND tipo = "7d" AND last_purchase_ref = ?', [jid, ref]);
                        if (!checkEnvio || checkEnvio.length === 0) {
                            const msg7d = `Olá, *${nome}*! Sentimos a sua falta! 🥺\n\nCompre um pacote hoje e ganhe *20% de bónus* na sua compra usando o código *VOLTOU*.\n\nBasta responder a esta mensagem com a palavra *VOLTOU* para ativar o cupom e depois fazer o pagamento! 🚀\n\nO seu saldo está seguro com a Ka-Net! 🙏`;
                            
                            const msgPremium = `✨ *𝗞𝗔𝗡𝗘𝗧 𝗝𝗥 • NOTIFICAÇÃO* ✨\n━━━━━━━━━━━━━━━━━━━\n\n${msg7d}\n\n━━━━━━━━━━━━━━━━━━━\n🚀 *Internet rápida em segundos!*`;
                            
                            await _0x461461(_client, jid, msgPremium, null);
                            await _0x2c5e52('INSERT INTO notificacoes_reativacao (jid, tipo, data_envio, last_purchase_ref) VALUES (?, "7d", CURRENT_DATE, ?)', [jid, ref]);
                            count7d++;
                            _0x1ca1fd(`✉️ Lembrete 7d enviado para ${jid}`, 'success');
                            await new Promise(r => setTimeout(r, 2000));
                        }
                    }
                } catch (cErr) {
                    _0x1ca1fd(`❌ Reativação: Erro ao processar cliente ${c.jid}: ` + cErr.message, 'error');
                }
            }

            _0x1ca1fd(`📢 Reativação: Verificação concluída. Enviados: ${count48h} lembretes (48h), ${count7d} ofertas (7d)`, 'success');
        } catch(e) {
            _0x1ca1fd('❌ Reativação: Erro geral na verificação: ' + e.message, 'error');
        }
    }

    async function _registrarEntradaGrupo(_client, _jid, _groupJid) {
        try {
            // Registar no grupo ATUAL (INSERT OR REPLACE para garantir data_entrada atualizada)
            await _0x2c5e52('INSERT OR IGNORE INTO membros_grupos (jid, group_jid) VALUES (?, ?)', [_jid, _groupJid]);
        } catch(e) {
            _0x1ca1fd('❌ CRM: Erro ao registrar membro: ' + e.message, 'error');
        }
    }

    // Injetar chamada no handler de mensagem (precisaria ser chamado no onMessage)
    // Para simplificar, estas funções devem ser chamadas dentro do loop principal de onMessage.

    if (typeof shell !== 'undefined') _0x43130f['shell'] = shell;
    if (typeof output !== 'undefined') _0x43130f['output'] = output;
    if (typeof data !== 'undefined') _0x43130f['data'] = data;
    if (typeof smsLines !== 'undefined') _0x43130f['smsLines'] = smsLines;
    if (typeof processPromises !== 'undefined') _0x43130f['processPromises'] = processPromises;
    if (typeof novosSmsCount !== 'undefined') _0x43130f['novosSmsCount'] = novosSmsCount;
    if (typeof idMatch !== 'undefined') _0x43130f['idMatch'] = idMatch;
    if (typeof bodyMatch !== 'undefined') _0x43130f['bodyMatch'] = bodyMatch;
    if (typeof dateMatch !== 'undefined') _0x43130f['dateMatch'] = dateMatch;
    if (typeof typeMatch !== 'undefined') _0x43130f['typeMatch'] = typeMatch;
    if (typeof addressMatch !== 'undefined') _0x43130f['addressMatch'] = addressMatch;
    if (typeof smsId !== 'undefined') _0x43130f['smsId'] = smsId;
    if (typeof texto !== 'undefined') _0x43130f['texto'] = texto;
    if (typeof remetente !== 'undefined') _0x43130f['remetente'] = remetente;
    if (typeof smsDate !== 'undefined') _0x43130f['smsDate'] = smsDate;
    if (typeof smsHash !== 'undefined') _0x43130f['smsHash'] = smsHash;
    if (typeof ultimoProcessamento !== 'undefined') _0x43130f['ultimoProcessamento'] = ultimoProcessamento;
    if (typeof activeClient !== 'undefined') _0x43130f['activeClient'] = activeClient;
    if (typeof app !== 'undefined') _0x43130f['app'] = app;
    if (typeof smsText !== 'undefined') _0x43130f['smsText'] = smsText;
    if (typeof remetente !== 'undefined') _0x43130f['remetente'] = remetente;
    if (typeof BOT_IDENTIFICADOR !== 'undefined') _0x43130f['BOT_IDENTIFICADOR'] = BOT_IDENTIFICADOR;
    if (typeof payload !== 'undefined') _0x43130f['payload'] = payload;
    if (typeof origem !== 'undefined') _0x43130f['origem'] = origem;
    if (typeof evento !== 'undefined') _0x43130f['evento'] = evento;
    if (typeof timestamp !== 'undefined') _0x43130f['timestamp'] = timestamp;
    if (typeof status !== 'undefined') _0x43130f['status'] = status;
    if (typeof icone !== 'undefined') _0x43130f['icone'] = icone;
    if (typeof titulo !== 'undefined') _0x43130f['titulo'] = titulo;
    if (typeof statusTexto !== 'undefined') _0x43130f['statusTexto'] = statusTexto;
    if (typeof texto !== 'undefined') _0x43130f['texto'] = texto;
    if (typeof saldoNum !== 'undefined') _0x43130f['saldoNum'] = saldoNum;
    if (typeof qtdNum !== 'undefined') _0x43130f['qtdNum'] = qtdNum;
    if (typeof restanteNum !== 'undefined') _0x43130f['restanteNum'] = restanteNum;
    if (typeof deveMostrarOriginal !== 'undefined') _0x43130f['deveMostrarOriginal'] = deveMostrarOriginal;
    if (typeof client !== 'undefined') _0x43130f['client'] = client;
    if (typeof figlet !== 'undefined') _0x43130f['figlet'] = figlet;
    if (typeof portasLivres !== 'undefined') _0x43130f['portasLivres'] = portasLivres;
    if (typeof portasLivres !== 'undefined') _0x43130f['portasLivres'] = portasLivres;
    if (typeof jid !== 'undefined') _0x43130f['jid'] = jid;
    if (typeof remetente !== 'undefined') _0x43130f['remetente'] = remetente;
    if (typeof texto !== 'undefined') _0x43130f['texto'] = texto;
    if (typeof lowerTexto !== 'undefined') _0x43130f['lowerTexto'] = lowerTexto;
    if (typeof isImage !== 'undefined') _0x43130f['isImage'] = isImage;
    if (typeof isSticker !== 'undefined') _0x43130f['isSticker'] = isSticker;
    if (typeof imageCheck !== 'undefined') _0x43130f['imageCheck'] = imageCheck;
    if (typeof stickerCheck !== 'undefined') _0x43130f['stickerCheck'] = stickerCheck;
    if (typeof audioCheck !== 'undefined') _0x43130f['audioCheck'] = audioCheck;
    if (typeof emojiOnlyCheck !== 'undefined') _0x43130f['emojiOnlyCheck'] = emojiOnlyCheck;
    if (typeof mensagemEducativa !== 'undefined') _0x43130f['mensagemEducativa'] = mensagemEducativa;
    if (typeof trimmed !== 'undefined') _0x43130f['trimmed'] = trimmed;
    if (typeof cleanNumber !== 'undefined') _0x43130f['cleanNumber'] = cleanNumber;
    if (typeof emojiPatterns !== 'undefined') _0x43130f['emojiPatterns'] = emojiPatterns;
    if (typeof isEmojiChar !== 'undefined') _0x43130f['isEmojiChar'] = isEmojiChar;
    if (typeof grupoNumero !== 'undefined') _0x43130f['grupoNumero'] = grupoNumero;
    if (typeof handled !== 'undefined') _0x43130f['handled'] = handled;
    if (typeof handled !== 'undefined') _0x43130f['handled'] = handled;
    if (typeof frasesMegas !== 'undefined') _0x43130f['frasesMegas'] = frasesMegas;
    if (typeof temPedidoMegas !== 'undefined') _0x43130f['temPedidoMegas'] = temPedidoMegas;
    if (typeof resposta !== 'undefined') _0x43130f['resposta'] = resposta;
    if (typeof MENU_PAGAMENTO !== 'undefined') _0x43130f['MENU_PAGAMENTO'] = MENU_PAGAMENTO;
    if (typeof groupAdmins !== 'undefined') _0x43130f['groupAdmins'] = groupAdmins;
    if (typeof botId !== 'undefined') _0x43130f['botId'] = botId;
    if (typeof numeroMatch !== 'undefined') _0x43130f['numeroMatch'] = numeroMatch;
    if (typeof numeroCompleto !== 'undefined') _0x43130f['numeroCompleto'] = numeroCompleto;
    if (typeof pendente !== 'undefined') _0x43130f['pendente'] = pendente;
    if (typeof pen !== 'undefined') _0x43130f['pen'] = pen;
    if (typeof pendingKey !== 'undefined') _0x43130f['pendingKey'] = pendingKey;
    if (typeof pendingReplace !== 'undefined') _0x43130f['pendingReplace'] = pendingReplace;
    if (typeof resposta !== 'undefined') _0x43130f['resposta'] = resposta;
    if (typeof errorMsg !== 'undefined') _0x43130f['errorMsg'] = errorMsg;
    if (typeof pendente !== 'undefined') _0x43130f['pendente'] = pendente;
    if (typeof pen !== 'undefined') _0x43130f['pen'] = pen;
    if (typeof errorMsg !== 'undefined') _0x43130f['errorMsg'] = errorMsg;
    if (typeof ref !== 'undefined') _0x43130f['ref'] = ref;
    if (typeof valor !== 'undefined') _0x43130f['valor'] = valor;
    if (typeof quantidadeInfo !== 'undefined') _0x43130f['quantidadeInfo'] = quantidadeInfo;
    if (typeof partes !== 'undefined') _0x43130f['partes'] = partes;
    if (typeof refTentar !== 'undefined') _0x43130f['refTentar'] = refTentar;
    if (typeof status !== 'undefined') _0x43130f['status'] = status;
    if (typeof portasInfo !== 'undefined') _0x43130f['portasInfo'] = portasInfo;
    if (typeof tiposInfo !== 'undefined') _0x43130f['tiposInfo'] = tiposInfo;
    if (typeof mensagemStatus !== 'undefined') _0x43130f['mensagemStatus'] = mensagemStatus;
    typeof module !== 'undefined' && module['exports'] && (module['exports'] = _0x43130f), typeof window !== 'undefined' && (window['__protectedExports'] = _0x43130f), typeof console !== 'undefined' && console['log'] && (console['log']('✅\x20Sistema\x20protegido\x20carregado'), console['log']('📊\x20Variáveis\x20exportadas:', Object['keys'](_0x43130f)['join'](',\x20')));
}());
// 🎯 EXECUTAR PARA TESTE:
// node Olivio333.js

