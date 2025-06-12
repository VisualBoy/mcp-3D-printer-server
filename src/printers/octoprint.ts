import { PrinterImplementation } from "../types.js";
import fs from "fs";
import FormData from "form-data";

export class OctoPrintImplementation extends PrinterImplementation {
  async getStatus(host: string, port: string, apiKey: string) {
    const url = `http://${host}:${port}/api/printer`;
    const response = await this.apiClient.get(url, {
      headers: {
        "X-Api-Key": apiKey
      }
    });
    return response.data;
  }

  async uploadFile(host: string, port: string, apiKey: string, filePath: string, filename: string, print: boolean = false): Promise<any> {
    const lowerFilename = filename.toLowerCase();
    if (lowerFilename.endsWith(".stl") || lowerFilename.endsWith(".3mf")) {
      // Assume model files might not always be printed, so print is explicitly passed.
      // However, uploadModelFile has a default for print if not provided, this ensures explicitness.
      return this.uploadModelFile(host, port, apiKey, filePath, filename, print);
    } else if (lowerFilename.endsWith(".gcode") || lowerFilename.endsWith(".gco") || lowerFilename.endsWith(".g")) {
      // uploadGcodeFile requires the print parameter.
      return this.uploadGcodeFile(host, port, apiKey, filePath, filename, print);
    } else {
      // Potentially, we could try a generic upload to /api/files/local if OctoPrint supports it
      // without specific content type validation for unknown types, or simply reject.
      // For now, rejecting unknown types seems safer.
      return Promise.reject(new Error(`Unsupported file type for uploadFile: ${filename}. Only .stl, .3mf, and .gcode/.gco/.g are supported.`));
    }
  }

  async getJobInfo(host: string, port: string, apiKey: string) {
    const url = `http://${host}:${port}/api/job`;
    const response = await this.apiClient.get(url, {
      headers: {
        "X-Api-Key": apiKey
      }
    });
    return response.data;
  }

  // Ensure listSystemCommands and other methods follow, maintaining logical grouping if possible.
  // The previous diff showed getJobInfo was added before listSystemCommands.
  // The new uploadFile method is added before getJobInfo.

  async listSystemCommands(host: string, port: string, apiKey: string) {
    const url = `http://${host}:${port}/api/system/commands`;
    const response = await this.apiClient.get(url, {
      headers: {
        "X-Api-Key": apiKey
      }
    });
    return response.data;
  }

  async getFiles(host: string, port: string, apiKey: string, folderPath?: string, recursive: boolean = false) {
    // Base URL for local files, always targets the 'local' location.
    // /api/files without a location shows all files from all origins.
    // /api/files/{location} shows files from a specific origin. We default to 'local'.
    let effectiveApiPath = 'local';
    if (folderPath && folderPath.trim() !== '') {
      // Append user-provided path, ensuring no leading/trailing slashes issues from folderPath
      // and that it's correctly joined.
      const cleanedPath = folderPath.split('/').filter(p => p.length > 0).join('/');
      if (cleanedPath) { // Ensure cleanedPath is not empty
        effectiveApiPath += '/' + cleanedPath;
      }
    }

    // Use URL object for robust construction and adding query parameters
    const urlObj = new URL(`http://${host}:${port}/api/files/${effectiveApiPath}`);

    if (recursive) {
      urlObj.searchParams.append("recursive", "true");
    }

    const url = urlObj.toString();

    const response = await this.apiClient.get(url, {
      headers: {
        "X-Api-Key": apiKey
      }
    });
    return response.data;
  }

  async getFile(host: string, port: string, apiKey: string, filename: string) {
    const url = `http://${host}:${port}/api/files/local/${filename}`;
    const response = await this.apiClient.get(url, {
      headers: {
        "X-Api-Key": apiKey
      }
    });
    return response.data;
  }

