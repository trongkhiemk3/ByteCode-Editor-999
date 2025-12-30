import JSZip from 'jszip';
import { FileNode } from '../types';

// --- CONSTANTS FOR CLASS FILE FORMAT ---
const CONSTANT_Utf8 = 1;
const CONSTANT_Integer = 3;
const CONSTANT_Float = 4;
const CONSTANT_Long = 5;
const CONSTANT_Double = 6;
const CONSTANT_Class = 7;
const CONSTANT_String = 8;
const CONSTANT_Fieldref = 9;
const CONSTANT_Methodref = 10;
const CONSTANT_InterfaceMethodref = 11;
const CONSTANT_NameAndType = 12;
const CONSTANT_MethodHandle = 15;
const CONSTANT_MethodType = 16;
const CONSTANT_Dynamic = 17;
const CONSTANT_InvokeDynamic = 18;
const CONSTANT_Module = 19;
const CONSTANT_Package = 20;

/**
 * Shared validation logic to filter out non-translatable strings (e.g. code references)
 */
const isValidString = (text: string): boolean => {
    if (text.length < 2) return false; // Too short
    
    // Internal Java signatures/descriptors
    if (text.startsWith('Ljava/')) return false;
    if (text.startsWith('(') && text.includes(')')) return false; 
    if (text.includes('()V')) return false;
    if (text.includes('Exception')) return false;
    if (text.startsWith('META-INF/')) return false;
    
    // Heuristic: Must contain at least one normal letter or number
    return /[\p{L}\d]/u.test(text);
};

/**
 * Escapes strings for the editor.
 * NOW UPDATED: Keeps UTF-8 characters readable (e.g., Vietnamese) instead of escaping to \uXXXX.
 * Only escapes control characters, backslashes, and double quotes.
 */
export const toJavaUnicode = (str: string): string => {
  return str.split('').map(char => {
    // Explicitly escape quotes and backslashes for editor safety
    if (char === '"') return '\\"';
    if (char === '\\') return '\\\\';
    
    const code = char.charCodeAt(0);
    // Only escape control characters (< 32). 
    // We ALLOW > 127 (Unicode) to pass through as raw characters for readability.
    if (code < 32) {
      return '\\u' + code.toString(16).padStart(4, '0');
    }
    return char;
  }).join('');
};

const fromJavaUnicode = (str: string): string => {
    try {
        // We wrap in quotes to use JSON.parse to handle standard escape sequences (like \n, \", \\)
        // This also handles raw UTF-8 characters correctly.
        return JSON.parse(`"${str}"`);
    } catch (e) {
        return str;
    }
};

export const compileStringToBytecode = (input: string): string => {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(input);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
};

export const simulatePythonExecution = (pythonPath: string, action: string, fileName: string): string => {
  const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
  if (action === 'decompile') {
    return `[${timestamp}] CMD: "${pythonPath}" -m fernflower.decompiler "${fileName}"
[${timestamp}] INFO: Parsing Class Structure...
[${timestamp}] INFO: Identifying Constant Pool UTF8 entries...
[${timestamp}] SUCCESS: Extraction complete.`;
  } else {
    return `[${timestamp}] CMD: "${pythonPath}" -m asm.compiler --target "${fileName}"
[${timestamp}] ASSEMBLER: Rebuilding Constant Pool...
[${timestamp}] WRITER: Serializing ${fileName}...`;
  }
};

/**
 * Parses the Class File Constant Pool to extract translatable strings.
 * This guarantees that the IDs (str_0, str_1) match exactly what the Assembler will see.
 */
export const extractStringsFromClass = (content: Uint8Array, fileName: string): string => {
    let output = `# Translation File: ${fileName}\n`;
    output += `# Only edit text inside quotes "..."\n`;
    output += `# Format: str_ID = "Value"\n\n`;

    const view = new DataView(content.buffer, content.byteOffset, content.byteLength);
    
    // Check Magic: CAFEBABE
    if (view.getUint32(0) !== 0xCAFEBABE) {
        return "# ERROR: Not a valid Java Class File (Missing Magic Header)";
    }

    let offset = 8; // Skip Magic(4) + Minor(2) + Major(2)
    const cpCount = view.getUint16(offset);
    offset += 2;

    let stringIndex = 0;
    const decoder = new TextDecoder('utf-8');

    // Constant Pool starts at index 1
    for (let i = 1; i < cpCount; i++) {
        const tag = view.getUint8(offset);
        offset++;

        if (tag === CONSTANT_Utf8) {
            const length = view.getUint16(offset);
            offset += 2;
            
            const bytes = content.slice(offset, offset + length);
            offset += length;

            const text = decoder.decode(bytes);
            if (isValidString(text)) {
                output += `str_${stringIndex} = "${toJavaUnicode(text)}"\n`;
                stringIndex++;
            }
        } else {
            // Skip other tags based on their size
            switch (tag) {
                case CONSTANT_Integer:
                case CONSTANT_Float:
                case CONSTANT_Fieldref:
                case CONSTANT_Methodref:
                case CONSTANT_InterfaceMethodref:
                case CONSTANT_NameAndType:
                case CONSTANT_Dynamic:
                case CONSTANT_InvokeDynamic:
                    offset += 4;
                    break;
                case CONSTANT_Long:
                case CONSTANT_Double:
                    offset += 8;
                    i++; // Longs/Doubles consume 2 CP slots
                    break;
                case CONSTANT_Class:
                case CONSTANT_String:
                case CONSTANT_MethodType:
                case CONSTANT_Module:
                case CONSTANT_Package:
                    offset += 2;
                    break;
                case CONSTANT_MethodHandle:
                    offset += 3;
                    break;
                default:
                    return `# ERROR: Unknown Constant Pool Tag ${tag} at offset ${offset}`;
            }
        }
    }

    return output;
};

