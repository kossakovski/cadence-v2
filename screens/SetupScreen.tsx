import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, Platform } from 'react-native';

interface SetupScreenProps {
  // We keep this intentionally untyped here to avoid cross-file type imports.
  onComplete: (data: any) => void;
}

// --- Stage 1 (mock) contract ---
// We intentionally keep this local (no cross-file type imports).
type CadenceType = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly';
type OnboardingV1 = {
  version: 1;
  projects: Array<{
    name: string;
    workstreams: Array<{
      name: string;
      cadence: CadenceType;
      tasks: Array<{ name: string; owner?: string }>;
    }>;
  }>;
};

// ---- LLM helper (Stage 1 real) ----
// Uses EXPO_PUBLIC_OPENAI_API_KEY from .env
function getExpoPublicApiKey(): string | undefined {
  // Expo typically supports process.env.* in JS bundler; but some web setups can be finicky.
  // This tries a couple of safe paths.
  const p: any = (globalThis as any).process ?? (globalThis as any).global?.process;
  const key =
    (p?.env?.EXPO_PUBLIC_OPENAI_API_KEY as string | undefined) ||
    ((process as any)?.env?.EXPO_PUBLIC_OPENAI_API_KEY as string | undefined);
  return key;
}

function extractModelTextFromResponsesApi(data: any): string | undefined {
  if (!data || typeof data !== 'object') return undefined;

  // Back-compat / convenience field (sometimes present)
  if (typeof data.output_text === 'string' && data.output_text.trim()) {
    return data.output_text;
  }

  // Responses API: data.output[] contains items, typically { type:"message", content:[...] }
  const out = Array.isArray(data.output) ? data.output : [];
  const parts: string[] = [];

  for (const item of out) {
    // Some SDK shapes: item.content or item.message.content
    const contentArr =
      (Array.isArray(item?.content) && item.content) ||
      (Array.isArray(item?.message?.content) && item.message.content) ||
      [];

    for (const c of contentArr) {
      // Content parts can be objects like { type:"output_text"|"text", text:"..." }
      if (typeof c?.text === 'string' && c.text.trim()) {
        parts.push(c.text);
      } else if (typeof c === 'string' && c.trim()) {
        parts.push(c);
      }
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
                  required: ['name', 'cadence', 'tasks'],
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

  // Lightweight validation (keeps MVP safe)
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.projects)) {
    throw new Error('LLM returned invalid onboarding JSON (expected version:1 + projects array).');
  }

  return parsed as OnboardingV1;
}

const SetupScreen: React.FC<SetupScreenProps> = ({ onComplete }) => {
  const [prompt, setPrompt] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [generatedJson, setGeneratedJson] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const buildMockOnboardingJson = (freeform: string): OnboardingV1 => {
    const firstLine = (freeform || '').split('\n')[0]?.trim();
    const projectName =
      firstLine && firstLine.length > 0 ? firstLine : 'Cadence App v1 – PPP Prototype';

    return {
      version: 1,
      projects: [
        {
          name: projectName,
          workstreams: [
            {
              name: 'Product & UX (Aria)',
              cadence: 'weekly',
              tasks: [
                { name: 'Refine Cadence Review layout and pills', owner: 'Aria' },
                { name: 'Design Setup Wizard Stage 0 → 1 flow', owner: 'Aria' },
              ],
            },
            {
              name: 'Architecture & Data Model (Nikolai)',
              cadence: 'weekly',
              tasks: [
                { name: 'Harden PPP cycle immutability rules', owner: 'Nikolai' },
                { name: 'Define cadence types and date helpers', owner: 'Nikolai' },
              ],
            },
            {
              name: 'Engineering & Implementation (Maya)',
              cadence: 'weekly',
              tasks: [
                { name: 'Refactor App.tsx into screens/hooks', owner: 'Maya' },
                { name: 'Wire SetupScreen into main app state', owner: 'Maya' },
              ],
            },
            {
              name: 'AI Onboarding & Prompts (Leo)',
              cadence: 'weekly',
              tasks: [
                { name: 'Define Stage 0 → 1 → 2 prompt schema', owner: 'Leo' },
                { name: 'Draft JSON spec for cadence parsing', owner: 'Leo' },
              ],
            },
            {
              name: 'QA & Release (Sofia)',
              cadence: 'weekly',
              tasks: [
                { name: 'Regression test PPP cycle transitions', owner: 'Sofia' },
                { name: 'Test Setup Wizard reset and edge cases', owner: 'Sofia' },
              ],
            },
          ],
        },
      ],
    };
  };

  const onboardingJsonToSetupResult = (obj: OnboardingV1) => {
    const proj = obj.projects?.[0];
    return {
      projectName: proj?.name || 'My first cadence project',
      workstreams: (proj?.workstreams || []).map((ws) => ({
        name: ws.name || 'Workstream',
        tasks: (ws.tasks || []).map((t) => ({
          name: t.name || 'Task',
          owner: (t.owner || '').trim(),
          // Back-compat: App.tsx may still accept task-level cadence.
          cadence: ws.cadence || 'weekly',
        })),
      })),
    };
  };

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

  const handleUseJson = () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setJsonError(null);
    try {
      const raw = (generatedJson || '').trim();
      if (!raw) {
        throw new Error('Generate (or paste) onboarding JSON first.');
      }
      const parsed: any = JSON.parse(raw);
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.projects)) {
        throw new Error('Invalid onboarding JSON. Expected { version: 1, projects: [...] }.');
      }
      const data = onboardingJsonToSetupResult(parsed as OnboardingV1);
      onComplete(data);
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

      // Keep JSON available for Advanced view / debugging
      setGeneratedJson(JSON.stringify(parsed, null, 2));

      // 🚀 Behind the curtain: immediately complete setup
      const setupData = onboardingJsonToSetupResult(parsed);
      onComplete(setupData);
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

      // Keep JSON available for Advanced view / debugging
      setGeneratedJson(JSON.stringify(obj, null, 2));

      // 🚀 Behind the curtain: immediately complete setup
      const setupData = onboardingJsonToSetupResult(obj);
      onComplete(setupData);
    } catch (e: any) {
      setJsonError(e?.message || 'Failed to create mock workspace.');
      setIsSubmitting(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome to Cadence Setup Wizard</Text>
      <Text style={styles.subtitle}>Stage 0 · Demo Mode</Text>

      <Text style={styles.helpText}>
        Describe your projects, workstreams, and tasks. We’ll create your workspace automatically.
        {Platform.OS === 'web'
          ? '\n\nNote: LLM may require an API key and may hit CORS on web depending on setup.'
          : ''}
      </Text>

      <TextInput
        style={styles.textArea}
        placeholder="E.g. Project: X. Workstream: Y cadence weekly. Tasks: A (Owner), B (Owner)..."
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
  buttonDisabled: {
    opacity: 0.7,
  },
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
