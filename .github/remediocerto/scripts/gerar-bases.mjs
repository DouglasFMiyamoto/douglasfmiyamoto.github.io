/*
 * Bases do Farmácia Popular para o app, publicadas no site (GitHub Pages), como os preços do
 * AbasteCerto. Baixa do gov.br:
 * - as listas de código de barras mais recentes (medicamentos, fraldas geriátricas, absorventes);
 * - a planilha das farmácias participantes.
 * E da Anvisa, a lista de preços da CMED (PMC): nome e códigos de barras de todos os remédios, para
 * preencher o cadastro lendo a caixa.
 * Grava <saída>/itens.json, <saída>/farmacias/<UF>.json, <saída>/cmed.json e, por último, <saída>/indice.json.
 * Sem mudança nas bases, não regrava nada (o robô do site não tem o que publicar).
 *
 * Uso: node scripts/gerar-bases.mjs <pasta de saída> [pasta com os arquivos já baixados]
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { dataDoArquivoCmed, lerListaCmed } from '../src/core/cmed.ts';
import { lerListaEan, lerPlanilhaFarmacias } from '../src/core/farmacia-popular.ts';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');

const [saida, locais] = process.argv.slice(2).map((p) => p && path.resolve(p));
if (!saida) throw new Error('Uso: node scripts/gerar-bases.mjs <pasta de saída> [pasta com os arquivos baixados]');

const BASE = 'https://www.gov.br/saude/pt-br/composicao/sectics/farmacia-popular';
const URL_FARMACIAS = `${BASE}/publicacoes/farmacias-participante-do-programa-farmacia-popular/@@download/file`;
const PAGINA_CMED = 'https://www.gov.br/anvisa/pt-br/assuntos/medicamentos/cmed/precos';
const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const LISTAS = [
  { tipo: 'medicamento', padrao: 'lista-de-medicamentos-ean' },
  { tipo: 'fralda', padrao: 'lista-de-fraldas-geriatricas-ean' },
  { tipo: 'absorvente', padrao: 'lista-de-absorventes?-higienicos-ean' },
];

async function baixar(url) {
  for (let tentativa = 1; ; tentativa++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'remediocerto-bases (github.com/douglasfmiyamoto)' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    } catch (e) {
      if (tentativa >= 3) throw new Error(`${url}: ${e.message}`);
      await new Promise((ok) => setTimeout(ok, 5000 * tentativa));
    }
  }
}

/** A lista mais recente de cada tipo, pela página de códigos de barras do ano (e do anterior). */
async function listasMaisRecentes() {
  const ano = new Date().getFullYear();
  const achadas = [];
  for (const a of [ano, ano - 1]) {
    const html = new TextDecoder().decode(await baixar(`${BASE}/codigos-de-barras/${a}`).catch(() => new Uint8Array()));
    for (const m of html.matchAll(/codigos-de-barras\/\d{4}\/(lista-de-[a-z-]+-ean-([a-z]+)-(\d{4})\.pdf)/g)) {
      achadas.push({ arquivo: m[1], ordem: Number(m[3]) * 100 + MESES.indexOf(m[2]), pasta: m[0].split('/')[1] });
    }
  }
  return LISTAS.map((l) => {
    const re = new RegExp(`^${l.padrao}-`);
    const melhor = achadas.filter((x) => re.test(x.arquivo) && x.ordem % 100 >= 0).sort((a, b) => b.ordem - a.ordem)[0];
    if (!melhor) throw new Error(`Nenhuma lista encontrada para ${l.tipo}`);
    return { ...l, arquivo: melhor.arquivo, url: `${BASE}/codigos-de-barras/${melhor.pasta}/${melhor.arquivo}/@@download/file` };
  });
}

async function linhasDoPdf(dados) {
  const doc = await getDocument({ data: dados, useSystemFonts: true, isEvalSupported: false }).promise;
  const linhas = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const { items } = await (await doc.getPage(p)).getTextContent();
    const porY = new Map();
    for (const it of items) {
      if (!it.str?.trim()) continue;
      const y = Math.round(it.transform[5]);
      if (!porY.has(y)) porY.set(y, []);
      porY.get(y).push({ x: Math.round(it.transform[4]), s: it.str });
    }
    for (const [y, celulas] of porY) linhas.push({ pagina: p, y, celulas: celulas.sort((a, b) => a.x - b.x) });
  }
  return linhas.sort((a, b) => a.pagina - b.pagina || b.y - a.y);
}

const ler = (arquivo) => (locais && fs.existsSync(path.join(locais, arquivo)) ? new Uint8Array(fs.readFileSync(path.join(locais, arquivo))) : null);

/* ---------- Itens ---------- */

