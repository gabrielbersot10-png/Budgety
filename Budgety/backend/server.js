// ==========================================
// IMPORTAÇÕES DAS BIBLIOTECAS
// ==========================================
const express = require('express');       // Framework web
const path = require('path');             // Manipulação de caminhos de arquivo
const bcrypt = require('bcryptjs');       // Criptografia de senhas
const jwt = require('jsonwebtoken');      // Geração e verificação de tokens
const { Pool } = require('pg');           // Conexão com PostgreSQL
const crypto = require('crypto');         // Geração de IDs únicos
const cors = require('cors');             // Controle de origem das requisições
const helmet = require('helmet');         // Security headers HTTP

const app = express();

// ==========================================
// CONFIGURAÇÕES DE AMBIENTE
// Variáveis sensíveis ficam no servidor,
// nunca no código — isso é segurança!
// ==========================================
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET || 'budgety_secret_2026';

// ==========================================
// CONEXÃO COM O BANCO DE DADOS (NEON)
// ssl: true porque o Neon exige conexão segura
// ==========================================
const db = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ==========================================
// SECURITY HEADERS — VEM PRIMEIRO!
// O helmet adiciona headers HTTP que protegem
// contra ataques como XSS, clickjacking, etc.
// contentSecurityPolicy: false evita bloquear
// nossos scripts e estilos externos
// ==========================================
app.use(helmet({
    contentSecurityPolicy: false
}));

