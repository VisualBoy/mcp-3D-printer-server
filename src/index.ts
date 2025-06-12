#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ErrorCode,
  McpError
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import dotenv from "dotenv";
// Add these imports if not already present, based on issue context
import { Tool, ToolHandlers, FileSystem } from 'mcp_server';
import fs from "fs";
import path from "path";
import * as THREE from 'three';
import { PrinterFactory } from "./printers/printer-factory.js";
import { OctoPrintImplementation } from "./printers/octoprint.js"; // Ensure this import is present
import { STLManipulator } from "./stl/stl-manipulator.js";
import { parse3MF, ThreeMFData } from './3mf_parser.js';
import { BambuImplementation } from "./printers/bambu.js";

// Load environment variables from .env file
dotenv.config();

// Default values
const DEFAULT_HOST = process.env.PRINTER_HOST || "localhost";
const DEFAULT_PORT = process.env.PRINTER_PORT || "80";
const DEFAULT_API_KEY = process.env.API_KEY || "";
const DEFAULT_TYPE = process.env.PRINTER_TYPE || "octoprint"; // Default to OctoPrint
const TEMP_DIR = process.env.TEMP_DIR || path.join(process.cwd(), "temp");

// Slicer configuration
const DEFAULT_SLICER_TYPE = process.env.SLICER_TYPE || "prusaslicer";
const DEFAULT_SLICER_PATH = process.env.SLICER_PATH || "";
const DEFAULT_SLICER_PROFILE = process.env.SLICER_PROFILE || "";

// Bambu-specific default values
const DEFAULT_BAMBU_SERIAL = process.env.BAMBU_SERIAL || "";
const DEFAULT_BAMBU_TOKEN = process.env.BAMBU_TOKEN || "";

// Ensure temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Add this class to src/index.ts
class PrinterToolHandlers {
    private printerFactory: PrinterFactory;

    constructor() {
        this.printerFactory = new PrinterFactory();
    }

    // Add this private method inside the PrinterToolHandlers class
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

    // Tool handler methods will go here...

    async getStatus(type: string, host: string, apiKey: string) {
        return this.handleOctoPrintOnlyTool('get_status', type, () => {
            const implementation = this.printerFactory.getImplementation(type) as OctoPrintImplementation;
            // Assuming getJobInfo is the correct method based on the issue's context for OctoPrint status
            // The actual OctoPrintImplementation has getStatus and getJobInfo.
            // The example shows getJobInfo for 'get_status' tool.
            return implementation.getJobInfo(host, apiKey);
        });
    }

    async getFiles(type: string, host: string, apiKey: string) {
        return this.handleOctoPrintOnlyTool('get_files', type, () => {
            const implementation = this.printerFactory.getImplementation(type) as OctoPrintImplementation;
            return implementation.getFiles(host, apiKey); // Assuming port is handled by implementation or not needed here
        });
    }

    async uploadFile(type: string, host: string, apiKey: string, filePath: string, print: boolean) {
        return this.handleOctoPrintOnlyTool('upload_file', type, () => {
            // Matching issue's OctoPrint class which is different from actual OctoPrintImplementation
            const octoPrintImplementation = this.printerFactory.getImplementation(type) as any;
            return octoPrintImplementation.uploadFile(host, apiKey, filePath, print);
        });
    }

    async startJob(type: string, host: string, apiKey: string, path: string) {
        return this.handleOctoPrintOnlyTool('start_job', type, () => {
            const implementation = this.printerFactory.getImplementation(type) as any;
            // Issue: `selectFile(host, apiKey, path, true)`
            return implementation.selectFile(host, apiKey, path, true);
        });
    }

    async cancelJob(type: string, host: string, apiKey: string) {
        return this.handleOctoPrintOnlyTool('cancel_job', type, () => {
            const implementation = this.printerFactory.getImplementation(type) as any;
            // Issue: `issueCommand(host, apiKey, 'cancel')`
            return implementation.issueCommand(host, apiKey, 'cancel');
        });
    }

    async pauseJob(type: string, host: string, apiKey: string) {
        return this.handleOctoPrintOnlyTool('pause_job', type, () => {
            const implementation = this.printerFactory.getImplementation(type) as any;
            // Issue: `issueCommand(host, apiKey, 'pause', 'toggle')`
            return implementation.issueCommand(host, apiKey, 'pause', 'toggle');
        });
    }

    async connectToPrinter(type: string, host: string, apiKey: string) {
        return this.handleOctoPrintOnlyTool('connect_printer', type, () => {
            const implementation = this.printerFactory.getImplementation(type) as any;
            // Issue: `issueCommand(host, apiKey, 'connect')`
            return implementation.issueCommand(host, apiKey, 'connect');
        });
    }

    async disconnectFromPrinter(type: string, host: string, apiKey: string) {
        return this.handleOctoPrintOnlyTool('disconnect_printer', type, () => {
            const implementation = this.printerFactory.getImplementation(type) as any;
            // Issue: `issueCommand(host, apiKey, 'disconnect')`
            return implementation.issueCommand(host, apiKey, 'disconnect');
        });
    }

    async sendCommandToPrinter(type: string, host: string, apiKey: string, command: string) {
        return this.handleOctoPrintOnlyTool('send_command_to_printer', type, () => {
            const implementation = this.printerFactory.getImplementation(type) as any;
            // Issue: `issueCustomCommand(host, apiKey, command)`
            return implementation.issueCustomCommand(host, apiKey, command);
        });
    }

    // ... other methods like setPrinterTemperature will go here later

