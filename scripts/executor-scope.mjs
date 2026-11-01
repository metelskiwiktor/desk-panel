// Deterministic fix scope gate; tree snapshots survive Cezar autosave commits.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname, posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readBase } from './executor-commit.mjs';
const STATE = '.ai/implementation-scope.json';
function git(root, args, env = process.env) {
  return execFileSync('git', args, { cwd: root, env, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim();
}
function tree(root) {
  mkdirSync(join(root,'.ai'), { recursive: true });
  const index = resolve(root, '.ai/scope-index-' + process.pid);
  const env = { ...process.env, GIT_INDEX_FILE: index };
  try {
    git(root,['read-tree','HEAD'],env);
    git(root,['add','-A','--','.'],env);
    return git(root,['write-tree'],env);
  } finally { rmSync(index,{force:true}); }
}
export function saveScope(root) {
  const base = readBase(root).sha, snapshot = tree(root);
  const paths = git(root,['diff','--no-renames','--name-only',base,snapshot]).split('\n').filter(Boolean);
  writeFileSync(join(root,STATE),JSON.stringify({base,tree:snapshot,paths,tests:[]}));
}
export function checkScope(root) {
  const state = JSON.parse(readFileSync(join(root,STATE),'utf8'));
  if (readBase(root).sha !== state.base) throw Error('fix: zmieniono przypiętą bazę');
  const failures = JSON.parse(readFileSync(join(root,'.ai/check-failures.json'),'utf8')).failures;
  const exceptions = failures.map(f=>f.path).filter(p=>/\.test\.[cm]?[jt]sx?$/.test(p)).filter(p=>{
    if (state.paths.some(s=>s===p.replace(/\.test(?=\.)/,''))) return true;
    let text; try { text=git(root,['show',state.tree+':'+p]); } catch { return false; }
    return [...text.matchAll(/(?:from\s*|import\s*\(|require\s*\()['"](\.[^'"]+)['"]/g)].some(m=>{
      const imported=posix.normalize(posix.join(dirname(p).replaceAll('\\','/'),m[1]));
      return state.paths.some(s=>[imported, imported+'.ts', imported+'.tsx', imported+'.mjs', imported+'.js'].includes(s));
    });
  });
  const allowed = new Set([...state.paths,...state.tests,...exceptions]);
  const current = tree(root);
  const changed = git(root,['diff','--no-renames','--name-only',state.tree,current]).split('\n').filter(Boolean);
  const outside = changed.filter(p=>!allowed.has(p));
  if (outside.length) throw Error('fix zmienił pliki spoza zadania: '+outside.join(', '));
  state.tests=[...new Set([...state.tests,...exceptions])];
  writeFileSync(join(root,STATE),JSON.stringify(state));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv[2] === '--save') saveScope(process.cwd());
    else if (process.argv[2] === '--check') checkScope(process.cwd());
    else throw Error('Użycie: executor-scope.mjs --save|--check');
    console.log('executor-scope: OK');
  } catch(e) { console.error(e.message); process.exitCode=1; }
}
