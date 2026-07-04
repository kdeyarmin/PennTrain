export type AiFeature = 'course_outline' | 'quiz_questions' | 'policy_converter' | 'gap_explanation' | 'survey_summary' | 'training_plan';

export function runCareMetricAi(feature: AiFeature, prompt: string) {
  if (!import.meta.env.VITE_OPENAI_API_KEY) {
    return {
      available: false,
      message: `AI ${feature.replace(/_/g, ' ')} is ready to connect. Add VITE_OPENAI_API_KEY and route requests through a secure server endpoint before enabling production generation.`,
    };
  }
  return {
    available: true,
    message: `AI request prepared for ${feature}: ${prompt.slice(0, 120)}`,
  };
}
