import {execFileSync} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const files=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
if(!files.length)throw new Error('Prepara primero el índice Git para revisar los archivos.');
const forbidden=files.filter(p=>/(^|\/)(node_modules|dist|\.angular|coverage|release)(\/|$)/.test(p)||p.startsWith('evidence/local/')||/(^|\/)\.env(?:$|\.)/.test(p)&&p!=='.env.example'||/\.(log|pem|pfx|p12)$/i.test(p));
const envPath=resolve(root,'.env');
const localPassword=existsSync(envPath)?readFileSync(envPath,'utf8').match(/^DB_PASSWORD=(.+)$/m)?.[1].trim():undefined;
const findings=[];
for(const file of files){
 if(/\.(jpg|png)$/i.test(file))continue;
 // Se revisa exactamente el contenido preparado en el índice, no solo el archivo de trabajo.
 const content=execFileSync('git',['show',':'+file],{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024});
 if(localPassword&&localPassword.length>=16&&content.includes(localPassword))findings.push(file+': contraseña local');
 if(/gh[pousr]_[A-Za-z0-9]{24,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content))findings.push(file+': patrón de credencial');
}
if(forbidden.length||findings.length){console.error(JSON.stringify({forbidden,findings},null,2));process.exitCode=1;}
else console.log(`Revisión aprobada: ${files.length} archivos; sin archivos privados ni credenciales detectadas. La revisión por patrones no sustituye la inspección humana.`);
