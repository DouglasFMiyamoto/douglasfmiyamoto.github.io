/*
 * Processamento semanal dos preços da ANP (especificação, seção 7). Acha a semana mais recente na
 * página "últimas semanas pesquisadas", baixa o arquivo por posto e grava um JSON por estado mais um
 * índice. Usa o leitor testado em src/core/lpc.ts (o Node 24 roda TypeScript direto).
 *
 * Uso: node scripts/gerar-precos.mjs [pasta de saída]   (padrão: ./saida-precos)
 * Se a semana do índice já for a mais recente, não faz nada (pode rodar todo dia).
 */
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';

import { read, utils } from 'xlsx';

import { lerLpc, semanaDoArquivo } from '../src/core/lpc.ts';

const PAGINA =
  'https://www.gov.br/anp/pt-br/assuntos/precos-e-defesa-da-concorrencia/precos/levantamento-de-precos-de-combustiveis-ultimas-semanas-pesquisadas';
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; AbasteCerto/1.0; +https://douglasfmiyamoto.github.io/abastecerto/)' };
const saida = path.resolve(process.argv[2] ?? 'saida-precos');

const html = await (await fetch(PAGINA, { headers: UA })).text();
const links = [...html.matchAll(/href="([^"]*revendas_lpc_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})\.xlsx)"/g)];
if (!links.length) throw new Error('Nenhum arquivo revendas_lpc_*.xlsx na página da ANP: o endereço ou o formato mudou?');
const [, url, , fim] = links.sort((a, b) => b[3].localeCompare(a[3]))[0];
const semana = semanaDoArquivo(url);

const arquivoIndice = path.join(saida, 'indice.json');
const jaFeita = fs.existsSync(arquivoIndice) && JSON.parse(fs.readFileSync(arquivoIndice, 'utf8')).semana?.fim === fim;
// Sem process.exit: no Windows, sair com o fetch ainda aberto derruba o Node (assert do libuv).
if (jaFeita) console.log(`Semana ${semana.inicio} a ${semana.fim} já processada.`);
else await processar();

async function processar() {
  const resposta = await fetch(url, { headers: UA });
  if (!resposta.ok) throw new Error(`Download falhou (${resposta.status}): ${url}`);
  const planilha = read(Buffer.from(await resposta.arrayBuffer()), { type: 'buffer' });
  const linhas = utils.sheet_to_json(planilha.Sheets[planilha.SheetNames[0]], { header: 1, defval: '' });
  const arquivos = lerLpc(linhas, semana);
  const ufs = Object.keys(arquivos).sort();
  if (ufs.length < 20) throw new Error(`Só ${ufs.length} estados no arquivo: algo mudou, mantendo a semana anterior.`);
  fs.mkdirSync(saida, { recursive: true });
  const indice = { semana, geradoEm: new Date().toISOString(), fonte: url, ufs: {} };
  for (const uf of ufs) {
    const json = JSON.stringify(arquivos[uf]);
    fs.writeFileSync(path.join(saida, `${uf}.json`), json);
    indice.ufs[uf] = { postos: arquivos[uf].postos.length, bytes: Buffer.byteLength(json) };
  }
  // O índice por último: quem lê só vê a semana nova quando todos os estados já foram gravados.
  fs.writeFileSync(arquivoIndice, JSON.stringify(indice, null, 1));
  const total = ufs.reduce((s, uf) => s + indice.ufs[uf].postos, 0);
  console.log(`Semana ${semana.inicio} a ${semana.fim}: ${total} postos em ${ufs.length} estados → ${saida}`);
}
