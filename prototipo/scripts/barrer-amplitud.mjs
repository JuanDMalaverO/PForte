// scripts/barrer-amplitud.mjs — Prueba rápida: ¿cuánto mejora basic-pitch con
// el filtro de amplitud relativa? Corre la prueba sintética con ruido para
// varios valores y muestra exactos / recall / precisión. Requiere `npm run dev`.
import { chromium } from 'playwright';

const DIRECCION = process.env.URL ?? 'http://localhost:5173/';
const VALORES = (process.env.VALORES ?? '0,0.2,0.3,0.4,0.5').split(',');
const navegador = await chromium.launch({ headless: true, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=d3d11'] });
const pagina = await navegador.newPage();
await pagina.goto(DIRECCION);
await pagina.click('#btn-vista-medicion');
await pagina.waitForSelector('text=listo (backend', { timeout: 120000 });
for (const v of VALORES) {
  await pagina.fill('#amplitud-relativa', v);
  await pagina.click('#btn-sintetico-ruido');
  await pagina.waitForSelector('#resultado-sintetico', { state: 'attached', timeout: 300000 });
  const json = JSON.parse(await pagina.locator('#resultado-sintetico').textContent());
  const t = json.totales;
  const extras = json.filas.flatMap((f) => f.comparacion.extras).length;
  const faltantes = json.filas.flatMap((f) => f.comparacion.faltantes).length;
  console.log(`amplitud relativa ${v}: exactos ${t.acordesExactos}/${t.acordes}, recall ${t.recall}%, precisión ${t.precision}%, extras ${extras}, faltantes ${faltantes}`);
}
await navegador.close();
