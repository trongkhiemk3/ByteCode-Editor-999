import React, { useState, useRef } from 'react';
import { 
  Folder, 
  FileCode, 
  Settings, 
  Play, 
  Upload, 
  Terminal, 
  ChevronRight, 
  ChevronDown,
  Cpu,
  Columns,
  Eye,
  Languages,
  Download,
  FileText
} from 'lucide-react';
import { Editor, OnMount } from '@monaco-editor/react';

import { FileNode, AppSettings } from './types';
import { parseJarFile, simulatePythonExecution, extractReadableStrings, assembleClassFile, convertReferenceToConfig } from './utils/fileHelpers';
import { decompileClassLocal } from './services/geminiService';

// --- Components ---

const FileTreeItem: React.FC<{
  node: FileNode;
  level: number;
  onSelect: (node: FileNode) => void;
  selectedPath: string | null;
}> = ({ node, level, onSelect, selectedPath }) => {
  const [isOpen, setIsOpen] = useState(false);
  const isSelected = node.path === selectedPath;

  const handleClick = () => {
    if (node.isFolder) {
      setIsOpen(!isOpen);
    } else {
      onSelect(node);
    }
  };

  return (
    <div>
      <div 
        className={`flex items-center py-1 px-2 cursor-pointer hover:bg-gray-800 text-sm ${isSelected ? 'bg-blue-900 text-blue-100' : 'text-gray-400'}`}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={handleClick}
      >
        <span className="mr-1 opacity-70">
          {node.isFolder ? (
            isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />
          ) : (
            <span className="w-3.5 inline-block" />
          )}
        </span>
        <span className="mr-2">
          {node.isFolder ? <Folder size={14} className="text-yellow-500" /> : <FileCode size={14} className="text-blue-400" />}
        </span>
        <span className="truncate">{node.name}</span>
      </div>
      {node.isFolder && isOpen && node.children?.map((child) => (
        <FileTreeItem 
          key={child.path} 
          node={child} 
          level={level + 1} 
          onSelect={onSelect}
          selectedPath={selectedPath}
        />
      ))}
    </div>
  );
};

