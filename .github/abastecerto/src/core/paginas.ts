import { variacaoSemanal, type Combustivel } from './calculo.ts';
import type { ArquivoEstado, Media, PostoPesquisado } from './lpc.ts';
import { COMBUSTIVEIS_POSTOS, NOME_COMBUSTIVEL, nomeBandeira, nomeProprio, porcento, precoLitro, unidade } from './rotulos.ts';

/*
 * Páginas do site com os preços de cada cidade pesquisada pela ANP ("posto mais barato em ..."), para
 * quem procura no Google. Geradas toda semana pelo script scripts/gerar-paginas.mjs, sem data de
 * geração no HTML: se a semana não mudou, o arquivo sai igual e o robô não publica nada.
 * Extensões .ts nos imports: o Node roda este arquivo direto, sem compilar.
 */

export const SITE = 'https://douglasfmiyamoto.github.io';
export const BASE = '/abastecerto/postos/';
const BAIXAR = '/abastecerto/baixar/';
const POR_COMBUSTIVEL = 10;
/** Médias com menos postos que isso não entram na comparação etanol × gasolina. */
const POSTOS_MINIMOS = 3;

/** "UF" → { "SAO PAULO": "São Paulo" }: nomes do IBGE com acento (a ANP grava sem). */
export type NomesIbge = Record<string, Record<string, string>>;

export const NOME_UF: Record<string, string> = {
  AC: 'Acre', AL: 'Alagoas', AM: 'Amazonas', AP: 'Amapá', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal',
  ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MG: 'Minas Gerais', MS: 'Mato Grosso do Sul', MT: 'Mato Grosso',
  PA: 'Pará', PB: 'Paraíba', PE: 'Pernambuco', PI: 'Piauí', PR: 'Paraná', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte',
  RO: 'Rondônia', RR: 'Roraima', RS: 'Rio Grande do Sul', SC: 'Santa Catarina', SE: 'Sergipe', SP: 'São Paulo', TO: 'Tocantins',
};

const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** "São João del-Rei" → "sao-joao-del-rei". */
export const slug = (t: string) =>
  semAcento(t)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export const nomeCidade = (uf: string, municipio: string, nomes: NomesIbge) => nomes[uf]?.[municipio] ?? nomeProprio(municipio);

export const urlCidade = (uf: string, municipio: string) => `${BASE}${uf.toLowerCase()}/${slug(municipio)}/`;
export const urlEstado = (uf: string) => `${BASE}${uf.toLowerCase()}/`;

export const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const dia = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const periodo = (s: { inicio: string; fim: string }) => `${dia(s.inicio)} a ${dia(s.fim)}/${s.fim.slice(0, 4)}`;
const preco = (c: Combustivel, v: number) => `${precoLitro(v)}/${unidade(c)}`;
/** Na tabela, sem "R$" e sem unidade, para caber no celular: "6,36". */
const dinheiroLitro = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 });

/** Postos que têm o combustível, do mais barato ao mais caro (no empate, a coleta mais recente). */
export function maisBaratos(postos: PostoPesquisado[], c: Combustivel, limite = POR_COMBUSTIVEL) {
  return postos
    .flatMap((p) => {
      const x = p.precos[c];
      return x ? [{ posto: p, valor: x.v, data: x.d }] : [];
    })
    .sort((a, b) => a.valor - b.valor || b.data.localeCompare(a.data))
    .slice(0, limite);
}

/** "▲ 0,12" / "▼ 0,03" / "estável" / "" (sem semana anterior comparável). */
function celulaVariacao(m: Media, anterior: Media | undefined) {
  const v = variacaoSemanal({ media: m.media, postos: m.n, mediaAnterior: anterior?.media ?? null, postosAnterior: anterior?.n ?? null });
  if (!v) return '<span class="sub">–</span>';
  if (v.sentido === 'estavel') return '<span class="sub">estável</span>';
  const reais = Math.abs(v.diferenca).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v.sentido === 'subiu' ? `<span class="subiu">▲ ${reais}</span>` : `<span class="caiu">▼ ${reais}</span>`;
}

