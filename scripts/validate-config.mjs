import { checkedConfig } from './config.mjs';
const c=await checkedConfig();console.log('Config PASS: '+c.sources.length+' explicit source mappings');
