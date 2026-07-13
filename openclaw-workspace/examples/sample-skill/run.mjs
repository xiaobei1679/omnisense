// examples/sample-skill/run.mjs
// 最小可运行示例技能：读入一个词，输出问候。
// 运行：node examples/sample-skill/run.mjs openclaw
import { argv } from 'node:process';

const word = argv[2] || 'world';
console.log(`Hello, ${word}! (from sample-skill)`);
