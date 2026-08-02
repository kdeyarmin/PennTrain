export interface CourseFormState {
  title: string;
  description: string;
  category: string;
  status: string;
  trainingTypeId: string;
}

export const NO_TRAINING_TYPE = "none";
export const NO_DOCUMENT = "none";

export interface BlockFormState {
  block_type: "text" | "video" | "pdf" | "scorm" | "quiz";
  title: string;
  textContent: string;
  videoUrl: string;
  videoTranscript: string;
  documentId: string;
}

export const EMPTY_BLOCK_FORM: BlockFormState = {
  block_type: "text",
  title: "",
  textContent: "",
  videoUrl: "",
  videoTranscript: "",
  documentId: "",
};

export interface QuizFormState {
  title: string;
  passingScore: string;
  maxAttempts: string;
}
