const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const crypto = require('crypto');

const app = express();

// 1. CONFIGURAÇÕES DE AMBIENTE
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET || 'budgety_secret_2026';

// 2. CONEXÃO COM O POSTGRES (NEON)
const db = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// 3. MIDDLEWARES
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// 4. INICIALIZAÇÃO DO BANCO
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

// 5. MIDDLEWARE DE AUTENTICAÇÃO
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

// 6. CADASTRO
app.post('/api/cadastro', async (req, res) => {
    const { email, senha } = req.body;

    if (!email || !senha) return res.status(400).json({ erro: 'Preencha todos os campos' })
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ erro: 'Email inválido' })
    if (senha.length < 8) return res.status(400).json({ erro: 'Senha deve ter no mínimo 8 caracteres' })
    if (senha.length > 64) return res.status(400).json({ erro: 'Senha deve ter no máximo 64 caracteres' })

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
});

// 7. LOGIN
app.post('/api/login', async (req, res) => {
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
});

// 8. ROTAS DE LANÇAMENTOS
app.get('/api/lancamentos', autenticar, async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM lancamentos WHERE usuario_id = $1 ORDER BY data DESC', [req.usuarioId]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ erro: 'Erro ao buscar lançamentos' });
    }
});

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

// 9. SERVIR PÁGINAS HTML
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

// 10. INICIAR SERVIDOR
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});