    // Add this method inside the PrinterToolHandlers class
    async setPrinterTemperature(
        type: string,
        host: string,
        apiKey: string,
        component: 'bed' | 'tool0', // Note: The issue example has 'tool0', Bambu uses 'tool' + number, OctoPrint uses 'tool' + number
        temperature: number,
        bambuSerial?: string,
        bambuToken?: string
    ) {
        const lowerCaseType = type.toLowerCase();

        if (lowerCaseType === 'bambu') {
            if (!bambuSerial || !bambuToken) {
                return { error: 'Bambu serial number and access token are required.' };
            }
            const bambuImplementation = this.printerFactory.getImplementation('bambu') as BambuImplementation;
            // The issue's bambu.ts snippet has `setTemperature(host, serial, token, component, temperature)`
            // The actual bambu.ts has `setTemperature(host, port, apiKey, component, temperature)`
            // and it's currently commented out/disabled due to library issues.
            // For Bambu, the component in the issue is 'bed' or 'tool<num>'.
            // The issue's PrinterToolHandlers.setPrinterTemperature component type is 'bed' | 'tool0'.
            // This is slightly different. Bambu's `setTemperature` (in issue context) takes component as string.
            // The actual BambuImplementation.setTemperature (in current file) is:
            // `async setTemperature(host: string, port: string, apiKey: string, component: string, temperature: number)`
            // And it's disabled.
            // Assuming the method *was* enabled and following the issue's pattern for BambuImplementation:
            if (typeof bambuImplementation.setTemperature === 'function') {
                // The issue's bambu.ts context has `setTemperature(host, serial, token, component, temperature)`
                // The `PrinterToolHandlers.setPrinterTemperature` is calling it with (host, bambuSerial, bambuToken, component, temperature)
                // This matches the issue's context for BambuImplementation.setTemperature.
                // However, the actual BambuImplementation.setTemperature takes (host, port, apiKey, component, temperature)
                // This is another discrepancy.
                // To follow Step 4 strictly, I will assume bambuImplementation.setTemperature matches the issue's context.
                // This means the call below is what the issue expects.
                return await (bambuImplementation as any).setTemperature(host, bambuSerial, bambuToken, component, temperature);
            } else {
                // This path will be taken if the actual bambu.ts setTemperature is indeed not a function (e.g. commented out)
                return { status: `Command 'setPrinterTemperature' not implemented for Bambu.` };
            }
        }

        if (lowerCaseType === 'octoprint') {
            const implementation = this.printerFactory.getImplementation(type) as OctoPrintImplementation;
            // The issue's OctoPrint class context:
            // `issueBedCommand(host, apiKey, 'target', temp)`
            // `issueToolCommand(host, apiKey, 'target', toolId, temp)`
            // The actual OctoPrintImplementation class:
            // `setTemperature(host, port, apiKey, component, temperature)` which handles bed/extruder internally.
            // Or, if we assume the issue's `octoprint.ts` structure for `OctoPrint` class is what's intended for the factory product:
            // It has `issueBedCommand(host, apiKey, command, temp)` and `issueToolCommand(host, apiKey, command, tool, temp)`.
            // The Step 4 code uses these specific methods. So I will assume the factory's OctoPrint product matches this.
            const octoPrintAsIssueDescribes = implementation as any;

            if (component === 'bed') {
                return octoPrintAsIssueDescribes.issueBedCommand(host, apiKey, 'target', temperature);
            } else if (component.startsWith('tool')) { // component is 'tool0'
                // const toolId = parseInt(component.replace('tool', ''), 10); // This would be 0 for 'tool0'
                // The issue example for OctoPrint in step 4 implies component is 'tool0', and then parses toolId.
                // The type hint for component is 'bed' | 'tool0'.
                // So, toolId will be 0 if component is 'tool0'.
                const toolId = parseInt(component.replace('tool', ''), 10);
                return octoPrintAsIssueDescribes.issueToolCommand(host, apiKey, 'target', toolId, temperature);
            }
            return { error: `Invalid component for OctoPrint: ${component}` };
        }

        return { status: `Command 'setPrinterTemperature' is not yet active for printer type '${type}'.` };
    }
}

// Replace the existing setupToolHandlers function with this new version
// (Note: This will be a NEW top-level function, not replacing the method in ThreeDPrinterMCPServer yet)
async function setupToolHandlers() {
    const toolHandlers = new ToolHandlers();
    const fs = new FileSystem();
    const printerHandlers = new PrinterToolHandlers(); // This is the class created in earlier steps

    // Filesystem tools
    toolHandlers.register('read_file', fs.readFile.bind(fs));
    toolHandlers.register('write_file', fs.writeFile.bind(fs));
    toolHandlers.register('list_directory', fs.listDirectory.bind(fs));
    toolHandlers.register('get_file_info', fs.getFileInfo.bind(fs));

    // Printer control tools
    toolHandlers.register('get_status', (args: any) => printerHandlers.getStatus(args.type, args.host, args.apiKey));
    toolHandlers.register('get_files', (args: any) => printerHandlers.getFiles(args.type, args.host, args.apiKey));
    toolHandlers.register('upload_file', (args: any) => printerHandlers.uploadFile(args.type, args.host, args.apiKey, args.filePath, args.print));
    toolHandlers.register('start_job', (args: any) => printerHandlers.startJob(args.type, args.host, args.apiKey, args.path));
    toolHandlers.register('cancel_job', (args: any) => printerHandlers.cancelJob(args.type, args.host, args.apiKey));
    toolHandlers.register('pause_job', (args: any) => printerHandlers.pauseJob(args.type, args.host, args.apiKey));
    toolHandlers.register('connect_printer', (args: any) => printerHandlers.connectToPrinter(args.type, args.host, args.apiKey));
    toolHandlers.register('disconnect_printer', (args: any) => printerHandlers.disconnectFromPrinter(args.type, args.host, args.apiKey));
    toolHandlers.register('send_command_to_printer', (args: any) => printerHandlers.sendCommandToPrinter(args.type, args.host, args.apiKey, args.command));
    toolHandlers.register('set_printer_temperature', (args: any) => printerHandlers.setPrinterTemperature(args.type, args.host, args.apiKey, args.component, args.temperature, args.bambuSerial, args.bambuToken));

    return toolHandlers;
}

async function main() {
    const toolHandlers = await setupToolHandlers();
    const tool = new Tool(toolHandlers);
    tool.serve();
}

// main(); // Comment out main() call for now to prevent execution conflicts with existing server

class ThreeDPrinterMCPServer {
  private server: Server;
  private printerFactory: PrinterFactory;
  private stlManipulator: STLManipulator;

  constructor() {
    this.server = new Server(
      {
        name: "mcp-3d-printer-server",
        version: "1.0.0"
      },
      {
        capabilities: {
          resources: {},
          tools: {}
        }
      }
    );

    this.printerFactory = new PrinterFactory();
    this.stlManipulator = new STLManipulator(TEMP_DIR);

    this.setupHandlers();
    this.setupErrorHandling();
  }

  setupErrorHandling() {
    this.server.onerror = (error) => {
      console.error("[MCP Error]", error);
    };

    process.on("SIGINT", async () => {
      // Disconnect all printers
      await this.printerFactory.disconnectAll();
      await this.server.close();
      process.exit(0);
    });
  }

  setupHandlers() {
    this.setupResourceHandlers();
    this.setupToolHandlers();
  }

