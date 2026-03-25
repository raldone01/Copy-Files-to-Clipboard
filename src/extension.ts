import * as vscode from 'vscode';
import * as path from 'path';

// --- Interfaces ---

interface ExtensionConfig {
	maxFileSizeBytes: number;
	maxTotalSizeBytes: number;
	maxTotalFiles: number;
	maxDirDepth: number;
	ignoreDirs: Set<string>;
	sensitiveFileNames: Set<string>;
	sensitiveFilePrefixes: string[];
	sensitiveFileExtensions: string[];
}

interface GatherState {
	files: vscode.Uri[];
	totalSize: number;
	depth: number;
	limitReached: boolean;
	sensitiveSkipped: number;
	config: ExtensionConfig;
	// Tracks processed paths to prevent duplicate gathering
	processedPaths: Set<string>;
}

/**
 * Retrieves the current configuration from VS Code workspace settings.
 */
function getConfig(): ExtensionConfig {
	const config = vscode.workspace.getConfiguration('copyFilesToClipboard');

	// Convert MB to Bytes for internal use
	const maxFileSizeMB = config.get<number>('maxFileSizeMB', 2);
	const maxTotalSizeMB = config.get<number>('maxTotalSizeMB', 10);

	// Convert arrays to Sets for O(1) fast lookups
	const ignoreDirsArray = config.get<string[]>('ignoreDirs', []);
	const sensitiveNamesArray = config.get<string[]>('sensitiveFileNames', []);

	return {
		maxFileSizeBytes: maxFileSizeMB * 1024 * 1024,
		maxTotalSizeBytes: maxTotalSizeMB * 1024 * 1024,
		maxTotalFiles: config.get<number>('maxTotalFiles', 200),
		maxDirDepth: config.get<number>('maxDirDepth', 15),
		ignoreDirs: new Set(ignoreDirsArray),
		sensitiveFileNames: new Set(sensitiveNamesArray),
		sensitiveFilePrefixes: config.get<string[]>('sensitiveFilePrefixes', ['.env.']),
		sensitiveFileExtensions: config.get<string[]>('sensitiveFileExtensions', ['.pem', '.key', '.cert'])
			.map(ext => ext.startsWith('.') ? ext : `.${ext}`)
	};
}

export function activate(context: vscode.ExtensionContext) {
	let disposable = vscode.commands.registerCommand(
		'copy-files-to-clipboard.copyContents',
		async (uri: vscode.Uri, selectedUris: vscode.Uri[]) => {

			// Determine which files/folders to process based on selection behavior
			let urisToProcess: vscode.Uri[] = [];

			if (uri && selectedUris && selectedUris.length > 0) {
				// Check if the item we right-clicked is part of the current multi-selection
				const isIncluded = selectedUris.some(u => u.fsPath === uri.fsPath);

				// If right-clicked inside selection, copy everything selected.
				// If right-clicked outside selection, copy only the right-clicked item.
				urisToProcess = isIncluded ? selectedUris : [uri];
			} else if (selectedUris && selectedUris.length > 0) {
				urisToProcess = selectedUris;
			} else if (uri) {
				urisToProcess = [uri];
			}

			if (urisToProcess.length === 0) {
				vscode.window.showWarningMessage("No files selected.");
				return;
			}

			// Read fresh configuration on every run
			const currentConfig = getConfig();

			try {
				// Gather all file URIs safely with limits
				const state: GatherState = {
					files: [],
					totalSize: 0,
					depth: 0,
					limitReached: false,
					sensitiveSkipped: 0,
					config: currentConfig,
					processedPaths: new Set()
				};

				await gatherAllFiles(urisToProcess, state);

				if (state.files.length === 0) {
					const reason = state.sensitiveSkipped > 0
						? "Only sensitive files were selected. Nothing copied."
						: "No valid files found to copy (or limits prevented reading).";
					vscode.window.showInformationMessage(reason);
					return;
				}

				// Format the files, checking for binary content
				let finalOutput = '';
				let processedCount = 0;

				for (const fileUri of state.files) {
					const formattedContent = await formatFileContent(fileUri);
					if (formattedContent) {
						finalOutput += formattedContent;
						processedCount++;
					}
				}

				if (processedCount === 0) {
					vscode.window.showInformationMessage("No text files found. Binary or oversized files were skipped.");
					return;
				}

				// Write to clipboard
				await vscode.env.clipboard.writeText(finalOutput);

				let msg = state.limitReached
					? `Copied ${processedCount} file(s) to clipboard. (Some files were skipped due to limits).`
					: `Copied ${processedCount} file(s) to clipboard!`;

				// Append info about skipped sensitive files
				if (state.sensitiveSkipped > 0) {
					msg += ` Ignored ${state.sensitiveSkipped} sensitive file(s).`;
				}

				vscode.window.showInformationMessage(msg);

			} catch (error: any) {
				vscode.window.showErrorMessage(`Failed to copy files: ${error.message}`);
			}
		}
	);

	context.subscriptions.push(disposable);
}

