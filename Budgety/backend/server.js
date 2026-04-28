const express = require('express')
const path = require('path')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const Database = require('better-sqlite3')
const crypto = require('crypto')

const app = express()
const db = new Database(path.join(__dirname, 'budgety.db'))
const JWT_SECRET = 'budgety_secret_2026'

app.use(express.json())
app.use(express.static(path.join(__dirname, '..', 'frontend')))

// Cria tabelas se não existirem
db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    senha TEXT NOT NULL,
    criado_em TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS lancamentos (
    id TEXT PRIMARY KEY,
    usuario_id TEXT NOT NULL,
    descricao TEXT NOT NULL,
    valor REAL NOT NULL,
    tipo TEXT NOT NULL,
    data TEXT NOT NULL,
    criado_em TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
  );

  CREATE TABLE IF NOT EXISTS tentativas_login (
    email TEXT PRIMARY KEY,
    tentativas INTEGER DEFAULT 0,
    bloqueado_ate TEXT
  );
`)

// Middleware de autenticação
function autenticar(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1]
  if (!token) return res.status(401).json({ erro: 'Não autorizado' })
  try {
    const decoded = jwt.verify(token, JWT_SECRET)
    req.usuarioId = decoded.id
    next()
  } catch {
    res.status(401).json({ erro: 'Token inválido' })
  }
}

// Cadastro
app.post('/api/cadastro', async (req, res) => {
  const { email, senha } = req.body

  if (!email || !senha) return res.status(400).json({ erro: 'Preencha todos os campos' })
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ erro: 'Email inválido' })
  if (senha.length < 8) return res.status(400).json({ erro: 'Senha deve ter no mínimo 8 caracteres' })
  if (senha.length > 64) return res.status(400).json({ erro: 'Senha deve ter no máximo 64 caracteres' })

  const existe = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email)
  if (existe) return res.status(400).json({ erro: 'Email já cadastrado' })

  const hash = await bcrypt.hash(senha, 12)
  const id = crypto.randomUUID()

  db.prepare('INSERT INTO usuarios (id, email, senha) VALUES (?, ?, ?)').run(id, email, hash)
  res.json({ mensagem: 'Cadastro realizado com sucesso!' })
})

// Login
app.post('/api/login', async (req, res) => {
  const { email, senha } = req.body

  // Verifica bloqueio
  const tentativa = db.prepare('SELECT * FROM tentativas_login WHERE email = ?').get(email)
  if (tentativa?.bloqueado_ate && new Date(tentativa.bloqueado_ate) > new Date()) {
    return res.status(429).json({ erro: 'Conta bloqueada temporariamente. Tente em 15 minutos.' })
  }

  const usuario = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email)

  if (!usuario || !(await bcrypt.compare(senha, usuario.senha))) {
    // Registra tentativa falha
    const tentativas = (tentativa?.tentativas || 0) + 1
    const bloqueado_ate = tentativas >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null

    db.prepare(`
      INSERT INTO tentativas_login (email, tentativas, bloqueado_ate) 
      VALUES (?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET tentativas = ?, bloqueado_ate = ?
    `).run(email, tentativas, bloqueado_ate, tentativas, bloqueado_ate)

    const restantes = 5 - tentativas
    if (restantes <= 0) return res.status(429).json({ erro: 'Conta bloqueada por 15 minutos após 5 tentativas.' })
    return res.status(401).json({ erro: `Email ou senha incorretos. ${restantes} tentativas restantes.` })
  }

  // Login bem sucedido — zera tentativas
  db.prepare('DELETE FROM tentativas_login WHERE email = ?').run(email)

  const token = jwt.sign({ id: usuario.id, email: usuario.email }, JWT_SECRET, { expiresIn: '8h' })
  res.json({ token, email: usuario.email })
})

// Rotas de lançamentos
app.get('/api/lancamentos', autenticar, (req, res) => {
  const lancamentos = db.prepare('SELECT * FROM lancamentos WHERE usuario_id = ? ORDER BY data DESC').all(req.usuarioId)
  res.json(lancamentos)
})

app.post('/api/lancamentos', autenticar, (req, res) => {
  const { descricao, valor, tipo, data } = req.body
  if (!descricao || !valor || !tipo || !data) return res.status(400).json({ erro: 'Preencha todos os campos' })
  const id = crypto.randomUUID()
  db.prepare('INSERT INTO lancamentos (id, usuario_id, descricao, valor, tipo, data) VALUES (?, ?, ?, ?, ?, ?)').run(id, req.usuarioId, descricao, valor, tipo, data)
  res.json({ mensagem: 'Lançamento salvo!' })
})

app.put('/api/lancamentos/:id', autenticar, (req, res) => {
  const { descricao, valor, tipo } = req.body
  db.prepare('UPDATE lancamentos SET descricao = ?, valor = ?, tipo = ? WHERE id = ? AND usuario_id = ?').run(descricao, valor, tipo, req.params.id, req.usuarioId)
  res.json({ mensagem: 'Lançamento atualizado!' })
})

app.delete('/api/lancamentos/:id', autenticar, (req, res) => {
  db.prepare('DELETE FROM lancamentos WHERE id = ? AND usuario_id = ?').run(req.params.id, req.usuarioId)
  res.json({ mensagem: 'Lançamento deletado!' })
})
app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'login.html'))
})

app.get('/cadastro.html', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'cadastro.html'))
})

app.get('/relatorio', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'relatorio.html'))
})

app.listen(3000, () => {
  console.log('Servidor rodando em http://localhost:3000')
})