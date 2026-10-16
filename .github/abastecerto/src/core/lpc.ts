import type { Combustivel } from './calculo';

/*
 * Leitura do Levantamento de Preços de Combustíveis (LPC) da ANP: o arquivo semanal por posto
 * (`revendas_lpc_<início>_<fim>.xlsx`), já convertido em linhas (a primeira com "CNPJ" é o
 * cabeçalho). Sai um arquivo por estado, com o preço de cada posto, a data da coleta e as médias da
 * cidade e do estado. Usado pelo processamento semanal (scripts/gerar-precos.mjs) e testado no Jest.
 */

export interface PrecoColetado {
  /** Reais por litro (GNV: por m³). */
  v: number;
  /** Data da coleta, AAAA-MM-DD. */
  d: string;
}

export interface PostoPesquisado {
  cnpj: string;
  nome: string;
  endereco: string;
  bairro: string;
  cep: string;
  municipio: string;
  bandeira: string;
  precos: Partial<Record<Combustivel, PrecoColetado>>;
}

export interface Media {
  media: number;
  min: number;
  max: number;
  /** Postos pesquisados. */
  n: number;
}

export interface ArquivoEstado {
  uf: string;
  semana: { inicio: string; fim: string };
  postos: PostoPesquisado[];
  medias: {
    estado: Partial<Record<Combustivel, Media>>;
    municipios: Record<string, Partial<Record<Combustivel, Media>>>;
  };
}

const PRODUTOS: Record<string, Combustivel> = {
  'GASOLINA COMUM': 'gasolina',
  'GASOLINA ADITIVADA': 'gasolina_aditivada',
  ETANOL: 'etanol',
  'DIESEL S10': 'diesel_s10',
  'DIESEL S500': 'diesel_s500',
  GNV: 'gnv',
  // GLP (botijão de 13 kg) fica de fora: não é combustível de carro.
};

const UFS: Record<string, string> = {
  ACRE: 'AC', ALAGOAS: 'AL', AMAPA: 'AP', AMAZONAS: 'AM', BAHIA: 'BA', CEARA: 'CE', 'DISTRITO FEDERAL': 'DF',
  'ESPIRITO SANTO': 'ES', GOIAS: 'GO', MARANHAO: 'MA', 'MATO GROSSO': 'MT', 'MATO GROSSO DO SUL': 'MS',
  'MINAS GERAIS': 'MG', PARA: 'PA', PARAIBA: 'PB', PARANA: 'PR', PERNAMBUCO: 'PE', PIAUI: 'PI',
  'RIO DE JANEIRO': 'RJ', 'RIO GRANDE DO NORTE': 'RN', 'RIO GRANDE DO SUL': 'RS', RONDONIA: 'RO', RORAIMA: 'RR',
  'SANTA CATARINA': 'SC', 'SAO PAULO': 'SP', SERGIPE: 'SE', TOCANTINS: 'TO',
};

export class ErroLpc extends Error {}

/** Data do Excel (dias desde 30/12/1899) ou texto DD/MM/AAAA → AAAA-MM-DD. */
export function dataLpc(v: unknown): string {
  if (typeof v === 'number') return new Date(Date.UTC(1899, 11, 30) + v * 86_400_000).toISOString().slice(0, 10);
  const m = String(v).match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) throw new ErroLpc(`Data de coleta inválida: ${String(v)}`);
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** Semana do nome do arquivo: revendas_lpc_2026-10-04_2026-10-10.xlsx. */
export function semanaDoArquivo(nome: string): { inicio: string; fim: string } {
  const m = nome.match(/(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})/);
  if (!m) throw new ErroLpc(`Nome de arquivo sem a semana: ${nome}`);
  return { inicio: m[1], fim: m[2] };
}

const texto = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ');

function media(valores: number[]): Media {
  const soma = valores.reduce((a, b) => a + b, 0);
  return { media: Math.round((soma / valores.length) * 100) / 100, min: Math.min(...valores), max: Math.max(...valores), n: valores.length };
}