// ==========================================
// CORS — CONTROLE DE ORIGEM
// Define quais domínios podem acessar a API.
// Sem isso, qualquer site poderia fazer
// requisições pra sua API — isso é perigoso!
// ==========================================
app.use(cors({
    origin: [
        'https://budgety-5bbs.onrender.com',
        'http://localhost:3000'
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// ==========================================
// MIDDLEWARES GERAIS
// express.json() permite ler o corpo das requisições
// express.static() serve os arquivos do frontend
// ==========================================
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// ==========================================
// INICIALIZAÇÃO DO BANCO DE DADOS
// Cria as tabelas se ainda não existirem.
// IF NOT EXISTS garante que não apaga dados
// em produção ao reiniciar o servidor
// ==========================================
const initDB = async () => {
    try {
        // Tabela de usuários — guarda email e senha criptografada
        await db.query(`
            CREATE TABLE IF NOT EXISTS usuarios (
                id TEXT PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                senha TEXT NOT NULL,
                criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Tabela de lançamentos — cada lançamento pertence a um usuário
        // REFERENCES usuarios(id) garante integridade referencial
        await db.query(`
            CREATE TABLE IF NOT EXISTS lancamentos (
                id TEXT PRIMARY KEY,
                usuario_id TEXT NOT NULL REFERENCES usuarios(id),
                descricao TEXT NOT NULL,
                valor DECIMAL NOT NULL,
                tipo TEXT NOT NULL,
                data TEXT NOT NULL,
                criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Tabela de tentativas de login — usada pra bloquear ataques de força bruta
        await db.query(`
            CREATE TABLE IF NOT EXISTS tentativas_login (
                email TEXT PRIMARY KEY,
                tentativas INTEGER DEFAULT 0,
                bloqueado_ate TEXT
            )
        `);

        console.log('Banco de dados inicializado com sucesso.');
    } catch (err) {
        console.error('Erro ao inicializar o banco de dados:', err);
    }
};

initDB();

// ==========================================
// MIDDLEWARE DE AUTENTICAÇÃO
// Verifica se o token JWT é válido antes
// de liberar o acesso às rotas protegidas.
// É chamado em todas as rotas de lançamentos.
// ==========================================
function autenticar(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader ? authHeader.split(' ')[1] : null;

    if (!token) return res.status(401).json({ erro: 'Não autorizado' });

    try {
        // Verifica e decodifica o token
        const decoded = jwt.verify(token, JWT_SECRET);
        // Salva o ID do usuário na requisição pra usar nas rotas
        req.usuarioId = decoded.id;
        next();
    } catch (err) {
        res.status(401).json({ erro: 'Token inválido' });
    }
}

// ==========================================
// ROTA DE CADASTRO
// Valida email, senha, verifica se já existe,
// criptografa a senha com bcrypt e salva no banco.
// ID gerado aleatoriamente — não sequencial!
// ==========================================
app.post('/api/cadastro', async (req, res) => {
    const { email, senha } = req.body;

    // Validações básicas
    if (!email || !senha) return res.status(400).json({ erro: 'Preencha todos os campos' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ erro: 'Email inválido' });
    if (senha.length < 8) return res.status(400).json({ erro: 'Senha deve ter no mínimo 8 caracteres' });
    if (senha.length > 64) return res.status(400).json({ erro: 'Senha deve ter no máximo 64 caracteres' });

    try {
        // Verifica se email já está cadastrado
        const existe = await db.query('SELECT id FROM usuarios WHERE email = $1', [email]);
        if (existe.rows.length > 0) return res.status(400).json({ erro: 'Email já cadastrado' });

        // bcrypt com fator 12 — quanto maior, mais seguro e mais lento
        const hash = await bcrypt.hash(senha, 12);

        // ID aleatório — não sequencial, mais seguro
        const id = crypto.randomBytes(16).toString('hex');

        await db.query('INSERT INTO usuarios (id, email, senha) VALUES ($1, $2, $3)', [id, email, hash]);
        res.json({ mensagem: 'Cadastro realizado com sucesso!' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: 'Erro no servidor ao cadastrar' });
    }
});

// ==========================================
// ROTA DE LOGIN
// Verifica bloqueio, compara senha com bcrypt,
// registra tentativas falhas e retorna JWT
// ==========================================
app.post('/api/login', async (req, res) => {
    const { email, senha } = req.body;

    try {
        // Verifica se a conta está bloqueada por tentativas excessivas
        const tResult = await db.query('SELECT * FROM tentativas_login WHERE email = $1', [email]);
        const tentativa = tResult.rows[0];

        if (tentativa?.bloqueado_ate && new Date(tentativa.bloqueado_ate) > new Date()) {
            return res.status(429).json({ erro: 'Conta bloqueada temporariamente. Tente em 15 minutos.' });
        }

        // Busca o usuário no banco
        const uResult = await db.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        const usuario = uResult.rows[0];

        // bcrypt.compare compara a senha digitada com o hash salvo
        if (!usuario || !(await bcrypt.compare(senha, usuario.senha))) {
            const tentativasAtuais = tentativa ? tentativa.tentativas : 0;
            const novasTentativas = tentativasAtuais + 1;

            // Bloqueia por 15 minutos após 5 tentativas — prevenção de força bruta
            const bloqueado_ate = novasTentativas >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;

            await db.query(`
                INSERT INTO tentativas_login (email, tentativas, bloqueado_ate)
                VALUES ($1, $2, $3)
                ON CONFLICT(email) DO UPDATE SET tentativas = $2, bloqueado_ate = $3
            `, [email, novasTentativas, bloqueado_ate]);

            const restantes = 5 - novasTentativas;
            if (restantes <= 0) return res.status(429).json({ erro: 'Conta bloqueada por 15 minutos após 5 tentativas.' });
            return res.status(401).json({ erro: `Email ou senha incorretos. ${restantes} tentativas restantes.` });
        }

        // Login bem sucedido — zera as tentativas
        await db.query('DELETE FROM tentativas_login WHERE email = $1', [email]);

        // Gera token JWT com validade de 8 horas
        const token = jwt.sign({ id: usuario.id, email: usuario.email }, JWT_SECRET, { expiresIn: '8h' });
        res.json({ token, email: usuario.email });
    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: 'Erro no servidor ao logar' });
    }
});

// ==========================================
// ROTAS DE LANÇAMENTOS
// Todas protegidas pelo middleware autenticar.
// WHERE usuario_id = $1 garante que cada usuário
// acessa APENAS os seus próprios lançamentos
// ==========================================

// Busca todos os lançamentos do usuário logado
app.get('/api/lancamentos', autenticar, async (req, res) => {
    try {
        const result = await db.query(
            'SELECT * FROM lancamentos WHERE usuario_id = $1 ORDER BY data DESC',
            [req.usuarioId]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ erro: 'Erro ao buscar lançamentos' });
    }
});

// Cria um novo lançamento
app.post('/api/lancamentos', autenticar, async (req, res) => {
    const { descricao, valor, tipo, data } = req.body;
    if (!descricao || !valor || !tipo || !data) return res.status(400).json({ erro: 'Preencha todos os campos' });

    try {
        const id = crypto.randomBytes(16).toString('hex');
        await db.query(
            'INSERT INTO lancamentos (id, usuario_id, descricao, valor, tipo, data) VALUES ($1, $2, $3, $4, $5, $6)',
            [id, req.usuarioId, descricao, valor, tipo, data]
        );
        res.json({ mensagem: 'Lançamento salvo!' });
    } catch (err) {
        res.status(500).json({ erro: 'Erro ao salvar lançamento' });
    }
});

// Edita um lançamento — só edita se pertencer ao usuário logado
app.put('/api/lancamentos/:id', autenticar, async (req, res) => {
    const { descricao, valor, tipo } = req.body;
    try {
        await db.query(
            'UPDATE lancamentos SET descricao = $1, valor = $2, tipo = $3 WHERE id = $4 AND usuario_id = $5',
            [descricao, valor, tipo, req.params.id, req.usuarioId]
        );
        res.json({ mensagem: 'Lançamento atualizado!' });
    } catch (err) {
        res.status(500).json({ erro: 'Erro ao atualizar lançamento' });
    }
});

// Deleta um lançamento — só deleta se pertencer ao usuário logado
app.delete('/api/lancamentos/:id', autenticar, async (req, res) => {
    try {
        await db.query(
            'DELETE FROM lancamentos WHERE id = $1 AND usuario_id = $2',
            [req.params.id, req.usuarioId]
        );
        res.json({ mensagem: 'Lançamento deletado!' });
    } catch (err) {
        res.status(500).json({ erro: 'Erro ao deletar' });
    }
});

// ==========================================
// ROTAS DE PÁGINAS HTML
// O servidor serve os arquivos estáticos
// do frontend para o navegador
// ==========================================
app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'login.html'));
});

app.get('/cadastro.html', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'cadastro.html'));
});

app.get('/relatorio', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'relatorio.html'));
});

app.get('/relatorio.html', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'relatorio.html'));
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

// ==========================================
// INICIAR SERVIDOR
// process.env.PORT é fornecido pelo Render
// em produção — localmente usa 3000
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});