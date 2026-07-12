import type { UploadStep } from "./uploadPipeline";

export type UploadMode = "zip" | "folder" | "file";

export interface SelectedArtifact {
  mode: UploadMode;
  name: string;
  size: number;
}

export const UPLOAD_FLOW_STEPS: UploadStep[] = [
  "creating_task",
  "uploading_raw",
  "processing",
  "done",
];

export function getUploadProgressPercent(step: UploadStep) {
  switch (step) {
    case "zipping":
      return 10;
    case "creating_task":
      return 30;
    case "uploading_raw":
      return 60;
    case "processing":
      return 85;
    case "done":
      return 100;
    default:
      return 0;
  }
}

export function getComparableUploadStep(step: UploadStep) {
  return step === "zipping" ? "creating_task" : step;
}

export function getUploadStepState(step: UploadStep, currentStep: UploadStep, failedStep?: UploadStep) {
  const current = getComparableUploadStep(currentStep);
  const failed = failedStep ? getComparableUploadStep(failedStep) : undefined;
  const failedIndex = failed ? UPLOAD_FLOW_STEPS.indexOf(failed) : -1;
  const currentIndex = currentStep === "error" && failedIndex >= 0 ? failedIndex : UPLOAD_FLOW_STEPS.indexOf(current);
  const stepIndex = UPLOAD_FLOW_STEPS.indexOf(step);

  return {
    completed: currentStep === "done" || (currentIndex >= 0 && stepIndex < currentIndex),
    current: currentStep !== "done" && stepIndex === currentIndex,
    errored: currentStep === "error" && stepIndex === (failedIndex >= 0 ? failedIndex : 0),
  };
}

export function formatUploadSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
