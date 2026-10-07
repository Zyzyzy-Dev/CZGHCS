import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const servingRoot = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const host = `<!doctype html><html><head><meta charset="utf-8"><style>
body{--SmartThemeBorderColor:rgb(10,20,30);--SmartThemeBlurTintColor:rgb(25,30,40);--SmartThemeBodyColor:rgb(210,220,230);--mainFontFamily:Arial;--monoFontFamily:monospace}
input,textarea,button{font-size:55px!important;color:rgb(255,0,0)!important;background:rgb(255,255,0)!important}
</style></head><body><div id="extensions_menu"></div><input id="outside" value="host">
<script>const listeners={};window.saved=0;window.context={extensionSettings:{preset_compare_api_manager:{version:1,profiles:[{id:'p1',name:'测试方案',source:'custom',model:'model',secretId:'s1',connection:{custom_url:'https://example.org/v1'}}]}},eventTypes:{APP_READY:'ready',CHAT_COMPLETION_SETTINGS_READY:'request',GENERATION_STOPPED:'stop',CHAT_CHANGED:'chat'},eventSource:{on:(n,f)=>(listeners[n]??=[]).push(f)},saveSettingsDebounced:()=>window.saved++};window.SillyTavern={getContext:()=>context};</script>
<script type="module" src="/index.js"></script></body></html>`;
const server = http.createServer(async (req,res) => {
    if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(host);return;}
    if(req.url==='/script.js'){res.setHeader('Content-Type','text/javascript');res.end('export const getRequestHeaders=()=>({});export const stopGeneration=()=>{};');return;}
    const target=path.resolve(servingRoot,'.'+decodeURIComponent(req.url.split('?')[0]));
    if(!target.startsWith(servingRoot+path.sep)){res.writeHead(403).end();return;}
    try{res.setHeader('Content-Type',target.endsWith('.js')?'text/javascript':target.endsWith('.css')?'text/css':'text/html');res.end(await fs.readFile(target));}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE ? {executablePath:process.env.BROWSER_EXECUTABLE} : {})});
 const page=await browser.newPage({viewport:{width:1100,height:900}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.locator('#czgh-planner-menu').click();
 const frame=page.frameLocator('iframe');
 await frame.getByRole('heading',{name:'创作规划'}).waitFor();
 await frame.locator('input[type=checkbox]').check();
 await page.waitForFunction(()=>context.extensionSettings.czgh_external_planner.enabled===true);
 const inner=await frame.locator('input[type=text]').first().evaluate(el=>({color:getComputedStyle(el).color,size:getComputedStyle(el).fontSize,background:getComputedStyle(el).backgroundColor}));
 assert.equal(inner.color,'rgb(210, 220, 230)');assert.notEqual(inner.size,'55px');
 assert.equal(await page.locator('#outside').evaluate(el=>getComputedStyle(el).color),'rgb(255, 0, 0)');
 await frame.locator('select').first().selectOption('p1');
 await page.waitForFunction(()=>context.extensionSettings.czgh_external_planner.profileId==='p1');
 assert.equal(await frame.locator('input[type=password]').isDisabled(),true);
 await page.evaluate(()=>document.body.style.setProperty('--SmartThemeBodyColor','rgb(180,190,200)'));
 await page.waitForTimeout(1100);
 assert.equal(await frame.locator('input[type=text]').first().evaluate(el=>getComputedStyle(el).color),'rgb(180, 190, 200)');
 if (process.env.SCREENSHOT_DIR) await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,'iframe-desktop.png')});
 await page.setViewportSize({width:390,height:844});
 if (process.env.SCREENSHOT_DIR) await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,'iframe-mobile.png')});
 const bounds=await page.locator('iframe').boundingBox();assert.ok(bounds.width<=390);
 await frame.getByRole('button',{name:'关闭',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('dialog').open);
 assert.equal(await page.locator('dialog').evaluate(el=>el.open),false);
 assert.deepEqual(errors,[]);
 console.log('PASS browser: iframe CSS isolation, five-token theme update, settings bridge, API selection, close, mobile bounds; no page errors.');
}finally{await browser?.close();server.close();}
