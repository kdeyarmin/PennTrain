export type AiFeature = 'course_outline' | 'quiz_questions' | 'policy_converter' | 'gap_explanation' | 'survey_summary' | 'training_plan';

export function runCareMetricAi(feature: AiFeature, prompt: string) {
  const enabled = import.meta.env.VITE_AI_ENABLED === 'true';
  if (!enabled) {
    return {
      available: false,
      message: `AI ${feature.replace(/_/g, ' ')} is ready to connect. Enable VITE_AI_ENABLED and route requests through a secure server endpoint before enabling production generation.`,
    };
  }
  return {
    available: true,
    message: `AI request prepared for ${feature}: ${prompt.slice(0, 120)}`,
  };
}