export default function App() {
  // State
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileNode | null>(null);
  
  // Dual Editor State
  const [leftContent, setLeftContent] = useState<string>('# Select a file...');
  const [rightContent, setRightContent] = useState<string>('# Translated output will appear here...');
  
  const [isLoading, setIsLoading] = useState(false);
  const [consoleOutput, setConsoleOutput] = useState<string>('JByteEdit Translation Mode Ready.');
  const [dragActive, setDragActive] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  
  // Settings
  const [settings, setSettings] = useState<AppSettings>({
    pythonPath: 'C:\\Users\\Khim\\AppData\\Local\\Python\\bin\\python.exe',
    autoEscapeUnicode: true
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const rightEditorRef = useRef<any>(null);

  // --- Handlers ---

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const handleFile = async (file: File) => {
    setIsLoading(true);
    setConsoleOutput(prev => prev + `\n[System] Loading: ${file.name}...`);
    try {
      if (file.name.endsWith('.jar') || file.name.endsWith('.zip')) {
        const tree = await parseJarFile(file);
        setFileTree(tree);
        setConsoleOutput(prev => prev + `\n[System] Analyzed Jar: ${tree.length} entries.`);
      } else if (file.name.endsWith('.class')) {
        const buffer = await file.arrayBuffer();
        const content = new Uint8Array(buffer);
        const node: FileNode = {
           name: file.name,
           path: file.name,
           isFolder: false,
           content: content
        };
        setFileTree([node]);
        handleNodeSelect(node);
      }
    } catch (err) {
      console.error(err);
      setConsoleOutput(prev => prev + `\n[Error] Failed to parse file.`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleNodeSelect = async (node: FileNode) => {
    setSelectedFile(node);
    if (node.content && node.name.endsWith('.class')) {
        // Left Panel: Readable Reference (str_ 1 | "Value")
        const rawStrings = extractReadableStrings(node.content);
        setLeftContent(rawStrings);
        
        // Right Panel: Initial translation config (str_1 = "Value")
        // We generate this from the raw content as well to ensure they start in sync
        const configStrings = convertReferenceToConfig(rawStrings, node.name);
        setRightContent(configStrings);
        
        setConsoleOutput(prev => prev + `\n[Selection] ${node.name} loaded.`);
    } else {
        setLeftContent("# Not a class file.");
        setRightContent("# Select a class file to edit.");
    }
  };

  const handleDecompile = async () => {
     // This function is kept for legacy button behavior, but now selection auto-loads
     if (selectedFile) handleNodeSelect(selectedFile);
  };

  /**
   * Syncs edits from Left Panel (Reference) to Right Panel (Config).
   * This allows the user to edit the "Readable" view and have it update the "Compilable" view.
   */
  const handleLeftEditorChange = (value: string | undefined) => {
      const newVal = value || '';
      setLeftContent(newVal);
      
      if (selectedFile) {
          // Parse the Left Panel content and update Right Panel
          const syncedConfig = convertReferenceToConfig(newVal, selectedFile.name);
          setRightContent(syncedConfig);
      }
  };

  const handleSave = () => {
    if (!selectedFile || !selectedFile.content) return;
    
    setIsLoading(true);
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    setConsoleOutput(prev => prev + '\n' + simulatePythonExecution(settings.pythonPath, 'assemble', selectedFile.name));
    
    setTimeout(() => {
        setConsoleOutput(prev => prev + `\n[${timestamp}] COMPILER: Assembling new class file...`);
        
        try {
            // --- REAL BYTECODE PATCHING ---
            // Use Right Content (Config format) as the source of truth for saving
            const modifiedBytes = assembleClassFile(selectedFile.content!, rightContent);
            
            // Calculate difference for logging
            const sizeDiff = modifiedBytes.length - selectedFile.content!.length;
            const sign = sizeDiff > 0 ? '+' : '';
            
            setConsoleOutput(prev => prev + `\n[${timestamp}] SUCCESS: Patched binary content. Size delta: ${sign}${sizeDiff} bytes.`);
            setConsoleOutput(prev => prev + `\n[${timestamp}] DONE: New .class file generated.`);
            
            // --- DOWNLOAD REAL MODIFIED FILE ---
            const blob = new Blob([modifiedBytes], { type: "application/java-vm" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            // Requirement: Preserve original filename
            link.download = selectedFile.name; 
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            
            setConsoleOutput(prev => prev + `\n[${timestamp}] FILESYSTEM: Saved to Downloads as "${selectedFile.name}"`);
        } catch (e) {
            setConsoleOutput(prev => prev + `\n[${timestamp}] CRITICAL ERROR: ${(e as Error).message}`);
        }
        setIsLoading(false);
    }, 800);
  };

  return (
    <div className="flex h-screen w-screen bg-gray-950 text-gray-200 font-sans" onDragEnter={handleDrag}>
      
      {/* File Drop Overlay */}
      {dragActive && (
        <div 
          className="absolute inset-0 z-50 bg-blue-900 bg-opacity-50 flex items-center justify-center border-4 border-blue-400 border-dashed m-4 rounded-xl"
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          <div className="text-2xl font-bold text-white pointer-events-none">Drop .JAR or .CLASS file here</div>
        </div>
      )}

      {/* Sidebar */}
      <div className="w-64 border-r border-gray-800 flex flex-col bg-gray-900">
        <div className="p-4 border-b border-gray-800 flex items-center justify-between">
          <h1 className="font-bold text-blue-400 flex items-center gap-2">
            <Cpu size={18} /> JByteEdit
          </h1>
          <button onClick={() => setShowSettings(!showSettings)} className="text-gray-400 hover:text-white" title="Settings">
            <Settings size={18} />
          </button>
        </div>
        
        {showSettings && (
          <div className="p-3 bg-gray-800 text-xs border-b border-gray-700">
            <label className="block text-gray-400 mb-1">Python Runtime Path:</label>
            <input 
              className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1 text-green-500 font-mono mb-2"
              value={settings.pythonPath}
              onChange={(e) => setSettings({...settings, pythonPath: e.target.value})}
            />
            <div className="flex items-center gap-2">
              <input 
                type="checkbox" 
                checked={settings.autoEscapeUnicode}
                onChange={(e) => setSettings({...settings, autoEscapeUnicode: e.target.checked})}
              />
              <span className="text-gray-300">Auto-escape Unicode</span>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
          {fileTree.length === 0 ? (
            <div className="text-center mt-10 text-gray-600">
              <p className="mb-4">No File Loaded</p>
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="bg-blue-700 hover:bg-blue-600 text-white px-4 py-2 rounded text-sm flex items-center gap-2 mx-auto"
              >
                <Upload size={14} /> Open File
              </button>
              <input 
                type="file" 
                ref={fileInputRef} 
                className="hidden" 
                accept=".jar,.zip,.class"
                onChange={handleFileSelect}
              />
            </div>
          ) : (
            fileTree.map(node => (
              <FileTreeItem 
                key={node.path} 
                node={node} 
                level={0} 
                onSelect={handleNodeSelect}
                selectedPath={selectedFile?.path || null}
              />
            ))
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Toolbar */}
        <div className="h-12 border-b border-gray-800 flex items-center px-4 justify-between bg-gray-900">
          <div className="flex items-center gap-4">
            <span className="text-sm font-mono text-gray-400">
              {selectedFile ? selectedFile.path : 'No file selected'}
            </span>
          </div>
          
          <div className="flex items-center gap-3">
             <div className="flex bg-gray-800 rounded p-1 mr-2 items-center">
                 <span className="px-2 py-1 text-xs text-blue-400 flex items-center gap-1">
                    <Columns size={14} /> 2-PANEL SYNC
                 </span>
             </div>
             <button 
               onClick={handleDecompile}
               disabled={!selectedFile || isLoading}
               className="text-blue-400 hover:text-white border border-blue-900 bg-blue-900/30 px-3 py-1.5 rounded text-sm flex items-center gap-2 transition-all hover:bg-blue-800"
             >
               <Play size={14} /> Reload Strings
             </button>
             <button 
               onClick={handleSave}
               disabled={!selectedFile || isLoading}
               className="bg-green-700 hover:bg-green-600 text-white px-4 py-1.5 rounded text-sm flex items-center gap-2 shadow-lg shadow-green-900/20"
               title="Download Modified .class"
             >
               <Download size={14} /> Compile & Save
             </button>
          </div>
        </div>

        {/* Dual Editor Area */}
        <div className="flex-1 flex flex-row relative bg-[#1e1e1e] overflow-hidden">
          {isLoading && (
             <div className="absolute inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40 backdrop-blur-sm">
                <div className="flex flex-col items-center">
                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500 mb-3"></div>
                    <span className="text-blue-400 font-mono text-sm">Processing Bytecode...</span>
                </div>
             </div>
          )}
          
          {/* Panel 1: Original Strings (Editable, Auto-Sync) */}
          <div className="flex-1 flex flex-col border-r border-gray-800 min-w-0">
             <div className="bg-gray-800 px-3 py-1 text-xs text-gray-300 font-bold flex items-center gap-2 uppercase tracking-wide justify-between">
                <div className="flex items-center gap-2"><Eye size={12} /> Reference View (Editable)</div>
                <div className="text-[10px] text-green-500 font-normal">Edits sync to right panel →</div>
             </div>
             <div className="flex-1">
                <Editor
                  height="100%"
                  defaultLanguage="plaintext"
                  theme="vs-dark"
                  value={leftContent}
                  onChange={handleLeftEditorChange}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 13,
                    fontFamily: 'Consolas, "Courier New", monospace',
                    wordWrap: 'off',
                    renderWhitespace: 'all',
                    lineNumbers: 'off'
                  }}
                />
             </div>
          </div>

          {/* Panel 2: Compiler Config (Target for Save) */}
          <div className="flex-1 flex flex-col min-w-0">
             <div className="bg-gray-800 px-3 py-1 text-xs text-blue-400 font-bold flex items-center gap-2 uppercase tracking-wide">
                <Languages size={12} /> Compiler Input (Result)
             </div>
             <div className="flex-1">
                <Editor
                  height="100%"
                  defaultLanguage="ini"
                  theme="vs-dark"
                  value={rightContent}
                  onChange={(val) => setRightContent(val || '')}
                  onMount={(editor) => rightEditorRef.current = editor}
                  options={{
                    minimap: { enabled: true },
                    fontSize: 14,
                    fontFamily: 'Consolas, "Courier New", monospace',
                    readOnly: false, // Can still be edited manually
                  }}
                />
             </div>
          </div>
        </div>

        {/* Console */}
        <div className="h-32 border-t border-gray-800 bg-gray-900 flex flex-col">
          <div className="px-4 py-1 bg-gray-800 text-xs text-gray-500 uppercase font-bold flex items-center justify-between">
            <div className="flex items-center gap-2">
                <Terminal size={12} /> Compiler Output
            </div>
            <div className="text-gray-600 font-mono text-[10px]">
                {settings.pythonPath.split('\\').pop()}
            </div>
          </div>
          <div className="flex-1 p-2 font-mono text-xs text-green-500 overflow-y-auto whitespace-pre-wrap leading-tight">
            {consoleOutput}
          </div>
        </div>
      </div>
    </div>
  );
}