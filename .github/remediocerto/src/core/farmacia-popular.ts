/*
 * Bases oficiais do programa Farmácia Popular do Brasil (Ministério da Saúde), lidas no
 * processamento do site (scripts/gerar-bases.mjs) e usadas no app:
 * - listas de código de barras (EAN) em PDF: medicamentos, fraldas geriátricas e absorventes;
 * - planilha das farmácias participantes (CNPJ, razão social, endereço, bairro, município, UF).
 * Sem dependências: roda no Node (processamento) e no app.
 */

export type TipoItem = 'medicamento' | 'fralda' | 'absorvente';

export interface ItemPrograma {
  /** Nome normalizado, estável entre as listas (serve de id). */
  id: string;
  /** Como está na lista oficial. */
  nome: string;
  indicacao: string;
  tipo: TipoItem;
  eans: string[];
}

export interface Farmacia {
  cnpj: string;
  /** Razão social (a lista não traz o nome fantasia). */
  nome: string;
  endereco: string;
  bairro: string;
  municipio: string;
}

/** Sem acento, maiúsculas e espaços simples: para comparar e buscar. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/* ---------- Listas de código de barras (PDF) ---------- */

export interface Celula {
  x: number;
  s: string;
}
/** Uma linha do PDF: textos com a posição horizontal, na mesma altura (y) de uma página. */
export interface LinhaPdf {
  pagina: number;
  y: number;
  celulas: Celula[];
}

const EAN = /^\d{8,14}$/;
const CABECALHO = /^(PÁGINA \d+ DE \d+|LISTA DE|PRODUTO|INDICAÇÃO|CÓDIGO DE( BARRAS)?|BARRAS|MEDICAMENTOS|FRALDAS|GERIÁTRICAS|ABSORVENTES?|HIGIÊNICOS?)$/i;
/** O nome do produto fica na primeira coluna, colado à margem esquerda. */
const COLUNA_PRODUTO = 150;
/** Até onde (em pontos) uma linha solta pertence à linha do código vizinha (quebra de linha da indicação). */
const VIZINHANCA = 9;

/**
 * Lê as linhas de uma lista de EAN. Cada código tem uma linha com produto, indicação e código; quando
 * a indicação não cabe, ela quebra em duas linhas soltas, uma acima e outra abaixo da linha do código
 * (ex.: "DIABETES MELLITUS + DOENÇA" / "CARDIOVASCULAR"), que são juntadas de volta aqui.
 */
export function lerListaEan(linhas: LinhaPdf[], tipo: TipoItem): ItemPrograma[] {
  const uteis = linhas
    .map((l) => ({ ...l, celulas: l.celulas.filter((c) => c.s.trim() && !CABECALHO.test(c.s.trim())) }))
    .filter((l) => l.celulas.length > 0);
  const principais = uteis.filter((l) => l.celulas.some((c) => EAN.test(c.s.trim())));
  const soltas = uteis.filter((l) => !principais.includes(l));

  // Cada linha solta vai para a linha de código mais próxima da mesma página que esteja sem indicação
  // (é a que teve o texto quebrado).
  const semIndicacao = principais.filter((l) => !l.celulas.some((c) => c.x >= COLUNA_PRODUTO && !EAN.test(c.s.trim())));
  const anexas = new Map<LinhaPdf, LinhaPdf[]>();
  for (const s of soltas) {
    const dona = semIndicacao
      .filter((l) => l.pagina === s.pagina && Math.abs(l.y - s.y) <= VIZINHANCA)
      .sort((a, b) => Math.abs(a.y - s.y) - Math.abs(b.y - s.y))[0];
    if (dona) anexas.set(dona, [...(anexas.get(dona) ?? []), s]);
  }

  const porNome = new Map<string, ItemPrograma>();
  for (const l of principais) {
    const ean = l.celulas.find((c) => EAN.test(c.s.trim()))!.s.trim();
    const resto = l.celulas.filter((c) => !EAN.test(c.s.trim()));
    const vizinhas = (anexas.get(l) ?? []).sort((a, b) => b.y - a.y);
    const acima = vizinhas.filter((v) => v.y > l.y).flatMap((v) => v.celulas);
    const abaixo = vizinhas.filter((v) => v.y < l.y).flatMap((v) => v.celulas);
    const celulas = [...acima, ...resto, ...abaixo];
    const nome = juntar(celulas.filter((c) => c.x < COLUNA_PRODUTO));
    const indicacao = juntar(celulas.filter((c) => c.x >= COLUNA_PRODUTO));
    if (!nome) continue;
    const id = normalizar(nome);
    const item = porNome.get(id) ?? { id, nome, indicacao, tipo, eans: [] };
    if (!item.indicacao && indicacao) item.indicacao = indicacao;
    if (!item.eans.includes(ean)) item.eans.push(ean);
    porNome.set(id, item);
  }
  return [...porNome.values()];
}

