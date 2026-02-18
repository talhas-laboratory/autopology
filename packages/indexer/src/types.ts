export interface ImportRef {
  raw: string;
  resolvedRelpath: string | null;
  isExternal: boolean;
}

export interface CallRef {
  callee: string;
  resolvedQualname: string | null;
  line: number | null;
}

export interface DataFlowRef {
  object: string;
  field: string;
  action: 'READ' | 'WRITE' | 'TRANSFORM';
  line: number | null;
  confidence: number;
  partialTrace: boolean;
}

export interface SymbolRef {
  kind: 'Function' | 'Method' | 'Class' | 'Interface' | 'Variable';
  name: string;
  qualname: string;
  startLine: number;
  endLine: number;
  signature?: string;
  visibility?: string;
  docstring?: string;
  symbolHash: string;
  calls: CallRef[];
  dataFlows: DataFlowRef[];
}

export interface ParsedFile {
  relpath: string;
  language: 'python' | 'typescript' | 'javascript';
  imports: ImportRef[];
  symbols: SymbolRef[];
}

export interface ParsePlugin {
  supportedExtensions(): Set<string>;
  parseFile(repoRoot: string, relpath: string, text: string): ParsedFile;
}
