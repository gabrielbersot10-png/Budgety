// CORREÇÃO: Inicialização do Banco de Dados
const initDB = async () => {
  try {
    // 1. Tabela de Usuários
    await db.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        senha TEXT NOT NULL,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Tabela de Lançamentos
    await db.query(`
      CREATE TABLE IF NOT EXISTS lancamentos (
        id TEXT PRIMARY KEY,
        usuario_id TEXT NOT NULL,
        descricao TEXT NOT NULL,
        valor DECIMAL NOT NULL,
        tipo TEXT NOT NULL,
        data TEXT NOT NULL,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
      );
    `);

    // 3. Tabela de Segurança
    await db.query(`
      CREATE TABLE IF NOT EXISTS tentativas_login (
        email TEXT PRIMARY KEY,
        tentativas INTEGER DEFAULT 0,
        bloqueado_ate TEXT
      );
    `);

    console.log("Banco de dados inicializado com sucesso.");
  } catch (err) {
    console.error("Erro ao inicializar o banco de dados:", err);
  }
};

// Executa a função
initDB();