/** Linhas da planilha → um arquivo por estado (sigla). Falha alto se o formato mudar. */
export function lerLpc(linhas: unknown[][], semana: { inicio: string; fim: string }): Record<string, ArquivoEstado> {
  const iCab = linhas.findIndex((l) => l.some((c) => texto(c) === 'CNPJ'));
  if (iCab < 0) throw new ErroLpc('Cabeçalho com "CNPJ" não encontrado: o formato do arquivo da ANP mudou?');
  const cab = linhas[iCab].map(texto);
  const col = (nome: string) => {
    const i = cab.findIndex((c) => c.startsWith(nome));
    if (i < 0) throw new ErroLpc(`Coluna "${nome}" não encontrada: o formato do arquivo da ANP mudou?`);
    return i;
  };
  const c = {
    cnpj: col('CNPJ'), razao: col('RAZÃO'), fantasia: col('FANTASIA'), endereco: col('ENDEREÇO'), numero: col('NÚMERO'),
    bairro: col('BAIRRO'), cep: col('CEP'), municipio: col('MUNICÍPIO'), estado: col('ESTADO'), bandeira: col('BANDEIRA'),
    produto: col('PRODUTO'), preco: col('PREÇO'), data: col('DATA'),
  };

  const porUf: Record<string, Map<string, PostoPesquisado>> = {};
  for (const l of linhas.slice(iCab + 1)) {
    const combustivel = PRODUTOS[texto(l[c.produto])];
    const v = Number(l[c.preco]);
    if (!combustivel || !(v > 0)) continue;
    const uf = UFS[texto(l[c.estado])];
    if (!uf) throw new ErroLpc(`Estado desconhecido: ${texto(l[c.estado])}`);
    const cnpj = texto(l[c.cnpj]).replace(/\D/g, '').padStart(14, '0');
    const postos = (porUf[uf] ??= new Map());
    let posto = postos.get(cnpj);
    if (!posto) {
      const numero = texto(l[c.numero]);
      posto = {
        cnpj,
        nome: texto(l[c.fantasia]) || texto(l[c.razao]),
        endereco: [texto(l[c.endereco]), numero].filter(Boolean).join(', '),
        bairro: texto(l[c.bairro]),
        cep: texto(l[c.cep]).replace(/\D/g, '').padStart(8, '0'),
        municipio: texto(l[c.municipio]),
        bandeira: texto(l[c.bandeira]),
        precos: {},
      };
      postos.set(cnpj, posto);
    }
    const d = dataLpc(l[c.data]);
    const atual = posto.precos[combustivel];
    // Se o mesmo produto aparecer duas vezes, fica a coleta mais recente.
    if (!atual || d > atual.d) posto.precos[combustivel] = { v, d };
  }

  const arquivos: Record<string, ArquivoEstado> = {};
  for (const [uf, mapa] of Object.entries(porUf)) {
    const postos = [...mapa.values()].sort((a, b) => a.municipio.localeCompare(b.municipio) || a.nome.localeCompare(b.nome));
    const doEstado: Partial<Record<Combustivel, number[]>> = {};
    const porMunicipio: Record<string, Partial<Record<Combustivel, number[]>>> = {};
    for (const p of postos) {
      for (const [comb, preco] of Object.entries(p.precos) as [Combustivel, PrecoColetado][]) {
        (doEstado[comb] ??= []).push(preco.v);
        ((porMunicipio[p.municipio] ??= {})[comb] ??= []).push(preco.v);
      }
    }
    const medias = (m: Partial<Record<Combustivel, number[]>>) =>
      Object.fromEntries(Object.entries(m).map(([k, v]) => [k, media(v!)])) as Partial<Record<Combustivel, Media>>;
    arquivos[uf] = {
      uf,
      semana,
      postos,
      medias: { estado: medias(doEstado), municipios: Object.fromEntries(Object.entries(porMunicipio).map(([k, v]) => [k, medias(v)])) },
    };
  }
  return arquivos;
}