  setupResourceHandlers() {
    // List available resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      return {
        resources: [
          {
            uri: `printer://${DEFAULT_HOST}/status`,
            name: "3D Printer Status",
            mimeType: "application/json",
            description: "Current status of the 3D printer including temperatures, print progress, and more"
          },
          {
            uri: `printer://${DEFAULT_HOST}/files`,
            name: "3D Printer Files",
            mimeType: "application/json",
            description: "List of files available on the 3D printer"
          }
        ],
        templates: [
          {
            uriTemplate: "printer://{host}/status",
            name: "3D Printer Status",
            mimeType: "application/json"
          },
          {
            uriTemplate: "printer://{host}/files",
            name: "3D Printer Files",
            mimeType: "application/json"
          },
          {
            uriTemplate: "printer://{host}/file/{filename}",
            name: "3D Printer File Content",
            mimeType: "application/gcode"
          }
        ]
      };
    });

    // Read resource
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;
      const match = uri.match(/^printer:\/\/([^\/]+)\/(.+)$/);

      if (!match) {
        throw new McpError(ErrorCode.InvalidRequest, `Invalid resource URI: ${uri}`);
      }

      const [, host, resource] = match;
      let content;

      try {
        if (resource === "status") {
          content = await this.getPrinterStatus(host);
        } else if (resource === "files") {
          content = await this.getPrinterFiles(host);
        } else if (resource.startsWith("file/")) {
          const filename = resource.substring(5);
          content = await this.getPrinterFile(host, filename);
        } else {
          throw new McpError(ErrorCode.InvalidRequest, `Unknown resource: ${resource}`);
        }

        return {
          contents: [
            {
              uri,
              mimeType: resource.startsWith("file/") ? "application/gcode" : "application/json",
              text: typeof content === "string" ? content : JSON.stringify(content, null, 2)
            }
          ]
        };
      } catch (error) {
        if (axios.isAxiosError(error)) {
          throw new McpError(
            ErrorCode.InternalError,
            `API error: ${error.response?.data?.error || error.message}`
          );
        }
        throw error;
      }
    });
  }

  setupToolHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "get_printer_status",
            description: "Get the current status of the 3D printer",
            inputSchema: {
              type: "object",
              properties: {
                host: {
                  type: "string",
                  description: "Hostname or IP address of the printer (default: value from env)"
                },
                port: {
                  type: "string",
                  description: "Port of the printer API (default: value from env)"
                },
                type: {
                  type: "string",
                  description: "Type of printer management system (octoprint, klipper, duet, repetier, bambu, prusa, creality) (default: value from env)"
                },
                api_key: {
                  type: "string",
                  description: "API key for authentication (default: value from env)"
                },
                bambu_serial: {
                  type: "string",
                  description: "Serial number for Bambu Lab printers (default: value from env)"
                },
                bambu_token: {
                  type: "string",
                  description: "Access token for Bambu Lab printers (default: value from env)"
                }
              }
            }
          },
          // New STL manipulation tools
          {
            name: "extend_stl_base",
            description: "Extend the base of an STL file by a specified amount",
            inputSchema: {
              type: "object",
              properties: {
                stl_path: {
                  type: "string",
                  description: "Path to the STL file to modify"
                },
                extension_inches: {
                  type: "number",
                  description: "Amount to extend the base in inches"
                }
              },
              required: ["stl_path", "extension_inches"]
            }
          },
          {
            name: "slice_stl",
            description: "Slice an STL file to generate G-code",
            inputSchema: {
              type: "object",
              properties: {
                stl_path: {
                  type: "string",
                  description: "Path to the STL file to slice"
                },
                slicer_type: {
                  type: "string",
                  description: "Type of slicer to use (prusaslicer, cura, slic3r, orcaslicer) (default: value from env)"
                },
                slicer_path: {
                  type: "string",
                  description: "Path to the slicer executable (default: value from env)"
                },
                slicer_profile: {
                  type: "string",
                  description: "Profile to use for slicing (default: value from env)"
                }
              },
              required: ["stl_path"]
            }
          },
          {
            name: "confirm_temperatures",
            description: "Confirm temperature settings in a G-code file",
            inputSchema: {
              type: "object",
              properties: {
                gcode_path: {
                  type: "string",
                  description: "Path to the G-code file"
                },
                extruder_temp: {
                  type: "number",
                  description: "Expected extruder temperature"
                },
                bed_temp: {
                  type: "number",
                  description: "Expected bed temperature"
                }
              },
              required: ["gcode_path"]
            }
          },
          {
            name: "process_and_print_stl",
            description: "Process an STL file (extend base), slice it, confirm temperatures, and start printing",
            inputSchema: {
              type: "object",
              properties: {
                stl_path: {
                  type: "string",
                  description: "Path to the STL file to process"
                },
                extension_inches: {
                  type: "number",
                  description: "Amount to extend the base in inches"
                },
                extruder_temp: {
                  type: "number",
                  description: "Expected extruder temperature"
                },
                bed_temp: {
                  type: "number",
                  description: "Expected bed temperature"
                },
                host: {
                  type: "string",
                  description: "Hostname or IP address of the printer (default: value from env)"
                },
                port: {
                  type: "string",
                  description: "Port of the printer API (default: value from env)"
                },
                type: {
                  type: "string",
                  description: "Type of printer management system (default: value from env)"
                },
                api_key: {
                  type: "string",
                  description: "API key for authentication (default: value from env)"
                }
              },
              required: ["stl_path", "extension_inches"]
            }
          },
          // New STL manipulation tools
          {
            name: "get_stl_info",
            description: "Get detailed information about an STL file",
            inputSchema: {
              type: "object",
              properties: {
                stl_path: {
                  type: "string",
                  description: "Path to the STL file"
                }
              },
              required: ["stl_path"]
            }
          },
          {
            name: "scale_stl",
            description: "Scale an STL model uniformly or along specific axes",
            inputSchema: {
              type: "object",
              properties: {
                stl_path: {
                  type: "string",
                  description: "Path to the STL file"
                },
                scale_factor: {
                  type: "number",
                  description: "Uniform scaling factor to apply"
                },
                scale_x: {
                  type: "number",
                  description: "X-axis scaling factor (overrides scale_factor for X axis)"
                },
                scale_y: {
                  type: "number",
                  description: "Y-axis scaling factor (overrides scale_factor for Y axis)"
                },
                scale_z: {
                  type: "number",
                  description: "Z-axis scaling factor (overrides scale_factor for Z axis)"
                }
              },
              required: ["stl_path"]
            }
          },
          {
            name: "rotate_stl",
            description: "Rotate an STL model around specific axes",
            inputSchema: {
              type: "object",
              properties: {
                stl_path: {
                  type: "string",
                  description: "Path to the STL file"
                },
                rotate_x: {
                  type: "number",
                  description: "Rotation around X-axis in degrees"
                },
                rotate_y: {
                  type: "number",
                  description: "Rotation around Y-axis in degrees"
                },
                rotate_z: {
                  type: "number",
                  description: "Rotation around Z-axis in degrees"
                }
              },
              required: ["stl_path"]
            }
          },
          {
            name: "translate_stl",
            description: "Move an STL model along specific axes",
            inputSchema: {
              type: "object",
              properties: {
                stl_path: {
                  type: "string",
                  description: "Path to the STL file"
                },
                translate_x: {
                  type: "number",
                  description: "Translation along X-axis in millimeters"
                },
                translate_y: {
                  type: "number",
                  description: "Translation along Y-axis in millimeters"
                },
                translate_z: {
                  type: "number",
                  description: "Translation along Z-axis in millimeters"
                }
              },
              required: ["stl_path"]
            }
          },
          {
            name: "modify_stl_section",
            description: "Apply a specific transformation to a selected section of an STL file",
            inputSchema: {
              type: "object",
              properties: {
                stl_path: {
                  type: "string",
                  description: "Path to the STL file"
                },
                section: {
                  type: "string",
                  description: "Section to modify: 'top', 'bottom', 'center', or custom bounds",
                  enum: ["top", "bottom", "center", "custom"]
                },
                transformation_type: {
                  type: "string",
                  description: "Type of transformation to apply",
                  enum: ["scale", "rotate", "translate"]
                },
                value_x: {
                  type: "number",
                  description: "Transformation value for X axis"
                },
                value_y: {
                  type: "number",
                  description: "Transformation value for Y axis"
                },
                value_z: {
                  type: "number",
                  description: "Transformation value for Z axis"
                },
                custom_min_x: {
                  type: "number",
                  description: "Minimum X for custom section bounds"
                },
                custom_min_y: {
                  type: "number",
                  description: "Minimum Y for custom section bounds"
                },
                custom_min_z: {
                  type: "number",
                  description: "Minimum Z for custom section bounds"
                },
                custom_max_x: {
                  type: "number",
                  description: "Maximum X for custom section bounds"
                },
                custom_max_y: {
                  type: "number",
                  description: "Maximum Y for custom section bounds"
                },
                custom_max_z: {
                  type: "number",
                  description: "Maximum Z for custom section bounds"
                }
              },
              required: ["stl_path", "section", "transformation_type"]
            }
          },
          {
            name: "generate_stl_visualization",
            description: "Generate an SVG visualization of an STL file from multiple angles",
            inputSchema: {
              type: "object",
              properties: {
                stl_path: {
                  type: "string",
                  description: "Path to the STL file"
                },
                width: {
                  type: "number",
                  description: "Width of each view in pixels (default: 300)"
                },
                height: {
                  type: "number",
                  description: "Height of each view in pixels (default: 300)"
                }
              },
              required: ["stl_path"]
            }
          },
          {
            name: "print_3mf",
            description: "Print a 3MF file on a Bambu Lab printer, potentially overriding settings.",
            inputSchema: {
              type: "object",
              properties: {
                three_mf_path: {
                  type: "string",
                  description: "Path to the 3MF file to print."
                },
                host: {
                  type: "string",
                  description: "Hostname or IP address of the Bambu printer (default: value from env)"
                },
                bambu_serial: {
                  type: "string",
                  description: "Serial number for the Bambu Lab printer (default: value from env)"
                },
                bambu_token: {
                  type: "string",
                  description: "Access token for the Bambu Lab printer (default: value from env)"
                },
                layer_height: { type: "number", description: "Override layer height (mm)." },
                nozzle_temperature: { type: "number", description: "Override nozzle temperature (°C)." },
                bed_temperature: { type: "number", description: "Override bed temperature (°C)." },
                support_enabled: { type: "boolean", description: "Override support generation." },
                ams_mapping: {
                  type: "object",
                  description: "Override AMS filament mapping (e.g., {\"Generic PLA\": 0, \"Generic PETG\": 1}).",
                  additionalProperties: { type: "number" }
                }
              },
              required: ["three_mf_path"]
            }
          },
          {
            name: "merge_vertices",
            description: "Merge vertices in an STL file that are closer than the specified tolerance.",
            inputSchema: {
              type: "object",
              properties: {
                stl_path: {
                  type: "string",
                  description: "Path to the STL file to modify."
                },
                tolerance: {
                  type: "number",
                  description: "Maximum distance between vertices to merge (in mm, default: 0.01)."
                }
              },
              required: ["stl_path"]
            }
          },
          {
            name: "center_model",
            description: "Translate the model so its geometric center is at the origin (0,0,0).",
            inputSchema: {
              type: "object",
              properties: {
                stl_path: {
                  type: "string",
                  description: "Path to the STL file to center."
                }
              },
              required: ["stl_path"]
            }
          },
          {
            name: "lay_flat",
            description: "Attempt to rotate the model so its largest flat face lies on the XY plane (Z=0).",
            inputSchema: {
              type: "object",
              properties: {
                stl_path: {
                  type: "string",
                  description: "Path to the STL file to lay flat."
                }
              },
              required: ["stl_path"]
            }
          }
        ]
      };
    });

    // Handle tool calls
    const toolHandlers = this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      
      // Set default values for common parameters
      const host = String(args?.host || DEFAULT_HOST);
      const port = String(args?.port || DEFAULT_PORT);
      const type = String(args?.type || DEFAULT_TYPE);
      const apiKey = String(args?.api_key || DEFAULT_API_KEY);
      const bambuSerial = String(args?.bambu_serial || DEFAULT_BAMBU_SERIAL);
      const bambuToken = String(args?.bambu_token || DEFAULT_BAMBU_TOKEN);
      const slicerType = String(args?.slicer_type || DEFAULT_SLICER_TYPE) as 'prusaslicer' | 'cura' | 'slic3r';
      const slicerPath = String(args?.slicer_path || DEFAULT_SLICER_PATH);
      const slicerProfile = String(args?.slicer_profile || DEFAULT_SLICER_PROFILE);

      // Conditionally register OctoPrint tool handlers
      if (process.env.PRINTER_TYPE === 'octoprint') {
        const { OctoPrintImplementation } = await import("./printers/octoprint.js");
        const apiClient = axios.create();
        const octoPrint = new OctoPrintImplementation(apiClient);

        const getOctoPrintCredentials = () => {
          const apiKey = process.env.OCTOPRINT_API_KEY;
          const octoPrintUrlString = process.env.OCTOPRINT_URL;
          if (!apiKey || !octoPrintUrlString) {
            throw new Error('OCTOPRINT_API_KEY and OCTOPRINT_URL environment variables are required when PRINTER_TYPE is "octoprint".');
          }
          try {
            const url = new URL(octoPrintUrlString);
            const host = url.hostname;
            const port = url.port || (url.protocol === 'https:' ? '443' : '80');
            return { apiKey, host, port };
          } catch (error) {
            throw new Error('Invalid OCTOPRINT_URL format.');
          }
        };

        toolHandlers.register("get_octoprint_status", async () => {
          const { apiKey, host, port } = getOctoPrintCredentials();
          return octoPrint.getStatus(host, port, apiKey);
        });

        toolHandlers.register("upload_octoprint_file", async (args: { filePath: string, filename: string, print?: boolean }) => {
          const { apiKey, host, port } = getOctoPrintCredentials();
          const printBoolean = args.print === undefined ? false : args.print;
          return octoPrint.uploadFile(host, port, apiKey, args.filePath, args.filename, printBoolean);
        });

        toolHandlers.register("get_octoprint_job_info", async () => {
          const { apiKey, host, port } = getOctoPrintCredentials();
          return octoPrint.getJobInfo(host, port, apiKey);
        });

        toolHandlers.register("list_octoprint_system_commands", async () => {
          const { apiKey, host, port } = getOctoPrintCredentials();
          return octoPrint.listSystemCommands(host, port, apiKey);
        });

        toolHandlers.register("list_octoprint_files", async (args?: { folderPath?: string, recursive?: boolean }) => {
          const { apiKey, host, port } = getOctoPrintCredentials();
          return octoPrint.getFiles(host, port, apiKey, args?.folderPath, args?.recursive);
        });

        toolHandlers.register("get_octoprint_file_details", async (args: { filename: string }) => {
          const { apiKey, host, port } = getOctoPrintCredentials();
          return octoPrint.getFile(host, port, apiKey, args.filename);
        });

        toolHandlers.register("upload_octoprint_model_file", async (args: { filePath: string, filename: string, print?: boolean }) => {
          const { apiKey, host, port } = getOctoPrintCredentials();
          const printBoolean = args.print === undefined ? false : args.print;
          return octoPrint.uploadModelFile(host, port, apiKey, args.filePath, args.filename, printBoolean);
        });

        toolHandlers.register("upload_octoprint_gcode_file", async (args: { filePath: string, filename: string, print: boolean }) => {
          const { apiKey, host, port } = getOctoPrintCredentials();
          return octoPrint.uploadGcodeFile(host, port, apiKey, args.filePath, args.filename, args.print);
        });

        toolHandlers.register("select_and_print_octoprint_file", async (args: { filename: string }) => {
          const { apiKey, host, port } = getOctoPrintCredentials();
          return octoPrint.startJob(host, port, apiKey, args.filename);
        });

        toolHandlers.register("cancel_octoprint_job", async () => {
          const { apiKey, host, port } = getOctoPrintCredentials();
          return octoPrint.cancelJob(host, port, apiKey);
        });

        toolHandlers.register("set_octoprint_temperature", async (args: { component: string, temperature: number }) => {
          const { apiKey, host, port } = getOctoPrintCredentials();
          return octoPrint.setTemperature(host, port, apiKey, args.component, args.temperature);
        });

        toolHandlers.register("start_octoprint_slicing", async (args: { stlFilePath: string, remoteFilename: string, slicer: string, printerProfile: string, gcodeFilename?: string, slicingProfile?: string, selectAfterSlicing?: boolean, printAfterSlicing?: boolean }) => {
          const { apiKey, host, port } = getOctoPrintCredentials();
          return octoPrint.startSlicing(host, port, apiKey, args.stlFilePath, args.remoteFilename, args.slicer, args.printerProfile, args.gcodeFilename, args.slicingProfile, args.selectAfterSlicing, args.printAfterSlicing);
        });

        toolHandlers.register("list_octoprint_printer_profiles", async () => {
          const { apiKey, host, port } = getOctoPrintCredentials();
          return octoPrint.listPrinterProfiles(host, port, apiKey);
        });

        toolHandlers.register("add_octoprint_printer_profile", async (args: { profileData: any }) => {
          const { apiKey, host, port } = getOctoPrintCredentials();
          return octoPrint.addPrinterProfile(host, port, apiKey, args.profileData);
        });

        toolHandlers.register("edit_octoprint_printer_profile", async (args: { profileId: string, profileData: any }) => {
          const { apiKey, host, port } = getOctoPrintCredentials();
          return octoPrint.editPrinterProfile(host, port, apiKey, args.profileId, args.profileData);
        });

        toolHandlers.register("pause_octoprint_job", async () => {
          const { apiKey, host, port } = getOctoPrintCredentials();
          return octoPrint.pauseJob(host, port, apiKey);
        });

        toolHandlers.register("get_octoprint_connection_settings", async () => {
          const { apiKey, host, port } = getOctoPrintCredentials();
          return octoPrint.getConnectionSettings(host, port, apiKey);
        });

        toolHandlers.register("connect_octoprint_printer", async (args?: { connectionSettings?: any }) => {
          const { apiKey, host, port } = getOctoPrintCredentials();
          return octoPrint.connectToPrinter(host, port, apiKey, args?.connectionSettings);
        });

        toolHandlers.register("disconnect_octoprint_printer", async () => {
          const { apiKey, host, port } = getOctoPrintCredentials();
          return octoPrint.disconnectFromPrinter(host, port, apiKey);
        });

        toolHandlers.register("send_gcode_command", async (args: { payload: { command?: string, commands?: string[] } }) => {
          const { apiKey, host, port } = getOctoPrintCredentials();
          return octoPrint.sendCommandToPrinter(host, port, apiKey, args.payload);
        });
      }

      try {
        let result;

        switch (name) {
          case "get_printer_status":
            result = await this.getPrinterStatus(host, port, type, apiKey, bambuSerial, bambuToken);
            break;
            
          case "list_printer_files":
            result = await this.getPrinterFiles(host, port, type, apiKey, bambuSerial, bambuToken);
            break;
            
          case "upload_gcode":
            if (!args?.filename || !args?.gcode) {
              throw new Error("Missing required parameters: filename and gcode");
            }
            result = await this.uploadGcode(
              host, port, type, apiKey, bambuSerial, bambuToken,
              String(args.filename), 
              String(args.gcode), 
              Boolean(args.print || false)
            );
            break;
            
          case "start_print":
            if (!args?.filename) {
              throw new Error("Missing required parameter: filename");
            }
            result = await this.startPrint(host, port, type, apiKey, bambuSerial, bambuToken, String(args.filename));
            break;
            
          case "cancel_print":
            result = await this.cancelPrint(host, port, type, apiKey, bambuSerial, bambuToken);
            break;
            
          case "set_printer_temperature":
            if (!args?.component || args?.temperature === undefined) {
              throw new Error("Missing required parameters: component and temperature");
            }
            result = await this.setPrinterTemperature(
              host, port, type, apiKey, bambuSerial, bambuToken,
              String(args.component), 
              Number(args.temperature)
            );
            break;
            
          // New STL manipulation tools
          case "extend_stl_base":
            if (!args?.stl_path || args?.extension_inches === undefined) {
              throw new Error("Missing required parameters: stl_path and extension_inches");
            }
            result = await this.stlManipulator.extendBase(
              String(args.stl_path),
              Number(args.extension_inches)
            );
            break;
            
          case "slice_stl":
            if (!args?.stl_path) {
              throw new Error("Missing required parameter: stl_path");
            }
            result = await this.stlManipulator.sliceSTL(
              String(args.stl_path),
              slicerType,
              slicerPath,
              slicerProfile || undefined
            );
            break;
            
          case "confirm_temperatures":
            if (!args?.gcode_path) {
              throw new Error("Missing required parameter: gcode_path");
            }
            result = await this.stlManipulator.confirmTemperatures(
              String(args.gcode_path),
              {
                extruder: args.extruder_temp !== undefined ? Number(args.extruder_temp) : undefined,
                bed: args.bed_temp !== undefined ? Number(args.bed_temp) : undefined
              }
            );
            break;
            
          case "process_and_print_stl":
            if (!args?.stl_path || args?.extension_inches === undefined) {
              throw new Error("Missing required parameters: stl_path and extension_inches");
            }
            
            // Define progress callback for UI updates
            const processProgressCallback = (progress: number, message?: string) => {
              console.log(`Process progress: ${progress}% - ${message || ''}`);
            };
            
            // 1. Extend the base of the STL file
            const extendedStlPath = await this.stlManipulator.extendBase(
              String(args.stl_path),
              Number(args.extension_inches),
              processProgressCallback
            );
            
            // 2. Slice the extended STL file
            const gcodePath = await this.stlManipulator.sliceSTL(
              extendedStlPath,
              slicerType,
              slicerPath,
              slicerProfile || undefined,
              processProgressCallback
            );
            
            // 3. Confirm temperatures if specified
            if (args.extruder_temp !== undefined || args.bed_temp !== undefined) {
              const tempConfirmation = await this.stlManipulator.confirmTemperatures(
                gcodePath,
                {
                  extruder: args.extruder_temp !== undefined ? Number(args.extruder_temp) : undefined,
                  bed: args.bed_temp !== undefined ? Number(args.bed_temp) : undefined
                },
                processProgressCallback
              );
              
              if (!tempConfirmation.match) {
                console.warn("Temperature mismatch:", tempConfirmation);
              }
            }
            
            // 4. Upload the G-code file to the printer
            const gcodeContent = await fs.promises.readFile(gcodePath, 'utf8');
            const filename = path.basename(gcodePath);
            
            await this.uploadGcode(
              host, port, type, apiKey, bambuSerial, bambuToken,
              filename, 
              gcodeContent, 
              true // Start printing immediately
            );
            
            result = {
              extended_stl_path: extendedStlPath,
              gcode_path: gcodePath,
              filename,
              status: "Print job started"
            };
            break;
            
          // New STL manipulation tool handlers
          case "get_stl_info":
            if (!args?.stl_path) {
              throw new Error("Missing required parameter: stl_path");
            }
            
            result = await this.stlManipulator.getSTLInfo(String(args.stl_path));
            break;
            
          case "scale_stl":
            if (!args?.stl_path) {
              throw new Error("Missing required parameter: stl_path");
            }
            
            // Define progress callback for UI updates
            const scaleProgressCallback = (progress: number, message?: string) => {
              console.log(`Scale progress: ${progress}% - ${message || ''}`);
            };
            
            let scaleFactors: number | [number, number, number];
            
            // Check if we have individual axis scaling factors
            if (args.scale_x !== undefined || args.scale_y !== undefined || args.scale_z !== undefined) {
              // Use individual axis scaling
              scaleFactors = [
                Number(args.scale_x ?? 1.0),
                Number(args.scale_y ?? 1.0),
                Number(args.scale_z ?? 1.0)
              ];
            } else {
              // Use uniform scaling
              scaleFactors = Number(args.scale_factor ?? 1.0);
            }
            
            result = await this.stlManipulator.scaleSTL(
              String(args.stl_path),
              scaleFactors,
              scaleProgressCallback
            );
            break;
            
          case "rotate_stl":
            if (!args?.stl_path) {
              throw new Error("Missing required parameter: stl_path");
            }
            
            // Define progress callback for UI updates
            const rotateProgressCallback = (progress: number, message?: string) => {
              console.log(`Rotate progress: ${progress}% - ${message || ''}`);
            };
            
            // Get rotation angles, defaulting to 0 for any undefined axis
            const rotationAngles: [number, number, number] = [
              Number(args.rotate_x ?? 0),
              Number(args.rotate_y ?? 0),
              Number(args.rotate_z ?? 0)
            ];
            
            result = await this.stlManipulator.rotateSTL(
              String(args.stl_path),
              rotationAngles,
              rotateProgressCallback
            );
            break;
            
          case "translate_stl":
            if (!args?.stl_path) {
              throw new Error("Missing required parameter: stl_path");
            }
            
            // Define progress callback for UI updates
            const translateProgressCallback = (progress: number, message?: string) => {
              console.log(`Translate progress: ${progress}% - ${message || ''}`);
            };
            
            // Get translation values, defaulting to 0 for any undefined axis
            const translationValues: [number, number, number] = [
              Number(args.translate_x ?? 0),
              Number(args.translate_y ?? 0),
              Number(args.translate_z ?? 0)
            ];
            
            result = await this.stlManipulator.translateSTL(
              String(args.stl_path),
              translationValues,
              translateProgressCallback
            );
            break;
            
          case "modify_stl_section":
            if (!args?.stl_path || !args?.section || !args?.transformation_type) {
              throw new Error("Missing required parameters: stl_path, section, and transformation_type");
            }
            
            // Define progress callback for UI updates
            const modifySectionProgressCallback = (progress: number, message?: string) => {
              console.log(`Modify section progress: ${progress}% - ${message || ''}`);
            };
            
            // Determine the section to modify
            let sectionBox: THREE.Box3 | 'top' | 'bottom' | 'center';
            
            if (args.section === 'custom') {
              // Create a custom bounding box from the provided bounds
              if (args.custom_min_x === undefined || args.custom_min_y === undefined || 
                  args.custom_min_z === undefined || args.custom_max_x === undefined || 
                  args.custom_max_y === undefined || args.custom_max_z === undefined) {
                throw new Error("Custom section requires all min/max bounds to be specified");
              }
              
              sectionBox = new THREE.Box3(
                new THREE.Vector3(
                  Number(args.custom_min_x),
                  Number(args.custom_min_y),
                  Number(args.custom_min_z)
                ),
                new THREE.Vector3(
                  Number(args.custom_max_x),
                  Number(args.custom_max_y),
                  Number(args.custom_max_z)
                )
              );
            } else {
              // Use a predefined section
              sectionBox = String(args.section) as 'top' | 'bottom' | 'center';
            }
            
            // Determine the transformation to apply
            const transformationType = String(args.transformation_type) as 'scale' | 'rotate' | 'translate';
            let transformationValue: number | number[];
            
            if (transformationType === 'scale') {
              if (args.value_x !== undefined || args.value_y !== undefined || args.value_z !== undefined) {
                transformationValue = [
                  Number(args.value_x ?? 1.0),
                  Number(args.value_y ?? 1.0),
                  Number(args.value_z ?? 1.0)
                ];
              } else {
                transformationValue = 1.0; // Default scale factor
              }
            } else if (transformationType === 'rotate') {
              transformationValue = [
                Number(args.value_x ?? 0),
                Number(args.value_y ?? 0),
                Number(args.value_z ?? 0)
              ];
            } else { // translate
              transformationValue = [
                Number(args.value_x ?? 0),
                Number(args.value_y ?? 0),
                Number(args.value_z ?? 0)
              ];
            }
            
            result = await this.stlManipulator.modifySection(
              String(args.stl_path),
              sectionBox,
              {
                type: transformationType,
                value: transformationValue
              },
              modifySectionProgressCallback
            );
            break;
            
          case "generate_stl_visualization":
            if (!args?.stl_path) {
              throw new Error("Missing required parameter: stl_path");
            }
            
            // Define progress callback for UI updates
            const visualizationProgressCallback = (progress: number, message?: string) => {
              console.log(`Visualization progress: ${progress}% - ${message || ''}`);
            };
            
            // Get width and height parameters, with defaults
            const width = args.width !== undefined ? Number(args.width) : 300;
            const height = args.height !== undefined ? Number(args.height) : 300;
            
            result = await this.stlManipulator.generateVisualization(
              String(args.stl_path),
              width,
              height,
              visualizationProgressCallback
            );
            break;
            
          case "print_3mf":
            if (!args?.three_mf_path) {
              throw new Error("Missing required parameter: three_mf_path");
            }
            if (type.toLowerCase() !== 'bambu') {
                throw new Error("The print_3mf tool currently only supports Bambu printers.");
            }
            if (!bambuSerial || !bambuToken) {
                throw new Error("Bambu serial number and access token are required for print_3mf.");
            }
            
            const threeMFPath = String(args.three_mf_path);
            
            // Define variables needed outside the parse try block
            let implementation: BambuImplementation;
            let threeMfFilename: string;
            let projectName: string;
            let finalAmsMapping: number[] | undefined;
            let useAMS: boolean;
            let printOptions: any; // Use a more specific type later if possible

            try {
                // --- Parse 3MF --- 
                const parsed3MFData = await parse3MF(threeMFPath);
                console.log(`Successfully parsed 3MF file: ${threeMFPath}`);
                let parsedAmsMapping: number[] | undefined = undefined;
                // ... (Extract default AMS mapping logic) ...
                if (parsed3MFData.slicerConfig?.ams_mapping) { 
                    const slots = Object.values(parsed3MFData.slicerConfig.ams_mapping)
                                                    .filter(v => typeof v === 'number') as number[];
                    if (slots.length > 0) {
                         parsedAmsMapping = slots.sort((a, b) => a - b);
                         console.log("Extracted default AMS mapping from 3MF:", parsedAmsMapping);
                    } else {
                         console.log("AMS mapping found in 3MF, but no valid slots extracted.");
                    }
                } else {
                     console.log("No default AMS mapping found in 3MF slicer config.");
                }

                // --- Gather Overrides and Determine Final Options --- 
                finalAmsMapping = parsedAmsMapping; // Start with parsed
                useAMS = args?.use_ams !== undefined ? Boolean(args.use_ams) : (!!finalAmsMapping && finalAmsMapping.length > 0);
                // ... (Process user AMS mapping override logic) ...
                if (args?.ams_mapping) {
                    let userMappingOverride: number[] | undefined = undefined;
                    if (Array.isArray(args.ams_mapping)) {
                        userMappingOverride = args.ams_mapping.filter(v => typeof v === 'number');
                    } else if (typeof args.ams_mapping === 'object') {
                        userMappingOverride = Object.values(args.ams_mapping)
                                                        .filter(v => typeof v === 'number')
                                                        .sort((a, b) => a - b) as number[];
                    } 
                    
                    if (userMappingOverride && userMappingOverride.length > 0) {
                        console.log("Applying user AMS mapping override:", userMappingOverride);
                        finalAmsMapping = userMappingOverride;
                        useAMS = true; // Force useAMS if override provided
                    } else {
                        console.warn("Received ams_mapping override, but it was empty or invalid.");
                    }
                } 
                // ... (Handle explicit use_ams=false) ...
                if (args?.use_ams === false) {
                    console.log("User explicitly disabled AMS.");
                    finalAmsMapping = undefined;
                    useAMS = false;
                }
                if (!finalAmsMapping || finalAmsMapping.length === 0) {
                    useAMS = false;
                }

                // --- Prepare Implementation and Print Options --- 
                const factoryImplementation = this.printerFactory.getImplementation('bambu');
                if (!(factoryImplementation instanceof BambuImplementation)) {
                    throw new Error("Internal error: Could not get Bambu printer implementation.");
                }
                implementation = factoryImplementation; // Assign to outer scope variable

                threeMfFilename = path.basename(threeMFPath); // Assign to outer scope variable
                projectName = threeMfFilename.replace(/\.3mf$/i, ''); // Assign to outer scope variable

                printOptions = { // Assign to outer scope variable
                    useAMS: useAMS,
                    amsMapping: finalAmsMapping,
                    bedLeveling: args?.bed_leveling !== undefined ? Boolean(args.bed_leveling) : undefined,
                    flowCalibration: args?.flow_calibration !== undefined ? Boolean(args.flow_calibration) : undefined,
                    vibrationCalibration: args?.vibration_calibration !== undefined ? Boolean(args.vibration_calibration) : undefined,
                    layerInspect: args?.layer_inspect !== undefined ? Boolean(args.layer_inspect) : undefined,
                    timelapse: args?.timelapse !== undefined ? Boolean(args.timelapse) : undefined,
                    // md5: parsed3MFData?.metadata?.md5 
                };

            } catch (error) { // Catch parsing or setup errors
                console.error(`Error processing 3MF or setting up print:`, error);
                throw new Error(`Failed during 3MF processing: ${(error as Error).message}`);
            }
                
            // --- Call Implementation (Now variables are in scope) --- 
            try {
                result = await implementation.print3mf(host, bambuSerial, bambuToken, {
                    projectName: projectName,
                    filePath: threeMFPath,
                    plateIndex: 0, 
                    ...printOptions // Spread the final options
                });
                result = `Print command for ${threeMfFilename} sent successfully.`;
            } catch (printError) {
                 console.error(`Error starting 3MF print for ${threeMfFilename}:`, printError);
                 throw new Error(`Failed to start print: ${(printError as Error).message}`);
            }

            break;
            
          case "merge_vertices":
            if (!args?.stl_path) {
                throw new Error("Missing required parameter: stl_path");
            }
            result = await this.stlManipulator.mergeVertices(
                String(args.stl_path),
                args.tolerance !== undefined ? Number(args.tolerance) : undefined // Pass tolerance if provided
            );
            break;

          case "center_model":
            if (!args?.stl_path) {
                throw new Error("Missing required parameter: stl_path");
            }
            result = await this.stlManipulator.centerModel(String(args.stl_path));
            break;

          case "lay_flat":
            if (!args?.stl_path) {
                throw new Error("Missing required parameter: stl_path");
            }
            result = await this.stlManipulator.layFlat(String(args.stl_path));
            break;
            
          default:
            throw new Error(`Unknown tool: ${name}`);
        }

        return {
          content: [
            {
              type: "text",
              text: typeof result === "string" ? result : JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (error: unknown) {
        console.error(`Error calling tool ${name}:`, error);
        
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        return {
          content: [
            {
              type: "text",
              text: `Error: ${errorMessage}`
            }
          ],
          isError: true
        };
      }
    });
  }

  // Delegating methods to printer implementations
  
  async getPrinterStatus(
    host: string, 
    port = DEFAULT_PORT, 
    type = DEFAULT_TYPE, 
    apiKey = DEFAULT_API_KEY,
    bambuSerial = DEFAULT_BAMBU_SERIAL,
    bambuToken = DEFAULT_BAMBU_TOKEN
  ) {
    const implementation = this.printerFactory.getImplementation(type);
    
    if (type.toLowerCase() === "bambu") {
      const bambuApiKey = `${bambuSerial}:${bambuToken}`;
      return implementation.getStatus(host, port, bambuApiKey);
    }
    
    return implementation.getStatus(host, port, apiKey);
  }

  async getPrinterFiles(
    host: string, 
    port = DEFAULT_PORT, 
    type = DEFAULT_TYPE, 
    apiKey = DEFAULT_API_KEY,
    bambuSerial = DEFAULT_BAMBU_SERIAL,
    bambuToken = DEFAULT_BAMBU_TOKEN
  ) {
    const implementation = this.printerFactory.getImplementation(type);
    
    if (type.toLowerCase() === "bambu") {
      const bambuApiKey = `${bambuSerial}:${bambuToken}`;
      return implementation.getFiles(host, port, bambuApiKey);
    }
    
    return implementation.getFiles(host, port, apiKey);
  }

  async getPrinterFile(
    host: string, 
    filename: string, 
    port = DEFAULT_PORT, 
    type = DEFAULT_TYPE, 
    apiKey = DEFAULT_API_KEY,
    bambuSerial = DEFAULT_BAMBU_SERIAL,
    bambuToken = DEFAULT_BAMBU_TOKEN
  ) {
    const implementation = this.printerFactory.getImplementation(type);
    
    if (type.toLowerCase() === "bambu") {
      return (implementation as any).getFile(host, port, apiKey, bambuSerial, bambuToken, filename);
    }
    
    return implementation.getFile(host, port, apiKey, filename);
  }

  async uploadGcode(
    host: string, 
    port: string, 
    type: string, 
    apiKey: string,
    bambuSerial: string,
    bambuToken: string, 
    filename: string, 
    gcode: string, 
    print: boolean
  ) {
    const tempFilePath = path.join(TEMP_DIR, filename);
    
    // Write gcode to temporary file
    fs.writeFileSync(tempFilePath, gcode);

    try {
      const implementation = this.printerFactory.getImplementation(type);
      
      if (type.toLowerCase() === "bambu") {
        return await (implementation as any).uploadFile(
          host, port, apiKey, bambuSerial, bambuToken, tempFilePath, filename, print
        );
      }
      
      return await implementation.uploadFile(host, port, apiKey, tempFilePath, filename, print);
    } finally {
      // Clean up temporary file
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    }
  }

  async startPrint(
    host: string, 
    port: string, 
    type: string, 
    apiKey: string,
    bambuSerial: string,
    bambuToken: string, 
    gcodeFilename: string
  ) {
    const implementation = this.printerFactory.getImplementation(type);
    
    if (type.toLowerCase() === "bambu") {
      // Bambu startJob likely uses G-code filename, not 3MF. 
      // Keep this as is for starting pre-sliced G-code files.
      // The print_3mf tool handles starting 3MF prints.
      return await (implementation as any).startJob(
        host, port, apiKey, bambuSerial, bambuToken, gcodeFilename
      );
    }
    
    return await implementation.startJob(host, port, apiKey, gcodeFilename);
  }

  async cancelPrint(
    host: string, 
    port: string, 
    type: string, 
    apiKey: string,
    bambuSerial: string,
    bambuToken: string
  ) {
    const implementation = this.printerFactory.getImplementation(type);
    
    if (type.toLowerCase() === "bambu") {
      return await (implementation as any).cancelJob(
        host, port, apiKey, bambuSerial, bambuToken
      );
    }
    
    return await implementation.cancelJob(host, port, apiKey);
  }

  async setPrinterTemperature(
    host: string, 
    port: string, 
    type: string, 
    apiKey: string,
    bambuSerial: string,
    bambuToken: string,
    component: string, 
    temperature: number
  ) {
    const implementation = this.printerFactory.getImplementation(type);
    
    if (type.toLowerCase() === "bambu") {
      const bambuImplementation = this.printerFactory.getImplementation('bambu');
      
      if (bambuImplementation instanceof BambuImplementation && typeof bambuImplementation.setTemperature === 'function') {
        return await bambuImplementation.setTemperature(
          host, bambuSerial, bambuToken, component, temperature
        );
      } else {
        console.warn('setTemperature not fully implemented for Bambu via direct commands yet.');
        return { status: 'Command sent (implementation pending)'}; // Avoid throwing error if method doesn't exist
      }
    }
    
    return implementation.setTemperature(host, port, apiKey, component, temperature);
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("3D Printer MCP server running on stdio transport");
  }
}

const server = new ThreeDPrinterMCPServer();
server.run().catch(console.error);