/** Frase do etanol × gasolina pelas médias, sem prometer o que só o consumo do carro responde. */
export function textoEtanol(local: string, medias: Partial<Record<Combustivel, Media>>): string | null {
  const g = medias.gasolina;
  const e = medias.etanol;
  if (!g || !e || g.n < POSTOS_MINIMOS || e.n < POSTOS_MINIMOS) return null;
  const r = e.media / g.media;
  const regra = r < 0.7 ? 'pela regra dos 70%, o etanol compensaria' : 'pela regra dos 70%, a gasolina compensaria';
  return (
    `Em ${local}, o etanol custa em média ${porcento(r)} do preço da gasolina: ${regra}. Mas a regra é só uma média: o ` +
    'rendimento do etanol muda de carro para carro, e o ponto em que ele deixa de compensar também. O ' +
    'AbasteCerto faz a conta com o consumo do seu carro.'
  );
}

function tabelaMedias(medias: Partial<Record<Combustivel, Media>>, anteriores: Partial<Record<Combustivel, Media>> | undefined, estado?: Partial<Record<Combustivel, Media>>) {
  const linhas = COMBUSTIVEIS_POSTOS.filter((c) => medias[c]).map((c) => {
    const m = medias[c] as Media;
    const uf = estado?.[c];
    return (
      `<tr><th scope="row">${NOME_COMBUSTIVEL[c].replace(' comum', '')}</th><td><strong>${dinheiroLitro(m.media)}</strong></td><td>${celulaVariacao(m, anteriores?.[c])}</td>` +
      `<td>${dinheiroLitro(m.min)}</td>${estado ? `<td>${uf ? dinheiroLitro(uf.media) : '–'}</td>` : ''}</tr>`
    );
  });
  return (
    '<div class="tabela"><table><thead><tr><th></th><th>Média</th><th>Semana</th><th>Menor</th>' +
    `${estado ? '<th>Estado</th>' : ''}</tr></thead><tbody>${linhas.join('')}</tbody></table></div>`
  );
}

const chamada = (texto: string) =>
  `<div class="chamada"><p>${texto}</p><a class="botao" href="${BAIXAR}">Baixar o AbasteCerto grátis</a></div>`;

function layout(p: { titulo: string; descricao: string; caminho: string; migalhas: [string, string | null][]; corpo: string }) {
  const url = SITE + p.caminho;
  const migalhas = p.migalhas.map(([nome, href]) => (href ? `<a href="${href}">${esc(nome)}</a>` : esc(nome))).join(' › ');
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.titulo)}</title>
<meta name="description" content="${esc(p.descricao)}">
<link rel="canonical" href="${url}">
<meta property="og:title" content="${esc(p.titulo)}">
<meta property="og:description" content="${esc(p.descricao)}">
<meta property="og:url" content="${url}">
<link rel="stylesheet" href="${BASE}estilo.css">
</head>
<body>
<main>
<nav class="migalhas">${migalhas}</nav>
${p.corpo}
<footer>
<p><strong>App independente:</strong> o AbasteCerto não representa a ANP nem nenhum órgão do governo. Os preços são os do Levantamento de Preços de Combustíveis da ANP, com a data da coleta, e podem ter mudado: confirme na bomba.</p>
<p><a href="/abastecerto/">Sobre o app e suporte</a> · <a href="/abastecerto/privacidade.html">Privacidade</a></p>
</footer>
</main>
</body>
</html>
`;
}

export function paginaCidade(arquivo: ArquivoEstado, municipio: string, nomes: NomesIbge): string {
  const { uf, semana } = arquivo;
  const cidade = nomeCidade(uf, municipio, nomes);
  const local = `${cidade} - ${uf}`;
  const medias = arquivo.medias.municipios[municipio] ?? {};
  const postos = arquivo.postos.filter((p) => p.municipio === municipio);
  const combustiveis = COMBUSTIVEIS_POSTOS.filter((c) => medias[c]);
  const menores = combustiveis
    .filter((c) => c === 'gasolina' || c === 'etanol' || c === 'diesel_s10')
    .map((c) => `${NOME_COMBUSTIVEL[c].replace(' comum', '').toLowerCase().replace('diesel s10', 'diesel S10')} a partir de ${precoLitro((medias[c] as Media).min)}`);
  const etanol = textoEtanol(cidade, medias);

  const listas = combustiveis.map((c) => {
    const itens = maisBaratos(postos, c).map(
      (x) =>
        `<li><span class="preco">${preco(c, x.valor)}</span> <strong>${esc(nomeProprio(x.posto.nome))}</strong><br>` +
        `<span class="sub">${esc(nomeProprio(x.posto.endereco))}${x.posto.bairro.trim() ? ` · ${esc(nomeProprio(x.posto.bairro))}` : ''} · ${esc(nomeBandeira(x.posto.bandeira))} · pesquisado em ${dia(x.data)}</span></li>`,
    );
    return `<h2>${NOME_COMBUSTIVEL[c]} mais ${c.startsWith('gasolina') ? 'barata' : 'barato'} em ${esc(cidade)}</h2><ol class="postos">${itens.join('')}</ol>`;
  });

  const vizinhas = Object.keys(arquivo.medias.municipios)
    .filter((m) => m !== municipio)
    .map((m) => [m, nomeCidade(uf, m, nomes)] as const)
    .sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))
    .map(([m, nome]) => `<a href="${urlCidade(uf, m)}">${esc(nome)}</a>`);

  const corpo = `<h1>Preço da gasolina, etanol e diesel em ${esc(local)}</h1>
