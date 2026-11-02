/*
 * Processamento semanal dos preços da ANP (especificação, seção 7). Acha a semana mais recente na
 * página "últimas semanas pesquisadas", baixa o arquivo por posto e grava um JSON por estado mais um
 * índice. Baixa também a semana anterior, só para as médias da variação semanal. Usa o leitor
 * testado em src/core/lpc.ts (o Node 24 roda TypeScript direto).
 *
 * Uso: node scripts/gerar-precos.mjs [pasta de saída]   (padrão: ./saida-precos)
 * Se a semana do índice já for a mais recente, não faz nada (pode rodar todo dia). Se a semana
 * mais recente da página tiver mais de 16 dias, falha: a tarefa fica vermelha e o GitHub avisa por
 * e-mail (em 10/2026 a ANP mudou o nome dos arquivos e os preços ficaram parados sem ninguém ver).
 */
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';

import { read, utils } from 'xlsx';

import { arquivosDaPagina, juntarSemanaAnterior, lerLpc } from '../src/core/lpc.ts';

const PAGINA =
  'https://www.gov.br/anp/pt-br/assuntos/precos-e-defesa-da-concorrencia/precos/levantamento-de-precos-de-combustiveis-ultimas-semanas-pesquisadas';
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; AbasteCerto/1.0; +https://douglasfmiyamoto.github.io/abastecerto/)' };
const saida = path.resolve(process.argv[2] ?? 'saida-precos');
const DIAS_MAXIMOS = 16;

const html = await (await fetch(PAGINA, { headers: UA })).text();
const arquivos = arquivosDaPagina(html);
if (!arquivos.length) throw new Error('Nenhum arquivo revendas_lpc_*.xlsx na página da ANP: o endereço ou o formato mudou?');
const [atual, anterior] = arquivos;
const { semana } = atual;

const idade = (Date.now() - Date.parse(semana.fim)) / 86_400_000;
if (idade > DIAS_MAXIMOS) throw new Error(`A semana mais recente na página termina em ${semana.fim} (${Math.round(idade)} dias): a ANP mudou o formato?`);

const arquivoIndice = path.join(saida, 'indice.json');
const jaFeita = fs.existsSync(arquivoIndice) && JSON.parse(fs.readFileSync(arquivoIndice, 'utf8')).semana?.fim === semana.fim;
// Sem process.exit: no Windows, sair com o fetch ainda aberto derruba o Node (assert do libuv).
if (jaFeita) console.log(`Semana ${semana.inicio} a ${semana.fim} já processada.`);
else await processar();

async function baixar(url, s) {
  const resposta = await fetch(url, { headers: UA });
  if (!resposta.ok) throw new Error(`Download falhou (${resposta.status}): ${url}`);
  const planilha = read(Buffer.from(await resposta.arrayBuffer()), { type: 'buffer' });
  const linhas = utils.sheet_to_json(planilha.Sheets[planilha.SheetNames[0]], { header: 1, defval: '' });
  return lerLpc(linhas, s);
}

async function processar() {
  const porEstado = await baixar(atual.url, semana);
  const ufs = Object.keys(porEstado).sort();
  if (ufs.length < 20) throw new Error(`Só ${ufs.length} estados no arquivo: algo mudou, mantendo a semana anterior.`);
  // A semana anterior é só para a variação: se falhar, publica a atual sem ela.
  if (anterior) {
    try {
      juntarSemanaAnterior(porEstado, await baixar(anterior.url, anterior.semana));
    } catch (e) {
      console.warn(`Semana anterior (${anterior.semana.fim}) não lida, sem variação nesta semana: ${e.message}`);
    }
  }
  fs.mkdirSync(saida, { recursive: true });
  const indice = { semana, anterior: anterior?.semana ?? null, geradoEm: new Date().toISOString(), fonte: atual.url, ufs: {} };
  for (const uf of ufs) {
    const json = JSON.stringify(porEstado[uf]);
    fs.writeFileSync(path.join(saida, `${uf}.json`), json);
    indice.ufs[uf] = { postos: porEstado[uf].postos.length, bytes: Buffer.byteLength(json) };
  }
  // O índice por último: quem lê só vê a semana nova quando todos os estados já foram gravados.
  fs.writeFileSync(arquivoIndice, JSON.stringify(indice, null, 1));
  const total = ufs.reduce((s, uf) => s + indice.ufs[uf].postos, 0);
  console.log(`Semana ${semana.inicio} a ${semana.fim} (anterior: ${anterior?.semana.fim ?? 'nenhuma'}): ${total} postos em ${ufs.length} estados → ${saida}`);
}
