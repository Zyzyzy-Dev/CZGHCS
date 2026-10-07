// 开发期语法检查：遍历全部 src JS，不参与插件运行。
import { readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
let count=0;
async function check(url){for(const item of await readdir(url,{withFileTypes:true})){const child=new URL(item.name+(item.isDirectory()?'/':''),url);if(item.isDirectory())await check(child);else if(item.name.endsWith('.js')){execFileSync(process.execPath,['--check',fileURLToPath(child)],{stdio:'pipe'});count++;}}}
execFileSync(process.execPath,['--check',fileURLToPath(new URL('../index.js',import.meta.url))]);
await check(new URL('../src/',import.meta.url));
console.log(`PASS syntax: entry and ${count} source modules`);
