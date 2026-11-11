// Resultados provisórios do LotoCerto: os números que o Douglas digita a partir da transmissão,
// enquanto a CAIXA não publica o oficial. O app lê lotocerto/provisorios.json.
//
//   node provisorio.mjs publicar <arquivo>   (LOTERIA, CONCURSO, DEZENAS no ambiente)
//   node provisorio.mjs remover <arquivo>    (LOTERIA, CONCURSO)
//   node provisorio.mjs verificar <arquivo>  compara com o oficial e tira o que já saiu
//
// Sem dependências: só Node 24.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const REGRAS = {
  megasena: { nome: 'Mega-Sena', sorteadas: 6, min: 1, max: 60 },
  lotofacil: { nome: 'Lotofácil', sorteadas: 15, min: 1, max: 25 },
  quina: { nome: 'Quina', sorteadas: 5, min: 1, max: 80 },
};
/** Provisórios mais velhos que isso saem do arquivo: o oficial já saiu há muito tempo. */
const DIAS_GUARDADOS = 4;

const [acao, arquivo] = process.argv.slice(2);
const env = process.env;

function falhar(msg) {
  console.error(`❌ ${msg}`);
  resumo(`### ❌ Não publicado\n\n${msg}`);
  process.exit(1);
}

function resumo(md) {
  console.log(md);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${md}\n`);
}

function hojeEmBrasilia() {
  return new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
}

function dataIso(br) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(br ?? '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function ler() {
  if (!existsSync(arquivo)) return { versao: 1, resultados: [] };
  return JSON.parse(readFileSync(arquivo, 'utf8'));
}

function gravar(dados) {
  const limite = new Date(Date.now() - DIAS_GUARDADOS * 86_400_000).toISOString().slice(0, 10);
  dados.resultados = dados.resultados
    .filter((r) => r.data >= limite)
    .sort((a, b) => a.modalidade.localeCompare(b.modalidade) || a.concurso - b.concurso);
  dados.atualizadoEm = new Date().toISOString();
  writeFileSync(arquivo, `${JSON.stringify(dados, null, 2)}\n`);
}

async function json(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** Último concurso oficial, na fonte que responder primeiro. `null` se nenhuma responder. */
async function ultimoOficial(m) {
  const fontes = [
    async () => {
      const j = await json(`https://loteriascaixa-api.herokuapp.com/api/${m}/latest`);
      return { concurso: j.concurso, proximo: j.proximoConcurso, dataProximo: dataIso(j.dataProximoConcurso) };
    },
    async () => {
      const j = await json(`https://servicebus2.caixa.gov.br/portaldeloterias/api/${m}`);
      return { concurso: j.numero, proximo: j.numeroConcursoProximo, dataProximo: dataIso(j.dataProximoConcurso) };
    },
    async () => {
      const j = await json(`https://api.guidi.dev.br/loteria/${m}/ultimo`);
      return { concurso: j.numero, proximo: j.numeroConcursoProximo, dataProximo: dataIso(j.dataProximoConcurso) };
    },
  ];
  for (const f of fontes) {
    try {
      const r = await f();
      if (Number.isInteger(r.concurso)) return r;
    } catch {
      // tenta a próxima
    }
  }
  return null;
}

/** Dezenas oficiais de um concurso; `null` se ainda não saiu ou nenhuma fonte respondeu. */
async function dezenasOficiais(m, concurso) {
  const fontes = [
    async () => (await json(`https://loteriascaixa-api.herokuapp.com/api/${m}/${concurso}`)).dezenas,
    async () => (await json(`https://servicebus2.caixa.gov.br/portaldeloterias/api/${m}/${concurso}`)).listaDezenas,
    async () => (await json(`https://api.guidi.dev.br/loteria/${m}/${concurso}`)).listaDezenas,
  ];
  for (const f of fontes) {
    try {
      const d = await f();
      if (Array.isArray(d) && d.length) return d.map(Number).sort((a, b) => a - b);
    } catch {
      // tenta a próxima
    }
  }
  return null;
}

function lerLoteria() {
  const m = (env.LOTERIA ?? '').trim();
  if (!REGRAS[m]) falhar(`Loteria inválida: "${m}". Use megasena, lotofacil ou quina.`);
  return m;
}