  async uploadModelFile(host: string, port: string, apiKey: string, filePath: string, filename: string, print: boolean = false) {
    const url = `http://${host}:${port}/api/files/local`;
    const formData = new FormData();
    let contentType = "";
    if (filename.toLowerCase().endsWith(".stl")) {
      contentType = "model/stl";
    } else if (filename.toLowerCase().endsWith(".3mf")) {
      contentType = "model/3mf";
    } else {
      throw new Error("Unsupported file type for uploadModelFile. Only STL and 3MF are allowed.");
    }

    formData.append("file", fs.createReadStream(filePath), { filename: filename, contentType: contentType });
    
    if (print) {
      formData.append("print", "true");
    }
    
    const response = await this.apiClient.post(url, formData, { // Removed 'as any'
      headers: {
        "X-Api-Key": apiKey,
        ...formData.getHeaders()
      }
    });
    return response.data;
  }

  async uploadGcodeFile(host: string, port: string, apiKey: string, filePath: string, filename: string, print: boolean) {
    const url = `http://${host}:${port}/api/files/local`;

    const formData = new FormData();
    // For G-code, OctoPrint relies on the file extension. Set a generic content type.
    const contentType = "application/octet-stream";
    formData.append("file", fs.createReadStream(filePath), { filename, contentType });

    if (print) {
      formData.append("print", "true");
    }

    const response = await this.apiClient.post(url, formData, {
      headers: {
        "X-Api-Key": apiKey,
        ...formData.getHeaders(), // This will set the Content-Type for the overall request to multipart/form-data
      }
    });
    
    return response.data;
  }

  async startJob(host: string, port: string, apiKey: string, filename: string) {
    const url = `http://${host}:${port}/api/files/local/${filename}`;
    
    const response = await this.apiClient.post(url, {
      command: "select",
      print: true
    }, {
      headers: {
        "X-Api-Key": apiKey,
        "Content-Type": "application/json"
      }
    });
    
    return response.data;
  }

  async cancelJob(host: string, port: string, apiKey: string) {
    const url = `http://${host}:${port}/api/job`;
    
    const response = await this.apiClient.post(url, {
      command: "cancel"
    }, {
      headers: {
        "X-Api-Key": apiKey,
        "Content-Type": "application/json"
      }
    });
    
    return response.data;
  }

  async setTemperature(host: string, port: string, apiKey: string, component: string, temperature: number) {
    let url = `http://${host}:${port}/api/printer/tool`;
    
    const data: Record<string, any> = {};
    if (component === "bed") {
      data.command = "target";
      data.target = temperature;
      url = `http://${host}:${port}/api/printer/bed`;
    } else if (component.startsWith("extruder")) {
      data.command = "target";
      data.targets = {};
      data.targets[component] = temperature;
    } else {
      throw new Error(`Unsupported component: ${component}`);
    }
    
    const response = await this.apiClient.post(url, data as any, {
      headers: {
        "X-Api-Key": apiKey,
        "Content-Type": "application/json"
      }
    });
    
    return response.data;
  }

  async startSlicing(
    host: string,
    port: string,
    apiKey: string,
    stlFilePath: string, // Local path to the STL file
    remoteFilename: string, // Desired filename on OctoPrint server (e.g., "my_model.stl")
    slicer: string,
    printerProfile: string,
    gcodeFilename?: string, // Optional: name for the output gcode file
    slicingProfile?: string, // Optional: name of the slicing profile to use
    selectAfterSlicing: boolean = false, // Optional: select the file after slicing
    printAfterSlicing: boolean = false // Optional: print the file after slicing
  ) {
    // Step 1: Upload the STL file
    // We assume uploadModelFile returns an object that might contain info about the uploaded file,
    // but the slice command will refer to it by remoteFilename at /api/files/local/remoteFilename.
    // The `uploadModelFile` function now handles the POST to /api/files/local for models.
    await this.uploadModelFile(host, port, apiKey, stlFilePath, remoteFilename, false); // print = false

    // Step 2: Issue the slice command for the uploaded file
    const sliceCommandUrl = `http://${host}:${port}/api/files/local/${remoteFilename}`;

    const slicePayload: Record<string, any> = {
      command: "slice",
      slicer: slicer,
      printerProfile: printerProfile,
      select: selectAfterSlicing,
      print: printAfterSlicing,
    };

    if (gcodeFilename) {
      slicePayload.gcode = gcodeFilename;
    }
    if (slicingProfile) {
      slicePayload.profile = slicingProfile;
    }
    // According to OctoPrint docs, other options like 'position', 'profile.*' (overrides) can be added here.

    const response = await this.apiClient.post(sliceCommandUrl, slicePayload, {
      headers: {
        "X-Api-Key": apiKey,
        "Content-Type": "application/json",
      }
    });

    return response.data;
  }

