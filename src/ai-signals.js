const AI_PATTERNS = [
  ['Stable Diffusion', /stable[\s_-]*diffusion/i],
  ['ComfyUI', /\bcomfyui\b/i],
  ['Automatic1111', /automatic\s*1111|a1111/i],
  ['InvokeAI', /\binvokeai\b/i],
  ['Fooocus', /\bfooocus\b/i],
  ['NovelAI', /\bnovelai\b/i],
  ['AI workflow', /\bworkflow\b|\bnode graph\b/i],
  ['Prompt', /\bnegative prompt\b|\bprompt\b/i],
  ['Generation parameters', /\bparameters\b|\bsampler\b|\bscheduler\b|\bcfg(?:\s*scale)?\b|\bmodel hash\b|\bcheckpoint\b|\bsd_model\b|\bseed\b/i],
  ['AI provenance source', /trainedAlgorithmicMedia|compositeWithTrainedAlgorithmicMedia|algorithmicMedia/i],
];

const AI_KEYWORD_PATTERN = /^(?:parameters|prompt|negative[ _-]?prompt|workflow|comfy(?:ui)?|invokeai|fooocus|novelai|generation[ _-]?(?:data|parameters)|sd[ _-]?metadata)$/i;

export function detectAiSignals(text) {
  if (!text) return [];
  return AI_PATTERNS
    .filter(([, pattern]) => pattern.test(text))
    .map(([label]) => label);
}

export function classifyAiText(keyword, text) {
  const signals = detectAiSignals(`${keyword ?? ''}\n${text ?? ''}`);
  const keywordMatch = AI_KEYWORD_PATTERN.test(String(keyword ?? '').trim());
  return {
    marked: keywordMatch || signals.length > 0,
    signals: keywordMatch && signals.length === 0 ? ['AI metadata keyword'] : signals,
  };
}
