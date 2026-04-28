// Proteção de rota
const token = localStorage.getItem('token')
if (!token) window.location.href = '/login.html'

const emailUsuario = localStorage.getItem('email') || ''
const avatarEl = document.getElementById('avatar')
if (avatarEl && emailUsuario) avatarEl.textContent = emailUsuario[0].toUpperCase()
const menuEmail = document.getElementById('menu-email')
if (menuEmail) menuEmail.textContent = emailUsuario

let lancamentos = []

// Função de API robusta
async function api(method, rota, body) {
  try {
    const res = await fetch(rota, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: body ? JSON.stringify(body) : undefined
    })

    if (res.status === 401) {
      localStorage.clear()
      window.location.href = '/login.html'
      return
    }

    const data = await res.json()
    if (!res.ok) throw new Error(data.erro || 'Erro na requisição')
    return data
  } catch (err) {
    console.error("Erro na API:", err)
    return method === 'GET' ? [] : { erro: err.message }
  }
}

async function carregarLancamentos() {
  const dados = await api('GET', '/api/lancamentos')
  // Garante que lancamentos seja sempre um array
  lancamentos = Array.isArray(dados) ? dados : []
  atualizarDashboard()
}

async function adicionar() {
  const descEl = document.getElementById('descricao')
  const valorEl = document.getElementById('valor')
  const tipoEl = document.getElementById('tipo')
  const dataEl = document.getElementById('data')

  // Tratamento de vírgula para ponto antes do parseFloat
  const valorLimpo = valorEl.value.replace(',', '.')
  const valor = parseFloat(valorLimpo)

  if (!descEl.value || isNaN(valor) || !dataEl.value) {
    alert('Preencha todos os campos corretamente!')
    return
  }

  const novoLancamento = { 
    descricao: descEl.value, 
    valor: valor, 
    tipo: tipoEl.value, 
    data: dataEl.value 
  }

  await api('POST', '/api/lancamentos', novoLancamento)
  
  // Limpar campos
  descEl.value = ''
  valorEl.value = ''
  dataEl.value = ''

  await carregarLancamentos()
}

async function deletar(id) {
  if (confirm('Deseja excluir este lançamento?')) {
    await api('DELETE', `/api/lancamentos/${id}`)
    await carregarLancamentos()
  }
}

function atualizarDashboard() {
  const lista = document.getElementById('lista-lancamentos')
  if (!lista) return

  // 1. Cálculos de Totais (Convertendo String para Number explicitamente)
  const totalReceitas = lancamentos
    .filter(l => l.tipo === 'receita')
    .reduce((acc, l) => acc + Number(l.valor), 0)

  const totalDespesas = lancamentos
    .filter(l => l.tipo === 'despesa')
    .reduce((acc, l) => acc + Number(l.valor), 0)

  const lucro = totalReceitas - totalDespesas

  // 2. Atualizar Cards na tela
  document.getElementById('total-receitas').textContent = `R$ ${totalReceitas.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
  document.getElementById('total-despesas').textContent = `R$ ${totalDespesas.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
  
  const totalLucro = document.getElementById('total-lucro')
  totalLucro.textContent = `R$ ${lucro.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
  totalLucro.className = lucro >= 0 ? 'verde' : 'vermelho'

  // 3. Filtrar por Mês Atual para a Lista
  const agora = new Date()
  const mesAtual = agora.getMonth()
  const anoAtual = agora.getFullYear()

  const lancamentosExibidos = lancamentos.filter(l => {
    const d = new Date(l.data + 'T00:00:00') // Adicionado T00:00:00 para evitar erro de fuso
    return d.getMonth() === mesAtual && d.getFullYear() === anoAtual
  })

  // 4. Renderizar Lista
  lista.innerHTML = ''

  if (lancamentosExibidos.length === 0) {
    lista.innerHTML = '<p style="text-align:center;color:#5a7fa8;margin-top:20px">Nenhum lançamento este mês.</p>'
    return
  }

  lancamentosExibidos.forEach(l => {
    const dataObj = new Date(l.data + 'T00:00:00')
    const dataFormatada = dataObj.toLocaleDateString('pt-BR')
    const valorFormatado = Number(l.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })

    lista.innerHTML += `
      <div style="background:#1a3a6b;border:1px solid #2a5298;border-radius:10px;padding:16px 20px;margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <span style="font-size:15px;font-weight:bold;color:#fff">${l.descricao}</span>
          <span style="font-size:15px;font-weight:bold;color:${l.tipo === 'receita' ? '#2ecc71' : '#e74c3c'}">R$ ${valorFormatado}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="display:flex;gap:8px;align-items:center">
            <span style="font-size:12px;color:${l.tipo === 'receita' ? '#2ecc71' : '#e74c3c'};background:${l.tipo === 'receita' ? 'rgba(46,204,113,0.1)' : 'rgba(231,76,60,0.1)'};padding:3px 10px;border-radius:20px">${l.tipo === 'receita' ? '↑ Receita' : '↓ Despesa'}</span>
            <span style="font-size:12px;color:#5a7fa8">${dataFormatada}</span>
          </div>
          <button onclick="deletar('${l.id}')" style="background:#e74c3c;color:white;border:none;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:12px">Deletar</button>
        </div>
      </div>
    `
  })
}

// Funções de UI
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
  localStorage.clear()
  window.location.href = '/login.html'
}

// Inicialização
document.addEventListener('DOMContentLoaded', carregarLancamentos)