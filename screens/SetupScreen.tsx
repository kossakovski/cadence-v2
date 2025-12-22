import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Platform } from 'react-native';

// ------------------------------
// Types (Onboarding V1)
// ------------------------------

type Cadence = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly';

type OnboardingTask = {
  name: string;
  owner: string; // allow empty string
};

type OnboardingWorkstream = {
  name: string;
  cadence: Cadence;

  // Always present (may be empty string)
  lead: string;
  milestone: string;
  milestoneDate: string; // "" or YYYY-MM-DD

  tasks: OnboardingTask[];
};


export type OnboardingV1 = {
  version: 1;
  projects: Array<{
    name: string;
    workstreams: OnboardingWorkstream[];
  }>;
};

type SetupScreenProps = {
  onComplete: (data: OnboardingV1) => void;
};

// ------------------------------
// OpenAI helpers (unchanged style, but schema updated)
// ------------------------------

function getExpoPublicApiKey(): string | undefined {
  // Matches your existing approach: EXPO_PUBLIC_OPENAI_API_KEY
  // If you used a different env var, change it here.
  // @ts-ignore
  return typeof process !== 'undefined' ? process.env.EXPO_PUBLIC_OPENAI_API_KEY : undefined;
}

function extractModelTextFromResponsesApi(data: any): string | undefined {
  // Supports response.output[].message.content[] or output_text-like parts
  const out: any[] = Array.isArray(data?.output) ? data.output : [];
  const parts: string[] = [];

  for (const item of out) {
    const contentArr =
      (Array.isArray(item?.content) && item.content) ||
      (Array.isArray(item?.message?.content) && item.message.content) ||
      [];

    for (const c of contentArr) {
      if (typeof c?.text === 'string' && c.text.trim()) parts.push(c.text);
      else if (typeof c === 'string' && c.trim()) parts.push(c);
    }
  }

  const joined = parts.join('\n').trim();
  return joined.length ? joined : undefined;
}

async function parseSetupWithLLM(freeform: string): Promise<OnboardingV1> {
  const apiKey = getExpoPublicApiKey();
  if (!apiKey) {
    throw new Error(
      'Missing EXPO_PUBLIC_OPENAI_API_KEY. Add it to .env and restart Expo (stop + re-run).'
    );
  }

  // ✅ Updated schema: adds optional lead, milestone, milestoneDate
  const schema = {
    name: 'cadence_onboarding_v1',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        version: { type: 'number', enum: [1] },
        projects: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              name: { type: 'string' },
              workstreams: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    name: { type: 'string' },
                    cadence: {
                      type: 'string',
                      enum: ['daily', 'weekly', 'biweekly', 'monthly', 'quarterly'],
                    },

                    // optional but allowed
                    lead: { type: 'string' },
                    milestone: { type: 'string' },
                    milestoneDate: {
                      type: 'string',
                      // keep strict but simple; allows empty if user didn't give it
                      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
                    },

                    tasks: {
                      type: 'array',
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                          name: { type: 'string' },
                          owner: { type: 'string' },
                        },
                        required: ['name', 'owner'],
                      },
                    },
                  },
                  required: ['name', 'cadence', 'lead', 'milestone', 'milestoneDate', 'tasks'],

                },
              },
            },
            required: ['name', 'workstreams'],
          },
        },
      },
      required: ['version', 'projects'],
    },
  } as const;

  const system = [
  'You are an onboarding parser for the Cadence App.',
  'Convert the user text into STRICT JSON matching the provided schema.',
  'Rules:',
  '- Always output version: 1.',
  '- If a task has no owner, use empty string for owner.',
  '- For every workstream, ALWAYS include lead, milestone, and milestoneDate fields.',
  '- If a workstream lead is not stated, set lead to empty string (do NOT omit it).',
  '- If a milestone is not stated, set milestone to empty string (do NOT omit it).',
  '- If a milestone date is not provided, set milestoneDate to empty string (do NOT invent a date).',
  '- If a milestone date IS provided, milestoneDate must be YYYY-MM-DD.',
  '- If workstreams/tasks are missing, create reasonable defaults but keep arrays valid.',
  '- Cadence must be one of: daily, weekly, biweekly, monthly, quarterly.',
  '- Output ONLY JSON, no markdown, no explanations.',
].join('\n');


  const body = {
    model: 'gpt-4o-mini',
    input: [
      { role: 'system', content: system },
      { role: 'user', content: freeform || '' },
    ],
    text: {
      format: { type: 'json_schema', ...schema },
    },
  };

  const resp = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`OpenAI error ${resp.status}: ${errText}`);
  }

  const data: any = await resp.json();
  const jsonText = extractModelTextFromResponsesApi(data);

  if (!jsonText || typeof jsonText !== 'string') {
    throw new Error(
      'OpenAI response did not include readable JSON text. Expected response.output[].message.content[].text (or output_text).'
    );
  }

  const parsed = JSON.parse(jsonText);

  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.projects)) {
    throw new Error('LLM returned invalid onboarding JSON (expected version:1 + projects array).');
  }

  return parsed as OnboardingV1;
}

