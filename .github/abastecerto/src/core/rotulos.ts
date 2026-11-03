import type { Combustivel, PerfilUso, Selo } from './calculo';

/* Textos mostrados nas telas para os valores do motor. */

export const NOME_COMBUSTIVEL: Record<Combustivel, string> = {
  gasolina: 'Gasolina comum',
  etanol: 'Etanol',
  gasolina_aditivada: 'Gasolina aditivada',
  diesel_s10: 'Diesel S10',
  diesel_s500: 'Diesel S500',
  gnv: 'GNV',
};

/** Nome curto, para chips e frases ("abasteça com etanol"). */
export const NOME_CURTO: Record<Combustivel, string> = {
  gasolina: 'gasolina',
  etanol: 'etanol',
  gasolina_aditivada: 'aditivada',
  diesel_s10: 'diesel S10',
  diesel_s500: 'diesel S500',
  gnv: 'GNV',
};

/** Unidade do preço e do consumo: GNV é vendido por m³. */
export const unidade = (c: Combustivel) => (c === 'gnv' ? 'm³' : 'L');

/** Aviso no cadastro e na lista de postos quando o diesel S500 está escolhido. */
export const AVISO_S500 =
  'Veículos a diesel fabricados de 2012 em diante usam S10. O S500 é só para os mais antigos: num veículo novo, pode danificar o motor e o sistema de emissões.';

/** Combustíveis da lista de postos (todos os da pesquisa da ANP, menos GLP). */
export const COMBUSTIVEIS_POSTOS: Combustivel[] = ['gasolina', 'etanol', 'gasolina_aditivada', 'diesel_s10', 'diesel_s500', 'gnv'];

export const NOME_PERFIL: Record<PerfilUso, string> = { cidade: 'Mais na cidade', estrada: 'Mais na estrada', misto: 'Misto' };

export const TEXTO_SELO: Record<Selo, string> = {
  recente: 'Preço oficial recente',
  atencao: 'Atenção à data',
  antigo: 'Preço antigo, confirme',
};

/** "MOGI GUACU" → "Mogi Guacu" (a ANP grava em maiúsculas e sem acento). */
export function nomeProprio(texto: string): string {
  const minusculas = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'd']);
  return texto
    .toLowerCase()
    .split(' ')
    .map((p, i) => (i > 0 && minusculas.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ');
}

/** "12.3" → "12,3" (km/l com uma casa). */
export const kml = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** "0.708" → "70,8%". */
export const porcento = (v: number) => `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

/** Preço por litro com três casas quando houver (bombas mostram R$ 6,459). */
export const precoLitro = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}`;

/** "1,2 km" ou "850 m". */
export const distancia = (km: number) => (km < 1 ? `${Math.round(km * 100) * 10} m` : `${km.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`);

/** Bandeira para exibir: a ANP grava "BRANCA" (ou vazio) nos postos sem distribuidora exclusiva. */
export const nomeBandeira = (b: string) => (!b.trim() || /^BRANCA$/i.test(b.trim()) ? 'Bandeira branca' : nomeProprio(b));

/** "subiu R$ 0,12 (1,7%) na semana", "caiu R$ 0,03 (0,4%) na semana" ou "estável na semana". */
export function textoVariacao(v: { diferenca: number; percentual: number; sentido: 'subiu' | 'caiu' | 'estavel' }): string {
  if (v.sentido === 'estavel') return 'estável na semana';
  const reais = Math.abs(v.diferenca).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${v.sentido} R$ ${reais} (${porcento(Math.abs(v.percentual))}) na semana`;
}