function lerDezenas(regra) {
  const texto = (env.DEZENAS ?? '').trim();
  const partes = texto.split(/[^0-9]+/).filter(Boolean);
  const dezenas = partes.map(Number);
  if (dezenas.length !== regra.sorteadas) {
    falhar(`A ${regra.nome} sorteia ${regra.sorteadas} números; você digitou ${dezenas.length} ("${texto}").`);
  }
  const fora = dezenas.filter((d) => d < regra.min || d > regra.max);
  if (fora.length) falhar(`Números fora de ${regra.min} a ${regra.max} na ${regra.nome}: ${fora.join(', ')}.`);
  const repetidos = dezenas.filter((d, i) => dezenas.indexOf(d) !== i);
  if (repetidos.length) falhar(`Número repetido: ${[...new Set(repetidos)].join(', ')}.`);
  return dezenas.sort((a, b) => a - b);
}

const fmt = (ds) => ds.map((d) => String(d).padStart(2, '0')).join(' ');

async function publicar() {
  const m = lerLoteria();
  const regra = REGRAS[m];
  const dezenas = lerDezenas(regra);
  const oficial = await ultimoOficial(m);
  const digitado = (env.CONCURSO ?? '').trim();
  let concurso = digitado ? Number(digitado) : null;
  if (digitado && !Number.isInteger(concurso)) falhar(`Concurso inválido: "${digitado}".`);

  if (oficial) {
    const esperado = oficial.proximo ?? oficial.concurso + 1;
    if (concurso === null) concurso = esperado;
    if (concurso <= oficial.concurso) {
      falhar(`O concurso ${concurso} da ${regra.nome} já tem resultado oficial (último oficial: ${oficial.concurso}).`);
    }
    if (concurso !== esperado) {
      falhar(`O próximo concurso da ${regra.nome} é o ${esperado}, não o ${concurso}. Confira o número.`);
    }
  } else if (concurso === null) {
    falhar('Não consegui consultar o último concurso oficial. Digite o número do concurso.');
  }

  const hoje = hojeEmBrasilia();
  if (oficial?.dataProximo && oficial.dataProximo > hoje) {
    const [a, mes, dia] = oficial.dataProximo.split('-');
    falhar(`O sorteio do concurso ${concurso} da ${regra.nome} é só em ${dia}/${mes}/${a}.`);
  }
  const data = oficial?.dataProximo ?? hoje;
  const dados = ler();
  dados.resultados = dados.resultados.filter((r) => !(r.modalidade === m && r.concurso === concurso));
  dados.resultados.push({ modalidade: m, concurso, data, dezenas, publicadoEm: new Date().toISOString() });
  gravar(dados);
  resumo(`### ✅ ${regra.nome} ${concurso} (provisório)\n\n**${fmt(dezenas)}**\n\nSorteio de ${data}. O app passa a mostrar em cerca de 2 minutos.`);
  if (!oficial) resumo('\n⚠️ Não deu para conferir o número do concurso com as APIs: confira se está certo.');
}

function remover() {
  const m = lerLoteria();
  const concurso = Number((env.CONCURSO ?? '').trim());
  const dados = ler();
  const antes = dados.resultados.length;
  dados.resultados = dados.resultados.filter((r) => !(r.modalidade === m && (!concurso || r.concurso === concurso)));
  if (dados.resultados.length === antes) falhar(`Não há provisório da ${REGRAS[m].nome}${concurso ? ` ${concurso}` : ''} para remover.`);
  gravar(dados);
  resumo(`### 🗑️ Removido: ${REGRAS[m].nome}${concurso ? ` ${concurso}` : ''}`);
}

async function verificar() {
  const dados = ler();
  const divergentes = [];
  const manter = [];
  for (const r of dados.resultados) {
    const oficial = await dezenasOficiais(r.modalidade, r.concurso);
    if (!oficial) {
      manter.push(r);
      continue;
    }
    if (fmt(oficial) === fmt(r.dezenas)) {
      resumo(`✅ ${REGRAS[r.modalidade].nome} ${r.concurso}: igual ao oficial.`);
    } else {
      divergentes.push(r);
      resumo(`❌ ${REGRAS[r.modalidade].nome} ${r.concurso}: digitado ${fmt(r.dezenas)}, oficial ${fmt(oficial)}.`);
    }
  }
  if (manter.length !== dados.resultados.length) {
    dados.resultados = manter;
    gravar(dados);
  }
  if (divergentes.length) {
    console.error('Algum provisório estava diferente do oficial. O app já usa o oficial; isto é só o aviso.');
    process.exitCode = 1;
  }
}

if (!arquivo) falhar('Faltou o caminho do arquivo.');
if (acao === 'publicar') await publicar();
else if (acao === 'remover') remover();
else if (acao === 'verificar') await verificar();
else falhar(`Ação desconhecida: ${acao}`);
