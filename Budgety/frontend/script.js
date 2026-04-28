// Proteção de rota
const token = localStorage.getItem('token')
if (!token) window.location.href = '/login.html'

const emailUsuario = localStorage.getItem('email') || ''
const avatarEl = document.getElementById('avatar')
if (avatarEl && emailUsuario) avatarEl.textContent = emailUsuario[0].toUpperCase()
const menuEmail = document.getElementById('menu-email')
if (menuEmail) menuEmail.textContent = emailUsuario

let lancamentos = []

async function api(method, rota, body) {
  const res = await fetch(rota, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: body ? JSON.stringify(body) : undefined
  })
  if (res.status === 401) {
    localStorage.removeItem('token')
    localStorage.removeItem('email')
    window.location.href = '/login.html'
  }
  return res.json()
}

async function carregarLancamentos() {
  lancamentos = await api('GET', '/api/lancamentos')
  atualizarDashboard()
}

async function adicionar() {
  const descricao = document.getElementById('descricao').value
  const valor = parseFloat(document.getElementById('valor').value)
  const tipo = document.getElementById('tipo').value
  const dataValor = document.getElementById('data').value

  if (!descricao || isNaN(valor) || !dataValor) {
    alert('Preencha todos os campos incluindo a data!')
    return
  }

  await api('POST', '/api/lancamentos', { descricao, valor, tipo, data: dataValor })
  await carregarLancamentos()

  document.getElementById('descricao').value = ''
  document.getElementById('valor').value = ''
  document.getElementById('data').value = ''
}

async function deletar(id) {
  await api('DELETE', `/api/lancamentos/${id}`)
  await carregarLancamentos()
}

async function editar(id) {
  const lancamento = lancamentos.find(l => l.id === id)

  const novaDescricao = prompt('Descrição:', lancamento.descricao)
  if (novaDescricao === null) return

  const novoValor = parseFloat(prompt('Valor:', lancamento.valor))
  if (isNaN(novoValor)) return

  const novoTipo = prompt('Tipo (receita ou despesa):', lancamento.tipo)
  if (novoTipo === null) return

  await api('PUT', `/api/lancamentos/${id}`, {
    descricao: novaDescricao,
    valor: novoValor,
    tipo: novoTipo
  })
  await carregarLancamentos()
}

function atualizarDashboard() {
  const receitas = lancamentos.filter(l => l.tipo === 'receita')
  const despesas = lancamentos.filter(l => l.tipo === 'despesa')

  const totalReceitas = receitas.reduce((acc, l) => acc + l.valor, 0)
  const totalDespesas = despesas.reduce((acc, l) => acc + l.valor, 0)
  const lucro = totalReceitas - totalDespesas

  document.getElementById('total-receitas').textContent = `R$ ${totalReceitas.toFixed(2)}`
  document.getElementById('total-despesas').textContent = `R$ ${totalDespesas.toFixed(2)}`

  const totalLucro = document.getElementById('total-lucro')
  totalLucro.textContent = `R$ ${lucro.toFixed(2)}`
  totalLucro.className = lucro >= 0 ? 'verde' : 'vermelho'

  const agora = new Date()
  const mesAtual = agora.getMonth()
  const anoAtual = agora.getFullYear()

  const lancamentosMesAtual = lancamentos.filter(l => {
    const data = new Date(l.data)
    return data.getMonth() === mesAtual && data.getFullYear() === anoAtual
  })

  const lista = document.getElementById('lista-lancamentos')
  lista.innerHTML = ''

  if (lancamentosMesAtual.length === 0) {
    lista.innerHTML = '<p style="text-align:center;color:#5a7fa8;margin-top:20px">Nenhum lançamento este mês.</p>'
  }

  lancamentosMesAtual.forEach(l => {
    const data = new Date(l.data)
    const dataFormatada = `${data.getDate().toString().padStart(2,'0')}/${(data.getMonth()+1).toString().padStart(2,'0')}/${data.getFullYear()}`
    lista.innerHTML += `
      <div style="background:#1a3a6b;border:1px solid #2a5298;border-radius:10px;padding:16px 20px;margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <span style="font-size:15px;font-weight:bold;color:#fff">${l.descricao}</span>
          <span style="font-size:15px;font-weight:bold;color:${l.tipo === 'receita' ? '#2ecc71' : '#e74c3c'}">R$ ${l.valor.toFixed(2)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="display:flex;gap:8px;align-items:center">
            <span style="font-size:12px;color:${l.tipo === 'receita' ? '#2ecc71' : '#e74c3c'};background:${l.tipo === 'receita' ? 'rgba(46,204,113,0.1)' : 'rgba(231,76,60,0.1)'};padding:3px 10px;border-radius:20px">${l.tipo === 'receita' ? '↑ Receita' : '↓ Despesa'}</span>
            <span style="font-size:12px;color:#5a7fa8">${dataFormatada}</span>
          </div>
          <div style="display:flex;gap:8px">
            <button onclick="editar('${l.id}')" style="background:#2a5298;color:white;border:none;border-radius:6px;padding:6px 16px;cursor:pointer;font-size:13px">Editar</button>
            <button onclick="deletar('${l.id}')" style="background:#e74c3c;color:white;border:none;border-radius:6px;padding:6px 16px;cursor:pointer;font-size:13px">Deletar</button>
          </div>
        </div>
      </div>
    `
  })
}

function abrirGaveta() {
  document.getElementById('gaveta').classList.add('aberta')
  document.getElementById('overlay').classList.add('visivel')
}

function fecharGaveta() {
  document.getElementById('gaveta').classList.remove('aberta')
  document.getElementById('overlay').classList.remove('visivel')
}

function toggleMenu() {
  const menu = document.getElementById('menu-usuario')
  menu.style.display = menu.style.display === 'block' ? 'none' : 'block'
}

function sair() {
  localStorage.removeItem('token')
  localStorage.removeItem('email')
  window.location.href = '/login.html'
}

document.addEventListener('click', e => {
  const menu = document.getElementById('menu-usuario')
  const avatar = document.getElementById('avatar')
  if (menu && avatar && !menu.contains(e.target) && !avatar.contains(e.target)) {
    menu.style.display = 'none'
  }
})

carregarLancamentos()