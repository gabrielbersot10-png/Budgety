// ==========================================
// IMPORTAÇÕES DAS BIBLIOTECAS
// ==========================================
const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const crypto = require('crypto');
const cors = require('cors');
const helmet = require('helmet');
const { body, param, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const sanitizeHtml = require('sanitize-html');

const app = express();

const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET || 'budgety_secret_2026';

const db = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ==========================================
// SECURITY HEADERS
// ==========================================
app.use(helmet({ contentSecurityPolicy: false }));

// ==========================================
// CORS
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
// RATE LIMITING
// ==========================================
const limiteGeral = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { erro: 'Muitas requisições. Tente novamente em 15 minutos.' },
    standardHeaders: true,
    legacyHeaders: false
})

const limiteLogin = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { erro: 'Muitas tentativas de login. Tente novamente em 15 minutos.' },
    standardHeaders: true,
    legacyHeaders: false
})

const limiteCadastro = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    message: { erro: 'Muitos cadastros. Tente novamente em 1 hora.' },
    standardHeaders: true,
    legacyHeaders: false
})

app.use(limiteGeral)

// ==========================================
// MIDDLEWARES GERAIS
// ==========================================
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// ==========================================
// FUNÇÃO DE VERIFICAÇÃO DE ERROS
// ==========================================
function verificarErros(req, res, next) {
    const erros = validationResult(req);
    if (!erros.isEmpty()) {
        return res.status(400).json({ erro: erros.array()[0].msg });
    }
    next();
}

// ==========================================
// FUNÇÃO DE SANITIZAÇÃO
// Remove qualquer HTML ou script malicioso
// dos dados enviados pelo usuário.
// Protege contra ataques XSS — Cross Site Scripting
// Exemplo: <script>alert('hack')</script> vira ""
// ==========================================
function sanitizar(texto) {
    if (!texto) return texto;
    return sanitizeHtml(String(texto), {
        allowedTags: [],        // Não permite nenhuma tag HTML
        allowedAttributes: {}   // Não permite nenhum atributo
    }).trim();
}

