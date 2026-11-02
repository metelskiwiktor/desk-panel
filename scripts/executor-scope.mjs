// Deterministic fix scope gate; tree snapshots survive Cezar autosave commits.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname, posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readBase } from './executor-commit.mjs';

const STATE = '.ai/implementation-scope.json';
const IMPORT_RE = /(?:\bfrom|\bimport)\s*['"]([^'"]+)['"]|(?:\bimport|\brequire)\s*\(\s*['"]([^'"]+)['"]/g;
const CANDIDATE_EXTS = ['', '.ts', '.tsx', '.mjs', '.js', '/index.ts', '/index.tsx', '/index.mjs', '/index.js'];

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

function resolveLocalImports(root, treeSha, filePath, treeFiles, statePathsSet, cache) {
  if (cache.has(filePath)) return cache.get(filePath);
  let text;
  try {
    text = git(root, ['show', treeSha + ':' + filePath]);
  } catch {
    cache.set(filePath, []);
    return [];
  }
  const resolved = [];
  for (const m of text.matchAll(IMPORT_RE)) {
    const spec = m[1] || m[2];
    if (!spec) continue;
    let target;
    if (spec.startsWith('./') || spec.startsWith('../') || spec === '.' || spec === '..') {
      target = posix.normalize(posix.join(dirname(filePath).replaceAll('\\', '/'), spec));
    } else if (spec.startsWith('@/')) {
      target = posix.normalize(posix.join('src', spec.slice(2)));
    } else {
      continue;
    }
    const targets = target.endsWith('.js') ? [target, target.slice(0, -3)] : [target];
    let matched = null;
    for (const t of targets) {
      for (const ext of CANDIDATE_EXTS) {
        const candidate = t + ext;
        if (treeFiles.has(candidate) || statePathsSet.has(candidate)) {
          matched = candidate;
          break;
        }
      }
      if (matched) break;
    }
    if (matched && !resolved.includes(matched)) resolved.push(matched);
  }
  cache.set(filePath, resolved);
  return resolved;
}

function reachesChanged(testPath, root, treeSha, treeFiles, statePathsSet, statePaths, cache) {
  if (statePathsSet.has(testPath)) return true;
  if (statePaths.some(s => s === testPath.replace(/\.test(?=\.)/, ''))) return true;
  const queue = [testPath];
  const visited = new Set([testPath]);
  while (queue.length > 0) {
    const current = queue.shift();
    const imports = resolveLocalImports(root, treeSha, current, treeFiles, statePathsSet, cache);
    for (const next of imports) {
      if (statePathsSet.has(next)) return true;
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

export function checkScope(root) {
  const state = JSON.parse(readFileSync(join(root,STATE),'utf8'));
  if (readBase(root).sha !== state.base) throw Error('fix: zmieniono przypiętą bazę');
  const failures = JSON.parse(readFileSync(join(root,'.ai/check-failures.json'),'utf8')).failures;
  const treeFiles = new Set(git(root, ['ls-tree', '-r', '--name-only', state.tree]).split('\n').filter(Boolean));
  const statePathsSet = new Set(state.paths);
  const importCache = new Map();

  const failingTestFiles = [...new Set(failures.map(f => posix.normalize(f.path.replaceAll('\\', '/'))))]
    .filter(p => /\.test\.[cm]?[jt]sx?$/.test(p));
  const exceptions = failingTestFiles.filter(p =>
    reachesChanged(p, root, state.tree, treeFiles, statePathsSet, state.paths, importCache)
  );

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
