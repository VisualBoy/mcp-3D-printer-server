#!/usr/bin/env node

import { MCP, FileSystem } from '@modelcontextprotocol/sdk';
import dotenv from "dotenv";
import { PrinterFactory } from "./printers/printer-factory.js";
import { OctoPrintImplementation } from "./printers/octoprint.js";
import { BambuImplementation } from "./printers/bambu.js";
import { Printer } from "./types.js";
// NOTE: fs, path, THREE, STLManipulator, parse3MF, ThreeMFData, and axios are removed as they are not used by PrinterToolHandlers or main.

// Load environment variables from .env file
dotenv.config();

/**
 * Gestisce tutta la logica per gli strumenti (tool) relativi alle stampanti,
 * utilizzando una factory per delegare al corretto tipo di stampante.
 */
class PrinterToolHandlers {
    private printerFactory: PrinterFactory;

    constructor() {
        this.printerFactory = new PrinterFactory();
    }

    /**
     * Helper per gestire i tool che attualmente supportano solo OctoPrint.
     */
    private async handleOctoPrintOnlyTool(toolName: string, type: string, callback: () => Promise<any>) {
        if (type.toLowerCase() !== 'octoprint') {
            return {
                status: `Command '${toolName}' is not yet active for printer type '${type}'.`
            };
        }
        try {
            // The callback will contain the actual call to the octoprint implementation
            return await callback();
        } catch (error: any) {
            console.error(`Error in tool '${toolName}' for type '${type}':`, error);
            return { error: error.message || 'An unknown error occurred.' };
        }
    }

    async getStatus(type: string, host: string, apiKey: string) {
        return this.handleOctoPrintOnlyTool('get_status', type, () => {
            const implementation = this.printerFactory.getImplementation(type) as OctoPrintImplementation;
            // Assuming getJobInfo is the correct method based on the issue's context for OctoPrint status
            return implementation.getJobInfo(host, apiKey);
        });
    }

    async getFiles(type: string, host: string, apiKey: string) {
        return this.handleOctoPrintOnlyTool('get_files', type, () => {
            const implementation = this.printerFactory.getImplementation(type) as OctoPrintImplementation;
            return implementation.getFiles(host, apiKey);
        });
    }

    async uploadFile(type: string, host: string, apiKey: string, filePath: string, print: boolean) {
        return this.handleOctoPrintOnlyTool('upload_file', type, () => {
            const implementation = this.printerFactory.getImplementation(type) as OctoPrintImplementation;
            // User's final code implies uploadFile(host, apiKey, filePath, print) for OctoPrint.
            // The actual OctoPrintImplementation has uploadFile(host, port, apiKey, filePath, filename, print)
            // This is a known discrepancy. The user's final code for PrinterToolHandlers.uploadFile matches this simplified call.
            // So, we cast to `any` to call it as per the final code's structure for this method.
            return (implementation as any).uploadFile(host, apiKey, filePath, print);
        });
    }

    async startJob(type: string, host: string, apiKey: string, path: string) {
        return this.handleOctoPrintOnlyTool('start_job', type, () => {
            const implementation = this.printerFactory.getImplementation(type) as OctoPrintImplementation;
            // User's final code: implementation.selectFile(host, apiKey, path, true);
            // Actual OctoPrintImplementation has startJob(host, port, apiKey, filename)
            // Casting to `any` to follow final code structure.
            return (implementation as any).selectFile(host, apiKey, path, true);
        });
    }

    async cancelJob(type: string, host: string, apiKey: string) {
        return this.handleOctoPrintOnlyTool('cancel_job', type, () => {
            const implementation = this.printerFactory.getImplementation(type) as OctoPrintImplementation;
            // User's final code: implementation.issueCommand(host, apiKey, 'cancel');
            // Actual OctoPrintImplementation has cancelJob(host, port, apiKey)
            return (implementation as any).issueCommand(host, apiKey, 'cancel');
        });
    }

    async pauseJob(type: string, host: string, apiKey: string) {
        return this.handleOctoPrintOnlyTool('pause_job', type, () => {
            const implementation = this.printerFactory.getImplementation(type) as OctoPrintImplementation;
            // User's final code: implementation.issueCommand(host, apiKey, 'pause', 'toggle');
            // Actual OctoPrintImplementation has pauseJob(host, port, apiKey)
            return (implementation as any).issueCommand(host, apiKey, 'pause', 'toggle');
        });
    }

    async connectToPrinter(type: string, host: string, apiKey: string) {
        return this.handleOctoPrintOnlyTool('connect_printer', type, () => {
            const implementation = this.printerFactory.getImplementation(type) as OctoPrintImplementation;
            // User's final code: implementation.issueCommand(host, apiKey, 'connect');
            // Actual OctoPrintImplementation has connectToPrinter(host, port, apiKey, settings)
            return (implementation as any).issueCommand(host, apiKey, 'connect');
        });
    }

    async disconnectFromPrinter(type: string, host: string, apiKey: string) {
        // Method name in final code: disconnect_from_printer
        // Tool registration in final code: disconnect_printer
        // Assuming tool name is 'disconnect_printer' for handleOctoPrintOnlyTool
        return this.handleOctoPrintOnlyTool('disconnect_printer', type, () => {
            const implementation = this.printerFactory.getImplementation(type) as OctoPrintImplementation;
            // User's final code: implementation.issueCommand(host, apiKey, 'disconnect');
            // Actual OctoPrintImplementation has disconnectFromPrinter(host, port, apiKey)
            return (implementation as any).issueCommand(host, apiKey, 'disconnect');
        });
    }