// ==========================================
// INICIALIZAÇÃO DO BANCO DE DADOS
// ==========================================
const initDB = async () => {
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS usuarios (
                id TEXT PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                senha TEXT NOT NULL,
                criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

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
// ==========================================
function autenticar(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader ? authHeader.split(' ')[1] : null;

    if (!token) return res.status(401).json({ erro: 'Não autorizado' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.usuarioId = decoded.id;
        next();
    } catch (err) {
        res.status(401).json({ erro: 'Token inválido' });
    }
}

// ==========================================
// ROTA DE CADASTRO
// ==========================================
app.post('/api/cadastro',
    limiteCadastro,
    [
        body('email')
            .trim()
            .notEmpty().withMessage('Email é obrigatório')
            .isEmail().withMessage('Email inválido')
            .normalizeEmail(),
        body('senha')
            .notEmpty().withMessage('Senha é obrigatória')
            .isLength({ min: 8 }).withMessage('Senha deve ter no mínimo 8 caracteres')
            .isLength({ max: 64 }).withMessage('Senha deve ter no máximo 64 caracteres')
    ],
    verificarErros,
    async (req, res) => {
        const { email, senha } = req.body;

        try {
            const existe = await db.query('SELECT id FROM usuarios WHERE email = $1', [email]);
            if (existe.rows.length > 0) return res.status(400).json({ erro: 'Email já cadastrado' });

            const hash = await bcrypt.hash(senha, 12);
            const id = crypto.randomBytes(16).toString('hex');

            await db.query('INSERT INTO usuarios (id, email, senha) VALUES ($1, $2, $3)', [id, email, hash]);
            res.json({ mensagem: 'Cadastro realizado com sucesso!' });
        } catch (err) {
            console.error(err);
            res.status(500).json({ erro: 'Erro no servidor ao cadastrar' });
        }
    }
);

// ==========================================
// ROTA DE LOGIN
// ==========================================
app.post('/api/login',
    limiteLogin,
    [
        body('email')
            .trim()
            .notEmpty().withMessage('Email é obrigatório')
            .isEmail().withMessage('Email inválido')
            .normalizeEmail(),
        body('senha')
            .notEmpty().withMessage('Senha é obrigatória')
    ],
    verificarErros,
    async (req, res) => {
        const { email, senha } = req.body;

        try {
            const tResult = await db.query('SELECT * FROM tentativas_login WHERE email = $1', [email]);
            const tentativa = tResult.rows[0];

            if (tentativa?.bloqueado_ate && new Date(tentativa.bloqueado_ate) > new Date()) {
                return res.status(429).json({ erro: 'Conta bloqueada temporariamente. Tente em 15 minutos.' });
            }

            const uResult = await db.query('SELECT * FROM usuarios WHERE email = $1', [email]);
            const usuario = uResult.rows[0];

            if (!usuario || !(await bcrypt.compare(senha, usuario.senha))) {
                const tentativasAtuais = tentativa ? tentativa.tentativas : 0;
                const novasTentativas = tentativasAtuais + 1;
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

            await db.query('DELETE FROM tentativas_login WHERE email = $1', [email]);

            const token = jwt.sign({ id: usuario.id, email: usuario.email }, JWT_SECRET, { expiresIn: '8h' });
            res.json({ token, email: usuario.email });
        } catch (err) {
            console.error(err);
            res.status(500).json({ erro: 'Erro no servidor ao logar' });
        }
    }
);

// ==========================================
// ROTAS DE LANÇAMENTOS
// ==========================================
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

app.post('/api/lancamentos',
    autenticar,
    [
        body('descricao')
            .trim()
            .notEmpty().withMessage('Descrição é obrigatória')
            .isLength({ max: 100 }).withMessage('Descrição deve ter no máximo 100 caracteres'),
        body('valor')
            .notEmpty().withMessage('Valor é obrigatório')
            .isFloat({ min: 0.01 }).withMessage('Valor deve ser maior que zero'),
        body('tipo')
            .notEmpty().withMessage('Tipo é obrigatório')
            .isIn(['receita', 'despesa']).withMessage('Tipo deve ser receita ou despesa'),
        body('data')
            .notEmpty().withMessage('Data é obrigatória')
            .isDate().withMessage('Data inválida')
    ],
    verificarErros,
    async (req, res) => {
        // Sanitiza a descrição antes de salvar no banco
        const descricao = sanitizar(req.body.descricao);
        const { valor, tipo, data } = req.body;

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
    }
);

app.put('/api/lancamentos/:id',
    autenticar,
    [
        body('descricao')
            .trim()
            .notEmpty().withMessage('Descrição é obrigatória')
            .isLength({ max: 100 }).withMessage('Descrição deve ter no máximo 100 caracteres'),
        body('valor')
            .notEmpty().withMessage('Valor é obrigatório')
            .isFloat({ min: 0.01 }).withMessage('Valor deve ser maior que zero'),
        body('tipo')
            .notEmpty().withMessage('Tipo é obrigatório')
            .isIn(['receita', 'despesa']).withMessage('Tipo deve ser receita ou despesa'),
        param('id')
            .notEmpty().withMessage('ID inválido')
    ],
    verificarErros,
    async (req, res) => {
        // Sanitiza a descrição antes de atualizar no banco
        const descricao = sanitizar(req.body.descricao);
        const { valor, tipo } = req.body;
        try {
            await db.query(
                'UPDATE lancamentos SET descricao = $1, valor = $2, tipo = $3 WHERE id = $4 AND usuario_id = $5',
                [descricao, valor, tipo, req.params.id, req.usuarioId]
            );
            res.json({ mensagem: 'Lançamento atualizado!' });
        } catch (err) {
            res.status(500).json({ erro: 'Erro ao atualizar lançamento' });
        }
    }
);

app.delete('/api/lancamentos/:id',
    autenticar,
    [
        param('id')
            .notEmpty().withMessage('ID inválido')
    ],
    verificarErros,
    async (req, res) => {
        try {
            await db.query(
                'DELETE FROM lancamentos WHERE id = $1 AND usuario_id = $2',
                [req.params.id, req.usuarioId]
            );
            res.json({ mensagem: 'Lançamento deletado!' });
        } catch (err) {
            res.status(500).json({ erro: 'Erro ao deletar' });
        }
    }
);

// ==========================================
// SERVIR PÁGINAS HTML
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
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});