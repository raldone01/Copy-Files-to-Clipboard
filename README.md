# Copy Files to Clipboard

**Copy Files to Clipboard** is a VS Code extension that allows you to quickly gather and copy the contents of multiple files and entire directories directly to your clipboard.

The copied text is automatically formatted into Markdown.

## ✨ Features

* **Multi-Select & Folders:** Right-click a single file, multiple selected files, or an entire folder in the VS Code Explorer to copy their contents at once.
* **Markdown Formatted Output:** Files are automatically prepended with their relative path and wrapped in language-specific syntax highlighting blocks.
* **Smart Code Fences:** Automatically calculates the number of backticks needed for code blocks, ensuring that copying Markdown files with existing code blocks never breaks the formatting.
* **Smart Filtering:** Automatically detects and skips non-text/binary files to prevent clipboard bloat.
* **Security First:** Built-in safeguards skip sensitive files (like `.env`, `.pem`, and `.key` files) to prevent accidentally sharing secrets.
* **Safeguards:** Implements customizable limits on file size, total payload size, file count, and directory depth to prevent VS Code from freezing on massive directories (like `node_modules`).

## 🚀 Usage

1. Open the VS Code Explorer.
2. Select one or more files, or an entire folder.
3. Right-click to open the context menu.
4. Select **"Copy Files to Clipboard"**.
5. Paste your formatted code anywhere!

### Output Example

When you copy files, they are formatted in your clipboard like this:

````markdown
### `src/utils/math.ts`
```ts
export function add(a: number, b: number) {
    return a + b;
}
```

### `package.json`
```json
{
  "name": "my-project",
  "version": "1.0.0"
}
```
````

## 🤝 Contributing

Contributions are welcome! Feel free to open issues or submit pull requests on the [GitHub repository](https://github.com/raldone01/Copy-Files-to-Clipboard).

## 📄 License

This extension is licensed under the [MIT License](LICENSE).
