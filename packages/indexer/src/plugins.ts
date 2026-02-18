import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';
import Python from 'tree-sitter-python';
import TypeScript from 'tree-sitter-typescript';
import type { DataFlowRef, ImportRef, ParsePlugin, ParsedFile, SymbolRef } from './types.js';

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function nodeText(source: string, node: Parser.SyntaxNode): string {
  return source.slice(node.startIndex, node.endIndex);
}

function lineOf(node: Parser.SyntaxNode): number {
  return node.startPosition.row + 1;
}

function endLineOf(node: Parser.SyntaxNode): number {
  return node.endPosition.row + 1;
}

function walk(node: Parser.SyntaxNode, fn: (node: Parser.SyntaxNode) => void): void {
  fn(node);
  for (const child of node.namedChildren) {
    walk(child, fn);
  }
}

function extractMember(text: string): { object: string; field: string } | null {
  const cleaned = text.trim();
  const bracket = cleaned.match(/^([A-Za-z_$][\w$]*)\s*\[\s*['"]([A-Za-z0-9_$-]+)['"]\s*\]$/);
  if (bracket) {
    return { object: bracket[1], field: bracket[2] };
  }
  const dot = cleaned.match(/^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/);
  if (dot) {
    return { object: dot[1], field: dot[2] };
  }
  if (cleaned.includes('.')) {
    const parts = cleaned
      .replace(/[()[\]]/g, '')
      .split('.')
      .map((x) => x.trim())
      .filter(Boolean);
    if (parts.length >= 2) {
      return { object: parts[0], field: parts[parts.length - 1] };
    }
  }
  return null;
}

function collectMemberRefs(source: string, node: Parser.SyntaxNode): Array<{ object: string; field: string; line: number }> {
  const refs: Array<{ object: string; field: string; line: number }> = [];
  walk(node, (sub) => {
    const txt = nodeText(source, sub).trim();
    const member = extractMember(txt);
    if (!member) return;
    refs.push({ object: member.object, field: member.field, line: lineOf(sub) });
  });
  const seen = new Set<string>();
  return refs.filter((r) => {
    const key = `${r.object}:${r.field}:${r.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeFlows(flows: DataFlowRef[]): DataFlowRef[] {
  const seen = new Set<string>();
  const out: DataFlowRef[] = [];
  for (const flow of flows) {
    const key = `${flow.action}:${flow.object}:${flow.field}:${flow.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(flow);
  }
  return out;
}

function resolveImportSpec(repoRoot: string, relpath: string, spec: string): { resolvedRelpath: string | null; isExternal: boolean } {
  if (!spec.startsWith('./') && !spec.startsWith('../')) {
    return { resolvedRelpath: null, isExternal: true };
  }
  const dir = path.dirname(relpath);
  const base = path.join(dir, spec);
  const candidates = [
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.py`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.js'),
    path.join(base, '__init__.py'),
  ];
  for (const c of candidates) {
    const abs = path.resolve(repoRoot, c);
    if (abs.startsWith(path.resolve(repoRoot)) && path.extname(c) && pathExists(abs)) {
      return { resolvedRelpath: path.relative(repoRoot, abs).split(path.sep).join('/'), isExternal: false };
    }
  }
  return { resolvedRelpath: null, isExternal: false };
}

function pathExists(p: string): boolean {
  try {
    return !!fs.statSync(p);
  } catch {
    return false;
  }
}

class TSJSPlugin implements ParsePlugin {
  private parser = new Parser();

  supportedExtensions(): Set<string> {
    return new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
  }

  parseFile(repoRoot: string, relpath: string, text: string): ParsedFile {
    const ext = path.extname(relpath).toLowerCase();
    const language = ext === '.ts' || ext === '.tsx' ? 'typescript' : 'javascript';
    this.parser.setLanguage(ext === '.tsx' ? (TypeScript as any).tsx : ext === '.ts' ? (TypeScript as any).typescript : JavaScript as any);

    const tree = this.parser.parse(text);
    const root = tree.rootNode;

    const imports: ImportRef[] = [];
    const symbols: SymbolRef[] = [];

    walk(root, (node) => {
      if (node.type === 'import_statement') {
        const strNode = node.namedChildren.find((c) => c.type === 'string');
        if (!strNode) return;
        const raw = nodeText(text, strNode).replace(/["']/g, '').trim();
        const resolved = resolveImportSpec(repoRoot, relpath, raw);
        imports.push({ raw, resolvedRelpath: resolved.resolvedRelpath, isExternal: resolved.isExternal });
      }

      if (node.type === 'function_declaration' || node.type === 'method_definition') {
        const nameNode = node.childForFieldName('name') || node.namedChildren.find((c) => c.type === 'identifier' || c.type === 'property_identifier');
        if (!nameNode) return;
        const name = nodeText(text, nameNode);
        const kind = node.type === 'method_definition' ? 'Method' : 'Function';
        const qualname = kind === 'Method' ? inferMethodQualname(node, text, name) : name;
        const calls: SymbolRef['calls'] = [];
        const dataFlows: DataFlowRef[] = [];

        walk(node, (sub) => {
          if (sub.type === 'call_expression') {
            const fn = sub.childForFieldName('function');
            if (!fn) return;
            const callee = nodeText(text, fn).trim();
            calls.push({ callee, resolvedQualname: callee, line: lineOf(sub) });

            // Transform hint: argument member fields are touched by this call, but target is unclear.
            const argsNode = sub.childForFieldName('arguments');
            if (argsNode) {
              for (const mem of collectMemberRefs(text, argsNode)) {
                dataFlows.push({
                  object: mem.object,
                  field: mem.field,
                  action: 'TRANSFORM',
                  line: mem.line,
                  confidence: 0.62,
                  partialTrace: true,
                });
              }
            }
          }

          if (sub.type === 'assignment_expression' || sub.type === 'variable_declarator') {
            const lhs = sub.childForFieldName('left') || sub.childForFieldName('name');
            const rhs = sub.childForFieldName('right') || sub.childForFieldName('value');
            if (lhs) {
              const member = extractMember(nodeText(text, lhs));
              if (member) {
                dataFlows.push({
                  object: member.object,
                  field: member.field,
                  action: 'WRITE',
                  line: lineOf(sub),
                  confidence: 0.9,
                  partialTrace: false,
                });
              }
            }
            if (rhs) {
              const rhsMembers = collectMemberRefs(text, rhs);
              for (const member of rhsMembers) {
                dataFlows.push({
                  object: member.object,
                  field: member.field,
                  action: 'READ',
                  line: member.line,
                  confidence: 0.86,
                  partialTrace: false,
                });
              }

              // Assignment from call to member write indicates a probable transform.
              const lhsMember = lhs ? extractMember(nodeText(text, lhs)) : null;
              if (lhsMember && rhs.type === 'call_expression' && rhsMembers.length > 0) {
                dataFlows.push({
                  object: lhsMember.object,
                  field: lhsMember.field,
                  action: 'TRANSFORM',
                  line: lineOf(sub),
                  confidence: 0.78,
                  partialTrace: false,
                });
              }
            }
          }
        });

        const snippet = nodeText(text, node);
        symbols.push({
          kind,
          name,
          qualname,
          startLine: lineOf(node),
          endLine: endLineOf(node),
          signature: `${name}(...)`,
          visibility: 'public',
          symbolHash: sha256(snippet.trim()),
          calls,
          dataFlows: dedupeFlows(dataFlows),
        });
      }

      if (node.type === 'class_declaration') {
        const nameNode = node.childForFieldName('name') || node.namedChildren.find((c) => c.type === 'identifier');
        if (!nameNode) return;
        const name = nodeText(text, nameNode);
        const snippet = nodeText(text, node);
        symbols.push({
          kind: 'Class',
          name,
          qualname: name,
          startLine: lineOf(node),
          endLine: endLineOf(node),
          signature: `class ${name}`,
          visibility: 'public',
          symbolHash: sha256(snippet.trim()),
          calls: [],
          dataFlows: [],
        });
      }
    });

    return {
      relpath,
      language,
      imports,
      symbols,
    };
  }
}

function inferMethodQualname(node: Parser.SyntaxNode, source: string, methodName: string): string {
  let cur: Parser.SyntaxNode | null = node;
  while (cur) {
    if (cur.type === 'class_declaration') {
      const classNameNode = cur.childForFieldName('name') || cur.namedChildren.find((c) => c.type === 'identifier');
      if (classNameNode) {
        return `${nodeText(source, classNameNode)}.${methodName}`;
      }
    }
    cur = cur.parent;
  }
  return methodName;
}

class PythonPlugin implements ParsePlugin {
  private parser = new Parser();

  constructor() {
    this.parser.setLanguage(Python as any);
  }

  supportedExtensions(): Set<string> {
    return new Set(['.py']);
  }

  parseFile(repoRoot: string, relpath: string, text: string): ParsedFile {
    const tree = this.parser.parse(text);
    const root = tree.rootNode;

    const imports: ImportRef[] = [];
    const symbols: SymbolRef[] = [];

    walk(root, (node) => {
      if (node.type === 'import_statement' || node.type === 'import_from_statement') {
        const importText = nodeText(text, node).replace(/^import\s+|^from\s+/g, '').trim();
        const firstPart = importText.split(/\s+/)[0] || importText;
        const resolved = resolveImportSpec(repoRoot, relpath, firstPart.replace(/\./g, '/'));
        imports.push({ raw: firstPart, resolvedRelpath: resolved.resolvedRelpath, isExternal: resolved.isExternal });
      }

      if (node.type === 'function_definition') {
        const nameNode = node.childForFieldName('name') || node.namedChildren.find((c) => c.type === 'identifier');
        if (!nameNode) return;
        const name = nodeText(text, nameNode);
        const qualname = inferPythonQualname(node, text, name);

        const calls: SymbolRef['calls'] = [];
        const dataFlows: DataFlowRef[] = [];

        walk(node, (sub) => {
          if (sub.type === 'call') {
            const fn = sub.childForFieldName('function') || sub.namedChildren[0];
            if (!fn) return;
            const callee = nodeText(text, fn).trim();
            calls.push({ callee, resolvedQualname: callee, line: lineOf(sub) });

            const argsNode = sub.childForFieldName('arguments');
            if (argsNode) {
              for (const member of collectMemberRefs(text, argsNode)) {
                dataFlows.push({
                  object: member.object,
                  field: member.field,
                  action: 'TRANSFORM',
                  line: member.line,
                  confidence: 0.62,
                  partialTrace: true,
                });
              }
            }
          }

          if (sub.type === 'assignment') {
            const lhs = sub.childForFieldName('left') || sub.namedChildren[0];
            const rhs = sub.childForFieldName('right') || sub.namedChildren[1];
            if (lhs) {
              const member = extractMember(nodeText(text, lhs).trim());
              if (member) {
                dataFlows.push({
                  object: member.object,
                  field: member.field,
                  action: 'WRITE',
                  line: lineOf(sub),
                  confidence: 0.9,
                  partialTrace: false,
                });
              }
            }
            if (rhs) {
              const rhsMembers = collectMemberRefs(text, rhs);
              for (const member of rhsMembers) {
                dataFlows.push({
                  object: member.object,
                  field: member.field,
                  action: 'READ',
                  line: member.line,
                  confidence: 0.86,
                  partialTrace: false,
                });
              }

              const lhsMember = lhs ? extractMember(nodeText(text, lhs)) : null;
              if (lhsMember && rhs.type === 'call' && rhsMembers.length > 0) {
                dataFlows.push({
                  object: lhsMember.object,
                  field: lhsMember.field,
                  action: 'TRANSFORM',
                  line: lineOf(sub),
                  confidence: 0.78,
                  partialTrace: false,
                });
              }
            }
          }
        });

        const snippet = nodeText(text, node);
        symbols.push({
          kind: qualname.includes('.') ? 'Method' : 'Function',
          name,
          qualname,
          startLine: lineOf(node),
          endLine: endLineOf(node),
          signature: `${name}(...)`,
          visibility: 'public',
          symbolHash: sha256(snippet.trim()),
          calls,
          dataFlows: dedupeFlows(dataFlows),
        });
      }

      if (node.type === 'class_definition') {
        const nameNode = node.childForFieldName('name') || node.namedChildren.find((c) => c.type === 'identifier');
        if (!nameNode) return;
        const name = nodeText(text, nameNode);
        const snippet = nodeText(text, node);
        symbols.push({
          kind: 'Class',
          name,
          qualname: name,
          startLine: lineOf(node),
          endLine: endLineOf(node),
          signature: `class ${name}`,
          visibility: 'public',
          symbolHash: sha256(snippet.trim()),
          calls: [],
          dataFlows: [],
        });
      }
    });

    return {
      relpath,
      language: 'python',
      imports,
      symbols,
    };
  }
}

function inferPythonQualname(node: Parser.SyntaxNode, source: string, fnName: string): string {
  let cur: Parser.SyntaxNode | null = node.parent;
  while (cur) {
    if (cur.type === 'class_definition') {
      const nameNode = cur.childForFieldName('name') || cur.namedChildren.find((c) => c.type === 'identifier');
      if (nameNode) {
        return `${nodeText(source, nameNode)}.${fnName}`;
      }
    }
    cur = cur.parent;
  }
  return fnName;
}

export function defaultPlugins(): ParsePlugin[] {
  return [new PythonPlugin(), new TSJSPlugin()];
}
