// ============================================================================
// scripts/capturas.mjs — Saca las capturas de docs/resultados/diseno-*.png:
// la pantalla en reposo, tocando, terminada, con las secciones desplegadas, y
// la de medición. Sirve para ver de un vistazo si un cambio de diseño rompió
// algo. Requiere `npm run dev` corriendo.
// ============================================================================

import { chromium } from 'playwright';
import { BPM, tocarPieza } from './pieza-fija.mjs';
const S = 'docs/resultados/diseno-';
const b = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const p = await (await b.newContext({ acceptDownloads: true, viewport: { width: 1200, height: 900 } })).newPage();
p.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
await p.goto('http://localhost:5173/');
await p.waitForSelector('#chequeo:has-text("notas extraídas")', { timeout: 30000 });
await p.check('input[type=checkbox]');
await p.fill('input[type=number] >> nth=0', String(BPM));
await p.screenshot({ path: `${S}1-inicio.png`, fullPage: true });
const enCurso = tocarPieza(p);
await p.waitForSelector('#estado:has-text("tocando")', { timeout: 10000 });
await new Promise((r) => setTimeout(r, 7000));
await p.screenshot({ path: `${S}2-tocando.png`, fullPage: true });
await enCurso;
await p.waitForSelector('#estado:has-text("terminado")', { timeout: 15000 });
await p.screenshot({ path: `${S}3-terminado.png`, fullPage: true });
await p.locator('details').evaluateAll((l) => l.forEach((d) => { d.open = true; }));
await p.screenshot({ path: `${S}4-desplegado.png`, fullPage: true });
await p.click('#btn-vista-medicion');
await p.waitForTimeout(1500);
await p.screenshot({ path: `${S}5-medicion.png`, fullPage: true });
await b.close();
console.log('capturas listas');
