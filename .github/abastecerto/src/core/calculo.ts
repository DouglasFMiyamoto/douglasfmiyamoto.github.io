/*
 * Contas do AbasteCerto (especificação, seção 6). Dinheiro em reais arredondado a centavos só na
 * saída; km/l como vem (o app mostra com 1 casa).
 */

export type Combustivel = 'gasolina' | 'etanol' | 'gasolina_aditivada' | 'diesel_s10' | 'diesel_s500' | 'gnv';
export type PerfilUso = 'cidade' | 'estrada' | 'misto';

export interface ConsumoKmL {
  cidade: number;
  estrada: number;
}

/** Arredonda reais para centavos. */
export const centavos = (v: number) => Math.round(v * 100) / 100;

/**
 * km/l no perfil de uso. "Misto" usa a ponderação do Inmetro: 55% cidade e 45% estrada, em média
 * harmônica (o combustível gasto em cada trecho soma).
 */
export function kmPorLitro(c: ConsumoKmL, perfil: PerfilUso): number {
  if (perfil === 'cidade') return c.cidade;
  if (perfil === 'estrada') return c.estrada;
  return 1 / (0.55 / c.cidade + 0.45 / c.estrada);
}

export const custoPorKm = (preco: number, kml: number) => preco / kml;

export interface ResultadoFlex {
  melhor: 'gasolina' | 'etanol' | 'empate';
  custoKmGasolina: number;
  custoKmEtanol: number;
  /** Quanto se economiza a cada 100 km escolhendo o melhor (reais). */
  economia100Km: number;
  /** Quanto se economiza num tanque cheio do melhor (reais); null sem a capacidade do tanque. */
  economiaTanque: number | null;
  /** Até quanto o etanol pode custar, em relação à gasolina, para compensar neste carro (0,708 = 70,8%). */
  equilibrio: number;
  /** Preço do etanol ÷ preço da gasolina, hoje. */
  relacaoPrecos: number;
}

/** Gasolina ou etanol para este carro: o de menor custo por km (não a regra fixa dos 70%). */
export function compararFlex(p: {
  precoGasolina: number;
  precoEtanol: number;
  kmlGasolina: number;
  kmlEtanol: number;
  tanqueLitros?: number;
}): ResultadoFlex {
  const cg = custoPorKm(p.precoGasolina, p.kmlGasolina);
  const ce = custoPorKm(p.precoEtanol, p.kmlEtanol);
  const diferenca = Math.abs(cg - ce);
  // Menos de meio centavo a cada 100 km é empate na prática.
  const melhor = diferenca * 100 < 0.005 ? 'empate' : ce < cg ? 'etanol' : 'gasolina';
  const kmlMelhor = melhor === 'etanol' ? p.kmlEtanol : p.kmlGasolina;
  return {
    melhor,
    custoKmGasolina: cg,
    custoKmEtanol: ce,
    economia100Km: centavos(100 * diferenca),
    economiaTanque: p.tanqueLitros ? centavos(p.tanqueLitros * kmlMelhor * diferenca) : null,
    equilibrio: p.kmlEtanol / p.kmlGasolina,
    relacaoPrecos: p.precoEtanol / p.precoGasolina,
  };
}

/** Quanto rende um valor em reais: litros e autonomia. */
export function quantoRende(valor: number, preco: number, kml: number) {
  const litros = valor / preco;
  return { litros, autonomiaKm: litros * kml };
}

/** Custo para encher o tanque a partir do nível atual (fração de 0 a 1). */
export function encherTanque(capacidadeLitros: number, nivelAtual: number, preco: number) {
  const litros = capacidadeLitros * (1 - Math.min(Math.max(nivelAtual, 0), 1));
  return { litros, custo: centavos(litros * preco) };
}

export type Selo = 'recente' | 'atencao' | 'antigo';

/** Selo do preço pesquisado pela ANP, pelos dias desde a coleta (especificação, 6). */
export function seloDoPreco(dataColeta: string, hoje: string): { selo: Selo; dias: number } {
  const dias = Math.round((Date.parse(hoje) - Date.parse(dataColeta)) / 86_400_000);
  return { selo: dias <= 7 ? 'recente' : dias <= 14 ? 'atencao' : 'antigo', dias };
}