/**
 * Extracts strings for the Left Panel (Reference View).
 * Uses the same parser logic to ensure alignment.
 */
export const extractReadableStrings = (content: Uint8Array): string => {
    let output = "# RAW CONSTANT POOL (REFERENCE ONLY)\n";
    output += "# ID    | Value (UTF-8)\n";
    output += "# ------|--------------------------\n";

    const view = new DataView(content.buffer, content.byteOffset, content.byteLength);
    if (view.getUint32(0) !== 0xCAFEBABE) return "# Invalid Class File";

    let offset = 8;
    const cpCount = view.getUint16(offset);
    offset += 2;

    let stringIndex = 0;
    const decoder = new TextDecoder('utf-8');

    for (let i = 1; i < cpCount; i++) {
        const tag = view.getUint8(offset);
        offset++;

        if (tag === CONSTANT_Utf8) {
            const length = view.getUint16(offset);
            offset += 2;
            const text = decoder.decode(content.slice(offset, offset + length));
            offset += length;

            if (isValidString(text)) {
                 const paddedIdx = stringIndex.toString().padStart(5, ' ');
                 output += `str_${paddedIdx} | "${toJavaUnicode(text)}"\n`;
                 stringIndex++;
            }
        } else {
            // Skip logic (duplicated for safety)
            switch (tag) {
                case CONSTANT_Integer:
                case CONSTANT_Float:
                case CONSTANT_Fieldref:
                case CONSTANT_Methodref:
                case CONSTANT_InterfaceMethodref:
                case CONSTANT_NameAndType:
                case CONSTANT_Dynamic:
                case CONSTANT_InvokeDynamic: offset += 4; break;
                case CONSTANT_Long:
                case CONSTANT_Double: offset += 8; i++; break;
                case CONSTANT_Class:
                case CONSTANT_String:
                case CONSTANT_MethodType:
                case CONSTANT_Module:
                case CONSTANT_Package: offset += 2; break;
                case CONSTANT_MethodHandle: offset += 3; break;
            }
        }
    }
    return output;
};

/**
 * Converts text from the Left Panel (Reference View) to Right Panel (Config View) format.
 * Input: str_  1 | "Value"
 * Output: str_1 = "Value"
 */
export const convertReferenceToConfig = (referenceText: string, fileName: string): string => {
    let output = `# Translation File: ${fileName}\n`;
    output += `# Only edit text inside quotes "..."\n`;
    output += `# Format: str_ID = "Value"\n\n`;

    const lines = referenceText.split('\n');
    // Regex matches: str_ [whitespace] DIGITS [whitespace] | [whitespace] "VALUE"
    // Use non-greedy match for value to support quotes inside if escaped properly (though basic regex has limits)
    // We capture everything inside the outer quotes.
    const regex = /str_\s*(\d+)\s*\|\s*"((?:[^"\\]|\\.)*)"/;

    for (const line of lines) {
        const match = line.match(regex);
        if (match) {
            const id = match[1];
            const value = match[2];
            output += `str_${id} = "${value}"\n`;
        }
    }
    return output;
};

/**
 * Re-assembles the Class file by parsing the structure and injecting new strings.
 * This ensures file integrity by correctly recalculating offsets and lengths.
 */