<p class="sub">Pesquisa da ANP de ${periodo(semana)} · ${postos.length} ${postos.length === 1 ? 'posto pesquisado' : 'postos pesquisados'}</p>
${chamada(`No app: gasolina ou etanol para o <strong>seu</strong> carro, quanto você economiza no tanque cheio em cada posto, custo da viagem e média de consumo. Grátis para Android e iPhone.`)}
<h2>Médias da semana em ${esc(cidade)}</h2>
${tabelaMedias(medias, arquivo.anterior?.municipios[municipio], arquivo.medias.estado)}
<p class="sub">Em R$ por litro (GNV: por m³). "Semana": diferença para a média da semana anterior (só com pelo menos 3 postos pesquisados nas duas). "Estado": média de ${esc(NOME_UF[uf] ?? uf)}.</p>
${etanol ? `<h2>Etanol ou gasolina em ${esc(cidade)}?</h2><p>${esc(etanol)}</p>` : ''}
${listas.join('\n')}
${chamada('Veja estes postos no mapa, com a distância até você e a rota pelo Google Maps ou Waze, no AbasteCerto.')}
${vizinhas.length ? `<h2>Outras cidades de ${esc(NOME_UF[uf] ?? uf)}</h2><p class="cidades">${vizinhas.join(' ')}</p>` : ''}`;

  return layout({
    titulo: `Preço da gasolina, etanol e diesel em ${local}: postos mais baratos`,
    descricao: `Postos mais baratos de ${local} na pesquisa da ANP de ${periodo(semana)}${menores.length ? `: ${menores.join(', ')}` : ''}.`,
    caminho: urlCidade(uf, municipio),
    migalhas: [
      ['Brasil', BASE],
      [NOME_UF[uf] ?? uf, urlEstado(uf)],
      [cidade, null],
    ],
    corpo,
  });
}

export function paginaEstado(arquivo: ArquivoEstado, nomes: NomesIbge): string {
  const { uf, semana } = arquivo;
  const estado = NOME_UF[uf] ?? uf;
  const colunas: Combustivel[] = ['gasolina', 'etanol', 'diesel_s10'];
  const cidades = Object.entries(arquivo.medias.municipios)
    .map(([m, medias]) => ({ m, nome: nomeCidade(uf, m, nomes), medias }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
    .map(
      (c) =>
        `<tr><th scope="row"><a href="${urlCidade(uf, c.m)}">${esc(c.nome)}</a></th>` +
        colunas.map((x) => `<td>${c.medias[x] ? precoLitro((c.medias[x] as Media).media) : '–'}</td>`).join('') +
        '</tr>',
    );
  const etanol = textoEtanol(estado, arquivo.medias.estado);
  const corpo = `<h1>Preço dos combustíveis em ${esc(estado)}</h1>
