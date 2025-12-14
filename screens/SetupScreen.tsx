import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
} from 'react-native';

interface SetupScreenProps {
  // We keep this intentionally untyped here to avoid cross-file type imports.
  onComplete: (data: any) => void;
}

const SetupScreen: React.FC<SetupScreenProps> = ({ onComplete }) => {
  const [prompt, setPrompt] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [generatedJson, setGeneratedJson] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);

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

  const buildMockOnboardingJson = (freeform: string): OnboardingV1 => {
    // MVP: ignore freeform for now, but keep it around for later LLM parsing.
    // Slight “feel” improvement: if the user typed a first line, reuse it as project name.
    const firstLine = (freeform || '').split('\n')[0]?.trim();
    const projectName = firstLine && firstLine.length > 0 ? firstLine : 'Cadence App v1 – PPP Prototype';

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

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome to Cadence Setup Wizard</Text>
      <Text style={styles.subtitle}>
        Stage 0 · Demo Mode
      </Text>
      <Text style={styles.helpText}>
        Paste a short description of your projects, workstreams and tasks.
        In this Stage 1 (mock) demo, we generate a structured onboarding JSON
        (ignoring the text for now), and you can import it.
      </Text>

      <TextInput
        style={styles.textArea}
        placeholder="E.g. We run a weekly leadership cadence with 3 projects..."
        multiline
        value={prompt}
        onChangeText={setPrompt}
      />

      <Pressable
        onPress={handleGenerateMockJson}
        style={[styles.button, isSubmitting && styles.buttonDisabled]}
      >
        <Text style={styles.buttonText}>
          {isSubmitting ? 'Generating…' : 'Generate onboarding JSON (mock)'}
        </Text>
      </Pressable>

      <Text style={styles.jsonLabel}>Onboarding JSON (editable)</Text>
      {jsonError ? <Text style={styles.errorText}>{jsonError}</Text> : null}
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
        <Text style={styles.buttonSecondaryText}>
          Import this JSON
        </Text>
      </Pressable>
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
    marginTop: 2,
  },
  buttonSecondaryText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0d47a1',
  },
});