  async listPrinterProfiles(host: string, port: string, apiKey: string) {
    const url = `http://${host}:${port}/api/printerprofiles`;
    const response = await this.apiClient.get(url, {
      headers: { "X-Api-Key": apiKey }
    });
    return response.data;
  }

  async addPrinterProfile(host: string, port: string, apiKey: string, profileData: any) {
    const url = `http://${host}:${port}/api/printerprofiles`;
    const response = await this.apiClient.post(url, profileData, {
      headers: {
        "X-Api-Key": apiKey,
        "Content-Type": "application/json"
      }
    });
    return response.data;
  }

  async editPrinterProfile(host: string, port: string, apiKey: string, profileId: string, profileData: any) {
    const url = `http://${host}:${port}/api/printerprofiles/${profileId}`;
    const response = await this.apiClient.put(url, profileData, {
      headers: {
        "X-Api-Key": apiKey,
        "Content-Type": "application/json"
      }
    });
    return response.data;
  }

  async pauseJob(host: string, port: string, apiKey: string) {
    const url = `http://${host}:${port}/api/job`;
    const response = await this.apiClient.post(url, {
      command: "pause",
      action: "toggle"
    }, {
      headers: {
        "X-Api-Key": apiKey,
        "Content-Type": "application/json"
      }
    });
    return response.data;
  }

  async getConnectionSettings(host: string, port: string, apiKey: string) {
    const url = `http://${host}:${port}/api/connection`;
    const response = await this.apiClient.get(url, {
      headers: {
        "X-Api-Key": apiKey
      }
    });
    return response.data;
  }

  async connectToPrinter(host: string, port: string, apiKey: string, connectionSettings?: any) {
    const url = `http://${host}:${port}/api/connection`;
    const payload: any = {
      command: "connect"
    };
    if (connectionSettings) {
      // Optional parameters as per OctoPrint documentation:
      // port (serial port), baudrate, printerProfile, save, autoconnect
      if (connectionSettings.port) payload.port = connectionSettings.port;
      if (connectionSettings.baudrate) payload.baudrate = connectionSettings.baudrate;
      if (connectionSettings.printerProfile) payload.printerProfile = connectionSettings.printerProfile;
      if (typeof connectionSettings.save === 'boolean') payload.save = connectionSettings.save;
      if (typeof connectionSettings.autoconnect === 'boolean') payload.autoconnect = connectionSettings.autoconnect;
    }
    const response = await this.apiClient.post(url, payload, {
      headers: {
        "X-Api-Key": apiKey,
        "Content-Type": "application/json"
      }
    });
    // OctoPrint API returns 204 No Content on successful connect/disconnect
    // For consistency, we can return a success message or the status code
    return { status: response.status, data: response.data };
  }

  async disconnectFromPrinter(host: string, port: string, apiKey: string) {
    const url = `http://${host}:${port}/api/connection`;
    const payload = {
      command: "disconnect"
    };
    const response = await this.apiClient.post(url, payload, {
      headers: {
        "X-Api-Key": apiKey,
        "Content-Type": "application/json"
      }
    });
    return { status: response.status, data: response.data };
  }

  async sendCommandToPrinter(host: string, port: string, apiKey: string, payload: { command?: string, commands?: string[] }) {
    const url = `http://${host}:${port}/api/printer/command`;
    const response = await this.apiClient.post(url, payload, {
      headers: {
        "X-Api-Key": apiKey,
        "Content-Type": "application/json"
      }
    });
    return response.data;
  }
}