const juntar = (cs: Celula[]) =>
  cs
    .map((c) => c.s.trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

/* ---------- Farmácias participantes (planilha) ---------- */

export interface ListaFarmacias {
  /** Data da lista (AAAA-MM-DD), da linha "Data : DD/MM/AAAA". */
  data: string | null;
  porUf: Record<string, Farmacia[]>;
}

/** Linhas da planilha (cada linha uma lista de textos). Acha o cabeçalho pelo "CNPJ". */
export function lerPlanilhaFarmacias(linhas: unknown[][]): ListaFarmacias {
  let data: string | null = null;
  let inicio = -1;
  for (let i = 0; i < linhas.length && inicio < 0; i++) {
    const primeira = String(linhas[i]?.[0] ?? '').trim();
    const m = /Data\s*:\s*(\d{2})\/(\d{2})\/(\d{4})/i.exec(primeira);
    if (m) data = `${m[3]}-${m[2]}-${m[1]}`;
    if (normalizar(primeira) === 'CNPJ') inicio = i + 1;
  }
  if (inicio < 0) throw new Error('Planilha das farmácias sem a linha de cabeçalho (CNPJ)');
  const porUf: Record<string, Farmacia[]> = {};
  const vistos = new Set<string>();
  for (const l of linhas.slice(inicio)) {
    const [cnpj, nome, endereco, bairro, municipio, uf] = (l ?? []).map((c) => String(c ?? '').replace(/\s+/g, ' ').trim());
    if (!cnpj || !/^[A-Z]{2}$/.test(uf ?? '') || !municipio) continue;
    const chave = `${cnpj}|${uf}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    (porUf[uf] ??= []).push({ cnpj, nome: nome ?? '', endereco: endereco ?? '', bairro: bairro ?? '', municipio });
  }
  for (const lista of Object.values(porUf)) {
    lista.sort((a, b) => a.municipio.localeCompare(b.municipio, 'pt-BR') || a.bairro.localeCompare(b.bairro, 'pt-BR') || a.nome.localeCompare(b.nome, 'pt-BR'));
  }
  return { data, porUf };
}

/* ---------- Uso no app ---------- */

/** Busca por nome ou indicação, sem acento. Vazio: todos. */
export function buscarItens(itens: ItemPrograma[], termo: string): ItemPrograma[] {
  const partes = normalizar(termo).split(' ').filter(Boolean);
  if (partes.length === 0) return itens;
  return itens.filter((i) => {
    const texto = `${i.id} ${normalizar(i.indicacao)}`;
    return partes.every((p) => texto.includes(p));
  });
}

/** Código lido na caixa. Leitores às vezes devolvem o EAN-13 com um zero à esquerda (UPC/GTIN-14). */
export function itemPorEan(itens: ItemPrograma[], codigo: string): ItemPrograma | undefined {
  const limpo = codigo.replace(/\D/g, '').replace(/^0+(?=\d{13}$)/, '');
  return itens.find((i) => i.eans.includes(limpo));
}

/** Municípios da UF com farmácias, em ordem. */
export function municipiosDe(farmacias: Farmacia[]): string[] {
  return [...new Set(farmacias.map((f) => f.municipio))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

/** "LOSARTANA POTÁSSICA 50MG" → "Losartana potássica 50 mg" (só para exibir). */
export function nomeLegivel(nome: string): string {
  const t = nome
    .toLowerCase()
    .replace(/(\d)(mg|mcg|ml|ui|g)\b/g, '$1 $2')
    .replace(/\bui\b/g, 'UI')
    .replace(/\s+/g, ' ')
    .trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** "ABADIA DE GOIÁS" → "Abadia de Goiás". */
export function nomeProprio(texto: string): string {
  const minusculas = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'd']);
  return texto
    .toLowerCase()
    .split(' ')
    .map((p, i) => (i > 0 && minusculas.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ');
}
