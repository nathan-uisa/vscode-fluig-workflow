export interface ProcessItemSummary {
  processId: string;
  processDescription: string;
  version: number;
  active?: boolean;
}

export interface ProcessEventItem {
  eventId: string;
  eventName: string;
  eventDescription?: string;
  code?: string;
}

export interface ProcessDetail {
  processId: string;
  processDescription: string;
  version: number;
  formId?: number;
  formVersion?: number;
  events?: ProcessEventItem[];
}

export interface ExportProcessPlan {
  processId: string;
  processPath: string;
  ecm30Path: string;
  svgPath: string;
  version?: number;
  newProcess: boolean;
  release: boolean;
  steps: string[];
}

export interface ExportProcessResult {
  success: boolean;
  processId: string;
  version: number;
  isNewProcess: boolean;
  released: boolean;
  message?: string;
}