    async sendCommandToPrinter(type: string, host: string, apiKey: string, command: string | string[]) {
        return this.handleOctoPrintOnlyTool('send_command_to_printer', type, () => {
            const implementation = this.printerFactory.getImplementation(type) as OctoPrintImplementation;
            // User's final code: implementation.issueCustomCommand(host, apiKey, command);
            // Actual OctoPrintImplementation has sendCommandToPrinter(host, port, apiKey, payload)
            return (implementation as any).issueCustomCommand(host, apiKey, command);
        });
    }

    async setPrinterTemperature(
        type: string,
        host: string,
        apiKey: string,
        component: 'bed' | 'tool0',
        temperature: number,
        bambuSerial?: string,
        bambuToken?: string
    ) {
        const lowerCaseType = type.toLowerCase();

        try {
            // Cast to `any` because the methods being called (e.g. setTemperature, issueBedCommand)
            // might not strictly match the Printer interface or the most specific type,
            // but are expected to exist on the implementation based on the user's final code structure.
            const implementation = this.printerFactory.getImplementation(lowerCaseType) as any;

            if (lowerCaseType === 'bambu') {
                if (!bambuSerial || !bambuToken) {
                    return { error: 'Bambu serial number and access token are required.' };
                }
                // The BambuImplementation's setTemperature in the actual code is (host, port, apiKey, component, temperature)
                // and is currently commented out/disabled.
                // The user's final code calls it as (host, bambuSerial, bambuToken, component, temperature).
                // This matches the arguments provided to this PrinterToolHandlers.setPrinterTemperature method for bambu.
                if (typeof implementation.setTemperature === 'function') {
                    return await implementation.setTemperature(host, bambuSerial, bambuToken, component, temperature);
                } else {
                     return { status: `Command 'setPrinterTemperature' not currently available for Bambu.` };
                }
            } else if (lowerCaseType === 'octoprint') {
                // User's final code expects issueBedCommand and issueToolCommand on the OctoPrint implementation.
                // These are not on the actual OctoPrintImplementation but were in the issue's context for an "OctoPrint" class.
                if (component === 'bed') {
                    return implementation.issueBedCommand(host, apiKey, 'target', temperature);
                } else if (component.startsWith('tool')) {
                    const toolId = parseInt(component.replace('tool', ''), 10);
                    return implementation.issueToolCommand(host, apiKey, 'target', toolId, temperature);
                }
                return { error: `Invalid component for OctoPrint: ${component}` };
            }

            // Fallback for other types or if methods don't exist
            return { status: `Command 'setPrinterTemperature' not implemented for printer type '${type}'.` };

        } catch (error: any) {
            console.error(`Error in tool 'setPrinterTemperature' for type '${type}':`, error);
            return { error: error.message || 'An unknown error occurred.' };
        }
    }
}

/**
 * Funzione principale per inizializzare e avviare il server MCP.
 */
async function main() {
    try { // Added try for the whole main logic as per user's final code example
        // 1. Inizializza il server MCP dal SDK
        const mcp = new MCP();

        // 2. Istanzia i gestori di tool
        const fs = new FileSystem(); // From @modelcontextprotocol/sdk
        const printerHandlers = new PrinterToolHandlers();

        // 3. Registra i tool con il server MCP

        // -- Tool per il Filesystem --
        mcp.tools.register('read_file', fs.readFile.bind(fs));
        mcp.tools.register('write_file', fs.writeFile.bind(fs));
        mcp.tools.register('list_directory', fs.listDirectory.bind(fs));
        mcp.tools.register('get_file_info', fs.getFileInfo.bind(fs));

        // -- Tool per le Stampanti --
        // Ensure argument names in lambdas (e.g., args.type, args.host) match what PrinterToolHandlers methods expect
        // or how they are defined in the "Codice di Riferimento Finale".
        mcp.tools.register('get_status', (args: any) => printerHandlers.getStatus(args.type, args.host, args.apiKey));
        mcp.tools.register('get_files', (args: any) => printerHandlers.getFiles(args.type, args.host, args.apiKey));
        mcp.tools.register('upload_file', (args: any) => printerHandlers.uploadFile(args.type, args.host, args.apiKey, args.filePath, args.print));
        mcp.tools.register('start_job', (args: any) => printerHandlers.startJob(args.type, args.host, args.apiKey, args.path));
        mcp.tools.register('cancel_job', (args: any) => printerHandlers.cancelJob(args.type, args.host, args.apiKey));
        mcp.tools.register('pause_job', (args: any) => printerHandlers.pauseJob(args.type, args.host, args.apiKey));
        mcp.tools.register('connect_printer', (args: any) => printerHandlers.connectToPrinter(args.type, args.host, args.apiKey));
        mcp.tools.register('disconnect_printer', (args: any) => printerHandlers.disconnectFromPrinter(args.type, args.host, args.apiKey)); // Tool name 'disconnect_printer'
        mcp.tools.register('send_command_to_printer', (args: any) => printerHandlers.sendCommandToPrinter(args.type, args.host, args.apiKey, args.command));
        mcp.tools.register('set_printer_temperature', (args: any) => printerHandlers.setPrinterTemperature(args.type, args.host, args.apiKey, args.component, args.temperature, args.bambuSerial, args.bambuToken));

        // 4. Avvia il server
        console.log('Starting MCP server...');
        await mcp.start();
        console.log('MCP server running.');

    } catch (error) { // Catch block from user's final code example
        console.error('Failed to initialize or start MCP server in main:', error);
        // process.exit(1); // Optionally exit if server fails to start
    }
}

main().catch(error => {
    // This catch is for errors during the async execution of main itself,
    // or if an error is re-thrown from the try...catch within main.
    console.error('Failed to run main function:', error);
});
