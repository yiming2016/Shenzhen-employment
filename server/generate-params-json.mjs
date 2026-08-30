// 从核心参数表生成可部署的远程参数 JSON
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { DEFAULT_PARAMS } = require('../dist/core/engine.js');

const output = new URL('./policy-params.example.json', import.meta.url);
writeFileSync(output, JSON.stringify(DEFAULT_PARAMS, null, 2) + '\n', 'utf8');
console.log('已生成：' + output.pathname);