/**
 * Recursively goes through the provided URIs while enforcing limits.
 */
async function gatherAllFiles(uris: vscode.Uri[], state: GatherState): Promise<void> {
	if (state.limitReached || state.depth > state.config.maxDirDepth) {
		return;
	}

	for (const uri of uris) {
		if (state.limitReached) { break; }

		// Avoid duplicates if a user multi-selects a parent folder AND a file inside it
		if (state.processedPaths.has(uri.fsPath)) {
			continue;
		}
		state.processedPaths.add(uri.fsPath);

		if (state.files.length >= state.config.maxTotalFiles) {
			vscode.window.showWarningMessage(`File count limit reached (${state.config.maxTotalFiles}). Stopping early.`);
			state.limitReached = true;
			break;
		}

		const stat = await vscode.workspace.fs.stat(uri);

		// Use bitwise '&' instead of '===' to correctly process files/folders even if they are symlinks
		if (stat.type & vscode.FileType.File) {
			const fileName = path.basename(uri.fsPath);

			// Check if file is sensitive BEFORE processing
			if (isSensitiveFile(fileName, state.config)) {
				state.sensitiveSkipped++;
				continue;
			}

			// Check file size limit
			if (stat.size > state.config.maxFileSizeBytes) {
				const sizeMB = state.config.maxFileSizeBytes / 1024 / 1024;
				vscode.window.showWarningMessage(`Skipped ${fileName}: Exceeds ${sizeMB}MB limit.`);
				continue;
			}

			// Check total size limit
			if (state.totalSize + stat.size > state.config.maxTotalSizeBytes) {
				vscode.window.showWarningMessage(`Total size limit reached. Stopping early.`);
				state.limitReached = true;
				break;
			}

			state.files.push(uri);
			state.totalSize += stat.size;

		} else if (stat.type & vscode.FileType.Directory) {
			// Read directory contents
			const directoryEntries = await vscode.workspace.fs.readDirectory(uri);

			// Filter out ignored directories and map to URIs
			const childUris = directoryEntries
				.filter(([name, type]) => {
					if ((type & vscode.FileType.Directory) && state.config.ignoreDirs.has(name)) {
						return false; // Skip entirely
					}
					return true;
				})
				.map(([name, _type]) => vscode.Uri.joinPath(uri, name));

			// Recurse deeper
			state.depth++;
			await gatherAllFiles(childUris, state);
			state.depth--;
		}
	}
}

/**
 * Reads a file, checks if it's binary, and formats it.
 * Returns null if the file is binary.
 */
async function formatFileContent(uri: vscode.Uri): Promise<string | null> {
	const relativePath = vscode.workspace.asRelativePath(uri, false);
	const fileExtension = path.extname(uri.fsPath).replace('.', '');

	const fileData = await vscode.workspace.fs.readFile(uri);

	// Protect against binary garbage
	if (isBinary(fileData)) {
		return null;
	}

	const content = new TextDecoder('utf-8').decode(fileData);

	// Find the longest sequence of backticks in the file
	const backtickMatches = content.match(/`{3,}/g);
	const maxBackticks = backtickMatches ? Math.max(...backtickMatches.map(m => m.length)) : 2;
	const fence = '`'.repeat(maxBackticks + 1); // Use at least 3, or one more than the max found

	let formattedStr = `### \`${relativePath}\`\n`;
	formattedStr += `${fence}${fileExtension}\n`;
	formattedStr += `${content}\n`;
	formattedStr += `${fence}\n\n`;

	return formattedStr;
}

/**
 * Helper to determine if a file is sensitive based on name or extension
 */
function isSensitiveFile(fileName: string, config: ExtensionConfig): boolean {
	if (config.sensitiveFileNames.has(fileName)) { return true; }
	if (config.sensitiveFilePrefixes.some(prefix => fileName.startsWith(prefix))) { return true; }
	if (config.sensitiveFileExtensions.some(ext => fileName.endsWith(ext))) { return true; }
	return false;
}

/**
 * Heuristic to detect binary files.
 * Checks the first 512 bytes for a null byte (0x00).
 * Almost all text files (except UTF-16) will not contain null bytes.
 */
function isBinary(data: Uint8Array): boolean {
	const checkLength = Math.min(data.length, 512);
	for (let i = 0; i < checkLength; i++) {
		if (data[i] === 0) {
			return true;
		}
	}
	return false;
}

export function deactivate() { }
