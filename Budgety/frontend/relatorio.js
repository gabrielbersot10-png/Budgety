// Proteção de rota
const token = localStorage.getItem('token')
if (!token) window.location.href = '/login.html'

const mesesNomes = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
]

let lancamentos = []
let graficoPizza = null

async function carregarLancamentos() {
  const res = await fetch('/api/lancamentos', {
    headers: { 'Authorization': `Bearer ${token}` }
  })
  lancamentos = await res.json()
  preencherFiltro()
}

function preencherFiltro() {
  const mesesDisponiveis = new Set()

  lancamentos.forEach(l => {
    const data = new Date(l.data)
    const chave = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}`
    mesesDisponiveis.add(chave)
  })

  const select = document.getElementById('filtro-mes')
  select.innerHTML = ''

  if (mesesDisponiveis.size === 0) {
    select.innerHTML = '<option>Nenhum lançamento encontrado</option>'
    return
  }

  const ordenados = Array.from(mesesDisponiveis).sort().reverse()

  ordenados.forEach(chave => {
    const [ano, mes] = chave.split('-')
    const label = `${mesesNomes[parseInt(mes) - 1]} ${ano}`
    const option = document.createElement('option')
    option.value = chave
    option.textContent = label
    select.appendChild(option)
  })

  filtrar()
}

function filtrar() {
  const chave = document.getElementById('filtro-mes').value
  if (!chave || chave === 'Nenhum lançamento encontrado') return

  const [ano, mes] = chave.split('-')
  const busca = document.getElementById('busca') ? document.getElementById('busca').value.toLowerCase() : ''

  const doMes = lancamentos.filter(l => {
    const data = new Date(l.data)
    const noMes = data.getFullYear() === parseInt(ano) && data.getMonth() + 1 === parseInt(mes)
    const corresponde = l.descricao.toLowerCase().includes(busca)
    return noMes && corresponde
  })

  const receitas = doMes.filter(l => l.tipo === 'receita').reduce((acc, l) => acc + l.valor, 0)
  const despesas = doMes.filter(l => l.tipo === 'despesa').reduce((acc, l) => acc + l.valor, 0)
  const resultado = receitas - despesas

  document.getElementById('rel-receitas').textContent = `R$ ${receitas.toFixed(2)}`
  document.getElementById('rel-despesas').textContent = `R$ ${despesas.toFixed(2)}`

  const relResultado = document.getElementById('rel-resultado')
  relResultado.textContent = `R$ ${resultado.toFixed(2)}`
  relResultado.className = resultado >= 0 ? 'verde' : 'vermelho'

  const despesasDoMes = doMes.filter(l => l.tipo === 'despesa')
  const msgVazio = document.getElementById('msg-vazio')

  if (despesasDoMes.length === 0) {
    msgVazio.style.display = 'block'
    if (graficoPizza) { graficoPizza.destroy(); graficoPizza = null }
  } else {
    msgVazio.style.display = 'none'

    const labels = despesasDoMes.map(l => l.descricao)
    const valores = despesasDoMes.map(l => l.valor)
    const cores = ['#e74c3c','#e67e22','#f1c40f','#9b59b6','#3498db','#1abc9c','#e91e63','#ff5722']

    if (graficoPizza) graficoPizza.destroy()

    const ctx = document.getElementById('grafico-pizza').getContext('2d')
    graficoPizza = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: valores,
          backgroundColor: cores.slice(0, labels.length),
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: '#7eb8f7', padding: 16 }
          }
        }
      }
    })
  }

  const listaContainer = document.getElementById('lancamentos-mes')
  listaContainer.innerHTML = ''

  if (doMes.length === 0) {
    listaContainer.innerHTML = '<p style="text-align:center;color:#5a7fa8;margin-top:20px">Nenhum lançamento encontrado.</p>'
    return
  }

  doMes.forEach(l => {
    const data = new Date(l.data)
    const dataFormatada = `${data.getDate().toString().padStart(2,'0')}/${(data.getMonth()+1).toString().padStart(2,'0')}/${data.getFullYear()}`
    listaContainer.innerHTML += `
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
          <button onclick="editarRelatorio('${l.id}')" style="background:#2a5298;color:white;border:none;border-radius:6px;padding:6px 16px;cursor:pointer;font-size:13px">Editar</button>
        </div>
      </div>
    `
  })
}

async function editarRelatorio(id) {
  const lancamento = lancamentos.find(l => l.id === id)

  const novaDescricao = prompt('Descrição:', lancamento.descricao)
  if (novaDescricao === null) return

  const novoValor = parseFloat(prompt('Valor:', lancamento.valor))
  if (isNaN(novoValor)) return

  const novoTipo = prompt('Tipo (receita ou despesa):', lancamento.tipo)
  if (novoTipo === null) return

  await fetch(`/api/lancamentos/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ descricao: novaDescricao, valor: novoValor, tipo: novoTipo })
  })

  await carregarLancamentos()
}

function toggleLista() {
  const wrapper = document.getElementById('lista-wrapper')
  const btn = document.getElementById('btn-toggle')
  const aberto = wrapper.style.display === 'block'
  wrapper.style.display = aberto ? 'none' : 'block'
  btn.textContent = aberto ? '▼ Ver lançamentos' : '▲ Ocultar lançamentos'
}

carregarLancamentos()