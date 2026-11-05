/*
 * Lista de preços de medicamentos da CMED (Anvisa), a planilha "PMC": todos os remédios com preço
 * regulado no Brasil, com até três códigos de barras (EAN) por apresentação. Usada só para preencher o
 * nome no cadastro a partir do código lido na caixa (o preço não é usado). Sem dependências: roda no
 * Node (processamento do site) e no app.
 */

/** Sem acento, maiúsculas e espaços simples (cópia da de farmacia-popular: o Node do site importa este arquivo sozinho). */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** [códigos separados por espaço, produto, apresentação, substância]: compacto, o arquivo tem ~23 mil. */
export type ProdutoCmed = [eans: string, produto: string, apresentacao: string, substancia: string];

export interface ArquivoCmed {
  /** Data da lista (AAAA-MM-DD), tirada do nome do arquivo. */
  data: string | null;
  produtos: ProdutoCmed[];
}

const EAN = /^\d{8,14}$/;

/**
 * Linhas da aba "Lista PMC" (a primeira é o cabeçalho). Ficam de fora os de uso só em hospital. Os que
 * não foram vendidos no último ano ficam: a caixa pode estar no armário.
 */
export function lerListaCmed(linhas: unknown[][]): ProdutoCmed[] {
  const inicio = linhas.findIndex((l) => l.some((c) => normalizar(String(c ?? '')) === 'SUBSTANCIA'));
  if (inicio < 0) throw new Error('Lista da CMED sem o cabeçalho (SUBSTÂNCIA)');
  const cab = linhas[inicio].map((c) => normalizar(String(c ?? '')));
  const col = (nome: string) => {
    const i = cab.findIndex((c) => c.startsWith(nome));
    if (i < 0) throw new Error(`Lista da CMED sem a coluna ${nome}`);
    return i;
  };
  const [iSub, iEan, iProd, iApres, iHosp] = [col('SUBSTANCIA'), col('EAN 1'), col('PRODUTO'), col('APRESENTACAO'), col('RESTRICAO HOSPITALAR')];
  const texto = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
  const produtos: ProdutoCmed[] = [];
  for (const l of linhas.slice(inicio + 1)) {
    if (normalizar(texto(l[iHosp])) === 'SIM') continue;
    const eans = [l[iEan], l[iEan + 1], l[iEan + 2]].map(texto).filter((e) => EAN.test(e));
    const produto = texto(l[iProd]);
    if (eans.length === 0 || !produto) continue;
    produtos.push([eans.join(' '), produto, texto(l[iApres]), texto(l[iSub])]);
  }
  return produtos;
}

/** "lista_pmc__20261009_115232673.xlsx" → "2026-10-09". */
export function dataDoArquivoCmed(nome: string): string | null {
  const m = /_(\d{4})(\d{2})(\d{2})_/.exec(nome);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Código → produto, para ler várias caixas sem percorrer a lista toda. */
export function indiceCmed(produtos: ProdutoCmed[]): Map<string, ProdutoCmed> {
  const mapa = new Map<string, ProdutoCmed>();
  for (const p of produtos) for (const e of p[0].split(' ')) if (!mapa.has(e)) mapa.set(e, p);
  return mapa;
}

/** Código lido na caixa (aceita o EAN-13 com um zero à esquerda). */
export function produtoPorEan(indice: Map<string, ProdutoCmed>, codigo: string): ProdutoCmed | undefined {
  const limpo = codigo.replace(/\D/g, '').replace(/^0+(?=\d{13}$)/, '');
  return indice.get(limpo);
}

const UNIDADE = '(?:MG|MCG|G|UI|ML|%|MEQ)(?:\\/(?:ML|G|DOSE|GOTA|JATO|5 ?ML|ACIONAMENTO))?';
const NUMERO = '\\d+(?:[.,]\\d+)?';
/** Começo da apresentação com a dosagem: "50 MG", "(5 + 100) MG", "500 MG + 65 MG", "200 MG/ML". */
const DOSE = new RegExp(`^(\\(${NUMERO}(?:\\s*\\+\\s*${NUMERO})+\\)\\s*${UNIDADE}|${NUMERO}(?:\\s*\\+\\s*${NUMERO})*\\s*${UNIDADE}(?:\\s*\\+\\s*${NUMERO}\\s*${UNIDADE})*)`);

/** "500 MG + 65 MG COM CT BL…" → "500 mg + 65 mg". */
export function doseDa(apresentacao: string): string | null {
  const m = DOSE.exec(apresentacao.trim());
  if (!m) return null;
  return m[1]
    .toLowerCase()
    .replace(/(\d)\s*(mg|mcg|g|ui|ml|meq)\b/g, '$1 $2')
    .replace(/\bui\b/g, 'UI')
    .replace(/\s+/g, ' ');
}

/** Formas que se contam por unidade (para sugerir o estoque pela caixa). */
const CONTAVEIS = /\b(COM|CAP|DRG|COMP|CPR|PAST|SACHE|ENV|ADES|SUP|OVL|AMP|FA|SER)\b/;

/** "… COM REV CT BL AL PLAS X 30" → 30 (só comprimidos, cápsulas e afins; frascos e cremes não). */
export function unidadesDaCaixa(apresentacao: string): number | null {
  if (!CONTAVEIS.test(apresentacao)) return null;
  const m = /\bX\s*(\d+)\s*$/.exec(apresentacao.trim());
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n > 0 && n <= 1000 ? n : null;
}

const MINUSCULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'com']);

/** "BESILATO DE ANLODIPINO" → "Besilato de anlodipino"; marcas ("DORIL DC 500") → "Doril Dc 500". */
function nomeBonito(texto: string, marca: boolean): string {
  const minusculo = texto.toLowerCase();
  if (!marca) return minusculo.charAt(0).toUpperCase() + minusculo.slice(1);
  return minusculo
    .split(' ')
    .map((p, i) => (i > 0 && MINUSCULAS.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ');
}

/**
 * Nome sugerido no cadastro: o produto com a dosagem. Genérico ("LOSARTANA POTÁSSICA") fica em
 * minúsculas como substância; marca ("ARADOIS") ganha a substância entre parênteses.
 */
export function nomeParaCadastro(p: ProdutoCmed): string {
  const [, produto, apresentacao, substancia] = p;
  const subs = substancia.split(';').map((s) => s.trim()).filter(Boolean);
  // Genérico: cada substância tem alguma palavra no nome do produto ("DIPIRONA + CAFEÍNA" ↔ "CAFEÍNA ANIDRA").
  const palavrasProduto = new Set(normalizar(produto).split(/[^A-Z0-9]+/));
  const generico = subs.length > 0 && subs.every((s) => normalizar(s).split(/[^A-Z0-9]+/).some((w) => w.length >= 5 && palavrasProduto.has(w)));
  const dose = doseDa(apresentacao);
  const nome = nomeBonito(produto, !generico);
  const comDose = dose ? `${nome} ${dose}` : nome;
  if (generico || subs.length !== 1) return comDose;
  return `${comDose} (${subs[0].toLowerCase()})`;
}
