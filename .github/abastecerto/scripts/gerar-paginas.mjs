/*
 * Páginas do site com os preços por cidade (uma por cidade pesquisada pela ANP, uma por estado, uma
 * do Brasil e o sitemap), a partir dos JSONs que o gerar-precos.mjs grava. Roda logo depois dele no
 * robô do site. O HTML não tem data de geração: sem semana nova, sai igual e não há o que publicar.
 *
 * Uso: node scripts/gerar-paginas.mjs <pasta dos preços> <pasta das páginas>
 * A pasta das páginas é refeita do zero (cidade que saiu da pesquisa deixa de ter página).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BASE, ESTILO, paginaBrasil, paginaCidade, paginaEstado, sitemap, urlCidade, urlEstado } from '../src/core/paginas.ts';

const [precos, saida] = process.argv.slice(2).map((p) => path.resolve(p));
if (!precos || !saida) throw new Error('Uso: node scripts/gerar-paginas.mjs <pasta dos preços> <pasta das páginas>');

const aqui = path.dirname(fileURLToPath(import.meta.url));
const nomes = JSON.parse(fs.readFileSync(path.join(aqui, 'dados', 'municipios-ibge.json'), 'utf8'));
const indice = JSON.parse(fs.readFileSync(path.join(precos, 'indice.json'), 'utf8'));
const arquivos = Object.keys(indice.ufs)
  .sort()
  .map((uf) => JSON.parse(fs.readFileSync(path.join(precos, `${uf}.json`), 'utf8')));

// Caminho do site (/abastecerto/postos/sp/campinas/) → arquivo dentro da pasta de saída.
const gravar = (caminho, html) => {
  const destino = path.join(saida, caminho.slice(BASE.length), 'index.html');
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, html);
};

fs.rmSync(saida, { recursive: true, force: true });
fs.mkdirSync(saida, { recursive: true });
fs.writeFileSync(path.join(saida, 'estilo.css'), ESTILO);

const caminhos = [BASE];
gravar(BASE, paginaBrasil(arquivos));
for (const arquivo of arquivos) {
  caminhos.push(urlEstado(arquivo.uf));
  gravar(urlEstado(arquivo.uf), paginaEstado(arquivo, nomes));
  const vistos = new Set();
  for (const municipio of Object.keys(arquivo.medias.municipios)) {
    const url = urlCidade(arquivo.uf, municipio);
    if (vistos.has(url)) throw new Error(`Duas cidades com o mesmo endereço: ${url}`);
    vistos.add(url);
    caminhos.push(url);
    gravar(url, paginaCidade(arquivo, municipio, nomes));
  }
}
fs.writeFileSync(path.join(saida, 'sitemap.xml'), sitemap(caminhos, indice.semana.fim));
console.log(`${caminhos.length} páginas (semana ${indice.semana.inicio} a ${indice.semana.fim}) → ${saida}`);
