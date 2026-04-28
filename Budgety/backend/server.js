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
        await db.query(
            'CREATE TABLE IF NOT EXISTS usuarios (' +
            'id TEXT PRIMARY KEY, ' +
            'email TEXT UNIQUE NOT NULL, ' +
            'senha TEXT NOT NULL, ' +
            'criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP' +
            ');'
        );

        await db.query(
            'CREATE TABLE IF NOT EXISTS lancamentos (' +
            'id TEXT PRIMARY KEY, ' +
            'usuario_id TEXT NOT NULL, ' +
            'descricao TEXT NOT NULL, ' +
            'valor DECIMAL NOT NULL, ' +
            'tipo TEXT NOT NULL, ' +
            'data TEXT NOT NULL, ' +
            'criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP, ' +
            'FOREIGN KEY (usuario_id) REFERENCES usuarios(id)' +
            ');'
        );

        await db.query(
            'CREATE TABLE IF NOT EXISTS tentativas_login (' +
            'email TEXT PRIMARY KEY, ' +
            'tentativas INTEGER DEFAULT 0, ' +
            'bloqueado_ate TEXT' +
            ');'
        );
        console.log("Banco de dados inicializado com sucesso no PostgreSQL.");
    } catch (err) {
        console.error("Erro ao inicializar o banco de dados:", err);
    }
};

initDB();

// 5. MIDDLEWARE DE AUTENTICAÇÃO
function autenticar(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader ? authHeader.split(' ')[1] : null;
    
    if (!token) {
        return res.status(401).json({ erro: 'Não autorizado' });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.usuarioId = decoded.id;
        next();
    } catch (err) {
        res.status(401).json({ erro: 'Token inválido' });
    }
}

// 6. ROTAS DE CADASTRO E LOGIN
app.post('/api/cadastro', async (req, res) => {
    const email = req.body.email;
    const senha = req.body.senha;
    
    if (!email || !senha) {
        return res.status(400).json({ erro: 'Preencha todos os campos' });
    }

    try {
        const existe = await db.query('SELECT id FROM usuarios WHERE email = $1', [email]);
        if (existe.rows.length > 0) {
            return res.status(400).json({ erro: 'Email já cadastrado' });
        }

        const hash = await bcrypt.hash(senha, 12);
        const id = crypto.randomBytes(16).toString('hex');

        await db.query('INSERT INTO usuarios (id, email, senha) VALUES ($1, $2, $3)', [id, email, hash]);
        res.json({ mensagem: 'Cadastro realizado com sucesso!' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: 'Erro no servidor ao cadastrar' });
    }
});

app.post('/api/login', async (req, res) => {
    const email = req.body.email;
    const senha = req.body.senha;
    
    try {
        const tResult = await db.query('SELECT * FROM tentativas_login WHERE email = $1', [email]);
        const tentativa = tResult.rows[0];

        if (tentativa && tentativa.bloqueado_ate && new Date(tentativa.bloqueado_ate) > new Date()) {
            return res.status(429).json({ erro: 'Conta bloqueada temporariamente.' });
        }

        const uResult = await db.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        const usuario = uResult.rows[0];

        if (!usuario || !(await bcrypt.compare(senha, usuario.senha))) {
            const tentativasAtuais = tentativa ? tentativa.tentativas : 0;
            const novasTentativas = tentativasAtuais + 1;
            
            let bloqueado_ate = null;
            if (novasTentativas >= 5) {
                bloqueado_ate = new Date(Date.now() + 15 * 60 * 1000).toISOString();
            }

            const insertLogQuery = 'INSERT INTO tentativas_login (email, tentativas, bloqueado_ate) ' +
                                   'VALUES ($1, $2, $3) ' +
                                   'ON CONFLICT(email) DO UPDATE SET tentativas = $2, bloqueado_ate = $3';

            await db.query(insertLogQuery, [email, novasTentativas, bloqueado_ate]);

            return res.status(401).json({ erro: 'Email ou senha incorretos.' });
        }

        await db.query('DELETE FROM tentativas_login WHERE email = $1', [email]);

        const token = jwt.sign({ id: usuario.id, email: usuario.email }, JWT_SECRET, { expiresIn: '8h' });
        res.json({ token, email: usuario.email });
    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: 'Erro no servidor ao logar' });
    }
});

// 7. ROTAS DE LANÇAMENTOS
app.get('/api/lancamentos', autenticar, async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM lancamentos WHERE usuario_id = $1 ORDER BY data DESC', [req.usuarioId]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ erro: 'Erro ao buscar lançamentos' });
    }
});

app.post('/api/lancamentos', autenticar, async (req, res) => {
    const descricao = req.body.descricao;
    const valor = req.body.valor;
    const tipo = req.body.tipo;
    const data = req.body.data;
    
    try {
        const id = crypto.randomBytes(16).toString('hex');
        const insertLancamento = 'INSERT INTO lancamentos (id, usuario_id, descricao, valor, tipo, data) ' +
                                 'VALUES ($1, $2, $3, $4, $5, $6)';
        await db.query(insertLancamento, [id, req.usuarioId, descricao, valor, tipo, data]);
        res.json({ mensagem: 'Lançamento salvo!' });
    } catch (err) {
        res.status(500).json({ erro: 'Erro ao salvar lançamento' });
    }
});

app.delete('/api/lancamentos/:id', autenticar, async (req, res) => {
    try {
        const deleteLancamento = 'DELETE FROM lancamentos WHERE id = $1 AND usuario_id = $2';
        await db.query(deleteLancamento, [req.params.id, req.usuarioId]);
        res.json({ mensagem: 'Lançamento deletado!' });
    } catch (err) {
        res.status(500).json({ erro: 'Erro ao deletar' });
    }
});

// 8. SERVIR PÁGINAS HTML
app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'login.html'));
});

app.get('/cadastro.html', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'cadastro.html'));
});

// 9. PORTA E INICIALIZAÇÃO
const PORT = process.env.PORT || 3000;

// Rota para a página de dashboard (index.html)
app.get('/index.html', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

// Faz com que a raiz do site redirecione para o login ou index
app.get('/', (req, res) => {
    res.redirect('/index.html'); 
});

// Rota para a página de relatorio (caso você ainda use)
app.get('/relatorio.html', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'relatorio.html'));
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});