export const assembleClassFile = (original: Uint8Array, editorText: string): Uint8Array => {
    // 1. Parse replacements map
    const replacements = new Map<number, string>();
    const lines = editorText.split('\n');
    const regex = /str_(\d+)\s*=\s*"((?:[^"\\]|\\.)*)"/;
    
    for (const line of lines) {
        const match = line.match(regex);
        if (match) {
            replacements.set(parseInt(match[1], 10), fromJavaUnicode(match[2]));
        }
    }

    const view = new DataView(original.buffer, original.byteOffset, original.byteLength);
    if (view.getUint32(0) !== 0xCAFEBABE) throw new Error("Invalid Magic Header");

    // We will build the new file in a dynamic array of bytes
    const newBytes: number[] = [];
    const encoder = new TextEncoder();

    // Helper to write number
    const writeU1 = (v: number) => newBytes.push(v & 0xFF);
    const writeU2 = (v: number) => { newBytes.push((v >> 8) & 0xFF); newBytes.push(v & 0xFF); };
    const writeU4 = (v: number) => { 
        newBytes.push((v >> 24) & 0xFF); newBytes.push((v >> 16) & 0xFF);
        newBytes.push((v >> 8) & 0xFF); newBytes.push(v & 0xFF);
    };
    const writeBytes = (arr: Uint8Array | number[]) => {
        for(let i=0; i<arr.length; i++) newBytes.push(arr[i]);
    };

    // Copy Header (Magic + Version)
    for(let i=0; i<8; i++) newBytes.push(original[i]);

    let offset = 8;
    const cpCount = view.getUint16(offset);
    writeU2(cpCount); // Copy CP Count
    offset += 2;

    let stringIndex = 0;
    const decoder = new TextDecoder('utf-8');

    // Iterate Constant Pool and rebuild
    for (let i = 1; i < cpCount; i++) {
        const tag = view.getUint8(offset);
        offset++;
        
        writeU1(tag); // Write Tag

        if (tag === CONSTANT_Utf8) {
            const length = view.getUint16(offset);
            offset += 2;
            
            const rawBytes = original.slice(offset, offset + length);
            offset += length;
            
            const currentText = decoder.decode(rawBytes);

            if (isValidString(currentText)) {
                // This is a candidate for replacement
                if (replacements.has(stringIndex)) {
                    const newText = replacements.get(stringIndex)!;
                    
                    // HERE IS THE ENCODING STEP
                    // Convert the UTF-8 string back to bytes for the class file
                    const newTextBytes = encoder.encode(newText);
                    
                    // Write NEW length and NEW bytes
                    writeU2(newTextBytes.length);
                    writeBytes(newTextBytes);
                } else {
                    // Valid string but no change
                    writeU2(rawBytes.length);
                    writeBytes(rawBytes);
                }
                stringIndex++;
            } else {
                // Not a string we exposed to editor (too short/system), copy as is
                writeU2(rawBytes.length);
                writeBytes(rawBytes);
            }

        } else {
            // For all other tags, just copy the raw bytes from original
            let size = 0;
             switch (tag) {
                case CONSTANT_Integer:
                case CONSTANT_Float:
                case CONSTANT_Fieldref:
                case CONSTANT_Methodref:
                case CONSTANT_InterfaceMethodref:
                case CONSTANT_NameAndType:
                case CONSTANT_Dynamic:
                case CONSTANT_InvokeDynamic: size = 4; break;
                case CONSTANT_Long:
                case CONSTANT_Double: size = 8; i++; break;
                case CONSTANT_Class:
                case CONSTANT_String:
                case CONSTANT_MethodType:
                case CONSTANT_Module:
                case CONSTANT_Package: size = 2; break;
                case CONSTANT_MethodHandle: size = 3; break;
                default:
                     throw new Error(`Unknown Tag ${tag} during assembly`);
            }
            // Copy data bytes
            const dataBytes = original.slice(offset, offset + size);
            writeBytes(dataBytes);
            offset += size;
        }
    }

    // After Constant Pool, copy the rest of the file verbatim
    const restOfFile = original.slice(offset);
    writeBytes(restOfFile);

    return new Uint8Array(newBytes);
};

export const parseJarFile = async (file: File): Promise<FileNode[]> => {
    const zip = await JSZip.loadAsync(file);
    const root: FileNode[] = [];

    // Helper to find or create folder structure
    const getFolder = (nodes: FileNode[], pathParts: string[], parentPath: string): FileNode[] => {
        if (pathParts.length === 0) return nodes;

        const part = pathParts[0];
        const currentPath = parentPath ? `${parentPath}/${part}` : part;

        let folder = nodes.find(n => n.name === part && n.isFolder);
        if (!folder) {
            folder = {
                name: part,
                path: currentPath,
                isFolder: true,
                children: []
            };
            nodes.push(folder);
        }
        return getFolder(folder.children!, pathParts.slice(1), currentPath);
    };

    // Process all files
    for (const [relativePath, fileEntry] of Object.entries(zip.files)) {
        if (fileEntry.dir) continue; // Skip explicit directories

        const parts = relativePath.split('/');
        const fileName = parts.pop();
        if (!fileName) continue;

        const folderContent = getFolder(root, parts, "");
        const content = await fileEntry.async("uint8array");

        folderContent.push({
            name: fileName,
            path: relativePath,
            isFolder: false,
            content: content
        });
    }

    return root;
};