const listas = await listasMaisRecentes();
const itens = [];
const fontes = {};
for (const l of listas) {
  const dados = ler(l.arquivo) ?? (await baixar(l.url));
  const lidos = lerListaEan(await linhasDoPdf(dados), l.tipo);
  if (lidos.length === 0) throw new Error(`${l.arquivo}: nenhum item lido (o formato mudou?)`);
  console.log(`${l.arquivo}: ${lidos.length} itens, ${lidos.reduce((s, i) => s + i.eans.length, 0)} códigos`);
  fontes[l.tipo] = l.arquivo.replace(/\.pdf$/, '');
  itens.push(...lidos);
}
if (itens.filter((i) => i.tipo === 'medicamento').length < 20) throw new Error('Poucos medicamentos lidos: o formato da lista mudou?');

/* ---------- Farmácias ---------- */

const planilha = XLSX.read(ler('farmacias.xlsx') ?? (await baixar(URL_FARMACIAS)));
const linhasPlanilha = XLSX.utils.sheet_to_json(planilha.Sheets[planilha.SheetNames[0]], { header: 1, raw: false, defval: '' });
const farmacias = lerPlanilhaFarmacias(linhasPlanilha);
const total = Object.values(farmacias.porUf).reduce((s, l) => s + l.length, 0);
if (total < 10_000) throw new Error(`Só ${total} farmácias lidas: o formato da planilha mudou?`);
console.log(`Farmácias de ${farmacias.data}: ${total} em ${Object.keys(farmacias.porUf).length} UFs`);

/* ---------- CMED (Anvisa) ---------- */

const htmlCmed = new TextDecoder().decode(await baixar(PAGINA_CMED));
const arquivoCmed = [...htmlCmed.matchAll(/arquivos\/(lista_pmc[^"'\/?#]*\.xlsx?)/gi)].map((m) => m[1]).sort().pop();
if (!arquivoCmed) throw new Error('Lista PMC da CMED não encontrada na página');
const planilhaCmed = XLSX.read(ler('cmed.xlsx') ?? (await baixar(`${PAGINA_CMED}/arquivos/${arquivoCmed}/@@download/file`)));
const abaCmed = planilhaCmed.SheetNames.find((n) => /lista/i.test(n)) ?? planilhaCmed.SheetNames.at(-1);
const produtosCmed = lerListaCmed(XLSX.utils.sheet_to_json(planilhaCmed.Sheets[abaCmed], { header: 1, defval: '' }));
if (produtosCmed.length < 10_000) throw new Error(`Só ${produtosCmed.length} produtos na CMED: o formato mudou?`);
const dataCmed = dataDoArquivoCmed(arquivoCmed);
console.log(`CMED ${arquivoCmed}: ${produtosCmed.length} apresentações`);

/* ---------- Gravação (só o que mudou; o índice por último) ---------- */

let mudou = false;
const gravar = (arquivo, conteudo) => {
  const destino = path.join(saida, arquivo);
  const texto = JSON.stringify(conteudo);
  if (fs.existsSync(destino) && fs.readFileSync(destino, 'utf8') === texto) return texto;
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, texto);
  mudou = true;
  return texto;
};
const resumo = (texto) => createHash('sha256').update(texto).digest('hex').slice(0, 12);

const textoItens = gravar('itens.json', { fontes, itens });
const textoCmed = gravar('cmed.json', { data: dataCmed, produtos: produtosCmed });
const ufs = {};
for (const [uf, lista] of Object.entries(farmacias.porUf).sort()) {
  const texto = gravar(`farmacias/${uf}.json`, { data: farmacias.data, farmacias: lista });
  ufs[uf] = { quantidade: lista.length, versao: resumo(texto) };
}
// UF que saiu da lista (não deve acontecer): apaga o arquivo velho.
for (const arquivo of fs.existsSync(path.join(saida, 'farmacias')) ? fs.readdirSync(path.join(saida, 'farmacias')) : []) {
  if (!ufs[arquivo.replace(/\.json$/, '')]) {
    fs.rmSync(path.join(saida, 'farmacias', arquivo));
    mudou = true;
  }
}

if (mudou || !fs.existsSync(path.join(saida, 'indice.json'))) {
  fs.writeFileSync(
    path.join(saida, 'indice.json'),
    JSON.stringify({ itens: { fontes, quantidade: itens.length, versao: resumo(textoItens) }, farmacias: { data: farmacias.data, ufs }, cmed: { data: dataCmed, quantidade: produtosCmed.length, versao: resumo(textoCmed) }, geradoEm: new Date().toISOString() }),
  );
  console.log(`Bases gravadas em ${saida}`);
} else {
  console.log('Nada mudou.');
}