<p class="sub">Pesquisa da ANP de ${periodo(semana)} · ${arquivo.postos.length} postos em ${cidades.length} ${cidades.length === 1 ? 'cidade' : 'cidades'}</p>
${chamada('No AbasteCerto: os postos da sua cidade com o preço pesquisado, a distância até você e quanto você economiza no tanque cheio.')}
<h2>Médias de ${esc(estado)} na semana</h2>
${tabelaMedias(arquivo.medias.estado, arquivo.anterior?.estado)}
<p class="sub">Em R$ por litro (GNV: por m³).</p>
${etanol ? `<p>${esc(etanol)}</p>` : ''}
<h2>Médias por cidade</h2>
<div class="tabela"><table><thead><tr><th>Cidade</th>${colunas.map((c) => `<th>${NOME_COMBUSTIVEL[c].replace(' comum', '')}</th>`).join('')}</tr></thead><tbody>${cidades.join('')}</tbody></table></div>`;
  return layout({
    titulo: `Preço da gasolina, etanol e diesel em ${estado} por cidade`,
    descricao: `Média dos combustíveis em ${estado} e em cada cidade pesquisada pela ANP de ${periodo(semana)}, com os postos mais baratos.`,
    caminho: urlEstado(uf),
    migalhas: [
      ['Brasil', BASE],
      [estado, null],
    ],
    corpo,
  });
}

export function paginaBrasil(arquivos: ArquivoEstado[]): string {
  const semana = arquivos[0]?.semana ?? { inicio: '', fim: '' };
  const colunas: Combustivel[] = ['gasolina', 'etanol', 'diesel_s10'];
  const linhas = [...arquivos]
    .sort((a, b) => (NOME_UF[a.uf] ?? a.uf).localeCompare(NOME_UF[b.uf] ?? b.uf, 'pt-BR'))
    .map(
      (a) =>
        `<tr><th scope="row"><a href="${urlEstado(a.uf)}">${esc(NOME_UF[a.uf] ?? a.uf)}</a></th>` +
        colunas.map((c) => `<td>${a.medias.estado[c] ? precoLitro((a.medias.estado[c] as Media).media) : '–'}</td>`).join('') +
        '</tr>',
    );
  const cidades = arquivos.reduce((s, a) => s + Object.keys(a.medias.municipios).length, 0);
  const corpo = `<h1>Preço dos combustíveis por estado e cidade</h1>
<p class="sub">Pesquisa da ANP de ${periodo(semana)} · ${cidades} cidades</p>
${chamada('Gasolina, etanol ou diesel: no AbasteCerto você vê o que compensa para o seu veículo e os postos mais baratos da sua cidade.')}
<div class="tabela"><table><thead><tr><th>Estado</th>${colunas.map((c) => `<th>${NOME_COMBUSTIVEL[c].replace(' comum', '')}</th>`).join('')}</tr></thead><tbody>${linhas.join('')}</tbody></table></div>`;
  return layout({
    titulo: 'Preço da gasolina, etanol e diesel por cidade: postos mais baratos',
    descricao: `Média dos combustíveis em cada estado e nas ${cidades} cidades da pesquisa semanal da ANP, com os postos mais baratos.`,
    caminho: BASE,
    migalhas: [['Brasil', null]],
    corpo,
  });
}

export function sitemap(caminhos: string[], ultimaMudanca: string): string {
  const urls = caminhos.map((c) => `<url><loc>${SITE}${c}</loc><lastmod>${ultimaMudanca}</lastmod></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export const ESTILO = `:root{--bg:#f6f6f5;--card:#fff;--text:#1f1f1e;--sub:#5c5c59;--border:#e2e2df;--accent:#c2410c;--subiu:#b91c1c;--caiu:#15803d}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--card:#20201f;--text:#ededeb;--sub:#a9a9a5;--border:#33332f;--accent:#fdba74;--subiu:#fca5a5;--caiu:#86efac}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{max-width:760px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:1.6rem;line-height:1.25;margin:8px 0}
h2{font-size:1.15rem;margin:32px 0 8px}
a{color:var(--accent);overflow-wrap:anywhere}
.sub{color:var(--sub);font-size:.92rem}
.migalhas{font-size:.9rem;color:var(--sub)}
.chamada{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px;margin:20px 0}
.chamada p{margin:0 0 12px}
.botao{display:inline-block;background:var(--accent);color:var(--bg);text-decoration:none;font-weight:600;padding:10px 16px;border-radius:10px}
.tabela{overflow-x:auto}
table{border-collapse:collapse;width:100%;background:var(--card);border:1px solid var(--border);border-radius:12px}
th,td{padding:8px 8px;text-align:left;border-bottom:1px solid var(--border);white-space:nowrap}
thead th{font-size:.85rem;color:var(--sub)}
tbody th{white-space:normal}
.subiu{color:var(--subiu)}
.caiu{color:var(--caiu)}
.postos{padding-left:24px}
.postos li{margin:10px 0}
.preco{font-weight:700;color:var(--accent)}
.cidades a{display:inline-block;margin:0 10px 6px 0}
footer{margin-top:40px;border-top:1px solid var(--border);padding-top:16px;font-size:.9rem;color:var(--sub)}
`;