// ------------------------------
// UI
// ------------------------------

const SetupScreen: React.FC<SetupScreenProps> = ({ onComplete }) => {
  const [prompt, setPrompt] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [generatedJson, setGeneratedJson] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const buildMockOnboardingJson = (freeform: string): OnboardingV1 => {
  const firstLine = (freeform || '').split('\n')[0]?.trim();
  const projectName = firstLine && firstLine.length > 0 ? firstLine : 'Cadence App – Demo';

  return {
    version: 1,
    projects: [
      {
        name: projectName,
        workstreams: [
          {
            name: 'Execution OS Rollout',
            cadence: 'weekly',
            lead: 'Ops Lead',
            milestone: 'First 3 teams running weekly cadence',
            milestoneDate: '2026-01-31',
            tasks: [
              { name: 'Draft meeting agenda template', owner: 'Aria' },
              { name: 'Pilot with one team', owner: 'Dmitri' },
            ],
          },
          {
            name: 'Product & UX',
            cadence: 'weekly',
            lead: 'Aria',
            milestone: '',
            milestoneDate: '',
            tasks: [
              { name: 'Polish Meeting mode layout', owner: 'Aria' },
              { name: 'Simplify Owner prep inputs', owner: 'Aria' },
            ],
          },
        ],
      },
    ],
  };
};


  function validateOnboarding(obj: any): asserts obj is OnboardingV1 {
  if (!obj || obj.version !== 1 || !Array.isArray(obj.projects)) {
    throw new Error('Invalid onboarding JSON. Expected { version: 1, projects: [...] }.');
  }
}


  const handleGenerateMockJson = () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setJsonError(null);
    try {
      const obj = buildMockOnboardingJson(prompt);
      setGeneratedJson(JSON.stringify(obj, null, 2));
    } catch (e: any) {
      setJsonError(e?.message || 'Failed to generate JSON.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGenerateJsonWithLLM = async () => {
    if (isSubmitting) return;
    try {
      setJsonError(null);
      setIsSubmitting(true);
      const parsed = await parseSetupWithLLM(prompt);
      setGeneratedJson(JSON.stringify(parsed, null, 2));
    } catch (e: any) {
      setJsonError(e?.message || 'LLM parsing failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ✅ Option B: Import OnboardingV1 directly
  const handleUseJson = () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setJsonError(null);
    try {
      const raw = (generatedJson || '').trim();
      if (!raw) throw new Error('Generate (or paste) onboarding JSON first.');
      const parsed: any = JSON.parse(raw);
      validateOnboarding(parsed);
      onComplete(parsed);
    } catch (e: any) {
      setJsonError(e?.message || 'Failed to parse onboarding JSON.');
      setIsSubmitting(false);
    }
  };

  const handleCreateWorkspaceWithLLM = async () => {
    if (isSubmitting) return;
    try {
      setJsonError(null);
      setIsSubmitting(true);

      const parsed = await parseSetupWithLLM(prompt);
      setGeneratedJson(JSON.stringify(parsed, null, 2));

      // ✅ Option B: complete setup with V1 payload
      onComplete(parsed);
    } catch (e: any) {
      setJsonError(e?.message || 'LLM parsing failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateWorkspaceMock = () => {
    if (isSubmitting) return;
    try {
      setJsonError(null);
      setIsSubmitting(true);

      const obj = buildMockOnboardingJson(prompt);
      setGeneratedJson(JSON.stringify(obj, null, 2));

      // ✅ Option B: complete setup with V1 payload
      onComplete(obj);
    } catch (e: any) {
      setJsonError(e?.message || 'Failed to create mock workspace.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const subtitle = useMemo(() => 'Stage 0 · Demo Mode', []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome to Cadence Setup Wizard</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>

      <Text style={styles.helpText}>
        Describe your project(s), workstreams, tasks — and milestones if you have them.
        {Platform.OS === 'web'
          ? '\n\nNote: LLM may require an API key and may hit CORS on web depending on setup.'
          : ''}
      </Text>

      <TextInput
        style={styles.textArea}
        placeholder={
          'Example:\n' +
          'Project: Q1 Operating Rhythm\n' +
          'Workstream: Growth cadence weekly lead Sarah milestone Launch v2 by 2026-02-15\n' +
          'Tasks: Website experiments (Alex), Partnerships (Taylor)\n'
        }
        multiline
        value={prompt}
        onChangeText={setPrompt}
      />

      <Pressable
        onPress={handleCreateWorkspaceWithLLM}
        style={[styles.button, isSubmitting && styles.buttonDisabled]}
      >
        <Text style={styles.buttonText}>{isSubmitting ? 'Creating…' : 'Create workspace (LLM)'}</Text>
      </Pressable>

      <Pressable
        onPress={handleCreateWorkspaceMock}
        style={[styles.buttonSecondary, isSubmitting && styles.buttonDisabled]}
      >
        <Text style={styles.buttonSecondaryText}>Use mock workspace</Text>
      </Pressable>

      <Pressable
        onPress={() => setShowAdvanced((v) => !v)}
        style={{ alignSelf: 'flex-start', marginTop: 10 }}
      >
        <Text style={{ fontSize: 12, fontWeight: '700', color: '#0d47a1' }}>
          {showAdvanced ? 'Hide advanced options' : 'Show advanced options'}
        </Text>
      </Pressable>

      {showAdvanced ? (
        <>
          <Text style={styles.jsonLabel}>Onboarding JSON (editable)</Text>
          {jsonError ? <Text style={styles.errorText}>{jsonError}</Text> : null}

          <Pressable
            onPress={handleGenerateMockJson}
            style={[styles.buttonSecondary, isSubmitting && styles.buttonDisabled]}
          >
            <Text style={styles.buttonSecondaryText}>Generate onboarding JSON (mock)</Text>
          </Pressable>

          <Pressable
            onPress={handleGenerateJsonWithLLM}
            style={[styles.buttonSecondary, isSubmitting && styles.buttonDisabled]}
          >
            <Text style={styles.buttonSecondaryText}>Generate onboarding JSON (LLM)</Text>
          </Pressable>

          <TextInput
            style={styles.jsonArea}
            placeholder="Generated JSON will appear here. You can edit it before importing."
            multiline
            value={generatedJson}
            onChangeText={setGeneratedJson}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Pressable
            onPress={handleUseJson}
            style={[styles.buttonSecondary, isSubmitting && styles.buttonDisabled]}
          >
            <Text style={styles.buttonSecondaryText}>Import this JSON</Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
};

export default SetupScreen;

const styles = StyleSheet.create({
  container: {
    marginTop: 24,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
    marginBottom: 12,
  },
  helpText: {
    fontSize: 12,
    color: '#555',
    marginBottom: 12,
  },
  textArea: {
    minHeight: 120,
    borderWidth: 1,
    borderColor: '#c5cae9',
    borderRadius: 8,
    padding: 8,
    fontSize: 13,
    backgroundColor: '#f8f9ff',
    textAlignVertical: 'top',
    marginBottom: 12,
  },
  jsonLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#333',
    marginTop: 6,
    marginBottom: 6,
  },
  errorText: {
    fontSize: 12,
    color: '#c62828',
    marginBottom: 6,
  },
  jsonArea: {
    minHeight: 160,
    borderWidth: 1,
    borderColor: '#cfd8dc',
    borderRadius: 8,
    padding: 8,
    fontSize: 12,
    backgroundColor: '#fafafa',
    textAlignVertical: 'top',
    marginBottom: 12,
  },
  button: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: '#c5e1a5',
    borderWidth: 1,
    borderColor: '#9ccc65',
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#33691e',
  },
  buttonSecondary: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: '#e3f2fd',
    borderWidth: 1,
    borderColor: '#90caf9',
    marginTop: 8,
  },
  buttonSecondaryText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0d47a1',
  },
});
